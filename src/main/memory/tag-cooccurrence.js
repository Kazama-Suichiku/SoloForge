/**
 * SoloForge - 标签共现图（阶段三A）
 *
 * VCP 浪潮算法轻量子集：用 SQLite 的 tag_pairs 表维护标签两两共现计数，
 * 在记忆写入时增量更新，在检索时从 query 命中的核心 tags 通过共现矩阵
 * 拉回关联 tags（top-N），扩展 tag 路径的召回面。
 *
 * 设计要点：
 * - 共现统计以 (tag_a, tag_b) 为唯一键，约定 tag_a < tag_b（字典序）保证
 *   无向边只存一行，避免 (a,b) 与 (b,a) 重复。
 * - updateOnAdd 在 memory-store.add()/addMultiple() 成功后调用，对 entry.tags
 *   去重后两两组合 upsert，count + 1。
 * - expandTags 在 memory-retriever.recall() 路径C调用：对每个核心 tag 查其
 *   所有共现对，累加关联 tag 的共现次数，按次数降序取 top maxExpand。
 * - 标签大小写：与 memory_tags 存储一致（保留原大小写），检索时由
 *   searchByTags 的 LOWER() 兜底；expandTags 跳过输入 tag 时用大小写不敏感
 *   比较，避免返回本质相同的 tag。
 * - 全部操作失败均静默降级：共现图缺失时检索退化为原始 keywords，不影响主流程。
 *
 * @module memory/tag-cooccurrence
 */

'use strict';

const { sqliteStore } = require('./sqlite-store');
const { logger } = require('../utils/logger');

/**
 * 标签共现图
 */
class TagCooccurrence {
  /**
   * 记忆写入时更新共现统计。
   * 对 tags 两两组合（tag_a < tag_b 保证唯一），upsert 到 tag_pairs，count + 1。
   * @param {string[]|null|undefined} tags 该条记忆的标签数组
   */
  updateOnAdd(tags) {
    if (!Array.isArray(tags) || tags.length < 2) return;
    // 去重 + 去空 + 归一为字符串
    const unique = [
      ...new Set(tags.map((t) => String(t)).filter((t) => t.length > 0)),
    ];
    if (unique.length < 2) return;

    try {
      for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
          // 约定 tag_a < tag_b（字典序），保证无向边唯一
          const [a, b] =
            unique[i] < unique[j] ? [unique[i], unique[j]] : [unique[j], unique[i]];
          sqliteStore.upsertTagPair(a, b);
        }
      }
    } catch (error) {
      // 共现更新失败不影响记忆存储主流程
      logger.debug('更新标签共现统计失败（不影响存储）', {
        tagCount: unique.length,
        error: error.message,
      });
    }
  }

  /**
   * 检索时：从核心 tags 通过共现矩阵拉回关联 tags。
   * 对每个核心 tag 查其所有共现对，累加关联 tag 的共现次数，
   * 按共现次数降序取 top maxExpand，返回关联 tag 名称数组（不含输入 tag）。
   *
   * @param {string[]} tags query 命中的核心 tags
   * @param {number} [maxExpand=4] 最多扩展的关联 tag 数量
   * @returns {string[]} 关联 tag 名称（按共现次数降序）
   */
  expandTags(tags, maxExpand = 4) {
    if (!Array.isArray(tags) || tags.length === 0) return [];
    // 输入 tag 集合（小写，用于跳过本质相同的 tag）
    const lowerTags = new Set(
      tags.map((t) => String(t).toLowerCase()).filter((t) => t.length > 0)
    );
    if (lowerTags.size === 0) return [];

    // otherTag -> 累计共现次数
    const related = new Map();

    for (const tag of tags) {
      const t = String(tag);
      if (!t) continue;
      let pairs = [];
      try {
        pairs = sqliteStore.getTagPairs(t);
      } catch (error) {
        // 单个 tag 查询失败跳过，继续处理其它
        logger.debug('查询标签共现对失败（跳过该 tag）', {
          tag: t,
          error: error.message,
        });
        continue;
      }
      if (!Array.isArray(pairs)) continue;
      for (const pair of pairs) {
        const otherTag = pair && pair.otherTag;
        const count = (pair && pair.count) || 0;
        if (!otherTag) continue;
        // 跳过已在输入中的 tag（大小写不敏感）
        if (lowerTags.has(String(otherTag).toLowerCase())) continue;
        const key = String(otherTag);
        related.set(key, (related.get(key) || 0) + count);
      }
    }

    if (related.size === 0) return [];

    // 按共现次数降序，取 top maxExpand，仅返回 tag 名称
    return [...related.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxExpand)
      .map(([t]) => t);
  }
}

// 单例
const tagCooccurrence = new TagCooccurrence();

module.exports = { TagCooccurrence, tagCooccurrence };
