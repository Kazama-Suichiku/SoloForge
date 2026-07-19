# SoloForge 多 Agent 协作通信架构调研报告

> 调研范围：评估当前多 Agent 协作通信架构能否支撑大规模，对照 Claude Code / Hermes 子代理模式给出重新设计方案
> 调研日期：2026-07-20
> 约束：只读文件 + 写报告，不修改代码

---

## 目录

1. [当前架构分析（消息流图 + 关键文件:行号）](#1-当前架构分析)
2. ["只收到1位回复"根因分析](#2只收到1位回复根因分析)
3. [当前架构瓶颈（能否支撑 100+ Agent / 1000+ 消息）](#3-当前架构瓶颈)
4. [主流多 Agent 通信模式对比（表格）](#4-主流多-agent-通信模式对比)
5. [推荐架构设计（消息流图 + 具体实现方案）](#5-推荐架构设计)
6. [迁移路径（分步计划）](#6-迁移路径)
7. [关键文件改动清单](#7-关键文件改动清单)

---

## 1. 当前架构分析

### 1.1 总体架构

SoloForge 是一个基于 Electron + React 18 + Zustand 5 的多 Agent 桌面应用，采用"虚拟公司"隐喻：每个 Agent 是一名"员工"，有职位、部门、上下级关系。通信链路分为三层：

```
┌─────────────────────────────────────────────────────────────┐
│  渲染进程 (React + Zustand)                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ useChatAgent │  │useAgentIpcEvt│  │   chat-store      │  │
│  │ (编排逻辑)   │←→│ (IPC 订阅)   │←→│ (消息状态)        │  │
│  └──────┬──────┘  └──────┬───────┘  └────────────────────┘  │
└─────────┼────────────────┼──────────────────────────────────┘
          │ IPC invoke     │ IPC send (主→渲染推送)
          ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│  主进程 (Electron Main)                                      │
│  ┌────────────────┐    ┌─────────────────────────────────┐   │
│  │chat-ipc-handlers│───→│  ChatManager (单例)             │   │
│  │ (IPC 入口)      │    │  ├ agents: Map<id, ChatAgent>   │   │
│  └────────────────┘    │  ├ activeTasks: Map (每Agent单任务)│  │
│                        │  └ _proactiveQueue: Map           │   │
│                        └──────────┬──────────────────────┘   │
│                                   │                          │
│  ┌────────────────────────────────▼──────────────────────┐   │
│  │ AgentCommunication (单例) — 通信中枢                   │   │
│  │  ├ messages[]: 全局消息数组 (内存+磁盘)                 │   │
│  │  ├ delegatedTasks[]: 全局任务数组                       │   │
│  │  ├ queue: MessageQueue (每Agent串行队列)               │   │
│  │  ├ messaging: AgentMessaging (点对点消息)              │   │
│  │  └ delegation: TaskDelegation (任务委派)               │   │
│  └───────────────────────────────────────────────────────┘   │
│                                   │                          │
│  ┌────────────────────────────────▼──────────────────────┐   │
│  │ ToolExecutor — 工具执行器                               │   │
│  │  ├ executeToolCalls(): 串行 for...of await            │   │
│  │  └ 协作工具: send_to_agent / delegate_task /           │   │
│  │             post_to_department / notify_boss           │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 关键通信链路

#### A. 用户 → Agent（私聊，流式）

```
用户输入 → useChatAgent.sendToSingleAgent (renderer)
  → window.soloforge.chat.sendMessageStream (IPC invoke)
  → chat-ipc-handlers: CHAT_SEND_MESSAGE_STREAM
    → (async () => { chatManager.handleStreamMessage(request) })()  // 发起即返回
      → chatManager.handleStreamMessage (chat-manager.js:474)
        → _startTask(agentId)  // ⚠️ 若已有任务则中止旧任务 (agent-lifecycle.js:27)
        → runToolLoop({stream:true, ...})  (tool-loop-runner.js:124)
          → agent.chat() → LLM 流式返回
          → parseToolCalls() → toolExecutor.executeToolCalls() (串行)
            → 若工具是 send_to_agent → agentCommunication.sendMessage()
            → 若工具是 delegate_task → agentCommunication.delegateTask()
          → 循环直到无工具调用或达上限(100轮/CXO无限)
        → sendStreamComplete → CHAT_COMPLETE (IPC push)
```

**关键文件:行号**：
- `src/renderer/hooks/useChatAgent.js:136-213` — sendToSingleAgent
- `src/main/chat-ipc-handlers.js:46-85` — CHAT_SEND_MESSAGE_STREAM handler（发起即返回模式）
- `src/main/chat/chat-manager.js:474-600` — handleStreamMessage
- `src/main/agents/tool-loop-runner.js:124-624` — runToolLoop
- `src/main/chat/agent-lifecycle.js:25-45` — startTask（**第27行：先中止旧任务**）

#### B. Agent → Agent（点对点同步消息）

```
Agent A 工具循环中调用 send_to_agent(target=B)
  → collaboration-tools.js:94  agentCommunication.sendMessage({fromAgent:A, toAgent:B, ...})
    → agent-messaging.js:302  AgentMessaging.sendMessage()
      1. detectCycle(callChain) — 循环检测
      2. checkNestingDepth(nestingDepth) — 深度检查 (MAX_NESTING_DEPTH=5)
      3. host.queue.enqueue(toAgent, executeTask) — 入队 B 的消息队列
         → MessageQueue._processQueue(B)  (message-queue.js:87)
           → 若 B 正在处理 → 排队等待（串行）
           → 若 B 空闲 → 立即执行 executeTask
      4. host.timeout.withTimeout(queue.enqueue, 120000ms) — 超时包裹
      5. executeTask 内部:
         → 构建上下文（历史+暂存区+用户背景）
         → host.runToolLoop(targetAgent=B, ..., {callChain, nestingDepth}) — B 的工具循环
         → B 可能再调 send_to_agent → 递归（callChain 增长）
      6. 返回 {success, response} 给 A 的工具循环
```

**关键文件:行号**：
- `src/main/tools/collaboration-tools.js:21-118` — sendToAgentTool
- `src/main/collaboration/agent-messaging.js:302-504` — sendMessage
- `src/main/collaboration/message-queue.js:37-122` — MessageQueue（**每Agent串行**）
- `src/main/collaboration/timeout-manager.js:32-94` — withTimeout（**超时后底层LLM不取消**）
- `src/main/collaboration/agent-messaging.js:34` — MAX_NESTING_DEPTH=5

#### C. Agent → 部门群聊（广播 + @触发）

```
Agent A 调用 post_to_department(content, mention:[B,C])
  → collaboration-tools.js:1406  postToDepartmentTool.execute()
    → department-group.js:440  postToDepartment()
      1. canAgentPostInGroup(A) — 部门归属校验
      2. isGroupRateLimited(groupId) — 群聊速率限制(10秒3条)
      3. filterMentionsToMembers() — 过滤跨部门@
      4. filterCooldownMentions() — 冷却过滤(30秒/Agent)
      5. webContents.send(CHAT_DEPT_GROUP_MESSAGE, {mentions: effective})
        → 渲染进程 useAgentIpcEvents.js:287 onDeptGroupMessage
          → sendMessage() 添加到群聊store
          → 若有效 mentions > 0:
            → handleGroupChat(groupId, conversation, agentIds, triggerContent)
              (useChatAgent.js:222-333)
              → 串行 for...of sorted pendingAgents:
                  await sendToSingleAgent(target)  // 逐个串行触发回复
                  → 检查回复中是否 @ 了新人 → 连锁（最多 MAX_CHAIN_ROUNDS 轮）
```

**关键文件:行号**：
- `src/main/tools/collaboration-tools.js:1377-1457` — postToDepartmentTool
- `src/main/chat/department-group.js:440-525` — postToDepartment
- `src/main/chat/department-group.js:25-30` — 冷却/速率限制常量
- `src/renderer/hooks/useAgentIpcEvents.js:284-350` — onDeptGroupMessage（**触发回复在渲染进程**）
- `src/renderer/hooks/useChatAgent.js:260-326` — handleGroupChat（**串行 await 循环**）

#### D. Agent → Agent（任务委派，同步/异步）

```
Agent A 调用 delegate_task(target=B, wait_for_result=true)
  → collaboration-tools.js:180  delegateTaskTool.execute()
    → agentCommunication.delegateTask()
      → task-delegation.js:53  delegateTask()
        1. 创建 task 对象 → push 到 delegatedTasks[]
        2. 若 waitForResult=true → 立即 executeTask(taskId)  // 同步阻塞
        3. 若 waitForResult=false → setImmediate(() => executeTask)  // 异步fire-and-forget
      → executeTask(taskId)
        → Phase 1: 规划阶段（若 requirePlanApproval）
        → Phase 2: 执行阶段 → runToolLoop(B, taskMessage, ...)
        → 完成后 _triggerSupervisorReview(task, result)
          → setImmediate: sendMessage(system→A, reviewMsg)  // 上司审阅（异步）
```

**关键文件:行号**：
- `src/main/tools/collaboration-tools.js:127-294` — delegateTaskTool
- `src/main/collaboration/task-delegation.js:53-161` — delegateTask
- `src/main/collaboration/task-delegation.js:166-518` — executeTask
- `src/main/collaboration/task-delegation.js:523-689` — _triggerSupervisorReview

### 1.3 通信机制总结

| 机制 | 实现方式 | 并发模型 | 阻塞特性 |
|------|---------|---------|---------|
| send_to_agent | 同步函数调用 + 队列 | 目标Agent串行（队列） | 调用方阻塞等待回复 |
| delegate_task(sync) | 同步函数调用 | 目标Agent串行 | 调用方阻塞等待完成 |
| delegate_task(async) | setImmediate fire-and-forget | 后台并发 | 调用方不阻塞 |
| post_to_department | IPC事件 + 渲染进程编排 | 串行触发回复 | 发送不阻塞，回复串行 |
| notify_boss | IPC push | 即发即忘 | 不阻塞 |

---

## 2. "只收到1位回复"根因分析

### 2.1 场景复现路径

用户报告："让小秘给4位员工发消息，只收到1位回复"。根据代码分析，可能路径有两种：

#### 路径A：秘书用 send_to_agent 逐个发（串行 + 任务覆盖）

秘书 Agent 在工具循环中调用 `send_to_agent` 4次：

```
secretary tool-loop iteration 1:
  → send_to_agent(emp1, msg)  // await，阻塞等待 emp1 回复
    → emp1 队列入队 → emp1 runToolLoop → emp1 回复
  → 返回结果给 secretary
  
secretary tool-loop iteration 2:
  → send_to_agent(emp2, msg)  // await，阻塞等待 emp2 回复
  → ... (emp2 可能耗时较长或超时)
```

**根因1：工具调用串行执行**。`tool-executor.js:768-802` 的 `executeToolCalls` 使用 `for...of + await` 串行执行每个工具调用。即使 LLM 在一轮中输出了 4 个 `send_to_agent` 调用，也是逐个串行等待。前一个不返回，后一个不执行。

**根因2：单Agent单任务约束**。`agent-lifecycle.js:26-27`：`startTask` 时"如果该 Agent 已有活跃任务，先中止旧任务"。当 emp1 正在回复 secretary 时，如果此时有其他触发让 emp1 执行新任务，旧任务会被中止。更关键的是，`MessageQueue`（`message-queue.js:87-122`）保证每个 Agent 串行处理队列任务——emp1 在回复 secretary 期间，任何给 emp1 的新消息都排队等待。

**根因3：超时机制不取消底层调用**。`timeout-manager.js` 注释明确承认："超时后底层 LLM 调用不取消，继续在后台运行"。`sendMessage` 默认超时 120 秒（`agent-messaging.js:35`），超时后调用方收到错误，但目标 Agent 的 LLM 调用仍在后台跑，占用该 Agent 的队列槽位。如果 emp2 的回复慢，120 秒后 secretary 收到超时错误，可能直接结束工具循环不再发后续消息。

**根因4：秘书的 analyzeForDelegation 只委派给1人**。`secretary-agent.js:26-60` 的 `analyzeForDelegation` 是关键词匹配，返回**单个** `delegateTo`。`chat-manager.js:422-448`：秘书私聊时若 `analyzeForDelegation` 命中，只委派给 1 个 Agent，然后直接返回，不会让秘书自主决定发多人。

#### 路径B：秘书用 post_to_department 广播（冷却 + 渲染进程串行）

```
secretary → post_to_department(msg, mention:[emp1,emp2,emp3,emp4])
  → department-group postToDepartment()
    → filterCooldownMentions(): 若任一 emp 在30秒内被触发过 → 被过滤
    → webContents.send(CHAT_DEPT_GROUP_MESSAGE, {mentions:[emp1,emp2,emp3,emp4]})
      → 渲染进程 useAgentIpcEvents onDeptGroupMessage
        → handleGroupChat()
          → for (const {id: targetAgent} of sorted) {  // 串行
              await sendToSingleAgent(target)  // await 阻塞
              ...
            }
```

**根因5：部门群聊回复在渲染进程串行触发**。`useChatAgent.js:275-321`：`handleGroupChat` 用 `for...of + await` 逐个触发被 @ 的 Agent 回复。第一个 Agent 回复完才开始第二个。若第一个回复耗时长或流式连接中断，后续 Agent 可能不被触发。

**根因6：冷却过滤可能误杀**。`department-group.js:25,38-43`：`AGENT_COOLDOWN_MS=30秒`，同一 Agent 30 秒内最多被触发一次。如果 4 个员工中有人近期在群聊活跃过，会被 `filterCooldownMentions` 过滤掉，前端收到的 `effectiveMentions` 可能只剩 1 个。

**根因7：群聊速率限制**。`department-group.js:29-30,60-75`：`GROUP_RATE_LIMIT_MAX=3`，每 10 秒最多 3 条消息。如果秘书短时间发多条，第 4 条会被拒。

### 2.2 最可能根因判定

综合分析，**最可能根因是 路径A 的根因1+根因2+根因4 组合**：

1. 秘书 `analyzeForDelegation`（`secretary-agent.js:26-60`）只返回 1 个委派目标，`chat-manager.js:422-448` 命中后只委派给 1 人即返回——这是"只收到1位回复"的直接原因。
2. 即便秘书自主用 `send_to_agent` 发 4 人，`tool-executor.js:771` 串行 `for...of await` 会让前一个超时(120s)阻塞后所有。
3. 即便用 `post_to_department` 广播，渲染进程 `useChatAgent.js:295` 的 `await sendToSingleAgent` 串行循环 + 冷却过滤也会削减并发。

---

## 3. 当前架构瓶颈

### 3.1 能否支撑 100+ Agent 同时在线？

**结论：不能。**

| 瓶颈点 | 文件:行号 | 问题 |
|--------|----------|------|
| Agent 全部加载在内存 | `chat-manager.js:68-89` | `agents: Map` 一次性初始化全部 Agent，100+ Agent 的 systemPrompt（每个含 collaboration-prompt 约 300 行文本）占用大量内存 |
| 单例全局消息数组 | `agent-communication.js:58` | `this.messages = []` 全局数组，所有 Agent 通信记录都 push 到这里，100+ Agent × 高频通信 → 数组膨胀，`getPairwiseHistory` 每次 O(n) 线性扫描过滤 |
| 磁盘持久化全量写 | `agent-communication.js:152-168` | `_doSave` 每次 `JSON.stringify(messages.slice(-500), delegatedTasks.slice(-200))` 全量序列化，防抖 2 秒，高频通信时 IO 压力大 |
| 每Agent串行队列 | `message-queue.js:87-122` | 每个 Agent 串行处理，`maxQueueLength=32`（`message-queue.js:23`），100+ Agent 互相通信时队列积压严重 |

### 3.2 能否支撑 1000+ 并发消息？

**结论：不能。**

| 瓶颈点 | 文件:行号 | 问题 |
|--------|----------|------|
| 消息全量内存+全量扫描 | `agent-messaging.js:77-100` | `getPairwiseHistory` 每次 `messages.filter(...)` O(n) 扫描全局数组，1000+ 消息时每次通信都扫描 |
| 工具调用串行执行 | `tool-executor.js:771` | `for (const call of toolCalls) { await this.executeTool(...) }` — 一轮内多个工具调用串行，无法并行 |
| 同步等待嵌套 | `agent-messaging.js:380-490` | `sendMessage` 入队后 `await withTimeout(queue.enqueue)` 阻塞调用方线程，嵌套5层时调用链全阻塞 |
| 部门群聊渲染进程串行 | `useChatAgent.js:295` | `for...of await sendToSingleAgent` 串行触发，4个员工已暴露问题，1000消息不可行 |

### 3.3 能否支撑 Agent 链式调用（A→B→C→D）？

**结论：有限支撑，深度≤5。**

- `agent-messaging.js:34`：`MAX_NESTING_DEPTH = 5`，超过返回错误
- `agent-messaging.js:54-64`：`detectCycle(callChain)` 检测循环调用
- 每层嵌套都是 `await` 同步阻塞，4层链式调用 = 4层栈式 await，总耗时 = 各层 LLM 调用时间之和
- `callChain` 通过 `context` 透传（`tool-executor.js` 的 `executeToolCalls` 将 `context` 原样传给每个工具，`send_to_agent` 在 `collaboration-tools.js:91-102` 读取 `context.callChain`）

### 3.4 能否支撑 Agent 群聊广播？

**结论：勉强支撑小规模，大规模不可行。**

- 部门群聊广播依赖渲染进程 `useChatAgent.js:222-333` 的 `handleGroupChat` 串行循环
- `MAX_CHAIN_ROUNDS`（`useChatAgent.js` 导入）限制连锁轮数
- `department-group.js:25-30`：冷却 30 秒/Agent + 速率 10 秒 3 条，大规模广播会被限流
- 广播后每个被 @ 的 Agent 回复是 `await sendToSingleAgent` 串行，N 个 Agent = N × 单次回复时间

### 3.5 能否支撑 Agent 工具调用嵌套（A 调 B，B 调 C）？

**结论：有限支撑，同链式调用限制。**

- 嵌套通过 `runToolLoop` 递归实现：B 的 `runToolLoop` 内调 `send_to_agent(C)` → 又入 `sendMessage` → C 的 `runToolLoop`
- `nestingDepth` 在 `agent-messaging.js:371` 每层 +1，到 5 拒绝
- 每层嵌套占用目标 Agent 的队列槽位，A 等 B 时 A 的队列槽位也占用（A 的 tool-loop 在 await）
- 无死锁检测（仅有循环检测），A→B→A 会被 `detectCycle` 拦截，但 A→B→C→A 在 callChain 中会被检测到

### 3.6 可观测性缺失

| 缺失项 | 影响 |
|--------|------|
| 无 traceId 跨 Agent 传递 | `sendMessage` 的 `callChain` 只记录 Agent ID 序列，无统一 traceId，无法关联一次用户请求衍生的所有 Agent 通信 |
| 无消息时序日志 | 通信记录只有 `createdAt`/`respondedAt`，无跨 Agent 因果链时间线 |
| 无队列深度监控 | `MessageQueue.getQueueLength`（`message-queue.js:169`）存在但未对外暴露到 Dashboard |
| 无超时统计 | `withTimeout` 超时后只 log error，无聚合统计 |

### 3.7 背压控制缺失

- `message-queue.js:67`：队列满（32）时 `reject` 新消息，但调用方只收到 error，无重试/降级策略
- 无全局并发上限：N 个 Agent 同时发消息给 M 个 Agent，每目标 Agent 队列最多 32，但无全局节流
- 部门群聊有速率限制（`department-group.js:60-75`），但点对点 `send_to_agent` 无任何速率限制

---

## 4. 主流多 Agent 通信模式对比

| 模式 | 代表系统 | 通信机制 | 并发模型 | 阻塞特性 | 状态管理 | 可观测性 | 扩展性 |
|------|---------|---------|---------|---------|---------|---------|--------|
| **Claude Code 子代理** | Claude Code CLI | 主代理派任务给子代理，子代理独立进程执行后返回结果 | 子代理独立 context，并行 spawn | 非阻塞（可 fire-and-forget 或 await） | 每子代理独立 context，无共享状态 | 子代理输出回灌主代理 | 适合2-10子代理，更多需编排层 |
| **Hermes delegate_task** | Hermes Agent | 父代理派 N 个子代理并行执行，每子代理独立 context | 并行（N 个独立 session） | 非阻塞，结果回灌 | 每子代理独立 session，父聚合结果 | session_search 可追溯 | 适合 N 个独立任务并行 |
| **Actor 模型** | Akka/Erlang | 每个 Actor 独立邮箱，消息异步传递 | 每 Actor 串行处理自身邮箱，多 Actor 并行 | 完全非阻塞 | 每 Actor 独立状态，无共享内存 | 消息追踪 + 因果链 | 极强，百万级 Actor |
| **Event-driven 总线** | Event Hub/NATS | 发布/订阅事件总线 | 事件消费者并行 | 非阻塞 | 事件溯源 + 快照 | 事件链可重放 | 强，水平扩展 |
| **Round-robin 调度** | Celery/消息队列 | 中央调度器分配消息给 Worker | Worker 并行消费 | 非阻塞（消息队列解耦） | 任务状态机 | 任务 ID 追踪 | 强，Worker 可水平扩展 |
| **SoloForge 当前** | — | 同步函数调用 + 每Agent串行队列 | 串行（工具调用 for...of await） | 强阻塞（await 等回复） | 全局共享数组 + 磁盘 | 仅 createdAt 时间戳 | 弱（全局数组 O(n) 扫描） |

### 4.1 Claude Code 模式详解

Claude Code 的子代理模式核心特征：
- **独立 context**：每子代理有独立的 conversation history，不污染主代理上下文
- **fire-and-forget**：主代理 spawn 子代理后可继续工作，子代理完成后结果回灌
- **无 Agent 间直接通信**：子代理之间不互相发消息，只对主代理负责
- **进程级隔离**：子代理是独立进程/会话，崩溃不影响主代理

### 4.2 Hermes delegate_task 模式详解

Hermes Agent 的 `delegate_task` 模式核心特征：
- **并行派发**：父代理可一次派 N 个子代理，每个独立 session 并行执行
- **独立 context + 独立 session**：每子代理有完整独立会话，结果通过 session 隔离
- **结果聚合**：父代理等待全部/部分子代理完成后聚合结果
- **session_search 可追溯**：所有子代理会话存储在 session DB，可 FTS5 检索

### 4.3 SoloForge 当前 vs 主流模式差距

| 维度 | Claude Code/Hermes | SoloForge 当前 | 差距 |
|------|-------------------|---------------|------|
| 并发 | 子代理并行独立执行 | 工具调用串行 `for...of await` | 无法并行派多Agent |
| 阻塞 | fire-and-forget 可选 | `send_to_agent` 强制同步等待 | 调用方阻塞 |
| context 隔离 | 子代理独立 context | 共享全局 messages[] + 磁盘 | 无隔离，O(n)扫描 |
| 错误传播 | 子代理失败不影响主 | 超时不取消底层 + 队列占用 | 级联阻塞 |
| 可观测性 | session 可检索 | 仅 createdAt 时间戳 | 无 traceId |
| 扩展性 | 可水平扩展 | 全局单例 + 内存数组 | 不可水平扩展 |

---

## 5. 推荐架构设计

### 5.1 目标

- 支撑 100+ Agent 同时在线
- 支撑 1000+ 并发消息
- 支撑 Agent 链式调用（深度≤10）
- 支撑 Agent 群聊广播（1→N 并行触发）
- 支撑 Agent 工具调用嵌套（A→B→C 并行）
- 具备 traceId 跨 Agent 追踪
- 具备背压控制

### 5.2 推荐架构：Actor 模型 + 事件总线 + 消息队列

```
┌─────────────────────────────────────────────────────────────────┐
│  主进程                                                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  MessageBus (事件总线) — 新增核心组件                      │   │
│  │  ├ publish(event) — 发布事件                              │   │
│  │  ├ subscribe(agentId, handler) — Agent 订阅自身邮箱        │   │
│  │  ├ request(reqId, target, msg, timeout) — 请求-响应模式    │   │
│  │  └ traceId 透传 — 每条消息携带 traceId + parentSpanId      │   │
│  └──────────────────────────────────────────────────────────┘   │
│         │ subscribe                                      │ pub   │
│         ▼                                                │       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          ┌──────┴──┐ │
│  │ Agent A  │  │ Agent B  │  │ Agent C  │  ...    │ Agent N │ │
│  │ (Actor)  │  │ (Actor)  │  │ (Actor)  │          │ (Actor) │ │
│  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │          │┌──────┐ │ │
│  │ │Mailbox│ │  │ │Mailbox│ │  │ │Mailbox│ │          ││Mailbox│ │
│  │ │(队列) │ │  │ │(队列) │ │  │ │(队列) │ │          ││(队列) │ │
│  │ └──┬───┘ │  │ └──┬───┘ │  │ └──┬───┘ │          │└──┬───┘ │ │
│  │    ▼     │  │    ▼     │  │    ▼     │          │   ▼     │ │
│  │ runToolLp│  │ runToolLp│  │ runToolLp│          │runToolLp│ │
│  └──────────┘  └──────────┘  └──────────┘          └─────────┘ │
│         │ send_to_agent → MessageBus.publish                     │
│         │ delegate_task → MessageBus.publish (fire-and-forget)   │
│         │ post_to_department → MessageBus.publish (广播)          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  TraceStore (新增) — 跨 Agent 追踪                         │   │
│  │  ├ spans[]: {traceId, spanId, parentSpanId, agentId, ...} │   │
│  │  └ getTrace(traceId) → 完整因果链                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  BackpressureController (新增) — 背压控制                   │   │
│  │  ├ 全局并发上限 (semaphore)                                │   │
│  │  ├ 每Agent 队列上限 + 溢出降级                              │
│  │  └ 速率限制 (令牌桶)                                       │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 核心设计要点

#### 5.3.1 Actor 模型 — 每 Agent 独立邮箱

**现状**：`MessageQueue`（`message-queue.js`）已有每 Agent 串行队列雏形，但：
- 队列任务是闭包 `executeTask`（`agent-messaging.js:380`），非消息对象
- `sendMessage` 强制 `await` 队列结果，调用方阻塞

**改造**：
- Agent 邮箱接收**消息对象**（非闭包），消息带 `traceId`、`replyTo`、`mode`（sync/async）
- Agent 自主从邮箱取消息执行（已有串行保证），执行完通过 `MessageBus.publish(reply)` 回复
- `send_to_agent` 可选 sync 模式（`await MessageBus.request()`）或 async 模式（`MessageBus.publish` fire-and-forget）
- 邮箱满时触发背压降级（拒绝 + 提示重试 / 降级到短回复）

```javascript
// 伪代码
class AgentMailbox {
  constructor(agentId, capacity = 64) {
    this.agentId = agentId;
    this.queue = []; // 消息对象，非闭包
    this.capacity = capacity;
    this.processing = false;
    this.pendingReplies = new Map(); // reqId → {resolve, reject, timer}
  }
  deliver(message) {
    if (this.queue.length >= this.capacity) {
      return { delivered: false, reason: 'mailbox_full' };
    }
    this.queue.push(message);
    this._process();
    return { delivered: true };
  }
  async _process() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const msg = this.queue.shift();
      const result = await runToolLoop(msg.target, msg.content, msg.history, msg.context);
      MessageBus.publish({ type: 'reply', reqId: msg.reqId, from: this.agentId, result, traceId: msg.traceId });
    }
    this.processing = false;
  }
}
```

#### 5.3.2 事件总线 — 解耦同步阻塞

**现状**：`sendMessage` 直接 `await queue.enqueue(executeTask)`，调用方阻塞。

**改造**：
- `MessageBus` 提供三种语义：
  - `publish(event)` — fire-and-forget，不阻塞
  - `request(reqId, target, msg, timeout)` — 请求-响应，await 回复但有超时
  - `broadcast(event, targets)` — 1→N 并行投递
- Agent 通过 `subscribe(agentId, handler)` 订阅自身邮箱
- 回复通过 `reqId` 关联，调用方可选 await 或不 await

```javascript
// send_to_agent 改造后
async execute(args, context) {
  const { target_agent, message, mode = 'sync' } = args; // 新增 mode 参数
  const { agentId, traceId, callChain } = context;
  
  if (mode === 'async') {
    // fire-and-forget：不等回复，立即返回
    MessageBus.publish({
      type: 'agent_message', from: agentId, to: target_agent,
      content: message, traceId, callChain, mode: 'async'
    });
    return { success: true, message: '已异步发送，对方稍后回复' };
  }
  
  // sync 模式：request-response
  const result = await MessageBus.request({
    from: agentId, to: target_agent, content: message,
    traceId, callChain, timeout: 120000
  });
  return { success: true, response: result.response };
}
```

#### 5.3.3 并行工具调用

**现状**：`tool-executor.js:768-802` 的 `executeToolCalls` 串行 `for...of await`。

**改造**：
- 通信类工具（`send_to_agent` async 模式、`post_to_department`、`delegate_task` async）可并行
- 计算类工具（文件/shell/git）保持串行（避免并发副作用）
- 用 `Promise.all` 并行执行通信类工具

```javascript
async executeToolCalls(toolCalls, context, onProgress) {
  // 分组：通信类(可并行) vs 计算类(串行)
  const commTools = new Set(['send_to_agent', 'post_to_department', 'delegate_task', 'notify_boss']);
  const parallel = [];
  const serial = [];
  for (const call of toolCalls) {
    if (commTools.has(call.name) && call.arguments.mode !== 'sync') {
      parallel.push(call);
    } else {
      serial.push(call);
    }
  }
  
  // 并行执行通信类
  const parallelResults = await Promise.all(
    parallel.map(call => this.executeTool(call.name, call.arguments, context))
  );
  // 串行执行计算类
  const serialResults = [];
  for (const call of serial) {
    serialResults.push(await this.executeTool(call.name, call.arguments, context));
  }
  return [...parallelResults, ...serialResults];
}
```

#### 5.3.4 traceId 跨 Agent 传递

**现状**：`callChain` 只记录 Agent ID 序列，无统一 traceId。

**改造**：
- 用户请求入口生成 `traceId`（`chat-manager.handleStreamMessage`）
- `traceId` 通过 `context` 透传给所有工具调用
- 每次 `send_to_agent`/`delegate_task` 生成 `spanId`，关联 `parentSpanId`
- `TraceStore` 存储所有 span，支持 `getTrace(traceId)` 查询完整因果链

```javascript
// chat-manager.handleStreamMessage 入口
const traceId = generateTraceId();
const context = { conversationId, messageId, traceId, spanId: generateSpanId() };

// send_to_agent 透传
MessageBus.request({ ..., traceId, parentSpanId: context.spanId, spanId: generateSpanId() });

// TraceStore
class TraceStore {
  recordSpan({ traceId, spanId, parentSpanId, fromAgent, toAgent, type, startTime, endTime, status }) {
    this.spans.push({ traceId, spanId, parentSpanId, fromAgent, toAgent, type, startTime, endTime, status });
  }
  getTrace(traceId) {
    return this.spans.filter(s => s.traceId === traceId).sort((a,b) => a.startTime - b.startTime);
  }
}
```

#### 5.3.5 背压控制

**现状**：仅有队列长度上限（32）和部门群聊速率限制。

**改造**：
- 全局并发上限（Semaphore）：限制同时进行的 LLM 调用数（防止 API rate limit）
- 每Agent 队列上限 + 溢出降级：满时返回提示而非 error，调用方可降级为短回复
- 令牌桶速率限制：每 Agent 每秒最大消息数
- 部门群聊广播时，被 @ 的 Agent 并行触发（而非渲染进程串行 await）

#### 5.3.6 部门群聊广播并行化

**现状**：`useChatAgent.js:275-321` 的 `handleGroupChat` 串行 `await sendToSingleAgent`。

**改造**：
- 将 `handleGroupChat` 的连锁触发逻辑移到主进程（`department-group.js`）
- 被 @ 的 Agent 并行投递消息到各自邮箱（`Promise.all` + `MessageBus.publish`）
- 渲染进程只负责显示，不负责编排触发

```javascript
// department-group.js 改造后
async postToDepartmentAndTrigger(departmentId, senderId, content, mentions) {
  // ... 校验 + 过滤 ...
  const effectiveMentions = filterMentions(departmentId, senderId, mentions);
  
  // 并行投递到被 @ 的 Agent 邮箱
  const deliverResults = await Promise.all(
    effectiveMentions.map(targetId =>
      MessageBus.publish({
        type: 'dept_message', from: senderId, to: targetId,
        content, departmentId, traceId, mode: 'async'
      })
    )
  );
  
  // IPC 推送显示到渲染进程
  webContents.send(CHANNELS.CHAT_DEPT_GROUP_MESSAGE, { ... });
}
```

### 5.4 推荐架构消息流图

```
用户 → secretary: "通知4位员工开会"
  │ traceId = T1, spanId = S0
  ▼
secretary runToolLoop (traceId=T1)
  │ 解析出 4 个 post_to_department 调用 (或 1 个广播 + 4 个 @)
  ▼
toolExecutor.executeToolCalls (并行模式)
  │ Promise.all([
  │   MessageBus.publish({to:emp1, traceId:T1, spanId:S1, mode:async}),
  │   MessageBus.publish({to:emp2, traceId:T1, spanId:S2, mode:async}),
  │   MessageBus.publish({to:emp3, traceId:T1, spanId:S3, mode:async}),
  │   MessageBus.publish({to:emp4, traceId:T1, spanId:S4, mode:async}),
  │ ])
  ▼
MessageBus 并行投递到 4 个 AgentMailbox
  ├→ emp1 Mailbox → emp1 runToolLoop → 回复 publish(reply, traceId=T1, spanId=S1)
  ├→ emp2 Mailbox → emp2 runToolLoop → 回复 publish(reply, traceId=T1, spanId=S2)
  ├→ emp3 Mailbox → emp3 runToolLoop → 回复 publish(reply, traceId=T1, spanId=S3)
  └→ emp4 Mailbox → emp4 runToolLoop → 回复 publish(reply, traceId=T1, spanId=S4)
       (4 个并行执行，互不阻塞)
  ▼
TraceStore 记录所有 span
  getTrace(T1) → [S0(secretary), S1(emp1), S2(emp2), S3(emp3), S4(emp4), ...replies]
  ▼
secretary 收到 4 个异步完成通知 → 聚合汇报给用户
```

---

## 6. 迁移路径

### 阶段1：修复"只收到1位回复"（1-2天，低风险）

**不改架构，只修根因**：

1. **修复秘书单委派**：`secretary-agent.js:26-60` 的 `analyzeForDelegation` 改为可返回多个目标，或移除私聊强制委派逻辑（`chat-manager.js:422-448`），让秘书自主用 `send_to_agent`/`post_to_department`
2. **工具调用并行化（通信类）**：`tool-executor.js:768-802` 的 `executeToolCalls` 改为通信类工具 `Promise.all` 并行
3. **部门群聊触发移主进程**：`useChatAgent.js:275-321` 的 `handleGroupChat` 连锁触发逻辑移到 `department-group.js`，用 `Promise.all` 并行投递
4. **增加 mode 参数**：`send_to_agent` 新增 `mode: 'sync'|'async'` 参数，LLM 可选择异步发送不等回复

### 阶段2：引入 MessageBus + Actor 邮箱（1-2周，中风险）

1. **新增 `src/main/collaboration/message-bus.js`**：实现 publish/subscribe/request/broadcast
2. **重构 `message-queue.js`**：从闭包队列改为消息对象队列，Agent 自主消费
3. **重构 `agent-messaging.js:sendMessage`**：基于 MessageBus 实现，支持 sync/async 两种模式
4. **保持对外接口兼容**：`agent-communication.js` 的导出方法签名不变，内部转调 MessageBus

### 阶段3：引入 traceId + TraceStore（3-5天，低风险）

1. **新增 `src/main/collaboration/trace-store.js`**：span 存储 + trace 查询
2. **`chat-manager.handleStreamMessage` 入口生成 traceId**，通过 context 透传
3. **所有通信工具透传 traceId**：`send_to_agent`/`delegate_task`/`post_to_department`
4. **Dashboard 新增 Trace 查看**：可视化跨 Agent 通信链

### 阶段4：背压控制 + 全局并发（1周，中风险）

1. **新增 `src/main/collaboration/backpressure-controller.js`**：Semaphore + 令牌桶
2. **全局 LLM 调用并发上限**：防止 API rate limit
3. **队列溢出降级**：满时返回短提示而非 error
4. **部门群聊速率限制参数化**：`department-group.js:29-30` 常量改为可配置

### 阶段5：历史记录索引化（1-2周，中风险）

1. **`agent-communication.js:58` 的 `messages[]` 改为按 AgentPair 索引**：`Map<agentPairKey, message[]>`
2. **`getPairwiseHistory` 从 O(n) 扫描改为 O(1) 查找**
3. **磁盘持久化增量写**：只写新增消息，不全量序列化

---

## 7. 关键文件改动清单

### 阶段1（修复根因，低风险）

| 文件 | 行号 | 改动 |
|------|------|------|
| `src/main/chat/secretary-agent.js` | 26-60 | `analyzeForDelegation` 支持返回多目标数组，或移除强制单委派 |
| `src/main/chat/chat-manager.js` | 422-448 | 秘书私聊委派逻辑：支持委派给多人，或让秘书自主选择工具 |
| `src/main/tools/tool-executor.js` | 768-802 | `executeToolCalls`：通信类工具 `Promise.all` 并行，计算类保持串行 |
| `src/main/tools/collaboration-tools.js` | 21-118 | `send_to_agent` 新增 `mode` 参数（sync/async） |
| `src/main/tools/collaboration-tools.js` | 180-294 | `delegate_task` async 模式返回 taskId 不阻塞 |
| `src/renderer/hooks/useChatAgent.js` | 275-321 | `handleGroupChat` 连锁触发逻辑移主进程，渲染进程只显示 |
| `src/main/chat/department-group.js` | 440-525 | `postToDepartment` 内增加并行触发被 @ Agent 逻辑 |

### 阶段2（MessageBus + Actor，中风险）

| 文件 | 改动 |
|------|------|
| `src/main/collaboration/message-bus.js` | **新增**：publish/subscribe/request/broadcast |
| `src/main/collaboration/message-queue.js` | 重构：闭包队列 → 消息对象队列，Agent 自主消费 |
| `src/main/collaboration/agent-messaging.js` | 302-504 `sendMessage` 重构：基于 MessageBus，支持 sync/async |
| `src/main/collaboration/agent-communication.js` | 288-366 导出方法：内部转调 MessageBus，对外接口不变 |
| `src/main/agents/tool-loop-runner.js` | 124-624：增加 traceId 透传、Actor 邮箱消费回调 |

### 阶段3（traceId + TraceStore，低风险）

| 文件 | 改动 |
|------|------|
| `src/main/collaboration/trace-store.js` | **新增**：span 存储 + trace 查询 |
| `src/main/chat/chat-manager.js` | 474-600 `handleStreamMessage`：入口生成 traceId |
| `src/main/tools/collaboration-tools.js` | 所有通信工具：透传 traceId/spanId |
| `src/main/collaboration/agent-messaging.js` | `sendMessage` 记录 span 到 TraceStore |

### 阶段4（背压控制，中风险）

| 文件 | 改动 |
|------|------|
| `src/main/collaboration/backpressure-controller.js` | **新增**：Semaphore + 令牌桶 |
| `src/main/collaboration/message-queue.js` | 67-72 队列满时降级而非 reject |
| `src/main/chat/department-group.js` | 25-30 速率限制常量改为可配置 |

### 阶段5（历史索引化，中风险）

| 文件 | 改动 |
|------|------|
| `src/main/collaboration/agent-communication.js` | 58 `messages[]` 改为 `Map<agentPairKey, message[]>` |
| `src/main/collaboration/agent-messaging.js` | 77-100 `getPairwiseHistory` 改为 O(1) 查找 |
| `src/main/collaboration/agent-communication.js` | 152-168 `_doSave` 增量写 |

---

## 附录：关键常量一览

| 常量 | 文件:行号 | 当前值 | 建议值 |
|------|----------|--------|--------|
| `DEFAULT_MAX_QUEUE_LENGTH` | `message-queue.js:23` | 32 | 64（Actor 邮箱容量） |
| `MAX_NESTING_DEPTH` | `agent-messaging.js:34` | 5 | 10 |
| `DEFAULT_TIMEOUT_MS` | `agent-messaging.js:35` | 120000 (2min) | 可配置，async 模式不设 |
| `DELEGATE_TIMEOUT_MS` | `task-delegation.js:28` | 300000 (5min) | 可配置 |
| `AGENT_COOLDOWN_MS` | `department-group.js:25` | 30000 (30s) | 可配置 |
| `GROUP_RATE_LIMIT_MAX` | `department-group.js:30` | 3/10s | 可配置 |
| `DEFAULT_MAX_ITERATIONS` | `tool-loop-runner.js:45` | 100 | 保持 |
| `MAX_CHAIN_ROUNDS` | `chat-agent-logic.js` (renderer) | (未读) | 建议提升到 10 |

---

## 总结

SoloForge 当前多 Agent 通信架构的核心问题是**同步阻塞 + 串行执行 + 缺乏并行编排**：

1. **"只收到1位回复"** 的直接根因是秘书 `analyzeForDelegation` 只委派给 1 人 + 工具调用串行 await，次要根因是部门群聊触发在渲染进程串行 + 冷却过滤。

2. **无法支撑大规模** 的核心瓶颈是：全局共享 `messages[]` 数组的 O(n) 扫描、工具调用串行 `for...of await`、每 Agent 串行队列阻塞调用方、无全局并发控制。

3. **推荐架构** 为 Actor 模型 + 事件总线：每 Agent 独立邮箱消费消息对象，MessageBus 提供 publish/request/broadcast 三种语义，通信类工具并行执行，traceId 跨 Agent 透传，背压控制器防止消息洪泛。

4. **迁移路径** 分 5 阶段：先修复根因（1-2天），再引入 MessageBus（1-2周），再加 traceId（3-5天），然后背压控制（1周），最后历史索引化（1-2周）。
