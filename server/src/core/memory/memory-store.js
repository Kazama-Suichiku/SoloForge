/**
 * SoloForge Mobile - 记忆存储层
 * JSON 文件读写、索引管理、防抖写入
 * 无 Electron 依赖，使用 Node.js fs + path
 * @module memory/memory-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const {
  MEMORY_CONFIG,
  MEMORY_TYPES,
  TYPE_TO_FILE,
  AGENT_TYPES,
  createIndexEntry,
} = require('./memory-types');

function getMemoryDir() {
  return path.join(__dirname, '../../../data', 'memory');
}

function getIndexPath() {
  return path.join(getMemoryDir(), MEMORY_CONFIG.INDEX_FILE);
}

class MemoryStore {
  constructor() {
    this.index = new Map();
    this.fileCache = new Map();
    this.debounceTimers = new Map();
    this._indexDebounceTimer = null;

    this._ensureDirectories();
    this._loadIndex();
  }

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

  _saveIndex() {
    if (this._indexDebounceTimer) clearTimeout(this._indexDebounceTimer);
    this._indexDebounceTimer = setTimeout(() => {
      try {
        const entries = Array.from(this.index.values());
        fs.writeFileSync(getIndexPath(), JSON.stringify(entries, null, 2), 'utf-8');
        logger.debug('记忆索引已保存', { count: entries.length });
      } catch (error) {
        logger.error('保存记忆索引失败', error);
      }
      this._indexDebounceTimer = null;
    }, MEMORY_CONFIG.DEBOUNCE_MS);
  }

  _getRelativePath(type, agentId) {
    if (AGENT_TYPES.includes(type) && agentId) {
      return `agents/${agentId}.json`;
    }
    return TYPE_TO_FILE[type] || `long-term/${type}.json`;
  }

  _getAbsolutePath(relativePath) {
    return path.join(getMemoryDir(), relativePath);
  }

  _readFile(relativePath) {
    if (this.fileCache.has(relativePath)) {
      return this.fileCache.get(relativePath).entries;
    }

    const absPath = this._getAbsolutePath(relativePath);
    let entries = [];

    try {
      if (fs.existsSync(absPath)) {
        const content = fs.readFileSync(absPath, 'utf-8');
        if (content && content.trim()) {
          entries = JSON.parse(content);
          if (!Array.isArray(entries)) entries = [];
        }
      }
    } catch (error) {
      logger.error(`读取记忆文件失败: ${relativePath}`, error);
      entries = [];
    }

    this.fileCache.set(relativePath, { entries, dirty: false });
    return entries;
  }

  _markDirty(relativePath) {
    const cache = this.fileCache.get(relativePath);
    if (cache) cache.dirty = true;

    if (this.debounceTimers.has(relativePath)) {
      clearTimeout(this.debounceTimers.get(relativePath));
    }

    this.debounceTimers.set(relativePath, setTimeout(() => {
      this._flushFile(relativePath);
    }, MEMORY_CONFIG.DEBOUNCE_MS));
  }

  _flushFile(relativePath) {
    const cache = this.fileCache.get(relativePath);
    if (!cache || !cache.dirty) return;

    try {
      const absPath = this._getAbsolutePath(relativePath);
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

  add(memoryEntry) {
    try {
      const relPath = this._getRelativePath(memoryEntry.type, memoryEntry.agentId);
      const entries = this._readFile(relPath);

      if (entries.length >= MEMORY_CONFIG.MAX_ENTRIES_PER_FILE) {
        this._evictLowest(entries, relPath);
      }

      entries.push(memoryEntry);
      this._markDirty(relPath);

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

  addMultiple(memoryEntries) {
    const errors = [];
    let count = 0;
    for (const entry of memoryEntries) {
      const result = this.add(entry);
      if (result.success) count++;
      else errors.push(`${entry.id || 'unknown'}: ${result.error}`);
    }
    return { success: errors.length === 0, count, errors };
  }

  get(memoryId) {
    const indexEntry = this.index.get(memoryId);
    if (!indexEntry) return null;

    const relPath = this._getRelativePath(indexEntry.type, indexEntry.agentId);
    const entries = this._readFile(relPath);
    return entries.find((e) => e.id === memoryId) || null;
  }

  update(memoryId, updates) {
    const indexEntry = this.index.get(memoryId);
    if (!indexEntry) return { success: false, error: `记忆不存在: ${memoryId}` };

    try {
      const relPath = this._getRelativePath(indexEntry.type, indexEntry.agentId);
      const entries = this._readFile(relPath);
      const idx = entries.findIndex((e) => e.id === memoryId);
      if (idx === -1) return { success: false, error: `记忆文件中找不到: ${memoryId}` };

      const { id, type, ...allowedUpdates } = updates;
      Object.assign(entries[idx], allowedUpdates);
      this._markDirty(relPath);

      const updatedIndexEntry = createIndexEntry(entries[idx]);
      this.index.set(memoryId, updatedIndexEntry);
      this._saveIndex();

      return { success: true };
    } catch (error) {
      logger.error(`更新记忆失败: ${memoryId}`, error);
      return { success: false, error: error.message };
    }
  }

  remove(memoryId) {
    const indexEntry = this.index.get(memoryId);
    if (!indexEntry) return { success: false, error: `记忆不存在: ${memoryId}` };

    try {
      const relPath = this._getRelativePath(indexEntry.type, indexEntry.agentId);
      const entries = this._readFile(relPath);
      const idx = entries.findIndex((e) => e.id === memoryId);
      if (idx !== -1) {
        entries.splice(idx, 1);
        this._markDirty(relPath);
      }

      this.index.delete(memoryId);
      this._saveIndex();

      logger.debug('记忆已删除', { id: memoryId });
      return { success: true };
    } catch (error) {
      logger.error(`删除记忆失败: ${memoryId}`, error);
      return { success: false, error: error.message };
    }
  }

  query(filters = {}) {
    const { type, scope, agentId, includeArchived = false } = filters;
    const results = [];

    for (const entry of this.index.values()) {
      if (!includeArchived && entry.archived) continue;
      if (entry.supersededBy) continue;
      if (type && entry.type !== type) continue;
      if (scope && entry.scope !== scope) continue;
      if (agentId && entry.agentId !== agentId) continue;

      results.push(entry);
    }

    return results;
  }

  queryForAgent(agentId) {
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

  searchByTags(tags, filters = {}) {
    if (!tags || tags.length === 0) return this.query(filters);

    const lowerTags = tags.map((t) => t.toLowerCase());
    const candidates = this.query(filters);

    return candidates.filter((entry) => {
      const entryTags = (entry.tags || []).map((t) => t.toLowerCase());
      return lowerTags.some((tag) => entryTags.includes(tag));
    });
  }

  getRecent(limit = 20, filters = {}) {
    const candidates = this.query(filters);
    candidates.sort((a, b) => b.createdAt - a.createdAt);
    return candidates.slice(0, limit);
  }

  getEntriesByType(type, agentId) {
    const relPath = this._getRelativePath(type, agentId);
    return this._readFile(relPath);
  }

  batchUpdateIndex(batchUpdates) {
    for (const { id, updates } of batchUpdates) {
      const entry = this.index.get(id);
      if (entry) Object.assign(entry, updates);
    }
    this._saveIndex();
  }

  _evictLowest(entries, relPath) {
    if (entries.length < MEMORY_CONFIG.MAX_ENTRIES_PER_FILE) return;

    const evictCount = Math.max(1, Math.floor(entries.length * 0.1));

    entries.sort((a, b) => {
      const scoreA = (a.importance || 0) + Math.log(1 + (a.accessCount || 0)) * 0.1;
      const scoreB = (b.importance || 0) + Math.log(1 + (b.accessCount || 0)) * 0.1;
      return scoreA - scoreB;
    });

    const evicted = entries.splice(0, evictCount);
    for (const e of evicted) {
      this.index.delete(e.id);
    }

    logger.info(`记忆淘汰: ${relPath}`, { evicted: evictCount, remaining: entries.length });
  }

  flush() {
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    for (const [relPath] of this.debounceTimers) {
      this._flushFile(relPath);
    }
    this.debounceTimers.clear();

    if (this._indexDebounceTimer) {
      clearTimeout(this._indexDebounceTimer);
      this._indexDebounceTimer = null;
    }

    try {
      const entries = Array.from(this.index.values());
      fs.writeFileSync(getIndexPath(), JSON.stringify(entries, null, 2), 'utf-8');
    } catch (error) {
      logger.error('保存记忆索引失败', error);
    }

    logger.info('记忆存储已全部刷盘');
  }

  getStats() {
    const stats = {
      totalMemories: this.index.size,
      byType: {},
      byScope: {},
      archived: 0,
      cachedFiles: this.fileCache.size,
    };

    for (const entry of this.index.values()) {
      stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
      stats.byScope[entry.scope] = (stats.byScope[entry.scope] || 0) + 1;
      if (entry.archived) stats.archived++;
    }

    return stats;
  }
}

const memoryStore = new MemoryStore();

module.exports = { MemoryStore, memoryStore };
