/**
 * SoloForge - 轻量级 Token 估算工具
 * 基于字符类型的启发式估算，不引入外部 tokenizer 依赖
 * 
 * 经验值：
 * - 中文字 ≈ 1.5 token（CJK 统一表意文字）
 * - 英文单词 ≈ 1.3 token（ASCII 字母 + 标点 ≈ 0.4 token/char）
 * - 空白符 ≈ 0.25 token
 * 
 * @module llm/token-estimator
 */

const { MODEL_CONTEXT_LIMITS: DUOJIE_LIMITS } = require('./duojie-provider');
const { MODEL_CONTEXT_LIMITS: DEEPSEEK_LIMITS } = require('./deepseek-provider');

// 合并所有 Provider 的上下文限制
const MODEL_CONTEXT_LIMITS = { ...DUOJIE_LIMITS, ...DEEPSEEK_LIMITS };

/** 默认上下文窗口大小（未知模型的保守值） */
const DEFAULT_CONTEXT_LIMIT = 128000;

/** 默认输出 token 预留 */
const DEFAULT_OUTPUT_RESERVE = 4096;

/** 安全余量（避免刚好踩到边界） */
const SAFETY_MARGIN = 500;

/**
 * 估算文本的 token 数量
 * @param {string|any} text - 输入文本（非字符串会 JSON.stringify）
 * @returns {number} 估算的 token 数
 */
function estimateTokens(text) {
  if (!text) return 0;

  const str = typeof text === 'string' ? text : JSON.stringify(text);
  if (str.length === 0) return 0;

  let tokens = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);

    if (code >= 0x4E00 && code <= 0x9FFF) {
      // CJK 统一表意文字（中文）
      tokens += 1.5;
    } else if (code >= 0x3000 && code <= 0x303F) {
      // CJK 标点（。、「」等）
      tokens += 1.0;
    } else if (code >= 0x3040 && code <= 0x30FF) {
      // 日文平假名/片假名
      tokens += 1.5;
    } else if (code >= 0xAC00 && code <= 0xD7AF) {
      // 韩文音节
      tokens += 1.5;
    } else if (code <= 0x20) {
      // 空白与控制字符
      tokens += 0.25;
    } else {
      // ASCII 字母、数字、标点等
      tokens += 0.4;
    }
  }

  // 加 10% 安全余量，防止低估
  return Math.ceil(tokens * 1.1);
}

/**
 * 估算消息数组的总 token 数
 * 每条消息额外计算 role 标记开销（约 4 token）
 * @param {Array<{role: string, content: string|any}>} messages
 * @returns {number} 估算的总 token 数
 */
function estimateMessages(messages) {
  if (!messages || messages.length === 0) return 0;

  let total = 0;
  for (const msg of messages) {
    total += 4; // role + 消息边界开销
    if (msg.content) {
      total += estimateTokens(msg.content);
    }
  }
  // 消息序列的首尾开销
  total += 3;
  return total;
}

/**
 * 获取模型的上下文窗口大小
 * @param {string} model - 模型标识符
 * @returns {number} 上下文窗口 token 数
 */
function getContextLimit(model) {
  if (!model) return DEFAULT_CONTEXT_LIMIT;
  return MODEL_CONTEXT_LIMITS[model] || DEFAULT_CONTEXT_LIMIT;
}

/**
 * 计算可用于历史消息的 token 预算
 * = 模型窗口 - 输出预留 - 安全余量 - 系统提示词 - 当前用户消息
 * 
 * @param {Object} params
 * @param {string} params.model - 模型标识符
 * @param {number} [params.systemPromptTokens=0] - 系统提示词的 token 数
 * @param {number} [params.userMessageTokens=0] - 当前用户消息的 token 数
 * @param {number} [params.outputReserve=4096] - 输出预留 token 数
 * @returns {number} 可用于历史消息的 token 预算
 */
function getAvailableBudget({
  model,
  systemPromptTokens = 0,
  userMessageTokens = 0,
  outputReserve = DEFAULT_OUTPUT_RESERVE,
}) {
  const contextLimit = getContextLimit(model);
  const budget = contextLimit - outputReserve - SAFETY_MARGIN - systemPromptTokens - userMessageTokens;
  return Math.max(0, budget);
}

module.exports = {
  estimateTokens,
  estimateMessages,
  getContextLimit,
  getAvailableBudget,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_OUTPUT_RESERVE,
  SAFETY_MARGIN,
};
