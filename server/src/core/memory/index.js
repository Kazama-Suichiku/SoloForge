/**
 * SoloForge Mobile - 记忆系统模块导出
 * @module memory
 */

const { memoryManager, MemoryManager } = require('./memory-manager');
const { memoryStore, MemoryStore } = require('./memory-store');
const {
  MEMORY_TYPES,
  MEMORY_SCOPE,
  MEMORY_SOURCE,
  MEMORY_CONFIG,
  MEMORY_TYPE_LABELS,
  MEMORY_TYPE_DEFAULTS,
  createMemoryEntry,
  createIndexEntry,
  validateMemoryEntry,
  generateMemoryId,
} = require('./memory-types');

module.exports = {
  memoryManager,
  memoryStore,
  MemoryManager,
  MemoryStore,
  MEMORY_TYPES,
  MEMORY_SCOPE,
  MEMORY_SOURCE,
  MEMORY_CONFIG,
  MEMORY_TYPE_DEFAULTS,
  MEMORY_TYPE_LABELS,
  createMemoryEntry,
  createIndexEntry,
  validateMemoryEntry,
  generateMemoryId,
};
