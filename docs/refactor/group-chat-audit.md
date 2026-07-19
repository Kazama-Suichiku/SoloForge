# SoloForge 群聊 / 部门群聊通信机制审计与重设计报告

> 调研范围：`src/main/chat/department-group.js`、`src/main/chat-ipc-handlers.js`、`src/main/tools/collaboration-tools.js`、`src/renderer/hooks/useChatAgent.js`、`src/renderer/hooks/useAgentIpcEvents.js`、`src/renderer/hooks/chat-agent-logic.js`、`src/renderer/store/chat-store.js`、`src/renderer/components/chat/{ConversationList,ChatView,ChatInput}.jsx`、`src/shared/ipc-channels.js`、`src/preload/preload.js`、`src/main/chat/chat-manager.js`、`src/main/chat/collaboration-prompt.js`、`src/main/tools/permission-checker.js`、`src/main/agent-factory/dynamic-agent.js`、`src/main/company-switch.js`。
> 不修改任何代码，只产出本报告。

---

## 1. 当前群聊架构分析

### 1.1 群聊的两种形态

SoloForge 实际上存在**两套并行的"群聊"**，且实现方式截然不同：

| 类型 | conversation.type | 创建方式 | 路由核心 | 持久化 |
|---|---|---|---|---|
| 部门群聊 | `'department'` | 后端 `ensureDepartmentGroup` 在员工入职/公司切换时自动建群（`dynamic-agent.js:182`、`company-switch.js:176`），群 ID = `dept-${departmentId}` | `department-group.js` 的 `postToDepartment` | 前端 `chat-store` + 文件 |
| 临时群聊 | `'group'` | Agent 通过 `create_group_chat` 工具拉群（`collaboration-tools.js:954`），群 ID = `group-${ts}-${rand}` | `chat-manager.js:235 createGroupFromBackend` 直接 `webContents.send` | 前端 `chat-store` + 文件 |

两者在渲染层共用同一个 `chat-store`（`messagesByConversation: Map<conversationId, Message[]>`），但主进程侧**只有部门群聊有专门的路由/冷却/速率限制逻辑**；临时群聊没有 `postToGroup` 工具，Agent 在临时群里没有工具化的发消息通道，只能靠被 @ 后由渲染层 `handleGroupChat` 连锁触发。

### 1.2 消息流图

```
┌──────────────────── 用户消息路径 ────────────────────┐
ChatView.jsx handleSend ──► ChatInput onSend
   └─► (App.jsx) onSendMessage = useChatAgent.sendToAgent
        └─► useChatAgent.js sendToAgent(conversationId, content)
             ├─ type==='private'  → sendToSingleAgent(单 Agent 流式)
             └─ type==='group'/'department'
                  → handleGroupChat(conversationId, conversation, agentIds, content)
                       ├─ extractMentions(content)  → 若无人被@，直接 return（无人回复）
                       └─ while round < MAX_CHAIN_ROUNDS(=5):
                            ├─ sortByLevel(pendingAgents)   ← level 小的先发言
                            └─ for (const {id} of sorted) {  ← 串行 await
                                 ├─ repliedAgents.add(id)    ← 一旦回复过就不能再被点名
                                 ├─ await sendToSingleAgent(...)   ← 阻塞，流式完才进下一个
                                 ├─ findLatestAgentReply → filterNewMentions
                                 └─ nextPending.push(...newMentions)
                            }
                            pendingAgents = nextPending

┌──────────────────── Agent 消息路径（部门群聊） ───────┐
Agent 调用工具 post_to_department(content, mention)
   └─► collaboration-tools.js:1377 postToDepartmentTool.execute
        └─► department-group.js postToDepartment(deptId, senderId, content, mentions)
             ├─ canAgentPostInGroup(senderId, groupId)   ← 强制路由1：发送者必须属本部门
             ├─ isGroupRateLimited(groupId)              ← 10s 内 ≥3 条 → 拒
             ├─ filterMentionsToMembers(...)             ← 强制路由2：@ 只能本部门成员
             ├─ filterCooldownMentions(groupId, mentions) ← 冷却过滤（记录触发时刻）
             └─ webContents.send(CHAT_DEPT_GROUP_MESSAGE, {mentions: effectiveMentions})

         渲染进程 useAgentIpcEvents.js onDeptGroupMessage(data)
            ├─ sendMessage(...) 进 store（UI 落地）
            └─ if mentions.length > 0:
                 ├─ 再做一次 participants / 前端冷却双重保险
                 ├─ buildDeptTriggerContent = `[senderName]: content\n\n（被点名的同事：@id1 @id2）`
                 └─ await handleGroupChat(groupId, conversation, agentIds, triggerContent)
                      ↑ 与用户消息路径汇合，走同一套连锁逻辑
```

### 1.3 关键文件:行号索引

| 职责 | 位置 |
|---|---|
| 冷却/速率限制常量 | `src/main/chat/department-group.js:25-30` |
| 冷却判定/记录 | `department-group.js:38-53` (`isAgentOnCooldown`/`recordAgentTrigger`) |
| 速率限制 | `department-group.js:60-75` (`isGroupRateLimited`) |
| mentions 冷却过滤 | `department-group.js:83-97` (`filterCooldownMentions`) |
| 发送者跨部门校验 | `department-group.js:233-270` (`canAgentPostInGroup`) |
| mentions 成员过滤 | `department-group.js:281-329` (`filterMentionsToMembers`) |
| 建群 | `department-group.js:338-372` (`ensureDepartmentGroup`) |
| 发消息主流程 | `department-group.js:440-525` (`postToDepartment`) |
| 群列表 | `department-group.js:558-615` (`getAllDepartmentGroups`) |
| IPC 发送 handler | `src/main/chat-ipc-handlers.js:141-182` (`chat:dept-group-post`) |
| `post_to_department` 工具 | `src/main/tools/collaboration-tools.js:1377-1457` |
| `create_group_chat` 工具 | `collaboration-tools.js:954-1072` |
| `rename_department_group` 工具 | `collaboration-tools.js:1462-1520` |
| 临时群创建（主进程） | `src/main/chat/chat-manager.js:235-262` (`createGroupFromBackend`) |
| 渲染层连锁核心 | `src/renderer/hooks/useChatAgent.js:222-333` (`handleGroupChat`) |
| 渲染层纯函数 | `src/renderer/hooks/chat-agent-logic.js` 全文 |
| IPC 事件订阅 | `src/renderer/hooks/useAgentIpcEvents.js:284-350` (`onDeptGroupMessage`) |
| 群聊消息存储 | `src/renderer/store/chat-store.js:280-379` (`createGroupChat`/`createDepartmentChat`) |
| 群聊列表 UI | `src/renderer/components/chat/ConversationList.jsx:484-546,691-746` |
| 输入框 @mention | `src/renderer/components/chat/ChatInput.jsx:152-250`、`mention-helper.js` |
| IPC 通道定义 | `src/shared/ipc-channels.js:66-79` |
| preload 暴露 | `src/preload/preload.js:108-112,237-286` |
| 协作提示词 | `src/main/chat/collaboration-prompt.js:24,195-208,273,302,356` |
| 权限放行 | `src/main/tools/permission-checker.js:500-509` |
| 入职触发建群 | `src/main/agent-factory/dynamic-agent.js:182-200` |
| 公司切换建群 | `src/main/company-switch.js:176,226,239` |

---

## 2. 群聊创建 / 消息路由 / 触发回复 完整流程

### 2.1 群聊怎么创建

**部门群聊**（被动、系统驱动）：
- `agent-factory/dynamic-agent.js:182` 新员工入职时，若员工属于某 CXO 的部门且有同事，调用 `ensureDepartmentGroup(departmentId, cxoId)`；随后 `addMemberToGroup`。
- `company-switch.js:176` 切换公司时，为每个有下属的 CXO 重建群聊，并对每位员工逐个 `addMemberToGroup` / `removeMemberFromGroup`。
- `ensureDepartmentGroup`（`department-group.js:338`）只做一件事：`webContents.send(CHAT_DEPT_GROUP_CREATE, {groupId, departmentId, ownerId, name, participants})`。**它本身不持久化任何状态**——群的存在性完全由渲染层 `chat-store.createDepartmentChat`（`chat-store.js:321`）维护。主进程侧没有"群对象"内存态。
- 启动时前端还会通过 `getAllDepartmentGroups`（`useAgentIpcEvents.js:211-238`）主动拉取一次，保证窗口刷新后群列表恢复。

**临时群聊**（主动、Agent 驱动）：
- Agent 调用 `create_group_chat` 工具（`collaboration-tools.js:954`），经 `chatManager.createGroupFromBackend`（`chat-manager.js:235`）→ `webContents.send(CHAT_CREATE_GROUP)` → 渲染层 `onCreateGroup`（`useAgentIpcEvents.js:181-208`）→ `createGroupChat`。
- 前端用户也可以点右上角 "+" 创建（`ConversationList.jsx:596` 按钮 `onNewChat`）。

### 2.2 消息怎么路由

存在**两条物理上分离的路由通道**，共用渲染层 `handleGroupChat` 作为终端：

1. **用户消息**：`ChatView.handleSend` → `useChatAgent.sendToAgent` → 按 `conversation.type` 分流。群聊走 `handleGroupChat`，**不经过任何主进程冷却/速率限制**，直接 `sendToSingleAgent` → `window.soloforge.chat.sendMessageStream` IPC 到主进程 `handleStreamMessage`（`chat-manager.js:474`）。
2. **Agent 消息**（部门群聊）：`post_to_department` 工具 → `department-group.postToDepartment`，过发送者校验 + 速率限制 + mentions 成员过滤 + 冷却过滤 → `webContents.send(CHAT_DEPT_GROUP_MESSAGE)` → 渲染层 `onDeptGroupMessage` → 先 `sendMessage` 落 UI，再若有 mentions 则构造 `triggerContent` 调 `handleGroupChat`。

这意味着：**用户在群里发消息时，主进程的冷却/速率限制完全不生效**（用户路径根本不经过 `postToDepartment`）。只有 Agent 用 `post_to_department` 工具发言时才走限制逻辑。临时群聊则**连 Agent 也没有发消息工具**——Agent 在临时群里只能在被 @ 后被动回复，无法主动发起新消息。

### 2.3 被 @ 的 Agent 怎么触发回复（串行还是并行）

**串行**。`useChatAgent.js:275` 的 `for (const { id: targetAgent } of sorted)` 内部是 `await sendToSingleAgent(...)`（`useChatAgent.js:295`），每个 Agent 必须完整流式输出后下一个才开始。同轮内按 `sortByLevel`（`chat-agent-logic.js:205`）排序——level 数值小（C-Level）的先发言。

连锁机制：每个 Agent 回复后，`findLatestAgentReply`（`chat-agent-logic.js:171`）取出其回复，`filterNewMentions`（`chat-agent-logic.js:187`）提取其中新 @ 的人，`filterNewMentions` 会**排除已在 `repliedAgents` 集合中的人和当前回复者本人**，剩下的人进入下一轮 `nextPending`。整个链最多 `MAX_CHAIN_ROUNDS = 5` 轮（`chat-agent-logic.js:18`）。

### 2.4 冷却机制怎么工作

**双份冷却**，两边都是 30 秒，但 key 和触发点不同：

- **后端**（`department-group.js:25,38-53`）：`AGENT_COOLDOWN_MS = 30s`，key = `${groupId}:${agentId}`。在 `filterCooldownMentions`（`department-group.js:83`）里**在判断"有效"的同时立刻 `recordAgentTrigger`**——即冷却时钟从"被尝试 @ 的那一刻"开始计，而不是从"实际回复完成"开始计。被冷却的 mention 不会发给前端。
- **前端**（`chat-agent-logic.js:12` + `useChatAgent.js:64-79`）：`DEPT_COOLDOWN_MS = 30s`，key = `${conversationId}:${agentId}`，在 `onDeptGroupMessage`（`useAgentIpcEvents.js:316`）里再过一遍，作为"双重保险"。

注意：用户在群里 @ 某人时**不触发后端冷却**（因为不经过 `postToDepartment`），但前端的 `onDeptGroupMessage` 只在 Agent 发的消息上触发——用户消息直接进 `handleGroupChat`，也不走前端 `onDeptGroupMessage`。**结论：用户触发的群聊连锁完全绕过两套冷却。**

### 2.5 速率限制怎么工作

`department-group.js:28-30,60-75`：`GROUP_RATE_LIMIT_MAX = 3`，`GROUP_RATE_LIMIT_WINDOW = 10s`，key = `groupId`，**在 `postToDepartment` 顶部硬切**（`department-group.js:468`）——超出即返回 `{success:false, error:'消息发送过于频繁，请稍后再试（每 10 秒最多 3 条消息）'}`。该限制只对 Agent 的 `post_to_department` 生效；用户消息、临时群聊、连锁触发的回复都不计数。

### 2.6 群聊消息存在哪、怎么持久化

统一在前端 `chat-store` 的 `messagesByConversation`（`chat-store.js:166`），按 `conversationId` 分桶（私聊 `private-${agentId}`、部门群 `dept-${deptId}`、临时群 `group-...`）。持久化走 `ipcFileStorage`（`chat-store.js:107-155`）：经 IPC `setChatHistory` 由主进程 `fs.writeFileSync` 落盘到 `~/.soloforge/chat-history.json`，带 2 秒防抖。

**关键点**：主进程侧不存储群聊消息。Agent 每次回复时，由渲染层 `buildHistoryFromMessages`（`chat-agent-logic.js:151`）从 `messagesByConversation` 取最近 20 条非删除消息，作为 `history` 参数随 `sendMessageStream` 一起传给主进程。主进程的 `handleStreamMessage`（`chat-manager.js:474`）再 `getPaginatedHistory` / `_cleanHistoryForLLM`。即**群聊上下文是渲染层推送式供给主进程的**，主进程没有群聊历史的查询能力。

### 2.7 Agent 在群聊里能 @ 别人吗？mentions 怎么处理

能。`extractMentions`（`chat-agent-logic.js:28`）同时识别 `@agentId` 和 `@人名`（靠 `nameToId` Map）。Agent 回复后 `filterNewMentions` 提取新 @，进入 `nextPending`。

@ 的语义是**强制触发**而非"提示性通知"：`handleGroupChat` 里 `initialMentions.length === 0` 时直接 `return`（`useChatAgent.js:250-253`），即用户在群里发消息**必须 @ 某人否则无人回复**——消息会显示在 UI 但没有任何 Agent 响应。

### 2.8 群聊和私聊消息是同一个 store 吗

是。`chat-store.js` 一个 store 管所有类型，靠 `conversation.type` 区分。私聊 ID `private-${agentId}` 与 Agent 1:1 绑定（`chat-store.js:210`），部门和临时群各自独立 ID。`deleteConversation`（`chat-store.js:468`）禁止删除私聊和部门群，只允许删临时群。

### 2.9 用户在群聊发消息时谁回复

只回**被 @ 的人**，且按 level 排序串行回复。未被 @ 的群成员完全不参与。没有"部门领导先发言"或"所有人围观投票"机制。若一条消息 @ 了 4 个人，4 人依次串行流式回复，且每人都看到前面人的回复（`buildHistoryFromMessages` 实时读最新 store）。

### 2.10 Agent 之间在群里协作

A 在群里 @ B：A 调 `post_to_department(content, mention:[B])` → 后端过滤 → 前端 `onDeptGroupMessage` → `handleGroupChat` → B 回复。若 B 的回复里 @ A，`filterNewMentions` 会发现 A 已在 `repliedAgents`（B 本轮前 A 已回复过）→ 被过滤，**A 不会回第 2 次**。这杜绝了 A↔B 乒乓循环，但代价是**一个连锁链里每人最多只能发言一次**，无法多轮辩论。

---

## 3. 当前问题清单（带文件:行号与严重度）

| # | 问题 | 证据 | 严重度 |
|---|---|---|---|
| P1 | **串行回复导致 UX 阻塞**：@ 4 人必须等 4 个 LLM 流式依次完成，可能数分钟。用户无法中途看到"第 2 个正在思考"以外的并行状态。 | `useChatAgent.js:275-322` `for...of await` | 高 |
| P2 | **用户消息绕过所有节流**：用户在群里 @ 10 人，10 人全部串行触发，无冷却、无速率限制、无轮数以外的保护。 | 用户路径不经 `postToDepartment`；`handleGroupChat` 只靠 `MAX_CHAIN_ROUNDS` | 高 |
| P3 | **临时群聊无 Agent 主动发言工具**：Agent 在 `type:'group'` 群里没有 `post_to_group`，只能在被 @ 后被动回复；`create_group_chat` 创建后无法持续讨论。 | `collaboration-tools.js` 仅有 `post_to_department` | 高 |
| P4 | **冷却计时起点错误**：后端 `filterCooldownMentions` 在判定有效时立即 `recordAgentTrigger`，冷却从"被尝试 @"开始算，而非"回复完成"。一个被 @ 但流式回复耗时 25s 的 Agent，回复刚结束 5s 后再被 @ 就被拒。 | `department-group.js:92` | 中 |
| P5 | **冷却 30s 对部门讨论过激**：4 人被 @ 但有人 30s 内刚在群里活跃过 → 被静默过滤，部门级讨论被切断，且用户不知道谁被过滤了（前端只看到 `mentions` 数组少了人）。 | `department-group.js:25` | 中 |
| P6 | **速率限制 3/10s 对正常协作过严**：4 个 Agent 依次汇报进度，第 4 条被拒。仅防风暴可用，但阈值应可配置。 | `department-group.js:28-30` | 中 |
| P7 | **`repliedAgents` 一次性消费阻断多轮讨论**：`filterNewMentions` 永久排除已回复者，导致 A 说→B 反驳→A 无法澄清。真正的群聊讨论需要允许有限度的二次回应。 | `chat-agent-logic.js:194` `.filter(id => !repliedAgents.has(id))` | 中 |
| P8 | **@ 是强制触发还是提示性无明确定义**：用户不 @ 任何人时 `handleGroupChat` 静默 return，UI 无提示"未 @ 任何人不会触发回复"，用户会困惑。 | `useChatAgent.js:250-253` | 中 |
| P9 | **前后端冷却 key 不同步**：后端 key=`${groupId}:${agentId}`，前端 key=`${conversationId}:${agentId}`。`groupId` 和 `conversationId` 当前恰好相等（都 `dept-${deptId}`），但这是隐式约定，无文档约束。 | `department-group.js:39` vs `useChatAgent.js:77` | 低 |
| P10 | **群聊上下文只取最近 20 条且无主题裁剪**：`buildHistoryFromMessages` 固定 `slice(-20)`（`chat-agent-logic.js:155`），长讨论里早期关键结论丢失；也无按 token 预算裁剪。 | `chat-agent-logic.js:155` | 中 |
| P11 | **主进程无群聊历史查询能力**：Agent 工具里没有"查群聊历史"的工具，Agent 只能依赖渲染层每次推送的 20 条。新加入成员看不到历史。 | `chat-manager.js:474` 依赖前端 history 参数 | 中 |
| P12 | **被过滤的 mention 无 UI 反馈**：后端 `filterCooldownMentions` 过滤的人只写日志（`department-group.js:496`），前端 `onDeptGroupMessage` 收到的 `mentions` 已是裁剪后版本，用户不知道"我 @ 了 A 但 A 在冷却"。 | `department-group.js:507` | 低 |
| P13 | **`ensureDepartmentGroup` 不幂等不持久**：每次调用都 `webContents.send(CREATE)`，前端 `createDepartmentChat` 靠存在性判断幂等（`chat-store.js:326`），但主进程崩溃后无任何群元数据可恢复，完全靠 `getAllDepartmentGroups` 实时算。 | `department-group.js:338` | 低 |
| P14 | **无跨群/跨链全局并发控制**：多个部门群同时触发连锁，各自独立 `while` 循环，可能同时打满 LLM 并发，无全局信号量。 | `useChatAgent.js:260` 无全局锁 | 中 |
| P15 | **`isAgentInDeptCooldown` 前端检查在 `handleGroupChat` 之前**：`onDeptGroupMessage` 里冷却过滤只对 Agent 触发路径生效；同一 `handleGroupChat` 内部连锁（B 回复后 @ C）不再检查冷却，C 直接被触发。 | `useAgentIpcEvents.js:316` 只在入口过滤 | 低 |

---

## 4. 主流群聊模式对比

| 模式 | 调度方 | 谁发言 | 并发 | 防循环 | 上下文 | 代表系统 |
|---|---|---|---|---|---|---|
| **Slack/Discord @mention** | 去中心化，被 @ 者自主决定 | 被 @ 的人，可选 | 各自独立异步 | 人不在就不回 | 每人独立历史视图 | Slack、Discord |
| **AutoGen Group Chat（中央调度）** | GroupChatManager 按 relevance/round-robin 选人 | 每轮 1 人 | 严格串行 1 人 | 调度器决定结束 | 共享黑板，全可见 | AutoGen、CAMEL |
| **Event-driven 总线** | 事件总线广播 | 所有订阅者各自处理 | 全并行 | 靠各 Agent 自身幂等 | 各自缓存 | NATS、Kafka Agent 网格 |
| **线程式（Slack threads）** | 消息挂线程根 | 线程内任意人 | 线程内串行/并行 | 线程天然隔离 | 线程内上下文 | Slack threads、Lark |
| **投票/仲裁** | 所有人先表态 | 仲裁者选最优 | 表态并行、发言串行 | 仲裁收敛 | 共享黑板 | LangGraph 评审、DebateNet |
| **SoloForge 现状** | 渲染层 `handleGroupChat` | 仅被 @ 者，串行 | 串行，1 人/轮 | `repliedAgents` 一次性 + 5 轮上限 | 前端推送最近 20 条 | — |

### 4.1 各模式对 SoloForge 的适用性

- **Slack 模式**最贴近 SoloForge 的"部门群"语义：Agent 收到 @ 后**自主决定**是否回（可"忽略"），天然防循环且避免无意义发言。但当前 SoloForge 的 @ 是强制触发，缺"自主决定"层。
- **AutoGen 中央调度**适合需要"会议收敛到一个结论"的场景（如跨部门决策）。可作高层群聊的增强模式，但日常进度汇报不需要。
- **Event-driven**适合"通知广播"（如 CFO 发预算警报，所有人各自处理），但会让群聊失控，不宜作为默认。
- **线程式**对"一个群多个议题并行"很有效，当前 SoloForge 全群一个时间线，议题混杂时上下文互相干扰。
- **投票/仲裁**适合"多方案择优"，可作为 C-Level 决策群的可选模式。

---

## 5. 推荐群聊架构设计

### 5.1 设计目标

1. **并行回复**：被多人 @ 时并行触发，用户实时看到多个"正在思考…"。
2. **自主决定层**：Agent 收到 @ 后先快速判断"是否该我回"，避免无意义发言。
3. **统一节流**：用户消息和 Agent 消息走同一套冷却/速率限制，消除路径差异。
4. **有限多轮讨论**：允许 A 被反驳后澄清，但严格防乒乓。
5. **主题上下文**：按 token 预算裁剪历史，长讨论不丢关键结论。
6. **服务端群历史**：主进程持久化群消息，支持"新成员查历史"工具。
7. **参数化**：冷却、速率、轮数、并发度全部可配置。

### 5.2 推荐消息流图

```
                ┌──────────── 统一入口（用户 & Agent 共用） ────────────┐
ChatView.handleSend / post_to_department / post_to_group(新增)
      └─► GroupRouter.submit({conversationId, senderId, content, mentions})
            ├─ 1. 鉴权：canPostInGroup（合并到一处，用户也过）
            ├─ 2. 速率限制：可配置 N/Ms，按 senderId 分别计数（而非全局 groupId）
            ├─ 3. 落库：GroupHistoryStore.append（新增，主进程持久化）
            ├─ 4. webContents.send(GROUP_MESSAGE) → 前端 UI 落地
            └─ 5. 调度回复：Scheduler.dispatch(mentions)

Scheduler.dispatch(mentions)
   ├─ 并发度控制：信号量 SEMAPHORE_MAX（默认 3）
   ├─ 对每个被 @ 的 agent：
   │    ├─ 冷却检查（key=groupId:agentId，从"回复完成时刻"起算）
   │    ├─ RelevanceGate.fastCheck(agentId, content, recentHistory)
   │    │     → {shouldReply: bool, reason: string}   ← 自主决定层
   │    └─ 若 shouldReply：spawn AgentTask（并行），完成时刷新冷却时间戳
   ├─ Agent 回复后：
   │    ├─ 落库 + UI
   │    ├─ ChainDetector.extractNewMentions(reply)
   │    │     → 去重 + 看是否触达 MAX_PER_AGENT_PER_CHAIN（默认 2）
   │    └─ 递归 dispatch（round++，上限 MAX_ROUNDS=4）

RelevanceGate.fastCheck（新增轻量 LLM/规则层）
   ├─ 规则前置：发送者=自己跳过、已被 @ 3 轮跳过、内容明显不涉己专业跳过
   └─ 可选 1-token LLM 分类："该我回吗？" → yes/no/skip
```

### 5.3 关键设计决策

**并行 vs 串行**：被 @ 的多人**并行**触发（`Promise.all` + 信号量），UX 立竿见影。但保留"同轮内按 level 优先级排序"作为软序——level 高的先 spawn，低的后 spawn，但不阻塞。串行只用于"必须等前一个结论"的场景（如决策群），通过 `schedulerMode: 'serial' | 'parallel'` 配置，部门群默认 parallel。

**@ 强制 vs 自主**：引入 `RelevanceGate`。被 @ 的 Agent 先过一次轻量判断（规则为主，可选 1-token LLM），决定 `shouldReply`。@ 语义从"强制发言"降级为"强制通知 + 建议发言"。对用户明确 @ 的情况可设 `forceReply: true`（用户消息默认 force，Agent 消息默认 non-force）。

**防循环**：双层——
1. **每链每 Agent 上限** `MAX_PER_AGENT_PER_CHAIN = 2`：同一连锁里同一 Agent 最多发言 2 次（允许 A 说→B 反驳→A 澄清，但不允许第 3 次）。取代当前"一次性 `repliedAgents`"的过激策略。
2. **冷却从回复完成时刻起算**：`recordAgentTrigger` 移到 Agent 回复完成后调用，而非 @ 时立即记录。
3. **全链 token 预算**：累计输出超 `MAX_CHAIN_TOKENS` 强制终止。

**上下文**：`buildHistoryFromMessages` 改为按 token 预算裁剪（保留系统消息 + 最近 N 条 + 任何带"结论"标记的消息）。新增 `get_group_history` 工具，让 Agent 可主动查群历史。

**持久化**：新增主进程 `GroupHistoryStore`（JSON/SQLite），`postToDepartment`/用户消息统一先落库再推 UI。崩溃后可重建，新成员可查历史。

**统一节流**：把 `postToDepartment` 的鉴权/速率/冷却提到 `GroupRouter.submit`，**用户消息也过**（用户冷却可放宽到 1s 防误触，速率 10/10s）。消除 P2。

**临时群聊**：新增 `post_to_group` 工具（与 `post_to_department` 同构，但路由按 `conversationId` 而非 `departmentId`），补齐 P3。

### 5.4 冷却与速率限制参数化

```
group_chat:
  agent_cooldown_ms: 60000      # 60s，从回复完成起算（P4/P5）
  per_sender_rate_limit: { max: 5, window_ms: 10000 }   # 按 sender 计数
  group_rate_limit:    { max: 10, window_ms: 10000 }    # 放宽到 10/10s
  max_chain_rounds: 4           # 降自 5，配合并行后 4 轮已足够
  max_per_agent_per_chain: 2     # 允许有限多轮（P7）
  max_concurrent_replies: 3      # 信号量（P1）
  scheduler_mode: 'parallel'     # 部门群 parallel，决策群可设 serial
  force_reply_on_user_mention: true
  relevance_gate:
    enabled: true
    mode: 'rules'                # 'rules' | 'llm-1token'
```

---

## 6. 防循环 / 冷却 / 速率限制 设计

### 6.1 防循环（三层）

| 层 | 机制 | 实现位置 | 参数 |
|---|---|---|---|
| L1 链内去重 | `repliedCountMap` 替代 `repliedAgents` Set，允许 `max_per_agent_per_chain` 次 | 渲染层 `handleGroupChat` 重构 | `max_per_agent_per_chain=2` |
| L2 链轮数上限 | `round < MAX_CHAIN_ROUNDS` 保留 | 渲染层 | `max_chain_rounds=4` |
| L3 冷却 | 从"回复完成时刻"起算，跨链生效 | 主进程 `GroupRouter` 统一 | `agent_cooldown_ms=60000` |

附加：`ChainDetector` 记录每链发言者序列，若检测到 A→B→A→B 模式（即使未触 L1），提前 break。

### 6.2 冷却

- **起算点**：`recordAgentTrigger` 从 `filterCooldownMentions`（@ 时）移到 `sendToSingleAgent` 的 `onComplete`（回复完成时）。修 P4。
- **key 统一**：前后端都用 `${conversationId}:${agentId}`，并文档化 `groupId === conversationId` 的约定。修 P9。
- **分级冷却**：用户 @ 触发 = 30s，Agent 连锁触发 = 60s（防止 Agent 互相刷屏），可配置。
- **冷却命中要反馈**：返回给调用方 `filteredMentions` 同时推 UI 系统消息"X 在冷却中，本次未触发"。修 P12。

### 6.3 速率限制

- **维度**：从"仅 groupId"改为"per senderId + groupId"双维度。防止单个 Agent 刷屏，也防群整体风暴。
- **阈值**：`per_sender: 5/10s`、`group: 10/10s`。修 P6。
- **统一入口**：用户和 Agent 都过 `GroupRouter.submit`，用户消息走宽松限制（防误触），Agent 走严格限制。修 P2。
- **降级**：超限不直接拒，入队延迟发送（最多延迟 2s），超过 2s 才拒，改善 UX。

---

## 7. 关键文件改动清单

> 仅列改动点，不含具体代码。按实施优先级排序。

### Phase 1（修关键 UX 与正确性）

| 文件 | 改动 |
|---|---|
| `src/renderer/hooks/useChatAgent.js:275-322` | `for...of await` 改 `Promise.all` + 信号量；`repliedAgents` Set 改 `repliedCountMap`（每 Agent 允许 2 次） |
| `src/renderer/hooks/chat-agent-logic.js:18,194` | `MAX_CHAIN_ROUNDS` 改 4；`filterNewMentions` 按 `count < max_per_agent_per_chain` 过滤而非硬排除 |
| `src/main/chat/department-group.js:83-97` | `filterCooldownMentions` 不再立即 `recordAgentTrigger`，改为返回有效列表，触发时刻由调用方在回复完成后记录 |
| `src/main/chat/department-group.js:440-525` | `postToDepartment` 抽离鉴权/速率/冷却为 `GroupRouter.submit`，用户消息路径也接入 |
| `src/renderer/hooks/useAgentIpcEvents.js:137-178,284-350` | 用户消息与 Agent 消息统一走 `GroupRouter` 调度，消除双路径 |

### Phase 2（补能力缺口）

| 文件 | 改动 |
|---|---|
| `src/main/tools/collaboration-tools.js` | 新增 `postToGroupTool`（临时群聊发消息），与 `postToDepartment` 同构 |
| `src/main/chat/group-history-store.js`（新增） | 主进程持久化群消息，支持 `getGroupHistory(groupId, {limit, before})` |
| `src/main/tools/collaboration-tools.js` | 新增 `get_group_history` 工具，让 Agent 可查群历史（修 P11） |
| `src/renderer/hooks/chat-agent-logic.js:151-163` | `buildHistoryFromMessages` 改按 token 预算裁剪，非固定 20 条（修 P10） |

### Phase 3（防循环增强 + 反馈）

| 文件 | 改动 |
|---|---|
| `src/renderer/hooks/useChatAgent.js` | 引入 `ChainDetector`，检测 A→B→A→B 模式提前 break |
| `src/renderer/components/chat/ChatView.jsx` 或 `ChatInput.jsx` | 用户发未 @ 消息时 UI 提示"未 @ 任何人，不会触发回复"（修 P8） |
| `src/main/chat/department-group.js` + 前端 | 冷却过滤命中时推系统消息提示（修 P12） |
| `src/shared/ipc-channels.js` + `preload.js` | 新增 `GROUP_MESSAGE_FILTERED` 通道，前端显示"X 在冷却中" |

### Phase 4（参数化与可选增强）

| 文件 | 改动 |
|---|---|
| `src/main/config/agent-config-store.js` 或新增 `group-chat-config.js` | 抽离第 5.4 节所有参数为可配置 |
| `src/main/chat/relevance-gate.js`（新增） | `RelevanceGate.fastCheck`，规则前置 + 可选 1-token LLM |
| `src/main/chat/department-group.js:28-30` | 速率限制改为 per-sender + group 双维度，阈值参数化 |

### 改动影响面

- **核心逻辑**：`useChatAgent.handleGroupChat` 重构（从串行改并行 + 防循环升级）是最大风险点，需充分单测 `chat-agent-logic` 纯函数后集成。
- **新通道**：`GROUP_MESSAGE_FILTERED` 需 `ipc-channels.js` + `preload.js` + `useAgentIpcEvents.js` 三处同步，与现有 `CHAT_DEPT_GROUP_*` 模式一致。
- **持久化新增**：`GroupHistoryStore` 需考虑与现有 `chat-history.json` 的关系——建议**主进程只存群聊**，私聊仍走前端，避免迁移负担。
- **兼容性**：`postToDepartment` 的对外签名不变，内部重构不影响 Agent 工具调用；`repliedAgents → repliedCountMap` 是内部变更，无 API 影响。

---

## 附录 A：关键常量与魔法数速查

| 常量 | 当前值 | 位置 | 建议值 |
|---|---|---|---|
| `AGENT_COOLDOWN_MS` | 30000 | `department-group.js:25` | 60000（从回复完成起算） |
| `GROUP_RATE_LIMIT_WINDOW` | 10000 | `department-group.js:29` | 10000（不变） |
| `GROUP_RATE_LIMIT_MAX` | 3 | `department-group.js:30` | 10（per-sender 再单独 5） |
| `DEPT_COOLDOWN_MS` | 30000 | `chat-agent-logic.js:12` | 与后端同步，60000 |
| `MAX_CHAIN_ROUNDS` | 5 | `chat-agent-logic.js:18` | 4 |

## 附录 B：未在报告中改动的观察

- `chat-manager.handleStreamMessage`（`chat-manager.js:474`）对私聊和群聊无差别处理，群聊上下文完全靠前端 `history` 参数注入——这意味着如果把上下文裁剪逻辑从 `buildHistoryFromMessages` 移到主进程 `GroupHistoryStore`，需同步改 `handleStreamMessage` 不再盲信 `history` 参数。属 Phase 2 实施细节。
- `permission-checker.js:500-509` 把 `post_to_department` 列为"低风险直接放行"——重设计后 `post_to_group` 同样应放行，`get_group_history` 只读更应放行。
- `collaboration-prompt.js:24,195-208` 强力引导 Agent 用 `post_to_department` 而非 `send_to_agent` 做工作沟通——重设计后应补充 `post_to_group` 的引导文案。

---

**报告结束**。本报告未修改任何源代码，仅产出 `docs/refactor/group-chat-audit.md`。实施建议按 Phase 1→4 推进，Phase 1（并行化 + 冷却计时修正）即可解决 P1/P2/P4 三个高/中危问题，投入产出比最高。
