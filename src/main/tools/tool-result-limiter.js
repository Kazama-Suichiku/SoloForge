/**
 * SoloForge - 工具结果大小限制器（token 级硬上限）
 *
 * 背景：
 *   原实现用字符数（resultStr.length > 10000）判断是否截断，
 *   但中文字符与 ASCII 字符的 token/字符比差异很大（中文≈1.5 token/字，
 *   ASCII≈0.4 token/字），字符数阈值不能可靠防止 token 超限。
 *
 * 本模块：
 *   1) estimateTokens(text) - 复用项目内 llm/token-estimator 的实现，
 *      保证与上下文预算统计口径一致。
 *   2) limitResultSize(result, maxTokens) - 对工具返回值做 token 级硬上限
 *      截断，超限时保留头部 + 尾部 + 截断提示，方便 LLM 看到结构信息。
 *
 * 设计原则：
 *   - 纯函数，无副作用，不依赖任何 I/O
 *   - 与 tool-executor 解耦，便于单测
 *   - 截断信息清晰可观测（原始 token、截断后 token、被截断的工具名）
 *
 * @module tools/tool-result-limiter
 */

'use strict';

const { estimateTokens } = require('../llm/token-estimator');

/** 默认结果 token 上限（可被 tool-executor 覆盖） */
const DEFAULT_MAX_RESULT_TOKENS = 8000;

/** 截断时保留的尾部字符数，便于看到结果末尾的摘要/错误堆栈 */
const TAIL_KEEP_CHARS = 800;

/** 截断时保留的头部字符数 */
const HEAD_KEEP_CHARS = 6000;

/**
 * 将任意结果序列化为字符串
 * @param {*} result
 * @returns {string}
 */
function _stringify(result) {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * 对工具结果做 token 级硬上限截断
 *
 * 截断策略：
 *   1) 先把结果序列化为字符串
 *   2) 估算 token 数
 *   3) 若未超限，原样返回
 *   4) 若超限，保留头部 + 尾部 + 中间插入截断提示
 *      （头部为主，尾部用于保留"错误堆栈/摘要"等结尾信息）
 *
 * @param {*} result - 工具原始返回值（字符串、对象、数组等）
 * @param {Object} [options]
 * @param {number} [options.maxTokens=DEFAULT_MAX_RESULT_TOKENS] - 最大 token 数
 * @param {string} [options.toolName] - 工具名（仅用于日志/截断提示，不影响截断逻辑）
 * @returns {{ truncated: boolean, value: *, originalTokens: number, finalTokens: number, originalChars: number, finalChars: number }}
 *   - truncated: 是否截断
 *   - value: 截断后的值（字符串则截断，对象则返回截断后的字符串）
 */
function limitResultSize(result, options = {}) {
  const maxTokens = options.maxTokens && options.maxTokens > 0
    ? options.maxTokens
    : DEFAULT_MAX_RESULT_TOKENS;
  const toolName = options.toolName || 'unknown';

  // 快速路径：非字符串且非对象直接放行（数字/布尔不会超 token 上限）
  if (typeof result !== 'string' && !result || typeof result === 'number' || typeof result === 'boolean') {
    const tokens = estimateTokens(String(result ?? ''));
    return { truncated: false, value: result, originalTokens: tokens, finalTokens: tokens, originalChars: 0, finalChars: 0 };
  }

  const str = _stringify(result);
  const originalTokens = estimateTokens(str);
  const originalChars = str.length;

  // 未超限：原样返回
  if (originalTokens <= maxTokens) {
    return {
      truncated: false,
      value: result,
      originalTokens,
      finalTokens: originalTokens,
      originalChars,
      finalChars: originalChars,
    };
  }

  // 超限：截断
  // 策略：保留头部 HEAD_KEEP_CHARS + 尾部 TAIL_KEEP_CHARS，
  // 中间插入截断提示（含 token 统计）
  // 注意：字符截断是近似手段——通过保留较少的字符来降低 token，
  // 然后再用 estimateTokens 验证。
  let head = str.slice(0, HEAD_KEEP_CHARS);
  let tail = str.length > TAIL_KEEP_CHARS ? str.slice(-TAIL_KEEP_CHARS) : '';
  const notice =
    `\n\n...(结果已截断: 工具 ${toolName} 原始 ${originalTokens} tokens / ${originalChars} 字符, ` +
    `上限 ${maxTokens} tokens。如需完整内容请缩小查询范围或使用分页参数)...\n\n`;

  let truncatedStr = head + notice + tail;

  // 如果加上提示后仍然超限（极端情况：头部本身已经很大），
  // 进一步缩小头部直到满足上限
  let finalTokens = estimateTokens(truncatedStr);
  let safetyLoops = 0;
  while (finalTokens > maxTokens && safetyLoops < 10) {
    const overflowRatio = maxTokens / finalTokens;
    const newHeadLen = Math.max(200, Math.floor(head.length * overflowRatio * 0.8));
    head = str.slice(0, newHeadLen);
    truncatedStr = head + notice + tail;
    finalTokens = estimateTokens(truncatedStr);
    safetyLoops++;
  }

  return {
    truncated: true,
    value: truncatedStr,
    originalTokens,
    finalTokens,
    originalChars,
    finalChars: truncatedStr.length,
  };
}

module.exports = {
  estimateTokens,
  limitResultSize,
  DEFAULT_MAX_RESULT_TOKENS,
  HEAD_KEEP_CHARS,
  TAIL_KEEP_CHARS,
};
