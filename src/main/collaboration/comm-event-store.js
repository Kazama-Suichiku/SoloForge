/**
 * SoloForge - 通信事件存储（Phase 1-B）
 *
 * 每次 Agent 通信（send_to_agent / notify_boss / delegate_task / post_to_department）
 * 都即时写一条结构化事件记录，不依赖 LLM 提取。
 *
 * 职责：
 *   - append(event)              写入事件 + 防抖持久化
 *   - getEventsForAgent(agentId) 查涉及该 Agent 的所有事件（from 或 to）
 *   - getEventsBetween(a, b)    查两人之间的通信
 *   - getGroupEvents(groupId)    查群聊事件
 *   - loadFromDisk() / saveToDisk() 持久化到 communication-events.json
 *
 * 持久化路径：~/.soloforge/data/<user>/<company>/communication-events.json
 * 与 agent-config-store.js / agent-communication.js 保持相同的持久化风格：
 *   - 构造时 loadFromDisk()
 *   - saveToDisk() 异步防抖（DEBOUNCE_MS）
 *   - saveToDiskSync() 同步刷盘（退出时由 lifecycle flushAll 调用）
 *   - reinitialize() 公司切换时清空内存并从新路径重新加载
 *
 * @module collaboration/comm-event-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');
const { atomicWrite, atomicWriteSync } = require('../utils/atomic-write');

// 防抖保存：与 agent-communication.js 的 2000ms 保持一致
let _eventSaveTimer = null;
const EVENT_SAVE_DEBOUNCE_MS = 2000;

// 内存中最多保留的事件条数（与 agent-communication 的 messages.slice(-500) 保持一致量级）
const MAX_EVENTS_IN_MEMORY = 500;

/**
 * @typedef {Object} CommEvent
 * @property {string} id             - 事件 ID，格式 'evt-<timestamp>-<rand>'
 * @property {'message'|'report'|'delegation'|'group_post'} type - 事件类型
 * @property {string} from           - 发起方 Agent ID
 * @property {string} to            - 接收方 Agent ID 或群聊 ID（group_post 时等于 groupId）
 * @property {string} content       - 通信内容
 * @property {string} response       - 回复内容（如果有，默认 ''）
 * @property {string} traceId        - 链路追踪 ID（默认 ''，Phase 5 接入）
 * @property {number} timestamp      - 事件时间戳（Date.now()）
 * @property {string} conversationId - 会话 ID（私聊 or 群聊）
 * @property {string|null} groupId  - 群聊 ID（私聊为 null）
 */

/**
 * 通信事件存储管理器
 */
class CommunicationEventStore {
  constructor() {
    /** @type {CommEvent[]} */
    this.events = [];
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
        logger.warn('comm-event-store: 创建数据目录失败:', error.message);
      }
    }
  }

  _getFilePath() {
    return path.join(dataPath.getBasePath(), 'communication-events.json');
  }

  // ─── ID 生成 ─────────────────────────────────────────────────

  _generateId() {
    return `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ─── 持久化 ─────────────────────────────────────────────────

  /**
   * 从磁盘加载通信事件
   */
  loadFromDisk() {
    try {
      const filePath = this._getFilePath();
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const loaded = Array.isArray(data) ? data : (Array.isArray(data.events) ? data.events : []);
        this.events = loaded.slice(-MAX_EVENTS_IN_MEMORY);
        logger.info('通信事件已加载', { count: this.events.length });
      } else {
        this.events = [];
      }
    } catch (error) {
      logger.error('加载通信事件失败', error);
      this.events = [];
    }
  }

  /**
   * 异步防抖保存
   */
  saveToDisk() {
    if (_eventSaveTimer) {
      clearTimeout(_eventSaveTimer);
    }
    _eventSaveTimer = setTimeout(() => {
      _eventSaveTimer = null;
      this._doSave();
    }, EVENT_SAVE_DEBOUNCE_MS);
  }

  /**
   * 实际执行保存（异步原子写入，不阻塞主进程）
   * @private
   */
  _doSave() {
    try {
      this._ensureDataDir();
      const content = JSON.stringify(
        { events: this.events.slice(-MAX_EVENTS_IN_MEMORY) },
        null,
        2
      );
      atomicWrite(this._getFilePath(), content).catch((error) => {
        logger.error('保存通信事件失败', error);
      });
    } catch (error) {
      logger.error('保存通信事件失败', error);
    }
  }

  /**
   * 同步保存（仅用于应用退出前，由 lifecycle flushAll 调用）
   */
  saveToDiskSync() {
    try {
      this._ensureDataDir();
      const content = JSON.stringify(
        { events: this.events.slice(-MAX_EVENTS_IN_MEMORY) },
        null,
        2
      );
      atomicWriteSync(this._getFilePath(), content);
      logger.info('通信事件已同步保存');
    } catch (error) {
      logger.error('同步保存通信事件失败', error);
    }
  }

  /**
   * 重新初始化（公司切换时调用）
   * 清空内存状态并从新路径重新加载
   */
  reinitialize() {
    this.events = [];
    this._ensureDataDir();
    this.loadFromDisk();
  }

  // ─── 写入 ───────────────────────────────────────────────────

  /**
   * 追加一条通信事件，并触发防抖持久化
   * @param {Partial<CommEvent>} event - 事件字段（缺省值会被补全）
   * @returns {CommEvent} 实际写入的事件
   */
  append(event) {
    if (!event || typeof event !== 'object') {
      logger.warn('comm-event-store.append: 无效事件', event);
      return null;
    }

    const fullEvent = {
      id: event.id || this._generateId(),
      type: event.type || 'message',
      from: event.from || '',
      to: event.to || '',
      content: event.content || '',
      response: event.response || '',
      traceId: event.traceId || '',
      timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
      conversationId: event.conversationId || '',
      groupId: event.groupId != null ? event.groupId : null,
    };

    this.events.push(fullEvent);

    // 超出上限时裁掉最旧的（保持环形缓冲语义，与 agent-communication.slice(-500) 一致）
    if (this.events.length > MAX_EVENTS_IN_MEMORY) {
      this.events = this.events.slice(-MAX_EVENTS_IN_MEMORY);
    }

    this.saveToDisk();
    return fullEvent;
  }

  // ─── 查询 ───────────────────────────────────────────────────

  /**
   * 查涉及某 Agent 的所有事件（from 或 to 等于 agentId）
   * @param {string} agentId
   * @param {{limit?: number, since?: number}} [options]
   *   - limit: 返回最近 N 条（默认 50）
   *   - since: 只返回 timestamp > since 的事件
   * @returns {CommEvent[]}
   */
  getEventsForAgent(agentId, options = {}) {
    if (!agentId) return [];
    const { limit = 50, since = 0 } = options;

    let matched = this.events.filter(
      (e) =>
        (e.from === agentId || e.to === agentId) &&
        e.timestamp > since
    );

    // 最近的排在最后（与 agentCommunication.messages 的顺序一致，便于 .slice(-N)）
    matched.sort((a, b) => a.timestamp - b.timestamp);

    if (limit > 0) {
      matched = matched.slice(-limit);
    }
    return matched;
  }

  /**
   * 查两个 Agent 之间的通信事件（双向：from/to 任一方向）
   * @param {string} agentA
   * @param {string} agentB
   * @param {{limit?: number}} [options]
   * @returns {CommEvent[]}
   */
  getEventsBetween(agentA, agentB, options = {}) {
    if (!agentA || !agentB) return [];
    const { limit = 50 } = options;

    let matched = this.events.filter(
      (e) =>
        (e.from === agentA && e.to === agentB) ||
        (e.from === agentB && e.to === agentA)
    );

    matched.sort((a, b) => a.timestamp - b.timestamp);

    if (limit > 0) {
      matched = matched.slice(-limit);
    }
    return matched;
  }

  /**
   * 查群聊事件（groupId 相等的 group_post 事件）
   * @param {string} groupId
   * @param {{limit?: number}} [options]
   * @returns {CommEvent[]}
   */
  getGroupEvents(groupId, options = {}) {
    if (!groupId) return [];
    const { limit = 50 } = options;

    let matched = this.events.filter((e) => e.groupId === groupId);

    matched.sort((a, b) => a.timestamp - b.timestamp);

    if (limit > 0) {
      matched = matched.slice(-limit);
    }
    return matched;
  }

  /**
   * 获取所有事件（调试/统计用）
   * @returns {CommEvent[]}
   */
  getAll() {
    return this.events.slice();
  }

  /**
   * 清空所有事件（测试/重置用）
   */
  clear() {
    this.events = [];
    this.saveToDisk();
  }
}

// 单例
const commEventStore = new CommunicationEventStore();

module.exports = {
  CommunicationEventStore,
  commEventStore,
};
