/**
 * SoloForge - 记忆自动提取器
 * 从对话、通信、任务中自动提取并存储记忆条目
 * 使用 LLM 进行语义分析
 * @module memory/memory-extractor
 */

const { logger } = require('../utils/logger');
const { memoryStore } = require('./memory-store');
const {
  MEMORY_TYPES,
  MEMORY_SOURCE,
  MEMORY_CONFIG,
  createMemoryEntry,
} = require('./memory-types');

// ═══════════════════════════════════════════════════════════
// 提取 Prompt 模板
// ═══════════════════════════════════════════════════════════

const EXTRACTION_PROMPT = `你是一个记忆提取系统。分析以下对话内容，提取值得长期记住的信息。

返回一个 JSON 数组（不要包裹在 markdown 代码块中），每条记忆包含：
- type: 类型，必须是以下之一：decision, fact, preference, project_context, lesson, procedure, company_fact, user_profile
- content: 详细描述（50-200字）
- summary: 一句话摘要（不超过 50 字）
- tags: 关键词标签数组（2-5 个）
- importance: 重要性评分（0.0-1.0）

类型说明：
- decision: 做出的明确决策或选择（如"决定用 React"、"选择方案 A"）
- fact: 客观事实信息（如公司名称、产品定位、技术栈）
- preference: 用户表达的偏好/喜好/风格要求
- project_context: 项目相关的背景信息（技术栈、目标、进展）
- lesson: 经验教训、踩过的坑、注意事项
- procedure: 流程、规范、要求（如"代码必须过审"）
- company_fact: 公司/团队相关信息
- user_profile: 用户特征（身份、背景、专业领域、沟通风格）

规则：
1. 只提取确定性信息，不要推测或臆断
2. decision 类型要有明确的决策动作词（决定、选择、确定、采用等）
3. preference 类型要有明确的偏好表达（喜欢、偏好、不喜欢、要求等）
4. 不要提取寒暄、问候等无信息量的内容
5. 不要提取工具调用的中间过程
6. 如果对话没有值得提取的信息，返回空数组 []
7. 每次提取不超过 5 条记忆

对话内容：
`;

const TASK_EXTRACTION_PROMPT = `你是一个记忆提取系统。分析以下任务执行信息，提取值得记住的经验和成果。

返回一个 JSON 数组（不要包裹在 markdown 代码块中），每条记忆包含：
- type: task_result 或 lesson
- content: 详细描述
- summary: 一句话摘要（不超过 50 字）
- tags: 关键词标签数组
- importance: 重要性评分（0.0-1.0）

规则：
1. task_result: 提取任务的关键成果和产出
2. lesson: 如果任务失败或被退回，提取经验教训
3. 不要重复任务描述本身，而是提取有价值的结论
4. 最多提取 3 条

任务信息：
`;

/**
 * 记忆提取器
 */
class MemoryExtractor {
  constructor() {
    /** @type {import('../llm/llm-manager').LLMManager|null} */
    this.llmManager = null;

    /**
     * 去重缓存：最近提取的摘要，用于避免重复
     * @type {Set<string>}
     */
    this._recentSummaries = new Set();

    /** 去重缓存最大容量 */
    this._maxRecentSummaries = 200;
  }

  /**
   * 设置 LLM Manager
   * @param {import('../llm/llm-manager').LLMManager} llmManager
   */
  setLLMManager(llmManager) {
    this.llmManager = llmManager;
  }

  // ═══════════════════════════════════════════════════════════
  // 对话提取
  // ═══════════════════════════════════════════════════════════

  /**
   * 从对话消息中提取记忆
   * @param {string} conversationId
   * @param {string} agentId
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Promise<{extracted: number, errors: string[]}>}
   */
  async extractFromConversation(conversationId, agentId, messages) {
    if (!this.llmManager) {
      return { extracted: 0, errors: ['LLM Manager 未设置'] };
    }

    if (!messages || messages.length < MEMORY_CONFIG.MIN_MESSAGES_FOR_EXTRACTION) {
      return { extracted: 0, errors: [] };
    }

    try {
      // 取最近的消息（避免上下文过长）
      const recentMessages = messages.slice(-15);

      // 格式化消息为文本
      const conversationText = recentMessages
        .map((m) => {
          const role = m.role === 'user' ? '用户' : 'Agent';
          // 截断过长消息
          const content = m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content;
          return `${role}: ${content}`;
        })
        .join('\n\n');

      // 调用 LLM 提取
      const prompt = EXTRACTION_PROMPT + conversationText;
      const rawResult = await this._callLLM(prompt);

      if (!rawResult) {
        return { extracted: 0, errors: [] };
      }

      // 解析结果
      const extracted = this._parseExtractionResult(rawResult);

      if (extracted.length === 0) {
        logger.debug('对话无可提取记忆', { conversationId, agentId });
        return { extracted: 0, errors: [] };
      }

      // 去重并存储
      const stored = this._deduplicateAndStore(extracted, {
        sourceType: MEMORY_SOURCE.CONVERSATION,
        conversationId,
        agentId,
      });

      logger.info('对话记忆提取完成', {
        conversationId,
        agentId,
        candidates: extracted.length,
        stored: stored.count,
      });

      return { extracted: stored.count, errors: stored.errors };
    } catch (error) {
      logger.error('对话记忆提取失败', error);
      return { extracted: 0, errors: [error.message] };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 通信提取
  // ═══════════════════════════════════════════════════════════

  /**
   * 从 Agent 间通信中提取记忆
   * @param {Object} params
   * @param {string} params.fromAgent
   * @param {string} params.toAgent
   * @param {string} params.message
   * @param {string} params.response
   * @returns {Promise<{extracted: number}>}
   */
  async extractFromCommunication(params) {
    if (!this.llmManager) return { extracted: 0 };

    const { fromAgent, toAgent, message, response } = params;

    // 通信内容太短，跳过
    if ((!message || message.length < 50) && (!response || response.length < 50)) {
      return { extracted: 0 };
    }

    try {
      const text = `${fromAgent} 对 ${toAgent} 说：${message?.slice(0, 300) || ''}\n\n${toAgent} 回复：${response?.slice(0, 300) || ''}`;

      const prompt = EXTRACTION_PROMPT + text;
      const rawResult = await this._callLLM(prompt);

      if (!rawResult) return { extracted: 0 };

      const extracted = this._parseExtractionResult(rawResult);
      if (extracted.length === 0) return { extracted: 0 };

      const stored = this._deduplicateAndStore(extracted, {
        sourceType: MEMORY_SOURCE.COMMUNICATION,
        relatedAgents: [fromAgent, toAgent],
      });

      logger.debug('通信记忆提取完成', {
        fromAgent,
        toAgent,
        stored: stored.count,
      });

      return { extracted: stored.count };
    } catch (error) {
      logger.error('通信记忆提取失败', error);
      return { extracted: 0 };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 任务提取
  // ═══════════════════════════════════════════════════════════

  /**
   * 从任务执行结果中提取记忆
   * @param {Object} params
   * @param {string} params.taskId
   * @param {string} params.fromAgent
   * @param {string} params.toAgent
   * @param {string} params.taskDescription
   * @param {string} params.result
   * @param {boolean} [params.wasRejected=false]
   * @returns {Promise<{extracted: number}>}
   */
  async extractFromTaskResult(params) {
    if (!this.llmManager) return { extracted: 0 };

    const { taskId, fromAgent, toAgent, taskDescription, result, wasRejected = false } = params;

    try {
      const statusText = wasRejected ? '（任务被退回/失败）' : '（任务成功完成）';
      const text = `任务描述: ${taskDescription?.slice(0, 300) || ''}\n执行者: ${toAgent}\n委派者: ${fromAgent}\n状态: ${statusText}\n结果: ${result?.slice(0, 500) || ''}`;

      const prompt = TASK_EXTRACTION_PROMPT + text;
      const rawResult = await this._callLLM(prompt);

      if (!rawResult) return { extracted: 0 };

      const extracted = this._parseExtractionResult(rawResult);
      if (extracted.length === 0) return { extracted: 0 };

      // 如果被退回，所有条目类型默认为 lesson
      if (wasRejected) {
        for (const item of extracted) {
          if (item.type === 'task_result') {
            item.type = MEMORY_TYPES.LESSON;
            item.importance = Math.max(item.importance || 0.5, 0.7);
          }
        }
      }

      const stored = this._deduplicateAndStore(extracted, {
        sourceType: MEMORY_SOURCE.TASK,
        taskId,
        agentId: toAgent,
        relatedAgents: [fromAgent, toAgent],
      });

      logger.debug('任务记忆提取完成', {
        taskId,
        wasRejected,
        stored: stored.count,
      });

      return { extracted: stored.count };
    } catch (error) {
      logger.error('任务记忆提取失败', error);
      return { extracted: 0 };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LLM 调用
  // ═══════════════════════════════════════════════════════════

  /**
   * 调用 LLM 进行提取
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
        temperature: 0.1, // 低温度，保证结构化输出一致性
        maxTokens: 1500,
      });

      return typeof result === 'string' ? result : result?.content || null;
    } catch (error) {
      logger.error('记忆提取 LLM 调用失败', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 结果解析
  // ═══════════════════════════════════════════════════════════

  /**
   * 解析 LLM 返回的提取结果
   * @param {string} rawResult
   * @returns {Object[]}
   */
  _parseExtractionResult(rawResult) {
    if (!rawResult) return [];

    try {
      // 尝试从文本中提取 JSON 数组
      let jsonStr = rawResult.trim();

      // 移除可能的 markdown 代码块包裹
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

      // 尝试找到 JSON 数组
      const startIdx = jsonStr.indexOf('[');
      const endIdx = jsonStr.lastIndexOf(']');

      if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        logger.debug('提取结果中未找到 JSON 数组');
        return [];
      }

      jsonStr = jsonStr.slice(startIdx, endIdx + 1);
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) {
        logger.warn('提取结果不是数组');
        return [];
      }

      // 验证每条记忆的必需字段
      const valid = parsed.filter((item) => {
        return item.type && item.content && item.summary;
      });

      // 限制数量
      return valid.slice(0, 5);
    } catch (error) {
      logger.warn('解析提取结果失败', { error: error.message, rawLength: rawResult.length });
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 去重与存储
  // ═══════════════════════════════════════════════════════════

  /**
   * 去重并存储提取到的记忆
   * @param {Object[]} extracted - 提取到的原始条目
   * @param {Object} context - 上下文信息
   * @returns {{ count: number, errors: string[] }}
   */
  _deduplicateAndStore(extracted, context = {}) {
    const { sourceType, conversationId, taskId, agentId, relatedAgents = [] } = context;
    const errors = [];
    let count = 0;

    for (const item of extracted) {
      // 去重检查：与最近提取的摘要比较
      const summaryKey = item.summary.trim().toLowerCase();
      if (this._isDuplicate(summaryKey)) {
        logger.debug('跳过重复记忆', { summary: item.summary.slice(0, 30) });
        continue;
      }

      try {
        const entry = createMemoryEntry({
          type: item.type,
          content: item.content,
          summary: item.summary,
          tags: item.tags || [],
          importance: typeof item.importance === 'number'
            ? Math.max(0, Math.min(1, item.importance))
            : undefined,
          agentId: agentId || null,
          relatedAgents,
          source: {
            type: sourceType || MEMORY_SOURCE.SYSTEM,
            conversationId: conversationId || null,
            taskId: taskId || null,
          },
        });

        const result = memoryStore.add(entry);
        if (result.success) {
          count++;
          // 添加到去重缓存
          this._addToRecentSummaries(summaryKey);
        } else {
          errors.push(result.error);
        }
      } catch (error) {
        errors.push(error.message);
      }
    }

    return { count, errors };
  }

  /**
   * 检查摘要是否与已有记忆重复
   * 使用简单的字符串相似度检查
   * @param {string} summaryKey - 小写摘要
   * @returns {boolean}
   */
  _isDuplicate(summaryKey) {
    // 精确匹配
    if (this._recentSummaries.has(summaryKey)) return true;

    // 简单的子串包含检查
    for (const existing of this._recentSummaries) {
      // 如果一个包含另一个的 80% 以上，认为重复
      if (summaryKey.length > 10 && existing.length > 10) {
        if (summaryKey.includes(existing.slice(0, Math.floor(existing.length * 0.8)))) return true;
        if (existing.includes(summaryKey.slice(0, Math.floor(summaryKey.length * 0.8)))) return true;
      }
    }

    // 也与存储中的现有记忆比较
    const allIndex = memoryStore.query({ includeArchived: false });
    for (const entry of allIndex) {
      const existingSummary = (entry.summary || '').toLowerCase();
      if (existingSummary === summaryKey) return true;
      // 简单子串检查
      if (summaryKey.length > 15 && existingSummary.length > 15) {
        const threshold = Math.floor(Math.min(summaryKey.length, existingSummary.length) * 0.8);
        if (summaryKey.includes(existingSummary.slice(0, threshold))) return true;
        if (existingSummary.includes(summaryKey.slice(0, threshold))) return true;
      }
    }

    return false;
  }

  /**
   * 添加摘要到去重缓存
   * @param {string} summaryKey
   */
  _addToRecentSummaries(summaryKey) {
    this._recentSummaries.add(summaryKey);
    // 超过上限时清理最早的
    if (this._recentSummaries.size > this._maxRecentSummaries) {
      const first = this._recentSummaries.values().next().value;
      this._recentSummaries.delete(first);
    }
  }
}

// 单例
const memoryExtractor = new MemoryExtractor();

module.exports = { MemoryExtractor, memoryExtractor };
