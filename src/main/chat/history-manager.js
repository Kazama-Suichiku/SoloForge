/**
 * SoloForge - 历史消息管理器
 * 实现消息分页、摘要缓存，优化 KV Cache 利用率
 *
 * Codex 方案的滚动摘要（Rolling Summary）：
 *   上下文结构 = [滚动摘要] + [最近 N 条完整消息] + [当前用户消息]
 *   - 当 token 超预算时，不丢弃旧消息，而是压缩成摘要
 *   - 摘要本身也会累积；摘要过长时再压缩成更精炼的摘要
 *   - 最近 recentCount 条消息始终完整保留
 *   - 每次 getRollingSummaryHistory 自动检查 token 预算，超了就压缩
 *   - LLM 不可用或摘要失败时，自动 fallback 到 getOptimizedHistory（简单截断）
 *
 * @module chat/history-manager
 */

const { logger } = require('../utils/logger');
const { estimateTokens, estimateMessages } = require('../llm/token-estimator');

/**
 * 每页消息数量
 * 已优化：从 30 增加到 50，每页加载更多历史消息
 */
const PAGE_SIZE = 50;

/**
 * 摘要缓存过期时间（毫秒）
 */
const SUMMARY_CACHE_TTL = 30 * 60 * 1000; // 30 分钟

/**
 * 滚动摘要：单次压缩一批消息时，最多取多少条来生成摘要
 */
const SUMMARY_BATCH_SIZE = 10;

/**
 * 滚动摘要：摘要本身的最大 token 数，超过则触发二次压缩
 */
const MAX_SUMMARY_TOKENS = 1500;

/**
 * 滚动摘要：每条消息内容取多少字符参与摘要（截断超长消息，控制 LLM 输入）
 */
const SUMMARY_MSG_CHAR_LIMIT = 800;

/**
 * 摘要生成用的模型（快速、便宜）；与 memory-summarizer 保持一致
 */
const SUMMARIZER_MODEL = 'claude-haiku-4-5';

/**
 * @typedef {Object} HistoryPage
 * @property {number} pageIndex - 页码（0 为最新）
 * @property {number} startIndex - 起始消息索引
 * @property {number} endIndex - 结束消息索引
 * @property {Array<{role: string, content: string}>} messages - 消息列表
 * @property {string} [summary] - 页面摘要（如果已生成）
 * @property {number} [summaryTimestamp] - 摘要生成时间
 */

/**
 * @typedef {Object} PaginatedHistory
 * @property {number} totalMessages - 总消息数
 * @property {number} totalPages - 总页数
 * @property {number} currentPage - 当前页码
 * @property {Array<{role: string, content: string}>} messages - 当前页消息
 * @property {boolean} hasMoreHistory - 是否有更多历史
 * @property {string} [previousSummary] - 之前页面的摘要
 */

/**
 * 历史消息管理器
 */
class HistoryManager {
  constructor() {
    /**
     * 摘要缓存
     * key: `${conversationId}:${pageIndex}`
     * @type {Map<string, { summary: string, timestamp: number }>}
     */
    this.summaryCache = new Map();

    /**
     * 最近访问的页面（用于 LRU 清理）
     * @type {Map<string, number>}
     */
    this.accessTime = new Map();

    /**
     * LLM Manager（用于生成滚动摘要），由 chatManager.setLLMManager 注入
     * @type {import('../llm/llm-manager').LLMManager|null}
     */
    this.llmManager = null;

    /**
     * 滚动摘要缓存（Codex 方案）
     * key: conversationId
     * value: { summary: string, lastSummarizedIndex: number, timestamp: number }
     *   - summary: 当前累积的滚动摘要文本（可能已经过二次压缩）
     *   - lastSummarizedIndex: fullHistory 中已经被摘要覆盖的最大索引（下一批从这开始）
     *   - timestamp: 最后更新时间，用于 TTL 过期判断
     * @type {Map<string, { summary: string, lastSummarizedIndex: number, timestamp: number }>}
     */
    this.rollingSummaryCache = new Map();
  }

  /**
   * 设置 LLM Manager（用于滚动摘要生成）
   * 由 chatManager.setLLMManager 调用注入
   * @param {import('../llm/llm-manager').LLMManager} llmManager
   */
  setLLMManager(llmManager) {
    this.llmManager = llmManager;
  }

  /**
   * 分页获取历史消息
   * @param {Array<{role: string, content: string}>} fullHistory - 完整历史
   * @param {Object} options
   * @param {number} [options.page=0] - 页码（0 为最新页）
   * @param {number} [options.pageSize=PAGE_SIZE] - 每页大小
   * @returns {PaginatedHistory}
   */
  paginate(fullHistory, options = {}) {
    const { page = 0, pageSize = PAGE_SIZE } = options;
    const totalMessages = fullHistory.length;
    const totalPages = Math.ceil(totalMessages / pageSize);

    if (totalMessages === 0) {
      return {
        totalMessages: 0,
        totalPages: 0,
        currentPage: 0,
        messages: [],
        hasMoreHistory: false,
      };
    }

    // 从最新消息开始分页（page 0 = 最新）
    // 计算索引：最新消息在数组末尾
    const endIndex = totalMessages - page * pageSize;
    const startIndex = Math.max(0, endIndex - pageSize);

    const messages = fullHistory.slice(startIndex, endIndex);

    return {
      totalMessages,
      totalPages,
      currentPage: page,
      messages,
      hasMoreHistory: startIndex > 0,
      startIndex,
      endIndex,
    };
  }

  /**
   * 获取用于 LLM 的优化历史
   * 支持两种模式：
   *   1. 固定条数模式（传 recentCount）—— 向后兼容
   *   2. Token 预算模式（传 tokenBudget）—— 动态裁剪，优先使用
   * 
   * @param {Array<{role: string, content: string}>} fullHistory - 完整历史
   * @param {string} conversationId - 对话 ID
   * @param {Object} options
   * @param {number} [options.recentCount=PAGE_SIZE] - 最近消息数量（固定条数模式）
   * @param {number} [options.tokenBudget] - 历史消息的 token 预算（优先于 recentCount）
   * @param {boolean} [options.includeSummary=true] - 是否包含历史摘要
   * @returns {{ messages: Array, hasMoreHistory: boolean, historyInfo: string, totalMessages: number, shownMessages: number }}
   */
  getOptimizedHistory(fullHistory, conversationId, options = {}) {
    const { recentCount = PAGE_SIZE, tokenBudget, includeSummary = true } = options;

    if (fullHistory.length === 0) {
      return {
        messages: [],
        hasMoreHistory: false,
        historyInfo: '',
        totalMessages: 0,
        shownMessages: 0,
      };
    }

    let recentMessages;

    if (tokenBudget != null && tokenBudget > 0) {
      // Token 预算模式：从最新到最旧逐条填入，直到预算耗尽
      recentMessages = [];
      let usedTokens = 0;

      for (let i = fullHistory.length - 1; i >= 0; i--) {
        const msg = fullHistory[i];
        const msgTokens = estimateTokens(msg.content) + 4; // +4 role overhead
        if (usedTokens + msgTokens > tokenBudget) break;
        usedTokens += msgTokens;
        recentMessages.unshift(msg);
      }

      logger.debug('history-manager: token 预算模式', {
        tokenBudget,
        usedTokens,
        messagesKept: recentMessages.length,
        totalMessages: fullHistory.length,
      });
    } else {
      // 固定条数模式（向后兼容）
      recentMessages = fullHistory.slice(-recentCount);
    }

    const hasMoreHistory = fullHistory.length > recentMessages.length;

    // 构建历史信息提示
    let historyInfo = '';
    if (hasMoreHistory) {
      const olderCount = fullHistory.length - recentMessages.length;
      const olderPages = Math.ceil(olderCount / PAGE_SIZE);

      // 检查是否有缓存的摘要
      const summaries = [];
      if (includeSummary) {
        for (let i = 1; i <= olderPages; i++) {
          const cached = this.getCachedSummary(conversationId, i);
          if (cached) {
            summaries.push(cached);
          }
        }
      }

      if (summaries.length > 0) {
        historyInfo = `[历史消息摘要]\n${summaries.join('\n')}\n\n[以上是历史摘要，以下是最近 ${recentMessages.length} 条消息]`;
      } else {
        historyInfo = `[注意：还有 ${olderCount} 条更早的历史消息（共 ${olderPages} 页）。如需查看，请使用 load_history 工具。]`;
      }
    }

    return {
      messages: recentMessages,
      hasMoreHistory,
      historyInfo,
      totalMessages: fullHistory.length,
      shownMessages: recentMessages.length,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 滚动摘要（Codex 方案）
  // ─────────────────────────────────────────────────────────────

  /**
   * 获取滚动摘要历史（Codex 方案）
   *
   * 上下文结构 = [滚动摘要] + [最近 recentCount 条完整消息] + [当前用户消息]
   * - 没超预算：直接返回全部
   * - 超预算：保留最近 recentCount 条，其余压缩成滚动摘要
   * - 摘要累积：已有旧摘要 + 新摘要合并；摘要过长再压缩
   * - LLM 不可用 / 摘要失败：返回 summary=null（由调用方 fallback 到 getOptimizedHistory）
   *
   * 阶段二A：在返回前对 recentMessages 做上下文折叠（按与 currentQuery 的
   * 语义相似度把低相关长消息替换为折叠摘要），进一步压缩 token 占用。
   * 折叠失败/降级时静默跳过，返回未折叠的 recentMessages。
   *
   * @param {Array<{role: string, content: string}>} fullHistory - 完整历史
   * @param {string} conversationId - 对话 ID
   * @param {Object} options
   * @param {number} [options.tokenBudget] - 历史消息的 token 预算
   * @param {number} [options.recentCount=PAGE_SIZE] - 始终完整保留的最近消息条数
   * @param {string} [options.currentQuery] - 当前用户查询（用于上下文折叠相似度计算）
   * @returns {Promise<{messages: Array, summary: string|null, hasMoreHistory: boolean, historyInfo: string, totalMessages: number, shownMessages: number}>}
   */
  async getRollingSummaryHistory(fullHistory, conversationId, options = {}) {
    const { tokenBudget, recentCount = PAGE_SIZE, currentQuery } = options;

    // 空历史
    if (!fullHistory || fullHistory.length === 0) {
      return {
        messages: [],
        summary: null,
        hasMoreHistory: false,
        historyInfo: '',
        totalMessages: 0,
        shownMessages: 0,
      };
    }

    // 没传 token 预算或预算非正：无法判断是否超限，直接返回全部（不压缩）
    if (tokenBudget == null || tokenBudget <= 0) {
      return {
        messages: fullHistory,
        summary: this.getRollingSummary(conversationId),
        hasMoreHistory: false,
        historyInfo: '',
        totalMessages: fullHistory.length,
        shownMessages: fullHistory.length,
      };
    }

    // 1. 计算当前 token（用 estimateMessages 更准：含 role 开销）
    const totalTokens = estimateMessages(fullHistory);

    // 2. 没超预算：直接返回全部（仍带上已有的滚动摘要，如果有的话）
    if (totalTokens <= tokenBudget) {
      const existingSummary = this.getRollingSummary(conversationId);
      let keptMessages = fullHistory;
      // 上下文折叠（阶段二A）：即使没超预算，也按 currentQuery 相似度折叠
      // 低相关长消息，让上下文更聚焦于当前 query。
      if (currentQuery && keptMessages.length >= 5) {
        try {
          const { contextFolding } = require('../memory/context-folding');
          const folded = await contextFolding.fold(keptMessages, currentQuery);
          if (Array.isArray(folded)) keptMessages = folded;
        } catch (e) {
          logger.debug('上下文折叠降级（未超预算路径），保留原历史', {
            conversationId,
            error: e && e.message,
          });
        }
      }
      return {
        messages: keptMessages,
        summary: existingSummary,
        hasMoreHistory: false,
        historyInfo: existingSummary ? this._formatHistoryInfo(existingSummary, fullHistory.length, keptMessages.length) : '',
        totalMessages: fullHistory.length,
        shownMessages: keptMessages.length,
      };
    }

    // 3. 超预算：保留最近 recentCount 条，其余待压缩
    const recentMessages = fullHistory.slice(-recentCount);
    const oldMessages = fullHistory.slice(0, fullHistory.length - recentMessages.length);

    // 4. 读取已有滚动摘要 + 已摘要索引
    let rollingSummary = this.getRollingSummary(conversationId);
    const lastSummarizedIndex = this.getLastSummarizedIndex(conversationId);

    // 5. 找出 oldMessages 中尚未被摘要覆盖的部分
    //    lastSummarizedIndex 是相对 fullHistory 的绝对索引；oldMessages 从 0 开始，
    //    所以 oldMessages 中未摘要的是 [max(0, lastSummarizedIndex - 0) ... ]
    //    但因为 recentCount 变化或历史增长，需保证 newToSummarize 不与 recentMessages 重叠。
    const startIdx = Math.max(0, lastSummarizedIndex);
    const newToSummarize = oldMessages.slice(startIdx);

    // 6. 有新消息需要摘要才调 LLM（避免无谓调用）
    if (newToSummarize.length > 0) {
      // 前置检查：LLM 不可用时，直接走 fallback，避免无谓循环
      if (!this.llmManager) {
        logger.debug('滚动摘要：LLM 不可用，fallback 到简单截断', { conversationId });
        return {
          messages: recentMessages,
          summary: null,
          hasMoreHistory: true,
          historyInfo: '',
          totalMessages: fullHistory.length,
          shownMessages: recentMessages.length,
          fallback: true,
        };
      }

      try {
        // 6.1 分批生成摘要（每批 SUMMARY_BATCH_SIZE 条），逐批累积，控制单次 LLM 输入大小
        let accumulated = rollingSummary;
        for (let i = 0; i < newToSummarize.length; i += SUMMARY_BATCH_SIZE) {
          const batch = newToSummarize.slice(i, i + SUMMARY_BATCH_SIZE);
          const batchSummary = await this._generateSummary(batch, accumulated);
          if (batchSummary) {
            accumulated = await this._mergeSummaries(accumulated, batchSummary);
          }
        }

        // 6.2 全部批次完成，写入缓存
        if (accumulated) {
          rollingSummary = accumulated;
          // 新的 lastSummarizedIndex = oldMessages.length（相对 fullHistory，recentMessages 之前的全部已摘要）
          this.cacheRollingSummary(conversationId, rollingSummary, oldMessages.length);
        } else {
          // LLM 调用了但全部返回 null（摘要失败）：走 fallback
          logger.warn('滚动摘要：摘要生成全部失败，fallback 到简单截断', { conversationId });
          return {
            messages: recentMessages,
            summary: null,
            hasMoreHistory: true,
            historyInfo: '',
            totalMessages: fullHistory.length,
            shownMessages: recentMessages.length,
            fallback: true,
          };
        }
      } catch (err) {
        // 摘要失败：不崩，返回 summary=null，让调用方 fallback 到 getOptimizedHistory
        logger.warn('滚动摘要生成失败，将 fallback 到简单截断', {
          conversationId,
          error: err?.message,
        });
        return {
          messages: recentMessages,
          summary: null,
          hasMoreHistory: true,
          historyInfo: '',
          totalMessages: fullHistory.length,
          shownMessages: recentMessages.length,
          fallback: true, // 标记：调用方应改用 getOptimizedHistory
        };
      }
    }

    // 7. 上下文折叠：对保留的 recentMessages 按 currentQuery 相似度折叠低相关长消息
    //    阶段二A：进一步压缩 token，低相关长消息替换为折叠摘要。
    //    折叠失败/降级时静默跳过，recentMessages 保持原样。
    if (currentQuery && recentMessages.length >= 5) {
      try {
        const { contextFolding } = require('../memory/context-folding');
        // contextFolding 已由 chatManager.setLLMManager 注入 llmManager
        const folded = await contextFolding.fold(recentMessages, currentQuery);
        if (Array.isArray(folded)) {
          recentMessages = folded;
        }
      } catch (e) {
        // 降级：跳过折叠，保留原 recentMessages
        logger.debug('上下文折叠降级，保留原历史', {
          conversationId,
          error: e && e.message,
        });
      }
    }

    // 8. 返回：摘要 + 最近消息
    const historyInfo = rollingSummary
      ? this._formatHistoryInfo(rollingSummary, fullHistory.length, recentMessages.length)
      : '';

    return {
      messages: recentMessages,
      summary: rollingSummary,
      hasMoreHistory: false, // 不再提示"还有N条"，因为旧内容已摘要
      historyInfo,
      totalMessages: fullHistory.length,
      shownMessages: recentMessages.length,
    };
  }

  /**
   * 格式化滚动摘要为 historyInfo 文本（注入到 contextualMessage 前方）
   * @param {string} summary
   * @param {number} totalMessages
   * @param {number} shownMessages
   * @returns {string}
   */
  _formatHistoryInfo(summary, totalMessages, shownMessages) {
    if (!summary) return '';
    const omitted = Math.max(0, totalMessages - shownMessages);
    return `[更早的 ${omitted} 条对话已压缩为摘要]\n${summary}\n\n[以上是历史摘要，以下是最近 ${shownMessages} 条消息]`;
  }

  /**
   * 读取对话的滚动摘要（纯文本）
   * @param {string} conversationId
   * @returns {string|null}
   */
  getRollingSummary(conversationId) {
    const entry = this.rollingSummaryCache.get(conversationId);
    if (!entry) return null;
    // TTL 过期则视为无摘要（避免用过期摘要）
    if (Date.now() - entry.timestamp > SUMMARY_CACHE_TTL) {
      this.rollingSummaryCache.delete(conversationId);
      return null;
    }
    return entry.summary;
  }

  /**
   * 读取对话的"已摘要到第几条"索引
   * @param {string} conversationId
   * @returns {number}
   */
  getLastSummarizedIndex(conversationId) {
    const entry = this.rollingSummaryCache.get(conversationId);
    if (!entry) return 0;
    if (Date.now() - entry.timestamp > SUMMARY_CACHE_TTL) {
      this.rollingSummaryCache.delete(conversationId);
      return 0;
    }
    return entry.lastSummarizedIndex || 0;
  }

  /**
   * 缓存滚动摘要
   * @param {string} conversationId
   * @param {string} summary
   * @param {number} lastSummarizedIndex - fullHistory 中已被摘要覆盖的最大索引
   */
  cacheRollingSummary(conversationId, summary, lastSummarizedIndex) {
    this.rollingSummaryCache.set(conversationId, {
      summary,
      lastSummarizedIndex,
      timestamp: Date.now(),
    });
    logger.debug('滚动摘要已缓存', {
      conversationId,
      lastSummarizedIndex,
      summaryTokens: estimateTokens(summary),
    });
  }

  /**
   * 调 LLM 把一批消息压缩成摘要
   * 如果有 existingSummary，告诉 LLM "在已有摘要基础上补充新信息"
   * @param {Array<{role: string, content: string}>} messages - 待摘要的消息批次
   * @param {string|null} existingSummary - 已有的滚动摘要（增量补充）
   * @returns {Promise<string|null>}
   */
  async _generateSummary(messages, existingSummary) {
    if (!this.llmManager) return null;
    if (!messages || messages.length === 0) return existingSummary || null;

    try {
      // 格式化待摘要消息（截断超长内容，控制 LLM 输入）
      const conversationText = messages
        .map((m) => {
          const role = m.role === 'user' ? '用户' : 'Agent';
          const content =
            typeof m.content === 'string' && m.content.length > SUMMARY_MSG_CHAR_LIMIT
              ? m.content.slice(0, SUMMARY_MSG_CHAR_LIMIT) + '...'
              : m.content || '';
          return `${role}: ${content}`;
        })
        .join('\n\n');

      let prompt;
      if (existingSummary) {
        // 增量摘要：在已有摘要基础上补充新信息
        prompt =
          `以下是已有的一段对话摘要，以及新产生的一批对话。请在已有摘要的基础上，整合新对话的关键信息，生成更新后的摘要。\n\n` +
          `要求：\n` +
          `1. 保留已有摘要中的关键信息（决策、结论、待办、人物、关键数据）\n` +
          `2. 补充新对话中出现的新信息\n` +
          `3. 去除重复内容，保持简洁\n` +
          `4. 使用要点列表格式，长度控制在 150-400 字\n` +
          `5. 只返回摘要文本，不要添加其他说明\n\n` +
          `【已有摘要】\n${existingSummary}\n\n` +
          `【新对话】\n${conversationText}`;
      } else {
        // 首次摘要
        prompt =
          `请为以下对话生成一个简洁的摘要。\n\n` +
          `要求：\n` +
          `1. 摘要应包含对话的主要话题、关键结论、决策和待办事项\n` +
          `2. 保留涉及的人物、关键数据、文件路径等技术细节\n` +
          `3. 长度控制在 100-300 字之间\n` +
          `4. 使用要点列表格式\n` +
          `5. 只返回摘要文本，不要添加其他说明\n\n` +
          `对话内容：\n${conversationText}`;
      }

      const result = await this._callLLM(prompt);
      return result;
    } catch (err) {
      logger.warn('滚动摘要 _generateSummary 失败', { error: err?.message });
      return null;
    }
  }

  /**
   * 合并旧摘要 + 新摘要
   * 如果合并后太长（超过 MAX_SUMMARY_TOKENS），再压缩一次
   * @param {string|null} oldSummary
   * @param {string|null} newSummary
   * @returns {Promise<string|null>}
   */
  async _mergeSummaries(oldSummary, newSummary) {
    // 两者都空
    if (!oldSummary && !newSummary) return null;
    // 只有一方：直接返回那一方
    if (!oldSummary) return newSummary;
    if (!newSummary) return oldSummary;

    // 简单拼接
    const merged = `${oldSummary}\n\n${newSummary}`;
    const mergedTokens = estimateTokens(merged);

    // 没超限：直接用拼接结果
    if (mergedTokens <= MAX_SUMMARY_TOKENS) {
      return merged;
    }

    // 超限：再压缩一次
    return await this._compressSummary(merged);
  }

  /**
   * 把过长的摘要再压缩成更精炼的摘要
   * @param {string} summary
   * @returns {Promise<string|null>}
   */
  async _compressSummary(summary) {
    if (!this.llmManager) return summary; // LLM 不可用就保留原样
    if (!summary) return summary;

    try {
      const prompt =
        `以下是一段过长的对话摘要，请把它压缩成更精炼的版本。\n\n` +
        `要求：\n` +
        `1. 保留所有关键信息（决策、结论、待办、人物、关键数据、文件路径）\n` +
        `2. 去除重复和次要细节\n` +
        `3. 长度控制在 200-400 字以内\n` +
        `4. 使用要点列表格式\n` +
        `5. 只返回摘要文本，不要添加其他说明\n\n` +
        `待压缩的摘要：\n${summary}`;

      const compressed = await this._callLLM(prompt);
      return compressed || summary; // 压缩失败则保留原样
    } catch (err) {
      logger.warn('摘要二次压缩失败，保留原摘要', { error: err?.message });
      return summary;
    }
  }

  /**
   * 调用 LLM（参考 memory-summarizer._callLLM）
   * @param {string} prompt
   * @returns {Promise<string|null>}
   */
  async _callLLM(prompt) {
    if (!this.llmManager) return null;

    try {
      const messages = [{ role: 'user', content: prompt }];
      const result = await this.llmManager.chat(messages, {
        model: SUMMARIZER_MODEL,
        temperature: 0.2,
        maxTokens: 1000,
      });
      return typeof result === 'string' ? result : result?.content || null;
    } catch (err) {
      logger.warn('history-manager LLM 调用失败', { error: err?.message });
      return null;
    }
  }

  /**
   * 加载指定页的历史消息
   * @param {Array<{role: string, content: string}>} fullHistory - 完整历史
   * @param {number} page - 页码（1 开始，1 = 最旧的一页之后）
   * @returns {HistoryPage}
   */
  loadHistoryPage(fullHistory, page) {
    const totalMessages = fullHistory.length;
    const totalPages = Math.ceil(totalMessages / PAGE_SIZE);

    // page 1 表示第二新的页（跳过最新页）
    const paginatedPage = page;

    if (paginatedPage >= totalPages) {
      return {
        pageIndex: page,
        startIndex: 0,
        endIndex: 0,
        messages: [],
        error: '已经是最早的历史了',
      };
    }

    const result = this.paginate(fullHistory, { page: paginatedPage });

    return {
      pageIndex: page,
      startIndex: result.startIndex,
      endIndex: result.endIndex,
      messages: result.messages,
      hasMoreHistory: result.hasMoreHistory,
      messageCount: result.messages.length,
    };
  }

  /**
   * 缓存页面摘要
   * @param {string} conversationId
   * @param {number} pageIndex
   * @param {string} summary
   */
  cacheSummary(conversationId, pageIndex, summary) {
    const key = `${conversationId}:${pageIndex}`;
    this.summaryCache.set(key, {
      summary,
      timestamp: Date.now(),
    });
    this.accessTime.set(key, Date.now());

    // 清理过期缓存
    this.cleanupCache();

    logger.debug('缓存页面摘要', { conversationId, pageIndex });
  }

  /**
   * 获取缓存的摘要
   * @param {string} conversationId
   * @param {number} pageIndex
   * @returns {string | null}
   */
  getCachedSummary(conversationId, pageIndex) {
    const key = `${conversationId}:${pageIndex}`;
    const cached = this.summaryCache.get(key);

    if (!cached) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - cached.timestamp > SUMMARY_CACHE_TTL) {
      this.summaryCache.delete(key);
      this.accessTime.delete(key);
      return null;
    }

    // 更新访问时间
    this.accessTime.set(key, Date.now());
    return cached.summary;
  }

  /**
   * 清理过期缓存（LRU 策略）
   */
  cleanupCache() {
    const now = Date.now();
    const maxCacheSize = 100;

    // 清理过期项
    for (const [key, cached] of this.summaryCache) {
      if (now - cached.timestamp > SUMMARY_CACHE_TTL) {
        this.summaryCache.delete(key);
        this.accessTime.delete(key);
      }
    }

    // 如果仍然超过限制，按 LRU 清理
    if (this.summaryCache.size > maxCacheSize) {
      const entries = Array.from(this.accessTime.entries());
      entries.sort((a, b) => a[1] - b[1]); // 按访问时间升序

      const toRemove = entries.slice(0, entries.length - maxCacheSize);
      for (const [key] of toRemove) {
        this.summaryCache.delete(key);
        this.accessTime.delete(key);
      }
    }
  }

  /**
   * 为 Agent 格式化消息历史
   * 返回格式化的字符串，包含分页信息
   * @param {Array<{role: string, content: string, senderId?: string}>} messages
   * @param {Object} options
   * @returns {string}
   */
  formatMessagesForAgent(messages, options = {}) {
    const { showTimestamp = false, showSender = true } = options;

    return messages
      .map((msg, index) => {
        const parts = [];

        // 消息序号
        parts.push(`[${index + 1}]`);

        // 发送者
        if (showSender && msg.senderId) {
          parts.push(`${msg.senderId}:`);
        } else {
          parts.push(`${msg.role}:`);
        }

        // 内容
        parts.push(msg.content);

        return parts.join(' ');
      })
      .join('\n\n');
  }

  /**
   * 构建用于 KV Cache 优化的消息序列
   * 保持前缀稳定，只变化尾部
   * @param {string} systemPrompt - 系统提示词
   * @param {string} historyInfo - 历史信息提示
   * @param {Array<{role: string, content: string}>} recentMessages - 最近消息
   * @param {string} currentMessage - 当前用户消息
   * @returns {Array<{role: string, content: string}>}
   */
  buildCacheOptimizedMessages(systemPrompt, historyInfo, recentMessages, currentMessage) {
    const messages = [];

    // 1. System prompt（固定前缀）
    let fullSystemPrompt = systemPrompt;

    // 2. 如果有历史信息，追加到 system prompt（保持前缀稳定）
    if (historyInfo) {
      fullSystemPrompt += `\n\n${historyInfo}`;
    }

    messages.push({ role: 'system', content: fullSystemPrompt });

    // 3. 历史消息（尽量保持稳定）
    for (const msg of recentMessages) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // 4. 当前用户消息
    messages.push({ role: 'user', content: currentMessage });

    return messages;
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      cachedSummaries: this.summaryCache.size,
      rollingSummaries: this.rollingSummaryCache.size,
      pageSize: PAGE_SIZE,
    };
  }

  /**
   * 重新初始化（公司切换时调用）
   * 清空所有缓存（含滚动摘要缓存）
   */
  reinitialize() {
    this.summaryCache.clear();
    this.accessTime.clear();
    this.rollingSummaryCache.clear();
    logger.debug('HistoryManager: 缓存已清空（含滚动摘要）');
  }

  /**
   * 清理指定对话的缓存（对话删除时调用）
   * @param {string} conversationId
   */
  clearConversationCache(conversationId) {
    const prefix = `${conversationId}:`;
    for (const key of this.summaryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.summaryCache.delete(key);
        this.accessTime.delete(key);
      }
    }
    // 清理滚动摘要缓存
    this.rollingSummaryCache.delete(conversationId);
    logger.debug('HistoryManager: 已清理对话缓存（含滚动摘要）', { conversationId });
  }
}

// 单例
const historyManager = new HistoryManager();

module.exports = {
  HistoryManager,
  historyManager,
  PAGE_SIZE,
  SUMMARY_BATCH_SIZE,
  MAX_SUMMARY_TOKENS,
};
