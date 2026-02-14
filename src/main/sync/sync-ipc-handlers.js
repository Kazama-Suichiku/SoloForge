/**
 * 同步相关 IPC 处理器
 */

const { ipcMain } = require('electron');
const { supabaseClient } = require('./supabase-client');
const { authManager } = require('./auth-manager');
const { syncManager } = require('./sync-manager');
const { logger } = require('../utils/logger');

function setupSyncIpcHandlers() {
  // 初始化 Supabase
  ipcMain.handle('sync:init', async (event, { supabaseUrl, supabaseKey }) => {
    try {
      supabaseClient.initialize(supabaseUrl, supabaseKey);
      return { success: true };
    } catch (error) {
      logger.error('初始化 Supabase 失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 注册
  ipcMain.handle('sync:register', async (event, { email, password }) => {
    return await authManager.register(email, password);
  });

  // 登录
  ipcMain.handle('sync:login', async (event, { email, password }) => {
    const result = await authManager.login(email, password);
    if (result.success) {
      // 登录成功后自动拉取云端数据
      await syncManager.pull();
      // 启动自动同步
      syncManager.startAutoSync();
    }
    return result;
  });

  // 登出
  ipcMain.handle('sync:logout', async () => {
    syncManager.stopAutoSync();
    return await authManager.logout();
  });

  // 恢复会话
  ipcMain.handle('sync:restore-session', async () => {
    const result = await authManager.restoreSession();
    if (result.success) {
      syncManager.startAutoSync();
    }
    return result;
  });

  // 获取当前用户
  ipcMain.handle('sync:get-user', async () => {
    const user = authManager.getCurrentUser();
    return { success: !!user, user };
  });

  // 手动同步
  ipcMain.handle('sync:manual-sync', async () => {
    return await syncManager.sync();
  });

  // 拉取云端数据
  ipcMain.handle('sync:pull', async () => {
    return await syncManager.pull();
  });

  // 推送本地数据
  ipcMain.handle('sync:push', async () => {
    return await syncManager.push();
  });

  // 获取同步状态
  ipcMain.handle('sync:get-status', async () => {
    return syncManager.getStatus();
  });

  // 设置自动同步
  ipcMain.handle('sync:set-auto-sync', async (event, enabled) => {
    syncManager.setAutoSync(enabled);
    return { success: true };
  });

  logger.info('同步 IPC 处理器已注册');
}

module.exports = { setupSyncIpcHandlers };
