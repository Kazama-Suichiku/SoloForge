/**
 * SoloForge - 通信事件存储（Phase 2-B）
 *
 * 每次 Agent 通信（send_to_agent / notify_boss / delegate_task / post_to_department）
 * 都即时写一条结构化事件记录，不依赖 LLM 提取。
 *
 * 阶段 2-B 升级：从 JSON 文件存储改为 SQLite 持久化。
 *   - 复用同目录下的 memory.db（better-sqlite3 WAL 模式），在库内加一张
 *     comm_events 表 + 4 个索引，减少文件数量。
 *   - comm-event-store 自己管理一条独立的 better-sqlite3 连接（sqlite-store.js
 *     不改动），WAL 模式下多连接并发读写安全。
 *   - 首次加载时如果 SQLite 空但旧的 communication-events.json 存在，
 *     自动从 JSON 迁移全部事件批量 INSERT。
 *   - saveToDisk() / saveToDiskSync() 退化为 no-op + WAL checkpoint(TRUNCATE)，
 *     SQLite 已自动持久化。
 *
 * 职责（接口与 Phase 1-B 完全一致，调用方无需改动）：
 *   - append(event)              INSERT 一条事件
 *   - getEventsForAgent(agentId) SELECT WHERE from_agent=? OR to_agent=?
 *   - getEventsBetween(a, b)     SELECT 双向 from/to
 *   - getGroupEvents(groupId)    SELECT WHERE group_id=?
 *   - getEventById(id)            SELECT WHERE id=? （阶段 3-B 溯源下钻）
 *   - getAll() / clear()          调试/测试用
 *   - loadFromDisk()             打开/建表 + JSON→SQLite 数据迁移
 *   - saveToDisk() / saveToDiskSync()  no-op（仅 WAL checkpoint）
 *   - reinitialize()             公司切换时关闭当前库并从新路径重新打开
 *
 * 持久化路径：~/.soloforge/data/<user>/<company>/memory.db（comm_events 表）
 * 历史兼容：~/.soloforge/data/<user>/<company>/communication-events.json
 *   首次迁移后该文件保留不删，便于回滚核查。
 *
 * @module collaboration/comm-event-store
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

// 内存中最多保留的事件条数（与 agent-communication 的 messages.slice(-500) 保持一致量级）
// SQLite 后这个上限主要用于 getAll() 的返回量上限，避免一次性吐出过多数据；
// 查询接口（getEventsForAgent 等）有自己的 limit 参数。
const MAX_EVENTS_IN_MEMORY = 500;

// 表结构 DDL（幂等：IF NOT EXISTS）
const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS comm_events (
    id TEXT PRIMARY KEY,
    type TEXT,
    from_agent TEXT,
    to_agent TEXT,
    content TEXT,
    response TEXT,
    trace_id TEXT,
    conversation_id TEXT,
    group_id TEXT,
    timestamp INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_comm_from ON comm_events(from_agent)`,
  `CREATE INDEX IF NOT EXISTS idx_comm_to ON comm_events(to_agent)`,
  `CREATE INDEX IF NOT EXISTS idx_comm_group ON comm_events(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comm_time ON comm_events(timestamp)`,
];

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
 * 通信事件存储管理器（SQLite 后端）
 */
class CommunicationEventStore {
  constructor() {
    /** @type {Database.Database|null} */
    this.db = null;
    /** @type {string|null} 当前数据库文件绝对路径 */
    this.dbPath = null;
    /** 当前是否已打开数据库 */
    this._opened = false;

    // 预编译语句（在 _open 中初始化）
    this._stmts = null;

    // 构造时打开库 + 建表 + 迁移
    this.loadFromDisk();
  }

  // ─── 路径辅助 ───────────────────────────────────────────────

  /**
   * 获取当前公司下的 memory.db 绝对路径
   * 与 memory/sqlite-store.js 的 _getDbPath() 对齐：
   *   ~/.soloforge/data/<acc>/<comp>/memory.db
   * 复用同一个 db 文件，在里面加 comm_events 表。
   * @returns {string}
   */
  _getDbPath() {
    const basePath = dataPath.getBasePath();
    return path.join(basePath, 'memory.db');
  }

  /**
   * 旧的 JSON 持久化文件路径（用于数据迁移）
   * @returns {string}
   */
  _getLegacyJsonPath() {
    const basePath = dataPath.getBasePath();
    return path.join(basePath, 'communication-events.json');
  }

  _ensureDataDir() {
    const dir = path.dirname(this._getDbPath());
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        logger.warn('comm-event-store: 创建数据目录失败:', error.message);
      }
    }
  }

  // ─── ID 生成 ─────────────────────────────────────────────────

  _generateId() {
    return `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ─── SQLite 打开/关闭 ───────────────────────────────────────

  /**
   * 打开数据库（WAL 模式）并建表 + 预编译语句
   * @private
   */
  _open() {
    if (this._opened && this.db) return;

    this._ensureDataDir();
    const dbPath = this._getDbPath();

    this.db = new Database(dbPath);
    this.dbPath = dbPath;
    this._opened = true;

    // WAL 模式 + 正常同步（兼顾性能与持久化）
    // 与 memory/sqlite-store.js 一致，多连接各自开 WAL 不会冲突
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    // comm_events 没有 FK 依赖，不强制开 foreign_keys

    // 建表（幂等）
    for (const ddl of DDL_STATEMENTS) {
      this.db.exec(ddl);
    }

    // 预编译语句
    this._prepareStatements();

    logger.info('通信事件 SQLite 库已打开', { path: dbPath });
  }

  /**
   * 预编译常用 SQL 语句
   */
  _prepareStatements() {
    const db = this.db;
    this._stmts = {
      insert: db.prepare(`
        INSERT INTO comm_events (
          id, type, from_agent, to_agent, content, response,
          trace_id, conversation_id, group_id, timestamp
        ) VALUES (
          @id, @type, @from_agent, @to_agent, @content, @response,
          @trace_id, @conversation_id, @group_id, @timestamp
        )
      `),
      countAll: db.prepare(`SELECT COUNT(*) AS c FROM comm_events`),
      getById: db.prepare(`SELECT * FROM comm_events WHERE id = ?`),
      deleteAll: db.prepare(`DELETE FROM comm_events`),
      // 查询用动态 SQL（带可选 since / limit），在方法里 build 后 prepare 缓存
      // 这里不预编译（参数组合多变），直接用 db.prepare(sql).all(...) 即可，
      // better-sqlite3 会自动缓存已编译的 statement。
    };
  }

  /**
   * 关闭数据库
   */
  close() {
    if (!this._opened || !this.db) return;
    try {
      // 退出前做一次 WAL checkpoint，把 WAL 写回主库
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (_e) {
      // 忽略 checkpoint 错误
    }
    try {
      this.db.close();
    } catch (e) {
      logger.warn('关闭通信事件 SQLite 库失败', { error: e.message });
    }
    this.db = null;
    this.dbPath = null;
    this._opened = false;
    this._stmts = null;
  }

  // ─── 行 <-> CommEvent 转换 ─────────────────────────────────

  /**
   * 数据库行 -> CommEvent（字段名从 snake_case 还原为 camelCase）
   * @param {Object} row
   * @returns {Object|null}
   */
  _rowToEvent(row) {
    if (!row) return null;
    return {
      id: row.id,
      type: row.type || 'message',
      from: row.from_agent ?? '',
      to: row.to_agent ?? '',
      content: row.content ?? '',
      response: row.response ?? '',
      traceId: row.trace_id ?? '',
      timestamp: typeof row.timestamp === 'number' ? row.timestamp : Date.now(),
      conversationId: row.conversation_id ?? '',
      // group_id 在 DB 里存的是 TEXT；私聊事件原值为 null，
      // better-sqlite3 会把 SQL NULL 还原为 null（不是字符串 'null'）
      groupId: row.group_id != null ? row.group_id : null,
    };
  }

  /**
   * CommEvent -> 数据库行参数
   * @param {Object} event
   * @returns {Object}
   */
  _eventToRow(event) {
    return {
      id: event.id,
      type: event.type || 'message',
      from_agent: event.from ?? '',
      to_agent: event.to ?? '',
      content: event.content ?? '',
      response: event.response ?? '',
      trace_id: event.traceId ?? '',
      conversation_id: event.conversationId ?? '',
      // groupId 为 null 时存 SQL NULL（便于 IS NULL 查询）
      group_id: event.groupId != null ? event.groupId : null,
      timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
    };
  }

  // ─── 持久化 ─────────────────────────────────────────────────

  /**
   * 从磁盘加载通信事件
   *
   * SQLite 后端：
   *   1. 打开/建表
   *   2. 如果 comm_events 表为空且旧 JSON 文件存在 → 迁移
   *
   * 不再把全量事件读进内存 this.events（查询直接走 SQLite）。
   * 保留 this.events = [] 仅作为向后兼容字段（ getAll 会走 DB）。
   */
  loadFromDisk() {
    try {
      this._open();
      this._migrateFromJsonIfNeeded();
      const count = this._stmts.countAll.get().c;
      logger.info('通信事件已加载（SQLite）', { count });
    } catch (error) {
      logger.error('加载通信事件失败（SQLite）', error);
    }
  }

  /**
   * 首次加载迁移：如果 SQLite 空但旧 communication-events.json 存在，
   * 从 JSON 读全部事件批量 INSERT 到 comm_events 表。
   * 幂等：只要 SQLite 非空就跳过（避免重复迁移）。
   * @private
   */
  _migrateFromJsonIfNeeded() {
    if (!this._opened || !this.db) return;

    const count = this._stmts.countAll.get().c;
    if (count > 0) return; // 已有数据，不迁移

    const jsonPath = this._getLegacyJsonPath();
    if (!fs.existsSync(jsonPath)) return;

    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const data = JSON.parse(raw);
      const events = Array.isArray(data) ? data : (Array.isArray(data.events) ? data.events : []);
      if (events.length === 0) return;

      // 批量 INSERT（单事务）
      const insertMany = this.db.transaction((rows) => {
        for (const e of rows) {
          // 补全字段（与 append 逻辑保持一致）
          const fullEvent = {
            id: e.id || this._generateId(),
            type: e.type || 'message',
            from: e.from || '',
            to: e.to || '',
            content: e.content || '',
            response: e.response || '',
            traceId: e.traceId || '',
            timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
            conversationId: e.conversationId || '',
            groupId: e.groupId != null ? e.groupId : null,
          };
          this._stmts.insert.run(this._eventToRow(fullEvent));
        }
      });
      insertMany(events);
      logger.info('通信事件已从 JSON 迁移到 SQLite', { migrated: events.length, jsonPath });
    } catch (error) {
      logger.warn('通信事件 JSON 迁移失败（不影响后续使用）', { error: error.message, jsonPath });
    }
  }

  /**
   * 异步防抖保存（SQLite 后端：no-op，仅做 WAL checkpoint）
   *
   * 保留方法签名是为了兼容调用方（append 里会调 saveToDisk）。
   * SQLite 在 INSERT 时已自动持久化，防抖无意义；这里只做一次轻量 checkpoint。
   */
  saveToDisk() {
    this._checkpoint();
  }

  /**
   * 同步保存（仅用于应用退出前，由 lifecycle flushAll 调用）
   * SQLite 后端：no-op + WAL checkpoint(TRUNCATE)，释放 WAL 文件便于备份。
   */
  saveToDiskSync() {
    this._checkpoint();
  }

  /**
   * WAL checkpoint(TRUNCATE)：把 WAL 写回主库并截断 WAL 文件
   * 失败静默忽略（checkpoint 不影响数据完整性，只影响 WAL 文件大小）
   * @private
   */
  _checkpoint() {
    if (!this._opened || !this.db) return;
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (_e) {
      // 忽略
    }
  }

  /**
   * 重新初始化（公司切换时调用）
   * 关闭当前库，从新路径重新打开 + 建表 + 迁移
   */
  reinitialize() {
    this.close();
    this.loadFromDisk();
  }

  // ─── 写入 ───────────────────────────────────────────────────

  /**
   * 追加一条通信事件（INSERT 到 comm_events 表）
   * @param {Partial<CommEvent>} event - 事件字段（缺省值会被补全）
   * @returns {CommEvent} 实际写入的事件
   */
  append(event) {
    if (!event || typeof event !== 'object') {
      logger.warn('comm-event-store.append: 无效事件', event);
      return null;
    }

    if (!this._opened) this._open();

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

    try {
      this._stmts.insert.run(this._eventToRow(fullEvent));
    } catch (error) {
      logger.error('通信事件写入 SQLite 失败', { id: fullEvent.id, error: error.message });
      // 失败时不抛出（与原 JSON 版本一致：通信事件记录失败不影响主流程）
    }

    return fullEvent;
  }

  // ─── 查询 ───────────────────────────────────────────────────

  /**
   * 查涉及某 Agent 的所有事件（from 或 to 等于 agentId）
   * @param {string} agentId
   * @param {{limit?: number, since?: number}} [options]
   *   - limit: 返回最近 N 条（默认 50）；<=0 表示不限制
   *   - since: 只返回 timestamp > since 的事件
   * @returns {CommEvent[]}
   */
  getEventsForAgent(agentId, options = {}) {
    if (!agentId) return [];
    if (!this._opened) this._open();

    const { limit = 50, since = 0 } = options;

    const where = [`(from_agent = ? OR to_agent = ?)`];
    const params = [agentId, agentId];
    if (since > 0) {
      where.push('timestamp > ?');
      params.push(since);
    }

    // 最近的排在最后（与 agentCommunication.messages 的顺序一致，便于 .slice(-N)）
    // tie-break: 同 timestamp 时按插入顺序（rowid）排，与原 JSON 版本的稳定排序语义一致
    //   （原 Array.sort 稳定 → push 顺序 → 最后插入的在最后；SQLite rowid 自增恰好对应）
    let sql = `SELECT * FROM comm_events WHERE ${where.join(' AND ')} ORDER BY timestamp ASC, rowid ASC`;
    if (limit > 0) {
      // 取最近 limit 条：用子查询倒序取 limit 再正序返回，保证"最近的在最后"
      // 子查询显式 SELECT rowid，否则外层引用 rowid 会报 "no such column"
      sql = `SELECT * FROM (
               SELECT *, rowid FROM comm_events WHERE ${where.join(' AND ')}
               ORDER BY timestamp DESC, rowid DESC LIMIT ?
             ) sub ORDER BY timestamp ASC, rowid ASC`;
      params.push(limit);
    }

    try {
      const rows = this.db.prepare(sql).all(...params);
      return rows.map((r) => this._rowToEvent(r));
    } catch (error) {
      logger.warn('getEventsForAgent 查询失败', { agentId, error: error.message });
      return [];
    }
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
    if (!this._opened) this._open();

    const { limit = 50 } = options;

    const where = `((from_agent = ? AND to_agent = ?) OR (from_agent = ? AND to_agent = ?))`;
    const params = [agentA, agentB, agentB, agentA];

    let sql = `SELECT * FROM comm_events WHERE ${where} ORDER BY timestamp ASC, rowid ASC`;
    if (limit > 0) {
      sql = `SELECT * FROM (
               SELECT *, rowid FROM comm_events WHERE ${where}
               ORDER BY timestamp DESC, rowid DESC LIMIT ?
             ) sub ORDER BY timestamp ASC, rowid ASC`;
      params.push(limit);
    }

    try {
      const rows = this.db.prepare(sql).all(...params);
      return rows.map((r) => this._rowToEvent(r));
    } catch (error) {
      logger.warn('getEventsBetween 查询失败', { agentA, agentB, error: error.message });
      return [];
    }
  }

  /**
   * 按 id 查单条通信事件（阶段 3-B 溯源下钻）。
   *
   * 用途：记忆条目存了 source_episode_id 指向原始通信事件 id，
   * 调用方拿到 episode_id 后用本方法取回原始通信内容/回复/traceId，
   * 实现 memory → comm_event 的可追溯链路。
   *
   * @param {string} id 通信事件 id（comm_events.id，形如 'evt-<ts>-<rand>'）
   * @returns {CommEvent|null} 事件对象；不存在时返回 null
   */
  getEventById(id) {
    if (!id) return null;
    if (!this._opened) this._open();
    try {
      const row = this._stmts.getById.get(id);
      return this._rowToEvent(row);
    } catch (error) {
      logger.warn('getEventById 查询失败', { id, error: error.message });
      return null;
    }
  }

  /**
   * 查群聊事件（groupId 相等的事件）
   * @param {string} groupId
   * @param {{limit?: number}} [options]
   * @returns {CommEvent[]}
   */
  getGroupEvents(groupId, options = {}) {
    if (!groupId) return [];
    if (!this._opened) this._open();

    const { limit = 50 } = options;

    const where = `group_id = ?`;
    const params = [groupId];

    let sql = `SELECT * FROM comm_events WHERE ${where} ORDER BY timestamp ASC, rowid ASC`;
    if (limit > 0) {
      sql = `SELECT * FROM (
               SELECT *, rowid FROM comm_events WHERE ${where}
               ORDER BY timestamp DESC, rowid DESC LIMIT ?
             ) sub ORDER BY timestamp ASC, rowid ASC`;
      params.push(limit);
    }

    try {
      const rows = this.db.prepare(sql).all(...params);
      return rows.map((r) => this._rowToEvent(r));
    } catch (error) {
      logger.warn('getGroupEvents 查询失败', { groupId, error: error.message });
      return [];
    }
  }

  /**
   * 获取所有事件（调试/统计用，受 MAX_EVENTS_IN_MEMORY 上限）
   * @returns {CommEvent[]}
   */
  getAll() {
    if (!this._opened) this._open();
    try {
      // tie-break: rowid 作为插入顺序兜底，与原 JSON 版本稳定排序一致
      const rows = this.db
        .prepare(`SELECT * FROM comm_events ORDER BY timestamp DESC, rowid DESC LIMIT ?`)
        .all(MAX_EVENTS_IN_MEMORY);
      // 还原为时间正序（最近的在最后），与原 JSON 版本一致
      return rows.reverse().map((r) => this._rowToEvent(r));
    } catch (error) {
      logger.warn('getAll 查询失败', { error: error.message });
      return [];
    }
  }

  /**
   * 清空所有事件（测试/重置用）
   */
  clear() {
    if (!this._opened) this._open();
    try {
      this._stmts.deleteAll.run();
    } catch (error) {
      logger.warn('清空通信事件失败', { error: error.message });
    }
  }
}

// 单例
const commEventStore = new CommunicationEventStore();

module.exports = {
  CommunicationEventStore,
  commEventStore,
};
