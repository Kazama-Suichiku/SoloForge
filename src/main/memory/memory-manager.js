/**
 * SoloForge - 记忆系统统一管理器
 * 统一的记忆 CRUD 接口、协调提取/检索/衰减/总结各子模块、生命周期管理
 * @module memory/memory-manager
 */

const { logger } = require('../utils/logger');
const { memoryStore } = require('./memory-store');
const {
  MEMORY_CONFIG,
  MEMORY_TYPES,
  MEMORY_SCOPE,
  createMemoryEntry,
  validateMemoryEntry,
} = require('./memory-types');

/**
 * 记忆系统管理器
 */
class MemoryManager {
  constructor() {
    /** @type {import('../llm/llm-manager').LLMManager|null} */
    this.llmManager = null;

    /** @type {import('./memory-retriever').MemoryRetriever|null} */
    this.retriever = null;

    /** @type {import('./memory-extractor').MemoryExtractor|null} */
    this.extractor = null;

    /** @type {import('./memory-summarizer').MemorySummarizer|null} */
    this.summarizer = null;

    /** @type {import('./memory-decay').MemoryDecay|null} */
    this.decay = null;

    /** 定时维护定时器 */
    this._maintenanceTimer = null;

    /** 是否已初始化 */
    this._initialized = false;

    /**
     * 提取节流器 — 防止同一对话频繁提取
     * key: conversationId, value: lastExtractionTime
     * @type {Map<string, number>}
     */
    this._extractionThrottle = new Map();

    /**
     * 消息计数器 — 跟踪每个对话的新消息数
     * key: conversationId, value: messageCount
     * @type {Map<string, number>}
     */
    this._messageCounters = new Map();
  }

  // ═══════════════════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════════════════

  /**
   * 初始化记忆系统
   * 延迟加载子模块避免循环依赖
   * @param {import('../llm/llm-manager').LLMManager} llmManager
   */
  initialize(llmManager) {
    if (this._initialized) {
      logger.warn('记忆系统已经初始化过');
      return;
    }

    this.llmManager = llmManager;

    // 延迟加载子模块
    const { memoryRetriever } = require('./memory-retriever');
    const { memoryExtractor } = require('./memory-extractor');
    const { memorySummarizer } = require('./memory-summarizer');
    const { memoryDecay } = require('./memory-decay');

    this.retriever = memoryRetriever;
    this.extractor = memoryExtractor;
    this.summarizer = memorySummarizer;
    this.decay = memoryDecay;

    // 为提取器和总结器设置 LLM Manager
    if (this.extractor) {
      this.extractor.setLLMManager(llmManager);
    }
    if (this.summarizer) {
      this.summarizer.setLLMManager(llmManager);
    }

    this._initialized = true;

    const stats = memoryStore.getStats();
    logger.info('记忆系统初始化完成', stats);
  }

  /**
   * 启动定时维护任务
   */
  startMaintenanceSchedule() {
    if (this._maintenanceTimer) {
      clearInterval(this._maintenanceTimer);
    }

    this._maintenanceTimer = setInterval(() => {
      this.runMaintenance().catch((error) => {
        logger.error('记忆定时维护失败', error);
      });
    }, MEMORY_CONFIG.MAINTENANCE_INTERVAL_MS);

    logger.info('记忆维护定时任务已启动', {
      intervalHours: MEMORY_CONFIG.MAINTENANCE_INTERVAL_MS / (60 * 60 * 1000),
    });
  }

  /**
   * 停止定时维护任务
   */
  stopMaintenanceSchedule() {
    if (this._maintenanceTimer) {
      clearInterval(this._maintenanceTimer);
      this._maintenanceTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 存储操作
  // ═══════════════════════════════════════════════════════════

  /**
   * 存储一条记忆
   * @param {Object} params - createMemoryEntry 的参数
   * @returns {{ success: boolean, id?: string, error?: string }}
   */
  store(params) {
    try {
      const entry = createMemoryEntry(params);
      const validation = validateMemoryEntry(entry);
      if (!validation.valid) {
        return { success: false, error: `验证失败: ${validation.errors.join(', ')}` };
      }

      return memoryStore.add(entry);
    } catch (error) {
      logger.error('存储记忆失败', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量存储记忆
   * @param {Object[]} paramsList - createMemoryEntry 参数列表
   * @returns {{ success: boolean, count: number, errors: string[] }}
   */
  storeMultiple(paramsList) {
    const entries = [];
    const errors = [];

    for (const params of paramsList) {
      try {
        const entry = createMemoryEntry(params);
        const validation = validateMemoryEntry(entry);
        if (validation.valid) {
          entries.push(entry);
        } else {
          errors.push(`验证失败: ${validation.errors.join(', ')}`);
        }
      } catch (error) {
        errors.push(error.message);
      }
    }

    if (entries.length > 0) {
      const result = memoryStore.addMultiple(entries);
      return {
        success: result.success && errors.length === 0,
        count: result.count,
        errors: [...errors, ...result.errors],
      };
    }

    return { success: false, count: 0, errors };
  }

  // ═══════════════════════════════════════════════════════════
  // 检索操作 (委托给 MemoryRetriever)
  // ═══════════════════════════════════════════════════════════

  /**
   * 按语义检索相关记忆
   * @param {string} query - 查询文本
   * @param {Object} [options]
   * @param {string} [options.agentId] - Agent ID (用于范围过滤)
   * @param {number} [options.limit] - 返回数量
   * @param {string} [options.type] - 限定类型
   * @returns {Object[]} 检索到的记忆条目
   */
  recall(query, options = {}) {
    if (!this.retriever) {
      logger.warn('记忆检索器未初始化');
      return [];
    }
    return this.retriever.recall(query, options);
  }

  /**
   * 获取 Agent 上下文注入文本
   * 在 ChatManager 中调用，将相关记忆格式化后注入到用户消息前
   * @param {string} agentId
   * @param {string} message - 当前用户消息
   * @param {string} [conversationId]
   * @returns {string|null} 格式化的记忆上下文文本，或 null
   */
  getContextForAgent(agentId, message, conversationId) {
    if (!this.retriever) return null;
    return this.retriever.getContextForAgent(agentId, message, conversationId);
  }

  /**
   * 获取共享知识
   * @param {string[]} [tags] - 按标签筛选
   * @returns {Object[]}
   */
  getSharedKnowledge(tags) {
    if (tags && tags.length > 0) {
      return memoryStore.searchByTags(tags, { scope: 'shared' });
    }
    return memoryStore.query({ scope: 'shared' });
  }

  /**
   * 获取用户画像
   * @returns {Object[]}
   */
  getUserProfile() {
    return memoryStore.query({ type: MEMORY_TYPES.USER_PROFILE });
  }

  /**
   * 按标签/类型搜索记忆
   * @param {Object} params
   * @param {string[]} [params.tags]
   * @param {string} [params.type]
   * @param {string} [params.agentId]
   * @param {number} [params.limit=20]
   * @returns {Object[]}
   */
  search(params = {}) {
    const { tags, type, agentId, limit = 20 } = params;

    let results;
    if (tags && tags.length > 0) {
      results = memoryStore.searchByTags(tags, { type, agentId });
    } else {
      results = memoryStore.query({ type, agentId });
    }

    // 按 importance 降序
    results.sort((a, b) => b.importance - a.importance);
    return results.slice(0, limit);
  }

  /**
   * 获取最近的记忆
   * @param {number} [limit=20]
   * @param {string} [type]
   * @returns {Object[]}
   */
  getRecent(limit = 20, type) {
    return memoryStore.getRecent(limit, type ? { type } : {});
  }

  // ═══════════════════════════════════════════════════════════
  // 生命周期操作
  // ═══════════════════════════════════════════════════════════

  /**
   * 删除一条记忆
   * @param {string} memoryId
   * @returns {{ success: boolean, error?: string }}
   */
  forget(memoryId) {
    return memoryStore.remove(memoryId);
  }

  /**
   * 强化一条记忆（提升重要性和访问计数）
   * @param {string} memoryId
   * @returns {{ success: boolean }}
   */
  reinforce(memoryId) {
    if (!this.decay) {
      // 直接更新
      return memoryStore.update(memoryId, {
        accessCount: (memoryStore.get(memoryId)?.accessCount || 0) + 1,
        lastAccessedAt: Date.now(),
      });
    }
    return this.decay.reinforce(memoryId);
  }

  // ═══════════════════════════════════════════════════════════
  // 提取触发 (由 ChatManager / AgentCommunication 调用)
  // ═══════════════════════════════════════════════════════════

  /**
   * 通知记忆系统对话中有新消息
   * 达到阈值时自动触发提取
   * @param {string} conversationId
   * @param {string} agentId
   * @param {Array<{role: string, content: string}>} recentMessages - 最近的消息
   */
  onNewMessage(conversationId, agentId, recentMessages) {
    if (!this.extractor || !this._initialized) return;

    // 更新消息计数
    const count = (this._messageCounters.get(conversationId) || 0) + 1;
    this._messageCounters.set(conversationId, count);

    // 检查是否达到提取阈值
    if (count >= MEMORY_CONFIG.EXTRACTION_INTERVAL_MESSAGES) {
      this._tryExtract(conversationId, agentId, recentMessages);
      this._messageCounters.set(conversationId, 0);
    }
  }

  /**
   * 通知记忆系统对话已结束（用户切换对话或超时）
   * @param {string} conversationId
   * @param {string} agentId
   * @param {Array<{role: string, content: string}>} fullHistory
   */
  onConversationEnd(conversationId, agentId, fullHistory) {
    if (!this._initialized) return;

    // 少于最小消息数的对话不提取
    if (!fullHistory || fullHistory.length < MEMORY_CONFIG.MIN_MESSAGES_FOR_EXTRACTION) return;

    // 触发提取
    this._tryExtract(conversationId, agentId, fullHistory);

    // 触发对话摘要
    if (this.summarizer) {
      setImmediate(async () => {
        try {
          await this.summarizer.summarizeConversation(conversationId, agentId, fullHistory);
        } catch (error) {
          logger.error('对话摘要生成失败', error);
        }
      });
    }

    // 清理计数器
    this._messageCounters.delete(conversationId);
    this._extractionThrottle.delete(conversationId);
  }

  /**
   * 通知记忆系统有 Agent 间通信完成
   * @param {Object} params
   * @param {string} params.fromAgent
   * @param {string} params.toAgent
   * @param {string} params.message
   * @param {string} params.response
   */
  onCommunicationComplete(params) {
    if (!this.extractor || !this._initialized) return;

    setImmediate(async () => {
      try {
        await this.extractor.extractFromCommunication(params);
      } catch (error) {
        logger.error('通信记忆提取失败', error);
      }
    });
  }

  /**
   * 通知记忆系统有任务完成
   * @param {Object} params
   * @param {string} params.taskId
   * @param {string} params.fromAgent
   * @param {string} params.toAgent
   * @param {string} params.taskDescription
   * @param {string} params.result
   * @param {boolean} [params.wasRejected=false]
   */
  onTaskComplete(params) {
    if (!this.extractor || !this._initialized) return;

    setImmediate(async () => {
      try {
        await this.extractor.extractFromTaskResult(params);
      } catch (error) {
        logger.error('任务记忆提取失败', error);
      }
    });
  }

  /**
   * 尝试触发提取（带节流）
   * @private
   */
  _tryExtract(conversationId, agentId, messages) {
    // 节流检查
    const lastExtraction = this._extractionThrottle.get(conversationId) || 0;
    const now = Date.now();
    if (now - lastExtraction < MEMORY_CONFIG.MIN_EXTRACTION_INTERVAL_MS) {
      logger.debug('记忆提取被节流', { conversationId, sinceLastMs: now - lastExtraction });
      return;
    }

    this._extractionThrottle.set(conversationId, now);

    // 异步提取，不阻塞主流程
    setImmediate(async () => {
      try {
        await this.extractor.extractFromConversation(conversationId, agentId, messages);
      } catch (error) {
        logger.error('对话记忆提取失败', error);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 维护操作
  // ═══════════════════════════════════════════════════════════

  /**
   * 执行定时维护：归档 + 衰减 + 合并
   */
  async runMaintenance() {
    logger.info('开始记忆系统维护...');

    const startTime = Date.now();

    try {
      // 1. 运行衰减
      if (this.decay) {
        const decayResult = this.decay.runDecay();
        logger.info('记忆衰减完成', decayResult);
      }

      // 2. 归档过期短期记忆
      if (this.summarizer) {
        const archiveResult = await this.summarizer.archiveExpiredShortTerm();
        logger.info('短期记忆归档完成', archiveResult);
      }

      // 3. 合并相似记忆
      if (this.summarizer) {
        const mergeResult = await this.summarizer.mergeSimilarMemories();
        logger.info('相似记忆合并完成', mergeResult);
      }

      const elapsed = Date.now() - startTime;
      logger.info('记忆系统维护完成', { elapsedMs: elapsed });
    } catch (error) {
      logger.error('记忆系统维护出错', error);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 统计与刷盘
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取记忆系统统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      ...memoryStore.getStats(),
      initialized: this._initialized,
      maintenanceRunning: this._maintenanceTimer !== null,
      pendingExtractions: this._extractionThrottle.size,
    };
  }

  /**
   * 立即刷盘（应用退出前调用）
   */
  flush() {
    memoryStore.flush();
    logger.info('记忆系统已刷盘');
  }
}

// 单例
const memoryManager = new MemoryManager();

module.exports = { MemoryManager, memoryManager };
