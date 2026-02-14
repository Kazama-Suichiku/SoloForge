/**
 * SoloForge - 记忆系统 IPC 处理器
 * 处理渲染进程对记忆系统的查询请求
 * @module memory/memory-ipc-handlers
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger');
const {
  MEMORY_GET_STATS,
  MEMORY_SEARCH,
  MEMORY_GET_PROFILE,
  MEMORY_GET_SHARED,
  MEMORY_GET_RECENT,
} = require('../../shared/ipc-channels');

/**
 * 注册记忆系统的 IPC 处理器
 * @param {import('./memory-manager').MemoryManager} memoryManager
 */
function registerMemoryIPCHandlers(memoryManager) {
  // 获取记忆系统统计信息
  ipcMain.handle(MEMORY_GET_STATS, async () => {
    try {
      return { success: true, data: memoryManager.getStats() };
    } catch (error) {
      logger.error('IPC memory:get-stats 失败', error);
      return { success: false, error: error.message };
    }
  });

  // 搜索记忆
  ipcMain.handle(MEMORY_SEARCH, async (_event, params) => {
    try {
      const { query, tags, type, agentId, limit = 20 } = params || {};

      let results;
      if (query) {
        results = memoryManager.recall(query, { agentId, limit, type });
      } else {
        const tagArray = tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim())) : undefined;
        results = memoryManager.search({ tags: tagArray, type, agentId, limit });
      }

      return { success: true, data: results };
    } catch (error) {
      logger.error('IPC memory:search 失败', error);
      return { success: false, error: error.message };
    }
  });

  // 获取用户画像
  ipcMain.handle(MEMORY_GET_PROFILE, async () => {
    try {
      const profile = memoryManager.getUserProfile();
      const preferences = memoryManager.search({ type: 'preference', limit: 30 });
      return { success: true, data: { profile, preferences } };
    } catch (error) {
      logger.error('IPC memory:get-profile 失败', error);
      return { success: false, error: error.message };
    }
  });

  // 获取共享知识
  ipcMain.handle(MEMORY_GET_SHARED, async (_event, params) => {
    try {
      const { tags } = params || {};
      const tagArray = tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim())) : undefined;
      const results = memoryManager.getSharedKnowledge(tagArray);
      return { success: true, data: results };
    } catch (error) {
      logger.error('IPC memory:get-shared 失败', error);
      return { success: false, error: error.message };
    }
  });

  // 获取最近记忆
  ipcMain.handle(MEMORY_GET_RECENT, async (_event, params) => {
    try {
      const { limit = 20, type } = params || {};
      const results = memoryManager.getRecent(limit, type);
      return { success: true, data: results };
    } catch (error) {
      logger.error('IPC memory:get-recent 失败', error);
      return { success: false, error: error.message };
    }
  });

  logger.info('记忆系统 IPC 处理器已注册');
}

module.exports = { registerMemoryIPCHandlers };
