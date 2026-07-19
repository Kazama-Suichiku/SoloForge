/**
 * AgentMailbox — 每 Agent 独立邮箱（Phase 1-A 新增）
 *
 * 核心数据结构（docs/refactor/multi-agent-architecture-plan.md）：
 *   - queue: MessageObject[]        — 消息对象（非闭包）
 *   - capacity: 64                  — 队列上限
 *   - processing: boolean           — 串行处理保证
 *   - pendingReplies: Map           — request 模式的待回复（由 MessageBus 管理，mailbox 仅暴露查询接口）
 *   - process()                     — 自主消费 + 完成后 MessageBus.reply
 *
 * 与 MessageBus 的关系：
 *   - MessageBus 持有所有 Mailbox 实例；Mailbox 通过 options.bus 回调 MessageBus。
 *   - Mailbox 只负责本地队列 + 串行调度；真正的 reply 等待 / 超时由 MessageBus 管。
 *   - Mailbox 的 handler 由 MessageBus.subscribe 注册，是 Agent 真正处理消息的入口。
 *
 * 串行保证：
 *   - process() 是幂等的：如果已在处理，直接返回；否则取一条处理，完成后递归。
 *   - 每条消息处理完才会处理下一条（同一 Agent 同时只处理一条）。
 *   - 这与 MessageQueue 的串行槽位一致——但 Mailbox 处理的是“消息对象”，
 *     MessageQueue 处理的是“闭包任务”。两者通过 AgentMessaging/TaskDelegation
 *     的宿主层协调（sendMessage 仍把 executeTask 闭包入 MessageQueue，
 *     同时通过 MessageBus 投递消息对象到 mailbox）。
 *
 * @module collaboration/agent-mailbox
 */

const { logger } = require('../utils/logger');

const DEFAULT_MAILBOX_CAPACITY = 64;

class AgentMailbox {
  /**
   * @param {string} agentId
   * @param {Object} [options]
   * @param {number} [options.capacity=64]
   * @param {Object} [options.bus] — MessageBus 引用（用于 reply 回调）
   */
  constructor(agentId, options = {}) {
    this.agentId = agentId;
    this.capacity = options.capacity ?? DEFAULT_MAILBOX_CAPACITY;
    /** @type {Object[]} */
    this.queue = [];
    /** @type {boolean} */
    this.processing = false;
    /** @type {Function|null} — handler(message) => replyContent | Promise<replyContent> | void */
    this.handler = null;
    /** @type {Object|null} — MessageBus 引用 */
    this.bus = options.bus || null;

    // 已处理消息缓存（用于 reply 查找原消息；保留最近 256 条）
    /** @type {Map<string, Object>} */
    this._processed = new Map();
    this._processedOrder = [];
    this._processedLimit = 256;

    // 统计
    this._stats = {
      enqueued: 0,
      processed: 0,
      failed: 0,
      overflowed: 0,
    };
  }

  /**
   * 注册消息处理函数
   * @param {Function|null} handler
   */
  setHandler(handler) {
    this.handler = handler;
    // handler 注册后，如果队列里有积压，触发一次处理
    if (handler) {
      this.process().catch((err) => {
        logger.error(`AgentMailbox[${this.agentId}].process 异常`, err);
      });
    }
  }

  /**
   * 入队一条消息对象
   * @param {Object} message — 完整消息对象
   * @returns {{ok: true} | {ok: false, error: string}}
   */
  enqueue(message) {
    if (this.queue.length >= this.capacity) {
      this._stats.overflowed += 1;
      return {
        ok: false,
        error: `Agent ${this.agentId} 邮箱已满（${this.queue.length}/${this.capacity}）`,
      };
    }
    // 按优先级插入（priority 数字小=优先；同优先级 FIFO）
    // 简化实现：直接 push，process 时再排序。对小队列足够。
    this.queue.push(message);
    this._stats.enqueued += 1;
    return { ok: true };
  }

  /**
   * 串行处理队列。如果已在处理则直接返回（幂等）。
   */
  async process() {
    if (this.processing) return;
    if (!this.handler) return; // 没注册 handler，等订阅后再处理
    if (this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      // 优先级调度：取 priority 最小（同优先级 FIFO）
      let idx = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i].priority < this.queue[idx].priority) {
          idx = i;
        }
      }
      const message = this.queue.splice(idx, 1)[0];

      // 记录到已处理缓存（供 reply 查找原消息）
      this._remember(message);

      try {
        const result = await this._invokeHandler(message);

        // 如果原消息 mode='sync'（即 request），需要把回复交回 MessageBus
        if (message.mode === 'sync' && this.bus && typeof this.bus.reply === 'function') {
          await this.bus.reply(message.id, result, { from: this.agentId });
        }
        // async (publish) 模式：不回复，丢弃结果

        this._stats.processed += 1;
      } catch (err) {
        this._stats.failed += 1;
        logger.error(`AgentMailbox[${this.agentId}] 处理消息失败: ${message.id}`, err);

        // 即使出错也要回复一个错误，避免 request 永久挂起
        if (message.mode === 'sync' && this.bus && typeof this.bus.reply === 'function') {
          try {
            await this.bus.reply(message.id, { success: false, error: err.message }, {
              from: this.agentId,
            });
          } catch (replyErr) {
            logger.debug(`AgentMailbox[${this.agentId}] reply 失败: ${message.id}`, replyErr);
          }
        }
      }
    }

    this.processing = false;
  }

  /**
   * 调用 handler。handler 可能是：
   *   - 同步返回值
   *   - 同步返回 Promise
   *   - void（无返回）
   */
  async _invokeHandler(message) {
    if (!this.handler) return undefined;
    const result = await this.handler(message);
    return result;
  }

  /**
   * 把已处理消息记入缓存，供后续 reply 查找
   */
  _remember(message) {
    this._processed.set(message.id, message);
    this._processedOrder.push(message.id);
    if (this._processedOrder.length > this._processedLimit) {
      const evict = this._processedOrder.shift();
      if (evict) this._processed.delete(evict);
    }
  }

  /**
   * 根据 id 查找消息（先查队列，再查已处理缓存）
   * @param {string} id
   * @returns {Object|undefined}
   */
  findMessage(id) {
    for (const m of this.queue) {
      if (m.id === id) return m;
    }
    return this._processed.get(id);
  }

  /**
   * 当前队列长度
   */
  size() {
    return this.queue.length;
  }

  /**
   * 是否正在处理
   */
  isProcessing() {
    return this.processing;
  }

  /**
   * 清空队列 + 已处理缓存（开除/重置时调用）
   */
  clear() {
    this.queue = [];
    this.processing = false;
    this._processed.clear();
    this._processedOrder = [];
    logger.debug(`AgentMailbox[${this.agentId}] 已清空`, {
      stats: this._stats,
    });
  }

  /**
   * 诊断快照
   */
  snapshot() {
    return {
      agentId: this.agentId,
      size: this.queue.length,
      capacity: this.capacity,
      processing: this.processing,
      hasHandler: !!this.handler,
      stats: { ...this._stats },
    };
  }
}

module.exports = {
  AgentMailbox,
  DEFAULT_MAILBOX_CAPACITY,
};
