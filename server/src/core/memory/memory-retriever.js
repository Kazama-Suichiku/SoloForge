/**
 * SoloForge Mobile - 记忆检索器
 * 关键词匹配 + 加权排序，无 LLM 依赖
 * @module memory/memory-retriever
 */

const { logger } = require('../../utils/logger');
const { memoryStore } = require('./memory-store');
const { memoryDecay } = require('./memory-decay');
const {
  MEMORY_CONFIG,
  MEMORY_TYPE_LABELS,
  STOP_WORDS,
} = require('./memory-types');

const WEIGHTS = {
  KEYWORD: 0.40,
  RECENCY: 0.20,
  IMPORTANCE: 0.25,
  ACCESS: 0.15,
};

const RECENCY_LAMBDA = 0.05;

class MemoryRetriever {
  extractKeywords(text) {
    if (!text) return [];

    const cleaned = text
      .replace(/[【】\[\]{}()<>（）「」『』""''""]/g, ' ')
      .replace(/[，。！？、；：…—·\-_=+*#@$%^&~`|/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    const words = [];
    const englishWords = cleaned.match(/[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*/g) || [];
    words.push(...englishWords);

    const chineseChars = cleaned.match(/[\u4e00-\u9fff]+/g) || [];
    for (const segment of chineseChars) {
      if (segment.length <= 4) {
        words.push(segment);
      } else {
        for (let i = 0; i < segment.length - 1; i++) {
          words.push(segment.slice(i, i + 2));
          if (i < segment.length - 2) {
            words.push(segment.slice(i, i + 3));
          }
        }
      }
    }

    const filtered = [...new Set(words.filter((w) => w.length > 1 && !STOP_WORDS.has(w)))];
    return filtered;
  }

  _keywordScore(queryKeywords, indexEntry) {
    if (queryKeywords.length === 0) return 0;

    let score = 0;
    const entryTags = (indexEntry.tags || []).map((t) => t.toLowerCase());
    const summaryLower = (indexEntry.summary || '').toLowerCase();

    for (const kw of queryKeywords) {
      if (entryTags.includes(kw)) score += 0.3;
      if (summaryLower.includes(kw)) score += 0.1;
    }

    const maxPossible = queryKeywords.length * 0.4;
    return Math.min(1.0, score / Math.max(1, maxPossible));
  }

  _recencyScore(indexEntry, now) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysSinceCreated = (now - (indexEntry.createdAt || now)) / msPerDay;
    return Math.exp(-RECENCY_LAMBDA * daysSinceCreated);
  }

  _importanceScore(indexEntry) {
    return indexEntry.importance || 0.5;
  }

  _accessScore(indexEntry) {
    return Math.min(1.0, (indexEntry.accessCount || 0) / 10);
  }

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

  recall(query, options = {}) {
    const { agentId, limit = MEMORY_CONFIG.DEFAULT_RECALL_LIMIT, type } = options;
    const now = Date.now();

    const keywords = this.extractKeywords(query);
    if (keywords.length === 0 && !type) {
      const filter = agentId ? { agentId } : {};
      return memoryStore.getRecent(limit, filter);
    }

    let candidates;
    if (agentId) {
      candidates = memoryStore.queryForAgent(agentId);
    } else {
      candidates = memoryStore.query({ includeArchived: false });
    }

    if (type) {
      candidates = candidates.filter((c) => c.type === type);
    }

    const scored = candidates.map((entry) => ({
      ...entry,
      score: this.calculateScore(keywords, entry, now),
    }));

    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, limit);

    if (topK.length > 0) {
      memoryDecay.batchReinforce(topK.map((e) => e.id));
    }

    logger.debug('记忆检索完成', {
      query: query.slice(0, 50),
      keywords: keywords.slice(0, 10),
      candidates: candidates.length,
      returned: topK.length,
    });

    return topK;
  }

  getContextForAgent(agentId, message) {
    const memories = this.recall(message, { agentId, limit: MEMORY_CONFIG.DEFAULT_RECALL_LIMIT });

    if (memories.length === 0) return null;

    const maxChars = Math.floor(MEMORY_CONFIG.MAX_INJECT_TOKENS / 1.5);
    let totalChars = 0;
    const selected = [];

    for (const mem of memories) {
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

  _formatMemoryLine(memoryEntry) {
    const typeLabel = MEMORY_TYPE_LABELS[memoryEntry.type] || memoryEntry.type;
    const timeAgo = this._timeAgo(memoryEntry.createdAt);
    const importanceLabel = memoryEntry.importance >= 0.8 ? '重要' :
      memoryEntry.importance >= 0.6 ? '中等' : '一般';
    return `[${typeLabel}] ${memoryEntry.summary} (${timeAgo}, ${importanceLabel})`;
  }

  _timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
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

const memoryRetriever = new MemoryRetriever();

module.exports = { MemoryRetriever, memoryRetriever };
