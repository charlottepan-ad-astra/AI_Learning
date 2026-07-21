# Sherpa AI Learning Platform · 雪巴 AI 学习平台

> 🏔️ 为 **OpenAI Build Week** 打造的个性化 AI 学习工具。
> Sherpa（夏尔巴向导）像登山向导一样，陪伴你从「新手」走向「精通」——它握着地图与指南针，但爬山的始终是你。

---

## ✨ 核心功能

| 功能 | 说明 |
|---|---|
| **AI 个性化出题** | 通过聊天了解你的兴趣与目标后，动态生成专属练习题，**同时给出题目与对应知识点**。 |
| **动态学习地图** | 自动总结你的学习路径、已掌握与待攻克的概念，并以依赖关系串联成「学习地图」。 |
| **错题本（Mistake Intelligence）** | 答错的题自动归档，按知识点分类，支持回顾与针对性重练；并提供 AI 诊断点评。 |
| **学习资料整合** | 为每个概念推荐配套学习资源（文章 / 视频 / 项目等）。 |
| **元认知引导题** | 区别于普通测试题：这类「今天最能帮你练习 X 的行动是？」题目**没有对错之分**，走对话式引导流程，**不计入错题本**。 |
| **学习进度追踪** | 顶部卡片实时展示「完成度 / 连续学习天数 / 薄弱点数量」，数据来自数据库实时计算。 |

> 设计理念：知识不被检验就会流失。Sherpa 在每一次对话、每一道题之后，都把你的成长往前推进一步（Infinite Learning Loop）。

---

## 🏗 技术架构

```
┌─────────────────────────┐        ┌────────────────────────┐        ┌──────────────────┐
│   index.html (前端)      │  HTTP  │   server.js (代理)      │  SDK   │  Supabase (PG)   │
│  原生 JS + Supabase SDK  │ ─────▶ │  Express + OpenAI SDK  │ ─────▶ │  Auth / DB / RLS │
└─────────────────────────┘        └────────────────────────┘        └──────────────────┘
```

- **前端**：单文件 `index.html`（原生 HTML/CSS/JS + Supabase JS SDK），**无需构建步骤**，可直接在浏览器打开。
- **后端代理**：`server.js`（Express），调用 OpenAI 兼容接口，让 `API Key` 只留在服务端，**不暴露给浏览器**。
- **数据库**：Supabase（PostgreSQL），存储用户、学习计划、概念、题目、答题记录、错题、进度、连续天数等。

---

## 📁 项目结构

```
AI_learning_platform/
├── index.html                      # 前端单文件（UI + 逻辑 + Supabase 连接）
├── server.js/
│   └── server.js                  # 后端代理：/api/chat、/api/ai-feedback
├── prompts/
│   └── sherpa-system-prompt.md    # Sherpa 系统提示词（注入 /api/chat）
├── 数据库/
│   ├── database_specification_v1.md  # 建表 SQL 与字段说明
│   ├── database_migration_v2.md      # v2 迁移（概念全局化 + 依赖关系）
│   ├── database_specification_v1.docx
│   ├── version 2.docx
│   └── supabase教程.md            # 零基础 Supabase 操作指南
├── package.json
├── .env                           # 后端环境变量（已提供模板）
├── LICENSE
└── README.md
```

---

## 🚀 快速开始

### 方式一：纯前端 Demo（最快体验，零配置）

直接用浏览器打开 `index.html` 即可。在接入 Supabase 之前，页面会使用**内置示例数据**正常展示所有功能（聊天、学习地图、测验、错题本、进度卡片均为本地演示数据）。

### 方式二：完整体验（Supabase + 本地代理）

**1. 安装依赖**

```bash
npm install
```

**2. 配置后端环境变量**

编辑项目根目录的 `.env`（已提供），填入你的模型服务信息：

```bash
OPENAI_API_KEY=你的密钥
OPENAI_BASE_URL=https://api.siliconflow.cn/v1   # 可替换为任意 OpenAI 兼容地址
OPENAI_MODEL=deepseek-ai/DeepSeek-R1-0528-Qwen3-8B
```

> API Key 只保存在服务端环境变量中，不会暴露给浏览器。

**3. 配置前端数据库连接**

打开 `index.html`，修改文件顶部（JS 常量区）的 `SUPABASE_URL` 与 `SUPABASE_KEY` 两个值（在 Supabase 后台 `Settings → Data API` 与 `Settings → API Keys` 获取）。

> 未配置前，登录页可正常显示，但登录后页面会回退到示例数据。

**4. 初始化数据库**

按下方「数据库设置」章节建表并写入 demo 数据。

**5. 启动后端代理**

```bash
npm start
# 或
node server.js/server.js
```

**6. 打开页面**

在浏览器中打开 `index.html`，先**注册 / 登录**一个 Supabase 账户，即可获得持久化的个性化学习体验。

---

## ⚙️ 配置项一览

| 位置 | 变量 | 作用 |
|---|---|---|
| `server.js` / `.env` | `OPENAI_API_KEY` | 模型服务密钥（仅服务端） |
| `server.js` / `.env` | `OPENAI_BASE_URL` | OpenAI 兼容接口地址，默认 SiliconFlow |
| `server.js` / `.env` | `OPENAI_MODEL` | 使用的模型名 |
| `index.html`（顶部常量） | `SUPABASE_URL` | 前端连接用的 Supabase 项目地址 |
| `index.html`（顶部常量） | `SUPABASE_KEY` | 前端连接用的 publishable / anon key |

---

## 🗄 数据库（Supabase）设置

所有建表 SQL 与图文教程都在 `数据库/` 目录下。推荐顺序：

1. **建表（v1）**：在 Supabase `SQL Editor` 中执行 `数据库/database_specification_v1.md` 里「四、完整建表 SQL」整段。
2. **执行 v2 迁移**：执行 `数据库/database_migration_v2.md` 里的 SQL（概念全局化、依赖关系、学习证据；并把 `knowledge_point_id` 重命名为 `concept_id`）。
3. **补建 `user_streaks` 表**（学习连续天数，前端 `fetchStats` / `updateStreak` 依赖此表）：

   ```sql
   -- ===== 补建 user_streaks 表 =====
   create table if not exists public.user_streaks (
     id uuid primary key default gen_random_uuid(),
     user_id uuid references auth.users(id) on delete cascade,
     current_streak integer not null default 0,
     longest_streak integer not null default 0,
     last_active_date date,
     updated_at timestamptz default now(),
     unique (user_id)
   );
   alter table public.user_streaks disable row level security;
   ```

4. **（可选）清理历史脏数据**：若旧数据中 `wrong_questions.question_id` 为 `NULL`（会导致错题本重复/字段为空），执行：

   ```sql
   delete from public.wrong_questions where question_id is null;
   ```

5. **写入 demo 概念数据**：`concepts` 表初始为空，需插入 3–4 个演示知识点及其依赖关系，才能跑通完整闭环。可参考 `数据库/database_migration_v2.md` 第六节。

> 新手可直接照着 `数据库/supabase教程.md` 一步步操作。

---

## 🤖 AI 代理接口（`server.js`）

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/chat` | `POST` | Sherpa 主对话。接收 `{ userMessage, learningGoal }`，返回 AI 回复（注入 `prompts/sherpa-system-prompt.md` 作为系统提示）。 |
| `/api/ai-feedback` | `POST` | 错题诊断点评。接收 `{ questionTitle, userAnswer, correctAnswer, explanation }`，返回 2 句话的共情诊断。 |
| `/health` | `GET` | 健康检查。 |

---

## 📚 文档导航

- `数据库/database_specification_v1.md` — 表结构与建表 SQL
- `数据库/database_migration_v2.md` — v2 迁移说明
- `数据库/supabase教程.md` — 零基础 Supabase 操作图文指南
- `prompts/sherpa-system-prompt.md` — Sherpa 系统提示词（含 6 大教学模块、动态难度调节、元认知引导等）

---

## 📄 License

见仓库根目录 `LICENSE`。
