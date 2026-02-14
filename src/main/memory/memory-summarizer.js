/**
 * SoloForge - 记忆总结器
 * 对话摘要生成、短期->长期归档、相似记忆合并
 * @module memory/memory-summarizer
 */

const { logger } = require('../utils/logger');
const { memoryStore } = require('./memory-store');
const {
  MEMORY_TYPES,
  MEMORY_SOURCE,
  MEMORY_CONFIG,
  SHORT_TERM_TYPES,
  createMemoryEntry,
} = require('./memory-types');

// ═══════════════════════════════════════════════════════════
// 总结 Prompt 模板
// ═══════════════════════════════════════════════════════════

const CONVERSATION_SUMMARY_PROMPT = `请为以下对话生成一个简洁的摘要。

要求：
1. 摘要应包含对话的主要话题、关键结论和待办事项
2. 长度控制在 100-300 字之间
3. 使用要点列表格式
4. 只返回摘要文本，不要添加其他说明

对话内容：
`;

const MERGE_PROMPT = `以下是多条相似的记忆条目，请将它们合并为一条更全面的记忆。

要求：
1. 保留所有不同的信息点
2. 去除重复内容
3. content: 合并后的详细描述（100-300字）
4. summary: 一句话摘要（不超过 50 字）
5. tags: 合并所有标签并去重
6. importance: 取最高值
7. 返回 JSON 对象（不要包裹在 markdown 代码块中）

记忆条目：
`;

/**
 * 记忆总结器
 */
class MemorySummarizer {
  constructor() {
    /** @type {import('../llm/llm-manager').LLMManager|null} */
    this.llmManager = null;
  }

  /**
   * 设置 LLM Manager
   * @param {import('../llm/llm-manager').LLMManager} llmManager
   */
  setLLMManager(llmManager) {
    this.llmManager = llmManager;
  }

  // ═══════════════════════════════════════════════════════════
  // 对话摘要
  // ═══════════════════════════════════════════════════════════

  /**
   * 为对话生成摘要并存储
   * @param {string} conversationId
   * @param {string} agentId
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Promise<{success: boolean, id?: string}>}
   */
  async summarizeConversation(conversationId, agentId, messages) {
    if (!this.llmManager) {
      return { success: false, error: 'LLM Manager 未设置' };
    }

    if (!messages || messages.length < MEMORY_CONFIG.MIN_MESSAGES_FOR_EXTRACTION) {
      return { success: false, error: '消息数量不足' };
    }

    try {
      // 格式化对话
      const conversationText = messages
        .slice(-30) // 最多取最近 30 条
        .map((m) => {
          const role = m.role === 'user' ? '用户' : 'Agent';
          const content = m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content;
          return `${role}: ${content}`;
        })
        .join('\n\n');

      // 调用 LLM 生成摘要
      const prompt = CONVERSATION_SUMMARY_PROMPT + conversationText;
      const summary = await this._callLLM(prompt);

      if (!summary) {
        return { success: false, error: '摘要生成失败' };
      }

      // 存储为 conversation_summary 类型记忆
      const entry = createMemoryEntry({
        type: MEMORY_TYPES.CONVERSATION_SUMMARY,
        content: summary,
        summary: summary.length > 100 ? summary.slice(0, 100) : summary,
        agentId,
        source: {
          type: MEMORY_SOURCE.CONVERSATION,
          conversationId,
        },
        tags: ['对话摘要'],
      });

      const result = memoryStore.add(entry);

      logger.info('对话摘要已生成', {
        conversationId,
        agentId,
        summaryLength: summary.length,
      });

      return result;
    } catch (error) {
      logger.error('对话摘要生成失败', error);
      return { success: false, error: error.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 短期记忆归档
  // ═══════════════════════════════════════════════════════════

  /**
   * 归档过期的短期记忆到长期存储
   * @returns {Promise<{scanned: number, archived: number}>}
   */
  async archiveExpiredShortTerm() {
    const archiveDays = MEMORY_CONFIG.SHORT_TERM_ARCHIVE_DAYS;
    const cutoff = Date.now() - archiveDays * 24 * 60 * 60 * 1000;
    let archivedCount = 0;
    let scannedCount = 0;

    for (const type of SHORT_TERM_TYPES) {
      const entries = memoryStore.query({ type });
      scannedCount += entries.length;

      for (const entry of entries) {
        if (entry.createdAt < cutoff && !entry.archived) {
          // 标记为已归档
          memoryStore.update(entry.id, { archived: true });
          archivedCount++;
        }
      }
    }

    return { scanned: scannedCount, archived: archivedCount };
  }

  // ═══════════════════════════════════════════════════════════
  // 相似记忆合并
  // ═══════════════════════════════════════════════════════════

  /**
   * 检查并合并相似记忆
   * 当同类型记忆超过阈值时触发
   * @returns {Promise<{checked: number, merged: number}>}
   */
  async mergeSimilarMemories() {
    let checkedTypes = 0;
    let totalMerged = 0;

    // 检查每个类型的记忆数量
    const typeGroups = {};
    const allEntries = memoryStore.query({ includeArchived: false });

    for (const entry of allEntries) {
      if (!typeGroups[entry.type]) {
        typeGroups[entry.type] = [];
      }
      typeGroups[entry.type].push(entry);
    }

    for (const [type, entries] of Object.entries(typeGroups)) {
      checkedTypes++;

      // 只在超过阈值时才尝试合并
      if (entries.length < MEMORY_CONFIG.MERGE_THRESHOLD) continue;

      // 找出可能相似的记忆对
      const groups = this._findSimilarGroups(entries);

      for (const group of groups) {
        if (group.length < 2) continue;

        try {
          const merged = await this._mergeGroup(group);
          if (merged) {
            totalMerged += group.length - 1; // 合并减少的条目数
          }
        } catch (error) {
          logger.warn('合并记忆组失败', { type, groupSize: group.length, error: error.message });
        }
      }
    }

    return { checked: checkedTypes, merged: totalMerged };
  }

  /**
   * 根据摘要相似度将记忆分组
   * @param {Object[]} entries - 索引条目
   * @returns {Object[][]} 相似记忆分组
   */
  _findSimilarGroups(entries) {
    const groups = [];
    const used = new Set();

    for (let i = 0; i < entries.length; i++) {
      if (used.has(entries[i].id)) continue;

      const group = [entries[i]];
      used.add(entries[i].id);

      for (let j = i + 1; j < entries.length; j++) {
        if (used.has(entries[j].id)) continue;

        // 简单的摘要相似度检查
        if (this._isSimilar(entries[i].summary, entries[j].summary)) {
          group.push(entries[j]);
          used.add(entries[j].id);
        }
      }

      if (group.length >= 2) {
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * 简单的字符串相似度检查
   * @param {string} a
   * @param {string} b
   * @returns {boolean}
   */
  _isSimilar(a, b) {
    if (!a || !b) return false;

    const la = a.toLowerCase();
    const lb = b.toLowerCase();

    // 精确匹配
    if (la === lb) return true;

    // 子串包含（80% 以上）
    const threshold = Math.floor(Math.min(la.length, lb.length) * 0.7);
    if (threshold < 5) return false;

    if (la.includes(lb.slice(0, threshold)) || lb.includes(la.slice(0, threshold))) {
      return true;
    }

    // 共同词比例
    const wordsA = new Set(la.split(/\s+/));
    const wordsB = new Set(lb.split(/\s+/));
    if (wordsA.size === 0 || wordsB.size === 0) return false;

    let common = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) common++;
    }
    const overlap = common / Math.max(wordsA.size, wordsB.size);
    return overlap > 0.6;
  }

  /**
   * 合并一组相似记忆
   * @param {Object[]} group - 相似记忆索引条目组
   * @returns {Promise<boolean>} 是否成功合并
   */
  async _mergeGroup(group) {
    if (!this.llmManager || group.length < 2) return false;

    // 读取完整条目
    const fullEntries = group
      .map((idx) => memoryStore.get(idx.id))
      .filter(Boolean);

    if (fullEntries.length < 2) return false;

    try {
      // 格式化为合并 prompt
      const entriesText = fullEntries
        .map((e, i) => `条目 ${i + 1}:\n  内容: ${e.content}\n  摘要: ${e.summary}\n  标签: ${(e.tags || []).join(', ')}\n  重要性: ${e.importance}`)
        .join('\n\n');

      const prompt = MERGE_PROMPT + entriesText;
      const rawResult = await this._callLLM(prompt);

      if (!rawResult) return false;

      // 解析合并结果
      const merged = this._parseMergeResult(rawResult);
      if (!merged) return false;

      // 取最高的 importance 和所有 tags
      const allTags = [...new Set(fullEntries.flatMap((e) => e.tags || []))];
      const maxImportance = Math.max(...fullEntries.map((e) => e.importance || 0.5));
      const totalAccess = fullEntries.reduce((sum, e) => sum + (e.accessCount || 0), 0);

      // 创建合并后的新记忆
      const newEntry = createMemoryEntry({
        type: fullEntries[0].type,
        content: merged.content || fullEntries[0].content,
        summary: merged.summary || fullEntries[0].summary,
        tags: merged.tags || allTags,
        importance: merged.importance || maxImportance,
        agentId: fullEntries[0].agentId,
        source: fullEntries[0].source,
        relatedAgents: [...new Set(fullEntries.flatMap((e) => e.relatedAgents || []))],
      });

      // 手动设置访问计数
      newEntry.accessCount = totalAccess;

      const result = memoryStore.add(newEntry);
      if (!result.success) return false;

      // 将旧条目标记为被替代
      for (const old of fullEntries) {
        memoryStore.update(old.id, { supersededBy: newEntry.id });
      }

      logger.info('记忆合并完成', {
        mergedCount: fullEntries.length,
        newId: newEntry.id,
        type: fullEntries[0].type,
      });

      return true;
    } catch (error) {
      logger.error('合并记忆失败', error);
      return false;
    }
  }

  /**
   * 解析合并结果
   * @param {string} rawResult
   * @returns {Object|null}
   */
  _parseMergeResult(rawResult) {
    if (!rawResult) return null;

    try {
      let jsonStr = rawResult.trim();
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

      const startIdx = jsonStr.indexOf('{');
      const endIdx = jsonStr.lastIndexOf('}');
      if (startIdx === -1 || endIdx === -1) return null;

      jsonStr = jsonStr.slice(startIdx, endIdx + 1);
      const parsed = JSON.parse(jsonStr);

      if (parsed.content && parsed.summary) {
        return parsed;
      }
      return null;
    } catch (error) {
      logger.warn('解析合并结果失败', { error: error.message });
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LLM 调用
  // ═══════════════════════════════════════════════════════════

  /**
   * 调用 LLM
   * @param {string} prompt
   * @returns {Promise<string|null>}
   */
  async _callLLM(prompt) {
    if (!this.llmManager) return null;

    try {
      const messages = [
        { role: 'user', content: prompt },
      ];

      const result = await this.llmManager.chat(messages, {
        model: MEMORY_CONFIG.EXTRACTOR_MODEL,
        temperature: 0.2,
        maxTokens: 1000,
      });

      return typeof result === 'string' ? result : result?.content || null;
    } catch (error) {
      logger.error('记忆总结 LLM 调用失败', error);
      return null;
    }
  }
}

// 单例
const memorySummarizer = new MemorySummarizer();

module.exports = { MemorySummarizer, memorySummarizer };
