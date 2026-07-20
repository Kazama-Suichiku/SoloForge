/**
 * SoloForge - 记忆检索器
 *
 * 阶段一C 重构：从纯关键词 n-gram 检索升级为混合检索
 *   路径 A：query → embedding → vectorIndex.search(k=50) → 语义召回
 *   路径 B：query → FTS5 BM25 → top-50 → 关键词召回
 *   路径 C：query keywords → memory_tags 精确匹配 → tag 召回
 *   融合：RRF（Reciprocal Rank Fusion, k=60）
 *   Rerank：保留原 importance/frequency/recency 权重作为 RRF 后排序微调
 *
 * 降级策略（任一路径失败不阻塞）：
 *   - embedding/vector-index 模块不存在或 embed 失败 → 跳过向量路径
 *   - FTS5 不可用或查询无命中 → 跳过 FTS 路径
 *   - tag 无匹配 → 跳过 tag 路径
 *   - 三路全空且未指定 type → 回退到 getRecent
 *   - 三路全空且指定 type → 返回空数组（不崩）
 *
 * recall() 已改为 async，调用方需 await。
 *
 * @module memory/memory-retriever
 */

'use strict';

const { logger } = require('../utils/logger');
const { memoryStore } = require('./memory-store');
const { memoryDecay } = require('./memory-decay');
// 阶段 3-A：标签共现图（路径C tag 扩展召回）
const { tagCooccurrence } = require('./tag-cooccurrence');
const {
  MEMORY_CONFIG,
  MEMORY_TYPE_LABELS,
  STOP_WORDS,
} = require('./memory-types');

// 检索权重配置（用于 RRF 后 rerank 微调，保留原语义）
const WEIGHTS = {
  KEYWORD: 0.40,    // 关键词匹配权重
  RECENCY: 0.20,    // 时间衰减权重
  IMPORTANCE: 0.25,  // 重要性权重
  ACCESS: 0.15,      // 访问频率权重
};

// 时间衰减系数（用于 recencyScore）
const RECENCY_LAMBDA = 0.05;

// 每路召回的候选数量上限
const RECALL_K = 50;
// RRF（Reciprocal Rank Fusion）常数，越大对排名靠后项越平滑
const RRF_K = 60;
// RRF 微调项在最终排序中的权重（其余靠 RRF 主分数）
const RERANK_WEIGHT = 0.15;

/**
 * 记忆检索器
 */
class MemoryRetriever {
  constructor() {}

  // ═══════════════════════════════════════════════════════════
  // 关键词提取（保留，供 tag 路径使用）
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
  // 评分计算（保留，用于 RRF 后 rerank 微调）
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
   * 计算记忆的综合相关性分数（RRF 后 rerank 微调用）
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
  // 混合检索主入口
  // ═══════════════════════════════════════════════════════════

  /**
   * 按语义检索相关记忆（向量 + BM25 + tag → RRF 融合）
   *
   * 三路召回 + RRF 融合 + rerank 微调 + agent/scope/type 过滤。
   * 降级：任一路径失败均不阻塞；embedding/vector 模块不存在时自动跳过。
   *
   * @param {string} query - 查询文本
   * @param {Object} [options]
   * @param {string} [options.agentId] - Agent ID（用于范围过滤）
   * @param {number} [options.limit] - 返回数量
   * @param {string} [options.type] - 限定类型
   * @returns {Promise<Object[]>} 检索到的记忆条目（带 score 字段）
   */
  async recall(query, options = {}) {
    const { agentId, limit = MEMORY_CONFIG.DEFAULT_RECALL_LIMIT, type } = options;
    const now = Date.now();

    // 提取关键词（tag 路径 + rerank 用）
    const keywords = this.extractKeywords(query);

    // 空查询且无 type 约束 → 回退到最近记忆（保持原行为）
    if (!query && !type) {
      const recent = memoryStore.getRecent(limit, agentId ? { agentId } : {});
      return this._withEpisodeId(recent);
    }
    if (!query && type) {
      // 有 type 但无 query：无法走三路召回，返回该类型最近记忆
      const all = memoryStore.query({ type, agentId, includeArchived: false });
      all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const sliced = all.slice(0, limit);
      return this._withEpisodeId(sliced);
    }

    // ─── 路径 A：向量语义召回 ─────────────────────────────────
    let vectorResults = [];
    try {
      // 延迟 require：embedding-service / vector-index 在阶段 1-B 落地
      // 1-B 导出独立函数（非单例对象），直接用 vectorMod.search
      const embeddingMod = require('./embedding-service');
      const vectorMod = require('./vector-index');
      const embed = embeddingMod.embed;
      const vectorSearch = vectorMod.search;
      if (typeof embed === 'function' && typeof vectorSearch === 'function') {
        const queryEmb = await embed(query);
        if (queryEmb && Array.isArray(queryEmb) && queryEmb.length > 0) {
          const hits = vectorSearch(queryEmb, RECALL_K);
          if (Array.isArray(hits)) {
            vectorResults = hits
              .map((h) => ({
                id: h.id,
                score: typeof h.distance === 'number' ? (1 - h.distance) : (h.score || 0),
                source: 'vector',
              }))
              .filter((h) => h.id);
          }
        }
      }
    } catch (e) {
      logger.debug('向量召回路径跳过（降级）', { reason: e.message });
    }

    // ─── 路径 B：FTS5 BM25 召回 ───────────────────────────────
    let ftsResults = [];
    try {
      const ftsOpts = { limit: RECALL_K };
      // 不在此处按 agent/type 过滤，RRF 后统一过滤，避免漏召
      const rows = memoryStore.searchFTS(query, ftsOpts);
      if (Array.isArray(rows)) {
        ftsResults = rows
          .map((r) => ({
            id: r.id,
            // searchFTS 已按 BM25 rank 排序，但返回对象无 rank 字段；
            // RRF 用数组下标作为 rank 即可，score 仅作调试标记
            score: typeof r.rank === 'number' ? r.rank : 0,
            source: 'fts',
          }))
          .filter((r) => r.id);
      }
    } catch (e) {
      logger.debug('FTS 召回路径跳过（降级）', { reason: e.message });
    }

    // ─── 路径 C：tag 精确匹配召回 + 共现扩展（阶段 3-A）─────────
    // 1. 用 query 提取的核心 keywords 精确匹配 memory_tags
    // 2. 通过标签共现图扩展关联 tags（top-4），再 searchByTags 拉回更多记忆
    // 3. 合并两批结果（按 id 去重，核心命中优先）
    let tagResults = [];
    if (keywords.length > 0) {
      try {
        // C-1：核心 tag 精确召回
        // searchByTags 不支持 limit 参数，slice 截取
        const coreRows = memoryStore.searchByTags(keywords, { includeArchived: false });
        const seenIds = new Set();
        if (Array.isArray(coreRows)) {
          tagResults = coreRows
            .slice(0, RECALL_K)
            .map((r) => ({ id: r.id, score: 0.5, source: 'tag' }))
            .filter((r) => {
              if (!r.id || seenIds.has(r.id)) return false;
              seenIds.add(r.id);
              return true;
            });
        }

        // C-2：标签共现图扩展召回
        // 从核心 keywords 通过共现矩阵拉回关联 tags（top maxExpand），
        // 对扩展 tags 再做一次 searchByTags，合并新结果。
        // 失败静默降级：共现图缺失/为空时退化为纯核心 tag 召回。
        try {
          const expandedTags = tagCooccurrence.expandTags(keywords, 4);
          if (Array.isArray(expandedTags) && expandedTags.length > 0) {
            // 合并核心 + 扩展去重后查询，避免重复走 DB
            const allQueryTags = [...new Set([...keywords, ...expandedTags])];
            const expandedRows = memoryStore.searchByTags(allQueryTags, {
              includeArchived: false,
            });
            if (Array.isArray(expandedRows)) {
              for (const r of expandedRows.slice(0, RECALL_K)) {
                if (!r.id || seenIds.has(r.id)) continue;
                seenIds.add(r.id);
                // 扩展召回的条目给略低的初始分，区分核心/共现命中
                tagResults.push({ id: r.id, score: 0.35, source: 'tag-expanded' });
              }
            }
            logger.debug('标签共现扩展召回', {
              coreTags: keywords,
              expandedTags,
              expandedHits: tagResults.length - coreRows.length,
            });
          }
        } catch (expandErr) {
          // 共现扩展失败不影响核心 tag 召回
          logger.debug('标签共现扩展失败（降级为核心 tag 召回）', {
            reason: expandErr.message,
          });
        }
      } catch (e) {
        logger.debug('tag 召回路径跳过（降级）', { reason: e.message });
      }
    }

    // ─── RRF 融合 ────────────────────────────────────────────
    const rrf = (results, k = RRF_K) => {
      const scores = new Map();
      for (let i = 0; i < results.length; i++) {
        const rank = i + 1; // 1-indexed rank
        const contribution = 1 / (k + rank);
        const id = results[i].id;
        scores.set(id, (scores.get(id) || 0) + contribution);
      }
      return scores;
    };

    const vectorScores = rrf(vectorResults);
    const ftsScores = rrf(ftsResults);
    const tagScores = rrf(tagResults);

    // 合并所有 id
    const allIds = new Set([
      ...vectorScores.keys(),
      ...ftsScores.keys(),
      ...tagScores.keys(),
    ]);

    const fused = [];
    for (const id of allIds) {
      const totalScore =
        (vectorScores.get(id) || 0) +
        (ftsScores.get(id) || 0) +
        (tagScores.get(id) || 0);
      fused.push({ id, score: totalScore });
    }

    // ─── agent/scope/type 过滤 + 剔除 archived/superseded ───
    const filtered = fused.filter((item) => {
      const entry = memoryStore.get(item.id);
      if (!entry) return false;
      if (type && entry.type !== type) return false;
      if (agentId) {
        // agent 专属必须归属本人；shared/user 全局可见
        if (entry.scope === 'agent' && entry.agentId !== agentId) return false;
        // 其它 scope（如纯私有）非 agent 范围则排除
        if (entry.scope !== 'shared' && entry.scope !== 'user' && entry.scope !== 'agent') return false;
      }
      if (entry.archived || entry.supersededBy) return false;
      return true;
    });

    // ─── Rerank：用 importance/frequency/recency 微调 ───────
    // 在 RRF 主分数基础上叠加一个小的 rerank 项，保留原排序信号
    const reranked = filtered.map((item) => {
      const entry = memoryStore.get(item.id);
      const rerank = entry ? this.calculateScore(keywords, entry, now) : 0;
      return { ...item, rrfScore: item.score, finalScore: item.score + RERANK_WEIGHT * rerank };
    });

    // 按 finalScore 降序
    reranked.sort((a, b) => b.finalScore - a.finalScore);

    // 截取 Top-N
    const topN = reranked.slice(0, limit);

    // ─── 取完整 entry + 回填 score ───────────────────────────
    const result = [];
    for (const item of topN) {
      const entry = memoryStore.get(item.id);
      if (!entry) continue;
      entry.score = item.finalScore;
      // 阶段 3-B：溯源下钻 —— 在检索结果里显式附带 source_episode_id
      // 调用方拿到后可直接 commEventStore.getEventById(sourceEpisodeId) 下钻原始通信。
      // entry 来自 sqlite-store._rowToEntry，已含 sourceEpisodeId；此处兜底补一次
      // （兼容 JSON 迁移期旧数据 / 非门户路径返回的条目）。
      if (!('sourceEpisodeId' in entry)) {
        try {
          entry.sourceEpisodeId = memoryStore.getEpisodeId(item.id) || null;
        } catch (_e) {
          entry.sourceEpisodeId = null;
        }
      }
      result.push(entry);
    }

    // ─── 批量强化（更新访问记录）─────────────────────────────
    if (result.length > 0) {
      try {
        memoryDecay.batchReinforce(result.map((e) => e.id));
      } catch (e) {
        logger.debug('batchReinforce 失败（不影响检索）', { reason: e.message });
      }
    }

    logger.debug('混合检索完成', {
      query: query.slice(0, 50),
      keywords: keywords.slice(0, 10),
      vectorHits: vectorResults.length,
      ftsHits: ftsResults.length,
      tagHits: tagResults.length,
      fused: fused.length,
      returned: result.length,
      topScore: result[0]?.score?.toFixed(3),
    });

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // 溯源下钻辅助（阶段 3-B）
  // ═══════════════════════════════════════════════════════════

  /**
   * 给一组记忆条目（完整 MemoryEntry 或轻量 IndexEntry）附带 source_episode_id。
   *
   * 主召回路径（recall 三路融合）的 entry 来自 memoryStore.get()，已含
   * sourceEpisodeId（sqlite-store._rowToEntry 还原）；但回退路径（getRecent /
   * query）返回的是 IndexEntry，不含该字段。本方法统一兜底：对缺失
   * sourceEpisodeId 的条目，按 id 调 memoryStore.getEpisodeId() 补上，
   * 让调用方无论走哪条路径都能拿到 episode_id 下钻原始通信。
   *
   * @param {Object[]} entries
   * @returns {Object[]} 原数组（就地补字段后返回，便于链式）
   * @private
   */
  _withEpisodeId(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return entries;
    for (const entry of entries) {
      if (!entry || 'sourceEpisodeId' in entry) continue;
      try {
        entry.sourceEpisodeId = memoryStore.getEpisodeId(entry.id) || null;
      } catch (_e) {
        entry.sourceEpisodeId = null;
      }
    }
    return entries;
  }

  // ═══════════════════════════════════════════════════════════
  // 上下文注入
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取 Agent 上下文注入文本
   * 将检索到的记忆格式化为可注入到对话中的文本
   *
   * recall() 已改为 async，本方法相应改为 async，调用方需 await。
   *
   * @param {string} agentId
   * @param {string} message - 当前用户消息
   * @param {string} [conversationId]
   * @returns {Promise<string|null>}
   */
  async getContextForAgent(agentId, message, conversationId) {
    // 检索相关记忆（await）
    const memories = await this.recall(message, {
      agentId,
      limit: MEMORY_CONFIG.DEFAULT_RECALL_LIMIT,
    });

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