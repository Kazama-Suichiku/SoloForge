/**
 * MessageQueue — Agent 间消息队列与并发控制
 *
 * Phase 1-A 重构：从闭包队列改为消息对象队列。
 *
 * 内部存储：
 *   - 每个队列项现在是一个“消息对象”（message object），与 message-bus.js 的
 *     消息格式对齐：{ id, traceId, parentSpanId, from, to, type, content, mode,
 *     replyTo, conversationId, createdAt, priority, metadata, _task?, _resolve?,
 *     _reject? }
 *
 * 对外接口兼容：
 *   - enqueue(agentId, task, opts) — 旧 API：传入闭包任务。内部包装为消息对象
 *     （type='legacy'，content=任务描述，_task=闭包），保持现有调用方
 *     (agent-messaging.js 的 host.queue.enqueue) 不受影响。
 *   - enqueueMessage(agentId, message) — 新 API：直接入队消息对象（Phase 1-A 起，
 *     MessageBus/AgentMailbox 可使用，但目前 MessageBus 自带 mailbox 队列，本方法
 *     留作未来切换到统一队列时使用）。
 *   - dequeue(agentId) — 新 API：取出一条消息对象（优先级排序后）。
 *
 * 保留原有行为：
 *   - 每个 Agent 串行处理（同一 Agent 同时只处理一个）
 *   - 队列长度上限（防止积压）
 *   - priority 字段生效（priority 数字越小优先级越高；默认 FIFO）
 *   - clearAgentQueues：拒绝所有排队中的任务
 *
 * @module collaboration/message-queue
 */

const { logger } = require('../utils/logger');

// 默认队列长度上限（每个 Agent）。超过则拒绝入队，防止积压。
const DEFAULT_MAX_QUEUE_LENGTH = 32;

// 是否启用优先级调度。默认关闭，保持原 FIFO 行为，避免行为变更。
const PRIORITY_ENABLED = String(process.env.MESSAGE_QUEUE_PRIORITY || 'off').toLowerCase() === 'on';

/**
 * 生成消息 ID（与 message-bus.js 风格一致）
 */
function generateMessageId() {
  return `mq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @typedef {Object} QueueMessage
 * @property {string} id
 * @property {string} traceId
 * @property {string} parentSpanId
 * @property {string} from
 * @property {string} to
 * @property {string} type - 'legacy' | 'message' | 'delegation' | 'broadcast' | 'reply'
 * @property {*} content - 消息内容（legacy 模式下是任务描述字符串）
 * @property {'async'|'sync'} mode
 * @property {string|null} replyTo
 * @property {string} conversationId
 * @property {number} createdAt
 * @property {number} priority
 * @property {Object} metadata
 * @property {Function} [_task] - legacy 模式：闭包任务
 * @property {Function} [_resolve] - legacy 模式：Promise resolve
 * @property {Function} [_reject] - legacy 模式：Promise reject
 * @property {number} seq - 入队序号（FIFO 兜底）
 */

class MessageQueue {
  constructor(options = {}) {
    /** @type {Map<string, QueueMessage[]>} */
    this._agentQueues = new Map();
    /** @type {Map<string, boolean>} */
    this._agentProcessing = new Map();
    /** @type {Map<string, number>} - 每个 Agent 的入队序号 */
    this._agentSeq = new Map();
    this.maxQueueLength = options.maxQueueLength || DEFAULT_MAX_QUEUE_LENGTH;
    this.priorityEnabled = options.priorityEnabled ?? PRIORITY_ENABLED;
  }

  /**
   * 将任务加入 Agent 的消息队列（旧 API，向后兼容）。
   *
   * 内部把闭包包装成消息对象（type='legacy'），存入队列。处理时执行 _task 闭包，
   * 用 _resolve/_reject 回传结果。
   *
   * @param {string} agentId - 目标 Agent ID
   * @param {Function} task - 异步任务函数（闭包）
   * @param {Object} [opts]
   * @param {number} [opts.priority=3] - 优先级（1-5，1 最高）
   * @param {Object} [opts.message] - 可选：如果调用方已经有消息对象，可直接传入
   * @returns {Promise<any>} 任务执行结果
   */
  enqueue(agentId, task, opts = {}) {
    const priority = opts.priority ?? 3;
    return new Promise((resolve, reject) => {
      if (!this._agentQueues.has(agentId)) {
        this._agentQueues.set(agentId, []);
        this._agentSeq.set(agentId, 0);
      }
      const queue = this._agentQueues.get(agentId);

      // 长度上限检查
      if (queue.length >= this.maxQueueLength) {
        reject(
          new Error(`Agent ${agentId} 消息队列已满（${queue.length}/${this.maxQueueLength}），请稍后重试`)
        );
        return;
      }

      const seq = this._agentSeq.get(agentId) + 1;
      this._agentSeq.set(agentId, seq);

      // 包装成消息对象（与 Phase 1-A 消息格式对齐）
      const messageObj = {
        id: generateMessageId(),
        traceId: '',
        parentSpanId: '',
        from: '',
        to: agentId,
        type: 'legacy',
        content: '',
        mode: 'async',
        replyTo: null,
        conversationId: '',
        createdAt: Date.now(),
        priority,
        metadata: { callChain: [], nestingDepth: 0, timeout: 120000 },
        // legacy 闭包字段
        _task: task,
        _resolve: resolve,
        _reject: reject,
        seq,
      };
      // 如果调用方传了 message 字段，合并进来（用于 trace 透传）
      if (opts.message && typeof opts.message === 'object') {
        messageObj.traceId = opts.message.traceId || '';
        messageObj.parentSpanId = opts.message.parentSpanId || '';
        messageObj.conversationId = opts.message.conversationId || '';
      }

      queue.push(messageObj);

      // 尝试处理队列
      this._processQueue(agentId);
    });
  }

  /**
   * 入队一个消息对象（新 API，Phase 1-A 起 MessageBus 可用）。
   *
   * 与 enqueue 不同：不返回 Promise（fire-and-forget 由调用方决定），
   * 直接把消息对象存入队列。处理时需要调用方通过 dequeue 自行消费。
   *
   * @param {string} agentId
   * @param {Object} message - 消息对象
   * @returns {{ok: true, messageId: string} | {ok: false, error: string}}
   */
  enqueueMessage(agentId, message) {
    if (!this._agentQueues.has(agentId)) {
      this._agentQueues.set(agentId, []);
      this._agentSeq.set(agentId, 0);
    }
    const queue = this._agentQueues.get(agentId);
    if (queue.length >= this.maxQueueLength) {
      return {
        ok: false,
        error: `Agent ${agentId} 消息队列已满（${queue.length}/${this.maxQueueLength}）`,
      };
    }
    const seq = this._agentSeq.get(agentId) + 1;
    this._agentSeq.set(agentId, seq);

    const messageObj = {
      ...message,
      id: message.id || generateMessageId(),
      createdAt: message.createdAt || Date.now(),
      priority: message.priority ?? 3,
      seq,
    };
    queue.push(messageObj);
    return { ok: true, messageId: messageObj.id };
  }

  /**
   * 从队列中取出一条消息对象（新 API）。按优先级排序。
   *
   * 注意：取出后不会自动执行。legacy 闭包任务仍由 _processQueue 自动执行。
   *
   * @param {string} agentId
   * @returns {Object|undefined}
   */
  dequeue(agentId) {
    const queue = this._agentQueues.get(agentId);
    if (!queue || queue.length === 0) return undefined;

    if (this.priorityEnabled && queue.length > 1) {
      let idx = 0;
      for (let i = 1; i < queue.length; i++) {
        if (queue[i].priority < queue[idx].priority) idx = i;
        else if (queue[i].priority === queue[idx].priority && queue[i].seq < queue[idx].seq) idx = i;
      }
      return queue.splice(idx, 1)[0];
    }
    return queue.shift();
  }

  /**
   * 处理 Agent 的消息队列（legacy 闭包执行入口）。
   *
   * 内部仍执行 _task 闭包（旧路径），保证 agent-messaging.js 的 host.queue.enqueue
   * 行为不变。新消息对象路径由 dequeue + 外部消费驱动。
   *
   * @param {string} agentId - Agent ID
   */
  async _processQueue(agentId) {
    // 如果该 Agent 正在处理，退出（当前任务完成后会继续处理队列）
    if (this._agentProcessing.get(agentId)) {
      return;
    }

    let queue = this._agentQueues.get(agentId);
    if (!queue || queue.length === 0) {
      return;
    }

    // 优先级调度：取出优先级最高（数字最小）的项；同优先级按入队顺序
    if (this.priorityEnabled && queue.length > 1) {
      queue.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.seq - b.seq;
      });
    }

    // 标记正在处理
    this._agentProcessing.set(agentId, true);

    const messageObj = queue.shift();
    // 旧路径：执行 _task 闭包
    const { _task, _resolve, _reject } = messageObj;

    try {
      // 如果是 legacy 闭包任务，执行它
      if (typeof _task === 'function') {
        const result = await _task();
        if (typeof _resolve === 'function') _resolve(result);
      } else {
        // 非闭包消息对象：跳过（由 dequeue 外部消费）。这里不做任何处理，
        // 但仍标记 _agentProcessing=false 以便后续 _processQueue 能继续。
        logger.debug(`MessageQueue: 跳过非闭包消息对象 ${messageObj.id}`, {
          agentId,
          type: messageObj.type,
        });
      }
    } catch (error) {
      if (typeof _reject === 'function') _reject(error);
    } finally {
      // 标记处理完成
      this._agentProcessing.set(agentId, false);
      // 使用 setImmediate 让出事件循环，然后继续处理队列中的下一个任务
      setImmediate(() => this._processQueue(agentId));
    }
  }

  /**
   * 清理指定 Agent 的消息队列（开除时调用）
   * @param {string} agentId - 要清理的 Agent ID
   * @returns {{queueCleared: number, wasProcessing: boolean}}
   */
  clearAgentQueues(agentId) {
    const queue = this._agentQueues.get(agentId) || [];
    const queueCleared = queue.length;

    // 拒绝所有排队中的任务（legacy 闭包任务有 _reject）
    for (const messageObj of queue) {
      if (typeof messageObj._reject === 'function') {
        try {
          messageObj._reject(new Error('Agent 已被开除，任务已取消'));
        } catch (e) {
          // 忽略 reject 时的错误
        }
      }
    }

    const wasProcessing = this._agentProcessing.get(agentId) || false;
    this._agentQueues.delete(agentId);
    this._agentProcessing.delete(agentId);
    this._agentSeq.delete(agentId);

    if (queueCleared > 0 || wasProcessing) {
      logger.info(`MessageQueue: 已清理 Agent ${agentId} 的通信队列`, {
        queueCleared,
        wasProcessing,
      });
    }

    return { queueCleared, wasProcessing };
  }

  /**
   * 清空所有队列（reinitialize 时调用）
   */
  clearAll() {
    this._agentQueues.clear();
    this._agentProcessing.clear();
    this._agentSeq.clear();
  }

  /**
   * 获取队列长度（用于诊断）
   */
  getQueueLength(agentId) {
    const queue = this._agentQueues.get(agentId);
    return queue ? queue.length : 0;
  }

  /**
   * 判断 Agent 是否正在处理任务
   */
  isProcessing(agentId) {
    return this._agentProcessing.get(agentId) || false;
  }

  /**
   * 诊断：返回所有队列的消息对象快照（不含闭包字段）
   */
  snapshot() {
    const result = {};
    for (const [agentId, queue] of this._agentQueues) {
      result[agentId] = queue.map((m) => ({
        id: m.id,
        type: m.type,
        from: m.from,
        to: m.to,
        priority: m.priority,
        mode: m.mode,
        conversationId: m.conversationId,
        createdAt: m.createdAt,
      }));
    }
    return result;
  }
}

module.exports = {
  MessageQueue,
  DEFAULT_MAX_QUEUE_LENGTH,
};
