/**
 * SoloForge - 记忆检索器
 * 根据当前上下文检索最相关的记忆，使用加权混合排序
 * @module memory/memory-retriever
 */

const { logger } = require('../utils/logger');
const { memoryStore } = require('./memory-store');
const { memoryDecay } = require('./memory-decay');
const {
  MEMORY_CONFIG,
  MEMORY_TYPE_LABELS,
  STOP_WORDS,
} = require('./memory-types');

// 检索权重配置
const WEIGHTS = {
  KEYWORD: 0.40,    // 关键词匹配权重
  RECENCY: 0.20,    // 时间衰减权重
  IMPORTANCE: 0.25,  // 重要性权重
  ACCESS: 0.15,      // 访问频率权重
};

// 时间衰减系数（用于 recencyScore）
const RECENCY_LAMBDA = 0.05;

/**
 * 记忆检索器
 */
class MemoryRetriever {
  constructor() {}

  // ═══════════════════════════════════════════════════════════
  // 关键词提取
  // ═══════════════════════════════════════════════════════════

  /**
   * 从文本中提取关键词
   * @param {string} text
   * @returns {string[]}
   */
  extractKeywords(text) {
    if (!text) return [];

    // 清理特殊字符
    const cleaned = text
      .replace(/[【】\[\]{}()<>（）「」『』""''""]/g, ' ')
      .replace(/[，。！？、；：…—·\-_=+*#@$%^&~`|/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    // 分词（简单的空格 + 中文字符分词）
    const words = [];

    // 英文单词
    const englishWords = cleaned.match(/[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*/g) || [];
    words.push(...englishWords);

    // 中文词（按 2-4 字窗口提取，简易 n-gram）
    const chineseChars = cleaned.match(/[\u4e00-\u9fff]+/g) || [];
    for (const segment of chineseChars) {
      if (segment.length <= 4) {
        words.push(segment);
      } else {
        // 滑动窗口提取 2-3 字词
        for (let i = 0; i < segment.length - 1; i++) {
          words.push(segment.slice(i, i + 2));
          if (i < segment.length - 2) {
            words.push(segment.slice(i, i + 3));
          }
        }
      }
    }

    // 去停用词，去重
    const filtered = [...new Set(words.filter((w) => w.length > 1 && !STOP_WORDS.has(w)))];

    return filtered;
  }

  // ═══════════════════════════════════════════════════════════
  // 评分计算
  // ═══════════════════════════════════════════════════════════

  /**
   * 计算关键词匹配分数
   * @param {string[]} queryKeywords - 查询关键词
   * @param {Object} indexEntry - 索引条目
   * @returns {number} 0-1
   */
  _keywordScore(queryKeywords, indexEntry) {
    if (queryKeywords.length === 0) return 0;

    let score = 0;
    const entryTags = (indexEntry.tags || []).map((t) => t.toLowerCase());
    const summaryLower = (indexEntry.summary || '').toLowerCase();

    for (const kw of queryKeywords) {
      // 标签精确匹配：每命中一个 +0.3
      if (entryTags.includes(kw)) {
        score += 0.3;
      }
      // 摘要包含匹配：每命中一个 +0.1
      if (summaryLower.includes(kw)) {
        score += 0.1;
      }
    }

    // 归一化到 0-1
    const maxPossible = queryKeywords.length * 0.4; // 最大可能分数
    return Math.min(1.0, score / Math.max(1, maxPossible));
  }

  /**
   * 计算时间衰减分数
   * @param {Object} indexEntry
   * @param {number} now
   * @returns {number} 0-1
   */
  _recencyScore(indexEntry, now) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysSinceCreated = (now - (indexEntry.createdAt || now)) / msPerDay;
    return Math.exp(-RECENCY_LAMBDA * daysSinceCreated);
  }

  /**
   * 计算重要性分数
   * @param {Object} indexEntry
   * @returns {number} 0-1
   */
  _importanceScore(indexEntry) {
    return indexEntry.importance || 0.5;
  }

  /**
   * 计算访问频率分数
   * @param {Object} indexEntry
   * @returns {number} 0-1
   */
  _accessScore(indexEntry) {
    return Math.min(1.0, (indexEntry.accessCount || 0) / 10);
  }

  /**
   * 计算记忆的综合相关性分数
   * @param {string[]} queryKeywords
   * @param {Object} indexEntry
   * @param {number} now
   * @returns {number}
   */
  calculateScore(queryKeywords, indexEntry, now) {
    const kw = this._keywordScore(queryKeywords, indexEntry);
    const rec = this._recencyScore(indexEntry, now);
    const imp = this._importanceScore(indexEntry);
    const acc = this._accessScore(indexEntry);

    return WEIGHTS.KEYWORD * kw
      + WEIGHTS.RECENCY * rec
      + WEIGHTS.IMPORTANCE * imp
      + WEIGHTS.ACCESS * acc;
  }

  // ═══════════════════════════════════════════════════════════
  // 检索主入口
  // ═══════════════════════════════════════════════════════════

  /**
   * 按语义检索相关记忆
   * @param {string} query - 查询文本
   * @param {Object} [options]
   * @param {string} [options.agentId] - Agent ID
   * @param {number} [options.limit] - 返回数量
   * @param {string} [options.type] - 限定类型
   * @returns {Object[]} 检索到的索引条目（带 score 字段）
   */
  recall(query, options = {}) {
    const { agentId, limit = MEMORY_CONFIG.DEFAULT_RECALL_LIMIT, type } = options;
    const now = Date.now();

    // 1. 提取查询关键词
    const keywords = this.extractKeywords(query);
    if (keywords.length === 0 && !type) {
      // 没有有效关键词且没有指定类型，返回最近的记忆
      return memoryStore.getRecent(limit, agentId ? { agentId } : {});
    }

    // 2. 获取候选记忆
    let candidates;
    if (agentId) {
      candidates = memoryStore.queryForAgent(agentId);
    } else {
      candidates = memoryStore.query({ includeArchived: false });
    }

    // 按类型过滤
    if (type) {
      candidates = candidates.filter((c) => c.type === type);
    }

    // 3. 计算每条候选的综合分数
    const scored = candidates.map((entry) => ({
      ...entry,
      score: this.calculateScore(keywords, entry, now),
    }));

    // 4. 按分数降序排列
    scored.sort((a, b) => b.score - a.score);

    // 5. 取 Top-K
    const topK = scored.slice(0, limit);

    // 6. 批量强化（更新访问记录）
    if (topK.length > 0) {
      memoryDecay.batchReinforce(topK.map((e) => e.id));
    }

    logger.debug('记忆检索完成', {
      query: query.slice(0, 50),
      keywords: keywords.slice(0, 10),
      candidates: candidates.length,
      returned: topK.length,
      topScore: topK[0]?.score?.toFixed(3),
    });

    return topK;
  }

  // ═══════════════════════════════════════════════════════════
  // 上下文注入
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取 Agent 上下文注入文本
   * 将检索到的记忆格式化为可注入到对话中的文本
   * @param {string} agentId
   * @param {string} message - 当前用户消息
   * @param {string} [conversationId]
   * @returns {string|null}
   */
  getContextForAgent(agentId, message, conversationId) {
    // 检索相关记忆
    const memories = this.recall(message, { agentId, limit: MEMORY_CONFIG.DEFAULT_RECALL_LIMIT });

    if (memories.length === 0) return null;

    // Token 预算控制：估算注入文本长度
    const maxChars = Math.floor(MEMORY_CONFIG.MAX_INJECT_TOKENS / 1.5); // 粗略估算
    let totalChars = 0;
    const selected = [];

    for (const mem of memories) {
      // 高重要性记忆注入完整 content，其余只注入 summary
      const useFullContent = mem.importance >= 0.7;
      const text = useFullContent ? mem.summary : mem.summary;
      // 即使是高重要性，为了 token 效率，也只注入 summary
      // 完整 content 可通过 memory_recall 工具获取
      const entryText = this._formatMemoryLine(mem);

      if (totalChars + entryText.length > maxChars) break;

      selected.push(entryText);
      totalChars += entryText.length;
    }

    if (selected.length === 0) return null;

    const lines = [
      '【相关记忆】',
      ...selected.map((text, i) => `${i + 1}. ${text}`),
      '如需搜索更多记忆，使用 memory_search 或 memory_recall 工具。',
    ];

    return lines.join('\n');
  }

  /**
   * 格式化单条记忆为注入文本
   * @param {Object} memoryEntry - 索引条目
   * @returns {string}
   */
  _formatMemoryLine(memoryEntry) {
    const typeLabel = MEMORY_TYPE_LABELS[memoryEntry.type] || memoryEntry.type;
    const timeAgo = this._timeAgo(memoryEntry.createdAt);
    const importanceLabel = memoryEntry.importance >= 0.8 ? '重要' :
      memoryEntry.importance >= 0.6 ? '中等' : '一般';

    return `[${typeLabel}] ${memoryEntry.summary} (${timeAgo}, ${importanceLabel})`;
  }

  /**
   * 计算友好的时间描述
   * @param {number} timestamp
   * @returns {string}
   */
  _timeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);

    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    if (weeks < 4) return `${weeks}周前`;
    return `${months}月前`;
  }
}

// 单例
const memoryRetriever = new MemoryRetriever();

module.exports = { MemoryRetriever, memoryRetriever };
