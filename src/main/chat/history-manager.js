/**
 * SoloForge - 历史消息管理器
 * 实现消息分页、摘要缓存，优化 KV Cache 利用率
 * @module chat/history-manager
 */

const { logger } = require('../utils/logger');
const { estimateTokens } = require('../llm/token-estimator');

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
      pageSize: PAGE_SIZE,
    };
  }

  /**
   * 重新初始化（公司切换时调用）
   * 清空所有缓存
   */
  reinitialize() {
    this.summaryCache.clear();
    this.accessTime.clear();
    logger.debug('HistoryManager: 缓存已清空');
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
    logger.debug('HistoryManager: 已清理对话缓存', { conversationId });
  }
}

// 单例
const historyManager = new HistoryManager();

module.exports = {
  HistoryManager,
  historyManager,
  PAGE_SIZE,
};
