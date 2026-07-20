# 数据库迁移 v2:概念全局化 + 依赖关系 + 学习证据

对应"保留部分"的落地版本。本次改动**在v1基础上增量修改**,不是推翻重来。

---

## 一、这次改了什么(先看懂再执行)

| 改动 | 说明 |
|---|---|
| 新增 `concepts` 表 | 概念变成全局的,不再绑死在某一个学习计划下,以后不同学习计划可以复用同一个概念 |
| 新增 `learning_plan_concepts` 表 | 表示"某个学习计划包含哪些概念、顺序是什么",把"计划"和"概念"的关系单独拆出来 |
| 新增 `concept_dependencies` 表 | 替代原来`knowledge_points.prerequisite_id`,支持一个概念有**多个**前置概念(比如"神经网络"同时依赖"概率论"和"线性回归") |
| 新增 `learning_evidence` 表(简化版) | 记录"这次为什么判断用户掌握/没掌握",不只是存一个最终分数 |
| `questions`、`learning_progress`、`resources` 三张表 | 原来的`knowledge_point_id`字段**重命名为`concept_id`**,并且外键从指向`knowledge_points`改为指向`concepts` |
| 删除 `knowledge_points` 表 | 功能被`concepts` + `learning_plan_concepts` + `concept_dependencies`三张表取代,原表连同里面的测试数据一起删除 |

**没有改动的部分:** `profiles`、`learning_plans`、`chat_messages`、`attempts`、`wrong_questions`都不受影响,不用改代码逻辑。

---

## 二、执行前必须确认的一件事

`knowledge_points`表会被删除。**如果里面有你想保留的测试数据,先去Table Editor里看一眼、记录一下**,执行完这次迁移后这些数据会一起消失(反正只是测试数据,大概率不影响,但先提醒你)。

---

## 三、完整SQL(在Supabase SQL Editor里新建一个snippet执行)

```sql
-- ===== 迁移 v2:概念全局化 + 依赖关系 + 学习证据 =====

-- 1. 全局概念表
create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  concept_key text unique not null,
  name text not null,
  description text,
  domain text,
  difficulty text check (difficulty in ('Easy','Medium','Hard')),
  created_at timestamptz default now()
);

-- 2. 学习计划包含哪些概念(及顺序)
create table public.learning_plan_concepts (
  id uuid primary key default gen_random_uuid(),
  learning_plan_id uuid references public.learning_plans(id) on delete cascade,
  concept_id uuid references public.concepts(id) on delete cascade,
  sequence_order integer default 0,
  created_at timestamptz default now(),
  unique (learning_plan_id, concept_id)
);

-- 3. 概念依赖关系(支持多个前置概念)
create table public.concept_dependencies (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid references public.concepts(id) on delete cascade,
  prerequisite_concept_id uuid references public.concepts(id) on delete cascade,
  created_at timestamptz default now(),
  unique (concept_id, prerequisite_concept_id),
  check (concept_id <> prerequisite_concept_id)
);

-- 4. 学习证据(简化版)
create table public.learning_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  concept_id uuid references public.concepts(id) on delete cascade,
  question_id uuid references public.questions(id),
  attempt_id uuid references public.attempts(id),
  result text check (result in ('correct','partial','incorrect')),
  evidence_dimension text check (evidence_dimension in ('recognition','recall','explanation','application')),
  notes text,
  created_at timestamptz default now()
);

-- 5. 把questions / learning_progress / resources 的外键从knowledge_points改指向concepts
alter table public.questions drop constraint if exists questions_knowledge_point_id_fkey;
alter table public.learning_progress drop constraint if exists learning_progress_knowledge_point_id_fkey;
alter table public.resources drop constraint if exists resources_knowledge_point_id_fkey;

alter table public.questions
  add constraint questions_concept_id_fkey
  foreign key (knowledge_point_id) references public.concepts(id) on delete cascade;

alter table public.learning_progress
  add constraint learning_progress_concept_id_fkey
  foreign key (knowledge_point_id) references public.concepts(id) on delete cascade;

alter table public.resources
  add constraint resources_concept_id_fkey
  foreign key (knowledge_point_id) references public.concepts(id) on delete cascade;

-- 5.1 字段改名,和上面的外键保持语义一致
alter table public.questions rename column knowledge_point_id to concept_id;
alter table public.learning_progress rename column knowledge_point_id to concept_id;
alter table public.resources rename column knowledge_point_id to concept_id;

-- 6. 删除旧的knowledge_points表(功能已被concepts系列表取代)
drop table if exists public.knowledge_points cascade;

-- 7. 新表统一关闭RLS,和其他表保持一致(黑客松阶段先这样,方便调试)
alter table public.concepts disable row level security;
alter table public.learning_plan_concepts disable row level security;
alter table public.concept_dependencies disable row level security;
alter table public.learning_evidence disable row level security;
```

---

## 四、怎么在Supabase里操作(步骤)

1. 打开Supabase项目 → 左侧 **SQL Editor** → **+ New snippet**。
2. 把上面第三部分的完整SQL复制粘贴进去(不要带```sql和结尾的```这两行)。
3. 点击 **Run** 执行。
4. 如果显示 `Success. No rows returned`,说明执行成功。
5. 去左侧 **Table Editor** 确认:
   - 能看到4张新表:`concepts`、`learning_plan_concepts`、`concept_dependencies`、`learning_evidence`
   - `knowledge_points`表已经消失
   - 打开`questions`表,字段列表里`knowledge_point_id`应该已经变成了`concept_id`

**如果执行报错:**
- 如果报错提示`concepts`已存在,说明你之前执行过一部分,先执行`drop table if exists public.concepts cascade;`再重新跑一遍完整脚本。
- 如果报错和第5步的`drop constraint`有关(提示约束不存在),问题不大,大概率是你之前手动改过表结构导致约束名字不一样,可以先去Table Editor里手动检查一下`questions`表的外键设置,或者告诉我具体报错信息,我帮你看。

---

## 五、这次改动之外,不需要动数据库的两件事

**1. Provider接口抽象(Teacher/Evaluator)**
这是纯代码层面的设计,体现在你后端项目的代码结构里(比如建一个`providers`文件夹,定义接口),跟Supabase数据库无关,不需要写任何SQL。等你开始写后端代码时我可以帮你搭这部分。

**2. `OPENAI_API_KEY`先留空**
这也不是数据库层面的事,是你后端项目的环境变量配置。在你的`.env`文件里这样写就行:

```
OPENAI_API_KEY=
SHERPA_AI_PROVIDER=mock
```

`OPENAI_API_KEY`留空,代码里判断`SHERPA_AI_PROVIDER`是`mock`就直接用规则引擎生成内容,不会真的去调用OpenAI的付费接口,等你们决定要真实调用GPT-5.6的那一刻,把key填上、把这个变量改成对应的provider名字就行,不涉及任何数据库改动。

---

## 六、后续:3-4个知识点的demo数据

这次迁移完成后,`concepts`表是空的,你需要往里面插入你们demo要用的3-4个知识点(以及对应的`concept_dependencies`依赖关系)才能真正跑通闭环演示。这部分我可以在你确认迁移执行成功之后,直接帮你写好insert语句,针对你们具体要演示的学习主题(比如"Python基础"还是别的),告诉我你们想用哪个主题演示,我可以直接给你写好对应的种子数据SQL。
