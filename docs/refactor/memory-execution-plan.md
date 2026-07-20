# 记忆系统生产级重构 — 执行计划

> 设计方案：docs/refactor/memory-alignment.md（对齐文档）
> 参考文档：docs/refactor/memory-reference.md（VCP + 主流方案对比）
> 核心目标：从"JSON 文件 + 关键词匹配"升级到"SQLite + Embedding + 向量检索 + 混合检索 + 标签共现图 + 上下文折叠"

## 当前环境

- LLM：litellm proxy localhost:4000（GLM-5.2-FP8，不支持 embedding）
- Ollama：未运行（可用于本地 embedding）
- 当前记忆：~170 条通信记录 + 记忆条目，JSON 文件存储，纯关键词 n-gram 检索
- 依赖：无 better-sqlite3、无 hnswlib、无 embedding 服务

## 执行总览

```
阶段一：存储与检索基座（SQLite + Embedding + 向量检索 + 混合检索）
阶段二：上下文折叠 + 通信事件持久化到 SQLite
阶段三：标签共现图 + 溯源下钻 + 主动回忆工具
阶段四：时态事实管理 + 冷热知识分离 + 容灾
```

---

## 阶段一：存储与检索基座（3 批）

### 1-A：SQLite 持久层 + 数据迁移

**新建文件**：
- `src/main/memory/sqlite-store.js` — better-sqlite3 WAL 模式

**表结构**：
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  agent_id TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  tags_json TEXT,        -- JSON array
  importance REAL,
  access_count INTEGER DEFAULT 0,
  created_at INTEGER,
  last_accessed_at INTEGER,
  archived INTEGER DEFAULT 0,
  superseded_by TEXT,
  source_json TEXT,
  embedding BLOB,        -- 阶段1-B填充
  embedding_model TEXT,
  updated_at INTEGER
);
CREATE INDEX idx_type ON memories(type);
CREATE INDEX idx_scope ON memories(scope);
CREATE INDEX idx_agent ON memories(agent_id);
CREATE INDEX idx_archived ON memories(archived);

CREATE TABLE memory_tags (
  memory_id TEXT,
  tag TEXT,
  FOREIGN KEY (memory_id) REFERENCES memories(id)
);
CREATE INDEX idx_tag ON memory_tags(tag);

-- FTS5 全文索引（中文用 simple tokenizer + jieba 或 trigram）
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content, summary, tags_text,
  content='memories', content_rowid='rowid'
);
```

**接口**（保持与现有 MemoryStore 兼容）：
- `add(entry)` — INSERT + 更新 FTS
- `get(id)` — SELECT
- `query({type, scope, agentId, tags})` — WHERE 过滤
- `searchByTags(tags, opts)` — JOIN memory_tags
- `update(id, changes)` — UPDATE
- `delete(id)` — DELETE
- `getAll()` — SELECT *
- `loadFromDisk()` / `saveToDisk()` — SQLite 自动持久化，这两个改为 no-op 或只做 VACUUM
- `reinitialize(companyPath)` — 切换数据库文件

**数据迁移**：从现有 JSON 文件读全部记忆条目，批量 INSERT 到 SQLite。

**改动文件**：
- `src/main/memory/memory-store.js` — 内部从 JSON Map 改为调 sqlite-store，保持对外接口不变
- `package.json` — 加 `better-sqlite3` 依赖

### 1-B：Embedding 服务 + 向量索引

**新建文件**：
- `src/main/memory/embedding-service.js` — embedding 生成
- `src/main/memory/vector-index.js` — HNSW 向量索引

**Embedding 服务**：
- 兼容 OpenAI API 格式（`/v1/embeddings`）
- 支持多后端：litellm proxy / Ollama / 远程 API
- 配置：`EMBEDDING_MODEL` + `EMBEDDING_BASE_URL`
- 当前环境：需要安装一个 embedding 模型。方案：
  1. 启动 Ollama + `nomic-embed-text`（768 维，中文支持好）
  2. 或用 litellm 配置一个 embedding 模型
  3. 或用 `@xenova/transformers`（纯 JS，本地运行，无需额外服务）
- 每条记忆写入时异步生成 embedding，存 `memories.embedding` BLOB
- 模型签名防错：存 `embedding_model` 字段，换模型时标记需重新 embedding

**向量索引**（hnswlib-node 或纯 JS 替代）：
- `buildIndex()` — 从 SQLite 全部 embedding 构建 HNSW 索引
- `addVector(id, embedding)` — 增量添加
- `search(queryEmbedding, k)` — KNN 召回 top-k
- 启动时从 SQLite 加载 embedding 重建内存索引

### 1-C：混合检索融合

**改动文件**：
- `src/main/memory/memory-retriever.js` — 从纯关键词改为混合检索

**混合检索流程**：
```
recall(query, options):
  1. 路径A：query → embedding → vectorIndex.search(k=50) → 语义召回
  2. 路径B：query → FTS5 BM25 → top-50 → 关键词召回
  3. 路径C：query keywords → memory_tags 精确匹配 → tag 召回
  4. 融合：RRF（Reciprocal Rank Fusion）
     score = Σ 1/(rank_i + 60)  对每路召回结果
  5. Rerank：保留现有 importance/frequency/recency 权重作为 RRF 后排序调整
  6. 返回 top-N
```

**降级**：embedding 服务不可用时，回退到纯 FTS5 + tag 检索（现有逻辑的增强版）。

---

## 阶段二：上下文折叠 + 通信事件持久化（2 批）

### 2-A：上下文折叠

**新建文件**：
- `src/main/memory/context-folding.js`

**核心逻辑**（参考 VCP ContextFoldingV2）：
```
foldingContext(history, currentQuery, budget):
  1. 对每条历史 assistant 消息：
     a. 算与 currentQuery 的向量相似度
     b. 低于动态阈值 → 标记为"可折叠"
  2. 可折叠消息：
     a. 生成 SHA-256 hash 作为 key
     b. 检查是否已有折叠摘要（SQLite folding_entries 表）
     c. 没有则异步调 LLM 生成摘要，存入 folding_entries
     d. 替换为 [折叠摘要:xxx]
  3. 保留高相似度消息完整
  4. 返回：[滚动摘要] + [折叠后的历史] + [最近消息]
```

**SQLite 表**：
```sql
CREATE TABLE folding_entries (
  content_hash TEXT PRIMARY KEY,
  summary TEXT,
  summary_status TEXT,  -- pending / ready
  embedding BLOB,
  created_at INTEGER,
  last_used INTEGER
);
```

**改动文件**：
- `src/main/chat/history-manager.js` — getRollingSummaryHistory 里集成上下文折叠
- `src/main/chat/chat-manager.js` — 注入 context-folding

### 2-B：通信事件持久化到 SQLite

**改动文件**：
- `src/main/collaboration/comm-event-store.js` — 从 JSON 改为 SQLite

**表结构**：
```sql
CREATE TABLE comm_events (
  id TEXT PRIMARY KEY,
  type TEXT,
  from_agent TEXT,
  to_agent TEXT,
  content TEXT,
  response TEXT,
  trace_id TEXT,
  conversation_id TEXT,
  group_id TEXT,
  timestamp INTEGER
);
CREATE INDEX idx_from ON comm_events(from_agent);
CREATE INDEX idx_to ON comm_events(to_agent);
CREATE INDEX idx_group ON comm_events(group_id);
CREATE INDEX idx_time ON comm_events(timestamp);
```

保持现有接口不变，内部从 JSON Map 改为 SQLite。

---

## 阶段三：记忆图谱与组织（3 批）

### 3-A：标签共现图

**新建文件**：
- `src/main/memory/tag-cooccurrence.js`

**核心逻辑**（VCP 浪潮算法轻量子集）：
```
更新共现：
  每条记忆写入时，对其 tags 两两组合，tag_pairs(tag_a, tag_b, count)++
  防抖重建内存共现矩阵 Map

检索扩展：
  query 命中的核心 tags → 通过共现矩阵拉回关联 tags（top-4）→ 扩展召回
```

**SQLite 表**：
```sql
CREATE TABLE tag_pairs (
  tag_a TEXT,
  tag_b TEXT,
  count INTEGER,
  PRIMARY KEY (tag_a, tag_b)
);
```

**改动文件**：
- `src/main/memory/memory-store.js` — add() 时更新 tag_pairs
- `src/main/memory/memory-retriever.js` — recall() 时用共现扩展 tag 召回

### 3-B：溯源下钻

**改动文件**：
- `src/main/memory/sqlite-store.js` — memories 表加 `source_episode_id` 外键
- `src/main/memory/memory-store.js` — 写入时存 source_episode_id
- `src/main/collaboration/comm-event-store.js` — 提供按 id 查原始通信的方法

### 3-C：主动回忆工具

**新建文件**：
- `src/main/tools/memory-advanced-tools.js`

**3 个工具**：
- `light_memory` — 轻量按 query 回忆（快速向量检索 top-5）
- `deep_memory` — 按 conversationId/time 精确回查原始通信
- `topic_memory` — 按 tag 话题回查

**改动文件**：
- `src/main/tools/setup.js` — 注册 3 个新工具

---

## 阶段四：生产级增强（2 批）

### 4-A：时态事实管理

**改动文件**：
- `src/main/memory/sqlite-store.js` — memories 表加 `valid_from` / `valid_to`
- `src/main/memory/memory-store.js` — 新事实写入时旧事实 valid_to = now
- `src/main/memory/memory-retriever.js` — 默认查 valid_to IS NULL

### 4-B：冷热知识分离 + 容灾

**改动文件**：
- `src/main/memory/memory-retriever.js` — 热记忆走向量+共现，冷知识走 FTS5
- `src/main/memory/embedding-service.js` — 降级逻辑（不可用时纯 FTS5）
- `src/main/memory/sqlite-store.js` — 自动备份 + VACUUM

---

## 文件分工矩阵

| 文件 | 1-A | 1-B | 1-C | 2-A | 2-B | 3-A | 3-B | 3-C | 4-A | 4-B |
|---|---|---|---|---|---|---|---|---|---|---|
| sqlite-store.js (新) | ✅建 | | | | | | ✅改 | | ✅改 | ✅改 |
| embedding-service.js (新) | | ✅建 | | | | | | | | ✅改 |
| vector-index.js (新) | | ✅建 | | | | | | | | |
| memory-store.js | ✅改 | ✅改 | | | | ✅改 | ✅改 | | ✅改 | |
| memory-retriever.js | | | ✅改 | | | ✅改 | | | ✅改 | ✅改 |
| context-folding.js (新) | | | | ✅建 | | | | | | |
| tag-cooccurrence.js (新) | | | | | | ✅建 | | | | |
| memory-advanced-tools.js (新) | | | | | | | | ✅建 | | |
| history-manager.js | | | | ✅改 | | | | | | |
| comm-event-store.js | | | | | ✅改 | | ✅改 | | | |
| setup.js | | | | | | | | ✅改 | | |
| chat-manager.js | | | | ✅改 | | | | | | |
| package.json | ✅改 | ✅改 | | | | | | | | |

## 依赖安装

```bash
npm install better-sqlite3 hnswlib-node
# 或 hnswlib 纯 JS 版（如果 hnswlib-node 编译困难）：
# npm install hnswlib
```

Embedding 模型方案（按优先级）：
1. `@xenova/transformers`（纯 JS，本地运行，无需额外服务）— 首选
2. Ollama + `nomic-embed-text`（需要启动 Ollama）
3. litellm 配置 embedding 模型（如果 proxy 支持）

## 执行顺序

```
阶段一（存储与检索基座）
  ├─ 1-A: SQLite 持久层 + 数据迁移（1个子代理）
  ├─ 1-B: Embedding 服务 + 向量索引（1个子代理，依赖1-A）
  └─ 1-C: 混合检索融合（1个子代理，依赖1-A+1-B）

阶段二（上下文管理）
  ├─ 2-A: 上下文折叠（1个子代理）
  └─ 2-B: 通信事件持久化到 SQLite（1个子代理）

阶段三（记忆图谱）
  ├─ 3-A: 标签共现图（1个子代理）
  ├─ 3-B: 溯源下钻（1个子代理）
  └─ 3-C: 主动回忆工具（1个子代理）

阶段四（生产级增强）
  ├─ 4-A: 时态事实管理（1个子代理）
  └─ 4-B: 冷热知识分离 + 容灾（1个子代理）
```

## 风险与降级

| 风险 | 缓解 |
|---|---|
| better-sqlite3 编译失败 | 用 prebuild 版本，或 fallback 到 sql.js |
| hnswlib-node 编译失败 | 用 hnswlib 纯 JS 版，或用 SQLite 的向量扩展 |
| embedding 模型不可用 | 降级为纯 FTS5 + tag 检索 |
| 数据迁移丢失 | 先备份 JSON，迁移后对比条数 |
| 性能不如预期 | SQLite WAL + 索引 + 内存缓存热点 |

## 预期效果

| 指标 | 当前 | 改造后 |
|---|---|---|
| 检索方式 | 关键词 n-gram | 向量+BM25+tag 混合检索 |
| 存储 | JSON 全量重写 | SQLite WAL 增量 |
| 语义理解 | 无 | embedding 语义检索 |
| 记忆关联 | 无 | 标签共现图 |
| 上下文压缩 | 滚动摘要（已有） | 滚动摘要 + 上下文折叠 |
| 跨 Agent | CommEventStore（已有） | CommEventStore 持久化到 SQLite |
| 主动回忆 | 无 | light/deep/topic 三个工具 |
| 事实演化 | 覆盖丢失 | 时态 valid_from/to |
| 容灾 | 无 | 自动备份 + 降级 |
