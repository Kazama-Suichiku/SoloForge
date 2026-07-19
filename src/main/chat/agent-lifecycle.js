/**
 * SoloForge - Agent 任务追踪与主动推送
 *
 * 原先位于 chat-manager.js 的以下方法，抽出为独立模块：
 *   - _startTask / _updateTaskStage / _finishTask / _abortTask
 *   - abortAgentTask / getActiveTasksList
 *   - pushProactiveMessage / _sendProactiveMessage / _flushProactiveQueue
 *
 * 设计为"无状态函数 + 传入 chatManager"形式，由 chat-manager.js 代理调用，
 * 不改变对外接口。这样既减少了 chat-manager 的行数，也方便将来进一步抽出
 * 为独立类。
 *
 * @module chat/agent-lifecycle
 */

const { logger } = require('../utils/logger');

/**
 * 注册一个活跃任务
 * @param {Object} chatManager
 * @param {string} agentId
 * @param {Object} info - { conversationId, messageId, task, stage }
 * @returns {{ taskId: string, abortController: AbortController }}
 */
function startTask(chatManager, agentId, info) {
  // 如果该 Agent 已有活跃任务，先中止旧任务
  abortTask(chatManager, agentId, '新任务覆盖');

  const abortController = new AbortController();
  const agent = chatManager.getAgent(agentId);
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  chatManager.activeTasks.set(agentId, {
    taskId,
    agentId,
    agentName: agent?.name || agentId,
    conversationId: info.conversationId,
    messageId: info.messageId,
    task: info.task?.slice(0, 200) || '',
    startTime: Date.now(),
    stage: info.stage || 'thinking',
    abortController,
  });
  logger.info(`任务开始: ${agent?.name || agentId}`, { taskId, task: info.task?.slice(0, 50) });
  return { taskId, abortController };
}

/**
 * 更新任务阶段
 */
function updateTaskStage(chatManager, agentId, stage) {
  const task = chatManager.activeTasks.get(agentId);
  if (task) {
    task.stage = stage;
  }
}

/**
 * 完成任务（移除追踪）
 * @param {string} [taskId] - 如果提供则只删除匹配的任务
 */
function finishTask(chatManager, agentId, taskId) {
  const task = chatManager.activeTasks.get(agentId);
  if (!task) return;

  if (taskId && task.taskId !== taskId) {
    logger.debug(`finishTask: taskId 不匹配，跳过删除`, {
      agentId,
      expectedTaskId: taskId,
      currentTaskId: task.taskId,
    });
    return;
  }

  const elapsed = Date.now() - task.startTime;
  logger.info(`任务完成: ${task.agentName}`, { taskId: task.taskId, elapsed: `${elapsed}ms` });
  chatManager.activeTasks.delete(agentId);
  flushProactiveQueue(chatManager, agentId);
}

/**
 * 中止 Agent 的当前任务
 * @returns {boolean}
 */
function abortTask(chatManager, agentId, reason) {
  const task = chatManager.activeTasks.get(agentId);
  if (!task) return false;

  logger.info(`任务中止: ${task.agentName}`, { reason: reason || '用户终止' });
  if (task.abortController && typeof task.abortController.abort === 'function') {
    task.abortController.abort(reason || '用户终止');
  }
  chatManager.activeTasks.delete(agentId);

  // 中止后也要冲洗排队消息（除非是新任务覆盖，那种情况新任务会继续阻塞队列）
  if (reason !== '新任务覆盖') {
    flushProactiveQueue(chatManager, agentId);
  }
  return true;
}

/**
 * 用户请求终止指定 Agent 的任务
 */
function abortAgentTask(chatManager, agentId) {
  const agent = chatManager.getAgent(agentId);
  const agentName = agent?.name || agentId;

  if (!chatManager.activeTasks.has(agentId)) {
    return { success: false, message: `${agentName} 当前没有进行中的任务` };
  }
  abortTask(chatManager, agentId, '用户手动终止');
  return { success: true, message: `已终止 ${agentName} 的当前任务` };
}

/**
 * 获取所有活跃任务状态（供前端展示）
 */
function getActiveTasksList(chatManager) {
  const tasks = [];
  for (const [agentId, task] of chatManager.activeTasks) {
    tasks.push({
      agentId,
      agentName: task.agentName,
      conversationId: task.conversationId,
      task: task.task,
      startTime: task.startTime,
      elapsed: Date.now() - task.startTime,
      stage: task.stage,
    });
  }
  return tasks;
}

// ─────────────────────────────────────────────────────────────
// 主动推送消息
// ─────────────────────────────────────────────────────────────

/**
 * 主动向用户推送消息（实时出现在聊天窗口中）
 * 排队机制：如果该 Agent 正在处理用户的流式会话，消息先排队。
 */
function pushProactiveMessage(chatManager, agentId, content) {
  if (!chatManager.webContents || chatManager.webContents.isDestroyed()) {
    logger.warn('pushProactiveMessage: webContents 不可用，消息未推送', { agentId });
    return;
  }

  if (chatManager.activeTasks.has(agentId)) {
    if (!chatManager._proactiveQueue.has(agentId)) {
      chatManager._proactiveQueue.set(agentId, []);
    }
    chatManager._proactiveQueue.get(agentId).push({ content, timestamp: Date.now() });
    const agent = chatManager.getAgent(agentId);
    logger.info(`主动推送消息已排队（Agent 会话中）: ${agent?.name || agentId} → 老板`, {
      contentLength: content.length,
      queueSize: chatManager._proactiveQueue.get(agentId).length,
    });
    return;
  }

  sendProactiveMessage(chatManager, agentId, content);
}

/**
 * 实际发送主动推送消息（不检查排队）
 */
function sendProactiveMessage(chatManager, agentId, content, timestamp) {
  if (!chatManager.webContents || chatManager.webContents.isDestroyed()) return;

  const agent = chatManager.getAgent(agentId);
  const agentName = agent?.name || agentId;

  chatManager.webContents.send('agent:proactive-message', {
    agentId,
    agentName,
    content,
    timestamp: timestamp || Date.now(),
  });

  logger.info(`主动推送消息: ${agentName} → 老板`, { contentLength: content.length });
}

/**
 * 冲洗排队的主动推送消息（在 Agent 会话结束后调用）
 */
function flushProactiveQueue(chatManager, agentId) {
  const queue = chatManager._proactiveQueue.get(agentId);
  if (!queue || queue.length === 0) return;

  logger.info(`冲洗排队消息: ${agentId}`, { count: queue.length });
  chatManager._proactiveQueue.delete(agentId);

  setTimeout(() => {
    for (const msg of queue) {
      sendProactiveMessage(chatManager, agentId, msg.content, msg.timestamp);
    }
  }, 500);
}

module.exports = {
  startTask,
  updateTaskStage,
  finishTask,
  abortTask,
  abortAgentTask,
  getActiveTasksList,
  pushProactiveMessage,
  sendProactiveMessage,
  flushProactiveQueue,
};
