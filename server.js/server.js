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
    endpoints: ['/health', '/api/chat', '/api/ai-feedback']
  });
});

// 接口 1：AI Coach 智能对话响应
app.post('/api/chat', async (req, res) => {
  const { userMessage, learningGoal } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ reply: "服务端尚未配置 OPENAI_API_KEY，请先设置环境变量后再试。" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
      messages: [
        {
          role: "system",
          content: `You are Sherpa, a helpful and practical AI learning coach. The current user's learning goal is: ${learningGoal || 'Become a Machine Learning Engineer'}. 

CRITICAL INSTRUCTION: YOU MUST RESPOND IN THE EXACT SAME LANGUAGE THAT THE USER USED IN THEIR MESSAGE. 
- If the user writes in English, respond ONLY in English.
- If the user writes in Chinese, respond ONLY in Chinese.
- Do NOT mix languages under any circumstances.

Be encouraging, concise, and clear. Keep it to 2-4 sentences.`
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 220
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    console.error("Chat API error:", error.message);
    res.status(500).json({ reply: "我暂时无法连接到 AI 服务，请稍后再试。" });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 接口 2：错题诊断点评
app.post('/api/ai-feedback', async (req, res) => {
  const { questionTitle, userAnswer, correctAnswer, explanation } = req.body;

  try {
    const prompt = `Student answered INCORRECTLY.
Question: "${questionTitle}"
Selected Answer: "${userAnswer}"
Correct Answer: "${correctAnswer}"
Base Explanation: "${explanation}"

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