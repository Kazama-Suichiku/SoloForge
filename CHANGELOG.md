# Changelog

本文件记录 SoloForge 的版本变更。

## [v0.1.0] - MVP 版本

### 新增

- **桌面应用框架**
  - 基于 Electron + React + Tailwind 的跨平台桌面应用
  - 主进程 / 渲染进程 / Preload 分离，context isolation 安全模式

- **多 Agent 协作**
  - Writer Agent：根据任务描述生成内容（邮件、文章等）
  - Reviewer Agent：对内容审核与改进，输出修改建议
  - Agent 编排器（Orchestrator）：Pipeline 顺序执行，支持进度通知
  - Agent 注册中心（Registry）：集中管理已注册 Agent
  - 部分成功：Pipeline 中途失败时返回已完成步骤结果

- **LLM 支持**
  - Ollama Provider：本地 Ollama API（http://localhost:11434）
  - OpenAI Provider：OpenAI API，支持 `.env` 配置 API Key
  - Mock Provider：测试用，无需真实 API
  - LLM Manager：多 Provider 管理、自动降级、指数退避重试

- **IPC 通信**
  - 任务执行：`agent:execute-task`（invoke）
  - 任务取消：`agent:cancel-task`（invoke）
  - 任务进度 / 完成 / 错误：`task:progress` / `task:complete` / `task:error`（send）

- **前端 UI**
  - 左侧任务历史 + 主内容区布局
  - 任务输入、进度展示、结果展示
  - 明暗主题切换（ThemeToggle）
  - Zustand 任务状态管理

- **构建与发布**
  - Vite 构建渲染进程
  - electron-builder 打包 macOS / Windows

### 技术栈

- Electron 33
- React 18
- Vite 5
- Tailwind CSS 3
- Zustand 5

[Unreleased]: https://github.com/example/soloforge/compare/v0.1.0...HEAD
[v0.1.0]: https://github.com/example/soloforge/releases/tag/v0.1.0
