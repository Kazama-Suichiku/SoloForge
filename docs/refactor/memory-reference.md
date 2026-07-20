# 记忆系统参考文档

> 调研对象：VCP（VCPToolBox）及主流 AI Agent 记忆方案
> 调研日期：2026-07-20
> 用途：为 SoloForge 记忆系统改造提供横向技术参考，对应文档为 `memory-alignment.md`

---

## 0. 关键结论速览

| 方案 | 核心范式 | 存储 | 检索 | 持久化 | 适合规模 | 参考价值 |
|---|---|---|---|---|---|---|
| **VCP / VCPToolBox** | 语义引力 + 标签共现图谱（浪潮算法） | SQLite + Rust USearch HNSW | 向量 + Tag 共现图传播 + EPA + 残差金字塔 + SVD 去重 | 增量 + 派生任务离线重算 | 十万级 tag、毫秒级 | ★★★★★ |
| **Letta (MemGPT)** | OS 式分层记忆（core / archival / recall） | Postgres + pgvector | 向量 + 自编辑记忆 + 自我反思 | 事务级 | 中大规模 | ★★★★ |
| **Zep / Graphiti** | 时序知识图谱（temporal context graph） | Neo4j + 向量 + episodes | 混合检索（语义 + 关键词 + 图遍历）+ 时态查询 | 增量图更新 | 生产级大规模 | ★★★★★ |
| **A-MEM** | Zettelkasten 自组织笔记 | ChromaDB | 向量 + 语义链接 + 记忆自演化 | 增量 + LLM 演化 | 中小规模 | ★★★ |
| **TencentDB Agent Memory** | 符号化短期记忆 + 分层长期记忆 | DB + Markdown 双层 | Mermaid 符号图 + node_id 下钻 | 分层渐进披露 | 长会话任务 | ★★★★ |
| **LangChain Memory** | 组件化缓冲区 | 内存 / 任意后端 | 滑窗 / 摘要 / 向量 | 取决于实现 | 小规模 | ★★ |

**结论**：VCPToolBox 与 Zep/Graphiti 是目前工程上最成熟的两条技术路线——前者走"语义动力学 + 图传播"路线，后者走"时序知识图谱"路线。SoloForge 当前的纯关键词 + JSON 文件方案处在最原始阶段，对标这两条路线即可定出生产级改造路径。

---

## 1. VCP / VCPToolBox 记忆系统详解

### 1.1 项目定位

- **仓库**：`lioensky/VCPToolBox`（2194 stars，CC BY-NC-SA 4.0）
- **全称**：VCP = Variable & Command Protocol（变量与指令协议），非 "Vector Context Protocol"
- **定位**：部署在 AI 模型 API 与前端之间的工业级 AGI OS 中间层，目标是把"无状态大模型"改造成"有连续存在、有长期记忆、有自主生活"的智能体
- **语言栈**：Node.js（业务）+ Rust N-API（向量引擎）+ SQLite（持久化）+ USearch（HNSW 向量索引）
- **核心哲学**：从"AI 主动 query 世界"转向"信息像引力一样自然流向 AI"

### 1.2 记忆分层（七层）

VCP 的记忆不是单一插件，而是多时间尺度系统协作：

| 记忆层 | 时间尺度 | 数据来源 | 主要入口 | 用途 |
|---|---|---|---|---|
| 当前聊天窗口 | 当前会话 | 请求上下文 | 原生消息 | 正在进行的对话 |
| OneRing | 跨窗口近期 | OneRing SQLite | `[[OneRing::Agent::Frontend]]` | 跨端补齐近期上下文 |
| OneRingMemo | 1–7 天 | OneRing 消息摘要 | `[[OneRingMemo::Agent]]` | 压缩近期客观事件线 |
| VCPTimeLine | 月至多年 | 日记月度归纳 | `[[VCPTimeLine::Agent]]` | 长期阶段概览 |
| 热记忆日记 | 长期/永久 | `dailynote/` | RAG 占位符、LightMemo | 经历、关系、反思、项目状态 |
| 冷知识库 | 长期稳定 | `knowledge/` | 知识库占位符 | 百科、手册、论文 |
| 历史聊天库 | 长期 | VCPChat/分布式 | DeepMemo、TopicMemo | 精确回查原始聊天 |

**设计原则**：当前窗口保存原始对话；OneRing 负责短期连续性；VCPTimeLine 负责长期阶段认知；日记 RAG 负责细粒度召回；TDB 负责事实型冷知识；DeepMemo/TopicMemo 负责聊天信源回查。各层职责正交，不互相替代。

### 1.3 存储架构

```
VectorStore/
├── knowledge_base.sqlite        # SQLite 主库（WAL 模式，ACID）
│   ├── files                    # 文件元数据
│   ├── chunks                   # 文本块 + 向量 BLOB
│   ├── tags                     # 标签 + 向量 BLOB
│   ├── file_tags                # 文件-标签关联
│   └── kv_store                 # EPA 缓存等键值
├── index_global_tags.usearch    # 全局 Tag 向量索引
├── index_diary_{md5}.usearch    # 各日记本独立向量索引
└── ...
```

- **双索引**：`diaryIndices`（Map<diaryName, VexusIndex>，每日记本隔离、懒加载、故障隔离）+ `tagIndex`（全局 Tag 索引，5 万容量）
- **向量引擎**：Rust N-API（`rust-vexus-lite`），USearch HNSW + nalgebra SVD + Gram-Schmidt 正交化，跨平台原生模块
- **Embedding**：兼容 OpenAI API 格式，支持 Gemini/OpenAI 等，带模型签名（含维度）防跨模型读错 BLOB

### 1.4 检索：TagMemo "浪潮"算法 V9.1（核心创新）

这是 VCP 区别于所有传统 RAG 的核心。生产链路：

```
查询向量
→ EPA 语义状态分析
→ Residual Pyramid 多层标签感应
→ Core Tag / Ghost Tag 补全
→ V9.1 有界图传播
→ 标签上下文向量融合
→ Vexus KNN 候选召回
→ 查询能量场向 Tag 向量空间局部连续化
→ 候选文件有序 Tag 曲线评估
→ direct / structural / thematic 证据分级
→ 绝对标度与等级上限约束的正向奖励
→ 后续时间、BM25、Rerank 与结果去重管线
```

四阶段工作流：
1. **感应（Sensing）**：净化文本 → EPA 投影算逻辑深度/共振值
2. **分解（Decomposition）**：残差金字塔迭代分解（Gram-Schmidt 正交化，能量低于原始 10% 即停）
3. **扩张（Expansion）**：核心标签虚拟补全 + 共现矩阵关联词拉回 + 世界观门控筛选
4. **重塑（Reshaping）**：动态 Beta 融合原始向量与标签上下文向量 → 语义去重

**关键机制**：
- **标签共现矩阵**：标签在同一篇记忆中共现=局部关系证据；重复共现提高可信度，但不线性垄断传播
- **标签顺序**：标签顺序携带叙事方向（原因在结果前），图保持双向可达但顺流/逆流阻尼不同
- **有界图传播**：累计证据先压缩、每节点出流受固定预算、虫洞预算内竞争、枢纽温和抑制、立即回流软抑制、有限跳有限状态——避免全局稳态和无限能量
- **核心标签 vs 普通标签**：核心标签虚拟补全、Core Boost(1.2-1.4x)、噪音过滤豁免；普通标签需门控筛选
- **EPA（Embedding Projection Analysis）**：描述查询的全局语义状态（logicDepth/entropy/dominantAxes/resonance），调节 TagMemo 激活强度
- **SVD 结果去重器**：候选结果阶段用 SVD + 残差选择减少重复信息

**性能**：Rust 预计算 + O(1) 查表，十万级标签下检索延迟毫秒级。

### 1.5 上下文注入

VCP 通过"消息预处理插件"在请求进入模型前完成注入，四类日记本占位符：

| 语法 | 是否门控 | 返回内容 | 进 RAG 管线 |
|---|:---:|---|:---:|
| `{{角色日记本}}` | 否 | 文件全文 | 否 |
| `<<角色日记本>>` | 是 | 文件全文 | 门控后纯文本 |
| `[[角色日记本]]` | 否 | 相关片段 | 是 |
| `《《角色日记本》》` | 是 | 相关片段 | 门控通过后进入 |

后缀能力：`::LastN`（最近 N 个文件）、`::RandomN`、`::BM25`（Tag 行匹配）、`::BM25+`（正文匹配）、`:1.5`（动态 K 倍率）、`::TagMemo+::Rerank+::Truncate0.4`（浪潮增强+重排+截断）。聚合用 `|` 声明多日记本。

### 1.6 压缩/摘要（上下文折叠 V2）

`ContextFoldingV2` 插件：
- 只折叠 `role: assistant` 的远距离、低相关性消息块
- 根据最后一轮 user+AI 语义向量判断相关性
- 不相关块替换为 `[VCP上下文语义折叠-本层摘要:xxxx]`
- **摘要异步非阻塞**：首次检测到需折叠时触发生成，下次 POST 生效
- `FoldingStore`（SQLite 迷你库，SHA-256 内容 hash 主键）存向量 + 摘要状态（none/pending/ready/failed）
- 容量 200 条，超限按 `updated_at` 升序删最旧 20 条，差异更新用 `INSERT OR REPLACE`

### 1.7 跨 Agent / 跨端连续性

- **OneRing**：统一事实时间线，跨网页/手机/桌面/群聊/信箱，"同一个它"。Web 端聊一半，十分钟后手机上能接"刚才说到你项目第三个模块"
- **统一上下文 OneRing**：跨窗口、跨前端近期连续性
- **分布式**：星型网络拓扑，超栈追踪实现透明跨服务器文件访问；多设备/多模型/多向量源三位一体容灾

### 1.8 衰减/淘汰

VCP 不做粗暴的时间衰减。通过语义相关性折叠（远距离低相关→摘要）+ 冷热知识双通道（热记忆走 TagMemo 联想，冷知识走 TriviumDB）+ 上下文引力场动态导航（重要的浮现，无关的折叠）实现"自然淡出"，而非硬性过期删除。

### 1.9 主动回忆工具

Agent 可主动发起：`LightMemo`（轻量回忆）、`DeepMemo`（精确回查聊天）、`TopicMemo`（按话题回查）、`OneRingMemo`（近期事件摘要）。这些是被动 RAG 注入之外的能力。

### 1.10 元思考 / AgentDream

- **元思考系统**：存储可复用推理路径、思维结构、抽象逻辑框架
- **AgentDream**：可选的离线联想和记忆重构流程（类似"做梦整理记忆"）

---

## 2. 其他主流记忆方案

### 2.1 Letta（前 MemGPT）— OS 式分层记忆

- **仓库**：`letta-ai/letta`（原 MemGPT，`cpacker/MemGPT` 为旧名）
- **核心思想**：把 LLM 上下文窗口当"内存"，把外部存储当"磁盘"，模仿操作系统内存管理
- **分层**：
  - **Core Memory（核心记忆）**：始终在上下文内，类似 RAM；存 persona（Agent 人格）+ human（用户信息）
  - **Archival Memory（归档记忆）**：外部持久化（Postgres + pgvector），按需检索回填
  - **Recall Memory（召回记忆）**：完整对话历史，可检索
- **自编辑记忆**：Agent 能自主决定往自己的记忆里写什么、改什么、删什么（self-editing memory）
- **自我反思**：Agent 通过反思生成更高层摘要，递归压缩
- **主动调用**：Agent 显式调用 `core_memory_append/replace`、`archival_memory_insert/search` 等函数
- **优势**：模型无关、记忆自管理、有 SDK 和托管云；**劣势**：需要模型配合函数调用，记忆组织偏"平"，无强图谱结构

### 2.2 Zep / Graphiti — 时序知识图谱

- **仓库**：`getzep/graphiti`（开源引擎）+ `getzep/zep`（托管云，仓库现为 examples/integrations）
- **论文**：*Zep: A Temporal Knowledge Graph Architecture for Agent Memory*（arXiv 2501.13956）
- **核心**：**Temporal Context Graph（时序上下文图）**——实体、关系、事实都带"有效时间窗口"
- **Context Graph 四组件**：
  - **Entities（实体/节点）**：人、产品、政策、概念，摘要随时间演化
  - **Facts / Relationships（事实/边）**：三元组（Entity→Relationship→Entity）带时间有效窗口
  - **Episodes（溯源）**：原始数据流，每个派生事实都能追溯到 episode
  - **Custom Types（本体）**：Pydantic 模型预定义或从数据学习
- **关键能力**：
  - **时态事实管理**：信息变了，旧事实"失效"而非"删除"；可查"现在为真"或"某时刻为真"
  - **增量更新**：无需全图重算
  - **混合检索**：语义 + 关键词 + 图遍历
  - **溯源**：实体/关系到原始 episode 的完整血缘
- **性能**：Zep 托管版 sub-200ms 检索；自称 Agent Memory SOTA
- **优势**：处理"会变的事实"（如"Kendra 3 月喜欢 Adidas，5 月改喜欢 Nike"）、生产级、有 MCP server；**劣势**：依赖 Neo4j，自托管需自建用户/会话管理

### 2.3 A-MEM — Zettelkasten 自组织记忆

- **仓库**：`agiresearch/A-mem`（1116 stars）
- **论文**：*A-MEM: Agentic Memory for LLM Agents*（arXiv 2502.12110）
- **核心**：模仿 **Zettelkasten（卡片盒笔记法）**，记忆是可互相链接的"笔记"，能自演化
- **流程**（写入新记忆时）：
  1. 生成带结构化属性的综合笔记
  2. 创建上下文描述和标签
  3. 分析历史记忆找关联
  4. 基于相似度建立链接
  5. 记忆持续演化与精炼
- **存储**：ChromaDB（向量 + 元数据），embedding 用 `all-MiniLM-L6-v2`
- **LLM 后端**：OpenAI 或 Ollama（本地）
- **记忆演化**：自动分析内容关系、更新标签和上下文、创建语义连接
- **优势**：记忆自组织、可链接、LLM 驱动演化；**劣势**：无时态、无生产级存储、规模受限

### 2.4 TencentDB Agent Memory — 符号化 + 分层

- **仓库**：`TencentCloud/TencentDB-Agent-Memory`（9131 stars）
- **两大支柱**：
  1. **Memory Layering（分层）**：拒绝扁平存储
     - 短期：底层存原始工具输出（`refs/*.md`）→ 中层提取步骤摘要（`jsonl`）→ 顶层浓缩成 Mermaid 符号图；Agent 只关注顶层结构，出错按 `node_id` 下钻
     - 长期：L0 Conversation（原始对话）→ L1 Atom（原子事实）→ L2 Scenario（场景块）→ L3 Persona（用户画像）
     - 技能生成：底层执行 trace → 中层 Scenario 模式 → 顶层 Persona/SOP
  2. **Symbolic Memory（符号化）**：用 Mermaid 高密度符号图代替冗长日志，工具日志 offload 到外部文件，上下文里只留轻量 Mermaid 任务图
- **异构存储 + 渐进披露**：底层（事实/日志/trace）入库做全文检索；顶层（persona/scene/canvas）存 Markdown 做高密度白盒可检；**下层保证据，上层保结构**
- **全可追溯 + 无损恢复**：顶层符号 → 中层索引 → 底层原文的确定性下钻路径
- **实测**：OpenClaw 集成后 token 降 61.38%、通过率 +51.52%、PersonaMem 准确率 48%→76%
- **优势**：token 大幅下降、可追溯、白盒；**劣势**：偏任务流，长期记忆图谱能力弱于 Zep

### 2.5 LangChain Memory — 组件化缓冲区

- **定位**：LangChain 的 `memory` 模块，提供可插拔的对话记忆组件
- **类型**：`ConversationBufferMemory`（全量）、`ConversationBufferWindowMemory`（滑窗）、`ConversationSummaryMemory`（LLM 摘要）、`ConversationSummaryBufferMemory`（摘要+缓冲）、`VectorStoreRetrieverMemory`（向量检索）、`ConversationTokenBufferMemory`（按 token 数）
- **特点**：组件化、易组合、后端可换；**劣势**：偏"对话历史管理"，不是真正的长期记忆系统，无图谱、无时态、无自演化。新版 LangGraph 推荐用 persistence + store 替代。

---

## 3. 横向对比与选型建议

### 3.1 关键能力矩阵

| 能力 | VCP | Letta | Zep/Graphiti | A-MEM | TencentDB | LangChain |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 向量检索 | ✅ Rust | ✅ pgvector | ✅ | ✅ Chroma | ✅ | ✅ |
| 语义联想（超越 KNN） | ✅ 图传播 | ❌ | ✅ 图遍历 | ✅ 链接 | ⚠️ 符号 | ❌ |
| 时态/版本管理 | ❌ | ❌ | ✅ 强 | ❌ | ⚠️ | ❌ |
| 溯源/血缘 | ⚠️ | ⚠️ | ✅ episode | ✅ 笔记链 | ✅ node_id | ❌ |
| 上下文折叠/压缩 | ✅ V2 | ✅ 反思 | ⚠️ | ❌ | ✅ 符号化 | ✅ 摘要 |
| 跨 Agent/跨端 | ✅ OneRing | ⚠️ | ✅ 多用户 | ❌ | ⚠️ | ❌ |
| 混合检索（语义+关键词+图） | ✅ BM25+ | ⚠️ | ✅ | ⚠️ | ✅ | ⚠️ |
| 自演化 | ⚠️ AgentDream | ✅ 自编辑 | ✅ 增量图 | ✅ LLM 演化 | ✅ 分层 | ❌ |
| 增量持久化 | ✅ WAL | ✅ 事务 | ✅ 增量图 | ✅ | ✅ | ⚠️ |
| 生产级性能 | ✅ 毫秒 | ✅ | ✅ <200ms | ⚠️ | ✅ | ⚠️ |

### 3.2 两条推荐路线

**路线 A — VCP 式语义动力学**（标签共现图 + 图传播 + 上下文折叠）
- 适合：以"对话/日记"为主要记忆形态、强调"联想直觉"而非"精确事实"的场景
- 优点：联想能力强、远距离弱信号能被结构捕获、上下文折叠省 token
- 成本：需 Rust 向量引擎 + 共现矩阵维护 + 派生任务调度

**路线 B — Zep/Graphiti 式时序知识图谱**（实体-关系-事实 + 时间窗口 + 溯源）
- 适合：事实会随时间变化、需要"现在为真/历史为真"查询、强调可追溯的场景
- 优点：处理变化事实最自然、生产级性能、有 MCP、混合检索
- 成本：依赖 Neo4j、需本体设计、增量图更新逻辑复杂

### 3.3 对 SoloForge 的启发

SoloForge 是多 Agent 协作桌面应用，记忆场景是"Agent 间通信 + 用户对话 + 任务执行"。最贴合的不是单一方案，而是**取 Zep 的时序事实（解决跨 Agent 通信即时性）+ VCP 的上下文折叠（省 token）+ TencentDB 的分层下钻（可追溯）**的组合思路。详见对齐文档。
