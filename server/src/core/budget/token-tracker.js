/**
 * SoloForge Mobile - Token 使用追踪器
 * 记录每次 API 调用的 token 消耗（JSON 文件存储，无 Electron 依赖）
 * @module core/budget/token-tracker
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');

const DATA_DIR = path.join(__dirname, '../../../data');

function getUsageFile() {
  return path.join(DATA_DIR, 'token-usage.json');
}

/**
 * Token 追踪器
 */
class TokenTracker {
  constructor() {
    /** @type {Array} */
    this.records = [];
    this._saveTimer = null;
    this._saveDebounceMs = 5000;
    this.loadFromDisk();
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  loadFromDisk() {
    try {
      const usageFile = getUsageFile();
      if (fs.existsSync(usageFile)) {
        const content = fs.readFileSync(usageFile, 'utf-8');
        const data = JSON.parse(content);
        const raw = Array.isArray(data.records) ? data.records : [];
        this.records = raw.filter(
          (r) => r.totalTokens > 0 || r.promptTokens > 0 || r.completionTokens > 0
        );
      }
    } catch (error) {
      logger.error('加载 token 使用记录失败:', error);
      this.records = [];
    }
  }

  saveToDisk() {
    try {
      this._ensureDataDir();
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
    if (this.records.length > 10000) {
      this.records = this.records.slice(-10000);
    }
    this._debouncedSave();
    return record;
  }

  /**
   * 获取 Agent 使用汇总
   * @param {string} [agentId]
   * @param {number} [sinceTimestamp]
   */
  getSummary(agentId, sinceTimestamp) {
    const filtered = this.records.filter((r) => {
      if (agentId && r.agentId !== agentId) return false;
      if (sinceTimestamp && r.timestamp < sinceTimestamp) return false;
      return true;
    });

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
      if (record.timestamp > summary.lastUsed) summary.lastUsed = record.timestamp;
    }

    const summaries = Array.from(grouped.values());
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

  getRecentRecords(limit = 100) {
    return this.records.slice(-limit).reverse();
  }

  _debouncedSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.saveToDisk();
      this._saveTimer = null;
    }, this._saveDebounceMs);
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.saveToDisk();
  }

  purgeZeroTokenRecords() {
    const before = this.records.length;
    this.records = this.records.filter(
      (r) => r.totalTokens > 0 || r.promptTokens > 0 || r.completionTokens > 0
    );
    const removed = before - this.records.length;
    if (removed > 0) this.saveToDisk();
    return removed;
  }

  /**
   * 从桌面版 token-usage.json 导入数据（追加记录）
   * @param {string} desktopUsagePath - 桌面版 token-usage.json 路径
   */
  importFromDesktop(desktopUsagePath) {
    try {
      if (!fs.existsSync(desktopUsagePath)) return { imported: 0 };
      const content = fs.readFileSync(desktopUsagePath, 'utf-8');
      const desktop = JSON.parse(content);
      const raw = Array.isArray(desktop.records) ? desktop.records : [];
      const valid = raw.filter(
        (r) => r.totalTokens > 0 || r.promptTokens > 0 || r.completionTokens > 0
      );
      this.records.push(...valid);
      if (this.records.length > 10000) {
        this.records = this.records.slice(-10000);
      }
      this.saveToDisk();
      return { imported: valid.length };
    } catch (error) {
      logger.error('导入 token-usage.json 失败:', error);
      return { imported: 0, error: error.message };
    }
  }
}

const tokenTracker = new TokenTracker();

module.exports = { TokenTracker, tokenTracker };
