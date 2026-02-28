/**
 * SoloForge Mobile - 记忆衰减机制
 * 简化版：衰减计算、归档、强化
 * @module memory/memory-decay
 */

const { logger } = require('../../utils/logger');
const { memoryStore } = require('./memory-store');
const { MEMORY_CONFIG } = require('./memory-types');

class MemoryDecay {
  constructor() {
    this.lambda = MEMORY_CONFIG.DECAY_LAMBDA;
    this.archiveThreshold = MEMORY_CONFIG.ARCHIVE_THRESHOLD;
  }

  calculateEffectiveScore(indexEntry, now = Date.now()) {
    const { importance = 0.5, accessCount = 0, lastAccessedAt } = indexEntry;

    const msPerDay = 24 * 60 * 60 * 1000;
    const daysSinceAccess = lastAccessedAt ? (now - lastAccessedAt) / msPerDay : 30;

    const frequencyFactor = 1 + Math.log(1 + accessCount);
    const decayFactor = Math.exp(-this.lambda * daysSinceAccess);

    return importance * frequencyFactor * decayFactor;
  }

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

  runDecay() {
    const scores = this.calculateAllScores();
    let archivedCount = 0;
    const batchUpdates = [];

    for (const { id, score } of scores) {
      if (score < this.archiveThreshold) {
        batchUpdates.push({ id, updates: { archived: true } });
        archivedCount++;
      }
    }

    if (batchUpdates.length > 0) {
      memoryStore.batchUpdateIndex(batchUpdates);
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

  reinforce(memoryId) {
    const entry = memoryStore.get(memoryId);
    if (!entry) return { success: false };

    const updates = {
      accessCount: (entry.accessCount || 0) + 1,
      lastAccessedAt: Date.now(),
    };

    if (entry.archived) {
      updates.archived = false;
    }

    return memoryStore.update(memoryId, updates);
  }

  batchReinforce(memoryIds) {
    const now = Date.now();
    const batchUpdates = [];

    for (const id of memoryIds) {
      const indexEntry = memoryStore.index && memoryStore.index.get ? memoryStore.index.get(id) : null;
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

const memoryDecay = new MemoryDecay();

module.exports = { MemoryDecay, memoryDecay };
