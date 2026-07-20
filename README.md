# Sherpa AI Learning Platform

## 运行方式

1. 安装依赖：
   ```bash
   npm install express cors openai
   ```

2. 配置环境变量：
   - 项目根目录已提供 `.env` 文件
   - 其中包含 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_MODEL`

3. 启动代理服务：
   ```bash
   node server.js/server.js
   ```

4. 打开前端页面：
   - 直接在浏览器中打开 `final_version_test12.html`

## 说明

- 前端页面会调用本地代理接口 `/api/chat`
- API Key 只保存在服务端环境变量中，不会暴露给浏览器
- 如果你要部署到公网，请将 `.env` 放到服务端环境中，而不是提交到仓库
