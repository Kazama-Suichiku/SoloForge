/**
 * SoloForge - 上下文预算拟合器
 * 根据模型的上下文窗口大小，按优先级分配 token 预算并裁剪各组成部分
 * 
 * 优先级（P0 最高，不可裁剪）：
 *   P0: System Prompt + 输出预留 (max_tokens)
 *   P1: 当前用户消息（含工具 schema、行动提醒等）
 *   P2: 最近历史消息（从最新到最旧逐条填入）
 *   P3: 记忆上下文、通信记录（已有独立上限，此处仅做总量兜底）
 * 
 * @module chat/context-fitter
 */

const { estimateTokens, estimateMessages, getContextLimit, getAvailableBudget, DEFAULT_OUTPUT_RESERVE, SAFETY_MARGIN } = require('../llm/token-estimator');
const { logger } = require('../utils/logger');
const { virtualFileStore } = require('../context/virtual-file-store');

/**
 * 工具循环中的压缩阈值：当 currentHistory 占用超过可用预算的此比例时触发压缩
 * 已优化：从 0.6 增加到 0.75，更晚触发压缩，保留更多上下文
 */
const TOOL_LOOP_COMPRESS_RATIO = 0.75;

/**
 * 工具循环压缩时保留的最近轮数（每轮 = 1条 assistant + 1条 user/tool_result）
 * 已优化：从 2 增加到 4，长任务中保留更多完整的工具调用历史
 */
const TOOL_LOOP_KEEP_ROUNDS = 4;

/**
 * 截断单条消息时的最大字符数
 * 已优化：从 300 增加到 500，摘要更完整
 */
const TRUNCATED_MSG_MAX_CHARS = 500;

/**
 * @typedef {Object} FitContextParams
 * @property {string} systemPrompt - 系统提示词
 * @property {Array<{role: string, content: string}>} history - 对话历史（完整，未截取）
 * @property {string} userMessage - 当前用户消息（含各种注入的上下文）
 * @property {string} model - 模型标识符
 * @property {number} [outputReserve=4096] - 输出预留 token 数
 */

/**
 * @typedef {Object} FitContextResult
 * @property {Array<{role: string, content: string}>} fittedHistory - 拟合后的历史消息
 * @property {number} totalBudget - 模型上下文窗口总 token
 * @property {number} usedTokens - 估算已使用的 token 数（含 system + history + userMessage）
 * @property {number} remainingBudget - 剩余可用 token（供输出等使用之外的余量）
 * @property {number} droppedMessages - 被裁剪的历史消息条数
 * @property {boolean} wasTruncated - 是否发生了裁剪
 */

/**
 * 按优先级拟合上下文到模型窗口内
 * 
 * @param {FitContextParams} params
 * @returns {FitContextResult}
 */
function fitContext({ systemPrompt, history, userMessage, model, outputReserve = DEFAULT_OUTPUT_RESERVE }) {
  const contextLimit = getContextLimit(model);
  const systemTokens = estimateTokens(systemPrompt);
  const userMsgTokens = estimateTokens(userMessage);

  // 可用于历史消息的预算
  let historyBudget = contextLimit - outputReserve - SAFETY_MARGIN - systemTokens - userMsgTokens;

  // 如果连 system + user 都放不下，强制保留空历史
  if (historyBudget < 0) {
    logger.warn('context-fitter: system prompt + 用户消息已超出模型窗口', {
      model,
      contextLimit,
      systemTokens,
      userMsgTokens,
      deficit: -historyBudget,
    });
    return {
      fittedHistory: [],
      totalBudget: contextLimit,
      usedTokens: systemTokens + userMsgTokens + outputReserve,
      remainingBudget: 0,
      droppedMessages: history.length,
      wasTruncated: history.length > 0,
    };
  }

  // 从最新到最旧逐条填入历史
  const fittedHistory = [];
  let usedHistoryTokens = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgTokens = estimateTokens(msg.content) + 4; // +4 for role overhead

    if (usedHistoryTokens + msgTokens > historyBudget) {
      // 预算不够了，停止添加
      break;
    }

    usedHistoryTokens += msgTokens;
    fittedHistory.unshift(msg);
  }

  const droppedMessages = history.length - fittedHistory.length;
  const totalUsed = systemTokens + usedHistoryTokens + userMsgTokens + outputReserve;

  if (droppedMessages > 0) {
    logger.info('context-fitter: 历史消息已裁剪', {
      model,
      contextLimit,
      originalMessages: history.length,
      fittedMessages: fittedHistory.length,
      droppedMessages,
      historyBudget,
      usedHistoryTokens,
    });
  }

  return {
    fittedHistory,
    totalBudget: contextLimit,
    usedTokens: totalUsed,
    remainingBudget: Math.max(0, historyBudget - usedHistoryTokens),
    droppedMessages,
    wasTruncated: droppedMessages > 0,
  };
}

/**
 * 压缩工具循环中累积的 currentHistory
 * 当累积的历史 token 超过可用预算的 TOOL_LOOP_COMPRESS_RATIO 时触发
 * 
 * 策略（已优化 - 参考 Cursor/Claude Code 最佳实践）：
 * - 保留最近 TOOL_LOOP_KEEP_ROUNDS 轮（每轮 2 条：assistant + tool_result）的完整内容
 * - 将更早的轮次截断为摘要
 * - 原始内容保存到虚拟文件，支持按需回溯
 * 
 * @param {Array<{role: string, content: string}>} currentHistory - 工具循环中累积的历史
 * @param {number} availableBudget - 可用于历史的 token 预算
 * @param {Object} [options] - 额外选项
 * @param {string} [options.taskContext] - 当前任务描述（用于虚拟文件标记）
 * @param {string} [options.sessionId] - 会话 ID
 * @returns {{ compressed: Array<{role: string, content: string}>, wasCompressed: boolean, virtualFileId?: string }}
 */
function compressToolHistory(currentHistory, availableBudget, options = {}) {
  if (!currentHistory || currentHistory.length === 0) {
    return { compressed: currentHistory, wasCompressed: false };
  }

  const estimated = estimateMessages(currentHistory);
  const threshold = availableBudget * TOOL_LOOP_COMPRESS_RATIO;

  // 未超阈值，不需要压缩
  if (estimated <= threshold) {
    return { compressed: currentHistory, wasCompressed: false };
  }

  // 保留最近的 N 轮（每轮 = assistant + user(tool_result) = 2条消息）
  const keepCount = TOOL_LOOP_KEEP_ROUNDS * 2;
  const keep = currentHistory.slice(-keepCount);
  const older = currentHistory.slice(0, -keepCount);

  if (older.length === 0) {
    // 就算只有最近几轮也超了，那就只能保留最近的
    return { compressed: keep, wasCompressed: false };
  }

  // 将原始内容保存到虚拟文件（供回溯使用）
  let virtualFileId = null;
  try {
    const olderContent = JSON.stringify(older, null, 2);
    if (olderContent.length > 1000) { // 只有内容足够大时才保存
      const vf = virtualFileStore.store(olderContent, {
        type: 'compressed_history',
        taskContext: options.taskContext,
        sessionId: options.sessionId,
        messageCount: older.length,
      });
      virtualFileId = vf.fileId;
    }
  } catch (err) {
    logger.debug('保存压缩历史到虚拟文件失败', { error: err.message });
  }

  // 生成规则摘要（提取关键信息）
  const summary = _generateHistorySummary(older);

  // 构建摘要消息
  const summaryMessage = {
    role: 'user',
    content: virtualFileId
      ? `[历史摘要 - 共 ${older.length} 条消息已压缩，完整内容见虚拟文件 ${virtualFileId}]\n\n${summary}\n\n如需查看完整的工具调用历史，请使用 recall_compressed_history 工具。`
      : `[历史摘要 - 共 ${older.length} 条消息已压缩]\n\n${summary}`,
  };

  const result = [summaryMessage, ...keep];

  logger.info('context-fitter: 工具循环历史已智能压缩', {
    originalMessages: currentHistory.length,
    compressedMessages: result.length,
    olderCompressed: older.length,
    recentKept: keep.length,
    estimatedBefore: estimated,
    estimatedAfter: estimateMessages(result),
    virtualFileId,
  });

  return { compressed: result, wasCompressed: true, virtualFileId };
}

/**
 * 生成历史消息的规则摘要
 * 提取关键信息：工具调用、文件路径、错误、决策
 * 
 * @param {Array<{role: string, content: string}>} messages
 * @returns {string}
 */
function _generateHistorySummary(messages) {
  const toolCalls = [];
  const filePaths = new Set();
  const errors = [];
  const decisions = [];

  for (const msg of messages) {
    if (!msg.content || typeof msg.content !== 'string') continue;

    // 提取工具调用
    const toolCallRegex = /<name>([^<]+)<\/name>/g;
    let match;
    while ((match = toolCallRegex.exec(msg.content)) !== null) {
      if (!toolCalls.includes(match[1])) {
        toolCalls.push(match[1]);
      }
    }

    // 提取文件路径
    const pathRegex = /(?:\/[\w.-]+)+(?:\.[\w]+)?/g;
    while ((match = pathRegex.exec(msg.content)) !== null) {
      if (match[0].length > 5 && match[0].length < 200) {
        filePaths.add(match[0]);
      }
    }

    // 提取错误信息
    if (msg.content.includes('错误') || msg.content.includes('Error') || msg.content.includes('失败')) {
      const errorMatch = msg.content.match(/(?:错误|Error|失败)[：:]\s*([^\n]+)/i);
      if (errorMatch && errorMatch[1]) {
        errors.push(errorMatch[1].slice(0, 100));
      }
    }

    // 提取决策/结论
    if (msg.role === 'assistant' && msg.content.length > 100) {
      // 查找结论性语句
      const conclusionMatch = msg.content.match(/(?:完成|已|结论|总结|决定|方案)[：:]\s*([^\n]+)/);
      if (conclusionMatch && conclusionMatch[1]) {
        decisions.push(conclusionMatch[1].slice(0, 100));
      }
    }
  }

  const parts = [];

  if (toolCalls.length > 0) {
    parts.push(`**已调用工具**: ${toolCalls.join(', ')}`);
  }

  if (filePaths.size > 0) {
    const pathList = Array.from(filePaths).slice(0, 10);
    parts.push(`**涉及文件**: ${pathList.join(', ')}${filePaths.size > 10 ? ` 等 ${filePaths.size} 个文件` : ''}`);
  }

  if (errors.length > 0) {
    parts.push(`**遇到的问题**: ${errors.slice(0, 3).join('; ')}`);
  }

  if (decisions.length > 0) {
    parts.push(`**关键结论**: ${decisions.slice(0, 3).join('; ')}`);
  }

  if (parts.length === 0) {
    return `已执行 ${messages.length} 轮工具调用（内容已压缩）`;
  }

  return parts.join('\n');
}

/**
 * 生成历史裁剪后的提示信息
 * 告知 Agent 有更早的历史被省略了
 * 
 * @param {number} droppedCount - 被省略的消息条数
 * @param {number} totalCount - 原始总消息条数
 * @returns {string} 提示文本
 */
function getDroppedHistoryHint(droppedCount, totalCount) {
  if (droppedCount <= 0) return '';
  return `[注意：本次对话共 ${totalCount} 条消息，因上下文窗口限制，已省略最早的 ${droppedCount} 条。如需回顾，请使用 load_history 工具。]`;
}

module.exports = {
  fitContext,
  compressToolHistory,
  getDroppedHistoryHint,
  TOOL_LOOP_COMPRESS_RATIO,
  TOOL_LOOP_KEEP_ROUNDS,
  _generateHistorySummary, // 导出供测试使用
};
