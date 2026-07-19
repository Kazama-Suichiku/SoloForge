/**
 * SoloForge - 群聊历史持久化存储（Phase 3-A）
 *
 * 职责：
 *   - append(conversationId, msg)              追加一条群聊消息
 *   - getRecent(conversationId, limit=50)       获取最近 N 条消息
 *   - getAll(conversationId)                    获取该群聊的全部消息
 *   - loadFromDisk() / saveToDisk()             持久化到 group-history.json
 *   - reinitialize()                            公司切换时清空内存并重新加载
 *
 * 持久化路径：~/.soloforge/data/<user>/<company>/group-history.json
 * 参照 comm-event-store.js 的持久化方式：
 *   - 构造时 loadFromDisk()
 *   - saveToDisk() 异步防抖（DEBOUNCE_MS）
 *   - saveToDiskSync() 同步刷盘（退出时由 lifecycle flushAll 调用）
 *   - reinitialize() 公司切换时清空内存并从新路径重新加载
 *
 * @module chat/group-history-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');
const { atomicWrite, atomicWriteSync } = require('../utils/atomic-write');

// 防抖保存：与 comm-event-store.js 的 2000ms 保持一致
let _saveTimer = null;
const SAVE_DEBOUNCE_MS = 2000;

// 每个群聊在内存中最多保留的消息条数
const MAX_MESSAGES_PER_GROUP = 500;

/**
 * @typedef {Object} GroupMessage
 * @property {string} id             - 消息 ID，格式 'gm-<timestamp>-<rand>'
 * @property {string} senderId       - 发送者 ID（Agent ID 或 'user'）
 * @property {string} senderName     - 发送者显示名
 * @property {string} content        - 消息内容
 * @property {string[]} mentions     - 被 @ 的 Agent ID 列表
 * @property {number} timestamp       - 消息时间戳（Date.now()）
 */

/**
 * 群聊历史存储管理器
 */
class GroupHistoryStore {
  constructor() {
    /**
     * 按 conversationId（群聊 ID）分组的消息列表
     * @type {Map<string, GroupMessage[]>}
     */
    this.groups = new Map();
    this._ensureDataDir();
    this.loadFromDisk();
  }

  // ─── 路径辅助 ───────────────────────────────────────────────

  _ensureDataDir() {
    const dir = dataPath.getBasePath();
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        logger.warn('group-history-store: 创建数据目录失败:', error.message);
      }
    }
  }

  _getFilePath() {
    return path.join(dataPath.getBasePath(), 'group-history.json');
  }

  // ─── ID 生成 ─────────────────────────────────────────────────

  _generateId() {
    return `gm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ─── 持久化 ─────────────────────────────────────────────────

  /**
   * 从磁盘加载群聊历史
   */
  loadFromDisk() {
    try {
      const filePath = this._getFilePath();
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const groups = (data && typeof data === 'object' && data.groups) ? data.groups : {};
        this.groups = new Map();
        for (const [groupId, messages] of Object.entries(groups)) {
          if (Array.isArray(messages)) {
            this.groups.set(groupId, messages.slice(-MAX_MESSAGES_PER_GROUP));
          }
        }
        let total = 0;
        for (const m of this.groups.values()) total += m.length;
        logger.info('群聊历史已加载', { groupCount: this.groups.size, totalMessages: total });
      } else {
        this.groups = new Map();
      }
    } catch (error) {
      logger.error('加载群聊历史失败', error);
      this.groups = new Map();
    }
  }

  /**
   * 异步防抖保存
   */
  saveToDisk() {
    if (_saveTimer) {
      clearTimeout(_saveTimer);
    }
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      this._doSave();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * 实际执行保存（异步原子写入，不阻塞主进程）
   * @private
   */
  _doSave() {
    try {
      this._ensureDataDir();
      const groupsObj = {};
      for (const [groupId, messages] of this.groups) {
        groupsObj[groupId] = messages.slice(-MAX_MESSAGES_PER_GROUP);
      }
      const content = JSON.stringify(
        { version: 1, groups: groupsObj },
        null,
        2
      );
      atomicWrite(this._getFilePath(), content).catch((error) => {
        logger.error('保存群聊历史失败', error);
      });
    } catch (error) {
      logger.error('保存群聊历史失败', error);
    }
  }

  /**
   * 同步保存（仅用于应用退出前，由 lifecycle flushAll 调用）
   */
  saveToDiskSync() {
    try {
      this._ensureDataDir();
      const groupsObj = {};
      for (const [groupId, messages] of this.groups) {
        groupsObj[groupId] = messages.slice(-MAX_MESSAGES_PER_GROUP);
      }
      const content = JSON.stringify(
        { version: 1, groups: groupsObj },
        null,
        2
      );
      atomicWriteSync(this._getFilePath(), content);
      logger.info('群聊历史已同步保存');
    } catch (error) {
      logger.error('同步保存群聊历史失败', error);
    }
  }

  /**
   * 重新初始化（公司切换时调用）
   * 清空内存状态并从新路径重新加载
   */
  reinitialize() {
    this.groups = new Map();
    this._ensureDataDir();
    this.loadFromDisk();
  }

  // ─── 写入 ───────────────────────────────────────────────────

  /**
   * 追加一条群聊消息
   * @param {string} conversationId - 群聊 ID
   * @param {Object} msg - 消息字段
   * @param {string} msg.senderId
   * @param {string} msg.senderName
   * @param {string} msg.content
   * @param {string[]} [msg.mentions]
   * @param {number} [msg.timestamp]
   * @returns {GroupMessage} 实际写入的消息
   */
  append(conversationId, msg) {
    if (!conversationId || !msg || typeof msg !== 'object') {
      logger.warn('group-history-store.append: 无效参数', { conversationId, msg });
      return null;
    }

    const fullMessage = {
      id: msg.id || this._generateId(),
      senderId: msg.senderId || '',
      senderName: msg.senderName || msg.senderId || '',
      content: msg.content || '',
      mentions: Array.isArray(msg.mentions) ? msg.mentions : [],
      timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
    };

    if (!this.groups.has(conversationId)) {
      this.groups.set(conversationId, []);
    }
    const messages = this.groups.get(conversationId);
    messages.push(fullMessage);

    // 超出上限时裁掉最旧的
    if (messages.length > MAX_MESSAGES_PER_GROUP) {
      this.groups.set(conversationId, messages.slice(-MAX_MESSAGES_PER_GROUP));
    }

    this.saveToDisk();
    return fullMessage;
  }

  // ─── 查询 ───────────────────────────────────────────────────

  /**
   * 获取某群聊最近 N 条消息
   * @param {string} conversationId - 群聊 ID
   * @param {number} [limit=50] - 返回条数
   * @returns {GroupMessage[]}
   */
  getRecent(conversationId, limit = 50) {
    if (!conversationId) return [];
    const messages = this.groups.get(conversationId) || [];
    if (limit > 0) {
      return messages.slice(-limit);
    }
    return messages.slice();
  }

  /**
   * 获取某群聊的全部消息
   * @param {string} conversationId - 群聊 ID
   * @returns {GroupMessage[]}
   */
  getAll(conversationId) {
    if (!conversationId) return [];
    const messages = this.groups.get(conversationId) || [];
    return messages.slice();
  }

  /**
   * 获取所有群聊的 ID 列表（调试/统计用）
   * @returns {string[]}
   */
  getAllGroupIds() {
    return Array.from(this.groups.keys());
  }

  /**
   * 清空某群聊的历史（测试/重置用）
   * @param {string} conversationId
   */
  clearGroup(conversationId) {
    if (this.groups.has(conversationId)) {
      this.groups.delete(conversationId);
      this.saveToDisk();
    }
  }

  /**
   * 清空所有群聊历史（测试/重置用）
   */
  clear() {
    this.groups = new Map();
    this.saveToDisk();
  }
}

// 单例
const groupHistoryStore = new GroupHistoryStore();

module.exports = {
  GroupHistoryStore,
  groupHistoryStore,
};
