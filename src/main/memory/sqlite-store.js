/**
 * SoloForge - SQLite 持久层（记忆存储）
 *
 * 阶段一A 产物：用 better-sqlite3 (WAL 模式) 替代 JSON 文件 + 内存 Map 作为记忆的
 * 真实持久化层。对外提供与 memory-store.js 现有接口兼容的方法（add/get/query/
 * searchByTags/update/delete/getAll/has/searchFTS/loadFromDisk/saveToDisk/
 * reinitialize/close/getStats），memory-store.js 内部改为委托本模块。
 *
 * 设计要点：
 * - 数据库文件路径：~/.soloforge/data/<account>/<company>/memory.db
 * - 表结构见 docs/refactor/memory-execution-plan.md 阶段一A
 * - FTS5 全文索引使用 trigram tokenizer（better-sqlite3 自带 sqlite 3.53 支持），
 *   trigram 对中文逐 3 字索引，能命中"你好世"这类 3+ 字查询；1-2 字短查询靠
 *   memory-store 的标签/摘要子串匹配兜底，不依赖 FTS5。
 * - FTS5 采用普通表（非 external-content）：FTS 拥有自己的数据副本，
 *   memories_fts.rowid 显式对齐 memories.rowid，DELETE/UPDATE 时直接操作
 *   FTS 表即可，避免 external-content 模式下列名对齐约束
 *   （memories.tags_json != FTS.tags_text）。
 * - 所有写操作在单事务中完成（memories + memory_tags + memories_fts 三表联动）。
 * - saveToDisk 为 no-op（SQLite 自动持久化），但做一次 WAL checkpoint(TRUNCATE)
 *   以释放 WAL 文件，便于备份/退出。
 * - 路径通过 dataPath 模块获取，与现有 memory-store.js 一致；切换公司时调
 *   reinitialize() 关闭当前库并打开新路径的库。
 *
 * @module memory/sqlite-store
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

// FTS5 trigram tokenizer：支持中文 3 字以上子串匹配
const FTS_TOKENIZER = "trigram";

// 表结构 DDL（幂等：IF NOT EXISTS）
// 阶段 3-B：memories 表新增 source_episode_id 列，用于溯源下钻到原始通信事件。
//   - 新库：CREATE TABLE 已包含该列
//   - 旧库：_open() 后通过 _migrateColumns() 幂等 ALTER TABLE ADD COLUMN
const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    scope TEXT NOT NULL,
    agent_id TEXT,
    content TEXT NOT NULL,
    summary TEXT,
    tags_json TEXT,
    importance REAL,
    access_count INTEGER DEFAULT 0,
    created_at INTEGER,
    last_accessed_at INTEGER,
    archived INTEGER DEFAULT 0,
    superseded_by TEXT,
    source_json TEXT,
    embedding BLOB,
    embedding_model TEXT,
    updated_at INTEGER,
    source_episode_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_type ON memories(type)`,
  `CREATE INDEX IF NOT EXISTS idx_scope ON memories(scope)`,
  `CREATE INDEX IF NOT EXISTS idx_agent ON memories(agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_archived ON memories(archived)`,
  // 阶段 3-B：溯源下钻索引 —— 按 episode_id 反查记忆
  `CREATE INDEX IF NOT EXISTS idx_source_episode ON memories(source_episode_id)`,

  `CREATE TABLE IF NOT EXISTS memory_tags (
    memory_id TEXT,
    tag TEXT,
    FOREIGN KEY (memory_id) REFERENCES memories(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tag ON memory_tags(tag)`,
  `CREATE INDEX IF NOT EXISTS idx_tag_mem ON memory_tags(memory_id)`,

  // FTS5 全文索引（普通表，非 external-content）
  // 用 trigram tokenizer：对文本建 3 字子串索引，中文 3+ 字查询可命中。
  // 非 external-content 模式：FTS 拥有自己的数据副本，DELETE/UPDATE 时直接操作
  // FTS 表即可，无需依赖 content 表列名对齐（memories.tags_json != FTS.tags_text）。
  // rowid 与 memories.rowid 对齐，便于 JOIN 与级联清理。
  `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    summary,
    tags_text,
    tokenize='${FTS_TOKENIZER}'
  )`,

  // 阶段二A：上下文折叠摘要缓存表
  // 按 content SHA-256 hash 缓存历史消息的折叠摘要，跨对话复用，避免对同一段
  // 长文反复调 LLM 生成摘要。
  //   - content_hash: 原始消息内容的 SHA-256，主键
  //   - summary: 折叠摘要文本（null 表示尚未生成）
  //   - summary_status: pending（已排队待生成）/ ready（已就绪）
  //   - embedding: 预留，摘要的 embedding（阶段四可用来做摘要级相似检索）
  //   - created_at / last_used: 时间戳，用于冷清理与 LRU
  `CREATE TABLE IF NOT EXISTS folding_entries (
    content_hash TEXT PRIMARY KEY,
    summary TEXT,
    summary_status TEXT,
    embedding BLOB,
    created_at INTEGER,
    last_used INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_folding_status ON folding_entries(summary_status)`,
  `CREATE INDEX IF NOT EXISTS idx_folding_last_used ON folding_entries(last_used)`,

  // 阶段三A：标签共现图（tag co-occurrence）
  // 每条记忆写入时，对其 tags 两两组合 (tag_a, tag_b) 计数 ++，
  // 检索时用共现矩阵从核心 tags 拉回关联 tags 扩展召回。
  // 约定 tag_a < tag_b（字典序）保证无向边唯一，避免 (a,b)/(b,a) 重复。
  // PRIMARY KEY(tag_a, tag_b) 天然为 tag_a 建索引；
  // 另建 idx_tag_pairs_b 加速 WHERE tag_b = ? 查询（getTagPairs 用 OR 查两侧）。
  `CREATE TABLE IF NOT EXISTS tag_pairs (
    tag_a TEXT,
    tag_b TEXT,
    count INTEGER,
    PRIMARY KEY (tag_a, tag_b)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tag_pairs_b ON tag_pairs(tag_b)`,
];

/**
 * SQLite 记忆持久层
 */
class SqliteMemoryStore {
  constructor() {
    /** @type {Database.Database|null} */
    this.db = null;
    /** @type {string|null} 当前数据库文件绝对路径 */
    this.dbPath = null;
    /** 当前是否已打开数据库 */
    this._opened = false;

    // 预编译语句（在 _open 中初始化）
    this._stmts = null;
  }

  // ═══════════════════════════════════════════════════════════
  // 路径与打开/关闭
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取当前公司下的 memory.db 绝对路径
   * 与 memory-store.js 的 getMemoryDir() 对齐：~/.soloforge/data/<acc>/<comp>/memory.db
   * @returns {string}
   */
  _getDbPath() {
    const basePath = dataPath.getBasePath();
    return path.join(basePath, 'memory.db');
  }

  /**
   * 打开数据库（WAL 模式）并建表
   * @private
   */
  _open() {
    if (this._opened && this.db) return;

    const dbPath = this._getDbPath();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.dbPath = dbPath;
    this._opened = true;

    // WAL 模式 + 正常同步（兼顾性能与持久化）
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    // 外键约束（用于 memory_tags -> memories）
    this.db.pragma('foreign_keys = ON');

    // 建表
    for (const ddl of DDL_STATEMENTS) {
      this.db.exec(ddl);
    }

    // 阶段 3-B：旧库迁移 —— 幂等 ALTER TABLE ADD COLUMN source_episode_id
    this._migrateColumns();

    // 预编译语句
    this._prepareStatements();

    logger.info('SQLite 记忆库已打开', { path: dbPath });
  }

  /**
   * 旧库列迁移（阶段 3-B）
   * 对已存在的 memories 表幂等补列 source_episode_id。
   * better-sqlite3 同步执行 ALTER TABLE；若列已存在则捕获错误并忽略。
   * @private
   */
  _migrateColumns() {
    if (!this.db) return;
    // 检查 memories 表是否已有 source_episode_id 列
    try {
      const cols = this.db.prepare(`PRAGMA table_info(memories)`).all();
      const hasCol = cols.some((c) => c.name === 'source_episode_id');
      if (!hasCol) {
        this.db.exec(`ALTER TABLE memories ADD COLUMN source_episode_id TEXT`);
        logger.info('memories 表已补列 source_episode_id（旧库迁移）');
      }
    } catch (error) {
      // 列已存在或表不存在，忽略
      logger.debug('source_episode_id 列迁移检查', { error: error.message });
    }
  }

  /**
   * 预编译常用 SQL 语句
   */
  _prepareStatements() {
    const db = this.db;
    this._stmts = {
      insertMemory: db.prepare(`
        INSERT INTO memories (
          id, type, scope, agent_id, content, summary, tags_json,
          importance, access_count, created_at, last_accessed_at,
          archived, superseded_by, source_json, embedding, embedding_model, updated_at,
          source_episode_id
        ) VALUES (
          @id, @type, @scope, @agent_id, @content, @summary, @tags_json,
          @importance, @access_count, @created_at, @last_accessed_at,
          @archived, @superseded_by, @source_json, @embedding, @embedding_model, @updated_at,
          @source_episode_id
        )
      `),
      insertTag: db.prepare(`INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)`),
      deleteTags: db.prepare(`DELETE FROM memory_tags WHERE memory_id = ?`),
      // FTS：显式指定 rowid = memories.rowid，便于 JOIN 与级联清理
      insertFts: db.prepare(`
        INSERT INTO memories_fts (rowid, content, summary, tags_text)
        VALUES (@rowid, @content, @summary, @tags_text)
      `),
      deleteFts: db.prepare(`DELETE FROM memories_fts WHERE rowid = ?`),
      getRowid: db.prepare(`SELECT rowid FROM memories WHERE id = ?`),
      getById: db.prepare(`SELECT * FROM memories WHERE id = ?`),
      deleteMemory: db.prepare(`DELETE FROM memories WHERE id = ?`),
      hasMemory: db.prepare(`SELECT 1 FROM memories WHERE id = ?`),
      countAll: db.prepare(`SELECT COUNT(*) AS c FROM memories`),
      countByType: db.prepare(`SELECT type, COUNT(*) AS c FROM memories GROUP BY type`),
      countByScope: db.prepare(`SELECT scope, COUNT(*) AS c FROM memories GROUP BY scope`),
      countArchived: db.prepare(`SELECT COUNT(*) AS c FROM memories WHERE archived = 1`),
      getAll: db.prepare(`SELECT * FROM memories ORDER BY created_at DESC`),
      // 阶段 1-B：embedding 更新（异步写入，add() 之外单独 UPDATE）
      updateEmbedding: db.prepare(
        `UPDATE memories SET embedding = @embedding, embedding_model = @embedding_model, updated_at = @updated_at WHERE id = @id`
      ),
      // 阶段 2-A：folding_entries 读写
      getFoldingEntry: db.prepare(
        `SELECT content_hash, summary, summary_status, created_at, last_used FROM folding_entries WHERE content_hash = ?`
      ),
      insertFoldingEntry: db.prepare(
        `INSERT OR REPLACE INTO folding_entries (content_hash, summary, summary_status, created_at, last_used)
         VALUES (@content_hash, @summary, @summary_status, @created_at, @last_used)`
      ),
      touchFoldingEntry: db.prepare(
        `UPDATE folding_entries SET last_used = @last_used WHERE content_hash = @content_hash`
      ),
      // 阶段 3-B：溯源下钻 —— 按 id 读 source_episode_id，按 episode_id 反查记忆
      getEpisodeId: db.prepare(`SELECT source_episode_id FROM memories WHERE id = ?`),
      getMemoriesByEpisodeId: db.prepare(
        `SELECT * FROM memories WHERE source_episode_id = ? ORDER BY created_at DESC`
      ),
      updateEpisodeId: db.prepare(
        `UPDATE memories SET source_episode_id = @source_episode_id, updated_at = @updated_at WHERE id = @id`
      ),
      // 阶段 3-A：标签共现图 —— upsert 一对共现标签（约定 tag_a < tag_b）
      // INSERT 新行 count=1；已存在则 count+1（ON CONFLICT … DO UPDATE）。
      upsertTagPair: db.prepare(`
        INSERT INTO tag_pairs (tag_a, tag_b, count) VALUES (@tag_a, @tag_b, 1)
        ON CONFLICT(tag_a, tag_b) DO UPDATE SET count = count + 1
      `),
      // 阶段 3-A：查某 tag 的所有共现对（两侧都查：tag_a=? OR tag_b=?）
      // 返回 otherTag + count，调用方据此聚合关联 tag。
      getTagPairsByA: db.prepare(
        `SELECT tag_b AS otherTag, count FROM tag_pairs WHERE tag_a = ?`
      ),
      getTagPairsByB: db.prepare(
        `SELECT tag_a AS otherTag, count FROM tag_pairs WHERE tag_b = ?`
      ),
    };
  }

  /**
   * 关闭数据库
   */
  close() {
    if (!this._opened || !this.db) return;
    try {
      // 退出前做一次 WAL checkpoint，把 WAL 写回主库
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      // 忽略 checkpoint 错误
    }
    try {
      this.db.close();
    } catch (e) {
      logger.warn('关闭 SQLite 记忆库失败', { error: e.message });
    }
    this.db = null;
    this.dbPath = null;
    this._opened = false;
    this._stmts = null;
  }

  // ═══════════════════════════════════════════════════════════
  // 行 <-> MemoryEntry 转换
  // ═══════════════════════════════════════════════════════════

  /**
   * 数据库行 -> MemoryEntry（还原嵌套字段，与现有 JSON 结构对齐）
   * @param {Object} row
   * @returns {Object}
   */
  _rowToEntry(row) {
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      scope: row.scope,
      agentId: row.agent_id,
      content: row.content,
      summary: row.summary,
      tags: row.tags_json ? safeParseJson(row.tags_json, []) : [],
      importance: row.importance,
      accessCount: row.access_count,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      archived: !!row.archived,
      supersededBy: row.superseded_by,
      source: row.source_json ? safeParseJson(row.source_json, {}) : {},
      relatedAgents: [],  // DB 未单独存，保留空数组兼容
      relatedMemoryIds: [],  // 同上
      // embedding 字段（阶段 1-B 填充）
      embedding: row.embedding || null,
      embeddingModel: row.embedding_model || null,
      updatedAt: row.updated_at || row.created_at,
      // 阶段 3-B：溯源下钻 —— 指向原始通信事件 id（comm_events.id）
      sourceEpisodeId: row.source_episode_id || null,
    };
  }

  /**
   * MemoryEntry -> 数据库行参数
   * @param {Object} entry
   * @returns {Object}
   */
  _entryToRow(entry) {
    return {
      id: entry.id,
      type: entry.type,
      scope: entry.scope,
      agent_id: entry.agentId ?? null,
      content: entry.content,
      summary: entry.summary ?? null,
      tags_json: JSON.stringify(entry.tags || []),
      importance: entry.importance ?? null,
      access_count: entry.accessCount ?? 0,
      created_at: entry.createdAt ?? Date.now(),
      last_accessed_at: entry.lastAccessedAt ?? entry.createdAt ?? Date.now(),
      archived: entry.archived ? 1 : 0,
      superseded_by: entry.supersededBy ?? null,
      source_json: JSON.stringify(entry.source || {}),
      embedding: entry.embedding || null,
      embedding_model: entry.embeddingModel || null,
      updated_at: entry.updatedAt ?? entry.createdAt ?? Date.now(),
      // 阶段 3-B：溯源下钻 —— 显式字段优先，回退到 source.episodeId / source.conversationId
      source_episode_id:
        entry.sourceEpisodeId ??
        entry.source?.episodeId ??
        entry.source?.conversationId ??
        null,
    };
  }

  /**
   * 从 MemoryEntry 生成 FTS 索引文本参数
   * 标签用空格拼接，便于 trigram + 子串匹配
   * @param {Object} entry
   * @returns {{content: string, summary: string, tags_text: string}}
   */
  _entryToFtsText(entry) {
    return {
      content: entry.content || '',
      summary: entry.summary || '',
      tags_text: (entry.tags || []).join(' '),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * 新增一条记忆（含 tags + FTS 索引，单事务）
   * @param {Object} entry
   * @returns {{ success: boolean, id?: string, error?: string }}
   */
  add(entry) {
    if (!this._opened) this._open();
    if (!entry || !entry.id) {
      return { success: false, error: '记忆条目缺少 id' };
    }
    try {
      const insertOne = this.db.transaction((e) => {
        const row = this._entryToRow(e);
        this._stmts.insertMemory.run(row);
        // tags
        const tags = e.tags || [];
        for (const tag of tags) {
          if (tag != null) this._stmts.insertTag.run(e.id, String(tag));
        }
        // FTS
        const rowid = this._stmts.getRowid.get(e.id)?.rowid;
        if (rowid != null) {
          const ftsText = this._entryToFtsText(e);
          this._stmts.insertFts.run({ rowid, ...ftsText });
        }
      });
      insertOne(entry);
      return { success: true, id: entry.id };
    } catch (error) {
      logger.error('SQLite 存储记忆失败', { id: entry.id, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 根据 ID 获取完整记忆条目
   * @param {string} id
   * @returns {Object|null}
   */
  get(id) {
    if (!this._opened) this._open();
    const row = this._stmts.getById.get(id);
    return this._rowToEntry(row);
  }

  /**
   * 是否存在
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    if (!this._opened) this._open();
    return !!this._stmts.hasMemory.get(id);
  }

  /**
   * 条件查询（返回完整条目，默认排除 archived 和 superseded）
   * 兼容 memory-store.query 的过滤器：{ type, scope, agentId, includeArchived, includeSuperseded }
   * @param {Object} filters
   * @returns {Object[]}
   */
  query(filters = {}) {
    if (!this._opened) this._open();
    const {
      type,
      scope,
      agentId,
      tags,
      includeArchived = false,
      includeSuperseded = false,
    } = filters;

    const where = [];
    const params = [];
    if (type) { where.push('type = ?'); params.push(type); }
    if (scope) { where.push('scope = ?'); params.push(scope); }
    if (agentId) { where.push('agent_id = ?'); params.push(agentId); }
    if (!includeArchived) { where.push('archived = 0'); }
    if (!includeSuperseded) { where.push('superseded_by IS NULL'); }

    let sql = 'SELECT * FROM memories';
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY created_at DESC';

    let rows = this.db.prepare(sql).all(...params);

    // 标签过滤（内存里做，标签量小）
    if (tags && tags.length > 0) {
      const lowerTags = tags.map((t) => String(t).toLowerCase());
      rows = rows.filter((r) => {
        const entryTags = (r.tags_json ? safeParseJson(r.tags_json, []) : []).map((t) =>
          String(t).toLowerCase()
        );
        return lowerTags.some((t) => entryTags.includes(t));
      });
    }

    return rows.map((r) => this._rowToEntry(r));
  }

  /**
   * 按标签搜索（JOIN memory_tags，大小写不敏感）
   * @param {string[]} tags
   * @param {Object} [opts] 额外过滤：{ type, scope, agentId, includeArchived }
   * @returns {Object[]}
   */
  searchByTags(tags, opts = {}) {
    if (!this._opened) this._open();
    if (!tags || tags.length === 0) return this.query(opts);

    // 标签大小写不敏感：用 LOWER(t.tag) IN (lowerTags)
    const placeholders = tags.map(() => '?').join(',');
    const lowerTags = tags.map((t) => String(t).toLowerCase());

    const where = [`LOWER(t.tag) IN (${placeholders})`];
    const params = [...lowerTags];

    if (opts.type) { where.push('m.type = ?'); params.push(opts.type); }
    if (opts.scope) { where.push('m.scope = ?'); params.push(opts.scope); }
    if (opts.agentId) { where.push('m.agent_id = ?'); params.push(opts.agentId); }
    if (!opts.includeArchived) { where.push('m.archived = 0'); }
    where.push('m.superseded_by IS NULL');

    const sql = `
      SELECT m.* FROM memories m
      INNER JOIN memory_tags t ON t.memory_id = m.id
      WHERE ${where.join(' AND ')}
      GROUP BY m.id
      ORDER BY m.created_at DESC
    `;
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => this._rowToEntry(r));
  }

  /**
   * 更新一条记忆（合并更新；同步 tags + FTS）
   * @param {string} id
   * @param {Object} changes
   * @returns {{ success: boolean, error?: string }}
   */
  update(id, changes) {
    if (!this._opened) this._open();
    const existing = this._stmts.getById.get(id);
    if (!existing) {
      return { success: false, error: `记忆不存在: ${id}` };
    }

    try {
      const updateOne = this.db.transaction(() => {
        // 字段映射：camelCase -> snake_case
        const fieldMap = {
          type: 'type',
          scope: 'scope',
          agentId: 'agent_id',
          content: 'content',
          summary: 'summary',
          importance: 'importance',
          accessCount: 'access_count',
          createdAt: 'created_at',
          lastAccessedAt: 'last_accessed_at',
          archived: 'archived',
          supersededBy: 'superseded_by',
          embedding: 'embedding',
          embeddingModel: 'embedding_model',
          updatedAt: 'updated_at',
          sourceEpisodeId: 'source_episode_id',
        };

        const sets = [];
        const params = { id };
        for (const [key, value] of Object.entries(changes)) {
          if (key === 'id') continue; // 不允许改 id
          if (key === 'tags') {
            // tags：更新 tags_json 列 + memory_tags 表
            sets.push('tags_json = @tags_json');
            params.tags_json = JSON.stringify(value || []);
            continue;
          }
          if (key === 'source') {
            sets.push('source_json = @source_json');
            params.source_json = JSON.stringify(value || {});
            continue;
          }
          const col = fieldMap[key];
          if (!col) continue;
          let v = value;
          if (key === 'archived') v = value ? 1 : 0;
          sets.push(`${col} = @${col}`);
          params[col] = v;
        }
        // updated_at 自动刷新
        if (!('updated_at' in params) && !('updatedAt' in changes)) {
          sets.push('updated_at = @updated_at');
          params.updated_at = Date.now();
        }

        if (sets.length > 0) {
          const sql = `UPDATE memories SET ${sets.join(', ')} WHERE id = @id`;
          this.db.prepare(sql).run(params);
        }

        // tags 更新（如果提供了 tags 字段）
        if (Array.isArray(changes.tags)) {
          this._stmts.deleteTags.run(id);
          for (const tag of changes.tags) {
            if (tag != null) this._stmts.insertTag.run(id, String(tag));
          }
        }

        // FTS 同步：如果 content/summary/tags 变了，重建该行 FTS
        const ftsDirty =
          'content' in changes || 'summary' in changes || 'tags' in changes;
        if (ftsDirty) {
          const fresh = this._stmts.getById.get(id);
          if (fresh) {
            const rowid = this._stmts.getRowid.get(id)?.rowid;
            if (rowid != null) {
              this._stmts.deleteFts.run(rowid);
              const tagsArr = fresh.tags_json ? safeParseJson(fresh.tags_json, []) : [];
              this._stmts.insertFts.run({
                rowid,
                content: fresh.content || '',
                summary: fresh.summary || '',
                tags_text: tagsArr.join(' '),
              });
            }
          }
        }
      });
      updateOne();
      return { success: true };
    } catch (error) {
      logger.error('SQLite 更新记忆失败', { id, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除一条记忆（含 tags + FTS）
   * @param {string} id
   * @returns {{ success: boolean, error?: string }}
   */
  delete(id) {
    if (!this._opened) this._open();
    const existing = this._stmts.hasMemory.get(id);
    if (!existing) {
      return { success: false, error: `记忆不存在: ${id}` };
    }
    try {
      const deleteOne = this.db.transaction(() => {
        const rowid = this._stmts.getRowid.get(id)?.rowid;
        this._stmts.deleteTags.run(id);
        if (rowid != null) this._stmts.deleteFts.run(rowid);
        this._stmts.deleteMemory.run(id);
      });
      deleteOne();
      return { success: true };
    } catch (error) {
      logger.error('SQLite 删除记忆失败', { id, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取全部记忆（按创建时间倒序）
   * @returns {Object[]}
   */
  getAll() {
    if (!this._opened) this._open();
    return this._stmts.getAll.all().map((r) => this._rowToEntry(r));
  }

  // ═══════════════════════════════════════════════════════════
  // Embedding 读写（阶段 1-B）
  // ═══════════════════════════════════════════════════════════

  /**
   * 异步更新某条记忆的 embedding。
   * add() 是同步的（better-sqlite3 同步），embedding 异步生成后用本方法
   * 单独 UPDATE 写入 embedding + embedding_model 字段。
   *
   * 注意：虽然方法名带 async，但 better-sqlite3 本身是同步的——这里标 async
   * 只是为了与调用方（memory-store.add 后的 setImmediate 异步链）签名一致，
   * 实际执行是同步的。为避免阻塞主进程，调用方应在 setImmediate / 异步
   * 回调中调用本方法，不在 add() 主流程里同步等待。
   *
   * @param {string} id 记忆 id
   * @param {Buffer|Float32Array|ArrayBuffer} embedding 向量
   * @param {string} [modelName='all-MiniLM-L6-v2'] 模型签名
   * @returns {{ success: boolean, error?: string }}
   */
  async updateEmbedding(id, embedding, modelName = 'all-MiniLM-L6-v2') {
    if (!this._opened) this._open();
    if (!id || !embedding) {
      return { success: false, error: '缺少 id 或 embedding' };
    }
    try {
      // 统一转 Buffer 存储（Float32Array → Buffer 视图，零拷贝）
      let buf;
      if (Buffer.isBuffer(embedding)) {
        buf = embedding;
      } else if (embedding instanceof Float32Array) {
        buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
      } else if (embedding instanceof ArrayBuffer) {
        buf = Buffer.from(embedding);
      } else if (Array.isArray(embedding)) {
        buf = Buffer.from(new Float32Array(embedding).buffer);
      } else {
        return { success: false, error: 'embedding 类型不支持' };
      }
      this._stmts.updateEmbedding.run({
        id,
        embedding: buf,
        embedding_model: modelName,
        updated_at: Date.now(),
      });
      return { success: true };
    } catch (error) {
      logger.warn('更新 embedding 失败', { id, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 读取所有已生成 embedding 的记忆（id + embedding + embedding_model）。
   * 用于启动时从 SQLite 重建 HNSW 向量索引（vector-index.buildIndex）。
   *
   * 返回的 embedding 是 Buffer（Float32 序列化），调用方（memory-store.
   * rebuildVectorIndex）需转回 Float32Array 或直接传给 vector-index
   * （vector-index.toNumberArray 支持 Buffer）。
   *
   * @param {Object} [opts] - { includeArchived: false }
   * @returns {Array<{id: string, embedding: Buffer, embeddingModel: string}>}
   */
  getEmbeddings(opts = {}) {
    if (!this._opened) this._open();
    const { includeArchived = false } = opts;
    const sql = includeArchived
      ? `SELECT id, embedding, embedding_model FROM memories WHERE embedding IS NOT NULL`
      : `SELECT id, embedding, embedding_model FROM memories WHERE embedding IS NOT NULL AND archived = 0`;
    try {
      const rows = this.db.prepare(sql).all();
      return rows.map((r) => ({
        id: r.id,
        embedding: r.embedding,
        embeddingModel: r.embedding_model,
      }));
    } catch (error) {
      logger.warn('读取 embeddings 失败', { error: error.message });
      return [];
    }
  }

  /**
   * 获取单条记忆的 embedding（供 retriever 做单条相似度计算）。
   * @param {string} id
   * @returns {{ embedding: Buffer|null, embeddingModel: string|null }}
   */
  getEmbedding(id) {
    if (!this._opened) this._open();
    try {
      const row = this.db
        .prepare(`SELECT embedding, embedding_model FROM memories WHERE id = ?`)
        .get(id);
      if (!row) return { embedding: null, embeddingModel: null };
      return { embedding: row.embedding || null, embeddingModel: row.embedding_model || null };
    } catch (error) {
      logger.warn('读取单条 embedding 失败', { id, error: error.message });
      return { embedding: null, embeddingModel: null };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 溯源下钻（阶段 3-B）
  // ═══════════════════════════════════════════════════════════

  /**
   * 读取一条记忆的 source_episode_id（指向原始通信事件 id）。
   * 用于从记忆下钻到原始通信：memory → sourceEpisodeId → commEventStore.getEventById
   * @param {string} memoryId
   * @returns {string|null} episode id；记忆不存在或未设置时返回 null
   */
  getEpisodeId(memoryId) {
    if (!this._opened) this._open();
    if (!memoryId) return null;
    try {
      const row = this._stmts.getEpisodeId.get(memoryId);
      if (!row) return null;
      return row.source_episode_id || null;
    } catch (error) {
      logger.warn('getEpisodeId 查询失败', { id: memoryId, error: error.message });
      return null;
    }
  }

  /**
   * 按 source_episode_id 反查所有记忆（同一原始通信事件派生的记忆）。
   * 用于「同一会话/事件生成了哪些记忆」的聚合查询。
   * @param {string} episodeId
   * @returns {Object[]} 完整 MemoryEntry 数组（按 created_at 倒序）
   */
  getMemoriesByEpisodeId(episodeId) {
    if (!this._opened) this._open();
    if (!episodeId) return [];
    try {
      const rows = this._stmts.getMemoriesByEpisodeId.all(episodeId);
      return rows.map((r) => this._rowToEntry(r));
    } catch (error) {
      logger.warn('getMemoriesByEpisodeId 查询失败', { episodeId, error: error.message });
      return [];
    }
  }

  /**
   * 更新一条记忆的 source_episode_id（用于事后补链或修正）。
   * @param {string} memoryId
   * @param {string|null} episodeId
   * @returns {{ success: boolean, error?: string }}
   */
  setEpisodeId(memoryId, episodeId) {
    if (!this._opened) this._open();
    if (!memoryId) return { success: false, error: '缺少 memoryId' };
    try {
      this._stmts.updateEpisodeId.run({
        id: memoryId,
        source_episode_id: episodeId ?? null,
        updated_at: Date.now(),
      });
      return { success: true };
    } catch (error) {
      logger.warn('setEpisodeId 更新失败', { id: memoryId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 标签共现图（阶段 3-A）
  // ═══════════════════════════════════════════════════════════

  /**
   * 增量更新一对共现标签的计数。
   * 约定调用方保证 tag_a < tag_b（字典序），使无向边唯一；
   * tag-cooccurrence.updateOnAdd 已做该归一化。这里不强制校验，直接 upsert：
   * 新行 count=1，已存在则 count+1（ON CONFLICT … DO UPDATE，预编译语句实现）。
   *
   * @param {string} tagA
   * @param {string} tagB
   * @returns {{ success: boolean, error?: string }}
   */
  upsertTagPair(tagA, tagB) {
    if (!this._opened) this._open();
    if (!tagA || !tagB) return { success: false, error: '缺少 tag' };
    try {
      this._stmts.upsertTagPair.run({ tag_a: String(tagA), tag_b: String(tagB) });
      return { success: true };
    } catch (error) {
      logger.debug('upsertTagPair 失败', { tagA, tagB, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 查询某 tag 的所有共现对，返回关联 tag + 共现次数。
   * tag_pairs 中 tag 可能出现在 tag_a 或 tag_b 任一侧（因 tag_a < tag_b 归一），
   * 故两侧分别查询后合并。返回 { otherTag, count } 数组。
   *
   * @param {string} tag
   * @returns {Array<{otherTag: string, count: number}>}
   */
  getTagPairs(tag) {
    if (!this._opened) this._open();
    if (!tag) return [];
    try {
      const t = String(tag);
      const asA = this._stmts.getTagPairsByA.all(t);
      const asB = this._stmts.getTagPairsByB.all(t);
      // 合并两侧；同一边不会同时出现在两侧（tag_a<tag_b），无需去重
      return [...asA, ...asB].map((r) => ({
        otherTag: r.otherTag,
        count: r.count || 0,
      }));
    } catch (error) {
      logger.debug('getTagPairs 查询失败', { tag, error: error.message });
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 上下文折叠摘要缓存（阶段 2-A）
  // ═══════════════════════════════════════════════════════════

  /**
   * 读取一条折叠摘要缓存。
   * @param {string} contentHash 原始消息内容的 SHA-256
   * @returns {{content_hash: string, summary: string|null, summary_status: string, created_at: number, last_used: number}|null}
   */
  getFoldingEntry(contentHash) {
    if (!this._opened) this._open();
    if (!contentHash) return null;
    try {
      return this._stmts.getFoldingEntry.get(contentHash) || null;
    } catch (error) {
      logger.warn('读取 folding_entries 失败', {
        hash: String(contentHash).slice(0, 12),
        error: error.message,
      });
      return null;
    }
  }

  /**
   * 写入/覆盖一条折叠摘要缓存（INSERT OR REPLACE）。
   * @param {string} contentHash SHA-256
   * @param {string|null} summary 摘要文本（null 表示尚未生成）
   * @param {string} status 'pending' | 'ready'
   * @returns {{ success: boolean, error?: string }}
   */
  saveFoldingEntry(contentHash, summary, status) {
    if (!this._opened) this._open();
    if (!contentHash) return { success: false, error: '缺少 content_hash' };
    const now = Date.now();
    try {
      this._stmts.insertFoldingEntry.run({
        content_hash: contentHash,
        summary: summary ?? null,
        summary_status: status || 'pending',
        created_at: now,
        last_used: now,
      });
      return { success: true };
    } catch (error) {
      logger.warn('写入 folding_entries 失败', {
        hash: String(contentHash).slice(0, 12),
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * 刷新 last_used 时间戳（命中时调用，供冷清理/LRU 用）。
   * @param {string} contentHash
   */
  touchFoldingEntry(contentHash) {
    if (!this._opened) this._open();
    if (!contentHash) return;
    try {
      this._stmts.touchFoldingEntry.run({
        content_hash: contentHash,
        last_used: Date.now(),
      });
    } catch (_e) {
      // 静默：touch 失败不影响主流程
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FTS5 全文搜索
  // ═══════════════════════════════════════════════════════════

  /**
   * FTS5 全文搜索（trigram tokenizer）
   * @param {string} query - 查询文本（3 字以上子串可命中中文）
   * @param {Object} [opts] - { limit, type, scope, agentId, includeArchived }
   * @returns {Object[]} 匹配的记忆条目（按 FTS rank 排序）
   */
  searchFTS(query, opts = {}) {
    if (!this._opened) this._open();
    if (!query || typeof query !== 'string') return [];

    const { limit = 50, type, scope, agentId, includeArchived = false } = opts;

    // 转义 FTS5 特殊字符：构建 MATCH 表达式
    // trigram 对原始字符串做子串匹配，用双引号包裹整个查询词最安全
    const matchExpr = ftsMatchExpr(query);

    const where = [`memories_fts MATCH ?`];
    const params = [matchExpr];
    if (type) { where.push('m.type = ?'); params.push(type); }
    if (scope) { where.push('m.scope = ?'); params.push(scope); }
    if (agentId) { where.push('m.agent_id = ?'); params.push(agentId); }
    if (!includeArchived) { where.push('m.archived = 0'); }
    where.push('m.superseded_by IS NULL');

    const sql = `
      SELECT m.* FROM memories m
      JOIN memories_fts ON memories_fts.rowid = m.rowid
      WHERE ${where.join(' AND ')}
      ORDER BY rank
      LIMIT ?
    `;
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params);
      return rows.map((r) => this._rowToEntry(r));
    } catch (error) {
      logger.warn('FTS 搜索失败，降级返回空', { query: query.slice(0, 50), error: error.message });
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 生命周期
  // ═══════════════════════════════════════════════════════════

  /**
   * 从磁盘加载（打开数据库 + 建表）
   * 兼容 memory-store.loadFromDisk() 调用约定
   */
  loadFromDisk() {
    this._open();
  }

  /**
   * 保存到磁盘（no-op：SQLite 自动持久化）
   * 做一次 WAL checkpoint(TRUNCATE) 释放 WAL 文件
   */
  saveToDisk() {
    if (!this._opened || !this.db) return;
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      // 忽略
    }
  }

  /**
   * 重新初始化（切换公司后调用）
   * 关闭当前库，打开新路径的库
   */
  reinitialize() {
    this.close();
    this._open();
  }

  // ═══════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    if (!this._opened) this._open();
    const total = this._stmts.countAll.get().c;
    const byType = {};
    for (const { type, c } of this._stmts.countByType.all()) byType[type] = c;
    const byScope = {};
    for (const { scope, c } of this._stmts.countByScope.all()) byScope[scope] = c;
    const archived = this._stmts.countArchived.get().c;
    return {
      totalMemories: total,
      byType,
      byScope,
      archived,
      cachedFiles: 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

/**
 * 安全解析 JSON，失败返回 fallback
 */
function safeParseJson(str, fallback) {
  try {
    return JSON.parse(str);
  } catch (_e) {
    return fallback;
  }
}

/**
 * 把用户查询转换为 FTS5 MATCH 表达式
 * trigram tokenizer 对原始文本做子串匹配，直接用短语查询（双引号包裹）
 * 即可实现"包含子串"语义。多词用空格分隔（AND 语义）。
 * @param {string} query
 * @returns {string}
 */
function ftsMatchExpr(query) {
  // 去掉 FTS5 控制字符
  const cleaned = query.replace(/["*]/g, ' ').trim();
  if (!cleaned) return '""';
  // 整体作为短语查询（trigram 下短语 = 子串匹配）
  return `"${cleaned}"`;
}

// 单例
const sqliteStore = new SqliteMemoryStore();

module.exports = { SqliteMemoryStore, sqliteStore };
