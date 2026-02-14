/**
 * SoloForge - 记忆系统模块导出
 * @module memory
 */

const { memoryManager, MemoryManager } = require('./memory-manager');
const { memoryStore, MemoryStore } = require('./memory-store');
const {
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
} = require('./memory-types');

module.exports = {
  // 单例
  memoryManager,
  memoryStore,

  // 类（用于测试等场景）
  MemoryManager,
  MemoryStore,

  // 类型和常量
  MEMORY_TYPES,
  MEMORY_SCOPE,
  MEMORY_SOURCE,
  MEMORY_CONFIG,
  MEMORY_TYPE_DEFAULTS,
  MEMORY_TYPE_LABELS,

  // 工厂函数
  createMemoryEntry,
  createIndexEntry,
  validateMemoryEntry,
  generateMemoryId,
};
