# SoloForge 多 Agent 协作流程设计

> 由 **multi-agent-architect** 设计 · 一人公司式 Agent 编排与工作流

---

## 一、业务场景与 Agent 职责划分

### 1.1 双上下文说明

SoloForge 中存在两类 Agent 协作：

| 上下文 | Agent 类型 | 触发方式 | 通信载体 |
|--------|------------|----------|----------|
| **运行时** | Writer、Reviewer 等 | 用户发起任务 | 进程内调用、IPC |
| **开发时** | Cursor Agents | 开发者 @agent 调用 | Cursor IDE、文件/对话 |

本文档同时覆盖两者，以**运行时 Agent** 为主，**开发时 Agent** 为辅。

---

## 二、运行时 Agent 协作（MVP 核心）

### 2.1 流水线模式：Writer → Reviewer

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   User       │────▶│   Orchestrator │────▶│ Writer Agent │
│   输入任务    │     │  (主进程)      │     │   生成初稿   │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                 │
                                                 ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Renderer   │◀────│  IPC 推送    │◀────│Reviewer Agent│
│  展示进度/结果 │     │  进度/结果   │     │  审核与建议   │
└──────────────┘     └──────────────┘     └──────────────┘
```

### 2.2 各 Agent 输入/输出 Schema

#### Writer Agent

| 字段 | 类型 | 说明 |
|------|------|------|
| **input** | | |
| `task` | string | 用户任务描述（如「写一封感谢客户的邮件」） |
| `context` | object? | 可选上下文（收件人、语气等） |
| **output** | | |
| `draft` | string | 生成的初稿文本 |
| `metadata` | object | `{ model, tokens, duration }` |

#### Reviewer Agent

| 字段 | 类型 | 说明 |
|------|------|------|
| **input** | | |
| `draft` | string | Writer 产出的初稿 |
| `task` | string | 原始任务（用于对齐审核方向） |
| **output** | | |
| `finalText` | string | 审核后的最终文本 |
| `suggestions` | string[] | 修改建议列表 |
| `metadata` | object | `{ model, tokens, duration }` |

#### Orchestrator（主进程）

| 职责 | 说明 |
|------|------|
| 接收任务 | 通过 IPC 接收 renderer 的 `agent:execute` 请求 |
| 顺序调度 | 依次调用 Writer → Reviewer，传递中间结果 |
| 进度推送 | 通过 `agent:progress` 向 renderer 推送阶段状态 |
| 结果回传 | 通过 `agent:result` 或 invoke 回调返回最终结果 |

### 2.3 执行流程（文字描述）

1. **用户输入**：在 Renderer 输入任务描述，点击「执行」
2. **IPC 调用**：`ipcRenderer.invoke('agent:execute', { task })`
3. **Orchestrator 启动**：
   - 发送 `agent:progress` → `{ stage: 'writer', status: 'running' }`
   - 调用 Writer Agent，传入 `{ task }`
4. **Writer 执行**：
   - 调用 `callLLM(prompt)` 生成初稿
   - 返回 `{ draft, metadata }`
5. **Orchestrator 切换**：
   - 发送 `agent:progress` → `{ stage: 'reviewer', status: 'running' }`
   - 调用 Reviewer Agent，传入 `{ draft, task }`
6. **Reviewer 执行**：
   - 调用 `callLLM(prompt)` 审核并修改
   - 返回 `{ finalText, suggestions, metadata }`
7. **结果回传**：
   - 发送 `agent:progress` → `{ stage: 'done', status: 'completed' }`
   - 通过 invoke 返回 `{ finalText, suggestions }` 或发送 `agent:result`

### 2.4 通信协议

| 方式 | 用途 | 方向 | Channel 示例 |
|------|------|------|--------------|
| **invoke/handle** | 请求-响应（发起任务、获取结果） | Renderer ↔ Main | `agent:execute` |
| **send/on** | 主进程主动推送（进度、日志） | Main → Renderer | `agent:progress`, `agent:log` |
| **进程内** | Agent 间传参 | Main 内部 | 直接函数调用 / Promise 链 |

### 2.5 扩展点与可替换组件

| 扩展点 | 说明 | 可替换实现 |
|--------|------|------------|
| **LLM 调用** | `callLLM(prompt)` | OpenAI API、Ollama、LiteLLM、Mock |
| **Agent 实现** | Writer/Reviewer 具体逻辑 | 不同 prompt、不同模型 |
| **流水线步骤** | 当前 2 步，可扩展 | 插入「翻译」「润色」等 Agent |
| **进度回调** | 推送粒度 | 按 token 流式 / 按阶段 |

---

## 三、开发时 Agent 协作（Cursor Agents）

### 3.1 主管模式：按任务类型路由

```
                    ┌─────────────────────────┐
                    │   开发者 / 用户需求      │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │  multi-agent-architect  │  ◀── 架构、工作流、编排设计
                    │  （主管 / 路由决策）      │
                    └───────────┬─────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ project-planner │  │ electron-desktop │  │ frontend-desktop │
│ 任务拆解、里程碑  │  │ 主进程、打包、IPC │  │ UI、状态、主题   │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
                    ┌─────────────────────────┐
                    │     code-reviewer       │  ◀── 统一收口：代码审查
                    └─────────────────────────┘
```

### 3.2 路由规则（何时调用谁）

| 需求类型 | 首选 Agent | 备选 / 协作 |
|----------|------------|-------------|
| 新功能规划、任务拆分、版本节奏 | project-planner | multi-agent-architect（架构约束） |
| 主进程、IPC、打包、跨平台 | electron-desktop | - |
| 渲染进程 UI、组件、状态、主题 | frontend-desktop | electron-desktop（IPC 边界） |
| 工作流设计、Agent 编排、通信协议 | multi-agent-architect | project-planner（拆解实现） |
| 代码修改后的质量审查 | code-reviewer | 所有（修改谁审查谁） |

### 3.3 典型协作流程示例

**场景**：新增「翻译 Agent」到运行时流水线

1. **multi-agent-architect**：设计 Writer → Translator → Reviewer 三阶段流程，定义 Translator 的 input/output schema
2. **project-planner**：拆解为 T15（Translator Agent 实现）、T16（UI 支持可选翻译）、依赖标注
3. **electron-desktop**：若需新 IPC channel，补充实现
4. **frontend-desktop**：若 UI 需展示「翻译中」阶段，调整进度展示
5. **code-reviewer**：对上述修改执行 diff 审查

### 3.4 开发时通信

- **载体**：Cursor 对话 + 文件引用（`@agent`、`@file`）
- **无持久化**：每次对话独立，重要结论需写入文档（如本文件）

---

## 四、错误重试与状态

### 4.1 运行时

| 场景 | 策略 | 实现建议 |
|------|------|----------|
| LLM 调用超时 | 重试 1–2 次，指数退避 | `callLLM` 内封装 |
| API 限流 / 429 | 重试 + 友好提示 | 同上 |
| 单 Agent 失败 | 返回明确错误，不继续下游 | Orchestrator try/catch |
| 用户取消 | 支持 AbortController | 传递 signal 到 LLM 调用 |

### 4.2 状态持久化（MVP 外）

- 任务历史：SQLite / JSON 文件
- 进度断点：复杂流程可考虑 checkpoint

---

## 五、可观测性

| 维度 | MVP 实现 | 增强方向 |
|------|----------|----------|
| **日志** | `console.log` + IPC `agent:log` 推送到 UI | 写入文件、按级别过滤 |
| **追踪** | 阶段名 + 耗时（metadata） | trace-id、span、OpenTelemetry |
| **指标** | token 数、耗时 | 统计面板、成本估算 |

---

## 六、流程图汇总

### 运行时端到端

```
User Input ──▶ [Renderer] ──IPC──▶ [Main: Orchestrator]
                                        │
                                        ├── progress ──▶ Renderer (UI 更新)
                                        │
                                        ▼
                                    [Writer Agent] ──draft──▶
                                        │
                                        ▼
                                    [Reviewer Agent] ──finalText──▶
                                        │
                                        └── result ──IPC──▶ Renderer (展示)
```

### 开发时 Agent 路由

```
需求 ──▶ multi-agent-architect (架构/编排)
            │
            ├── 规划类 ──▶ project-planner
            ├── 主进程/打包 ──▶ electron-desktop
            ├── UI/渲染 ──▶ frontend-desktop
            └── 代码变更后 ──▶ code-reviewer
```

---

*文档版本：v1.0 · 设计者：multi-agent-architect · 日期：2025-02-14*
