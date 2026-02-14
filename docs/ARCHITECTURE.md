# SoloForge 架构设计

## 1. 项目架构概览（文字描述）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SoloForge 架构                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Electron 主进程 (Node.js)                         │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐ │    │
│  │  │   main.js   │  │ ipc-handlers │  │     Agent Orchestrator       │ │    │
│  │  │ 窗口/生命周期 │  │  IPC 注册    │  │   Pipeline 编排 + 进度推送   │ │    │
│  │  └──────┬──────┘  └──────┬───────┘  └─────────────┬───────────────┘ │    │
│  │         │                │                        │                  │    │
│  │         │                └────────────┬────────────┘                  │    │
│  │         │                             │                               │    │
│  │         │  ┌──────────────────────────▼──────────────────────────────┐│    │
│  │         │  │              Agent Registry (单例)                       ││    │
│  │         │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  ││    │
│  │         │  │  │Writer Agent │  │Reviewer Agent│  │  (可扩展...)     │  ││    │
│  │         │  │  └──────┬──────┘  └──────┬──────┘  └─────────────────┘  ││    │
│  │         │  └─────────────────────────┼───────────────────────────────┘│    │
│  │         │                             │                                │    │
│  │         │  ┌──────────────────────────▼──────────────────────────────┐│    │
│  │         │  │                LLM Manager                               ││    │
│  │         │  │  多 Provider 管理 | 降级 | 重试                           ││    │
│  │         │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                  ││    │
│  │         │  │  │ Ollama   │ │ OpenAI   │ │  Mock    │                  ││    │
│  │         │  │  └──────────┘ └──────────┘ └──────────┘                  ││    │
│  │         │  └─────────────────────────────────────────────────────────┘│    │
│  └─────────┼──────────────────────────────────────────────────────────────┘    │
│            │                                                                   │
│            │  contextIsolation + preload                                       │
│            ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │  Preload (preload.js)                                                 │     │
│  │  contextBridge.exposeInMainWorld('soloforge', { ... })                │     │
│  └───────────────────────────┬──────────────────────────────────────────┘     │
│                              │                                                 │
│                              │  IPC (invoke / on)                              │
│                              ▼                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │                 渲染进程 (React + Vite)                               │     │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐  │     │
│  │  │   App.jsx   │  │ useAgentEvents│  │       Zustand Task Store     │  │     │
│  │  │ UI 布局     │  │ IPC 事件订阅  │  │  tasks / currentTask / 进度  │  │     │
│  │  └─────────────┘  └──────────────┘  └─────────────────────────────┘  │     │
│  └──────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. 主进程 / 渲染进程 / Preload 职责

### 主进程 (Main Process)

- **职责**：窗口管理、应用生命周期、Node.js 能力、Agent 编排、LLM 调用
- **入口**：`src/main/main.js`
- **核心模块**：
  - `main.js`：创建 `BrowserWindow`，加载 URL 或本地 HTML，处理 `activate` / `window-all-closed`
  - `ipc-handlers.js`：注册 `agent:execute-task`、`agent:cancel-task`、`agent:get-status` 等 IPC handler
  - `agents/`：Agent 定义、Registry、Orchestrator
  - `llm/`：LLM Manager、Ollama/OpenAI/Mock Provider

### 渲染进程 (Renderer Process)

- **职责**：UI 渲染、用户交互、通过 Preload 暴露的 API 与主进程通信
- **入口**：`src/renderer/main.jsx` → `index.html`
- **技术**：React 18、Vite、Tailwind CSS、Zustand
- **安全**：`nodeIntegration: false`、`sandbox: true`，不直接访问 Node API

### Preload (Preload Script)

- **职责**：在主进程与渲染进程之间建立安全桥接，仅暴露必要的 IPC 接口
- **入口**：`src/preload/preload.js`
- **暴露 API**：`window.soloforge`
  - `getVersion()` / `quit()`：App 相关
  - `agent.executeTask(request)`：执行任务
  - `agent.cancelTask(taskId)`：取消任务
  - `agent.onProgress(cb)` / `onComplete(cb)` / `onError(cb)`：订阅事件

## 3. Agent 系统架构

### AgentRegistry（单例）

- 集中管理所有已注册 Agent
- `registerAgent(agent)` / `getAgent(id)` / `getAllAgents()`

### BaseAgent 基类

- 所有 Agent 继承 `BaseAgent`
- 必须实现 `execute(input, context) => Promise<Record<string, unknown>>`
- 内部状态：`idle` | `running` | `completed` | `error`

### 现有 Agent

| Agent | id | 功能 | 输入 | 输出 |
|-------|-----|------|------|------|
| Writer | writer | 根据任务描述生成内容 | `{ prompt }` | `{ content, metadata }` |
| Reviewer | reviewer | 审核与改进内容 | `{ content }` | `{ originalContent, reviewedContent, suggestions }` |

### AgentOrchestrator（编排器）

- 按 `agents` 数组顺序执行 Pipeline
- 每个 Agent 的输出作为下一个 Agent 的输入
- 支持：进度推送、取消检测、部分成功（中途失败时返回已完成步骤结果）

### 数据流

```
TaskRequest { taskId, taskType, input, agents: ['writer','reviewer'] }
     │
     ▼
Orchestrator.runPipeline()
     │
     ├─► Writer.execute(input)  → output1
     │        │
     │        ▼
     ├─► Reviewer.execute(output1) → output2
     │
     ▼
TaskResult { taskId, success, output: output2 }
```

## 4. IPC 通信流程

### 频道定义（`ipc-channels.js`）

| 频道 | 方向 | 说明 |
|------|------|------|
| `app:get-version` | renderer → main (invoke) | 获取版本 |
| `app:quit` | renderer → main (invoke) | 退出应用 |
| `agent:execute-task` | renderer → main (invoke) | 执行任务 |
| `agent:cancel-task` | renderer → main (invoke) | 取消任务 |
| `agent:get-status` | renderer → main (invoke) | 获取 Agent 状态 |
| `task:progress` | main → renderer (send) | 任务进度更新 |
| `task:complete` | main → renderer (send) | 任务完成 |
| `task:error` | main → renderer (send) | 任务错误 |

### 执行任务流程

1. 渲染进程：`soloforge.agent.executeTask({ taskId, taskType, input, agents })`
2. Preload 转发：`ipcRenderer.invoke('agent:execute-task', request)`
3. 主进程：`ipc-handlers` → `AgentOrchestrator.runPipeline()`
4. 主进程执行中：`webContents.send('task:progress', progress)`
5. 渲染进程：`soloforge.agent.onProgress(cb)` 收到进度，更新 Zustand store
6. 主进程完成：`webContents.send('task:complete', result)` 或 `task:error`
7. 渲染进程：`onComplete` / `onError` 更新任务状态

## 5. LLM 调用层设计

### LLMProvider 抽象

- 基类：`LLMProvider`，定义 `chat(messages, options)`、`complete(prompt, options)`、`getModelInfo()`
- 实现：`OllamaProvider`、`OpenAIProvider`、`MockProvider`

### LLMManager

- 职责：多 Provider 管理、默认 Provider、自动降级、重试
- 降级顺序：`['ollama', 'openai', 'mock']`
- 重试：网络/5xx 错误时指数退避，最多 3 次
- API：
  - `chat(messages, { provider? })`：优先使用指定 provider，失败则按顺序降级
  - `complete(prompt, { provider? })`
  - `checkConnection(providerName)`：检测 Provider 是否可用
  - `setDefaultProvider(name)`

### Agent 与 LLM 的关系

- 每个 Agent 构造函数接收 `llmManager` 实例
- Agent 内部通过 `llmManager.chat(messages)` 调用 LLM
- 不直接依赖具体 Provider，由 LLMManager 统一路由
