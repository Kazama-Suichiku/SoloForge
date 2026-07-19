# 多 Agent 协作架构重构 — 执行计划

> 设计方案：docs/refactor/multi-agent-architecture-plan.md（1135行）
> 调研报告：docs/refactor/multi-agent-communication-audit.md + docs/refactor/group-chat-audit.md
> 执行方式：并行子代理分批执行，每批文件范围严格不重叠

## 执行总览

```
Phase 0：紧急修复（串行→并行+记忆即时写入）     ← 先做，立刻见效
Phase 1：基础设施（MessageBus + Mailbox + EventStore + OrgChart）
Phase 2：权限系统（PermissionStore + 5个权限工具）
Phase 3：群聊重构（GroupQueue + post_to_group + GroupHistoryStore）
Phase 4：组织架构工具（8个新工具）
Phase 5：接入 + 提示词 + 集成测试
```

---

## Phase 0：紧急修复（1批，直接执行）

**目标**：修最痛的问题——串行→并行、记忆即时写入、CHAT_COMPLETE success、预算

### 0-A：通信工具并行 + 记忆即时写入

| 文件 | 改动 |
|---|---|
| `src/main/tools/tool-executor.js:771` | 通信类工具（send_to_agent/post_to_department）用 Promise.all 并行，非通信类保持串行 |
| `src/main/chat/secretary-agent.js:26-60` | analyzeForDelegation 支持返回多个目标 |
| `src/main/chat/chat-manager.js:422-448` | 移除命中即返回，让秘书自主用工具发多人 |
| `src/main/chat/department-group.js:25,29` | 冷却 30s→10s，速率限制 3→10 |
| `src/main/chat/chat-manager.js:516` | handleStreamMessage 注入通信历史到 Agent 上下文 |
| `src/main/collaboration/agent-messaging.js:473` | sendMessage 完成后即时写通信记录到 agent-communication.js messages[]（已有），并确保 notify_boss 也写 |
| `src/main/tools/collaboration-tools.js:654` | notify_boss execute 里加通信记录写入 |
| `src/renderer/hooks/useChatAgent.js:275` | handleGroupChat 的 for...of await 串行保持（Phase 0 不改渲染进程逻辑，只改主进程并行） |

### 0-B：CHAT_COMPLETE 修复（已做，验证）

| 文件 | 改动 |
|---|---|
| `src/main/chat/stream-handler.js:140` | 已加 success:true（验证生效） |
| `src/main/chat/chat-manager.js:594` | 已加 success:true（验证生效） |

### 0-C：预算修复（已做，验证）

| 文件 | 改动 |
|---|---|
| `src/main/budget/budget-manager.js:64` | assistant 日薪 30000→500000 |
| `budgets.json` | 小秘 balance 重置 |

**验证**：秘书给4人发消息，4人都能收到+回复；去问CEO，CEO知道秘书发了什么。

---

## Phase 1：基础设施（3批并行）

### 1-A：MessageBus + AgentMailbox

**新建文件**：
- `src/main/collaboration/message-bus.js` — publish/request/broadcast/subscribe/reply
- `src/main/collaboration/agent-mailbox.js` — 消息对象队列 + 串行处理 + 容量上限

**改动文件**：
- `src/main/collaboration/message-queue.js` — 从闭包队列改为消息对象队列（或新建替代）
- `src/main/collaboration/agent-messaging.js` — sendMessage 基于 MessageBus 实现 sync/async
- `src/main/collaboration/task-delegation.js` — delegateTask 基于 MessageBus 实现

**不碰**：tool-executor.js, collaboration-tools.js, chat-manager.js, 渲染进程

### 1-B：CommunicationEventStore + 上下文注入

**新建文件**：
- `src/main/collaboration/comm-event-store.js` — 通信事件存储 + 持久化 + 按 Agent 查询

**改动文件**：
- `src/main/chat/chat-manager.js` — handleStreamMessage 注入通信事件到 Agent 上下文
- `src/main/tools/collaboration-tools.js` — send_to_agent/notify_boss/delegate_task/post_to_department execute 后写通信事件
- `src/main/collaboration/agent-messaging.js` — sendMessage 完成后写通信事件

**不碰**：message-bus.js, agent-mailbox.js, message-queue.js, 渲染进程

### 1-C：OrgChartService + agent-config reportsTo

**新建文件**：
- `src/main/collaboration/org-chart-service.js` — 从 agent-config 推导组织树 + 上下级关系

**改动文件**：
- `src/main/config/agent-config-store.js` — DEFAULT_AGENT_CONFIGS 加 reportsTo 字段
- `src/main/tools/collaboration-tools.js` — list_colleagues 从 OrgChartService 推导 reportsTo（注意：和 1-B 共享文件，用 additive patch，不冲突的区域）

**不碰**：message-bus.js, comm-event-store.js, chat-manager.js, 渲染进程

**冲突管理**：1-B 和 1-C 都改 collaboration-tools.js。1-B 改的是 send_to_agent/notify_boss 区域，1-C 改的是 list_colleagues 区域。不重叠。如果子代理都改同一文件，由父代理做 additive patch 合并。

---

## Phase 2：权限系统（1批，3个子代理并行）

### 2-A：PermissionStore + RoleDefaults

**新建文件**：
- `src/main/permission/permission-store.js` — 权限数据持久化
- `src/main/permission/role-defaults.js` — 18 category × 6 role 默认权限矩阵

**不碰**：其他所有文件

### 2-B：PermissionManager + 5个权限工具

**新建文件**：
- `src/main/permission/permission-manager.js` — 权限检查 + 授权/撤权 + 审计
- `src/main/tools/permission-tools.js` — grant/revoke/list/list_all/audit 5个工具

**不碰**：permission-store.js, role-defaults.js, 其他所有文件

### 2-C：接入现有系统

**改动文件**：
- `src/main/chat/tool-context.js:56-96` — 从硬编码 if 改为 PermissionManager.getAccessibleTools
- `src/main/tools/permission-checker.js` — 数据源从全局 config 改为 PermissionStore
- `src/main/agent-factory/approval-queue.js` — 审批通过后调 PermissionManager.grantTools
- `src/main/tools/setup.js` — 注册 5 个权限工具
- `src/main/chat/cxo-config.js` — 秘书系统提示词加权限管理说明

**依赖**：2-A 和 2-B 必须先完成。2-C 在 2-A/2-B 完成后执行。

**执行顺序**：2-A + 2-B 并行 → 完成后 2-C 单独执行

---

## Phase 3：群聊重构（1批，2个子代理并行）

### 3-A：GroupQueue + GroupHistoryStore + post_to_group

**新建文件**：
- `src/main/chat/group-queue.js` — 排队串行触发 + 防循环
- `src/main/chat/group-history-store.js` — 群聊历史持久化

**改动文件**：
- `src/main/tools/collaboration-tools.js` — 新增 post_to_group + get_group_history 工具 + post_to_department 改调 GroupQueue
- `src/main/chat/department-group.js` — postToDepartment 改调 GroupQueue.submit
- `src/main/chat-ipc-handlers.js` — 群聊消息改主进程 GroupQueue 推送

**不碰**：渲染进程 hooks, permission/, message-bus.js

### 3-B：渲染进程群聊改造

**改动文件**：
- `src/renderer/hooks/useChatAgent.js` — 删除 handleGroupChat，群聊触发移到主进程
- `src/renderer/hooks/useAgentIpcEvents.js` — 群聊事件改监听主进程 GROUP_QUEUE_TRIGGER
- `src/renderer/hooks/chat-agent-logic.js` — 删除 filterNewMentions/repliedAgents/buildHistoryFromMessages（移到主进程）
- `src/shared/ipc-channels.js` — 新增 GROUP_QUEUE_TRIGGER 通道
- `src/preload/preload.js` — 暴露群聊新通道

**依赖**：3-A 先完成（GroupQueue 就绪），3-B 才能接

**执行顺序**：3-A 先 → 完成后 3-B

---

## Phase 4：组织架构工具 + 提示词（1批，2个子代理并行）

### 4-A：8个组织架构工具

**新建文件**：
- `src/main/tools/org-chart-tools.js` — get_org_chart/get_subordinates/get_direct_report/escalate/request_cross_dept_collab/broadcast_to_subordinates/get_reporting_chain/get_team_status

**改动文件**：
- `src/main/tools/setup.js` — 注册 8 个新工具
- `src/main/collaboration/org-chart-service.js` — 补充 getTeamStatus 方法（查 Agent 当前任务负载）

**不碰**：permission/, group-queue.js, chat-manager.js, 渲染进程

### 4-B：提示词更新

**改动文件**：
- `src/main/chat/cxo-config.js` — 所有 Agent 系统提示词加：群聊规则 + 新工具说明 + 权限管理说明
- `src/main/chat/secretary-agent.js` — 秘书提示词加权限管理 + 多委派说明
- `src/main/chat/collaboration-prompt.js` — 协作提示词更新

**不碰**：org-chart-tools.js, setup.js, permission/, group-queue.js

---

## Phase 5：集成 + 测试（1批）

### 5-A：TraceStore + traceId 跨 Agent

**新建文件**：
- `src/main/collaboration/trace-store.js` — span 存储 + trace 查询

**改动文件**：
- `src/main/chat/chat-manager.js` — handleStreamMessage 入口 startSpan
- `src/main/collaboration/message-bus.js` — publish/request 携带 traceId+parentSpanId

### 5-B：集成测试 + 冒烟

**测试场景**（手动或脚本）：
1. 秘书给4人发消息 → 4人都能收到
2. 秘书给CEO发消息 → 去问CEO，CEO知道
3. 用户在群里@CTO和李工 → 两人按顺序排队发言
4. CTO在群里@李工 → 李工自动排队发言
5. 秘书给员工开通Shell权限 → 员工立刻能用
6. 招聘新员工指定tools → 入职后自动获得权限
7. get_org_chart → 返回完整组织树
8. escalate → 越级上报到上级的上级
9. 100条并发消息 → 背压控制不崩（如果 Phase 1 含 BackpressureController）

---

## 文件分工矩阵（防冲突）

| 文件 | P0 | P1-A | P1-B | P1-C | P2-C | P3-A | P3-B | P4-A | P4-B | P5-A |
|---|---|---|---|---|---|---|---|---|---|---|
| tool-executor.js | ✅改 | | | | | | | | | |
| secretary-agent.js | ✅改 | | | | | | | | ✅改 | |
| chat-manager.js | ✅改 | | ✅改 | | | | | | | ✅改 |
| department-group.js | ✅改 | | | | | ✅改 | | | | |
| agent-messaging.js | | ✅改 | ✅改 | | | | | | | |
| task-delegation.js | | ✅改 | | | | | | | | |
| collaboration-tools.js | ✅改 | | ✅改 | ✅改 | | ✅改 | | | | |
| tool-context.js | | | | | ✅改 | | | | | |
| permission-checker.js | | | | | ✅改 | | | | | |
| approval-queue.js | | | | | ✅改 | | | | | |
| setup.js | | | | | ✅改 | | | ✅改 | | |
| cxo-config.js | | | | | ✅改 | | | | ✅改 | |
| useChatAgent.js | | | | | | | ✅改 | | | |
| useAgentIpcEvents.js | | | | | | | ✅改 | | | |
| chat-agent-logic.js | | | | | | | ✅改 | | | |
| ipc-channels.js | | | | | | | ✅改 | | | |
| preload.js | | | | | | | ✅改 | | | |
| chat-ipc-handlers.js | ✅改 | | | | | ✅改 | | | | |
| message-queue.js | | ✅改 | | | | | | | | |
| agent-config-store.js | | | | ✅改 | | | | | | |
| message-bus.js (新) | | ✅建 | | | | | | | | |
| agent-mailbox.js (新) | | ✅建 | | | | | | | | |
| comm-event-store.js (新) | | | ✅建 | | | | | | | |
| org-chart-service.js (新) | | | | ✅建 | | | | ✅改 | | |
| permission-store.js (新) | | | | | | | | | | |
| permission-manager.js (新) | | | | | | | | | | |
| role-defaults.js (新) | | | | | | | | | | |
| permission-tools.js (新) | | | | | | | | | | |
| group-queue.js (新) | | | | | | ✅建 | | | | |
| group-history-store.js (新) | | | | | | ✅建 | | | | |
| org-chart-tools.js (新) | | | | | | | | ✅建 | | |
| trace-store.js (新) | | | | | | | | | | ✅建 |

**规则**：同一 Phase 内，同一文件最多被一个子代理改。跨 Phase 的修改串行执行（前一个 Phase 完成后再开始下一个）。

---

## 执行顺序

```
Phase 0（紧急修复）
  └─ 1个子代理，直接执行（不并行，改动集中）
  └─ 验证：秘书给4人发消息都能收到+CEO知道

Phase 1（基础设施）— 3个并行子代理
  ├─ 1-A: MessageBus + AgentMailbox
  ├─ 1-B: CommunicationEventStore + 上下文注入
  └─ 1-C: OrgChartService + reportsTo
  └─ 父代理合并 collaboration-tools.js 的 additive patch

Phase 2（权限系统）
  ├─ 2-A + 2-B 并行（无文件冲突）
  └─ 2-C 单独（依赖 2-A/2-B 完成）

Phase 3（群聊重构）
  ├─ 3-A 先（GroupQueue + 工具）
  └─ 3-B 后（渲染进程接入）

Phase 4（组织架构工具 + 提示词）— 2个并行子代理
  ├─ 4-A: 8个组织架构工具
  └─ 4-B: 提示词更新

Phase 5（集成 + traceId + 测试）
  └─ 5-A: TraceStore + 集成测试
```

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| Phase 1 MessageBus 替换现有通信导致回归 | 保留旧接口签名，内部转调 MessageBus；分步替换 |
| Phase 3 渲染进程 handleGroupChat 删除后群聊不工作 | 先验证主进程 GroupQueue 工作，再删渲染进程 |
| collaboration-tools.js 多个子代理同时改 | 父代理做 additive patch 合并，子代理只改各自区域 |
| 权限系统替换 tool-context 硬编码导致工具不可用 | 保留 roleDefaults 作为 fallback，PermissionManager 读不到权限时用默认 |

## 预期时间

| Phase | 预估 | 子代理数 |
|---|---|---|
| 0 | 1轮派遣 | 1 |
| 1 | 1轮派遣 | 3并行 |
| 2 | 2轮派遣 | 2并行+1单独 |
| 3 | 2轮派遣 | 1+1串行 |
| 4 | 1轮派遣 | 2并行 |
| 5 | 1轮派遣 | 1 |
| 总计 | ~8轮派遣 | ~13个子代理 |
