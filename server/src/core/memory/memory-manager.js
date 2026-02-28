/**
 * SoloForge Mobile - 记忆系统管理器
 * 简化版：存储、检索、衰减，无 LLM/Electron 依赖
 * @module memory/memory-manager
 */

const { logger } = require('../../utils/logger');
const { memoryStore } = require('./memory-store');
const { memoryRetriever } = require('./memory-retriever');
const { memoryDecay } = require('./memory-decay');
const {
  MEMORY_CONFIG,
  MEMORY_TYPES,
  createMemoryEntry,
  validateMemoryEntry,
} = require('./memory-types');

class MemoryManager {
  constructor() {
    this.retriever = memoryRetriever;
    this.decay = memoryDecay;
  }

  store(params) {
    try {
      const entry = createMemoryEntry(params);
      const validation = validateMemoryEntry(entry);
      if (!validation.valid) {
        return { success: false, error: `验证失败: ${validation.errors.join(', ')}` };
      }
      return memoryStore.add(entry);
    } catch (error) {
      logger.error('存储记忆失败', error);
      return { success: false, error: error.message };
    }
  }

  storeMultiple(paramsList) {
    const entries = [];
    const errors = [];

    for (const params of paramsList) {
      try {
        const entry = createMemoryEntry(params);
        const validation = validateMemoryEntry(entry);
        if (validation.valid) {
          entries.push(entry);
        } else {
          errors.push(`验证失败: ${validation.errors.join(', ')}`);
        }
      } catch (error) {
        errors.push(error.message);
      }
    }

    if (entries.length > 0) {
      const result = memoryStore.addMultiple(entries);
      return {
        success: result.success && errors.length === 0,
        count: result.count,
        errors: [...errors, ...result.errors],
      };
    }

    return { success: false, count: 0, errors };
  }

  recall(query, options = {}) {
    return this.retriever.recall(query, options);
  }

  getContextForAgent(agentId, message) {
    return this.retriever.getContextForAgent(agentId, message);
  }

  getSharedKnowledge(tags) {
    if (tags && tags.length > 0) {
      return memoryStore.searchByTags(tags, { scope: 'shared' });
    }
    return memoryStore.query({ scope: 'shared' });
  }

  getUserProfile() {
    return memoryStore.query({ type: MEMORY_TYPES.USER_PROFILE });
  }

  search(params = {}) {
    const { tags, type, agentId, limit = 20 } = params;

    let results;
    if (tags && tags.length > 0) {
      results = memoryStore.searchByTags(tags, { type, agentId });
    } else {
      results = memoryStore.query({ type, agentId });
    }

    results.sort((a, b) => (b.importance || 0) - (a.importance || 0));
    return results.slice(0, limit);
  }

  getRecent(limit = 20, type) {
    return memoryStore.getRecent(limit, type ? { type } : {});
  }

  forget(memoryId) {
    return memoryStore.remove(memoryId);
  }

  reinforce(memoryId) {
    return this.decay.reinforce(memoryId);
  }

  runMaintenance() {
    logger.info('开始记忆系统维护...');
    const startTime = Date.now();

    try {
      const decayResult = this.decay.runDecay();
      logger.info('记忆衰减完成', decayResult);
      const elapsed = Date.now() - startTime;
      logger.info('记忆系统维护完成', { elapsedMs: elapsed });
      return { decay: decayResult, elapsedMs: elapsed };
    } catch (error) {
      logger.error('记忆系统维护出错', error);
      throw error;
    }
  }

  getStats() {
    return memoryStore.getStats();
  }

  flush() {
    memoryStore.flush();
    logger.info('记忆系统已刷盘');
  }
}

const memoryManager = new MemoryManager();

module.exports = { MemoryManager, memoryManager };
