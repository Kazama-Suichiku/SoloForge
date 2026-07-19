/**
 * MessageQueue — Agent 间消息队列与并发控制
 *
 * 从 agent-communication.js 拆出。职责：
 *   - 每个 Agent 串行处理任务（同一 Agent 同时只处理一个）
 *   - 队列长度上限（防止积压）
 *   - priority 字段生效（priority 数字越小优先级越高；默认 FIFO）
 *
 * 修复点（相对原 _enqueue/_processQueue）：
 *   1. 队列长度上限：超过 maxQueueLength 时拒绝入队
 *   2. priority 生效：入队时携带 priority，处理时按 priority 排序（同优先级 FIFO）
 *      通过环境变量 MESSAGE_QUEUE_PRIORITY=on 开启（默认 off，保持原 FIFO 行为）
 *   3. clearAgentQueues：拒绝所有排队中的任务（原逻辑保留）
 *
 * 注意：本模块不直接依赖 agent-communication，由 AgentCommunicationManager 持有实例。
 *
 * @module collaboration/message-queue
 */

const { logger } = require('../utils/logger');

// 默认队列长度上限（每个 Agent）。超过则拒绝入队，防止积压。
const DEFAULT_MAX_QUEUE_LENGTH = 32;

// 是否启用优先级调度。默认关闭，保持原 FIFO 行为，避免行为变更。
const PRIORITY_ENABLED = String(process.env.MESSAGE_QUEUE_PRIORITY || 'off').toLowerCase() === 'on';

/**
 * @typedef {Object} QueueItem
 * @property {Function} task - 异步任务函数
 * @property {Function} resolve - Promise resolve
 * @property {Function} reject - Promise reject
 * @property {number} priority - 优先级（数字越小越高），默认 3
 * @property {number} seq - 入队序号（FIFO 兜底）
 */

class MessageQueue {
  constructor(options = {}) {
    /** @type {Map<string, QueueItem[]>} */
    this._agentQueues = new Map();
    /** @type {Map<string, boolean>} */
    this._agentProcessing = new Map();
    /** @type {Map<string, number>} - 每个 Agent 的入队序号 */
    this._agentSeq = new Map();
    this.maxQueueLength = options.maxQueueLength || DEFAULT_MAX_QUEUE_LENGTH;
    this.priorityEnabled = options.priorityEnabled ?? PRIORITY_ENABLED;
  }

  /**
   * 将任务加入 Agent 的消息队列
   * @param {string} agentId - 目标 Agent ID
   * @param {Function} task - 异步任务函数
   * @param {Object} [opts]
   * @param {number} [opts.priority=3] - 优先级（1-5，1 最高）
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
      queue.push({ task, resolve, reject, priority, seq });

      // 尝试处理队列
      this._processQueue(agentId);
    });
  }

  /**
   * 处理 Agent 的消息队列
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

    const { task, resolve, reject } = queue.shift();

    try {
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
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

    // 拒绝所有排队中的任务
    for (const { reject } of queue) {
      try {
        reject(new Error('Agent 已被开除，任务已取消'));
      } catch (e) {
        // 忽略 reject 时的错误
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
}

module.exports = {
  MessageQueue,
  DEFAULT_MAX_QUEUE_LENGTH,
};
