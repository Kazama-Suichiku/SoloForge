/**
 * SoloForge - 上下文折叠（Context Folding）
 *
 * 阶段二A 产物：对历史对话消息按与当前 query 的语义相似度折叠，
 * 低相关消息替换为异步生成的折叠摘要，高相关消息完整保留。
 *
 * 设计要点（参考 VCP ContextFoldingV2）：
 * - 入口 fold(history, currentQuery, budget)：
 *   1. history 太短（<5 条）直接返回，不折叠
 *   2. embedding 服务不可用（embed 返回 null）直接返回，不折叠（降级）
 *   3. 对每条历史消息算与 currentQuery 的余弦相似度
 *   4. 动态阈值 = 相似度中位数 - 0.1，低于阈值且内容 >50 字的标记为可折叠
 *   5. 可折叠消息：SHA-256 hash → 查 SQLite folding_entries 表
 *      - 已有 ready 摘要：直接替换为 [折叠摘要:xxx]
 *      - 没有：本次用占位 [折叠摘要:待生成]，异步调 LLM 生成并存表，下次命中再替换
 *   6. 高相似度消息完整保留
 * - 折叠摘要按内容 hash 缓存（跨对话复用），避免对同一段长文反复调 LLM
 * - LLM 不可用时 _callLLM 返回 null，异步任务跳过存表，下次仍用占位（不崩）
 * - 整个 fold 包在 try/catch 里，任何异常都降级返回原 history
 *
 * 依赖：
 * - ./embedding-service 的 embed / embedBatch（阶段一B 产物）
 * - ./sqlite-store 的 sqliteStore 单例（阶段一A 产物，含 folding_entries 表）
 * - LLM Manager（由 chatManager.setLLMManager 注入，用于异步生成摘要）
 *
 * @module memory/context-folding
 */

'use strict';

const crypto = require('crypto');
const { logger } = require('../utils/logger');
const { embed, embedBatch } = require('./embedding-service');

/**
 * 历史消息最少条数：少于此数不折叠（太短折叠无意义）
 */
const MIN_HISTORY_TO_FOLD = 5;

/**
 * 可折叠消息的最小内容长度（字符）。短消息折叠得不偿失，保留原样。
 */
const MIN_CONTENT_LEN_TO_FOLD = 50;

/**
 * 折叠摘要单次送 LLM 的最大内容长度（字符）。超长截断，控制 LLM 输入成本。
 */
const FOLDING_CONTENT_CHAR_LIMIT = 800;

/**
 * 折叠摘要生成用的模型（快速、便宜）；与 history-manager 保持一致
 */
const FOLDING_SUMMARY_MODEL = 'claude-haiku-4-5';

/**
 * 上下文折叠器
 */
class ContextFolding {
  constructor() {
    /** @type {import('../llm/llm-manager').LLMManager|null} */
    this.llmManager = null;
  }

  /**
   * 注入 LLM Manager（由 chatManager.setLLMManager 调用）
   * @param {import('../llm/llm-manager').LLMManager} llm
   */
  setLLMManager(llm) {
    this.llmManager = llm;
  }

  /**
   * 对历史消息按与当前 query 的语义相似度折叠。
   *
   * @param {Array<{role: string, content: string}>} history - 历史消息
   * @param {string} currentQuery - 当前用户查询（用于算相似度）
   * @param {number} [budget] - token 预算（当前未用于裁剪，预留给后续阶段）
   * @returns {Promise<Array<{role: string, content: string}>>} 折叠后的历史
   */
  async fold(history, currentQuery, budget) {
    // 参数校验 + 短历史不折叠
    if (!Array.isArray(history) || history.length < MIN_HISTORY_TO_FOLD) {
      return history;
    }
    if (!currentQuery || typeof currentQuery !== 'string' || currentQuery.trim().length === 0) {
      return history;
    }

    try {
      // 1. 算 currentQuery 的 embedding
      const queryEmb = await embed(currentQuery);
      if (!queryEmb) {
        // embedding 服务不可用：降级，不折叠
        return history;
      }

      // 2. 批量算历史消息 embedding
      const historyTexts = history.map((m) => m.content || '');
      const historyEmbs = await embedBatch(historyTexts);
      if (!historyEmbs || historyEmbs.length !== history.length) {
        return history;
      }
      // 全部为 null（embedding 服务不可用）：降级
      if (historyEmbs.every((e) => !e)) {
        return history;
      }

      // 3. 算每条历史消息与 query 的余弦相似度（embedding 为 null 的记 -1，不折叠）
      const similarities = historyEmbs.map((emb, i) => ({
        index: i,
        similarity: emb ? cosineSim(queryEmb, emb) : -1,
      }));

      // 4. 动态阈值：取有效相似度的中位数 - 0.1
      const validSims = similarities
        .map((s) => s.similarity)
        .filter((s) => s >= 0)
        .sort((a, b) => a - b);
      if (validSims.length < MIN_HISTORY_TO_FOLD) {
        // 有效相似度太少（多数 embedding 失败）：不折叠
        return history;
      }
      const median = validSims[Math.floor(validSims.length / 2)];
      const threshold = median - 0.1;

      // 5. 按阈值分类：低相关且内容够长 → 可折叠；其余保留
      const result = [];
      for (const { index, similarity } of similarities) {
        const msg = history[index];
        const content = msg && msg.content ? msg.content : '';
        if (
          similarity < threshold &&
          content.length > MIN_CONTENT_LEN_TO_FOLD
        ) {
          // 可折叠：查/生成折叠摘要
          const foldedContent = await this._foldOne(content);
          result.push({ ...msg, content: foldedContent });
        } else {
          result.push(msg);
        }
      }
      return result;
    } catch (err) {
      // 任何异常降级返回原 history，绝不崩
      logger.warn('context-folding: fold 失败，降级返回原历史', {
        error: err && err.message,
      });
      return history;
    }
  }

  /**
   * 对单条消息内容做折叠：查缓存 → 命中返回摘要；未命中返回占位 + 异步生成。
   * @param {string} content 原始消息内容
   * @returns {Promise<string>} 折叠后的内容（摘要或占位）
   * @private
   */
  async _foldOne(content) {
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const cached = await this.getFoldingSummary(contentHash);
    if (cached) {
      return `[折叠摘要:${cached}]`;
    }
    // 未命中：本次用占位，异步生成存表（下次命中再替换）
    this._generateAsync(contentHash, content);
    return `[折叠摘要:待生成]`;
  }

  /**
   * 从 SQLite folding_entries 表读已就绪的折叠摘要。
   * @param {string} contentHash SHA-256 hash
   * @returns {Promise<string|null>} 摘要文本，或 null（无缓存/未就绪）
   */
  async getFoldingSummary(contentHash) {
    try {
      const { sqliteStore } = require('./sqlite-store');
      const row = sqliteStore.getFoldingEntry(contentHash);
      if (row && row.summary_status === 'ready' && row.summary) {
        // 刷新 last_used（非阻塞，失败忽略）
        try {
          sqliteStore.touchFoldingEntry(contentHash);
        } catch (_e) {
          // ignore
        }
        return row.summary;
      }
      return null;
    } catch (err) {
      logger.debug('context-folding: 读 folding_entries 失败', {
        hash: contentHash.slice(0, 12),
        error: err && err.message,
      });
      return null;
    }
  }

  /**
   * 异步生成折叠摘要并存入 SQLite。
   * 用 setImmediate 调度，不阻塞 fold 主流程；失败只记日志，不抛。
   * @param {string} contentHash
   * @param {string} content
   * @private
   */
  _generateAsync(contentHash, content) {
    setImmediate(async () => {
      try {
        const truncated = content.slice(0, FOLDING_CONTENT_CHAR_LIMIT);
        const summary = await this._callLLM(
          '总结以下内容的关键信息，保留事实、决策、结论，去掉寒暄和重复。用简洁的要点格式。\n' +
            '只返回摘要文本，不要添加其他说明。\n\n' +
            `内容：\n${truncated}`
        );
        if (summary) {
          try {
            const { sqliteStore } = require('./sqlite-store');
            sqliteStore.saveFoldingEntry(contentHash, summary, 'ready');
            logger.debug('context-folding: 折叠摘要已生成并存表', {
              hash: contentHash.slice(0, 12),
              summaryLen: summary.length,
            });
          } catch (e) {
            logger.debug('context-folding: 存 folding_entries 失败', {
              hash: contentHash.slice(0, 12),
              error: e && e.message,
            });
          }
        }
      } catch (e) {
        logger.debug('context-folding: 异步生成摘要失败', {
          hash: contentHash.slice(0, 12),
          error: e && e.message,
        });
      }
    });
  }

  /**
   * 调 LLM 生成摘要（参考 history-manager._callLLM 的调用方式）
   * @param {string} prompt
   * @returns {Promise<string|null>}
   * @private
   */
  async _callLLM(prompt) {
    if (!this.llmManager) return null;
    try {
      const messages = [{ role: 'user', content: prompt }];
      const result = await this.llmManager.chat(messages, {
        model: FOLDING_SUMMARY_MODEL,
        temperature: 0.2,
        maxTokens: 500,
      });
      return typeof result === 'string' ? result : result?.content || null;
    } catch (err) {
      logger.debug('context-folding: LLM 调用失败', { error: err && err.message });
      return null;
    }
  }
}

/**
 * 余弦相似度（带防零除）
 * @param {Float32Array|Array<number>} a
 * @param {Float32Array|Array<number>} b
 * @returns {number}
 */
function cosineSim(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

// 单例
const contextFolding = new ContextFolding();

module.exports = {
  ContextFolding,
  contextFolding,
  cosineSim,
  MIN_HISTORY_TO_FOLD,
  MIN_CONTENT_LEN_TO_FOLD,
  FOLDING_CONTENT_CHAR_LIMIT,
  FOLDING_SUMMARY_MODEL,
};
