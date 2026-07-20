// server.js — 薄代理后端
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors()); // 允许前端 HTML 跨域请求
app.use(express.json());

// 初始化 OpenAI / 测试 API 客户端
// 会自动读取环境变量 OPENAI_API_KEY，或在此填入你的测试 API Key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "YOUR_TEST_API_KEY_HERE"
});

// 接口 1：AI Coach 智能对话响应
app.post('/api/chat', async (req, res) => {
  const { userMessage, learningGoal } = req.body;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6", // 替换为你使用的测试模型名称
      messages: [
        { 
          role: "system", 
          content: `You are Sherpa, an empathetic AI Learning Strategist. The user's goal is: "${learningGoal || 'Master Machine Learning'}". Give a helpful, concise response (2-3 sentences max) to guide their learning.` 
        },
        { role: "user", content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 150
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    console.error("Chat API error:", error.message);
    res.status(500).json({ reply: "I'm recalibrating your strategy based on your input. Let's continue with the practice question!" });
  }
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
      model: "gpt-5.6",
      messages: [
        { role: "system", content: "You are an empathetic learning coach providing quick diagnostic insights." },
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