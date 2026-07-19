/**
 * MessageBus — Agent 间事件总线（Phase 1-A 新增）
 *
 * 核心抽象：Actor 模型 + 事件总线 + 每Agent 独立邮箱。
 *   - publish(target, message)       — fire-and-forget，不等待回复
 *   - request(target, message, timeout) — 请求-响应，等待回复
 *   - broadcast(targets[], message)  — 并行广播（不等任何回复）
 *   - subscribe(agentId, handler)    — Agent 订阅自己邮箱
 *   - reply(replyTo, content)        — 回复某条消息
 *
 * 消息对象格式（docs/refactor/multi-agent-architecture-plan.md）：
 *   {
 *     id, traceId, parentSpanId, from, to, type, content, mode,
 *     replyTo, conversationId, createdAt, priority,
 *     metadata: { callChain, nestingDepth, timeout }
 *   }
 *
 * 与现有系统的关系：
 *   - MessageBus 不替代 MessageQueue（message-queue.js）。MessageQueue 仍是
 *     Agent 串行处理槽位 + 容量上限的实现；AgentMailbox 内部使用一个本地队列，
 *     但真正的串行执行由调用方（AgentMessaging / TaskDelegation）通过 host.queue
 *     保证。Mailbox 负责消息存储 + 串行消费调度。
 *   - 每条消息携带 traceId + parentSpanId，来源是 trace-context 模块。
 *     Phase 5-A 的 TraceStore 将替换 trace-context 的内部实现，但接口不变。
 *   - subscribe 注册的处理函数会被每个 mailbox 调用以处理入队消息。
 *
 * 线程模型：
 *   - publish/broadcast 返回 Promise（异步入队），不阻塞调用方。
 *   - request 返回 Promise，内部 pendingReplies 等 reply 回调，超时后 reject。
 *   - mailbox.process() 是串行的，每 Agent 同时只处理一个消息。
 *
 * @module collaboration/message-bus
 */

const { logger } = require('../utils/logger');
const { createTraceContext, currentTraceContext } = require('./trace-context');
const { AgentMailbox, DEFAULT_MAILBOX_CAPACITY } = require('./agent-mailbox');
// Phase 5-A：跨 Agent 全链路追踪。publish/request/broadcast 时在 TraceStore
// 记一条子 span（operation='message'），把当前上下文的 spanId 作为 parentSpanId，
// 让跨 Agent 因果链可查（getTrace(traceId) 返回完整调用链）。
const { traceStore } = require('./trace-store');

// 默认 request 超时（与 agent-messaging DEFAULT_TIMEOUT_MS 一致）
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;

/**
 * 生成全局唯一消息 ID
 */
function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 生成全局唯一 traceId
 */
function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

class MessageBus {
  /**
   * @param {Object} [options]
   * @param {number} [options.defaultTimeout=120000] — request 默认超时(ms)
   * @param {number} [options.mailboxCapacity=64] — 每邮箱容量上限
   */
  constructor(options = {}) {
    /** @type {Map<string, AgentMailbox>} */
    this._mailboxes = new Map();
    /** @type {Map<string, Function>} — agentId → handler */
    this._subscribers = new Map();
    /** @type {Map<string, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} — msgId → pending reply */
    this._pendingReplies = new Map();

    this.defaultTimeout = options.defaultTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.mailboxCapacity = options.mailboxCapacity ?? DEFAULT_MAILBOX_CAPACITY;

    logger.debug('MessageBus 已初始化', {
      defaultTimeout: this.defaultTimeout,
      mailboxCapacity: this.mailboxCapacity,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 邮箱管理
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取（或按需创建）某 Agent 的邮箱
   * @param {string} agentId
   * @returns {AgentMailbox}
   */
  _getMailbox(agentId) {
    let mb = this._mailboxes.get(agentId);
    if (!mb) {
      mb = new AgentMailbox(agentId, {
        capacity: this.mailboxCapacity,
        bus: this,
      });
      this._mailboxes.set(agentId, mb);
    }
    return mb;
  }

  /**
   * Agent 订阅自己的邮箱（注册消息处理函数）
   * @param {string} agentId
   * @param {Function} handler — async (message) => replyContent | void
   * @returns {() => void} 取消订阅函数
   */
  subscribe(agentId, handler) {
    this._subscribers.set(agentId, handler);
    const mb = this._getMailbox(agentId);
    mb.setHandler(handler);

    logger.debug(`MessageBus.subscribe: ${agentId} 已注册 handler`);
    return () => {
      if (this._subscribers.get(agentId) === handler) {
        this._subscribers.delete(agentId);
      }
      if (mb.handler === handler) {
        mb.setHandler(null);
      }
    };
  }

  /**
   * 获取某 Agent 的处理函数（供 mailbox.process 调用）
   */
  _getHandler(agentId) {
    return this._subscribers.get(agentId) || null;
  }

  // ═══════════════════════════════════════════════════════════
  // 消息构建
  // ═══════════════════════════════════════════════════════════

  /**
   * 构造一条标准消息对象
   * @param {Object} p
   * @param {string} p.from
   * @param {string} p.to
   * @param {string} [p.type='message']
   * @param {string} p.content
   * @param {'async'|'sync'} [p.mode='async']
   * @param {string|null} [p.replyTo=null]
   * @param {string} [p.conversationId='']
   * @param {number} [p.priority=3]
   * @param {Object} [p.metadata]
   * @param {string} [p.traceId]
   * @param {string} [p.parentSpanId]
   * @param {string} [p.id]
   * @returns {Object}
   */
  _buildMessage(p) {
    const ctx = currentTraceContext();
    return {
      id: p.id || generateMessageId(),
      traceId: p.traceId || ctx?.traceId || generateTraceId(),
      parentSpanId: p.parentSpanId || ctx?.parentSpanId || '',
      from: p.from,
      to: p.to,
      type: p.type || 'message',
      content: p.content,
      mode: p.mode || 'async',
      replyTo: p.replyTo || null,
      conversationId: p.conversationId || '',
      createdAt: Date.now(),
      priority: p.priority ?? 3,
      metadata: {
        callChain: p.metadata?.callChain || [],
        nestingDepth: p.metadata?.nestingDepth || 0,
        timeout: p.metadata?.timeout || this.defaultTimeout,
        ...(p.metadata || {}),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // publish — fire-and-forget
  // ═══════════════════════════════════════════════════════════

  /**
   * 投递消息（不等回复）。消息进入目标邮箱队列，由目标 Agent 自主消费。
   * @param {string} target — 目标 Agent ID
   * @param {Object} message — 消息对象（或部分字段，由 _buildMessage 补全）
   * @returns {Promise<{success: true, messageId: string} | {success: false, error: string}>}
   */
  async publish(target, message) {
    if (!target) {
      return { success: false, error: 'publish 需要 target' };
    }
    const full = this._normalize(target, message, { mode: 'async' });
    const mb = this._getMailbox(target);

    // Phase 5-A：记一条 message span（parentSpanId = 当前上下文的 spanId）。
    //   - 继承当前上下文 traceId（chat-manager.handleStreamMessage 已注入）；
    //     无上下文则 startSpan 自行新建一个 traceId。
    //   - spanId 不进 AsyncLocalStorage（publish 是 fire-and-forget，下游处理由
    //     mailbox.process 在另一个 async 栈里完成，ALS 透传由 mailbox handler 自行处理）。
    const ctx = currentTraceContext();
    const msgSpan = traceStore.startSpan(full.from || 'unknown', ctx?.spanId || '', {
      operation: 'message',
      from: full.from,
      to: target,
      content_preview: full.content,
      conversationId: full.conversationId,
      messageId: full.id,
      traceId: ctx?.traceId, // 显式继承上游 traceId
    });
    full.traceId = msgSpan.traceId;
    full.parentSpanId = msgSpan.parentSpanId;
    // 把 spanId 塞进 metadata，供下游 Agent 处理时作为 parentSpanId（可选）
    full.metadata.msgSpanId = msgSpan.spanId;

    const pushed = mb.enqueue(full);
    if (!pushed.ok) {
      logger.warn(`MessageBus.publish: ${target} 邮箱已满`, {
        messageId: full.id,
        capacity: mb.capacity,
      });
      traceStore.endSpan(msgSpan.spanId, { ok: false, error: pushed.error });
      return { success: false, error: pushed.error };
    }

    logger.debug(`MessageBus.publish: ${full.from} → ${target}`, {
      messageId: full.id,
      type: full.type,
    });

    // 触发异步处理（不等待）。mailbox 处理完后在此回调里 endSpan。
    // 注意 mailbox.process 内部调 handler，handler 完成后返回 reply。
    // 但 publish 是 fire-and-forget，我们无法直接拿到 handler 的完成时机；
    // 这里用 endSpan 标记「消息已入队」即可，真正的处理 span 由下游 Agent
    // （GroupQueue._runAgent / agent-messaging._executeMessage）自行 startSpan。
    traceStore.endSpan(msgSpan.spanId, { ok: true, enqueued: true });

    mb.process().catch((err) => {
      logger.error(`MessageBus.publish: mailbox.process 异常 ${target}`, err);
    });

    return { success: true, messageId: full.id };
  }

  // ═══════════════════════════════════════════════════════════
  // request — 请求-响应
  // ═══════════════════════════════════════════════════════════

  /**
   * 请求-响应：投递消息并等待回复。
   * @param {string} target
   * @param {Object} message
   * @param {number} [timeout] — 超时(ms)，默认 defaultTimeout
   * @returns {Promise<{success: true, response: any, messageId: string} | {success: false, error: string}>}
   */
  async request(target, message, timeout) {
    if (!target) {
      return { success: false, error: 'request 需要 target' };
    }
    const effectiveTimeout = timeout ?? this.defaultTimeout;
    const full = this._normalize(target, message, { mode: 'sync' });
    full.metadata.timeout = effectiveTimeout;

    // Phase 5-A：记一条 message span（sync 模式会在 reply 到达后 endSpan）
    const ctx = currentTraceContext();
    const msgSpan = traceStore.startSpan(full.from || 'unknown', ctx?.spanId || '', {
      operation: 'message',
      from: full.from,
      to: target,
      content_preview: full.content,
      conversationId: full.conversationId,
      messageId: full.id,
      traceId: ctx?.traceId,
    });
    full.traceId = msgSpan.traceId;
    full.parentSpanId = msgSpan.parentSpanId;
    full.metadata.msgSpanId = msgSpan.spanId;

    const mb = this._getMailbox(target);
    const pushed = mb.enqueue(full);
    if (!pushed.ok) {
      traceStore.endSpan(msgSpan.spanId, { ok: false, error: pushed.error });
      return { success: false, error: pushed.error };
    }

    // 先注册 pending reply，再触发 mailbox 处理（避免 race：handler 可能在
    // process() 启动后立即同步完成并 reply，此时 pendingReplies 必须已存在）。
    const replyPromise = new Promise((resolve) => {
      let timer = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        this._pendingReplies.delete(full.id);
      };

      const onReply = (replyContent) => {
        cleanup();
        traceStore.endSpan(msgSpan.spanId, { ok: true, hasResponse: true });
        resolve({ success: true, response: replyContent, messageId: full.id });
      };

      const onTimeout = () => {
        cleanup();
        traceStore.endSpan(msgSpan.spanId, { ok: false, error: 'timeout' });
        resolve({
          success: false,
          error: `request 超时（${effectiveTimeout / 1000}s）: ${full.from} → ${target}`,
        });
      };

      timer = setTimeout(onTimeout, effectiveTimeout);

      this._pendingReplies.set(full.id, { resolve: onReply, reject: onTimeout, timer });
    });

    // 触发 mailbox 处理（不等待；handler 完成后会 bus.reply 解开 replyPromise）
    mb.process().catch((err) => {
      logger.error(`MessageBus.request: mailbox.process 异常 ${target}`, err);
    });

    // 等待 reply（或超时）
    const reply = await replyPromise;
    return reply;
  }

  // ═══════════════════════════════════════════════════════════
  // broadcast — 并行广播
  // ═══════════════════════════════════════════════════════════

  /**
   * 并行广播到多个 Agent（fire-and-forget，不等回复）。
   * @param {string[]} targets
   * @param {Object} message — 共用字段，to 字段会被逐个覆盖
   * @returns {Promise<{success: true, sent: Array<{target: string, messageId: string}>, failed: Array<{target: string, error: string}>}>}
   */
  async broadcast(targets, message) {
    if (!Array.isArray(targets) || targets.length === 0) {
      return { success: true, sent: [], failed: [] };
    }

    const results = await Promise.all(
      targets.map(async (t) => {
        const r = await this.publish(t, { ...message, to: t, type: message.type || 'broadcast' });
        if (r.success) return { target: t, messageId: r.messageId };
        return { target: t, error: r.error };
      })
    );

    const sent = [];
    const failed = [];
    for (const r of results) {
      if ('messageId' in r) sent.push(r);
      else failed.push(r);
    }

    logger.debug(`MessageBus.broadcast: ${sent.length}/${targets.length} 成功`, {
      failed: failed.map((f) => f.target),
    });

    return { success: true, sent, failed };
  }

  // ═══════════════════════════════════════════════════════════
  // reply — 回复某条消息
  // ═══════════════════════════════════════════════════════════

  /**
   * 回复一条 request 消息。将回复内容交付给等待方（resolve pending reply），
   * 并把 reply 消息入队到原消息 from 的邮箱（如果存在订阅者）。
   * @param {string} replyTo — 原 message id
   * @param {any} content — 回复内容
   * @param {Object} [opts]
   * @param {string} [opts.from] — 回复者（默认为原消息 to）
   * @returns {Promise<{success: true} | {success: false, error: string}>}
   */
  async reply(replyTo, content, opts = {}) {
    const pending = this._pendingReplies.get(replyTo);
    if (!pending) {
      logger.debug(`MessageBus.reply: 找不到 pending reply ${replyTo}（可能已超时或已处理）`);
      // 不报错，幂等
      return { success: false, error: `找不到待回复消息: ${replyTo}` };
    }

    // 先 resolve 等待方
    pending.resolve(content);

    // 再把 reply 消息入队给原 from（如果其邮箱存在且订阅了 handler）
    const replyMsg = {
      id: generateMessageId(),
      traceId: '',
      parentSpanId: '',
      from: opts.from || '',
      to: '',
      type: 'reply',
      content,
      mode: 'async',
      replyTo,
      conversationId: '',
      createdAt: Date.now(),
      priority: 3,
      metadata: { callChain: [], nestingDepth: 0, timeout: this.defaultTimeout },
    };

    // 找到原消息以确定 to = original.from
    // 由于 pendingReplies 只存 resolve/reject，需要 mailbox 查原消息
    for (const [, mb] of this._mailboxes) {
      const original = mb.findMessage(replyTo);
      if (original) {
        replyMsg.to = original.from;
        replyMsg.traceId = original.traceId;
        replyMsg.parentSpanId = original.parentSpanId;
        replyMsg.conversationId = original.conversationId;
        replyMsg.from = opts.from || original.to;
        // 入队给原 from
        const targetMb = this._getMailbox(original.from);
        const pushed = targetMb.enqueue(replyMsg);
        if (pushed.ok) {
          targetMb.process().catch((err) => {
            logger.error(`MessageBus.reply: mailbox.process 异常 ${original.from}`, err);
          });
        }
        break;
      }
    }

    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // 内部工具
  // ═══════════════════════════════════════════════════════════

  /**
   * 把任意 message（可能是完整消息对象或部分字段）归一化成完整消息对象。
   * @param {string} target
   * @param {Object} message
   * @param {Object} overrides — { mode, type, ... }
   * @returns {Object}
   */
  _normalize(target, message, overrides = {}) {
    // message 可能已经是一个完整的消息对象（比如来自 _buildMessage）
    const m = { ...message };
    m.to = target;
    if (overrides.mode && !m.mode) m.mode = overrides.mode;
    return this._buildMessage(m);
  }

  /**
   * 清理某 Agent 的邮箱（开除/重启时调用）
   * @param {string} agentId
   */
  clearMailbox(agentId) {
    const mb = this._mailboxes.get(agentId);
    if (mb) {
      mb.clear();
    }
  }

  /**
   * 清空所有邮箱 + pendingReplies（reinitialize 时调用）
   */
  clearAll() {
    for (const [, mb] of this._mailboxes) mb.clear();
    this._mailboxes.clear();
    this._subscribers.clear();
    for (const [, pending] of this._pendingReplies) {
      try {
        clearTimeout(pending.timer);
        pending.reject(new Error('MessageBus 已重置'));
      } catch {
        /* noop */
      }
    }
    this._pendingReplies.clear();
  }

  /**
   * 诊断：返回所有邮箱状态快照
   */
  snapshot() {
    const result = {};
    for (const [id, mb] of this._mailboxes) {
      result[id] = {
        size: mb.size(),
        capacity: mb.capacity,
        processing: mb.processing,
        pendingReplies: this._countPendingFor(id),
      };
    }
    return result;
  }

  _countPendingFor(agentId) {
    let count = 0;
    for (const [, mb] of this._mailboxes) {
      if (mb.agentId === agentId) count += 0; // placeholder
    }
    return count;
  }
}

// 单例（与 agent-communication 风格一致）
const messageBus = new MessageBus();

module.exports = {
  MessageBus,
  messageBus,
  generateMessageId,
  generateTraceId,
  DEFAULT_REQUEST_TIMEOUT_MS,
  // 透传 trace-context，便于其他模块直接引用
  createTraceContext,
  currentTraceContext,
};
