# 数据库规范 Database Specification v1.0

AI学习工具 · OpenAI Build Week

---

## 一、整体架构说明

数据库托管在Supabase(Postgres)。用户账号由Supabase内置的`auth.users`表管理,不可自定义扩展,所有自定义用户字段放在`public.profiles`表中,通过`id`一对一关联。

**表关系概览:**

```
auth.users (Supabase内置)
    │
    ├── profiles (用户画像)
    │
    └── learning_plans (学习计划,一个用户可有多个)
            │
            ├── chat_messages (对话记录,通过learning_plan_id可选关联)
            │
            └── knowledge_points (知识点,支持前置知识点自引用)
                    │
                    ├── questions (题目)
                    │       │
                    │       ├── attempts (答题记录)
                    │       └── wrong_questions (错题本)
                    │
                    ├── learning_progress (学习地图/掌握度)
                    │
                    └── resources (学习资料,不关联具体用户)
```

---

## 二、数据表详细规范

### 1. profiles(用户画像)

扩展`auth.users`,存储AI初次聊天了解到的用户信息。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK/FK) | 对应 auth.users.id |
| username | TEXT | 用户昵称 |
| avatar_url | TEXT | 头像 |
| interest | TEXT[] | 兴趣(篮球、AI、音乐等) |
| learning_style | TEXT | Video / Reading / Practice |
| preferred_language | TEXT | 中文 / English |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### 2. learning_plans(学习计划)

一个用户可以同时拥有多个学习计划(例如同时学Python和吉他)。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | 学习计划ID |
| user_id | UUID (FK → auth.users) | 所属用户 |
| subject | TEXT | 学习主题(如Python) |
| goal | TEXT | 学习目标 |
| level | TEXT | Beginner / Intermediate / Advanced |
| target_date | DATE | 预计完成时间 |
| status | TEXT | Active / Completed |
| created_at | TIMESTAMPTZ | 创建时间 |

### 3. knowledge_points(知识点)

学习地图的数据来源,支持前置知识点自引用,方便未来做依赖路径。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | 知识点ID |
| learning_plan_id | UUID (FK) | 所属学习计划 |
| name | TEXT | 知识点名称 |
| description | TEXT | AI总结 |
| prerequisite_id | UUID (FK, 自引用, 可为空) | 前置知识点 |
| difficulty | TEXT | Easy / Medium / Hard |
| created_at | TIMESTAMPTZ | 创建时间 |

**约束:** `UNIQUE (learning_plan_id, name)` — 防止AI重复生成同名知识点。

### 4. chat_messages(对话记录)

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | 消息ID |
| user_id | UUID (FK) | 用户 |
| session_id | UUID | 一次聊天会话 |
| learning_plan_id | UUID (FK, 可为空) | 所属学习计划,聊天当下计划可能还未生成 |
| role | TEXT | user / assistant |
| content | TEXT | 消息内容 |
| created_at | TIMESTAMPTZ | 时间 |

**说明:** 初次聊天时`learning_plan_id`为空,AI根据对话生成`learning_plans`记录后回填此字段。

### 5. questions(AI生成题目)

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | 题目ID |
| user_id | UUID (FK) | 用户 |
| knowledge_point_id | UUID (FK) | 知识点 |
| title | TEXT | 题目 |
| question_type | TEXT | 单选/多选/编程 |
| difficulty | TEXT | 难度 |
| options | JSONB | 选项(数量不固定,用JSON最灵活) |
| answer | TEXT | 标准答案 |
| explanation | TEXT | AI解析 |
| generated_by | TEXT | 默认 'GPT-5.6' |
| created_at | TIMESTAMPTZ | 生成时间 |

### 6. attempts(答题记录)

学习行为日志,一题可作答多次,永不覆盖。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | 记录ID |
| question_id | UUID (FK) | 对应题目 |
| user_id | UUID (FK) | 用户 |
| user_answer | TEXT | 用户答案 |
| is_correct | BOOLEAN | 是否正确 |
| score | INTEGER | 得分 |
| time_spent | INTEGER | 作答耗时(秒) |
| created_at | TIMESTAMPTZ | 答题时间 |

### 7. wrong_questions(错题本)

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | ID |
| user_id | UUID (FK) | 用户 |
| question_id | UUID (FK) | 错题 |
| review_count | INTEGER | 已复习次数,默认0 |
| mastered | BOOLEAN | 是否掌握,默认false |
| last_reviewed_at | TIMESTAMPTZ | 最近复习 |
| created_at | TIMESTAMPTZ | 加入错题本时间 |

**约束:** `UNIQUE (user_id, question_id)` — 防止同一道错题被重复插入,应用层需用upsert(存在则更新review_count,不存在则插入)。

### 8. learning_progress(学习地图 / 掌握度)

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | ID |
| user_id | UUID (FK) | 用户 |
| knowledge_point_id | UUID (FK) | 知识点 |
| mastery | INTEGER | 掌握度(0-100) |
| status | TEXT | Not Started / Learning / Mastered |
| total_attempts | INTEGER | 做题次数 |
| correct_rate | DECIMAL | 正确率 |
| last_reviewed | TIMESTAMPTZ | 最近学习 |
| next_review | TIMESTAMPTZ | AI建议复习时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

**约束:** `UNIQUE (user_id, knowledge_point_id)` — 防止同一知识点产生多条进度记录,应用层需用upsert更新掌握度,而不是每次插入新行。

### 9. resources(学习资料)

不关联具体用户,所有人共用同一份资料库,避免重复存储。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | ID |
| knowledge_point_id | UUID (FK) | 对应知识点 |
| title | TEXT | 标题 |
| description | TEXT | 简介 |
| url | TEXT | 链接 |
| resource_type | TEXT | Video / PDF / Website |
| source | TEXT | 来源 |
| language | TEXT | 中文 / English |
| created_at | TIMESTAMPTZ | 创建时间 |

---

## 三、变更记录(相对上一版的修正)

| 问题 | 修正方式 |
|---|---|
| 自定义字段不能直接加在auth.users里 | 新增profiles表,一对一关联 |
| 一个用户只能存一份学习目标 | 新增learning_plans表,支持多主题 |
| knowledge_point用纯文本,容易拼写不一致导致查询对不上 | 独立成knowledge_points表,用UUID关联 |
| 聊天记录未关联学习计划,无法按主题筛选对话 | chat_messages新增可空的learning_plan_id |
| 同一错题重复插入,错题本会出现重复项 | wrong_questions加UNIQUE(user_id, question_id) |
| 同一知识点可能产生多条进度记录 | learning_progress加UNIQUE(user_id, knowledge_point_id) |
| AI可能重复生成同名知识点 | knowledge_points加UNIQUE(learning_plan_id, name) |

---

## 四、完整建表SQL(可直接在Supabase SQL Editor执行)

```sql
create extension if not exists "pgcrypto";

-- 1. 用户画像
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  avatar_url text,
  interest text[],
  learning_style text,
  preferred_language text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. 学习计划
create table public.learning_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  subject text not null,
  goal text,
  level text check (level in ('Beginner','Intermediate','Advanced')),
  target_date date,
  status text default 'Active' check (status in ('Active','Completed')),
  created_at timestamptz default now()
);

-- 3. 知识点
create table public.knowledge_points (
  id uuid primary key default gen_random_uuid(),
  learning_plan_id uuid references public.learning_plans(id) on delete cascade,
  name text not null,
  description text,
  prerequisite_id uuid references public.knowledge_points(id),
  difficulty text check (difficulty in ('Easy','Medium','Hard')),
  created_at timestamptz default now(),
  unique (learning_plan_id, name)
);

-- 4. 聊天记录
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  session_id uuid not null,
  learning_plan_id uuid references public.learning_plans(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz default now()
);

-- 5. 题目
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  knowledge_point_id uuid references public.knowledge_points(id) on delete cascade,
  title text not null,
  question_type text check (question_type in ('单选','多选','编程')),
  difficulty text check (difficulty in ('Easy','Medium','Hard')),
  options jsonb,
  answer text not null,
  explanation text,
  generated_by text default 'GPT-5.6',
  created_at timestamptz default now()
);

-- 6. 答题记录
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references public.questions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  user_answer text,
  is_correct boolean not null,
  score integer,
  time_spent integer,
  created_at timestamptz default now()
);

-- 7. 错题本
create table public.wrong_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  review_count integer default 0,
  mastered boolean default false,
  last_reviewed_at timestamptz,
  created_at timestamptz default now(),
  unique (user_id, question_id)
);

-- 8. 学习地图/掌握度
create table public.learning_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  knowledge_point_id uuid references public.knowledge_points(id) on delete cascade,
  mastery integer default 0 check (mastery between 0 and 100),
  status text default 'Not Started' check (status in ('Not Started','Learning','Mastered')),
  total_attempts integer default 0,
  correct_rate decimal default 0,
  last_reviewed timestamptz,
  next_review timestamptz,
  updated_at timestamptz default now(),
  unique (user_id, knowledge_point_id)
);

-- 9. 学习资料
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  knowledge_point_id uuid references public.knowledge_points(id) on delete cascade,
  title text not null,
  description text,
  url text not null,
  resource_type text check (resource_type in ('Video','PDF','Website')),
  source text,
  language text,
  created_at timestamptz default now()
);

-- 黑客松阶段先关闭RLS,方便直接读写调试；接入真实登录后记得打开并加策略
alter table public.profiles disable row level security;
alter table public.learning_plans disable row level security;
alter table public.knowledge_points disable row level security;
alter table public.chat_messages disable row level security;
alter table public.questions disable row level security;
alter table public.attempts disable row level security;
alter table public.wrong_questions disable row level security;
alter table public.learning_progress disable row level security;
alter table public.resources disable row level security;
```
