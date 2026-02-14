/**
 * SoloForge - PM IPC 处理器
 * 为前端提供项目管理数据的 IPC 接口
 * @module pm/pm-ipc-handlers
 */

const { ipcMain } = require('electron');
const { projectStore } = require('./project-store');
const { logger } = require('../utils/logger');

function setupPMIpcHandlers() {
  // 获取项目列表
  ipcMain.handle('pm:get-projects', (_event, filter = {}) => {
    return projectStore.getProjects(filter);
  });

  // 获取项目详情
  ipcMain.handle('pm:get-project', (_event, projectId) => {
    return projectStore.getProject(projectId);
  });

  // 获取项目摘要（供 Dashboard 使用）
  ipcMain.handle('pm:get-summary', () => {
    return projectStore.getProjectsSummary();
  });

  logger.info('PM IPC 处理器已设置');
}

module.exports = { setupPMIpcHandlers };
