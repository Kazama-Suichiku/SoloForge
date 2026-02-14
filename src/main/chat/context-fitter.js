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

/**
 * 工具循环中的压缩阈值：当 currentHistory 占用超过可用预算的此比例时触发压缩
 */
const TOOL_LOOP_COMPRESS_RATIO = 0.6;

/**
 * 工具循环压缩时保留的最近轮数（每轮 = 1条 assistant + 1条 user/tool_result）
 */
const TOOL_LOOP_KEEP_ROUNDS = 2;

/**
 * 截断单条消息时的最大字符数
 */
const TRUNCATED_MSG_MAX_CHARS = 300;

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
 * 策略：
 * - 保留最近 TOOL_LOOP_KEEP_ROUNDS 轮（每轮 2 条：assistant + tool_result）的完整内容
 * - 将更早的轮次截断为摘要
 * 
 * @param {Array<{role: string, content: string}>} currentHistory - 工具循环中累积的历史
 * @param {number} availableBudget - 可用于历史的 token 预算
 * @returns {{ compressed: Array<{role: string, content: string}>, wasCompressed: boolean }}
 */
function compressToolHistory(currentHistory, availableBudget) {
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

  // 压缩较早的消息为摘要
  const compressed = older.map((msg) => {
    if (!msg.content || typeof msg.content !== 'string') return msg;

    if (msg.role === 'user' && msg.content.startsWith('工具执行结果')) {
      // 工具结果：截断到 TRUNCATED_MSG_MAX_CHARS 字符
      if (msg.content.length > TRUNCATED_MSG_MAX_CHARS) {
        return {
          role: msg.role,
          content: msg.content.slice(0, TRUNCATED_MSG_MAX_CHARS) + '\n...(结果已截断，如需完整信息请重新调用工具)',
        };
      }
      return msg;
    }

    if (msg.role === 'assistant') {
      // Assistant 响应：截断并保留工具调用的名称
      if (msg.content.length > TRUNCATED_MSG_MAX_CHARS) {
        // 尝试提取工具调用名称
        const toolNames = [];
        const toolCallRegex = /<name>([^<]+)<\/name>/g;
        let match;
        while ((match = toolCallRegex.exec(msg.content)) !== null) {
          toolNames.push(match[1]);
        }
        const toolInfo = toolNames.length > 0
          ? `\n(本轮调用了工具: ${toolNames.join(', ')})`
          : '';
        return {
          role: msg.role,
          content: msg.content.slice(0, 200) + `\n...(已截断)${toolInfo}`,
        };
      }
      return msg;
    }

    // 其他消息类型（如 system）保持不变
    return msg;
  });

  const result = [...compressed, ...keep];

  logger.info('context-fitter: 工具循环历史已压缩', {
    originalMessages: currentHistory.length,
    compressedMessages: result.length,
    olderCompressed: older.length,
    recentKept: keep.length,
    estimatedBefore: estimated,
    estimatedAfter: estimateMessages(result),
  });

  return { compressed: result, wasCompressed: true };
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
};
