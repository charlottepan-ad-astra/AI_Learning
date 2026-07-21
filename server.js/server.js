// server.js — 安全代理后端
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || "https://api.siliconflow.cn/v1"
});

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Sherpa AI backend is running.',
    endpoints: ['/health', '/api/chat', '/api/ai-feedback', '/api/generate-roadmap', '/api/generate-question', '/api/evaluate-learning-activity', '/api/extract-goal', '/api/extract-learner-profile', '/api/grade-answer']
  });
});

// 把前端传来的对话历史整理成合法的 user/assistant 交替序列：
//  - 任何非 user/assistant 的角色（含误传的 system）强制降级为 user
//  - 丢弃空内容，合并连续相同角色，移除开头的 assistant
//  这样即使前端传错，也绝不会把系统提示词当成回复来源，也不会因历史错乱而答非所问
function sanitizeHistory(msgs) {
  const out = [];
  for (const m of (Array.isArray(msgs) ? msgs : [])) {
    const role = m && m.role === "assistant" ? "assistant" : "user";
    const content = (m && typeof m.content === "string") ? m.content.trim() : "";
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content += "\n" + content;
    } else {
      out.push({ role, content });
    }
  }
  while (out.length && out[0].role === "assistant") out.shift();
  return out;
}

// 检测文本语言，用于强制 AI 回复与用户保持一致（杜绝“用户说英文、AI 回中文”）
function detectLang(text) {
  if (!text) return "English";
  const cjk = (String(text).match(/[一-鿿]/g) || []).length;
  const latin = (String(text).match(/[A-Za-z]/g) || []).length;
  return cjk > latin ? "Chinese" : "English";
}

function extractJsonObject(content) {
  let raw = String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) raw = raw.slice(start, end + 1);
  return JSON.parse(raw);
}

function cleanProfileText(value, maxLength = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function roadmapKey(topic, name, index) {
  const slug = `${topic || 'subject'}_${name || `concept_${index + 1}`}`
    .toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 72);
  return slug || `subject_concept_${index + 1}`;
}

function normalizeRoadmap(raw, topic) {
  const inputConcepts = Array.isArray(raw && raw.concepts) ? raw.concepts.slice(0, 10) : [];
  if (inputConcepts.length < 3) throw new Error('Roadmap requires at least three concepts');
  const usedKeys = new Set();
  const keyMap = new Map();
  const concepts = inputConcepts.map((item, index) => {
    const name = cleanProfileText(item && item.name, 120);
    if (!name) throw new Error('Roadmap concept is missing a name');
    const sourceKey = cleanProfileText(item && item.concept_key, 120) || name;
    let key = roadmapKey(topic, sourceKey, index);
    let suffix = 2;
    while (usedKeys.has(key)) key = `${roadmapKey(topic, sourceKey, index).slice(0, 68)}_${suffix++}`;
    usedKeys.add(key);
    keyMap.set(sourceKey, key);
    keyMap.set(name, key);
    return {
      concept_key: key,
      name,
      description: cleanProfileText(item && item.description, 360),
      difficulty: ['Easy', 'Medium', 'Hard'].includes(item && item.difficulty) ? item.difficulty : 'Medium',
      sequence_order: index
    };
  });
  const normalizeKey = value => keyMap.get(cleanProfileText(value, 120)) || '';
  const dependencySet = new Set();
  const dependencies = (Array.isArray(raw && raw.dependencies) ? raw.dependencies : []).flatMap(item => {
    const conceptKey = normalizeKey(item && item.concept_key);
    const prerequisiteKey = normalizeKey(item && item.prerequisite_concept_key);
    if (!conceptKey || !prerequisiteKey || conceptKey === prerequisiteKey) return [];
    const id = `${conceptKey}:${prerequisiteKey}`;
    if (dependencySet.has(id)) return [];
    dependencySet.add(id);
    return [{ concept_key: conceptKey, prerequisite_concept_key: prerequisiteKey }];
  });
  const milestones = (Array.isArray(raw && raw.milestones) ? raw.milestones.slice(0, 5) : []).map((item, index) => ({
    title: cleanProfileText(item && item.title, 120) || `Milestone ${index + 1}`,
    outcome: cleanProfileText(item && item.outcome, 360),
    concept_keys: (Array.isArray(item && item.concept_keys) ? item.concept_keys : []).map(normalizeKey).filter(Boolean)
  })).filter(item => item.concept_keys.length);
  if (!milestones.length) milestones.push({ title: 'Core foundations', outcome: 'Apply the essential concepts with confidence.', concept_keys: concepts.slice(0, Math.min(3, concepts.length)).map(c => c.concept_key) });
  return { rationale: cleanProfileText(raw && raw.rationale, 900), concepts, dependencies, milestones };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fallbackAdaptiveDecision(input) {
  const progress = input.current_progress || {};
  const activity = input.activity || {};
  const roadmap = Array.isArray(input.roadmap) ? input.roadmap : [];
  const currentKey = cleanProfileText(input.current_concept_key, 120);
  const currentIndex = Math.max(0, roadmap.findIndex(c => c.concept_key === currentKey));
  const priorMastery = Number(progress.mastery) || 0;
  const attempts = Number(progress.total_attempts) || 0;
  const priorRate = Number(progress.correct_rate) || 0;
  const correct = !!activity.is_correct;
  // Evidence count and prior accuracy moderate the estimate; this is a safe fallback
  // when the model is unavailable, not a fixed correct/incorrect point increment.
  const confidence = Math.min(1, (attempts + 1) / 5);
  const signal = correct ? (0.58 + 0.42 * priorRate) : (0.15 + 0.35 * priorRate);
  const mastery = Math.round(clamp(priorMastery * (1 - 0.18 * confidence) + signal * 100 * (0.18 * confidence) + (correct ? 7 : -5), 0, 100));
  const advance = correct && mastery >= 70 && currentIndex < roadmap.length - 1;
  const next = roadmap[advance ? currentIndex + 1 : currentIndex] || {};
  const difficulty = mastery < 40 ? 'Easy' : mastery >= 80 && correct ? 'Hard' : 'Medium';
  return {
    updated_mastery: mastery,
    evidence_dimension: activity.question_type === 'short_answer' ? 'explanation' : activity.question_type === 'fill_blank' ? 'recall' : 'application',
    diagnosis: {
      category: correct ? 'reinforce_and_extend' : 'conceptual_gap',
      summary: correct ? 'The learner showed usable understanding; reinforce it with a transfer task.' : 'The latest evidence indicates a gap that needs a more scaffolded retry.',
      intervention: correct ? 'Move from recognition to application.' : 'Review the core distinction, then retry a smaller example.'
    },
    next_concept_key: next.concept_key || currentKey,
    next_quiz_difficulty: difficulty,
    recommended_question_type: correct && mastery >= 80 ? 'short_answer' : mastery < 45 ? 'multiple_choice' : 'fill_blank',
    review_after_hours: correct ? (mastery >= 80 ? 168 : 72) : 24
  };
}

function normalizeAdaptiveDecision(raw, input) {
  const fallback = fallbackAdaptiveDecision(input);
  const roadmapKeys = new Set((Array.isArray(input.roadmap) ? input.roadmap : []).map(c => c.concept_key));
  const diagnosis = raw && raw.diagnosis && typeof raw.diagnosis === 'object' ? raw.diagnosis : {};
  return {
    updated_mastery: Number.isFinite(Number(raw && raw.updated_mastery)) ? Math.round(clamp(Number(raw.updated_mastery), 0, 100)) : fallback.updated_mastery,
    evidence_dimension: ['recognition', 'recall', 'explanation', 'application'].includes(raw && raw.evidence_dimension) ? raw.evidence_dimension : fallback.evidence_dimension,
    diagnosis: {
      category: cleanProfileText(diagnosis.category, 80) || fallback.diagnosis.category,
      summary: cleanProfileText(diagnosis.summary, 500) || fallback.diagnosis.summary,
      intervention: cleanProfileText(diagnosis.intervention, 500) || fallback.diagnosis.intervention
    },
    next_concept_key: roadmapKeys.has(raw && raw.next_concept_key) ? raw.next_concept_key : fallback.next_concept_key,
    next_quiz_difficulty: ['Easy', 'Medium', 'Hard'].includes(raw && raw.next_quiz_difficulty) ? raw.next_quiz_difficulty : fallback.next_quiz_difficulty,
    recommended_question_type: ['multiple_choice', 'fill_blank', 'short_answer'].includes(raw && raw.recommended_question_type) ? raw.recommended_question_type : fallback.recommended_question_type,
    review_after_hours: Number.isFinite(Number(raw && raw.review_after_hours)) ? Math.round(clamp(Number(raw.review_after_hours), 1, 24 * 90)) : fallback.review_after_hours
  };
}

// 接口 1：AI Coach 智能对话响应（支持多轮上下文）
app.post('/api/chat', async (req, res) => {
  // messages: 前端传来的完整对话历史（user/assistant 交替）；单轮调用时回退到 userMessage
  const { userMessage, learningGoal, messages, learnerProfile, strategyProfile } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ reply: "服务端尚未配置 OPENAI_API_KEY，请先设置环境变量后再试。" });
  }

  try {
    const history = sanitizeHistory(
      Array.isArray(messages) && messages.length
        ? messages
        : [{ role: "user", content: userMessage || "" }]
    );

    // 强制 AI 回复语言与用户最近一条消息一致
    const lastUserMsg = [...history].reverse().find(m => m.role === "user");
    const lang = (typeof req.body.language === "string" && req.body.language)
      ? req.body.language
      : detectLang(lastUserMsg ? lastUserMsg.content : (userMessage || ""));

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
      messages: [
        {
          role: "system",
          content: `You are **Sherpa**, the user's personal mountain guide on the journey of mastering any subject — from "Novice" to "Master."
You walk alongside them, not ahead. You carry the map and compass; the climber does the climbing.
Your mission: architect a personalized learning journey in ANY subject, adapting dynamically to their level, emotion, and goal.

### **CORE DIRECTIVE: THE "INFINITE LEARNING LOOP"**
**NEVER** end a turn with just an answer. Every response must push the user's growth forward.
Your workflow for EVERY turn:
1. **Diagnose** — Read between the lines. What is the user's level, emotion, and learning style in *this specific message*?
2. **Strategize** — Pick the path, the resource format, and the next concept.
3. **Adapt** — Adjust difficulty to match the edge of their ability (see DDA module).
4. **Deliver** — Output: content + feedback + metacognitive "why."
5. **Consolidate & Propel** — Lock in retention with a check, then propose the immediate next step.

---

### **MODULE 1: STRATEGIC NAVIGATION (The "Map")**
**Goal:** Eliminate startup confusion. Define the optimal path before teaching.
At the start of a topic, when the user is stuck, or when they ask "where do I start?", you MUST:
1. **Read the user profile** (infer from their words, confirm in one line):
   - *Time-Poor / Executive* → Strategy: high-efficiency Q&A, summaries, key frameworks.
   - *Hands-on / Kinesthetic* → Strategy: project-based, "build X to learn Y."
   - *Visual / Spatial* → Strategy: diagrams, mind maps, vivid metaphors.
   - *Deep Learner* → Strategy: theory first, long-form reading, derivations.
2. **Prescribe the resource format** that fits them: book / video / podcast / article / interactive quiz / code-along.
3. **Define the routing logic** between concepts:
   - *Sequential:* "Learn A first, then B." (Foundational dependencies.)
   - *Parallel / Integrated:* "Learn A and B together so the connection clicks." (Cross-domain insight.)
   - *Transformation:* "You already know X — use it as a bridge to Y." (Leverage prior knowledge.)

---

### **MODULE 2: DYNAMIC DIFFICULTY ADJUSTMENT (DDA)**
Read the user's signal EVERY turn, then switch mode. Do not ask — infer.

| Signal you observe                                  | Mode to activate       | Technique                                                                                       |
|---|---|---|
| Confused, stuck, frustrated, says "I don't get it"  | **Scaffolding Mode**   | Give A/B/C options, multiple choice, or fill-in-the-blank. Reduce cognitive load.              |
| Answers easily, gives shallow or one-line replies   | **Challenge Mode**     | Reject the simple answer. Add a **Constraint** ("solve with zero budget", "explain to a 5-year-old", "argue against a skeptic"). |
| Bored, unmotivated, drifting off-topic, says "ugh"  | **Inspiration Mode**   | Connect to a personal passion, a "Big Vision" of what mastery unlocks, or a small ritual.      |
| Confidently correct, asks for depth                 | **Deepening Mode**     | Edge cases, trade-offs, "what would break this?", historical context, second-order effects.   |

**Rule of thumb:** aim for the **edge of their ability** — hard enough to grow, not so hard they shut down.

---

### **MODULE 3: GROWTH FEEDBACK LOOP (Realism)**
**Strict ban on empty praise** ("Great job!", "Awesome!", "You're doing great!").
Every piece of feedback MUST contain three parts:
1. **Validation** — Point out *specifically* what logic or intuition was correct, and why.
2. **Gap Analysis** — Name the **Blind Spot** or **Next Level** ("You got the concept, but missed the execution cost" / "Correct pattern, applied one step too late").
3. **Actionable Advice** — A specific method, mental model, framework, or one-line cheat sheet to close the gap.

---

### **MODULE 4: PEDAGOGY & METACOGNITION (The "Why")**
You are a Mentor, not a Search Engine. The user must leave each turn slightly better at *learning itself*, not just at the topic.
- **Explain the strategy briefly:** When you change mode, add a one-sentence reason. ("I'm giving you A/B/C first because building a mental menu is faster than free-recall under stress.")
- **Name the move:** If you use a Socratic question, a Feynman explanation, a worked example, or an analogy — say so. ("Here's a Feynman-style explanation...")
- **Teach the meta-pattern:** Once per session, surface a reusable learning principle (e.g., "Always pin down the failure mode before optimizing the success mode").

---

### **MODULE 5: CONTINUITY & CONSOLIDATION**
Knowledge that isn't tested is knowledge that leaks.
- **The Check:** Use Socratic questions. ("How does this connect to what we said earlier?" / "Apply this rule to a brand-new scenario." / "What would happen if X were false?")
- **Spaced Re-trigger:** When the user revisits a topic, briefly recall the original context before adding new info. ("Last time you nailed the intuition but missed the cost — today we close that loop.")
- **The Next Step:** End every response with a clear, low-friction next action — in almost all cases this is **"answer the quiz on the right panel"** (the practice is generated for you there). Never leave the user asking "What now?", and never make the next step an in-chat exercise.

---

### **MODULE 6: SESSION AWARENESS & EDGE CASES**
- **Off-topic / venting:** Briefly acknowledge their state, then offer ONE way the new topic can still serve the learning goal — or gently re-anchor. Never pretend a rant is a quiz answer.
- **Repetition / looping:** If the user asks the same thing twice, do not repeat verbatim. Compress, deepen, or reframe from a new angle.
- **User wants to quit / frustrated plateau:** Acknowledge, lower the next step to a 2-minute micro-win, then rebuild momentum.
- **Platform tools:** When natural, suggest using the platform's features — the Learning Map (to see progress), the Error Book (to revisit mistakes), or the Quiz (to lock in retention). Do not force it; weave it in at most once per session if relevant.

---

### **RESPONSE FORMAT (every reply)**
Keep responses **focused and skimmable**. Use this loose template:
1. **Diagnose line** *(visible to the user)* — a one-sentence read of their state. ("Sounds like the abstraction is clear but the mechanics aren't clicking yet.")
2. **The substance** — the actual answer, framework, or question. Use bullets, numbered steps, or short paragraphs. Avoid walls of text.
3. **Why this approach** *(one short line, only when non-obvious)*.
4. **The Next Step** — almost always "practice it on the quiz on the right →". Never make the next step an in-chat exercise.

**Length:** aim for **150–400 words** unless the user explicitly asks for depth. If a longer answer is required, structure it with headings.

---

### **TONE & ADAPTATION**
- **Emotion detection:** Anxious → warm, patient, smaller steps. Arrogant → professional, sharp, demand rigor. Confused → slow, analogical. Excited → match the energy, channel it into action.
- **Language level:** Match the user's vocabulary. If they use jargon, use it back. If they don't, translate first, then map back to the professional term in parentheses. Never talk down.
- **Persona consistency:** You are Sherpa — the mountain guide. Calm, experienced, never out of breath. You don't lecture; you point at the next handhold. Use the second person ("you"), not the third.

---

### **INITIALIZATION (first turn only)**
When the conversation starts AND the user has NOT yet been profiled (i.e. the supplied message history is empty), ask exactly these (in their language), all in one short message:
1. "What subject do you want to conquer today?"
2. "What is your preferred learning style?
   (A) Hands-on projects — learn by building
   (B) Quick Q&A — fast, targeted answers
   (C) Deep theory — books, papers, long-form"
3. *(Optional, only if relevant)* "And how much time can you put in per session — 10 minutes, 30, or an hour+?"

After they answer WITH a concrete subject, **IMMEDIATELY** set the strategy + difficulty level, give ONE short teaching note (e.g. a key fact or framing for the subject), then point them to the right-side quiz to practice. Do not wait for them to ask.
**CRITICAL:** The "first micro-step" is a TEACHING note + a pointer to the right panel — it is NEVER an in-chat exercise, challenge, or task for the learner to complete in chat. The actual practice is generated automatically on the right-side quiz panel.

### **PROFILE COMPLETION**
The platform extracts these durable fields from the conversation: learning goal, current level, motivation, preferred learning style, available study time, and target outcome.
After the learner names a subject, naturally gather missing fields over the next turns. Ask at most two short, relevant questions at a time; do not repeat facts already present in the learner profile. Treat the target outcome as a concrete capability or result, not simply a topic.

---

### **CRITICAL: NEVER INVENT THE SUBJECT**
If the learner has NOT yet named a concrete subject or skill they want to learn, you MUST ask them what subject to focus on (e.g., "Great — what subject should we use? Could be algebra, Spanish, photography, anything.") BEFORE giving any worked example, practice question, or quiz.
- Do NOT assume a subject (never default to math, coding, etc.) just because they asked for "a worked example" or "practice".
- Once they name a subject, anchor every example, question, and the learning goal to THAT subject.
- Keep asking (gently, once) until you have a concrete subject — a vague reply like "help me get started" is not a subject.

### **QUIZZES & PRACTICE BELONG ON THE RIGHT PANEL — NEVER IN CHAT**
This app has a dedicated "AI Generated Quiz" panel on the RIGHT side. Your job in the chat is to TEACH, DIAGNOSE, and DISCUSS — never to run practice or graded exercises here.
- After you explain a concept, do NOT ask the learner to answer questions, fill in blanks, write sentences, describe lists, or complete any task INSIDE the chat.
- The quiz on the right is generated AUTOMATICALLY from the subject — you do NOT write the questions. Your only job is to teach and then point there.
- If the learner shares an answer in chat, gently redirect: "Nice try! Submit it in the quiz panel on the right so I can score it and track your progress." (Chinese: "不错！请把它提交到右侧的测验面板，我来评分并记录进度。")
- **THE CHAT IS NOT A WORKSHEET.** EXPLICITLY FORBIDDEN in chat, in ANY form (including "mini-challenge", "challenge", "your task", "try this", "homework", "warm-up", or "Next Step" exercises):
  - fill-in-the-blank / translation drills
  - "write a sentence using...", "describe three...", "name five...", "list X items"
  - "circle the correct option", multiple-choice you invented, or ANY graded exercise
  - any instruction that asks the learner to PRODUCE an answer/output as practice
- Correct pattern: teach a short point, then end with "Now practice it on the quiz on the right →" (Chinese: "去右侧的测验练一练 →"). Never invent the practice yourself.

---

### **CRITICAL: LANGUAGE CONSISTENCY**
You MUST respond in the **exact same language** the user writes in. No code-switching, no mixing, no "let me also add in English."
- User writes in Chinese → reply ONLY in Simplified Chinese.
- User writes in English → reply ONLY in English.
- User writes in another language → reply in that language.
- Technical terms (e.g., "API", "vector", "过拟合") MAY stay in their original form regardless of language, but all surrounding explanations must follow the user's language.

---

### **SESSION CONTEXT (injected by the platform)**
- Current learning goal: ${learningGoal || 'Not yet set — infer from conversation or ask via Module 6.'}
- Learner profile: ${JSON.stringify(learnerProfile || {})}
- Active learning strategy: ${JSON.stringify(strategyProfile || {})}
- Treat all earlier turns in this conversation as your memory of this learner. Reference them naturally; never pretend the chat just started.

### **LANGUAGE OVERRIDE (highest priority)**
The user's most recent message is written in ${lang}. You MUST reply in ${lang} and ONLY in ${lang}. Do not switch languages and do not add translations in another language.
`
        },
        ...history
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    console.error("Chat API error:", error.message);
    res.status(500).json({ reply: "我暂时无法连接到 AI 服务，请稍后再试。" });
  }
});

// 接口 2.5：从真实对话中提取学习目标（goal / topic / focus）
// 解决“学习目标从通用按钮文字硬抽、与聊天内容无关”的问题：让 AI 根据整段对话判断用户真正想学什么
app.post('/api/extract-goal', async (req, res) => {
  const { messages } = req.body;
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "服务端尚未配置 OPENAI_API_KEY。" });
  }
  try {
    const history = sanitizeHistory(Array.isArray(messages) ? messages : []);
    if (!history.length) {
      return res.json({ goal: "", topic: "", focus: "" });
    }
    const lang = (typeof req.body.language === "string" && req.body.language)
      ? req.body.language
      : detectLang(history.map(h => h.content).join(" "));
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
      messages: [
        {
          role: "system",
          content: `You extract a learner's real goal from a coaching conversation.
Read the whole conversation and decide the SPECIFIC subject or skill the user wants to learn.
Rules:
- Be specific. "math", "coding", "a new skill" are TOO vague — prefer "algebra word problems", "Python basics", "Spanish present tense".
- If the user has NOT stated any concrete subject yet (only vague/generic replies), return empty strings.
- Respond with ONLY a single valid JSON object (no markdown, no commentary):
{"goal":"a concise learning goal, e.g. Build confidence in algebra word problems","topic":"the specific subject, e.g. algebra word problems","focus":"one aspect to emphasize, e.g. translating words to equations"}
- RESPOND IN THE LEARNER'S LANGUAGE: if they write in English, return English goal/topic/focus; if Chinese, return Chinese. Detected language: ${lang}.`
        },
        ...history
      ],
      temperature: 0.3,
      max_tokens: 400
    });
    let raw = completion.choices[0].message.content || "{}";
    raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
    if (s !== -1 && e !== -1 && e > s) raw = raw.slice(s, e + 1);
    const parsed = JSON.parse(raw);
    res.json({
      goal: String(parsed.goal || "").trim(),
      topic: String(parsed.topic || "").trim(),
      focus: String(parsed.focus || "").trim()
    });
  } catch (error) {
    console.error("Extract goal API error:", error.message);
    res.status(500).json({ error: "提取学习目标失败。" });
  }
});

// 接口 3：AI 根据学习目标动态生成练习题（支持多种题型）
// Extract a durable learner profile and an actionable strategy from the coaching conversation.
// Partial profiles are valid: known facts are persisted while Sherpa continues the interview.
app.post('/api/extract-learner-profile', async (req, res) => {
  const history = sanitizeHistory(req.body.messages);
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
  if (!history.length) return res.json({ profile: {}, strategy: {}, missing_fields: ['learning_goal', 'current_level', 'motivation', 'preferred_learning_style', 'available_study_time', 'target_outcome'], ready: false });

  const language = typeof req.body.language === 'string' ? req.body.language : detectLang(history.map(m => m.content).join(' '));
  const systemPrompt = `You are a learning-strategy analyst. Extract only facts the learner explicitly states or that are strongly supported by the conversation. Do not invent personal details.
Return ONLY valid JSON with this exact shape:
{"profile":{"learning_goal":"string or empty","current_level":"Beginner|Intermediate|Advanced or empty","motivation":"string or empty","preferred_learning_style":"hands_on|visual|reading|discussion|mixed or empty","available_study_time_minutes":"integer 5-600 or null","target_outcome":"string or empty"},"strategy":{"recommended_session_minutes":"integer 5-600 or null","recommended_content_format":"string or empty","initial_quiz_difficulty":"Easy|Medium|Hard or empty","quiz_mode":"scaffold|standard|challenge or empty","coaching_approach":"string or empty","resource_preference":"string or empty"},"missing_fields":["field names still needed"],"ready":true|false}
Rules:
- A profile is ready only when learning_goal, current_level, preferred_learning_style, available_study_time_minutes, and target_outcome are known. Motivation may remain empty.
- Derive strategy only from known profile facts. Use a conservative Medium/standard default only when a concrete goal is known but level is not.
- Use ${language} for free-text values; enum values must remain exactly as specified.`;
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
      messages: [{ role: 'system', content: systemPrompt }, ...history], temperature: 0.1, max_tokens: 700
    });
    const parsed = extractJsonObject(completion.choices[0].message.content);
    const rawProfile = parsed.profile || {};
    const rawStrategy = parsed.strategy || {};
    const availableMinutes = Number(rawProfile.available_study_time_minutes);
    const sessionMinutes = Number(rawStrategy.recommended_session_minutes);
    const profile = {
      learning_goal: cleanProfileText(rawProfile.learning_goal),
      current_level: ['Beginner', 'Intermediate', 'Advanced'].includes(rawProfile.current_level) ? rawProfile.current_level : '',
      motivation: cleanProfileText(rawProfile.motivation),
      preferred_learning_style: ['hands_on', 'visual', 'reading', 'discussion', 'mixed'].includes(rawProfile.preferred_learning_style) ? rawProfile.preferred_learning_style : '',
      available_study_time_minutes: Number.isInteger(availableMinutes) && availableMinutes >= 5 && availableMinutes <= 600 ? availableMinutes : null,
      target_outcome: cleanProfileText(rawProfile.target_outcome)
    };
    const strategy = {
      recommended_session_minutes: Number.isInteger(sessionMinutes) && sessionMinutes >= 5 && sessionMinutes <= 600 ? sessionMinutes : null,
      recommended_content_format: cleanProfileText(rawStrategy.recommended_content_format, 120),
      initial_quiz_difficulty: ['Easy', 'Medium', 'Hard'].includes(rawStrategy.initial_quiz_difficulty) ? rawStrategy.initial_quiz_difficulty : '',
      quiz_mode: ['scaffold', 'standard', 'challenge'].includes(rawStrategy.quiz_mode) ? rawStrategy.quiz_mode : '',
      coaching_approach: cleanProfileText(rawStrategy.coaching_approach),
      resource_preference: cleanProfileText(rawStrategy.resource_preference, 120)
    };
    const required = ['learning_goal', 'current_level', 'preferred_learning_style', 'available_study_time_minutes', 'target_outcome'];
    const missing = required.filter(field => profile[field] === '' || profile[field] === null);
    res.json({ profile, strategy, missing_fields: missing, ready: missing.length === 0 });
  } catch (error) {
    console.error('Extract learner profile API error:', error.message);
    res.status(500).json({ error: 'Could not extract learner profile.' });
  }
});

// Generate a structured, profile-aware learning roadmap. Persistence remains in the
// existing Supabase client layer, alongside the rest of the learning-plan writes.
app.post('/api/generate-roadmap', async (req, res) => {
  const { goal, topic, learnerProfile, strategyProfile } = req.body;
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
  const safeTopic = cleanProfileText(topic, 160);
  const safeGoal = cleanProfileText(goal, 320);
  if (!safeTopic || !safeGoal) return res.status(400).json({ error: 'A learning goal and topic are required.' });
  const language = typeof req.body.language === 'string' ? req.body.language : detectLang(`${safeGoal} ${safeTopic}`);
  const systemPrompt = `You are Sherpa's curriculum architect. Create a practical personalized learning roadmap, not a generic topic list.
Return ONLY a valid JSON object with this exact shape:
{"rationale":"why this order fits the learner","concepts":[{"concept_key":"short stable identifier","name":"concept name","description":"what the learner will be able to do","difficulty":"Easy|Medium|Hard"}],"dependencies":[{"concept_key":"dependent concept key","prerequisite_concept_key":"required concept key"}],"milestones":[{"title":"milestone title","outcome":"observable outcome","concept_keys":["concept keys"]}]}
Rules:
- Create 4 to 8 concepts in a deliberate learning order, from prerequisites to the target outcome.
- Model prerequisite relationships explicitly; a concept may have more than one prerequisite.
- Include 2 to 4 milestones with observable outcomes.
- Fit scope, examples, pacing, difficulty, and practice style to the learner profile and active strategy.
- Do not include resources, quizzes, or explanations outside this JSON.
- Write all free text in ${language}; enum values and JSON keys must remain exactly as specified.`;
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Learning goal: ${safeGoal}\nTopic: ${safeTopic}\nLearner profile: ${JSON.stringify(learnerProfile || {})}\nActive strategy: ${JSON.stringify(strategyProfile || {})}` }
      ],
      temperature: 0.35,
      max_tokens: 2400
    });
    res.json({ roadmap: normalizeRoadmap(extractJsonObject(completion.choices[0].message.content), safeTopic) });
  } catch (error) {
    console.error('Generate roadmap API error:', error.message);
    res.status(500).json({ error: 'Could not generate learning roadmap.' });
  }
});

// Generate a practice question using the persisted learner context when available.
app.post('/api/generate-question', async (req, res) => {
  const { goal, topic, focus, difficulty, previousQuestion, type, learnerProfile, strategyProfile } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "服务端尚未配置 OPENAI_API_KEY。" });
  }

  // 题型：auto 让模型自选，否则按前端指定
  const requestedType = ["multiple_choice", "fill_blank", "short_answer", "auto"].includes(type) ? type : "auto";
  const lang = (typeof req.body.language === "string" && req.body.language)
    ? req.body.language
    : detectLang(`${goal} ${topic}`);

  const sysPrompt = `You are an expert question designer for a personalized learning platform.
Generate ONE high-quality practice question tailored to the learner's goal and topic.
The question format is determined by the "type" field:
- "multiple_choice": exactly 4 options, exactly one correct answer (letter A/B/C/D).
- "fill_blank": a sentence or short paragraph with 1-3 blanks written as ___ (three underscores). Provide the correct word/phrase for each blank, in order.
- "short_answer": an open-ended question best answered in 1-3 sentences. Provide an ideal sample answer.

Return ONLY a single valid JSON object (no markdown fences, no commentary):
multiple_choice:
{"type":"multiple_choice","title":"question text","options":["A text","B text","C text","D text"],"answer":"A","explanation":"why correct","difficulty":"Easy|Medium|Hard","knowledge_point":"concept tested"}
fill_blank:
{"type":"fill_blank","title":"sentence with ___ blanks","answers":["word1","word2"],"explanation":"why","difficulty":"Easy|Medium|Hard","knowledge_point":"concept tested"}
short_answer:
{"type":"short_answer","title":"open question","sample_answer":"ideal answer","explanation":"why","difficulty":"Easy|Medium|Hard","knowledge_point":"concept tested"}
Rules:
- If previousQuestion is provided, do NOT repeat it.
- Match the learner's language.
- Stay strictly on the stated topic/focus.
- type must be one of: multiple_choice, fill_blank, short_answer.
- When a learner profile and strategy are supplied, use them to select the right cognitive load, question framing, and difficulty.
- IMPORTANT: Write the question, ALL options, the explanation, and the knowledge_point in the learner's language: ${lang}.`;

  const userPrompt = `Learning goal: ${goal || "general learning"}
Topic to practice: ${topic || "the goal topic"}
Focus: ${focus || "core concepts"}
Difficulty: ${difficulty || "Medium"}
Question type: ${requestedType}
Learner profile: ${JSON.stringify(learnerProfile || {})}
Learning strategy: ${JSON.stringify(strategyProfile || {})}
${previousQuestion ? `Do NOT repeat this question: "${previousQuestion}"` : ""}
Now output the JSON question.`;

  try {
    const controller = new AbortController();
    const genTimeoutMs = Number(process.env.AI_GEN_TIMEOUT) || 60000;
    const timer = setTimeout(() => controller.abort(), genTimeoutMs);
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.8,
        max_tokens: 1500,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    let raw = completion.choices[0].message.content || "{}";
    // 去除 DeepSeek-R1 等推理模型的 <think>...</think> 思考块，以及可能的 markdown 代码围栏
    raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    // 容错：只截取第一个 { 到最后一个 } 之间的内容
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      raw = raw.slice(start, end + 1);
    }
    const question = JSON.parse(raw);

    // 归一化选择题选项：去掉模型可能加上的 "A. " / "1) " 等前缀，
    // 统一由前端按索引渲染字母徽标，避免 "A. A. 15" 重复前缀与判分错位。
    if (question.type === "multiple_choice" && Array.isArray(question.options)) {
      const prefixRe = /^\s*[A-Za-z0-9][\.\)、:：]\s*/;
      question.options = question.options.map(o => String(o).replace(prefixRe, "").trim());
    }

    // 校验：根据题目实际 type 校验必备字段
    const t = question.type;
    if (t === "multiple_choice") {
      if (!question.title || !Array.isArray(question.options) || question.options.length < 2 || !question.answer || !question.explanation) {
        throw new Error("Malformed multiple_choice question");
      }
    } else if (t === "fill_blank") {
      if (!question.title || !question.title.includes("___") || !Array.isArray(question.answers) || question.answers.length < 1 || !question.explanation) {
        throw new Error("Malformed fill_blank question");
      }
    } else if (t === "short_answer") {
      if (!question.title || !question.sample_answer || !question.explanation) {
        throw new Error("Malformed short_answer question");
      }
    } else {
      throw new Error("Unknown question type from model");
    }

    res.json({ question });
  } catch (error) {
    console.error("Generate question error:", error.message);
    res.status(500).json({ error: "AI 生成题目失败，请重试。" });
  }
});

// 接口 4：对简答题 / 填空题做 AI 评分（独立于数据库，无库也能用）
// Evaluate one learning activity against the learner's evidence, strategy, and roadmap.
app.post('/api/evaluate-learning-activity', async (req, res) => {
  const input = req.body || {};
  const roadmap = Array.isArray(input.roadmap) ? input.roadmap.slice(0, 12) : [];
  const currentConceptKey = cleanProfileText(input.current_concept_key, 120);
  if (!currentConceptKey || !roadmap.some(c => c && c.concept_key === currentConceptKey)) {
    return res.status(400).json({ error: 'A current roadmap concept is required.' });
  }
  const fallback = fallbackAdaptiveDecision({ ...input, roadmap, current_concept_key: currentConceptKey });
  if (!process.env.OPENAI_API_KEY) return res.json({ decision: fallback, source: 'fallback' });
  const language = typeof input.language === 'string' ? input.language : detectLang(`${input.activity?.question_title || ''} ${input.learner_profile?.learning_goal || ''}`);
  const systemPrompt = `You are Sherpa's adaptive learning evaluator. Use evidence, not encouragement, to update a learner's state after one activity.
Return ONLY valid JSON with this exact shape:
{"updated_mastery":0,"evidence_dimension":"recognition|recall|explanation|application","diagnosis":{"category":"short label","summary":"specific gap or strength","intervention":"next instructional move"},"next_concept_key":"one supplied roadmap key","next_quiz_difficulty":"Easy|Medium|Hard","recommended_question_type":"multiple_choice|fill_blank|short_answer","review_after_hours":1}
Rules:
- Mastery must be 0-100 and reflect the current activity plus prior attempts and evidence, not only whether the latest answer was correct.
- If prerequisites are weak, keep or return to the appropriate prerequisite concept. Advance only with sufficient evidence.
- Match the next question's cognitive load to the learner profile and strategy.
- Set a shorter review interval for an incorrect or fragile concept.
- Write diagnosis text in ${language}; enum values and concept keys must remain exactly as specified.`;
  try {
    const controller = new AbortController();
    const evalTimeoutMs = Number(process.env.AI_EVAL_TIMEOUT) || 30000;
    const timer = setTimeout(() => controller.abort(), evalTimeoutMs);
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ ...input, roadmap, current_concept_key: currentConceptKey }) }
        ],
        temperature: 0.15,
        max_tokens: 900,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    res.json({ decision: normalizeAdaptiveDecision(extractJsonObject(completion.choices[0].message.content), { ...input, roadmap, current_concept_key: currentConceptKey }), source: 'ai' });
  } catch (error) {
    console.error('Evaluate learning activity API error:', error.message);
    res.json({ decision: fallback, source: 'fallback' });
  }
});

app.post('/api/grade-answer', async (req, res) => {
  const { questionTitle, sampleAnswer, userAnswer, knowledgePoint, learnerProfile, strategyProfile } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "服务端尚未配置 OPENAI_API_KEY。" });
  }

  const prompt = `Grade the student's short answer.
Question: "${questionTitle}"
Ideal / sample answer: "${sampleAnswer}"
Student's answer: "${userAnswer || ""}"
Knowledge point: "${knowledgePoint || ""}"
Learner profile: ${JSON.stringify(learnerProfile || {})}
Learning strategy: ${JSON.stringify(strategyProfile || {})}

Decide if the student's answer is essentially correct (captures the key idea). Be lenient: minor wording differences are fine, but a missing or wrong key concept means incorrect.
Respond with ONLY a valid JSON object (no markdown):
{"correct": true|false, "feedback": "one friendly sentence explaining why it's right or what's missing"}`;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
      messages: [
        {
          role: "system",
          content: `You are a fair grader. CRITICAL INSTRUCTION: RESPOND IN THE SAME LANGUAGE AS THE QUESTION.
${req.body.language ? "The expected language is " + req.body.language + ". " : ""}If the question is in English, respond ONLY in English; if in Chinese, respond ONLY in Chinese. Do not mix languages.`
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 200
    });

    let raw = completion.choices[0].message.content || "{}";
    raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
    if (s !== -1 && e !== -1 && e > s) raw = raw.slice(s, e + 1);
    const parsed = JSON.parse(raw);
    res.json({ correct: !!parsed.correct, feedback: String(parsed.feedback || "") });
  } catch (error) {
    console.error("Grade answer error:", error.message);
    res.status(500).json({ error: "评分失败。" });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 接口 2：错题诊断点评
app.post('/api/ai-feedback', async (req, res) => {
  const { questionTitle, userAnswer, correctAnswer, explanation, learnerProfile, strategyProfile } = req.body;

  try {
    const prompt = `Student answered INCORRECTLY.
Question: "${questionTitle}"
Selected Answer: "${userAnswer}"
Correct Answer: "${correctAnswer}"
Base Explanation: "${explanation}"
Learner profile: ${JSON.stringify(learnerProfile || {})}
Learning strategy: ${JSON.stringify(strategyProfile || {})}

Provide a 2-sentence empathetic diagnosis explaining why their specific choice was wrong and how to fix their thinking.`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
      messages: [
        { role: "system", content: `You are an empathetic learning coach providing quick diagnostic insights. 

CRITICAL INSTRUCTION: YOU MUST RESPOND IN THE EXACT SAME LANGUAGE THAT IS USED IN THE QUESTION AND PROMPT.
- If the question is in English, respond ONLY in English.
- If the question is in Chinese, respond ONLY in Chinese.
- Do NOT mix languages under any circumstances.` },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 120
    });

    res.json({ feedback: completion.choices[0].message.content });
  } catch (error) {
    console.error("Feedback API error:", error.message);
    res.status(500).json({ error: "API Failed" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Sherpa AI Proxy running on http://localhost:${PORT}`);
});
