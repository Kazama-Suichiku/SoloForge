# SoloForge 开发指南

## 1. 开发环境要求

- **Node.js**：18+（推荐 20 LTS）
- **npm**：9+ 或 yarn / pnpm
- **Ollama**（可选）：本地 LLM，需单独安装 [ollama.ai](https://ollama.ai)
- **操作系统**：macOS / Windows / Linux

## 2. 安装步骤

```bash
# 克隆仓库
git clone <repo-url>
cd SoloForge

# 安装依赖
npm install

# 复制环境变量（使用 OpenAI 时需配置）
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY（如使用 OpenAI）
```

## 3. 开发命令详解

### 日常开发

需要同时运行两个终端：

| 终端 1 | 终端 2 |
|--------|--------|
| `npm run dev:renderer` | `npm run dev` |

- **`npm run dev:renderer`**：启动 Vite 开发服务器，监听 `http://localhost:5173`，支持热更新
- **`npm run dev`**：启动 Electron，加载 `http://localhost:5173`，开发模式下会自动打开 DevTools

**注意**：必须先启动 `dev:renderer`，再启动 `dev`，否则 Electron 会加载失败。

### 构建相关

| 命令 | 说明 |
|------|------|
| `npm run build:renderer` | 仅构建 React 前端到 `src/renderer/dist/` |
| `npm run build` | 完整打包，根据当前系统生成安装包 |
| `npm run build:mac` | 仅构建 macOS（dmg, zip） |
| `npm run build:win` | 仅构建 Windows（nsis, zip） |

### 生产模式运行

1. 先执行 `npm run build:renderer`
2. 再执行 `npm start` 或 `npm run dev`（此时加载打包后的 `dist/index.html`）

## 4. 如何添加新 Agent

### 步骤 1：创建 Agent 类

在 `src/main/agents/` 下新建文件，例如 `translator-agent.js`：

```javascript
const { BaseAgent } = require('./base-agent');

class TranslatorAgent extends BaseAgent {
  constructor(llmManager) {
    super('translator', 'Translator Agent', '将内容翻译为目标语言');
    if (!llmManager) throw new Error('TranslatorAgent: 需要传入 llmManager');
    this.llmManager = llmManager;
  }

  async execute(input, context) {
    const content = input?.content || '';
    if (!content.trim()) throw new Error('TranslatorAgent: 需要 input.content');

    if (context.isCancelled?.()) throw new Error('任务已取消');

    const messages = [
      { role: 'system', content: '你是一名专业翻译，将用户内容翻译为指定语言。' },
      { role: 'user', content: `翻译以下内容：\n\n${content}` },
    ];

    const response = await this.llmManager.chat(messages);
    const translated = response?.content ?? '';

    return {
      originalContent: content,
      translatedContent: translated.trim(),
      metadata: { model: response?.model },
    };
  }
}

module.exports = { TranslatorAgent };
```

### 步骤 2：在 setup.js 中注册

```javascript
// src/main/agents/setup.js
const { TranslatorAgent } = require('./translator-agent');

// 在 setup() 中：
const translator = new TranslatorAgent(llmManager);
registry.registerAgent(translator);
```

### 步骤 3：在渲染进程中使用

在发起任务时，将 `translator` 加入 `agents` 数组：

```javascript
// 例如：['writer', 'translator', 'reviewer']
soloforge.agent.executeTask({
  taskId: 'xxx',
  taskType: 'translate',
  input: { prompt: '...' },
  agents: ['writer', 'translator', 'reviewer'],
});
```

### 步骤 4（可选）：更新 task-store 中的显示名

在 `src/renderer/store/task-store.js` 的 `AGENT_DISPLAY_NAMES` 中添加：

```javascript
const AGENT_DISPLAY_NAMES = {
  writer: 'Writer',
  reviewer: 'Reviewer',
  translator: 'Translator',
};
```

## 5. 如何切换 LLM Provider

### 方式一：修改 LLMManager 默认 Provider（代码）

在 `src/main/llm/llm-manager.js` 中：

```javascript
// 构造函数中，设置默认 provider
this.defaultProviderName = 'openai';  // 或 'ollama', 'mock'

// 或通过 setDefaultProvider（需在 setup 后调用）
const { getLLMManager } = require('./agents/setup');
getLLMManager().setDefaultProvider('openai');
```

### 方式二：在 Agent 调用时指定

每个 `chat` / `complete` 调用可传入 `provider` 选项：

```javascript
await this.llmManager.chat(messages, { provider: 'openai' });
```

### 方式三：环境变量

- **Ollama**：默认 `http://localhost:11434`，可在 Provider 构造时传入 `baseUrl`
- **OpenAI**：需在 `.env` 中配置 `OPENAI_API_KEY`，Provider 会自动读取

### 降级顺序

默认：`['ollama', 'openai', 'mock']`。若 ollama 不可用，会自动尝试 openai，再 mock。

修改 `llm-manager.js` 中的 `fallbackOrder` 可调整顺序。

## 6. 调试技巧

### 主进程调试

- 使用 `console.log` 或 `logger.info/warn/error`，输出在启动 Electron 的终端
- 日志模块：`src/main/utils/logger.js`，开发模式下会打印到控制台

### 渲染进程调试

- 开发模式下 Electron 会自动打开 DevTools（`main.js` 中 `openDevTools()`）
- 使用 React DevTools、Zustand 等扩展
- 在组件中 `console.log`，输出在 DevTools Console

### IPC 调试

- 在 Preload 中为 API 包装 `console.log`，观察请求/响应
- 主进程 `ipc-handlers.js` 中可加日志，确认任务接收与完成

### LLM 调用调试

- 使用 Mock Provider：设置 `defaultProviderName = 'mock'`，无需真实 API
- Ollama：确保 `ollama run llama3` 已运行，访问 `http://localhost:11434/api/tags` 验证
- OpenAI：检查 `.env` 中的 `OPENAI_API_KEY` 是否正确

### 断点调试

1. 使用 VS Code：配置 `launch.json`，`"runtimeExecutable": "node_modules/.bin/electron"`，`"args": ["."]`
2. 或在 Chrome DevTools 中 attach 到 Electron 进程

### 常见问题

| 问题 | 排查 |
|------|------|
| 白屏 / 无法加载 | 检查 `dev:renderer` 是否已启动，端口 5173 是否被占用 |
| Ollama 连接失败 | 确认 Ollama 已安装并运行，`curl http://localhost:11434/api/tags` 可访问 |
| OpenAI 401 | 检查 `OPENAI_API_KEY` 是否有效、是否有权限 |
| Agent 执行失败 | 查看主进程终端日志，确认 input 格式是否符合 Agent 要求 |
