# SoloForge 记忆系统对齐文档

> 对齐目标：从当前实现到生产级 AI Agent 记忆系统
> 参考依据：`memory-reference.md`（VCP / Zep / Letta / A-MEM / TencentDB 调研）
> 调研日期：2026-07-20
> 约束：本文档只做差距分析与改造方案，不改代码

---

## 1. SoloForge 当前记忆系统现状

### 1.1 模块结构

```
src/main/memory/
├── index.js              # 导出
├── memory-manager.js     # 495行，统一 CRUD，协调各子模块
├── memory-store.js       # 649行，JSON 文件读写 + 索引 + 防抖写入
├── memory-retriever.js   # 316行，关键词匹配 + 加权混合排序
├── memory-extractor.js   # 469行，LLM 提取对话/任务记忆
├── memory-summarizer.js  # 413行，对话摘要 + 短期→长期归档 + 相似合并
├── memory-decay.js       # 202行，指数衰减 + 强化 + 淘汰
├── memory-types.js       # 425行，类型枚举 + 工厂 + 配置
└── memory-ipc-handlers.js# 92行，渲染进程 IPC
```

### 1.2 记忆模型

**记忆类型（12 种）**：decision / fact / preference / project_context / lesson / expertise / conversation_summary / task_result / procedure / user_profile / company_fact / consensus

**可见范围（3 级）**：agent（仅归属 Agent）/ user（用户相关）/ shared（所有 Agent）

**来源（5 类）**：conversation / task / communication / manual / system

**存储分层**：short-term/（conversation_summary、task_result）/ long-term/（decision、fact、preference、lesson、procedure）/ shared/（company_fact、project_context、consensus）/ agents/ / user/

### 1.3 存储方式

- **纯 JSON 文件**，按类型分文件存储
- 内存索引 Map（启动加载），查询不走磁盘
- 文件内容缓存 Map，防抖写入（`DEBOUNCE_MS`），索引独立防抖
- 异步 `fs.writeFile`，不阻塞主进程
- 目录：`<basePath>/memory/{short-term,long-term,shared,agents,user}/`

### 1.4 检索方式（memory-retriever.js）

**纯关键词匹配 + 加权混合排序**，权重：
```
KEYWORD: 0.40   // 关键词匹配
RECENCY: 0.20   // 时间衰减（λ=0.05，e^(-λ·days)）
IMPORTANCE: 0.25 // 重要性字段
ACCESS: 0.15     // 访问频率（accessCount/10）
```

关键词提取：英文按空格+连字符；中文按 2-3 字滑动窗口 n-gram；去停用词、去重。匹配打分：标签精确匹配 +0.3，摘要包含匹配 +0.1。

### 1.5 提取/摘要（LLM 驱动）

- **提取**：`EXTRACTION_PROMPT` 让 LLM 从对话中提取 ≤5 条结构化记忆（type/content/summary/tags/importance），异步 + 节流（防同对话频繁提取）+ 去重缓存（最近 200 条摘要）
- **摘要**：`CONVERSATION_SUMMARY_PROMPT` 取最近 30 条消息生成 100-300 字摘要；`MERGE_PROMPT` 合并相似记忆
- **归档**：短期→长期归档

### 1.6 衰减/淘汰（memory-decay.js）

公式：`effectiveScore = importance × (1 + log(1 + accessCount)) × e^(-λ·daysSinceLastAccess)`
- 低于 `ARCHIVE_THRESHOLD` 标记 `archived: true`
- 强化机制：被检索注入上下文时 `accessCount++` + 更新 `lastAccessedAt`
- 定时维护任务周期运行

### 1.7 跨 Agent（架构计划中的设计，尚未实现）

`docs/refactor/multi-agent-architecture-plan.md` 已诊断出跨 Agent 记忆一致性的三大问题：
1. `notify_boss` 不写记忆
2. 记忆提取异步+延迟（`setImmediate` + 节流 + LLM 调用），秘书刚发完 CEO 记忆可能还没提取完
3. 检索依赖关键词匹配，用词不同就检索不到

计划方案：**CommunicationEventStore**（即时结构化事件记录，不依赖 LLM）+ 通信工具统一接入（`send_to_agent`/`notify_boss`/`delegate_task`/`post_to_group`/`post_to_department` 全部即时写事件）+ 注入 Agent 上下文（即时事件 + 异步 LLM 记忆双保险）+ 持久化到 `communication-events.json`。但此方案**尚未落地**。

---

## 2. 与主流方案的差距清单

| # | 能力维度 | SoloForge 现状 | VCP | Zep/Graphiti | Letta | 差距等级 |
|---|---|---|---|---|---|---|
| G1 | **检索方式** | 纯关键词匹配（n-gram） | 向量+图传播+BM25+Rerank | 语义+关键词+图遍历 | 向量 | 🔴 严重 |
| G2 | **存储引擎** | JSON 文件 + 内存 Map | SQLite WAL + Rust USearch HNSW | Neo4j + 向量 | Postgres+pgvector | 🔴 严重 |
| G3 | **语义检索/Embedding** | 无 | 有，含模型签名防错 | 有 | 有 | 🔴 严重 |
| G4 | **记忆图谱/关联** | 无（仅 tags 数组） | 标签共现图 + 图传播 | 实体-关系-事实图 | 无强图谱 | 🔴 严重 |
| G5 | **时态/版本管理** | 无 | 无 | ✅ 有效时间窗口 | 无 | 🟡 中（Zep 独有优势） |
| G6 | **溯源/血缘** | 无 | ⚠️ | ✅ episode 溯源 | ⚠️ | 🟡 中 |
| G7 | **上下文折叠/压缩** | 无（靠 summary 字段） | ContextFoldingV2 异步折叠 | ⚠️ | 反思压缩 | 🔴 严重 |
| G8 | **跨 Agent 即时性** | 异步 LLM 提取有延迟 | OneRing 跨端连续 | 多用户 | ⚠️ | 🔴 严重（计划已诊断） |
| G9 | **混合检索** | 单一关键词 | BM25+语义+重排 | 语义+关键词+图 | 语义 | 🔴 严重 |
| G10 | **增量持久化** | 全量 JSON 重写 | 增量 WAL + 差分同步 | 增量图 | 事务 | 🟡 中 |
| G11 | **性能** | 内存 Map 快，但规模受限 | 十万级 tag 毫秒级 | <200ms | 中 | 🟡 中 |
| G12 | **自演化** | 有相似合并（LLM） | AgentDream + 派生任务 | 增量图自更新 | 自编辑记忆 | 🟢 小 |
| G13 | **多模态** | 无 | 附件链接 | ⚠️ | ⚠️ | 🟡 中 |
| G14 | **冷热知识分离** | 有 long-term/shared 分目录 | 热记忆 + TDB 冷知识库 | ⚠️ | archival | 🟢 小 |
| G15 | **主动回忆工具** | 无（仅被动 recall） | LightMemo/DeepMemo/TopicMemo | ⚠️ | archival_memory_search | 🟡 中 |

**🔴 严重差距（6 项）**：G1 检索、G2 存储、G3 Embedding、G4 图谱、G7 折叠、G8 跨 Agent 即时性。这六项是阻碍 SoloForge 进入生产级的核心瓶颈。

---

## 3. 生产级记忆系统能力清单

一个生产级 AI Agent 记忆系统**应当具备**以下能力：

### 3.1 存储层
- [ ] **C1 结构化持久存储**：SQLite/Postgres 事务级存储，而非 JSON 文件全量重写
- [ ] **C2 向量索引**：HNSW 或 pgvector，支持十万级以上向量毫秒检索
- [ ] **C3 双层存储**：元数据/关系入库 + 原文/附件入文件系统（异构存储）
- [ ] **C4 增量写入**：新增/更新单条记录增量写入，非全量重写
- [ ] **C5 崩溃恢复**：WAL 或事务回滚，写入中断不损坏索引

### 3.2 检索层
- [ ] **C6 向量语义检索**：Embedding + KNN，超越关键词字面匹配
- [ ] **C7 混合检索**：语义 + 关键词（BM25）+ 图遍历/共现，多路召回融合
- [ ] **C8 重排序**：Rerank 模型或结构化打分（时间/重要性/访问/相关性）
- [ ] **C9 结果去重**：SVD 或语义去重，避免召回冗余
- [ ] **C10 远距离弱信号捕获**：通过图谱/共现传播找回向量距离远但结构相关的记忆

### 3.3 组织与演化层
- [ ] **C11 记忆图谱**：标签共现图（VCP）或实体-关系-事实图（Zep），表达记忆间结构关系
- [ ] **C12 时态管理**：事实带有效时间窗口，能查"现在为真"和"历史为真"（Zep 独有优势）
- [ ] **C13 溯源**：每条抽象记忆能下钻到原始对话/事件
- [ ] **C14 自演化**：新记忆写入时自动分析关联、建立链接、更新上下文
- [ ] **C15 冷热分层**：热记忆（联想）与冷知识（事实）分离，检索路径不同

### 3.4 上下文管理层
- [ ] **C16 上下文折叠**：远距离低相关 assistant 消息压缩为摘要，省 token
- [ ] **C17 动态注入**：按当前对话语义动态决定注入哪些记忆，而非全量塞入
- [ ] **C18 相似度门控**：大日记本检索前先判断主题相关性，减少无关召回
- [ ] **C19 异步摘要**：折叠摘要异步非阻塞生成，不卡主请求

### 3.5 跨 Agent / 多端层
- [ ] **C20 即时通信事件**：Agent 间通信即时写结构化事件，不依赖异步 LLM 提取
- [ ] **C21 跨端连续性**：跨前端/设备同一 Agent 的连续事实时间线
- [ ] **C22 跨 Agent 共享记忆**：shared scope + consensus 类型 + 事件订阅
- [ ] **C23 主动回忆工具**：Agent 可主动发起 LightMemo/DeepMemo/TopicMemo 式回查

### 3.6 运维层
- [ ] **C24 性能可观测**：检索延迟、召回率、token 消耗指标
- [ ] **C25 容灾备份**：自动备份、数据库自修复、差分同步
- [ ] **C26 多向量源容灾**：embedding 服务不可用时的降级策略

**SoloForge 当前达成**：C14 部分（相似合并）、C15 部分（分目录）、C8 部分（加权打分但无语义）。其余 23 项均未达成或严重不足。

---

## 4. 对齐方案：从当前到生产级的改造路径

按"投入产出比 + 依赖关系"排序，分四阶段。每阶段独立可交付，前一阶段是后一阶段的基础。

### 阶段一：存储与检索基座（解决 G1/G2/G3/G9/G10/G11）

> 目标：把记忆从"JSON 文件 + 关键词"升级到"SQLite + 向量 + 混合检索"。这是所有后续能力的前提。

#### 改造项 1.1：引入 SQLite 持久层（对标 C1/C4/C5）
- **现状**：`memory-store.js` 全量 JSON 重写，防抖写入，崩溃可能丢索引
- **改法**：在 `memory/` 下新增 `sqlite-store.js`，用 `better-sqlite3`（WAL 模式）。表结构：`memories(id, type, scope, agent_id, content, summary, tags_json, importance, access_count, created_at, last_accessed_at, archived, source_json)` + `memory_tags(memory_id, tag)` 索引表 + FTS5 全文索引表。保留现有 `MemoryStore` 作为兼容层，新写入双写过渡
- **预期效果**：增量写入（单条 INSERT/UPDATE）、ACID 事务、崩溃不损坏、FTS5 支持中文分词全文检索
- **参考**：VCP 的 `knowledge_base.sqlite` schema

#### 改造项 1.2：引入 Embedding + 向量检索（对标 C2/C6/G3）
- **现状**：无 Embedding，纯 n-gram 关键词
- **改法**：新增 `embedding-service.js`（兼容 OpenAI API 格式，支持本地 Ollama/远程）。每个 memory 写入时异步生成 embedding 存 `memories.embedding` BLOB。新增 `vector-index.js` 用 `hnswlib-node`（纯 JS，无需 Rust，部署简单）或 `vectordb`（Qdrant 嵌入版）。检索时 query → embedding → KNN 召回
- **预期效果**：语义检索，"用户说压力大"能召回"三个月前提过考试"的记忆（关键词匹配做不到）
- **参考**：VCP USearch HNSW + 模型签名防跨模型读错

#### 改造项 1.3：混合检索融合（对标 C7/C9/G1/G9）
- **现状**：单一关键词路径
- **改法**：`memory-retriever.js` 改为多路召回 + 融合排序：
  - 路径 A：向量 KNN 召回 top-50（语义）
  - 路径 B：FTS5 BM25 召回 top-50（关键词）
  - 路径 C：tag 精确匹配召回
  - 融合：RRF（Reciprocal Rank Fusion）或加权重排，保留现有 RECENCY/IMPORTANCE/ACCESS 权重作为 rerank 后排序调整
- **预期效果**：语义+关键词双保险，用词不同也能召回，长尾记忆不再漏检
- **参考**：VCP 的 `::BM25+` 与向量融合、Zep 的混合检索

### 阶段二：上下文管理与跨 Agent 即时性（解决 G7/G8）

> 目标：解决 token 爆炸和"秘书发完 CEO 不知道"两大痛点。

#### 改造项 2.1：落地 CommunicationEventStore（对标 C20/G8）
- **现状**：架构计划已设计但未实现；`notify_boss` 不写记忆，`send_to_agent` 异步提取有延迟
- **改法**：按 `multi-agent-architecture-plan.md` §跨 Agent 记忆一致性 落地。新增 `communication-event-store.js`，`send_to_agent`/`notify_boss`/`delegate_task`/`post_to_group`/`post_to_department` 调用后即时 `append(event)`。`buildAgentContext` 注入最近 N 条通信事件 + 异步 LLM 记忆双保险。持久化到 SQLite 表 `comm_events` 而非 JSON（改进计划方案）
- **预期效果**：Agent 间通信即时可查，不依赖 LLM 提取延迟，用户立刻问 CEO 能答出
- **参考**：Zep 的 episodes（即时事件流溯源）、VCP 的 OneRing

#### 改造项 2.2：上下文折叠（对标 C16/C17/C18/C19/G7）
- **现状**：无折叠，靠 `summary` 字段静态压缩，长对话 token 爆炸
- **改法**：新增 `context-folding.js`（独立模块或插件）。对历史 `assistant` 消息算与当前上下文的向量相似度，低于动态阈值的替换为 `[折叠摘要:xxx]`。摘要异步生成（`setImmediate` + 标记 pending/ready），下次请求生效。存 `folding_entries(content_hash, vector, summary, summary_status)` SQLite 表
- **预期效果**：长对话 token 大幅下降，远距离低相关历史自动压缩，近相关自动保留
- **参考**：VCP ContextFoldingV2（SHA-256 hash + 异步摘要状态机 + 容量淘汰）

#### 改造项 2.3：相似度门控（对标 C18）
- **现状**：所有记忆无差别检索
- **改法**：`recall()` 前加门控——先算 query 与记忆库主题的相似度，达标才进入 RAG 管线。对标 VCP 的 `《《》》` 门控语法。对大记忆库避免无关召回污染上下文
- **预期效果**：减少无关记忆注入，上下文更聚焦
- **参考**：VCP `<<>>` 和 `《《》》` 门控占位符

### 阶段三：记忆图谱与组织（解决 G4/G6/G14）

> 目标：从"扁平记忆条目"升级到"有结构的记忆网络"，捕获远距离弱信号。

#### 改造项 3.1：标签共现图（对标 C11/G4，轻量版 VCP 浪潮）
- **现状**：tags 是孤立数组，无关系
- **改法**：新增 `tag-cooccurrence.js`。每次 memory 写入时更新 `tag_pairs(tag_a, tag_b, count)` 共现统计。定期（防抖 + 阈值触发）重建内存共现矩阵 Map。检索时：query 命中的核心 tag → 通过共现矩阵拉回关联 tag（top-4）→ 扩展召回。这是 VCP 浪潮算法的"轻量子集"——保留共现图传播，跳过 EPA/残差金字塔/SVD 等重数学
- **预期效果**：标签间关联被建立，"考试"和"压力"这类语义关联能通过共现被捕获，召回率提升
- **参考**：VCP TagMemo 共现矩阵 + 关联词拉回

#### 改造项 3.2：溯源下钻（对标 C13/G6）
- **现状**：记忆有 `source.type/conversationId` 但无法精确下钻到原始消息
- **改法**：`memories` 表加 `source_episode_id` 外键指向 `comm_events` 或对话原文存储。召回的记忆附带"点击查看原文"能力（IPC 返回 episode_id）
- **预期效果**：抽象记忆可追溯到原始通信/对话，可验证、可审计
- **参考**：Zep episode 溯源、TencentDB node_id 下钻

#### 改造项 3.3：主动回忆工具（对标 C23/G15）
- **现状**：仅被动 `recall()`
- **改法**：新增 Agent 可调用的记忆工具：`light_memory`（轻量按 query 回忆）、`deep_memory`（按 conversationId/time 精确回查原始通信）、`topic_memory`（按 tag 话题回查）。接入 Agent 工具系统
- **预期效果**：Agent 能主动"想回忆什么"，而非全靠系统被动注入
- **参考**：VCP LightMemo/DeepMemo/TopicMemo

### 阶段四：生产级增强（解决 G5/G12/G13/C12/C24/C25/C26）

> 目标：进入长期稳定运行，处理变化事实与容灾。

#### 改造项 4.1：时态事实管理（对标 C12/G5，可选）
- **现状**：记忆无版本，旧 preference 被新 preference 覆盖就丢了
- **改法**：对 `preference`/`fact`/`company_fact` 类型加 `valid_from`/`valid_to` 字段。新事实写入时把旧事实 `valid_to = now`（失效不删除）。检索默认查 `valid_to IS NULL`（现在为真），支持历史查询
- **预期效果**：能回答"用户 3 月喜欢什么/现在喜欢什么"，事实演化可追溯
- **参考**：Zep temporal fact validity window（此项是 Zep 独有优势，按需取舍）

#### 改造项 4.2：冷热知识分离强化（对标 C15）
- **现状**：仅按类型分目录，无检索路径区分
- **改法**：明确"热记忆"（经历/决策/偏好，走向量+共现联想）与"冷知识"（文档/手册，走 FTS5 全文）两套检索路径，结果分别召回后融合
- **预期效果**：事实型查询走精准全文，经验型查询走语义联想，互不干扰
- **参考**：VCP 热记忆日记 + TDB 冷知识库双通道

#### 改造项 4.3：性能可观测与容灾（对标 C24/C25/C26）
- **现状**：无指标、无备份、无降级
- **改法**：检索延迟/召回数/token 消耗日志 + SQLite 自动备份 + embedding 服务不可用时降级为纯 FTS5
- **预期效果**：可监控、可恢复、embedding 挂了不瘫痪
- **参考**：VCP 自动备份 + 数据库自修复 + 多向量源容灾

---

## 5. 改造优先级与预期效果汇总

| 阶段 | 改造项 | 解决差距 | 预期效果 | 工作量 |
|---|---|---|---|---|
| **一** | 1.1 SQLite 持久层 | G2/G10 | 增量写入、崩溃恢复、FTS5 | 中 |
| **一** | 1.2 Embedding+向量 | G1/G3 | 语义检索，超越关键词 | 中 |
| **一** | 1.3 混合检索融合 | G1/G9 | 语义+关键词双保险 | 小 |
| **二** | 2.1 CommunicationEventStore | G8 | 跨 Agent 即时性 | 中 |
| **二** | 2.2 上下文折叠 | G7 | token 大降、长对话可用 | 中 |
| **二** | 2.3 相似度门控 | C18 | 减少无关召回 | 小 |
| **三** | 3.1 标签共现图 | G4 | 远距离弱信号捕获 | 中 |
| **三** | 3.2 溯源下钻 | G6 | 可审计可验证 | 小 |
| **三** | 3.3 主动回忆工具 | G15 | Agent 主动回忆 | 小 |
| **四** | 4.1 时态事实管理 | G5 | 处理变化事实 | 中 |
| **四** | 4.2 冷热分离强化 | C15 | 检索路径分流 | 小 |
| **四** | 4.3 可观测与容灾 | C24-C26 | 生产级运维 | 中 |

**最小可行生产级（MVP）**：阶段一全部 + 2.1 + 2.2。这五项解决 6 个🔴严重差距中的 5 个，是进入生产级的底线。

**完整生产级**：四阶段全部落地，对齐 26 项能力清单的 24 项（C12 时态为可选增强）。

---

## 6. 风险与取舍

1. **Rust 向量引擎 vs 纯 JS**：VCP 用 Rust N-API 获得毫秒级性能，但 SoloForge 是 Electron 桌面应用，引入 Rust 增加构建复杂度。建议先用 `hnswlib-node`（纯 JS）验证，十万级以下够用；超规模再上 Rust。
2. **共现图 vs 知识图谱**：VCP 共现图轻、联想强；Zep 知识图谱重、精确、有时态。SoloForge 记忆以"对话/通信"为主，共现图更贴合；时态管理作为阶段四可选增强。
3. **Embedding 成本**：每条记忆异步生成 embedding 有 API 成本。建议本地 Ollama embedding（`nomic-embed-text`）为主，远程为备，降级时退 FTS5。
4. **双写过渡风险**：SQLite 与 JSON 双写期间需保证一致性，建议以 SQLite 为真值源，JSON 降级为只读兼容层，一个版本周期后移除 JSON。
5. **上下文折叠的误折**：相似度阈值设过高会漏召回关键历史。建议阈值可配置 + 折叠摘要保留可回溯 hash，必要时还原。

---

## 7. 对齐目标总结

| 维度 | 当前 | MVP（阶段一+二核心） | 完整生产级（四阶段） |
|---|---|---|---|
| 检索 | 关键词 n-gram | 向量+BM25+融合 | +共现图+重排+去重 |
| 存储 | JSON 全量重写 | SQLite WAL 增量 | +向量索引+备份 |
| 上下文 | summary 字段静态 | 折叠+门控 | +冷热分离 |
| 跨 Agent | 异步 LLM 延迟 | 即时通信事件 | +溯源下钻 |
| 规模 | 内存 Map 千级 | 十万级向量 | +图谱十万 tag |
| 演化 | 相似合并 | — | 时态+自演化 |
| 运维 | 无 | 延迟日志 | 可观测+容灾 |

SoloForge 记忆系统当前处于"组件齐全但底层原始"的阶段——有类型/分层/提取/衰减/摘要的完整框架，但检索与存储停在最原始的关键词+JSON。**阶段一（存储+向量+混合检索）是最高优先级**，它是所有生产级能力的前提，也是投入产出比最高的一步。
