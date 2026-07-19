# SoloForge 架构健康诊断报告（CTO 汇总）

> 4 个维度并行诊断的 CTO 汇总。完整子报告见：
> - `docs/refactor/renderer-architecture-report.md`（前端）
> - `docs/refactor/SOLOFORGE_AGENT_DIAGNOSIS.md`（Agent 框架与通信）
> 本文件汇总后端与云同步诊断 + 跨维度系统性问题 + 重构路线图。

## 一、诊断总览

| 维度 | 高危 | 中危 | 低危 |
|---|---:|---:|---:|
| 前端/渲染层 | 6 | 8 | 4 |
| Agent 框架与通信 | 6 | 8+ | — |
| 主进程后端 | 12 | 9 | 4 |
| 云同步与一致性 | 9 | 10 | 2 |
| **合计** | **33** | **35+** | **10** |

## 二、跨维度系统性问题

### S1. 双轨 Agent 抽象
- `agents/base-agent.js` 只注册 Writer/Reviewer
- 5 个 C-Level + 动态 Agent 全走 `chat/chat-agent.js`
- 三套状态机并存：idle/running、thinking/tools、active/suspended/terminated
- 新增 Agent 需改 8 处

### S2. 上帝对象
| 文件 | 行数 | 职责数 |
|---|---:|---|
| `collaboration/agent-communication.js` | 2,383 | 7 |
| `chat/chat-manager.js` | 2,330 | 单方法 515 行 |
| `main.js` | 655 | 12 |
| `tools/hr-tools.js` | 2,966 | 16 个工具 |

### S3. `_chatWithToolLoop` 三份重复
- `agent-communication.js:532-686`
- `chat-manager.js:1316-1491`
- `chat-manager.js:2014-2288`
- 600+ 行核心逻辑 90% 重复

### S4. 权限层默认放行
- `permission-checker.js:328-372` default: { allowed: true }
- 122 个工具只有 ~15 个有 case，100+ 默认放行

### S5. 持久化连锁缺陷
1. 防抖丢数据：budget/token-tracker/agent-config/agent-communication 未在退出钩子 flush
2. SIGINT/SIGTERM 绕过 before-quit：process.exit(0)
3. atomicWrite 并发写同一 .tmp：固定名，并发写损坏
4. Windows rename 非原子：无 EPERM/EXDEV 回退
5. chat-history 单文件 stringify 阻塞主进程

### S6. LLM 层正确性 bug
1. Anthropic usage 统计全 0：duojie-provider.js:313-328 分支顺序错误
2. 429 限流未重试：isRetryableError 不含 429
3. 降级链与模型兼容性脱耦：duojie 挂了降级到 deepseek 但不认识 claude-sonnet-4-5
4. 返回类型不统一：duojie 返回 string 或 object，deepseek 始终 object

### S7. 云同步是"假双轨" + 高危安全
- Supabase 路径是死代码：.env 未配 SUPABASE_URL
- 5 个高危安全：SYNC_SECRET 硬编码、SHA-256+静态盐、/auth/profile 仅凭 userId、/sync/* 无 token、CORS 全开
- 4 个高危数据正确性：软删除复活、LWW 字段级丢数据、时钟漂移、全量回推覆盖

## 三、重构路线图

### Phase 0：紧急修复（1-2 周，不改架构）

| # | 任务 | 位置 |
|---|---|---|
| P0-1 | SYNC_SECRET 移 wrangler secret，/app/publish 改 Header | cloud-sync/wrangler.toml:11 |
| P0-2 | 修复 Anthropic usage 统计全 0 | llm/duojie-provider.js:313-328 |
| P0-3 | 统一退出钩子，补全 6 个 store flush，SIGINT/SIGTERM 改 app.quit() | main.js:636-655 |
| P0-4 | atomicWrite 临时文件名加 process.pid + Date.now() | utils/atomic-write.js |
| P0-5 | 加全局 uncaughtException + unhandledRejection | main.js |
| P0-6 | IPC handler 统一 safeHandler 包装 | 所有 *-ipc-handlers.js |
| P0-7 | 权限层默认拒绝，显式白名单 | permissions/permission-checker.js |
| P0-8 | pmEngine 加 _checking 重入保护 | pm/pm-engine.js |
| P0-9 | LLM 429 重试 + Retry-After | llm/llm-manager.js |
| P0-10 | 云同步软删除修复：本地软删除 + push 带删除标记 | sync/cloud-sync.js |
| P0-11 | 云同步服务端覆盖 updated_at | cloud-sync/src/index.ts |
| P0-12 | 云同步密码哈希换 PBKDF2 + 随机盐，加 token 鉴权 | cloud-sync/src/index.ts |

### Phase 1：收敛与拆分（2-4 周）

| # | 任务 | 前置 |
|---|---|---|
| P1-1 | 删除 Supabase 死代码（7 文件 + main.js 引用 + @supabase/supabase-js） | P0 |
| P1-2 | 拆 main.js 655 行为 7 个模块 | P0 |
| P1-3 | 拆 agent-communication.js 2383 行为 8 个模块 | P0 |
| P1-4 | 拆 chat-manager.js 2330 行为 5 个模块 | P0 |
| P1-5 | 抽 ToolLoopRunner 合并 3 份重复 | P1-3, P1-4 |
| P1-6 | 拆 hr-tools.js 2966 行为 6 个文件 | P0 |
| P1-7 | 合并双轨 Agent，统一 BaseAgent 与 ChatAgent | P1-3, P1-4 |
| P1-8 | 拆前端大组件（Dashboard/MessageList/ChatInput/ToolCallCard） | P0 |
| P1-9 | 抽 useChatAgent：业务逻辑与 IPC 订阅分离 | P1-8 |
| P1-10 | 公司切换重构：统一 Store 接口，initOrder 数组声明依赖 | P1-2 |

### Phase 2：架构升级（1-2 月）

| # | 任务 | 前置 |
|---|---|---|
| P2-1 | LLM 层重构：基类 checkHealth，统一返回类型，降级链加模型兼容性，fallbackOrder 从 env 读 | P1 |
| P2-2 | 工具系统重构：统一超时/重试/结果大小硬上限（token 级） | P1 |
| P2-3 | C-Level Agent 数据驱动工厂，消除 6 处复制粘贴 | P1-7 |
| P2-4 | 云同步 schema 升级：补 users/app_versions 表，加复合索引，加 server_rev，加 company_id | P0-10, P0-11 |
| P2-5 | 云同步 push 加 dirty 标记 | P0-10 |
| P2-6 | 扩大同步范围：operations/projects/budgets 进 D1，memory 走 Vectorize，attachments 走 R2 | P2-4 |
| P2-7 | 前端性能：MessageList 虚拟化，流式 buffer 移出 store，Dashboard 定时器清理 | P1-8 |
| P2-8 | 类型安全：ipc-types.d.ts 补全，主进程 store 层上 TS | P1 |
| P2-9 | 可观测性：traceId 贯穿 Agent→工具链，logger 落盘，工具审计表 | P1 |
| P2-10 | 主进程测试：atomic-write 并发、LLM 降级链、公司切换、pmEngine 重入 | P1 |

### Phase 3：体验优化（季度内）

| # | 任务 |
|---|---|
| P3-1 | 云同步状态 UI |
| P3-2 | 冲突 diff UI |
| P3-3 | 移动端源码入仓 |
| P3-4 | 设备管理 UI |
| P3-5 | Worker Rate Limiting + 错误脱敏 |
| P3-6 | 群聊代码强制路由 |
| P3-7 | DI 容器破循环依赖 |
| P3-8 | i18n |

## 四、最高优先级 Top 10

1. SYNC_SECRET 移 secret + /app/publish 改 Header（供应链投毒）
2. 云同步密码哈希换 PBKDF2 + token 鉴权（越权读写）
3. Anthropic usage 统计修复（Claude/GLM 免费调用）
4. 统一退出钩子 + 补全 6 个 store flush（数据丢失）
5. atomicWrite 临时文件名唯一化（数据损坏）
6. 权限层默认拒绝（100+ 工具默认放行）
7. 云同步服务端覆盖 updated_at（时钟漂移）
8. 云同步软删除修复（已删会话复活）
9. pmEngine 重入保护（数据竞争）
10. IPC handler 统一 safeHandler（堆栈泄露）

## 五、产物索引

- `docs/refactor/renderer-architecture-report.md` — 前端完整诊断（26 KB）
- `docs/refactor/SOLOFORGE_AGENT_DIAGNOSIS.md` — Agent 框架完整诊断（38 KB）
- 本文件 — CTO 汇总 + 后端/云同步诊断 + 路线图
