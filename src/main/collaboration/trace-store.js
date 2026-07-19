/**
 * TraceStore — 跨 Agent 全链路追踪（Phase 5-A）
 *
 * 职责：
 *   - startSpan(agentId, parentSpanId?, metadata?) → spanId
 *     创建一个 span（属于某 trace），写入内存 + 持久化。
 *   - endSpan(spanId, result?) → 关闭 span，记录 duration + result
 *   - getTrace(traceId) → 该 trace 下所有 span 的完整因果链
 *   - getAllTraces() → 所有 trace（按 traceId 聚合）
 *   - loadFromDisk() / saveToDisk() 持久化到 traces.json
 *
 * span 结构：
 *   {
 *     spanId, traceId, parentSpanId,
 *     agentId, operation,        // 'message'|'delegation'|'group_post'|'tool_call'|'handle_message'
 *     startTime, endTime, duration,
 *     result: null,
 *     metadata: { from, to, content_preview, toolName, ... }
 *   }
 *
 * 与 trace-context.js 的关系：
 *   - trace-context.js 使用 AsyncLocalStorage 跨 async 边界传递 traceId/parentSpanId/spanId。
 *   - TraceStore 负责 span 的存储 + 查询 + 持久化，是 trace-context 的存储后端。
 *   - chat-manager.js 在 handleStreamMessage 入口调用 traceStore.startSpan，
 *     并把 spanId 放进 createTraceContext，让下游 message-bus / agent-messaging
 *     的 _buildMessage 自动继承 traceId + parentSpanId（spanId）。
 *   - 下游 Agent 处理消息时可以再次 startSpan（parentSpanId=上游 spanId），
 *     形成跨 Agent 的因果链。
 *
 * 持久化风格与 comm-event-store.js / group-history-store.js 一致：
 *   - 构造时 loadFromDisk()
 *   - saveToDisk() 异步防抖（TRACE_SAVE_DEBOUNCE_MS）
 *   - saveToDiskSync() 同步刷盘（退出时由 lifecycle flushAll 调用）
 *   - reinitialize() 公司切换时清空内存并从新路径重新加载
 *
 * @module collaboration/trace-store
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');
const { atomicWrite, atomicWriteSync } = require('../utils/atomic-write');

// 防抖保存
let _traceSaveTimer = null;
const TRACE_SAVE_DEBOUNCE_MS = 2000;

// 内存中最多保留的 span 数（与 comm-event-store MAX_EVENTS_IN_MEMORY 同量级）
const MAX_SPANS_IN_MEMORY = 1000;

/**
 * @typedef {Object} Span
 * @property {string} spanId           - span ID，格式 'span-<ts>-<rand>'
 * @property {string} traceId          - trace ID，格式 'trace-<ts>-<rand>'
 * @property {string} parentSpanId     - 父 span ID（根 span 为 ''）
 * @property {string} agentId          - 负责该 span 的 Agent ID（或 'user'/'system'）
 * @property {string} operation        - 操作类型：'message'|'delegation'|'group_post'|'tool_call'|'handle_message'
 * @property {number} startTime        - 起始时间戳（Date.now()）
 * @property {number|null} endTime     - 结束时间戳（未结束时为 null）
 * @property {number|null} duration    - 持续毫秒（endSpan 后写入）
 * @property {*} result                - 结果（默认 null）
 * @property {Object} metadata         - 附加元数据 { from, to, content_preview, toolName, ... }
 */

/**
 * 生成全局唯一 span ID
 */
function generateSpanId() {
  return `span-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 生成全局唯一 trace ID
 */
function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 截断字符串用于 metadata.content_preview
 */
function truncatePreview(s, limit = 200) {
  if (s == null) return '';
  const str = String(s);
  return str.length > limit ? str.slice(0, limit) + '...' : str;
}

/**
 * TraceStore 单例
 */
class TraceStore {
  constructor() {
    /** @type {Span[]} */
    this.spans = [];
    /**
     * spanId → span 的索引（便于 endSpan O(1) 查找）
     * @type {Map<string, Span>}
     */
    this._spanIndex = new Map();
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
        logger.warn('trace-store: 创建数据目录失败:', error.message);
      }
    }
  }

  _getFilePath() {
    return path.join(dataPath.getBasePath(), 'traces.json');
  }

  // ─── 持久化 ─────────────────────────────────────────────────

  /**
   * 从磁盘加载 spans
   */
  loadFromDisk() {
    try {
      const filePath = this._getFilePath();
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const loaded = Array.isArray(data)
          ? data
          : (Array.isArray(data.spans) ? data.spans : []);
        this.spans = loaded.slice(-MAX_SPANS_IN_MEMORY);
        this._rebuildIndex();
        logger.info('trace-store 已加载', { spanCount: this.spans.length });
      } else {
        this.spans = [];
        this._spanIndex.clear();
      }
    } catch (error) {
      logger.error('trace-store: 加载失败', error);
      this.spans = [];
      this._spanIndex.clear();
    }
  }

  /**
   * 异步防抖保存
   */
  saveToDisk() {
    if (_traceSaveTimer) {
      clearTimeout(_traceSaveTimer);
    }
    _traceSaveTimer = setTimeout(() => {
      _traceSaveTimer = null;
      this._doSave();
    }, TRACE_SAVE_DEBOUNCE_MS);
  }

  /**
   * 实际执行保存（异步原子写入）
   * @private
   */
  _doSave() {
    try {
      this._ensureDataDir();
      const content = JSON.stringify(
        { spans: this.spans.slice(-MAX_SPANS_IN_MEMORY) },
        null,
        2
      );
      atomicWrite(this._getFilePath(), content).catch((error) => {
        logger.error('trace-store: 保存失败', error);
      });
    } catch (error) {
      logger.error('trace-store: 保存失败', error);
    }
  }

  /**
   * 同步保存（应用退出前由 lifecycle flushAll 调用）
   */
  saveToDiskSync() {
    try {
      this._ensureDataDir();
      const content = JSON.stringify(
        { spans: this.spans.slice(-MAX_SPANS_IN_MEMORY) },
        null,
        2
      );
      atomicWriteSync(this._getFilePath(), content);
      logger.info('trace-store 已同步保存');
    } catch (error) {
      logger.error('trace-store: 同步保存失败', error);
    }
  }

  /**
   * 重新初始化（公司切换时调用）
   */
  reinitialize() {
    this.spans = [];
    this._spanIndex.clear();
    this._ensureDataDir();
    this.loadFromDisk();
  }

  _rebuildIndex() {
    this._spanIndex.clear();
    for (const sp of this.spans) {
      if (sp && sp.spanId) {
        this._spanIndex.set(sp.spanId, sp);
      }
    }
  }

  // ─── 写入 ───────────────────────────────────────────────────

  /**
   * 开启一个 span。
   *
   * @param {string} agentId - 负责 span 的 Agent ID
   * @param {string} [parentSpanId] - 父 span ID。若传入且父 span 存在，
   *   traceId 继承自父 span；否则新建一个 traceId（开启一条新 trace）。
   * @param {Object} [metadata]
   * @param {string} [metadata.operation='handle_message'] - 操作类型
   * @param {string} [metadata.from] - 触发者（用于 message/delegation）
   * @param {string} [metadata.to] - 目标 Agent / 群聊 ID
   * @param {string} [metadata.content_preview] - 内容摘要
   * @param {string} [metadata.toolName] - 工具名（tool_call）
   * @param {string} [metadata.conversationId] - 会话 ID
   * @param {string} [metadata.messageId] - 消息 ID
   * @param {string} [metadata.traceId] - 显式指定 traceId（覆盖继承逻辑）
   * @returns {Span} 创建的 span（包含 spanId / traceId / parentSpanId）
   */
  startSpan(agentId, parentSpanId, metadata = {}) {
    // 确定 traceId：优先用 metadata.traceId，其次继承父 span，最后新建
    let traceId = metadata.traceId || '';
    if (!traceId && parentSpanId) {
      const parent = this._spanIndex.get(parentSpanId);
      if (parent) {
        traceId = parent.traceId;
      }
    }
    if (!traceId) {
      traceId = generateTraceId();
    }

    const span = {
      spanId: generateSpanId(),
      traceId,
      parentSpanId: parentSpanId || '',
      agentId: agentId || '',
      operation: metadata.operation || 'handle_message',
      startTime: Date.now(),
      endTime: null,
      duration: null,
      result: null,
      metadata: {
        from: metadata.from || '',
        to: metadata.to || '',
        content_preview: truncatePreview(metadata.content_preview || ''),
        toolName: metadata.toolName || '',
        conversationId: metadata.conversationId || '',
        messageId: metadata.messageId || '',
      },
    };

    this.spans.push(span);
    this._spanIndex.set(span.spanId, span);

    // 超出上限裁掉最旧的（保持环形缓冲语义）
    if (this.spans.length > MAX_SPANS_IN_MEMORY) {
      this.spans = this.spans.slice(-MAX_SPANS_IN_MEMORY);
      this._rebuildIndex();
    }

    this.saveToDisk();

    logger.debug('trace-store.startSpan', {
      spanId: span.spanId,
      traceId: span.traceId,
      parentSpanId: span.parentSpanId,
      agentId,
      operation: span.operation,
    });

    return span;
  }

  /**
   * 关闭一个 span，记录 duration + result。
   * 幂等：重复 endSpan 同一个 span 只会生效一次。
   *
   * @param {string} spanId
   * @param {*} [result] - 结果（任意可序列化值）
   * @returns {Span|null} 更新后的 span，找不到返回 null
   */
  endSpan(spanId, result) {
    const span = this._spanIndex.get(spanId);
    if (!span) {
      logger.debug('trace-store.endSpan: 找不到 span', { spanId });
      return null;
    }
    if (span.endTime != null) {
      // 已结束，幂等返回
      return span;
    }
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    if (result !== undefined) {
      span.result = result;
    }
    this.saveToDisk();
    logger.debug('trace-store.endSpan', {
      spanId,
      duration: span.duration,
    });
    return span;
  }

  // ─── 查询 ───────────────────────────────────────────────────

  /**
   * 获取某 trace 下所有 span（按 startTime 排序），构成完整因果链。
   * @param {string} traceId
   * @returns {Span[]}
   */
  getTrace(traceId) {
    if (!traceId) return [];
    const matched = this.spans.filter((s) => s.traceId === traceId);
    matched.sort((a, b) => a.startTime - b.startTime);
    return matched;
  }

  /**
   * 获取所有 trace（按 traceId 聚合）。
   * 返回 { traceId: Span[] } 的对象，每个数组按 startTime 排序。
   * @returns {Object<string, Span[]>}
   */
  getAllTraces() {
    const byTrace = new Map();
    for (const sp of this.spans) {
      if (!byTrace.has(sp.traceId)) {
        byTrace.set(sp.traceId, []);
      }
      byTrace.get(sp.traceId).push(sp);
    }
    const result = {};
    for (const [traceId, spans] of byTrace) {
      spans.sort((a, b) => a.startTime - b.startTime);
      result[traceId] = spans;
    }
    return result;
  }

  /**
   * 获取某 Agent 参与的所有 span（agentId 相等），按 startTime 排序。
   * @param {string} agentId
   * @param {{limit?: number}} [options]
   * @returns {Span[]}
   */
  getSpansForAgent(agentId, options = {}) {
    if (!agentId) return [];
    const { limit = 50 } = options;
    let matched = this.spans.filter((s) => s.agentId === agentId);
    matched.sort((a, b) => a.startTime - b.startTime);
    if (limit > 0) {
      matched = matched.slice(-limit);
    }
    return matched;
  }

  /**
   * 获取单个 span
   * @param {string} spanId
   * @returns {Span|null}
   */
  getSpan(spanId) {
    return this._spanIndex.get(spanId) || null;
  }

  /**
   * 诊断：返回所有 trace 的简要统计
   */
  getStats() {
    const traceIds = new Set(this.spans.map((s) => s.traceId));
    const open = this.spans.filter((s) => s.endTime == null).length;
    return {
      totalSpans: this.spans.length,
      totalTraces: traceIds.size,
      openSpans: open,
    };
  }

  /**
   * 清空所有 span（测试/重置用）
   */
  clear() {
    this.spans = [];
    this._spanIndex.clear();
    this.saveToDisk();
  }
}

// 单例
const traceStore = new TraceStore();

module.exports = {
  TraceStore,
  traceStore,
  generateSpanId,
  generateTraceId,
};
