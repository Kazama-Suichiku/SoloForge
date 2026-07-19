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

  // Phase 3-A：为 GroupQueue 注入 webContents（群聊消息落库后推 UI 用）
  const { groupQueue } = require('./chat/group-queue');
  groupQueue.setWebContents(webContents);

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
  // 采用"发起即返回"模式：立即返回 ack，内容通过 CHAT_STREAM 推送，完成通过 CHAT_COMPLETE 通知
  ipcMain.handle(CHANNELS.CHAT_SEND_MESSAGE_STREAM, (_event, request) => {
    logger.info('Chat IPC: 收到流式消息请求', {
      conversationId: request?.conversationId,
      agentId: request?.agentId,
      messageId: request?.messageId,
      messageLength: request?.message?.length,
    });

    if (!request || !request.agentId || !request.message || !request.messageId) {
      return { success: false, error: '请求参数不完整' };
    }

    // 使用 Promise 但不 await，让处理在后台进行
    // 这样 IPC handler 会立即返回
    (async () => {
      try {
        const result = await chatManager.handleStreamMessage(request);
        // 通过 CHAT_COMPLETE 事件通知前端完成
        if (webContents && !webContents.isDestroyed()) {
          webContents.send(CHANNELS.CHAT_COMPLETE, {
            messageId: request.messageId,
            success: true,
            content: result?.content,
          });
        }
      } catch (error) {
        logger.error('Chat IPC: 流式处理消息失败', error);
        if (webContents && !webContents.isDestroyed()) {
          webContents.send(CHANNELS.CHAT_COMPLETE, {
            messageId: request.messageId,
            success: false,
            error: error.message || '未知错误',
          });
        }
      }
    })();

    // 立即返回确认（同步返回，不等待上面的异步处理）
    return { success: true, started: true };
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

  // ── Phase 3-D：IPC 层群聊发送者校验 ──────────────────────────
  // 渲染进程/未来调用方通过此 invoke 在部门群聊发消息。
  // 强制：发送者必须属于该部门群聊，否则拒绝。mentions 同样做成员过滤。
  // 通道名以字符串字面量定义，避免修改 shared/ipc-channels.js（本任务文件范围外）。
  const CHAT_DEPT_GROUP_POST = 'chat:dept-group-post';
  ipcMain.handle(CHAT_DEPT_GROUP_POST, async (_event, request) => {
    const { departmentId, senderId, content, mentions } = request || {};

    if (!departmentId || !senderId || !content) {
      return { success: false, error: '参数不完整：需要 departmentId、senderId、content' };
    }

    // 1) 发送者校验：必须属于该部门
    const groupId = departmentGroup.getDepartmentGroupId(departmentId);
    const senderCheck = departmentGroup.canAgentPostInGroup(senderId, groupId);
    if (!senderCheck.allowed) {
      logger.warn('IPC 部门群聊发言被拒（发送者校验）:', {
        departmentId, senderId, reason: senderCheck.reason,
      });
      return {
        success: false,
        error: `发言被拒：${senderCheck.reason}`,
        rejected: true,
        reason: senderCheck.reason,
      };
    }

    // 2) 走主流程发送（内部会再做一次成员/冷却过滤，双重保险）
    // Phase 3-A：postToDepartment 内部走 groupQueue.submit（落库 + 推 UI + 排队触发）
    const result = await departmentGroup.postToDepartment(
      departmentId,
      senderId,
      content,
      Array.isArray(mentions) ? mentions : []
    );

    if (!result.success) {
      return { success: false, error: result.error || '发送失败' };
    }

    return {
      success: true,
      groupId,
      effectiveMentions: result.effectiveMentions,
      filteredMentions: result.filteredMentions,
      rejectedMentions: result.rejectedMentions,
    };
  });

  // ── Phase 3-B：渲染进程把群聊消息提交到主进程 GroupQueue ────────
  // 渲染进程不再做连锁触发，用户在群聊发言通过此 invoke 提交给主进程 GroupQueue，
  // 由 GroupQueue 负责：消息落库 + 推 UI + 排队触发被 @ 的 Agent（串行）。
  // senderId 为 'user' 时直接走 groupQueue.submit（不做 Agent 鉴权，用户可在任意群聊发言）。
  ipcMain.handle(CHANNELS.CHAT_GROUP_QUEUE_SUBMIT, async (_event, request) => {
    const { conversationId, senderId, content, mentions, senderName } = request || {};

    if (!conversationId || !senderId || !content) {
      return { success: false, error: '参数不完整：需要 conversationId、senderId、content' };
    }

    // 用户发言直接走 groupQueue.submit；Agent 发言已通过 post_to_group 工具闭环
    const result = await groupQueue.submit({
      conversationId,
      senderId,
      content,
      mentions: Array.isArray(mentions) ? mentions : [],
      senderName,
    });

    if (!result.success) {
      return { success: false, error: result.error || '群聊消息提交失败' };
    }

    return { success: true };
  });

  // ── Phase 3-B：群聊中止（肃静） ─────────────────────────────────
  // 渲染进程通过此 invoke 通知主进程 GroupQueue 肃静某群聊，
  // 清空该群聊的待执行项并标记为已中止，后续 submit 不再排队触发。
  ipcMain.handle(CHANNELS.CHAT_GROUP_QUEUE_ABORT, async (_event, conversationId) => {
    if (!conversationId) {
      return { success: false, error: '缺少 conversationId' };
    }
    return groupQueue.abort(conversationId);
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
  ipcMain.removeHandler('chat:dept-group-post');
  ipcMain.removeHandler(CHANNELS.CHAT_GROUP_QUEUE_SUBMIT);
  ipcMain.removeHandler(CHANNELS.CHAT_GROUP_QUEUE_ABORT);
}

module.exports = {
  setupChatIpcHandlers,
  removeChatIpcHandlers,
};
