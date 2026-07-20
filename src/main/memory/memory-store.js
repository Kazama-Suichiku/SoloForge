/**
 * SoloForge - 记忆存储层（SQLite 后端）
 *
 * 阶段一A 重构：底层持久化从 "JSON 文件 + 内存 Map" 切换到 SQLite
 * （better-sqlite3 WAL 模式，实现见 sqlite-store.js）。本文件保留为
 * 对外门面，所有读写委托 sqlite-store，保持其他模块（memory-manager /
 * memory-retriever / memory-extractor / memory-summarizer / memory-decay
 * / memory-ipc-handlers / company-switch 等）依赖的接口完全不变。
 *
 * 兼容性要点：
 * - 保留 this.index (Map<string, IndexEntry>)：memory-decay.js 直接读它做
 *   批量强化（batchReinforce）。改为从 SQLite 查询构建的内存索引缓存，
 *   add/update/remove/delete 后同步刷新，避免每次都走 DB。
 * - add/get/query/searchByTags/update/remove/getAll 等返回完整 MemoryEntry
 *   （与原 JSON 存储结构一致），不再是只有索引条目的子集。
 * - saveToDisk / saveToDiskSync / flush / clearCache 改为 no-op 或 WAL
 *   checkpoint：SQLite 自动持久化，无需防抖刷盘。
 * - loadFromDisk → sqlite-store.loadFromDisk()（打开库 + 建表）。
 * - reinitialize → sqlite-store.reinitialize()（切公司时关闭旧库开新库）。
 * - 数据迁移：首次加载时，若 SQLite 库为空但 JSON 文件存在，从 JSON 读全部
 *   记忆条目批量 INSERT 到 SQLite（迁移后不删 JSON，留作备份）。
 *
 * @module memory/memory-store
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');
const { createIndexEntry } = require('./memory-types');
const { sqliteStore } = require('./sqlite-store');
// 阶段 1-B：embedding 服务 + 向量索引
const embeddingService = require('./embedding-service');
const vectorIndex = require('./vector-index');
// 阶段 3-A：标签共现图
const { tagCooccurrence } = require('./tag-cooccurrence');

// 阶段 4-A：时态事实管理 —— 可失效的事实类型集合。
// 这三类记忆具有「同主题新事实覆盖旧事实」的语义：
//   - preference：用户偏好（变了就更新，旧的失效）
//   - fact：事实信息（事实更正，旧版本失效）
//   - company_fact：公司知识（公司情况变化，旧知识失效）
// 新记忆写入时，若发现同类型且 summary 子串匹配的旧有效记忆，
// 把旧的 valid_to = now（失效不删除），新的 valid_from = now（生效）。
const TEMPORAL_FACT_TYPES = new Set([
  'preference',
  'fact',
  'company_fact',
]);

// 同主题匹配时，summary 子串最小长度。太短会误匹配（如「用」单字），
// 太长会漏匹配（同主题但措辞不同）。6 字是经验值，能命中核心名词短语。
const TOPIC_MATCH_MIN_LEN = 6;

// ─── JSON 遗留目录/文件路径（仅迁移用）─────────────────────────
function getMemoryDir() {
  return path.join(dataPath.getBasePath(), 'memory');
}

/**
 * 记忆存储管理器（SQLite 后端）
 */
class MemoryStore {
  constructor() {
    /**
     * 内存索引缓存 — 从 SQLite 构建，查询时用作快速缓存
     * memory-decay.js 的 batchReinforce 直接读此 Map。
     * key: memoryId, value: IndexEntry
     * @type {Map<string, Object>}
     */
    this.index = new Map();

    this._loaded = false;
  }

  // ═══════════════════════════════════════════════════════════
  // 加载与迁移
  // ═══════════════════════════════════════════════════════════

  /**
   * 从磁盘加载：打开 SQLite 库 + 建表 + 数据迁移 + 构建内存索引 + 重建向量索引
   */
  _load() {
    if (this._loaded) return;
    // 1. 打开 SQLite（建表）
    sqliteStore.loadFromDisk();

    // 2. 首次迁移：如果 SQLite 空但 JSON 文件存在，从 JSON 批量导入
    this._migrateFromJsonIfNeeded();

    // 3. 构建内存索引缓存
    this._rebuildIndex();

    // 4. 重建 HNSW 向量索引（从 SQLite embedding BLOB 加载）
    //    失败不影响主流程，后续靠 FTS5 检索
    try {
      this.rebuildVectorIndex();
    } catch (e) {
      logger.warn('启动时重建向量索引失败（继续，降级 FTS5）', { error: e.message });
    }

    this._loaded = true;
    logger.info('记忆存储已加载 (SQLite)', { count: this.index.size });
  }

  /**
   * 从 JSON 文件迁移到 SQLite（仅首次执行）
   * 条件：SQLite 库为空 AND JSON memory 目录存在且有数据
   * 迁移后不删 JSON 文件（留作备份）
   * @private
   */
  _migrateFromJsonIfNeeded() {
    try {
      const count = sqliteStore.getStats().totalMemories;
      if (count > 0) return; // SQLite 已有数据，无需迁移

      const memoryDir = getMemoryDir();
      if (!fs.existsSync(memoryDir)) return;

      const entries = this._readAllJsonEntries(memoryDir);
      if (entries.length === 0) return;

      logger.info('开始从 JSON 迁移记忆到 SQLite', { count: entries.length });

      let migrated = 0;
      let errors = 0;
      for (const entry of entries) {
        if (!entry || !entry.id) continue;
        try {
          const r = sqliteStore.add(entry);
          if (r.success) migrated++;
          else errors++;
        } catch (e) {
          errors++;
          logger.warn('迁移单条记忆失败', { id: entry.id, error: e.message });
        }
      }

      logger.info('JSON → SQLite 迁移完成', {
        migrated,
        errors,
        total: entries.length,
      });
    } catch (error) {
      logger.error('JSON → SQLite 迁移失败（继续以空库运行）', error);
    }
  }

  /**
   * 扫描 JSON memory 目录，读出全部记忆条目
   * 遍历 short-term/ long-term/ shared/ user/ agents/ 子目录及 TYPE_TO_FILE 映射
   * @param {string} memoryDir
   * @returns {Object[]}
   * @private
   */
  _readAllJsonEntries(memoryDir) {
    const entries = [];
    const seen = new Set();

    const tryReadFile = (absPath) => {
      try {
        if (!fs.existsSync(absPath)) return;
        const raw = fs.readFileSync(absPath, 'utf-8');
        if (!raw || !raw.trim()) return;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return;
        for (const e of arr) {
          if (e && e.id && !seen.has(e.id)) {
            seen.add(e.id);
            entries.push(e);
          }
        }
      } catch (e) {
        logger.warn('迁移时读取 JSON 失败', { path: absPath, error: e.message });
      }
    };

    // 按 TYPE_TO_FILE 映射读
    for (const relPath of Object.values(TYPE_TO_FILE)) {
      tryReadFile(path.join(memoryDir, relPath));
    }

    // 遍历 agents/ 子目录（动态 agentId 文件）
    const agentsDir = path.join(memoryDir, 'agents');
    if (fs.existsSync(agentsDir)) {
      for (const name of fs.readdirSync(agentsDir)) {
        if (name.endsWith('.json')) {
          tryReadFile(path.join(agentsDir, name));
        }
      }
    }

    // 兜底：遍历所有子目录里的 .json（捕获未在映射中的文件）
    for (const sub of ['short-term', 'long-term', 'shared', 'user']) {
      const subDir = path.join(memoryDir, sub);
      if (!fs.existsSync(subDir)) continue;
      for (const name of fs.readdirSync(subDir)) {
        if (name.endsWith('.json')) {
          tryReadFile(path.join(subDir, name));
        }
      }
    }

    return entries;
  }

  /**
   * 从 SQLite 重建内存索引缓存
   * @private
   */
  _rebuildIndex() {
    this.index.clear();
    try {
      const all = sqliteStore.getAll();
      for (const entry of all) {
        this.index.set(entry.id, createIndexEntry(entry));
      }
    } catch (error) {
      logger.error('重建内存索引失败', error);
    }
  }

  /**
   * 同步单条索引（add/update/remove 后调用，避免全量 rebuild）
   * @private
   */
  _syncIndexForEntry(entry) {
    if (!entry || !entry.id) return;
    this.index.set(entry.id, createIndexEntry(entry));
  }

  // ═══════════════════════════════════════════════════════════
  // CRUD 操作（委托 sqliteStore）
  // ═══════════════════════════════════════════════════════════

  /**
   * 存储一条记忆
   * @param {Object} memoryEntry - 完整的 MemoryEntry
   * @returns {{ success: boolean, id?: string, error?: string }}
   */
  add(memoryEntry) {
    this._load();
    // 阶段 3-B：溯源下钻 —— 规范化 source_episode_id
    // 优先级：显式 sourceEpisodeId > source.episodeId > source.conversationId
    // 写到 entry.sourceEpisodeId，sqlite-store._entryToRow 会读取并入库。
    this._normalizeEpisodeId(memoryEntry);

    // 阶段 4-A：时态事实管理 —— 写入新事实前，把同主题的旧有效事实失效。
    // 仅对 preference/fact/company_fact 三类生效；其余类型直接写入。
    // 失效旧记忆后，新记忆的 valid_from 显式设为 now（生效时间）。
    if (TEMPORAL_FACT_TYPES.has(memoryEntry.type)) {
      try {
        this._invalidateSameTopic(memoryEntry);
      } catch (e) {
        // 时态失效失败不阻塞写入（降级为普通追加，旧记忆也保留）
        logger.debug('_invalidateSameTopic 失败（降级为普通追加）', {
          type: memoryEntry.type,
          error: e.message,
        });
      }
      // 新事实的生效时间显式设为 now（除非调用方已指定 validFrom）
      if (!memoryEntry.validFrom) {
        memoryEntry.validFrom = Date.now();
      }
    }

    const result = sqliteStore.add(memoryEntry);
    if (result.success) {
      this._syncIndexForEntry(memoryEntry);
      logger.debug('记忆已存储', { id: memoryEntry.id, type: memoryEntry.type });
      // 阶段 1-B：异步生成 embedding 并写入 SQLite + 向量索引
      // 不阻塞 add() 主流程；embedding 失败则降级（后续靠 FTS5 检索）
      this._triggerEmbedding(memoryEntry);
      // 阶段 3-A：标签共现图 —— 写入成功后更新 tag_pairs 共现计数
      // 失败静默降级（共现图缺失不影响记忆存储/检索）
      tagCooccurrence.updateOnAdd(memoryEntry.tags);
    }
    return result;
  }

  /**
   * 阶段 4-A：把与新记忆同主题（同 type + summary 子串匹配）的旧有效记忆失效。
   * 策略：从新记忆 summary 提取一个核心子串（去停用词后的最长连续片段），
   * 在 SQLite 里查同 type + summary LIKE 该子串 + valid_to IS NULL 的记忆，
   * 逐条 invalidateMemory（valid_to = now）。失败不抛（add 主流程已 try/catch）。
   *
   * 注意：summary 子串需转义 SQL LIKE 通配符（% _ \），否则误匹配。
   * 子串提取取 summary 中间一段（跳过首尾的虚词），长度 >= TOPIC_MATCH_MIN_LEN。
   *
   * @param {Object} newEntry 即将写入的新记忆
   * @returns {number} 被失效的旧记忆条数
   * @private
   */
  _invalidateSameTopic(newEntry) {
    if (!newEntry || !newEntry.type || !newEntry.summary) return 0;
    const summary = String(newEntry.summary).trim();
    if (summary.length < TOPIC_MATCH_MIN_LEN) return 0;

    // 提取主题子串：取 summary 的前 12 字作为匹配片段（摘要通常以主题词开头）。
    // 截断到 12 字避免 LIKE 匹配过长导致漏匹配；短于 6 字则跳过。
    const topic = summary.slice(0, 12);
    if (topic.length < TOPIC_MATCH_MIN_LEN) return 0;

    // 转义 LIKE 通配符：%、_、\
    const escaped = topic.replace(/[\\%_]/g, (ch) => '\\' + ch);
    const likePattern = `%${escaped}%`;

    try {
      const oldMemories = sqliteStore.findValidByTypeAndSummary(
        newEntry.type,
        likePattern
      );
      if (!oldMemories || oldMemories.length === 0) return 0;

      let invalidated = 0;
      const now = Date.now();
      for (const old of oldMemories) {
        // 不失效自己（newEntry 尚未写入，理论上不会命中，但防御性判断）
        if (old.id === newEntry.id) continue;
        const r = sqliteStore.invalidateMemory(old.id, now);
        if (r.success && r.invalidated) {
          invalidated++;
          // 同步内存索引：把旧记忆标记为已失效（validTo 写回索引条目便于调试）
          const idx = this.index.get(old.id);
          if (idx) {
            // IndexEntry 没有 validTo 字段，但更新 archived 不合适（archived 是衰减语义）。
            // 这里只做日志，检索时 sqlite-store.getValidMemories 已过滤；
            // retriever 的 recall 会通过 entry.validTo 判断。
          }
        }
      }
      if (invalidated > 0) {
        logger.info('同主题旧事实已失效', {
          type: newEntry.type,
          topic: topic,
          invalidated,
        });
      }
      return invalidated;
    } catch (e) {
      logger.debug('_invalidateSameTopic 查询/失效失败', { error: e.message });
      return 0;
    }
  }

  /**
   * 规范化记忆条目的 source_episode_id（阶段 3-B）
   * 若 entry 已有显式 sourceEpisodeId 则保留；否则从 source.episodeId /
   * source.conversationId 回填。就地修改 entry，不返回值。
   * @param {Object} entry
   * @private
   */
  _normalizeEpisodeId(entry) {
    if (!entry || entry.sourceEpisodeId) return;
    const src = entry.source;
    if (src && typeof src === 'object') {
      if (src.episodeId) {
        entry.sourceEpisodeId = String(src.episodeId);
      } else if (src.conversationId) {
        entry.sourceEpisodeId = String(src.conversationId);
      }
    }
  }

  /**
   * 批量存储记忆
   * @param {Object[]} memoryEntries
   * @returns {{ success: boolean, count: number, errors: string[] }}
   */
  addMultiple(memoryEntries) {
    this._load();
    const errors = [];
    let count = 0;

    for (const entry of memoryEntries) {
      // 阶段 3-B：批量写入也规范化 source_episode_id
      this._normalizeEpisodeId(entry);

      // 阶段 4-A：批量写入也做时态失效处理（与 add() 一致）
      if (TEMPORAL_FACT_TYPES.has(entry.type)) {
        try {
          this._invalidateSameTopic(entry);
        } catch (_e) {
          // 忽略，降级为普通追加
        }
        if (!entry.validFrom) {
          entry.validFrom = Date.now();
        }
      }

      const result = sqliteStore.add(entry);
      if (result.success) {
        count++;
        this._syncIndexForEntry(entry);
        // 阶段 1-B：批量写入也异步触发 embedding
        this._triggerEmbedding(entry);
        // 阶段 3-A：批量写入也更新标签共现统计
        tagCooccurrence.updateOnAdd(entry.tags);
      } else {
        errors.push(`${entry.id || 'unknown'}: ${result.error}`);
      }
    }

    return { success: errors.length === 0, count, errors };
  }

  /**
   * 根据 ID 获取完整的记忆条目
   * @param {string} memoryId
   * @returns {Object|null}
   */
  get(memoryId) {
    this._load();
    return sqliteStore.get(memoryId);
  }

  /**
   * 获取全部记忆条目（按创建时间倒序）
   * @returns {Object[]}
   */
  getAll() {
    this._load();
    return sqliteStore.getAll();
  }

  /**
   * 是否存在指定记忆
   * @param {string} memoryId
   * @returns {boolean}
   */
  has(memoryId) {
    this._load();
    return sqliteStore.has(memoryId);
  }

  /**
   * 更新记忆条目
   * @param {string} memoryId
   * @param {Object} updates - 要更新的字段
   * @returns {{ success: boolean, error?: string }}
   */
  update(memoryId, updates) {
    this._load();
    const result = sqliteStore.update(memoryId, updates);
    if (result.success) {
      // 同步内存索引：从 SQLite 重新读最新行
      const fresh = sqliteStore.get(memoryId);
      if (fresh) this._syncIndexForEntry(fresh);
    }
    return result;
  }

  /**
   * 删除一条记忆
   * @param {string} memoryId
   * @returns {{ success: boolean, error?: string }}
   */
  remove(memoryId) {
    this._load();
    const result = sqliteStore.delete(memoryId);
    if (result.success) {
      this.index.delete(memoryId);
      // 阶段 1-B：同步从向量索引移除（标记删除，不释放 slot）
      vectorIndex.removeVector(memoryId);
      logger.debug('记忆已删除', { id: memoryId });
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // 查询操作
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取所有索引条目（兼容旧接口：返回 IndexEntry 数组，而非完整 MemoryEntry）
   * @param {Object} [filters] - 过滤条件
   * @param {string} [filters.type]
   * @param {string} [filters.scope]
   * @param {string} [filters.agentId]
   * @param {boolean} [filters.includeArchived=false]
   * @param {boolean} [filters.includeSuperseded=false]
   * @returns {Object[]} 索引条目（IndexEntry）
   */
  query(filters = {}) {
    this._load();
    const {
      type,
      scope,
      agentId,
      includeArchived = false,
      includeSuperseded = false,
    } = filters;

    // 用内存索引做过滤（保持原行为：返回 IndexEntry 而非完整 entry）
    const results = [];
    for (const entry of this.index.values()) {
      if (!includeArchived && entry.archived) continue;
      if (!includeSuperseded && entry.supersededBy) continue;
      if (type && entry.type !== type) continue;
      if (scope && entry.scope !== scope) continue;
      if (agentId && entry.agentId !== agentId) continue;
      results.push(entry);
    }
    return results;
  }

  /**
   * 获取 Agent 可见的记忆索引（agent 专属 + shared + user）
   * @param {string} agentId
   * @returns {Object[]}
   */
  queryForAgent(agentId) {
    this._load();
    const results = [];
    for (const entry of this.index.values()) {
      if (entry.archived || entry.supersededBy) continue;
      if (entry.scope === 'shared' || entry.scope === 'user') {
        results.push(entry);
      } else if (entry.scope === 'agent' && entry.agentId === agentId) {
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * 按标签搜索记忆索引
   * @param {string[]} tags - 搜索标签
   * @param {Object} [filters] - 额外过滤（type/scope/agentId/includeArchived）
   * @returns {Object[]} 索引条目
   */
  searchByTags(tags, filters = {}) {
    this._load();
    if (!tags || tags.length === 0) return this.query(filters);

    // 用 sqliteStore 做标签 JOIN 查询，再转成 IndexEntry 格式以兼容
    const entries = sqliteStore.searchByTags(tags, filters);
    return entries.map((e) => createIndexEntry(e));
  }

  /**
   * 获取最近 N 条记忆索引
   * @param {number} [limit=20]
   * @param {Object} [filters]
   * @returns {Object[]}
   */
  getRecent(limit = 20, filters = {}) {
    const candidates = this.query(filters);
    candidates.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return candidates.slice(0, limit);
  }

  /**
   * 获取指定类型的所有完整记忆条目
   * @param {string} type
   * @param {string} [agentId]
   * @returns {Object[]}
   */
  getEntriesByType(type, agentId) {
    this._load();
    const filters = { type };
    if (agentId) filters.agentId = agentId;
    filters.includeArchived = true; // 兼容原行为：getEntriesByType 不过滤 archived
    filters.includeSuperseded = true;
    return sqliteStore.query(filters);
  }

  /**
   * 批量更新索引中的字段（用于衰减等批量操作）
   * memory-decay.runDecay() 用此方法批量标记 archived。
   * @param {Array<{id: string, updates: Object}>} batchUpdates
   */
  batchUpdateIndex(batchUpdates) {
    this._load();
    for (const { id, updates } of batchUpdates) {
      // 同步 SQLite
      sqliteStore.update(id, updates);
      // 同步内存索引
      const entry = this.index.get(id);
      if (entry) {
        Object.assign(entry, updates);
        if ('archived' in updates) entry.archived = !!updates.archived;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Embedding 与向量索引（阶段 1-B）
  // ═══════════════════════════════════════════════════════════

  /**
   * add() 成功后异步触发 embedding 生成 + 写入 SQLite + 加入向量索引。
   * - 不阻塞 add() 主流程（setImmediate 推迟到下一个 tick）。
   * - embedding 生成失败/服务禁用时静默降级（记忆已写入，后续靠 FTS5 检索）。
   * - 短文本（<= 10 字）跳过：embedding 对短文本意义不大，且多为系统占位。
   * @param {Object} entry
   * @private
   */
  _triggerEmbedding(entry) {
    if (!entry || !entry.id || !entry.content) return;
    // 短文本跳过（与执行计划一致：content.length > 10）
    if (entry.content.trim().length <= 10) return;
    // 已有 embedding（迁移来的记忆或重写）则不重复生成
    if (entry.embedding) return;

    const id = entry.id;
    const content = entry.content;
    setImmediate(async () => {
      try {
        const emb = await embeddingService.embed(content);
        if (!emb) {
          // embedding 服务不可用（模型未加载/禁用），静默降级
          return;
        }
        // 1. 写入 SQLite embedding BLOB（带模型签名）
        await sqliteStore.updateEmbedding(
          id,
          Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength),
          embeddingService.DEFAULT_MODEL
        );
        // 2. 加入内存向量索引
        vectorIndex.addVector(id, emb);
        logger.debug('embedding 已生成并入库', { id, dim: emb.length });
      } catch (e) {
        logger.debug('embedding 生成失败（降级到 FTS5）', { id, error: e.message });
      }
    });
  }

  /**
   * 从 SQLite 加载所有已有 embedding 重建 HNSW 向量索引。
   * 启动时调用一次（_load 内）+ 切换公司（reinitialize）后调用。
   *
   * 注意：此方法是同步的（SQLite 读 + hnswlib 构建都是同步），
   * 但 embedding 量可能大（~数百到数千条），构建耗时在毫秒级，
   * 可接受。若未来量上万可考虑移到 worker。
   *
   * @returns {{ built: boolean, count: number, errors: number }}
   */
  rebuildVectorIndex() {
    this._load();
    try {
      const embeddings = sqliteStore.getEmbeddings({ includeArchived: false });
      const items = embeddings.map((e) => ({
        id: e.id,
        embedding: e.embedding, // Buffer，vector-index.toNumberArray 支持
      }));
      const result = vectorIndex.buildIndex(items);
      logger.info('向量索引已重建', {
        count: result.count,
        errors: result.errors,
        total: embeddings.length,
      });
      return result;
    } catch (error) {
      logger.error('重建向量索引失败', { error: error.message });
      return { built: false, count: 0, errors: 1 };
    }
  }

  /**
   * 获取向量索引单例（供 1-C 阶段 memory-retriever 做向量召回）。
   * @returns {object} vector-index 模块导出
   */
  getVectorIndex() {
    return vectorIndex;
  }

  /**
   * 获取 embedding 服务单例（供 retriever 做查询向量化）。
   * @returns {object} embedding-service 模块导出
   */
  getEmbeddingService() {
    return embeddingService;
  }

  // ═══════════════════════════════════════════════════════════
  // FTS5 全文搜索（阶段 1-C retriever 会用，1-A 先暴露）
  // ═══════════════════════════════════════════════════════════

  /**
   * FTS5 全文搜索（trigram tokenizer，支持中文 3+ 字子串）
   * @param {string} query
   * @param {Object} [opts] - { limit, type, scope, agentId, includeArchived }
   * @returns {Object[]} 完整 MemoryEntry
   */
  searchFTS(query, opts = {}) {
    this._load();
    return sqliteStore.searchFTS(query, opts);
  }

  // ═══════════════════════════════════════════════════════════
  // 溯源下钻（阶段 3-B）
  // ═══════════════════════════════════════════════════════════

  /**
   * 读取一条记忆的 source_episode_id（指向原始通信事件 id）。
   * 调用方可据此 commEventStore.getEventById(episodeId) 下钻到原始通信。
   * @param {string} memoryId
   * @returns {string|null}
   */
  getEpisodeId(memoryId) {
    this._load();
    return sqliteStore.getEpisodeId(memoryId);
  }

  /**
   * 按 source_episode_id 反查所有记忆（同一原始通信事件派生的记忆）。
   * @param {string} episodeId
   * @returns {Object[]} 完整 MemoryEntry 数组（按 created_at 倒序）
   */
  getMemoriesByEpisodeId(episodeId) {
    this._load();
    return sqliteStore.getMemoriesByEpisodeId(episodeId);
  }

  /**
   * 事后补链/修正一条记忆的 source_episode_id。
   * @param {string} memoryId
   * @param {string|null} episodeId
   * @returns {{ success: boolean, error?: string }}
   */
  setEpisodeId(memoryId, episodeId) {
    this._load();
    const result = sqliteStore.setEpisodeId(memoryId, episodeId);
    if (result.success) {
      // 同步内存索引中的 sourceEpisodeId（IndexEntry 不含此字段，跳过；
      // 但下次 get() 会读到最新值，retriever 下钻不受影响）
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // 时态事实管理（阶段 4-A）
  // ═══════════════════════════════════════════════════════════

  /**
   * 将一条记忆标记为失效（valid_to = now），不删除数据。
   * 用于时态事实管理：新事实写入时把旧事实失效，保留历史可追溯。
   * @param {string} memoryId
   * @param {number} [invalidatedAt] 失效时间戳，默认 now
   * @returns {{ success: boolean, error?: string, invalidated?: boolean }}
   */
  invalidateMemory(memoryId, invalidatedAt) {
    this._load();
    const result = sqliteStore.invalidateMemory(memoryId, invalidatedAt);
    if (result.success && result.invalidated) {
      // 同步内存索引：失效后从索引中移除，避免 query/getRecent 返回已失效记忆
      this.index.delete(memoryId);
      // 阶段 1-B：同步从向量索引移除（失效记忆不应参与语义召回）
      try {
        vectorIndex.removeVector(memoryId);
      } catch (_e) {
        // 忽略
      }
    }
    return result;
  }

  /**
   * 查询当前有效的记忆（valid_to IS NULL）。
   * 默认检索只返回当前为真的事实。
   * @param {string} [agentId] Agent ID 过滤；null 则返回全部当前有效记忆
   * @returns {Object[]} 完整 MemoryEntry 数组（按 created_at 倒序）
   */
  getValidMemories(agentId) {
    this._load();
    return sqliteStore.getValidMemories(agentId);
  }

  /**
   * 时点回溯查询：返回某时刻「当时有效」的记忆。
   * 条件：valid_from <= atTime AND (valid_to IS NULL OR valid_to >= atTime)
   * @param {number} atTime 查询时刻（毫秒时间戳）
   * @param {string} [agentId] Agent ID 过滤
   * @returns {Object[]} 完整 MemoryEntry 数组
   */
  getHistoryMemories(atTime, agentId) {
    this._load();
    return sqliteStore.getHistoryMemories(atTime, agentId);
  }

  // ═══════════════════════════════════════════════════════════
  // 容灾备份（阶段 4-B）
  // ═══════════════════════════════════════════════════════════

  /**
   * 备份数据库到指定路径（在线热备份）。
   * 委托 sqliteStore.backup()，用 SQLite backup API 做 page 级快照。
   * @param {string} targetPath 备份文件绝对路径
   * @param {Object} [opts] { vacuum?: boolean }
   * @returns {{ success: boolean, path?: string, bytes?: number, error?: string }}
   */
  backup(targetPath, opts) {
    this._load();
    return sqliteStore.backup(targetPath, opts);
  }

  // ═══════════════════════════════════════════════════════════
  // 刷盘与生命周期（SQLite 自动持久化，多为 no-op）
  // ═══════════════════════════════════════════════════════════

  /**
   * 立即将所有数据刷入磁盘
   * SQLite 自动持久化，此处只做 WAL checkpoint
   */
  flush() {
    if (this._loaded) sqliteStore.saveToDisk();
    logger.info('记忆存储已刷盘 (WAL checkpoint)');
  }

  /**
   * 清空文件缓存（兼容旧接口，SQLite 模式下无文件缓存，no-op）
   */
  clearCache() {
    this.flush();
  }

  /**
   * 重新初始化（切换公司后调用）
   * 关闭当前 SQLite 库，打开新路径的库，重建内存索引 + 向量索引
   */
  reinitialize() {
    if (this._loaded) {
      sqliteStore.reinitialize();
    } else {
      sqliteStore.loadFromDisk();
      this._loaded = true;
    }
    this._migrateFromJsonIfNeeded();
    this._rebuildIndex();
    // 阶段 1-B：切换公司后重建向量索引（新库的 embedding）
    try {
      this.rebuildVectorIndex();
    } catch (e) {
      logger.warn('切换公司后重建向量索引失败', { error: e.message });
    }
    logger.info('记忆存储已重新初始化', { count: this.index.size });
  }

  // ═══════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取存储统计信息
   * @returns {Object}
   */
  getStats() {
    if (!this._loaded) this._load();
    const stats = sqliteStore.getStats();
    // 兼容字段：旧代码可能读 cachedFiles
    stats.cachedFiles = 0;
    return stats;
  }
}

// 单例
const memoryStore = new MemoryStore();

module.exports = { MemoryStore, memoryStore };
