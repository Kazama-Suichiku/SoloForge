/**
 * SoloForge - 聊天 IPC Handlers
 * 处理聊天相关的 IPC 通信
 * @module chat-ipc-handlers
 */

const { ipcMain } = require('electron');
const CHANNELS = require('../shared/ipc-channels');
const { chatManager } = require('./chat');
const { logger } = require('./utils/logger');
const departmentGroup = require('./chat/department-group');

/**
 * 设置聊天 IPC Handlers
 * @param {Electron.WebContents} webContents - 用于推送消息的 webContents
 */
function setupChatIpcHandlers(webContents) {
  // 设置 webContents 用于流式推送
  chatManager.setWebContents(webContents);

  // 处理聊天消息（非流式，保留兼容）
  ipcMain.handle(CHANNELS.CHAT_SEND_MESSAGE, async (_event, request) => {
    logger.info('Chat IPC: 收到消息', {
      conversationId: request?.conversationId,
      agentId: request?.agentId,
      messageLength: request?.message?.length,
    });

    if (!request || !request.agentId || !request.message) {
      return { content: '请求参数不完整' };
    }

    try {
      const result = await chatManager.handleMessage(request);
      return result;
    } catch (error) {
      logger.error('Chat IPC: 处理消息失败', error);
      return {
        content: `处理消息时发生错误：${error.message || '未知错误'}`,
      };
    }
  });

  // 处理聊天消息（流式）
  ipcMain.handle(CHANNELS.CHAT_SEND_MESSAGE_STREAM, async (_event, request) => {
    logger.info('Chat IPC: 收到流式消息请求', {
      conversationId: request?.conversationId,
      agentId: request?.agentId,
      messageId: request?.messageId,
      messageLength: request?.message?.length,
    });

    if (!request || !request.agentId || !request.message || !request.messageId) {
      return { content: '请求参数不完整' };
    }

    try {
      // 使用流式处理方法
      const result = await chatManager.handleStreamMessage(request);
      return result;
    } catch (error) {
      logger.error('Chat IPC: 流式处理消息失败', error);
      return {
        content: `处理消息时发生错误：${error.message || '未知错误'}`,
      };
    }
  });

  // 获取所有活跃任务
  ipcMain.handle(CHANNELS.AGENT_TASK_GET_ALL, async () => {
    return chatManager.getActiveTasksList();
  });

  // 终止指定 Agent 的任务
  ipcMain.handle(CHANNELS.AGENT_TASK_ABORT, async (_event, agentId) => {
    logger.info('Chat IPC: 收到终止任务请求', { agentId });
    return chatManager.abortAgentTask(agentId);
  });

  // ── 开除审批（老板在 Dashboard 直接操作）──────────────────────
  const { terminationQueue } = require('./agent-factory/termination-queue');

  // 获取所有开除申请（含 pending）
  ipcMain.handle(CHANNELS.TERMINATION_GET_PENDING, async () => {
    return terminationQueue.getAll();
  });

  // 老板确认/拒绝开除申请
  ipcMain.handle(CHANNELS.TERMINATION_DECIDE, async (_event, { requestId, approved, comment }) => {
    logger.info('Dashboard: 老板审批开除申请', { requestId, approved });
    if (!requestId) {
      return { success: false, error: '缺少 requestId' };
    }
    const result = terminationQueue.confirm(requestId, {
      approved: !!approved,
      comment: comment || (approved ? '老板在控制台批准' : '老板在控制台拒绝'),
    });
    return result;
  });

  // 清空已处理的开除记录
  ipcMain.handle(CHANNELS.TERMINATION_CLEAR_PROCESSED, async () => {
    logger.info('Dashboard: 清空已处理的开除记录');
    return terminationQueue.clearProcessed();
  });

  // 获取所有部门群聊（前端初始化时同步）
  ipcMain.handle(CHANNELS.CHAT_DEPT_GROUP_GET_ALL, async () => {
    logger.info('Chat IPC: 获取所有部门群聊');
    try {
      return departmentGroup.getAllDepartmentGroups();
    } catch (err) {
      logger.error('获取部门群聊失败:', err);
      return [];
    }
  });
}

/**
 * 移除聊天 IPC Handlers（用于清理）
 */
function removeChatIpcHandlers() {
  ipcMain.removeHandler(CHANNELS.CHAT_SEND_MESSAGE);
  ipcMain.removeHandler(CHANNELS.CHAT_SEND_MESSAGE_STREAM);
  ipcMain.removeHandler(CHANNELS.AGENT_TASK_GET_ALL);
  ipcMain.removeHandler(CHANNELS.AGENT_TASK_ABORT);
  ipcMain.removeHandler(CHANNELS.TERMINATION_GET_PENDING);
  ipcMain.removeHandler(CHANNELS.TERMINATION_DECIDE);
  ipcMain.removeHandler(CHANNELS.TERMINATION_CLEAR_PROCESSED);
  ipcMain.removeHandler(CHANNELS.CHAT_DEPT_GROUP_GET_ALL);
}

module.exports = {
  setupChatIpcHandlers,
  removeChatIpcHandlers,
};
