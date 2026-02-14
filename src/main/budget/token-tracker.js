/**
 * SoloForge - Token 使用追踪器
 * 记录每次 API 调用的 token 消耗
 * @module budget/token-tracker
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getConfigDir() {
  return dataPath.getBasePath();
}

function getUsageFile() {
  return path.join(dataPath.getBasePath(), 'token-usage.json');
}

/**
 * @typedef {Object} TokenUsageRecord
 * @property {string} id - 记录 ID
 * @property {string} agentId - Agent ID
 * @property {string} model - 使用的模型
 * @property {number} promptTokens - 输入 token 数
 * @property {number} completionTokens - 输出 token 数
 * @property {number} totalTokens - 总 token 数
 * @property {number} timestamp - 时间戳
 * @property {string} conversationId - 对话 ID（可选）
 */

/**
 * @typedef {Object} AgentUsageSummary
 * @property {string} agentId - Agent ID
 * @property {number} totalPromptTokens - 总输入 token
 * @property {number} totalCompletionTokens - 总输出 token
 * @property {number} totalTokens - 总 token
 * @property {number} callCount - 调用次数
 * @property {string} lastUsed - 最后使用时间
 */

/**
 * Token 追踪器
 */
class TokenTracker {
  constructor() {
    /** @type {TokenUsageRecord[]} */
    this.records = [];
    /** 防抖定时器 */
    this._saveTimer = null;
    /** 防抖间隔（毫秒） */
    this._saveDebounceMs = 5000;
    this.loadFromDisk();
  }

  /**
   * 确保配置目录存在
   */
  ensureConfigDir() {
    const dir = getConfigDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 从磁盘加载历史记录
   */
  loadFromDisk() {
    try {
      const usageFile = getUsageFile();
      if (fs.existsSync(usageFile)) {
        const content = fs.readFileSync(usageFile, 'utf-8');
        const data = JSON.parse(content);
        this.records = Array.isArray(data.records) ? data.records : [];
        logger.debug(`加载了 ${this.records.length} 条 token 使用记录`);
      }
    } catch (error) {
      logger.error('加载 token 使用记录失败:', error);
      this.records = [];
    }
  }

  /**
   * 保存到磁盘
   */
  saveToDisk() {
    try {
      this.ensureConfigDir();
      const data = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        records: this.records,
      };
      fs.writeFileSync(getUsageFile(), JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('保存 token 使用记录失败:', error);
    }
  }

  /**
   * 记录一次 API 调用
   * @param {Object} usage
   * @param {string} usage.agentId - Agent ID
   * @param {string} usage.model - 使用的模型
   * @param {number} usage.promptTokens - 输入 token 数
   * @param {number} usage.completionTokens - 输出 token 数
   * @param {string} [usage.conversationId] - 对话 ID
   * @returns {TokenUsageRecord}
   */
  record(usage) {
    const record = {
      id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: usage.agentId,
      model: usage.model,
      promptTokens: usage.promptTokens || 0,
      completionTokens: usage.completionTokens || 0,
      totalTokens: (usage.promptTokens || 0) + (usage.completionTokens || 0),
      timestamp: Date.now(),
      conversationId: usage.conversationId,
    };

    this.records.push(record);

    // 限制记录数量，保留最近 10000 条
    if (this.records.length > 10000) {
      this.records = this.records.slice(-10000);
    }

    // 防抖写入：合并短时间内的多次记录为一次磁盘写入
    this._debouncedSave();

    logger.debug('记录 token 使用:', record);
    return record;
  }

  /**
   * 获取 Agent 使用汇总
   * @param {string} [agentId] - 指定 Agent，不指定则返回所有
   * @param {number} [sinceTimestamp] - 从指定时间开始统计
   * @returns {AgentUsageSummary[]}
   */
  getSummary(agentId, sinceTimestamp) {
    const filtered = this.records.filter((r) => {
      if (agentId && r.agentId !== agentId) return false;
      if (sinceTimestamp && r.timestamp < sinceTimestamp) return false;
      return true;
    });

    // 按 Agent 分组
    const grouped = new Map();
    for (const record of filtered) {
      if (!grouped.has(record.agentId)) {
        grouped.set(record.agentId, {
          agentId: record.agentId,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          callCount: 0,
          lastUsed: record.timestamp,
        });
      }

      const summary = grouped.get(record.agentId);
      summary.totalPromptTokens += record.promptTokens;
      summary.totalCompletionTokens += record.completionTokens;
      summary.totalTokens += record.totalTokens;
      summary.callCount += 1;
      if (record.timestamp > summary.lastUsed) {
        summary.lastUsed = record.timestamp;
      }
    }

    const summaries = Array.from(grouped.values());

    // 格式化时间（使用本地时间）
    for (const s of summaries) {
      s.lastUsed = new Date(s.lastUsed).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }

    return summaries;
  }

  /**
   * 获取总使用量
   * @param {number} [sinceTimestamp] - 从指定时间开始统计
   * @returns {{ totalPromptTokens: number, totalCompletionTokens: number, totalTokens: number, callCount: number }}
   */
  getTotalUsage(sinceTimestamp) {
    const summaries = this.getSummary(undefined, sinceTimestamp);
    return summaries.reduce(
      (acc, s) => ({
        totalPromptTokens: acc.totalPromptTokens + s.totalPromptTokens,
        totalCompletionTokens: acc.totalCompletionTokens + s.totalCompletionTokens,
        totalTokens: acc.totalTokens + s.totalTokens,
        callCount: acc.callCount + s.callCount,
      }),
      { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, callCount: 0 }
    );
  }

  /**
   * 获取最近的使用记录
   * @param {number} [limit=100] - 返回条数
   * @returns {TokenUsageRecord[]}
   */
  getRecentRecords(limit = 100) {
    return this.records.slice(-limit).reverse();
  }

  /**
   * 防抖保存到磁盘
   */
  _debouncedSave() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
    }
    this._saveTimer = setTimeout(() => {
      this.saveToDisk();
      this._saveTimer = null;
    }, this._saveDebounceMs);
  }

  /**
   * 立即刷盘（用于退出前）
   */
  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.saveToDisk();
  }

  /**
   * 重新初始化（切换公司后调用）
   * 取消待保存定时器、清空记录、从新路径重新加载
   */
  reinitialize() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.records = [];
    this.loadFromDisk();
  }

  /**
   * 清除所有记录
   */
  clear() {
    this.records = [];
    this.saveToDisk();
    logger.info('已清除所有 token 使用记录');
  }
}

// 单例
const tokenTracker = new TokenTracker();

module.exports = { TokenTracker, tokenTracker };
