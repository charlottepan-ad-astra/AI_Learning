# Project Memory — AI Learning Platform

## Core
- Project name (UI): **Sherpa AI** — Personalized Learning Journey.
- AI backend: Node.js + Express, single file `server.js/server.js` (yes, the file lives in a folder named `server.js` — historical convention).
- LLM: `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` via SiliconFlow, OpenAI-compatible API. Temp 0.7, max_tokens 1000 (chat) / 120 (feedback).

## Conventions
- User communicates in Chinese; responds in Chinese. System prompts stay in English (engineering layer).
- All API responses to the user must follow the user's language — enforced in the system prompt.
- The chat system prompt is the "Sherpa" persona: mountain guide, walks alongside the climber, never lectures. 5 core modules + 1 edge-case module (v2).
- Feedback endpoint (`/api/ai-feedback`) is separate and untouched from the main chat optimization.
- **Product flow is chat-first** (confirmed by user 2026-07-21): a new account's `learning_plans` row starts with `subject=NULL, goal=NULL` and **no plan_concepts**. Only AFTER the user chats with AI and a topic is inferred does the system attach concepts to the plan and update the goal. So the workspace's quiz panel and the Learning Map page must show empty states for an account that hasn't chatted yet — never auto-populate.

## Files of interest
- `server.js/server.js` — Express backend, OpenAI proxy, holds the Sherpa system prompt.
- `index.html` — Frontend single-page app (~80KB+), chat + learning map + error book + quiz.
- `prompts/sherpa-system-prompt.md` — Documentation of the current system prompt with v1→v2 changelog.
- `api_key.py` — Python file present but unused by Node backend; ignore unless user asks.
- `数据库/` — DB-related docs (markdown + docx), Supabase is the active backend.

## Key frontend functions
- `resetUserState()` — single source of truth for wiping in-memory state. Called from `clearAuthState()` (sign-out) and `onAuthSuccess()` (sign-in, defensive).
- `getOrCreateActivePlan(userId)` — creates a NEW plan with null subject/goal and zero concepts. Do NOT re-introduce `attachDemoConceptsToPlan()` on new accounts.
- `applyCoachGoalAndQuestion(text)` — runs after every chat turn. Sets `hasLearningGoal=true`, generates AI-driven map + practice question locally, and fire-and-forgets `persistInferredGoal()` to write to DB.
- `persistInferredGoal(inferred)` — updates `learning_plans.subject/.goal` and calls `attachConceptsForTopic()`.
- `attachConceptsForTopic(planId, topic, goalText)` — idempotent: maps inferred topic → DB `concept_key` → inserts `learning_plan_concepts`.
- `loadNextQuestion()` — guarded by `state.learningGoal === "Not set yet"` so DB data can't leak into the UI before the user has chatted.

## Don'ts
- Don't touch `node_modules/`.
- Don't touch `数据库设计.docx` / `数据库信息.docx` / `secret.docx` without explicit ask.
- Don't change the `api_key.py` — it has nothing to do with the running stack.
- Don't re-add `attachDemoConceptsToPlan()` to the new-user signup path — that re-introduces the "new account sees quiz before chatting" bug.
