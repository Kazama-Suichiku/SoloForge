/**
 * SoloForge - 权限配置 IPC 处理器
 * 处理渲染进程的权限配置请求
 * @module permissions-ipc-handlers
 */

const { ipcMain, dialog } = require('electron');
const { permissionStore } = require('./config/permission-store');
const { logger } = require('./utils/logger');

/**
 * 设置权限相关的 IPC 处理器
 * @param {Electron.WebContents} webContents
 */
function setupPermissionsIpcHandlers(webContents) {
  // 获取当前权限配置
  ipcMain.handle('permissions:get', async () => {
    logger.debug('IPC: permissions:get');
    return permissionStore.get();
  });

  // 更新权限配置
  ipcMain.handle('permissions:update', async (_event, permissions) => {
    logger.info('IPC: permissions:update', permissions);
    const success = permissionStore.update(permissions);
    return { success, permissions: permissionStore.get() };
  });

  // 重置权限配置
  ipcMain.handle('permissions:reset', async () => {
    logger.info('IPC: permissions:reset');
    const permissions = permissionStore.reset();
    return { success: true, permissions };
  });

  // 工具确认响应处理
  ipcMain.on('tool:confirm-response', (_event, { requestId, confirmed }) => {
    logger.info('IPC: tool:confirm-response', { requestId, confirmed });
    // 触发确认回调（由 ToolExecutor 监听）
    ipcMain.emit(`tool:confirm:${requestId}`, confirmed);
  });

  // 选择文件夹对话框
  ipcMain.handle('dialog:select-folder', async (_event, options = {}) => {
    logger.info('IPC: dialog:select-folder', options);
    const result = await dialog.showOpenDialog({
      title: options.title || '选择文件夹',
      defaultPath: options.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: options.buttonLabel || '选择',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    return { canceled: false, path: result.filePaths[0] };
  });
}

/**
 * 请求用户确认工具执行
 * @param {Electron.WebContents} webContents
 * @param {Object} request - 确认请求
 * @returns {Promise<boolean>}
 */
function requestToolConfirmation(webContents, request) {
  return new Promise((resolve) => {
    const requestId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 监听响应
    const handler = (confirmed) => {
      resolve(confirmed);
    };
    ipcMain.once(`tool:confirm:${requestId}`, handler);

    // 发送确认请求到渲染进程
    webContents.send('tool:confirm-request', {
      requestId,
      ...request,
    });

    // 超时处理（2分钟）
    setTimeout(() => {
      ipcMain.removeListener(`tool:confirm:${requestId}`, handler);
      resolve(false);
    }, 120000);
  });
}

module.exports = {
  setupPermissionsIpcHandlers,
  requestToolConfirmation,
};
