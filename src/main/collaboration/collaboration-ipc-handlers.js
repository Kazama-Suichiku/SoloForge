/**
 * SoloForge - Agent 协作 IPC 处理器
 * 处理渲染进程对协作数据的请求
 * @module collaboration/collaboration-ipc-handlers
 */

const { ipcMain } = require('electron');
const { agentCommunication } = require('./agent-communication');
const { logger } = require('../utils/logger');

/**
 * 设置协作相关的 IPC 处理器
 */
function setupCollaborationIpcHandlers() {
  // 获取最近的协作活动
  ipcMain.handle('collaboration:get-activity', async (_event, limit = 20) => {
    logger.info('IPC: collaboration:get-activity', { limit });
    return agentCommunication.getRecentActivity(limit);
  });

  // 获取 Agent 的通信记录
  ipcMain.handle('collaboration:get-messages', async (_event, agentId, options = {}) => {
    logger.info('IPC: collaboration:get-messages', { agentId });
    return agentCommunication.getMessages(agentId, options);
  });

  // 获取委派任务列表
  ipcMain.handle('collaboration:get-tasks', async (_event, agentId, options = {}) => {
    logger.info('IPC: collaboration:get-tasks', { agentId });
    return agentCommunication.getTasks(agentId, options);
  });

  // 获取协作统计
  ipcMain.handle('collaboration:get-stats', async (_event, agentId) => {
    logger.info('IPC: collaboration:get-stats', { agentId });
    return agentCommunication.getStats(agentId);
  });

  // 获取所有协作数据（用于仪表板）
  ipcMain.handle('collaboration:get-summary', async () => {
    logger.info('IPC: collaboration:get-summary');

    const activity = agentCommunication.getRecentActivity(0); // 0 = 返回全部，前端分页显示
    const allMessages = agentCommunication.messages;
    const allTasks = agentCommunication.delegatedTasks;

    return {
      recentActivity: activity,
      messageCount: allMessages.length,
      taskCount: allTasks.length,
      pendingTasks: allTasks.filter((t) => t.status === 'pending').length,
      inProgressTasks: allTasks.filter((t) => t.status === 'in_progress').length,
      completedTasks: allTasks.filter((t) => t.status === 'completed').length,
    };
  });

  logger.info('协作 IPC 处理器已设置');
}

module.exports = { setupCollaborationIpcHandlers };
