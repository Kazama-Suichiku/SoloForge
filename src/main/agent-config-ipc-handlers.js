/**
 * SoloForge - Agent 配置 IPC 处理器
 * 处理渲染进程的 Agent 配置请求
 * @module agent-config-ipc-handlers
 */

const { ipcMain, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  agentConfigStore,
  LEVELS,
  DEPARTMENTS,
  departmentStore,
  AVAILABLE_MODELS,
} = require('./config/agent-config-store');
const { logger } = require('./utils/logger');
const { dataPath } = require('./account/data-path');
const CHANNELS = require('../shared/ipc-channels');
const { safeHandler } = require('./utils/safe-handler');

/**
 * 设置 Agent 配置相关的 IPC 处理器
 */
function setupAgentConfigIpcHandlers() {
  // 订阅配置变更，推送到所有渲染进程
  agentConfigStore.subscribe((configs) => {
    logger.info('Agent 配置变更，通知前端', { count: configs.length });
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window.webContents) {
        window.webContents.send(CHANNELS.AGENT_CONFIG_CHANGED, configs);
      }
    }
  });
  // 获取所有 Agent 配置
  ipcMain.handle(
    'agent-config:get-all',
    safeHandler(async () => {
      const all = agentConfigStore.getAll();
      logger.info('IPC: agent-config:get-all', { count: all.length, isArray: Array.isArray(all), ids: all.map(a => a.id) });
      return all;
    }, { channel: 'agent-config:get-all' })
  );

  // 获取单个 Agent 配置
  ipcMain.handle(
    'agent-config:get',
    safeHandler(async (_event, agentId) => {
      logger.info('IPC: agent-config:get', { agentId });
      return agentConfigStore.get(agentId);
    }, { channel: 'agent-config:get' })
  );

  // 更新 Agent 配置
  ipcMain.handle(
    'agent-config:update',
    safeHandler(async (_event, { agentId, updates }) => {
      logger.info('IPC: agent-config:update', { agentId, updates });
      const result = agentConfigStore.update(agentId, updates);
      return { success: !!result, config: result };
    }, { channel: 'agent-config:update' })
  );

  // 重置 Agent 配置为默认
  ipcMain.handle(
    'agent-config:reset',
    safeHandler(async (_event, agentId) => {
      logger.info('IPC: agent-config:reset', { agentId });
      const result = agentConfigStore.reset(agentId);
      return { success: !!result, config: result };
    }, { channel: 'agent-config:reset' })
  );

  // 获取职级列表
  ipcMain.handle(
    'agent-config:get-levels',
    safeHandler(async () => {
      return Object.values(LEVELS);
    }, { channel: 'agent-config:get-levels' })
  );

  // 获取部门列表（包括自定义部门）
  ipcMain.handle(
    'agent-config:get-departments',
    safeHandler(async () => {
      // 返回所有部门（预设 + 自定义）
      return departmentStore.getAll();
    }, { channel: 'agent-config:get-departments' })
  );

  // 获取可用模型列表
  ipcMain.handle(
    'agent-config:get-models',
    safeHandler(async () => {
      return AVAILABLE_MODELS;
    }, { channel: 'agent-config:get-models' })
  );

  // 获取老板配置
  ipcMain.handle(
    'boss-config:get',
    safeHandler(async () => {
      return agentConfigStore.getBossConfig();
    }, { channel: 'boss-config:get' })
  );

  // 更新老板配置
  ipcMain.handle(
    'boss-config:update',
    safeHandler(async (_event, updates) => {
      logger.info('IPC: boss-config:update', updates);
      const result = agentConfigStore.updateBossConfig(updates);
      // 通知前端
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.webContents) {
          window.webContents.send('boss-config:changed', result);
        }
      }
      return result;
    }, { channel: 'boss-config:update' })
  );

  // 上传 Agent 头像图片
  ipcMain.handle(
    'agent-config:upload-avatar',
    safeHandler(async (_event, agentId) => {
      const result = await dialog.showOpenDialog({
        title: '选择头像图片',
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || !result.filePaths.length) {
        return { success: false, canceled: true };
      }

      const sourcePath = result.filePaths[0];
      const ext = path.extname(sourcePath).toLowerCase();
      const basePath = dataPath.getBasePath();
      const avatarsDir = path.join(basePath, 'avatars');

      // 确保 avatars 目录存在
      if (!fs.existsSync(avatarsDir)) {
        fs.mkdirSync(avatarsDir, { recursive: true });
      }

      // 生成文件名：{agentId}-{timestamp}{ext}
      const filename = `${agentId}-${Date.now()}${ext}`;
      const destPath = path.join(avatarsDir, filename);

      // 复制文件
      fs.copyFileSync(sourcePath, destPath);

      logger.info('Agent 头像已上传', { agentId, destPath });

      return { success: true, avatarPath: destPath };
    }, { channel: 'agent-config:upload-avatar' })
  );
}

module.exports = { setupAgentConfigIpcHandlers };
