/**
 * 同步管理器 - 核心同步逻辑
 */

const { supabaseClient } = require('./supabase-client');
const { authManager } = require('./auth-manager');
const { logger } = require('../utils/logger');
const EventEmitter = require('events');

class SyncManager extends EventEmitter {
  constructor() {
    super();
    this.syncing = false;
    this.lastSyncTime = null;
    this.autoSyncEnabled = true;
    this.autoSyncInterval = null;
    this.adapters = new Map();
  }

  /**
   * 注册数据适配器
   */
  registerAdapter(name, adapter) {
    this.adapters.set(name, adapter);
    logger.info(`数据适配器已注册: ${name}`);
  }

  /**
   * 启动自动同步
   */
  startAutoSync(intervalMs = 5 * 60 * 1000) {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
    }

    this.autoSyncInterval = setInterval(async () => {
      if (this.autoSyncEnabled && authManager.isLoggedIn()) {
        await this.sync();
      }
    }, intervalMs);

    logger.info(`自动同步已启动，间隔: ${intervalMs}ms`);
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
      logger.info('自动同步已停止');
    }
  }

  /**
   * 执行同步
   */
  async sync() {
    if (this.syncing) {
      logger.warn('同步正在进行中，跳过');
      return { success: false, error: '同步正在进行中' };
    }

    if (!authManager.isLoggedIn()) {
      return { success: false, error: '用户未登录' };
    }

    this.syncing = true;
    this.emit('sync:start');

    try {
      const results = {};

      // 依次同步各个数据源
      for (const [name, adapter] of this.adapters) {
        try {
          logger.info(`开始同步: ${name}`);
          const result = await this.syncAdapter(adapter);
          results[name] = result;
          logger.info(`同步完成: ${name}`, result);
        } catch (error) {
          logger.error(`同步失败: ${name}`, error);
          results[name] = { success: false, error: error.message };
        }
      }

      this.lastSyncTime = new Date();
      this.emit('sync:complete', results);

      return { success: true, results, timestamp: this.lastSyncTime };
    } catch (error) {
      logger.error('同步失败:', error);
      this.emit('sync:error', error);
      return { success: false, error: error.message };
    } finally {
      this.syncing = false;
    }
  }

  /**
   * 同步单个适配器
   */
  async syncAdapter(adapter) {
    // 1. 拉取云端数据
    const cloudData = await adapter.pull();

    // 2. 获取本地数据
    const localData = await adapter.getLocal();

    // 3. 检测冲突
    const conflicts = adapter.detectConflicts(localData, cloudData);

    if (conflicts.length > 0) {
      // 有冲突，触发冲突解决
      this.emit('sync:conflict', { adapter: adapter.name, conflicts });
      return { success: false, conflicts };
    }

    // 4. 合并数据
    const merged = adapter.merge(localData, cloudData);

    // 5. 推送到云端
    await adapter.push(merged);

    // 6. 更新本地
    await adapter.updateLocal(merged);

    return { success: true, merged };
  }

  /**
   * 拉取云端数据
   */
  async pull() {
    if (!authManager.isLoggedIn()) {
      return { success: false, error: '用户未登录' };
    }

    try {
      const results = {};

      for (const [name, adapter] of this.adapters) {
        const data = await adapter.pull();
        await adapter.updateLocal(data);
        results[name] = { success: true, count: data.length };
      }

      logger.info('拉取云端数据成功', results);
      return { success: true, results };
    } catch (error) {
      logger.error('拉取云端数据失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 推送本地数据
   */
  async push() {
    if (!authManager.isLoggedIn()) {
      return { success: false, error: '用户未登录' };
    }

    try {
      const results = {};

      for (const [name, adapter] of this.adapters) {
        const localData = await adapter.getLocal();
        await adapter.push(localData);
        results[name] = { success: true, count: localData.length };
      }

      logger.info('推送本地数据成功', results);
      return { success: true, results };
    } catch (error) {
      logger.error('推送本地数据失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取同步状态
   */
  getStatus() {
    return {
      syncing: this.syncing,
      lastSyncTime: this.lastSyncTime,
      autoSyncEnabled: this.autoSyncEnabled,
      isLoggedIn: authManager.isLoggedIn(),
      user: authManager.getCurrentUser()
    };
  }

  /**
   * 设置自动同步开关
   */
  setAutoSync(enabled) {
    this.autoSyncEnabled = enabled;
    logger.info(`自动同步已${enabled ? '启用' : '禁用'}`);
  }
}

const syncManager = new SyncManager();

module.exports = { syncManager };
