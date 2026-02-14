/**
 * SoloForge - 记忆存储层
 * JSON 文件读写、索引管理、防抖写入、按类型分文件存储
 * @module memory/memory-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');
const {
  MEMORY_CONFIG,
  MEMORY_TYPES,
  TYPE_TO_FILE,
  AGENT_TYPES,
  createIndexEntry,
} = require('./memory-types');

function getMemoryDir() {
  return path.join(dataPath.getBasePath(), 'memory');
}

function getIndexPath() {
  return path.join(getMemoryDir(), MEMORY_CONFIG.INDEX_FILE);
}

/**
 * 记忆存储管理器
 */
class MemoryStore {
  constructor() {
    /**
     * 内存索引 — 启动时加载，查询不走磁盘
     * key: memoryId, value: IndexEntry
     * @type {Map<string, Object>}
     */
    this.index = new Map();

    /**
     * 文件内容缓存 — 按文件路径缓存，避免重复读取
     * key: 相对路径, value: { entries: Object[], dirty: boolean }
     * @type {Map<string, { entries: Object[], dirty: boolean }>}
     */
    this.fileCache = new Map();

    /**
     * 防抖定时器 — 按文件路径独立防抖
     * @type {Map<string, ReturnType<typeof setTimeout>>}
     */
    this.debounceTimers = new Map();

    /** 索引防抖定时器 */
    this._indexDebounceTimer = null;

    this._ensureDirectories();
    this._loadIndex();
  }

  // ═══════════════════════════════════════════════════════════
  // 目录初始化
  // ═══════════════════════════════════════════════════════════

  /**
   * 确保所有必要的目录存在
   */
  _ensureDirectories() {
    const memoryDir = getMemoryDir();
    const dirs = [
      memoryDir,
      path.join(memoryDir, 'short-term'),
      path.join(memoryDir, 'long-term'),
      path.join(memoryDir, 'shared'),
      path.join(memoryDir, 'agents'),
      path.join(memoryDir, 'user'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 索引管理
  // ═══════════════════════════════════════════════════════════

  /**
   * 从磁盘加载索引到内存
   */
  _loadIndex() {
    try {
      const indexPath = getIndexPath();
      if (fs.existsSync(indexPath)) {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        if (Array.isArray(data)) {
          for (const entry of data) {
            this.index.set(entry.id, entry);
          }
        }
        logger.info('记忆索引已加载', { count: this.index.size });
      } else {
        logger.info('记忆索引文件不存在，使用空索引');
      }
    } catch (error) {
      logger.error('加载记忆索引失败', error);
      this.index.clear();
    }
  }

  /**
   * 将索引保存到磁盘（防抖）
   */
  _saveIndex() {
    if (this._indexDebounceTimer) {
      clearTimeout(this._indexDebounceTimer);
    }
    this._indexDebounceTimer = setTimeout(() => {
      this._flushIndex();
    }, MEMORY_CONFIG.DEBOUNCE_MS);
  }

  /**
   * 立即将索引写入磁盘
   */
  _flushIndex() {
    try {
      const entries = Array.from(this.index.values());
      fs.writeFileSync(getIndexPath(), JSON.stringify(entries, null, 2), 'utf-8');
      logger.debug('记忆索引已保存', { count: entries.length });
    } catch (error) {
      logger.error('保存记忆索引失败', error);
    } finally {
      this._indexDebounceTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 文件路径解析
  // ═══════════════════════════════════════════════════════════

  /**
   * 根据记忆类型和 agentId 获取存储文件的相对路径
   * @param {string} type - 记忆类型
   * @param {string|null} agentId - Agent ID
   * @returns {string} 相对路径
   */
  _getRelativePath(type, agentId) {
    if (AGENT_TYPES.includes(type) && agentId) {
      return `agents/${agentId}.json`;
    }
    return TYPE_TO_FILE[type] || `long-term/${type}.json`;
  }

  /**
   * 获取绝对文件路径
   * @param {string} relativePath
   * @returns {string}
   */
  _getAbsolutePath(relativePath) {
    return path.join(getMemoryDir(), relativePath);
  }

  // ═══════════════════════════════════════════════════════════
  // 文件读写 (带缓存)
  // ═══════════════════════════════════════════════════════════

  /**
   * 读取指定文件的条目列表（优先使用缓存）
   * @param {string} relativePath
   * @returns {Object[]}
   */
  _readFile(relativePath) {
    // 先检查缓存
    if (this.fileCache.has(relativePath)) {
      return this.fileCache.get(relativePath).entries;
    }

    // 从磁盘加载
    const absPath = this._getAbsolutePath(relativePath);
    let entries = [];

    try {
      if (fs.existsSync(absPath)) {
        const content = fs.readFileSync(absPath, 'utf-8');
        if (content && content.trim()) {
          entries = JSON.parse(content);
          if (!Array.isArray(entries)) {
            entries = [];
          }
        }
      }
    } catch (error) {
      logger.error(`读取记忆文件失败: ${relativePath}`, error);
      entries = [];
    }

    // 放入缓存
    this.fileCache.set(relativePath, { entries, dirty: false });
    return entries;
  }

  /**
   * 标记文件为脏（需要写入磁盘），并触发防抖写入
   * @param {string} relativePath
   */
  _markDirty(relativePath) {
    const cache = this.fileCache.get(relativePath);
    if (cache) {
      cache.dirty = true;
    }

    // 防抖写入
    if (this.debounceTimers.has(relativePath)) {
      clearTimeout(this.debounceTimers.get(relativePath));
    }

    this.debounceTimers.set(relativePath, setTimeout(() => {
      this._flushFile(relativePath);
    }, MEMORY_CONFIG.DEBOUNCE_MS));
  }

  /**
   * 立即将指定文件写入磁盘
   * @param {string} relativePath
   */
  _flushFile(relativePath) {
    const cache = this.fileCache.get(relativePath);
    if (!cache || !cache.dirty) return;

    try {
      const absPath = this._getAbsolutePath(relativePath);

      // 确保目录存在
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(absPath, JSON.stringify(cache.entries, null, 2), 'utf-8');
      cache.dirty = false;
      logger.debug(`记忆文件已保存: ${relativePath}`, { count: cache.entries.length });
    } catch (error) {
      logger.error(`保存记忆文件失败: ${relativePath}`, error);
    } finally {
      this.debounceTimers.delete(relativePath);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CRUD 操作
  // ═══════════════════════════════════════════════════════════

  /**
   * 存储一条记忆
   * @param {Object} memoryEntry - 完整的 MemoryEntry
   * @returns {{ success: boolean, id?: string, error?: string }}
   */
  add(memoryEntry) {
    try {
      const relPath = this._getRelativePath(memoryEntry.type, memoryEntry.agentId);
      const entries = this._readFile(relPath);

      // 检查上限，如果超出则淘汰分数最低的
      if (entries.length >= MEMORY_CONFIG.MAX_ENTRIES_PER_FILE) {
        this._evictLowest(entries, relPath);
      }

      entries.push(memoryEntry);
      this._markDirty(relPath);

      // 更新索引
      const indexEntry = createIndexEntry(memoryEntry);
      this.index.set(memoryEntry.id, indexEntry);
      this._saveIndex();

      logger.debug('记忆已存储', { id: memoryEntry.id, type: memoryEntry.type });
      return { success: true, id: memoryEntry.id };
    } catch (error) {
      logger.error('存储记忆失败', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量存储记忆
   * @param {Object[]} memoryEntries
   * @returns {{ success: boolean, count: number, errors: string[] }}
   */
  addMultiple(memoryEntries) {
    const errors = [];
    let count = 0;

    for (const entry of memoryEntries) {
      const result = this.add(entry);
      if (result.success) {
        count++;
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
    const indexEntry = this.index.get(memoryId);
    if (!indexEntry) return null;

    const relPath = this._getRelativePath(indexEntry.type, indexEntry.agentId);
    const entries = this._readFile(relPath);
    return entries.find((e) => e.id === memoryId) || null;
  }

  /**
   * 更新记忆条目
   * @param {string} memoryId
   * @param {Object} updates - 要更新的字段
   * @returns {{ success: boolean, error?: string }}
   */
  update(memoryId, updates) {
    const indexEntry = this.index.get(memoryId);
    if (!indexEntry) {
      return { success: false, error: `记忆不存在: ${memoryId}` };
    }

    try {
      const relPath = this._getRelativePath(indexEntry.type, indexEntry.agentId);
      const entries = this._readFile(relPath);
      const idx = entries.findIndex((e) => e.id === memoryId);
      if (idx === -1) {
        return { success: false, error: `记忆文件中找不到: ${memoryId}` };
      }

      // 合并更新（不允许修改 id 和 type）
      const { id, type, ...allowedUpdates } = updates;
      Object.assign(entries[idx], allowedUpdates);
      this._markDirty(relPath);

      // 同步更新索引
      const updatedIndexEntry = createIndexEntry(entries[idx]);
      this.index.set(memoryId, updatedIndexEntry);
      this._saveIndex();

      return { success: true };
    } catch (error) {
      logger.error(`更新记忆失败: ${memoryId}`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除一条记忆
   * @param {string} memoryId
   * @returns {{ success: boolean, error?: string }}
   */
  remove(memoryId) {
    const indexEntry = this.index.get(memoryId);
    if (!indexEntry) {
      return { success: false, error: `记忆不存在: ${memoryId}` };
    }

    try {
      const relPath = this._getRelativePath(indexEntry.type, indexEntry.agentId);
      const entries = this._readFile(relPath);
      const idx = entries.findIndex((e) => e.id === memoryId);
      if (idx !== -1) {
        entries.splice(idx, 1);
        this._markDirty(relPath);
      }

      // 删除索引
      this.index.delete(memoryId);
      this._saveIndex();

      logger.debug('记忆已删除', { id: memoryId });
      return { success: true };
    } catch (error) {
      logger.error(`删除记忆失败: ${memoryId}`, error);
      return { success: false, error: error.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 查询操作 (基于内存索引)
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取所有索引条目
   * @param {Object} [filters] - 过滤条件
   * @param {string} [filters.type] - 按类型筛选
   * @param {string} [filters.scope] - 按范围筛选
   * @param {string} [filters.agentId] - 按 Agent 筛选
   * @param {boolean} [filters.includeArchived=false] - 是否包含已归档
   * @returns {Object[]}
   */
  query(filters = {}) {
    const { type, scope, agentId, includeArchived = false } = filters;
    const results = [];

    for (const entry of this.index.values()) {
      // 过滤已归档
      if (!includeArchived && entry.archived) continue;
      // 过滤被替代
      if (entry.supersededBy) continue;

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
    const results = [];

    for (const entry of this.index.values()) {
      if (entry.archived || entry.supersededBy) continue;

      // Agent 可见：自己的 + 共享的 + 用户的
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
   * @param {Object} [filters] - 额外过滤
   * @returns {Object[]}
   */
  searchByTags(tags, filters = {}) {
    if (!tags || tags.length === 0) return this.query(filters);

    const lowerTags = tags.map((t) => t.toLowerCase());
    const candidates = this.query(filters);

    return candidates.filter((entry) => {
      const entryTags = (entry.tags || []).map((t) => t.toLowerCase());
      return lowerTags.some((tag) => entryTags.includes(tag));
    });
  }

  /**
   * 获取最近 N 条记忆索引
   * @param {number} [limit=20]
   * @param {Object} [filters]
   * @returns {Object[]}
   */
  getRecent(limit = 20, filters = {}) {
    const candidates = this.query(filters);
    candidates.sort((a, b) => b.createdAt - a.createdAt);
    return candidates.slice(0, limit);
  }

  // ═══════════════════════════════════════════════════════════
  // 批量操作
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取指定类型的所有完整记忆条目
   * @param {string} type
   * @param {string} [agentId]
   * @returns {Object[]}
   */
  getEntriesByType(type, agentId) {
    const relPath = this._getRelativePath(type, agentId);
    return this._readFile(relPath);
  }

  /**
   * 批量更新索引中的字段（用于衰减等批量操作）
   * @param {Array<{id: string, updates: Object}>} batchUpdates
   */
  batchUpdateIndex(batchUpdates) {
    for (const { id, updates } of batchUpdates) {
      const entry = this.index.get(id);
      if (entry) {
        Object.assign(entry, updates);
      }
    }
    this._saveIndex();
  }

  // ═══════════════════════════════════════════════════════════
  // 淘汰机制
  // ═══════════════════════════════════════════════════════════

  /**
   * 淘汰文件中分数最低的条目
   * @param {Object[]} entries - 文件中的条目列表（会被修改）
   * @param {string} relPath - 相对路径
   */
  _evictLowest(entries, relPath) {
    if (entries.length < MEMORY_CONFIG.MAX_ENTRIES_PER_FILE) return;

    // 按 importance + accessCount 组合分数排序，淘汰最低的 10%
    const evictCount = Math.max(1, Math.floor(entries.length * 0.1));

    entries.sort((a, b) => {
      const scoreA = (a.importance || 0) + Math.log(1 + (a.accessCount || 0)) * 0.1;
      const scoreB = (b.importance || 0) + Math.log(1 + (b.accessCount || 0)) * 0.1;
      return scoreA - scoreB;
    });

    const evicted = entries.splice(0, evictCount);

    // 从索引中也删除
    for (const e of evicted) {
      this.index.delete(e.id);
    }

    logger.info(`记忆淘汰: ${relPath}`, { evicted: evictCount, remaining: entries.length });
  }

  // ═══════════════════════════════════════════════════════════
  // 刷盘与清理
  // ═══════════════════════════════════════════════════════════

  /**
   * 立即将所有脏数据刷入磁盘
   */
  flush() {
    // 清除所有防抖定时器
    for (const [relPath, timer] of this.debounceTimers) {
      clearTimeout(timer);
      this._flushFile(relPath);
    }
    this.debounceTimers.clear();

    // 刷新索引
    if (this._indexDebounceTimer) {
      clearTimeout(this._indexDebounceTimer);
      this._indexDebounceTimer = null;
    }
    this._flushIndex();

    logger.info('记忆存储已全部刷盘');
  }

  /**
   * 清空文件缓存（释放内存，下次读取时会重新从磁盘加载）
   */
  clearCache() {
    this.flush(); // 先刷盘
    this.fileCache.clear();
  }

  /**
   * 重新初始化（切换公司后调用）
   * 刷盘、清空内存状态、重新加载
   */
  reinitialize() {
    this.flush();
    this.index.clear();
    this.fileCache.clear();
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    if (this._indexDebounceTimer) {
      clearTimeout(this._indexDebounceTimer);
      this._indexDebounceTimer = null;
    }
    this._ensureDirectories();
    this._loadIndex();
  }

  /**
   * 获取存储统计信息
   * @returns {Object}
   */
  getStats() {
    const stats = {
      totalMemories: this.index.size,
      byType: {},
      byScope: {},
      archived: 0,
      cachedFiles: this.fileCache.size,
    };

    for (const entry of this.index.values()) {
      // 按类型
      stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
      // 按范围
      stats.byScope[entry.scope] = (stats.byScope[entry.scope] || 0) + 1;
      // 已归档
      if (entry.archived) stats.archived++;
    }

    return stats;
  }
}

// 单例
const memoryStore = new MemoryStore();

module.exports = { MemoryStore, memoryStore };
