/**
 * SoloForge - PM IPC 处理器
 * 为前端提供项目管理数据的 IPC 接口
 * @module pm/pm-ipc-handlers
 */

const { ipcMain } = require('electron');
const { projectStore } = require('./project-store');
const { logger } = require('../utils/logger');
const { safeHandler } = require('../utils/safe-handler');

function setupPMIpcHandlers() {
  // 获取项目列表
  ipcMain.handle(
    'pm:get-projects',
    safeHandler((_event, filter = {}) => {
      return projectStore.getProjects(filter);
    }, { channel: 'pm:get-projects' })
  );

  // 获取项目详情
  ipcMain.handle(
    'pm:get-project',
    safeHandler((_event, projectId) => {
      return projectStore.getProject(projectId);
    }, { channel: 'pm:get-project' })
  );

  // 获取项目摘要（供 Dashboard 使用）
  ipcMain.handle(
    'pm:get-summary',
    safeHandler(() => {
      return projectStore.getProjectsSummary();
    }, { channel: 'pm:get-summary' })
  );

  logger.info('PM IPC 处理器已设置');
}

module.exports = { setupPMIpcHandlers };
