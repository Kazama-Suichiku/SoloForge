# 多 Agent 协作通信架构重构方案

> 状态：方案设计（待用户迭代）
> 前置调研：docs/refactor/multi-agent-communication-audit.md（739行，43KB）

## 目标

从当前"同步阻塞 RPC"架构重构为"Actor 模型 + 事件总线 + 消息队列"，支撑：
- 100+ Agent 同时在线，1000+ 并发消息
- Agent 间 fire-and-forget 通信（不阻塞等待）
- 组织架构工具（向上汇报、向下委派、跨部门协作、审批流）
- 全链路 traceId 追踪 + 背压控制 + 可观测性

## 当前问题

| 问题 | 根因 | 位置 |
|---|---|---|
| 给4人发消息只收到1人回复 | 秘书只委派1人 + 工具串行 await + 群聊串行触发 | secretary-agent.js:26-60, tool-executor.js:771, useChatAgent.js:275 |
| Agent 间通信阻塞 | sendMessage 强制 await 目标完整执行 | agent-messaging.js:442 |
| 无背压控制 | 队列满时无降级，超时不取消底层调用 | message-queue.js, timeout-manager.js |
| 历史记录 O(n) 扫描 | 全局 messages[] 数组，每次 pairwise 查找全扫 | agent-messaging.js:77-100 |
| 组织架构工具不完整 | 缺 get_org_chart / get_subordinates / get_direct_report / escalate | collaboration-tools.js |

## 架构设计

### 核心组件

```
┌────────────────────────────────────────────────────────────┐
│  MessageBus (新增 — 事件总线)                                │
│  ├ publish(target, message)      — fire-and-forget          │
│  ├ request(target, message, timeout) — 请求-响应           │
│  ├ broadcast(targets[], message) — 广播(并行)               │
│  ├ subscribe(agentId, handler)  — Agent 订阅自己邮箱        │
│  └ reply(replyTo, content)      — 回复                      │
├────────────────────────────────────────────────────────────┤
│  AgentMailbox (新增 — 每 Agent 独立邮箱)                     │
│  ├ queue: MessageObject[]       — 消息对象(非闭包)           │
│  ├ capacity: 64                 — 队列上限                  │
│  ├ processing: boolean          — 串行处理保证              │
│  ├ pendingReplies: Map          — request 模式的待回复      │
│  └ process()                    — 自主消费 + MessageBus.reply│
├────────────────────────────────────────────────────────────┤
│  TraceStore (新增 — 跨 Agent 追踪)                           │
│  ├ spans[]: {traceId, spanId, parentSpanId, agentId, ...}  │
│  ├ startSpan(agentId, parentSpanId) → spanId               │
│  ├ endSpan(spanId, result)                                 │
│  └ getTrace(traceId) → 完整因果链                          │
├────────────────────────────────────────────────────────────┤
│  BackpressureController (新增 — 背压控制)                    │
│  ├ globalSemaphore: 20 (全局 LLM 并发上限)                  │
│  ├ perAgentLimit: 64 (每 Agent 邮箱容量)                     │
│  ├ rateLimiter: 令牌桶 (每秒 10 条/Agent)                   │
│  └ onOverflow: 降级(短提示) / 拒绝(报错) / 排队(等待)        │
├────────────────────────────────────────────────────────────┤
│  OrgChartService (新增 — 组织架构服务)                      │
│  ├ getOrgChart() → 完整组织架构树                           │
│  ├ getSubordinates(agentId) → 直接下属列表                 │
│  ├ getSuperior(agentId) → 直接上级                           │
│  ├ getDirectReports(agentId) → 向自己汇报的人               │
│  ├ getDepartmentMembers(deptId) → 部门成员                   │
│  ├ getCrossDeptColleagues(agentId) → 跨部门同事              │
│  └ getReportingChain(agentId) → 汇报链(A→B→C→CEO)           │
└────────────────────────────────────────────────────────────┘
```

### 消息对象格式

```javascript
{
  id: 'msg-xxx',
  traceId: 'trace-xxx',        // 跨 Agent 全链路追踪
  parentSpanId: 'span-xxx',   // 父 span（触发方）
  from: 'secretary',
  to: 'cto',
  type: 'message' | 'delegation' | 'broadcast' | 'reply' | 'approval',
  content: '请帮我分析技术方案',
  mode: 'async' | 'sync',     // async=fire-and-forget, sync=等待回复
  replyTo: 'msg-yyy',         // 回复模式指向原消息
  conversationId: 'conv-xxx',
  createdAt: Date.now(),
  priority: 3,                // 1-5，影响队列处理顺序
  metadata: {
    callChain: ['user', 'secretary'],  // 调用链（循环检测）
    nestingDepth: 1,                   // 嵌套深度
    timeout: 120000,                  // 超时(ms)
  }
}
```

### 通信流程（fire-and-forget）

```
用户 → 小秘："通知技术部4人开会"
  → 小秘 tool-loop:
    → post_to_department(tech, "10点开会", mentions:[CTO,李工,张三,王五])
      → MessageBus.broadcast([CTO,李工,张三,王五], msg)  // Promise.all 并行
        → CTO Mailbox 收消息 → CTO runToolLoop → 完成后 reply
        → 李工 Mailbox 收消息 → 李工 runToolLoop → 完成后 reply
        → 张三 Mailbox 收消息 → 张三 runToolLoop → 完成后 reply
        → 王五 Mailbox 收消息 → 王五 runToolLoop → 完成后 reply
      → 4人同时收到，同时独立处理，互不阻塞
      → 小秘不等待，继续做其他事
      → 各人完成后 reply 通过 MessageBus 回灌小秘邮箱
      → 小秘下次 tool-loop 时看到回信
```

### 通信流程（sync 请求-响应）

```
CEO → CTO："给我技术方案评估"
  → send_to_agent(CTO, msg, mode:'sync', timeout:120s)
    → MessageBus.request(CTO, msg, timeout)
      → CTO Mailbox 收消息 → CTO runToolLoop → 完成后 reply
      → CEO 收到 reply（阻塞等待，但只等这一个）
```

## 新增组织架构工具

### 1. get_org_chart（完整组织架构树）
```javascript
{
  name: 'get_org_chart',
  description: '查看完整组织架构树，包括所有层级的上下级关系。用于了解公司整体结构。',
  category: 'collaboration',
  parameters: {},
  // 返回: { tree: { id, name, title, level, department, subordinates: [...] } }
}
```

### 2. get_subordinates（直接下属）
```javascript
{
  name: 'get_subordinates',
  description: '查看自己的直接下属列表。用于委派任务前了解可用人力。',
  category: 'collaboration',
  parameters: {
    department: { type: 'string', description: '按部门过滤（可选）', required: false }
  },
  // 返回: { subordinates: [{ id, name, title, level, department, status, currentTaskCount }] }
}
```

### 3. get_direct_report（查看某人向谁汇报）
```javascript
{
  name: 'get_direct_report',
  description: '查看某位同事的直接上级是谁。用于确定汇报路径。',
  category: 'collaboration',
  parameters: {
    agent_id: { type: 'string', description: '同事ID（不填默认自己）', required: false }
  },
  // 返回: { superior: { id, name, title } }
}
```

### 4. escalate（升级/上报给上级的上级）
```javascript
{
  name: 'escalate',
  description: '将问题升级给上级的上级（越级上报）。当直接上级无法解决或问题超出其权限时使用。',
  category: 'collaboration',
  parameters: {
    message: { type: 'string', description: '上报内容', required: true },
    urgency: { type: 'string', description: '紧急程度: normal|urgent|critical', required: false }
  },
  // 自动找到自己上级的上级，fire-and-forget 发送
  // 返回: { success, escalatedTo: { id, name } }
}
```

### 5. request_cross_dept_collab（跨部门协作请求）
```javascript
{
  name: 'request_cross_dept_collab',
  description: '向其他部门的负责人发起跨部门协作请求。自动找到目标部门的负责人并异步发送。',
  category: 'collaboration',
  parameters: {
    target_department: { type: 'string', description: '目标部门ID', required: true },
    task_description: { type: 'string', description: '协作任务描述', required: true },
    priority: { type: 'number', description: '优先级1-5', required: false }
  },
  // 自动找到目标部门负责人，fire-and-forget
  // 返回: { success, sentTo: { id, name, department } }
}
```

### 6. broadcast_to_subordinates（向所有下属广播）
```javascript
{
  name: 'broadcast_to_subordinates',
  description: '向所有直接下属广播消息（并行发送，不等回复）。',
  category: 'collaboration',
  parameters: {
    message: { type: 'string', description: '广播内容', required: true },
    include_indirect: { type: 'boolean', description: '是否包含间接下属（全部下属的下属）', required: false }
  },
  // MessageBus.broadcast 并行投递
  // 返回: { success, sentTo: [{ id, name }] }
}
```

### 7. get_reporting_chain（查看汇报链）
```javascript
{
  name: 'get_reporting_chain',
  description: '查看从自己到CEO的完整汇报链。用于确定多级上报路径。',
  category: 'collaboration',
  parameters: {
    agent_id: { type: 'string', description: '同事ID（不填默认自己）', required: false }
  },
  // 返回: { chain: [{ id, name, title, level }, ...] }  // 从自己到CEO
}
```

### 8. get_team_status（团队工作状态）
```javascript
{
  name: 'get_team_status',
  description: '查看自己团队（所有下属）的实时工作状态：正在做什么、任务负载、在线状态。',
  category: 'collaboration',
  parameters: {
    include_subteams: { type: 'boolean', description: '是否包含下属的下属', required: false }
  },
  // 返回: { team: [{ id, name, status: 'idle'|'working'|'overloaded', currentTask, taskCount }] }
}
```

## 群聊设计

### 设计理念（用户确认）

群聊的核心抽象是**工具即协作**：

1. **群聊发言工具**：群成员有一个独立的"在群里发言"工具，发言后所有成员都能看到
2. **自主决定**：员工看到群里消息后可以选择不发言——不被 @ 就不强制回复
3. **@ 强制发言**：被 @ 的 Agent 必须发言（通过提示词约束，不需要功能层判断）
4. **独立上下文**：每个 Agent 维护自己独立的对话上下文，不共享群聊上下文
5. **工具即协作**：整个协作过程抽象为工具调用——收消息、发消息、执行任务，都是工具
6. **排队执行**：多个工具同时触发时，按发起顺序排队串行执行（不并行）

### 消息流

```
用户在群里发消息 "请CTO和李工评估一下技术方案" (@CTO, @李工)
  → 消息落到群聊 UI（所有成员可见）
  → 按 @ 列表排队触发：CTO → 李工（串行，按发起顺序）
    → CTO 独立上下文收到群消息 + @ 提示
      → CTO tool-loop：
        → 可能调 send_to_agent 私信李工讨论
        → 可能调 post_to_group 在群里发言（所有人看到）
        → 可能调 write_file / shell_exec 执行任务
        → 完成后在群里发最终结论（post_to_group）
    → CTO 完成后，李工独立上下文收到群消息 + @ 提示
      → 李工 tool-loop：同样独立处理
    → 全部完成

关键：
- CTO 和李工不共享上下文，各自独立处理
- CTO 发言后李工能看到（群消息是公共的）
- 如果 CTO 在群里 @ 了李工，李工会被排队触发
- 串行排队：CTO 完全做完才开始李工（按发起顺序）
```

### 新增工具

#### post_to_group（群聊发言）
```javascript
{
  name: 'post_to_group',
  description: `在群聊中发言。发言后所有群成员都能看到。

使用场景：
- 在群里汇报工作进展
- 在群里发布结论或方案
- 回应群里的讨论
- 被 @ 后的正式回复

注意：
- 群里所有成员都会看到你的发言
- 如果需要特定人回复，使用 mention 参数 @ 对方
- 被 @ 的人会被排队触发发言（按发起顺序）
- 不被 @ 的人看到消息但可以选择不回复
- 非群聊相关内容请使用 send_to_agent 私信`,
  category: 'group_chat',
  parameters: {
    content: { type: 'string', description: '发言内容', required: true },
    mention: {
      type: 'array',
      items: { type: 'string' },
      description: '要 @ 的同事 ID 列表（被 @ 的人会被排队触发发言）',
      required: false
    }
  }
}
```

#### get_group_history（查看群聊历史）
```javascript
{
  name: 'get_group_history',
  description: '查看群聊的历史消息。用于了解之前的讨论内容和结论。',
  category: 'group_chat',
  parameters: {
    limit: { type: 'number', description: '返回消息条数（默认50）', required: false }
  }
}
```

### 群聊触发机制

**核心变化：从渲染进程移到主进程，从串行 await 改为排队串行**

```
当前（问题）：
  渲染进程 useChatAgent.handleGroupChat
    → for...of await sendToSingleAgent  // 阻塞串行
    → repliedAgents 一次性消费            // 无法多轮
    → 冷却 30s 从被@开始算               // 计时错误

改后：
  主进程 GroupQueue.submit({conversationId, senderId, content, mentions})
    → 1. 消息落到 GroupHistoryStore（主进程持久化）
    → 2. 推 UI 显示（webContents.send）
    → 3. 按 mentions 排队触发：
         → 每个 @ 的 Agent 串行执行（按发起顺序排队）
         → Agent 独立上下文处理（不共享群聊上下文）
         → Agent 可用 post_to_group 发言 → 新消息落库+推UI
         → 如果 Agent 发言里 @ 了新人 → 新人加入队列尾部
         → 队列空了 → 结束
```

### 排队执行设计

```javascript
// 主进程：GroupQueue
class GroupQueue {
  constructor() {
    this.queue = [];        // 待执行项
    this.processing = false; // 是否正在处理
    this.perAgentCount = new Map(); // 每链每 Agent 发言次数（防循环）
  }

  async submit({ conversationId, senderId, content, mentions }) {
    // 1. 消息落库
    groupHistoryStore.append(conversationId, { senderId, content, mentions });
    // 2. 推 UI
    webContents.send(GROUP_MESSAGE, { conversationId, senderId, content, mentions });
    // 3. 被 @ 的人加入队列
    for (const agentId of mentions) {
      this.queue.push({ conversationId, agentId, triggerMessage: content, senderId });
    }
    // 4. 开始处理（如果没在处理中）
    this.process();
  }

  async process() {
    if (this.processing) return;  // 已在处理，排队等着
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift(); // 按发起顺序取出
      const { conversationId, agentId, triggerMessage, senderId } = item;

      // 防循环：每链每 Agent 最多发言 2 次
      const count = this.perAgentCount.get(agentId) || 0;
      if (count >= 2) continue; // 已发言 2 次，跳过

      // Agent 独立上下文处理
      const history = groupHistoryStore.getRecent(conversationId, 50);
      const result = await runAgentToolLoop(agentId, {
        triggerMessage,
        groupHistory: history,    // 群聊历史作为上下文
        senderId,
      });

      // Agent 的回复通过 post_to_group 工具发出
      // post_to_group 内部调 GroupQueue.submit 形成闭环
      // 如果回复里 @ 了新人，新人自动加入队列
    }

    this.processing = false;
  }
}
```

### 独立上下文

```
当前问题：
  buildHistoryFromMessages 固定 slice(-20)，所有 Agent 共享同一个群聊上下文

改后：
  每个 Agent 收到群消息时：
  → GroupHistoryStore.getRecent(conversationId, 50)  // 群聊公共历史
  → + Agent 自己的 systemPrompt（含角色/职责/个性）
  → + Agent 自己的记忆（memory store）
  → = Agent 的独立上下文

  Agent 不看到"群聊上下文"这个概念
  Agent 看到的是："你所在的群聊里最近的消息 + 你的角色和记忆"
  每个 Agent 的"理解"不同，因为角色和记忆不同
```

### 提示词约束（@ 强制发言）

系统提示词新增群聊规则：

```
## 群聊规则
1. 被 @ 时必须发言（使用 post_to_group 工具回复）
2. 不被 @ 时可以发言也可以不发言（自主判断）
3. 群聊发言用 post_to_group，私信用 send_to_agent
4. 群聊发言所有成员可见，注意措辞简洁
5. 可以用 @ 指定某人回复（mention 参数）
6. 不要在群里刷屏，一条消息说清楚
7. 群聊讨论时，先看完整历史再发言，避免重复
```

### 防循环设计

| 层级 | 机制 | 说明 |
|---|---|---|
| 1. 每链每 Agent 最多 2 次 | `perAgentCount` Map | 允许 A 被 B 反驳后澄清，但不允许第 3 次 |
| 2. 全链轮数上限 | `MAX_ROUNDS = 6` | 所有 Agent 加起来最多 6 轮 |
| 3. 提示词约束 | 系统提示词 | "不要在群里刷屏" "避免重复" |
| 4. 速率限制 | 每 Agent 60s 内最多 3 次群发言 | 防洪泛 |

### 群聊历史持久化

```javascript
// ~/.soloforge/data/<user>/<company>/group-history.json
{
  "version": 1,
  "groups": {
    "dept-tech": {
      "messages": [
        {
          "id": "gm-xxx",
          "senderId": "cto",
          "senderName": "李工",
          "content": "技术方案评估完成...",
          "mentions": ["cto", "zhang3"],
          "timestamp": Date.now()
        }
      ]
    }
  }
}
```

- 主进程持久化（不是前端内存）
- Agent 可通过 `get_group_history` 工具查询
- 崩溃后可恢复
- 新成员可查历史了解上下文

### 改造现有工具

| 工具 | 改动 |
|---|---|
| `post_to_department` | 保留但改为内部调 `GroupQueue.submit`（统一入口） |
| `create_group_chat` | 保留（创建临时群聊） |
| 新增 `post_to_group` | 群聊发言工具（所有成员可见） |
| 新增 `get_group_history` | 查看群聊历史 |
| 删除 `handleGroupChat` | 渲染进程不再做群聊触发逻辑，移到主进程 GroupQueue |

### 删除的机制

| 机制 | 原因 |
|---|---|
| `AGENT_COOLDOWN_MS = 30s` | 太严，用每 Agent 60s 内最多 3 次替代 |
| `GROUP_RATE_LIMIT_MAX = 3/10s` | 太严，用排队串行替代（不需要速率限制） |
| `repliedAgents` 一次性消费 | 改为 perAgentCount 最多 2 次 |
| `filterCooldownMentions` | 不需要冷却过滤，排队自然限速 |
| `RelevanceGate` | 不需要，提示词约束就够了 |
| `handleGroupChat`（渲染进程） | 移到主进程 GroupQueue |
| `buildHistoryFromMessages` 固定 20 条 | 改为 GroupHistoryStore.getRecent 50 条 |

### 迁移路径（群聊）

| # | 改动 | 文件 | 风险 |
|---|---|---|---|
| G1 | 新建 GroupHistoryStore | src/main/chat/group-history-store.js | 低 |
| G2 | 新建 GroupQueue | src/main/chat/group-queue.js | 中 |
| G3 | 新增 post_to_group 工具 | src/main/tools/collaboration-tools.js | 低 |
| G4 | 新增 get_group_history 工具 | src/main/tools/collaboration-tools.js | 低 |
| G5 | post_to_department 改调 GroupQueue | src/main/chat/department-group.js | 中 |
| G6 | 删除渲染进程 handleGroupChat | src/renderer/hooks/useChatAgent.js | 中 |
| G7 | 群聊消息改主进程推送 | src/main/chat-ipc-handlers.js | 低 |
| G8 | 系统提示词加群聊规则 | src/main/chat/cxo-config.js | 低 |
| G9 | 防循环参数化 | group-queue.js | 低 |

### 验证标准

| 场景 | 预期 |
|---|---|
| 用户在群里 @ 4 人 | 4 人按顺序排队发言，一个做完下一个开始 |
| CTO 在群里 @ 李工 | 李工自动加入队列，轮到时发言 |
| CTO 私信李工讨论后在群里发结论 | 群里所有人看到结论 |
| A 被 B 反驳后澄清 | 允许（每 Agent 最多 2 次发言） |
| A 第 3 次想发言 | 被防循环机制阻止 |
| Agent 不被 @ | 可以自主发言也可以不发言 |
| Agent 被 @ | 必须发言（提示词约束） |
| 群聊消息持久化 | 崩溃后恢复，新成员可查历史 |
| get_group_history | 返回群聊历史消息 |

## 改造现有工具

| 工具 | 当前问题 | 改造 |
|---|---|---|
| `send_to_agent` | 同步 await 阻塞 | 加 `mode:'async'` 参数，async 走 MessageBus.publish 不等，sync 走 MessageBus.request 等 |
| `delegate_task` | 已有 wait_for_result:false 但仍串行 | wait_for_result:false 时走 MessageBus.publish，true 时走 MessageBus.request |
| `post_to_department` | 串行触发 + 30秒冷却 | MessageBus.broadcast 并行投递，冷却改为可配置（默认5秒） |
| `notify_boss` | 已是 fire-and-forget | 不改，但底层走 MessageBus 统一 |
| `list_colleagues` | 返回 reportsTo:null（配置没填） | 修复：从 OrgChartService 推导 reportsTo |
| `create_group_chat` | 串行 | 不改（创建操作不需要并行） |
| `suspend_subordinate` | 不变 | 不改（状态变更操作） |

## 迁移路径

### 阶段1：紧急修复（1-2天，低风险）

不改架构，只修根因，让"给4人发消息都能收到回复"。

| # | 改动 | 文件 | 具体改法 |
|---|---|---|---|
| 1.1 | 秘书多委派 | secretary-agent.js:26-60 | analyzeForDelegation 支持返回多个目标 |
| 1.2 | 移除强制单委派 | chat-manager.js:422-448 | 不再命中即返回，让秘书自主用工具 |
| 1.3 | 通信工具并行 | tool-executor.js:771 | 通信类工具(send_to_agent/post_to_department)用 Promise.all |
| 1.4 | 群聊触发移主进程 | department-group.js + useChatAgent.js | handleGroupChat 连锁触发移到主进程 Promise.all |
| 1.5 | send_to_agent 加 mode | collaboration-tools.js:22 | 加 mode:'async'\|'sync' 参数，async 不等 |
| 1.6 | 冷却时间缩短 | department-group.js:25 | 30秒→5秒，速率限制 3→10 |

### 阶段2：MessageBus + Actor 邮箱（1-2周，中风险）

| # | 改动 | 文件 | 具体改法 |
|---|---|---|---|
| 2.1 | 新建 MessageBus | src/main/collaboration/message-bus.js | publish/request/broadcast/subscribe/reply |
| 2.2 | 新建 AgentMailbox | src/main/collaboration/agent-mailbox.js | 消息对象队列 + 串行处理 + 容量上限 |
| 2.3 | 重构 message-queue | message-queue.js | 从闭包队列改消息对象队列 |
| 2.4 | 重构 sendMessage | agent-messaging.js:302 | 基于 MessageBus 实现 sync/async |
| 2.5 | 重构 delegateTask | task-delegation.js:53 | 基于 MessageBus 实现 |
| 2.6 | 接口兼容 | agent-communication.js | 导出签名不变，内部转调 MessageBus |

### 阶段3：组织架构工具 + OrgChartService（3-5天，低风险）

| # | 改动 | 文件 | 具体改法 |
|---|---|---|---|
| 3.1 | 新建 OrgChartService | src/main/collaboration/org-chart-service.js | 从 agent-config-store 推导组织架构树 |
| 3.2 | get_org_chart 工具 | collaboration-tools.js | 返回完整组织架构树 |
| 3.3 | get_subordinates 工具 | collaboration-tools.js | 返回直接下属 |
| 3.4 | get_direct_report 工具 | collaboration-tools.js | 返回某人的直接上级 |
| 3.5 | escalate 工具 | collaboration-tools.js | 越级上报给上级的上级 |
| 3.6 | request_cross_dept_collab 工具 | collaboration-tools.js | 跨部门协作请求 |
| 3.7 | broadcast_to_subordinates 工具 | collaboration-tools.js | 向所有下属广播 |
| 3.8 | get_reporting_chain 工具 | collaboration-tools.js | 查看汇报链 |
| 3.9 | get_team_status 工具 | collaboration-tools.js | 团队工作状态 |
| 3.10 | 修复 list_colleagues reportsTo | collaboration-tools.js:564 | 从 OrgChartService 推导 |
| 3.11 | 系统提示词更新 | cxo-config.js | 加入新工具的使用说明 |

### 阶段4：traceId 跨 Agent + TraceStore（3-5天，低风险）

| # | 改动 | 文件 | 具体改法 |
|---|---|---|---|
| 4.1 | 新建 TraceStore | src/main/collaboration/trace-store.js | span 存储 + trace 查询 |
| 4.2 | 入口生成 traceId | chat-manager.js:474 | handleStreamMessage 入口 startSpan |
| 4.3 | 通信工具透传 traceId | collaboration-tools.js | send_to_agent/delegate_task 带 traceId |
| 4.4 | MessageBus 透传 | message-bus.js | publish/request 携带 traceId+parentSpanId |
| 4.5 | Dashboard Trace 可视化 | dashboard/ 组件 | 新增 Trace 面板显示通信链 |

### 阶段5：背压控制 + 全局并发（1周，中风险）

| # | 改动 | 文件 | 具体改法 |
|---|---|---|---|
| 5.1 | 新建 BackpressureController | src/main/collaboration/backpressure-controller.js | Semaphore + 令牌桶 |
| 5.2 | 全局 LLM 并发上限 | chat-agent.js | acquire/release Semaphore |
| 5.3 | 邮箱溢出降级 | agent-mailbox.js | 满时返回短提示而非 error |
| 5.4 | 速率限制参数化 | department-group.js | 常量改可配置 |

### 阶段6：历史记录索引化（1-2周，中风险）

| # | 改动 | 文件 | 具体改法 |
|---|---|---|---|
| 6.1 | messages 改索引 | agent-communication.js:58 | Map<agentPairKey, message[]> |
| 6.2 | getPairwiseHistory O(1) | agent-messaging.js:77 | 从索引直接查 |
| 6.3 | 磁盘增量写 | agent-communication.js | 只写新增消息 |

## Agent 配置改造

当前 agent-configs.json 缺 `reportsTo` 字段，需要补充：

```javascript
// DEFAULT_AGENT_CONFIGS 需要加 reportsTo
secretary: { reportsTo: 'ceo' },     // 小秘向CEO汇报
cto: { reportsTo: 'ceo' },           // CTO向CEO汇报
cfo: { reportsTo: 'ceo' },           // CFO向CEO汇报
chro: { reportsTo: 'ceo' },          // CHRO向CEO汇报
ceo: { reportsTo: null },            // CEO向老板(用户)汇报
```

OrgChartService 从这个字段推导完整组织架构树。

## 系统提示词改造

cxo-config.js 的系统提示词需要加入新工具的使用说明：

```
## 组织架构工具
- get_org_chart: 查看完整组织架构树
- get_subordinates: 查看你的直接下属
- get_direct_report: 查看某人的直接上级
- get_reporting_chain: 查看到CEO的完整汇报链
- get_team_status: 查看团队实时工作状态
- escalate: 越级上报给上级的上级
- request_cross_dept_collab: 跨部门协作请求
- broadcast_to_subordinates: 向所有下属广播

## 通信模式
- send_to_agent(mode:'async'): 发送后不等回复，适合通知/汇报
- send_to_agent(mode:'sync'): 发送后等待回复，适合需要回答的问题
- delegate_task(wait_for_result:false): 委派后不等，适合并行任务
- post_to_department: 群聊广播，所有被@人同时收到
- notify_boss: 向老板汇报，fire-and-forget
```

## 验证标准

| 场景 | 预期 |
|---|---|
| 小秘给4人发消息 | 4人同时收到并回复 |
| CTO 委派任务给李工 + 向CEO汇报 | 两件事并行，互不阻塞 |
| A→B→C→D 链式调用 | 全链 traceId 追踪，4层不超时 |
| 100条并发消息 | 背压控制器限流，不崩 |
| get_org_chart | 返回完整组织架构树 |
| get_subordinates | CTO 能看到技术部所有人 |
| escalate | 越级上报到上级的上级 |
| broadcast_to_subordinates | CEO 广播给所有C-Level，5人同时收到 |

---

## 权限系统设计

### 当前问题

当前工具权限是**硬编码的 role-based category 过滤**（tool-context.js:56-96）：
```javascript
if (role !== 'cfo') filter(t => t.category !== 'cfo');
if (role !== 'chro') filter(t => t.category !== 'hr');
if (!isCxo && role !== 'chro') filter(t => t.category !== 'recruit');
// ...7 个硬编码 if
```

问题：
- 新增工具需要改代码（硬编码 if）
- 无法动态授权/撤权（必须改代码重新部署）
- 秘书没有全权限（当前 secretary 被过滤掉很多 category）
- 招聘时 recruit_request 的 `tools` 参数没接入权限系统
- 无法做细粒度授权（只能按 category 整块开关，不能按单个工具）

### 权限系统架构

```
┌────────────────────────────────────────────────────────────┐
│  PermissionStore (新增 — 权限存储)                            │
│  ├ agentPermissions: Map<agentId, PermissionSet>            │
│  ├ PermissionSet = {                                        │
│  │   allowedTools: string[],       // 明确允许的工具名列表    │
│  │   deniedTools: string[],        // 明确禁止的工具名列表    │
│  │   allowedCategories: string[],  // 允许的 category 列表   │
│  │   deniedCategories: string[],   // 禁止的 category 列表   │
│  │   fileAccess: { ... },          // 文件路径权限             │
│  │   shellAccess: { ... },         // Shell 权限              │
│  │   networkAccess: { ... },       // 网络权限               │
│  │   gitAccess: { ... },            // Git 权限               │
│  │   customRules: [{ tool, condition }], // 自定义规则        │
│  │   grantedBy: string,            // 谁授权的               │
│  │   grantedAt: number,            // 何时授权                │
│  │   expiresAt: number | null      // 过期时间(null=永久)    │
│  │ }                                                         │
│  ├ loadFromDisk() / saveToDisk()                            │
│  └ mergeWithDefaults(agentId, role, level)                 │
├────────────────────────────────────────────────────────────┤
│  PermissionManager (新增 — 权限管理器)                       │
│  ├ hasPermission(agentId, toolName) → boolean              │
│  ├ getPermissionSet(agentId) → PermissionSet              │
│  ├ grantTools(agentId, tools[], grantedBy)                 │
│  ├ revokeTools(agentId, tools[], revokedBy)                │
│  ├ grantCategory(agentId, category, grantedBy)             │
│  ├ revokeCategory(agentId, category, revokedBy)            │
│  ├ setFileAccess(agentId, paths[])                         │
│  ├ setShellAccess(agentId, enabled, blacklist[])           │
│  ├ setNetworkAccess(agentId, enabled)                      │
│  ├ setGitAccess(agentId, enabled, autoCommit)               │
│  ├ getAccessibleTools(agentId) → string[] // 最终可用列表   │
│  └ auditLog(agentId, action, toolName, by)                  │
├────────────────────────────────────────────────────────────┤
│  权限工具（供秘书管理）                                        │
│  ├ grant_permission    — 给员工开放工具权限                  │
│  ├ revoke_permission   — 撤销员工工具权限                    │
│  ├ list_permissions    — 查看某员工的权限列表                │
│  ├ list_all_permissions — 查看全公司权限分布                  │
│  └ permission_audit    — 查看权限变更历史                    │
└────────────────────────────────────────────────────────────┘
```

### 权限优先级（从高到低）

1. **deniedTools** — 明确禁止的个别工具（最高优先级，不可被覆盖）
2. **deniedCategories** — 明确禁止的 category
3. **allowedTools** — 明确允许的个别工具
4. **allowedCategories** — 明确允许的 category
5. **roleDefaults** — 角色默认权限（从 role + level 推导）
6. **secretaryOverride** — 秘书默认开放所有工具

### 角色默认权限矩阵

| Category | secretary | ceo | cto | cfo | chro | staff/manager |
|---|---|---|---|---|---|---|
| collaboration | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| chat | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| file | ✅ | ✅ | ✅ | ✅ | ✅ | ✅(受限路径) |
| shell | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| git | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| network | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| memory | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| context | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| todo | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| pm | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| operations | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| cfo | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| hr | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| recruit | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| suspension | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| dismiss_confirm | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| dev_plan_review | ✅ | ✅ | ✅ | ❌ | ❌ | manager+ |
| group_chat | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| math | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**秘书特殊规则**：secretaryOverride = 开放所有工具（所有 category + 所有单独工具），不受 roleDefaults 限制。

### 权限工具定义

#### grant_permission（授权）
```javascript
{
  name: 'grant_permission',
  description: `给员工开放工具权限。只有秘书和老板有权限使用此工具。

使用场景：
- 新员工入职后，为其分配工作所需的工具权限
- 员工职责变化时，开放新领域的工具权限
- 临时项目需要，开放额外工具权限

参数说明：
- agent_id: 员工 ID
- tools: 要开放的工具名列表（如 ['send_to_agent', 'write_file']）
- categories: 要开放的工具类别（如 ['file', 'git']）
- expires_at: 过期时间戳（不填=永久）
- reason: 授权原因（必填，会记录到审计日志）`,
  category: 'permission',
  parameters: {
    agent_id: { type: 'string', required: true },
    tools: { type: 'array', required: false },
    categories: { type: 'array', required: false },
    expires_at: { type: 'number', required: false },
    reason: { type: 'string', required: true }
  }
}
```

#### revoke_permission（撤权）
```javascript
{
  name: 'revoke_permission',
  description: `撤销员工的工具权限。只有秘书和老板有权限。
- 撤权后员工立即失去该工具的使用能力
- 撤权会记录到审计日志`,
  category: 'permission',
  parameters: {
    agent_id: { type: 'string', required: true },
    tools: { type: 'array', required: false },
    categories: { type: 'array', required: false },
    reason: { type: 'string', required: true }
  }
}
```

#### list_permissions（查看权限）
```javascript
{
  name: 'list_permissions',
  description: '查看某位员工的工具权限列表。包括已开放的工具、被禁止的工具、文件/Shell/网络/Git 访问权限。',
  category: 'permission',
  parameters: {
    agent_id: { type: 'string', required: true }
  }
}
```

#### list_all_permissions（全公司权限分布）
```javascript
{
  name: 'list_all_permissions',
  description: '查看全公司所有员工的权限分布概览。用于了解谁有什么权限，发现权限过大或过小的员工。',
  category: 'permission',
  parameters: {}
}
```

#### permission_audit（权限变更历史）
```javascript
{
  name: 'permission_audit',
  description: '查看权限变更历史记录。包括谁在什么时候给谁开放/撤销了什么权限。',
  category: 'permission',
  parameters: {
    agent_id: { type: 'string', description: '过滤特定员工（可选）', required: false },
    limit: { type: 'number', description: '返回条数（默认20）', required: false }
  }
}
```

### 招聘流程权限接入

当前 `recruit_request` 已有 `tools` 参数但没接入权限系统。改造：

```
招聘流程：
1. CTO 调 recruit_request(name, title, department, tools: ['write_file', 'shell_exec', 'git_commit'])
2. CHRO 审批 → agent_approve(approved: true)
3. approvalQueue.review() 通过后：
   → 创建 Agent 实例
   → 调 PermissionManager.grantTools(newAgentId, request.tools, grantedBy: 'chro')
   → 新员工自动获得招聘时指定的工具权限
4. 如果招聘时没填 tools 参数：
   → 使用角色默认权限（roleDefaults）
5. 秘书可以后续用 grant_permission 增减权限
```

### 权限检查流程

```
Agent 调用工具时：
1. tool-context.js getToolDefinitionsForAgent(agentId)
   → PermissionManager.getAccessibleTools(agentId)
   → 合并 roleDefaults + allowedTools + allowedCategories
   → 减去 deniedTools + deniedCategories
   → 返回最终可用工具列表

2. tool-executor.js executeToolCalls 执行前：
   → PermissionManager.hasPermission(agentId, toolName)
   → false → 返回 "你没有使用 [tool] 的权限，请联系秘书开通"
   → true → 执行

3. 文件/Shell/网络/Git 操作：
   → PermissionManager.checkFileAccess / checkShellAccess / ...
   → 沿用当前 PermissionChecker 逻辑，但数据源从 PermissionStore 读取
```

### 权限数据持久化

```javascript
// ~/.soloforge/data/<user>/<company>/permissions.json
{
  "version": 1,
  "agentPermissions": {
    "secretary": {
      "allowedCategories": ["*"],  // 秘书 = 全部
      "deniedTools": [],
      "grantedBy": "system",
      "grantedAt": 0,
      "expiresAt": null
    },
    "cto": {
      "allowedCategories": ["collaboration","chat","file","shell","git","network","memory","context","todo","pm","operations","recruit","dev_plan_review","group_chat","math"],
      "deniedCategories": ["cfo","hr","suspension","dismiss_confirm"],
      "allowedTools": [],
      "deniedTools": [],
      "fileAccess": {
        "allowedPaths": ["/Users/suichiku/Desktop/SoloForge"],
        "writeEnabled": true,
        "writeConfirm": false
      },
      "shellAccess": {
        "enabled": true,
        "blacklist": [],
        "confirmEach": false
      },
      "grantedBy": "system",
      "grantedAt": 0,
      "expiresAt": null
    }
    // ...其他 Agent
  },
  "auditLog": [
    {
      "id": "audit-xxx",
      "action": "grant",  // grant | revoke
      "agentId": "new-employee",
      "by": "secretary",
      "tools": ["write_file", "shell_exec"],
      "reason": "新员工入职，开发岗位需要文件和Shell权限",
      "timestamp": Date.now()
    }
  ]
}
```

### 权限工具的权限

| 工具 | 谁能用 |
|---|---|
| grant_permission | 秘书 + 老板（用户直接操作时由秘书代执行） |
| revoke_permission | 秘书 + 老板 |
| list_permissions | 秘书 + 老板 + 本人查自己 |
| list_all_permissions | 秘书 + 老板 |
| permission_audit | 秘书 + 老板 |

秘书是权限管理的中枢：老板告诉秘书需求 → 秘书执行授权/撤权 → 审计日志记录。

### 系统提示词更新

cxo-config.js 秘书系统提示词新增：

```
## 权限管理（你的核心职责之一）
- grant_permission: 给员工开放工具权限
- revoke_permission: 撤销员工工具权限
- list_permissions: 查看某员工的权限
- list_all_permissions: 查看全公司权限分布
- permission_audit: 查看权限变更历史

### 权限管理原则
1. 新员工入职时，根据招聘申请中指定的 tools 参数开放权限
2. 员工职责变化时，及时调整权限
3. 撤销权限时必须填写原因（会记录到审计日志）
4. 定期检查 list_all_permissions，发现权限过大或过小的员工
5. 默认情况下，员工只有基础权限（collaboration + chat + memory + todo）
6. 需要文件/Shell/Git 等高危权限时，必须有明确的工作需要
7. 临时权限设置 expires_at，到期自动失效
```

### 迁移路径（权限系统）

| # | 改动 | 文件 | 具体改法 |
|---|---|---|---|
| P1 | 新建 PermissionStore | src/main/permission/permission-store.js | 权限存储 + 持久化 |
| P2 | 新建 PermissionManager | src/main/permission/permission-manager.js | 权限检查 + 授权/撤权 + 审计 |
| P3 | 角色默认权限矩阵 | src/main/permission/role-defaults.js | 18个category × 6个role 的默认权限表 |
| P4 | 5个权限工具 | src/main/tools/permission-tools.js | grant/revoke/list/list_all/audit |
| P5 | 重构 tool-context.js | src/main/chat/tool-context.js:56-96 | 从硬编码 if 改为 PermissionManager.getAccessibleTools |
| P6 | 重构 permission-checker.js | src/main/tools/permission-checker.js | 数据源从全局 config 改为 PermissionStore |
| P7 | 招聘审批接入 | src/main/agent-factory/approval-queue.js | 审批通过后调 PermissionManager.grantTools |
| P8 | 秘书提示词更新 | src/main/chat/cxo-config.js / secretary-agent.js | 加入权限管理工具使用说明 |
| P9 | 权限工具注册 | src/main/tools/setup.js | 注册 5 个权限工具，category='permission' |
| P10 | 秘书默认全权限 | src/main/permission/role-defaults.js | secretaryOverride = ['*'] |

### 验证标准

| 场景 | 预期 |
|---|---|
| 秘书能用所有工具 | 秘书调任何工具都不被拒 |
| CTO 不能用 HR 工具 | CTO 调 hr_* 工具返回"无权限" |
| 新员工招聘时指定 tools | 入职后自动获得指定工具权限 |
| 秘书给员工开通 Shell | grant_permission 后员工立即能用 shell |
| 秘书撤销员工 Git | revoke_permission 后员工立即不能用 git |
| list_permissions 查某人 | 返回该员工所有工具/类别/文件权限 |
| list_all_permissions | 返回全公司权限矩阵概览 |
| permission_audit | 返回权限变更历史（谁何时给谁授权/撤权） |
| 临时权限过期 | expires_at 到期后自动失效 |
| get_team_status | 实时显示团队工作负载 |

---

## 跨 Agent 记忆一致性

### 问题

用户场景："我让秘书给 CEO 发了消息，跑过去问 CEO，CEO 应该知道这件事。"

当前有两个问题导致 CEO 可能"不知道"：

1. **notify_boss 不写入记忆**：`notify_boss` 只调 `pushProactiveMessage`（纯 UI 推送），不触发记忆提取。秘书用 notify_boss 向老板汇报后，老板的记忆里没有这条记录。

2. **记忆提取异步+延迟**：`send_to_agent` 虽然触发 `_triggerMemoryExtraction('communication', ...)`，但这是 `setImmediate` 异步 + 有节流 + 需要 LLM 调用提取。秘书刚发完消息，CEO 的记忆可能还没提取完。

3. **记忆检索依赖关键词匹配**：`getContextForAgent(ceo, "秘书给你发了什么", conversationId)` 调 `recall(message, {agentId:'ceo'})`，用消息内容做关键词匹配检索。如果用户问的话和记忆的 summary 用词不同，可能检索不到。

### 设计方案：即时通信记忆

核心思路：Agent 间通信不只靠异步 LLM 提取记忆，而是**通信本身直接写入结构化事件记录**，所有相关 Agent 都能即时查到。

#### 1. CommunicationEventStore（新增 — 通信事件存储）

```javascript
// 主进程：通信事件存储
class CommunicationEventStore {
  // 每次通信（send_to_agent / notify_boss / post_to_group / delegate_task）都写一条事件
  // 不是靠 LLM 提取，而是直接写入结构化记录

  append(event) {
    // event = {
    //   id, type: 'message'|'delegation'|'group_post'|'report',
    //   from, to, content, response,
    //   traceId, timestamp,
    //   conversationId, groupId  // 私聊 or 群聊
    // }
    // 写入内存 Map + 持久化到 disk
  }

  getEventsForAgent(agentId, { limit, since }) {
    // 返回所有涉及该 Agent 的事件（from 或 to 是它）
    // 按时间倒序
  }

  getEventsBetween(agentA, agentB, { limit }) {
    // 返回两人之间的所有通信
  }

  getGroupEvents(groupId, { limit }) {
    // 返回群聊所有事件
  }
}
```

#### 2. 注入到 Agent 上下文

当用户去问 CEO 时，`handleStreamMessage` 构建 CEO 的上下文：

```
当前（问题）：
  CEO 上下文 = systemPrompt + memoryContext（异步提取的记忆，可能还没提取完） + 用户消息

改后：
  CEO 上下文 = systemPrompt
    + communicationEvents（即时结构化记录，"秘书张三在 14:30 给你发了：xxx"）
    + memoryContext（异步 LLM 提取的记忆，有就用，没有不阻塞）
    + 用户消息
```

通信事件注入格式（注入到 CEO 的 systemPrompt 或上下文）：

```
## 最近的通信记录
- [14:30] 秘书(小秘) 给你发了消息："老板，CTO 说技术方案需要 3 天"
  你的回复："好的，让他按时完成"
- [14:25] CTO(李工) 向你汇报："技术评估完成，预计 3 天"
  你的回复："批准"
- [14:00] 群聊(技术部) 讨论：CTO 发言 "方案A 更可行" @李工 @张三
  李工 回复："同意方案A"
```

#### 3. 通信工具统一接入

所有通信工具调用后都写入 CommunicationEventStore：

| 工具 | 当前是否写记忆 | 改后 |
|---|---|---|
| `send_to_agent` | 异步 LLM 提取（可能延迟） | 即时写事件 + 异步 LLM 提取（双保险） |
| `notify_boss` | 不写 | 即时写事件 |
| `delegate_task` | 异步 LLM 提取 | 即时写事件 + 异步 LLM 提取 |
| `post_to_group` | 不写（新工具） | 即时写事件 |
| `post_to_department` | 不写 | 即时写事件 |

#### 4. 检索策略

当 Agent 被触发时（用户私聊 / 群聊 @ / 被委派），构建上下文：

```javascript
function buildAgentContext(agentId, triggerMessage, conversationId) {
  // 1. 即时通信事件（不依赖 LLM，不延迟）
  const recentEvents = commEventStore.getEventsForAgent(agentId, { limit: 10, since: Date.now() - 3600000 });
  const eventContext = formatEventsAsContext(recentEvents);
  // "## 最近的通信记录\n- [14:30] 秘书给你发了..."

  // 2. LLM 提取的记忆（异步，有就用）
  const memoryContext = memoryManager.getContextForAgent(agentId, triggerMessage, conversationId);

  // 3. 拼接
  return `${eventContext}\n\n${memoryContext || ''}\n\n---\n\n${triggerMessage}`;
}
```

#### 5. 持久化

```javascript
// ~/.soloforge/data/<user>/<company>/communication-events.json
{
  "version": 1,
  "events": [
    {
      "id": "evt-xxx",
      "type": "message",
      "from": "secretary",
      "to": "ceo",
      "content": "老板，CTO 说技术方案需要 3 天",
      "response": "好的，让他按时完成",
      "traceId": "trace-xxx",
      "conversationId": "private-secretary-ceo",
      "timestamp": 1784486200000
    }
  ]
}
```

- 每 Agent 可查自己涉及的通信事件
- 崩溃后可恢复
- 可按时间范围/对话/Agent 筛选
- 不依赖 LLM 提取（即时可用）

#### 6. 记忆 vs 通信事件的区别

| 维度 | LLM 提取的记忆 | 通信事件 |
|---|---|---|
| 何时写入 | 异步，通信后几秒~几分钟 | 即时，通信发生时立即写 |
| 写什么 | LLM 判断"值得记住的"摘要 | 原始通信内容（谁对谁说了什么） |
| 依赖 | 需要 LLM 调用（有成本+延迟） | 不需要 LLM，直接记录 |
| 检索 | 关键词/标签匹配 | 按 Agent/时间/类型精确查询 |
| 用途 | "经验教训""关键决策"等抽象记忆 | "谁在什么时候给谁发了什么"事实记录 |

两者互补：通信事件保证即时性（CEO 立刻"知道"），LLM 记忆保证抽象性（CEO "理解"这件事的意义）。

### 验证标准

| 场景 | 预期 |
|---|---|
| 秘书用 send_to_agent 给 CEO 发消息 | CEO 通信事件立即写入 |
| 秘书用 notify_boss 向老板汇报 | 老板通信事件立即写入 |
| 用户立刻去问 CEO "秘书给你发了什么" | CEO 能从通信事件中回答（不依赖异步记忆提取） |
| CEO 被问"最近有什么事" | 返回最近 10 条通信事件作为上下文 |
| CTO 在群里发言后用户问 CTO "你在群里说了什么" | CTO 能从通信事件中回答 |
| 崩溃后恢复 | 通信事件从磁盘恢复，历史不丢 |
| 1 小时前的通信 | 通信事件按时间范围查询 |
