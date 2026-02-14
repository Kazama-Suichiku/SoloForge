/**
 * SoloForge - 记忆衰减机制
 * 实现记忆的自然衰减、强化和淘汰
 * @module memory/memory-decay
 */

const { logger } = require('../utils/logger');
const { memoryStore } = require('./memory-store');
const { MEMORY_CONFIG } = require('./memory-types');

/**
 * 记忆衰减管理器
 */
class MemoryDecay {
  constructor() {
    // 衰减系数
    this.lambda = MEMORY_CONFIG.DECAY_LAMBDA;
    // 归档阈值
    this.archiveThreshold = MEMORY_CONFIG.ARCHIVE_THRESHOLD;
  }

  // ═══════════════════════════════════════════════════════════
  // 衰减计算
  // ═══════════════════════════════════════════════════════════

  /**
   * 计算记忆的有效分数
   * 公式: importance * (1 + log(1 + accessCount)) * e^(-lambda * daysSinceLastAccess)
   *
   * @param {Object} indexEntry - 索引条目
   * @param {number} [now] - 当前时间戳
   * @returns {number} 有效分数 (0-∞, 实际上大多在 0-2 范围)
   */
  calculateEffectiveScore(indexEntry, now = Date.now()) {
    const { importance = 0.5, accessCount = 0, lastAccessedAt } = indexEntry;

    // 天数差
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysSinceAccess = lastAccessedAt ? (now - lastAccessedAt) / msPerDay : 30; // 无访问记录默认 30 天

    // 对数增长的频率因子
    const frequencyFactor = 1 + Math.log(1 + accessCount);

    // 指数衰减
    const decayFactor = Math.exp(-this.lambda * daysSinceAccess);

    return importance * frequencyFactor * decayFactor;
  }

  /**
   * 批量计算所有记忆的有效分数
   * @returns {Array<{id: string, score: number}>}
   */
  calculateAllScores() {
    const now = Date.now();
    const results = [];

    const allEntries = memoryStore.query({ includeArchived: false });
    for (const entry of allEntries) {
      const score = this.calculateEffectiveScore(entry, now);
      results.push({ id: entry.id, score });
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════
  // 衰减执行
  // ═══════════════════════════════════════════════════════════

  /**
   * 运行一次衰减扫描
   * 将有效分数低于阈值的记忆标记为 archived
   * @returns {{ scanned: number, archived: number }}
   */
  runDecay() {
    const scores = this.calculateAllScores();
    let archivedCount = 0;

    const batchUpdates = [];

    for (const { id, score } of scores) {
      if (score < this.archiveThreshold) {
        batchUpdates.push({
          id,
          updates: { archived: true },
        });
        archivedCount++;
      }
    }

    if (batchUpdates.length > 0) {
      memoryStore.batchUpdateIndex(batchUpdates);

      // 同步更新文件中的条目
      for (const { id } of batchUpdates) {
        memoryStore.update(id, { archived: true });
      }
    }

    logger.info('记忆衰减扫描完成', {
      scanned: scores.length,
      archived: archivedCount,
      threshold: this.archiveThreshold,
    });

    return { scanned: scores.length, archived: archivedCount };
  }

  // ═══════════════════════════════════════════════════════════
  // 强化机制
  // ═══════════════════════════════════════════════════════════

  /**
   * 强化记忆：增加访问计数和更新访问时间
   * 在记忆被检索并注入上下文时调用
   * @param {string} memoryId
   * @returns {{ success: boolean }}
   */
  reinforce(memoryId) {
    const entry = memoryStore.get(memoryId);
    if (!entry) {
      return { success: false };
    }

    const updates = {
      accessCount: (entry.accessCount || 0) + 1,
      lastAccessedAt: Date.now(),
    };

    // 如果记忆之前被归档，取消归档
    if (entry.archived) {
      updates.archived = false;
    }

    return memoryStore.update(memoryId, updates);
  }

  /**
   * 显式提升记忆重要性
   * 例如用户手动标记重要，或 Agent 引用做决策
   * @param {string} memoryId
   * @param {number} [boost=0.1] - 提升量
   * @returns {{ success: boolean }}
   */
  boostImportance(memoryId, boost = 0.1) {
    const entry = memoryStore.get(memoryId);
    if (!entry) {
      return { success: false };
    }

    const newImportance = Math.min(1.0, (entry.importance || 0.5) + boost);
    return memoryStore.update(memoryId, {
      importance: newImportance,
      lastAccessedAt: Date.now(),
    });
  }

  /**
   * 标记记忆为用户确认重要
   * @param {string} memoryId
   * @returns {{ success: boolean }}
   */
  markImportant(memoryId) {
    return memoryStore.update(memoryId, {
      importance: 0.95,
      lastAccessedAt: Date.now(),
      archived: false,
    });
  }

  /**
   * 批量强化记忆（检索器检索到的记忆批量更新访问记录）
   * @param {string[]} memoryIds
   */
  batchReinforce(memoryIds) {
    const now = Date.now();
    const batchUpdates = [];

    for (const id of memoryIds) {
      const indexEntry = memoryStore.index.get(id);
      if (indexEntry) {
        batchUpdates.push({
          id,
          updates: {
            accessCount: (indexEntry.accessCount || 0) + 1,
            lastAccessedAt: now,
          },
        });
      }
    }

    if (batchUpdates.length > 0) {
      memoryStore.batchUpdateIndex(batchUpdates);
    }
  }
}

// 单例
const memoryDecay = new MemoryDecay();

module.exports = { MemoryDecay, memoryDecay };
