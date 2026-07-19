/**
 * TraceContext — 跨 Agent 全链路追踪上下文（Phase 1-A 占位实现）
 *
 * 职责：
 *   - 提供当前活跃的 trace 上下文（traceId + parentSpanId）
 *   - Phase 5-A 的 TraceStore 将替换本模块内部实现，但接口保持不变
 *
 * 当前实现策略：
 *   - 使用 AsyncLocalStorage（Node.js 内置，零依赖）跨 async 边界传递 traceId
 *   - createTraceContext(traceId, parentSpanId, fn) 在 fn 执行期间让
 *     currentTraceContext() 返回该上下文
 *   - 不依赖外部存储；如果未创建过任何上下文，currentTraceContext() 返回 null
 *
 * 设计动机：
 *   - message-bus.js 的 _buildMessage 需要从“当前上下文”自动填充 traceId/parentSpanId，
 *     让跨 Agent 调用天然形成链路，而不需要调用方手工透传。
 *   - AgentMessaging.sendMessage / TaskDelegation.delegateTask 在调用 MessageBus 之前，
 *     可以选择用 createTraceContext 包裹，以继承上游 trace。
 *
 * @module collaboration/trace-context
 */

const { AsyncLocalStorage } = require('async_hooks');

const _als = new AsyncLocalStorage();

/**
 * 生成一个 traceId（如果上游没传）
 */
function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 生成一个 spanId
 */
function generateSpanId() {
  return `span-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 创建并进入一个 trace 上下文，在 fn 执行期间 currentTraceContext() 返回该上下文。
 * 如果已经在一个 trace 上下文里，默认继承上游 traceId，并把自己的 spanId 作为
 * 下游 parentSpanId。
 *
 * @param {Object} [overrides]
 * @param {string} [overrides.traceId] — 不传则继承上游或新建
 * @param {string} [overrides.parentSpanId] — 不传则继承上游
 * @param {string} [overrides.spanId] — 不传则新建
 * @param {string} [overrides.agentId] — 当前 Agent ID（用于未来 TraceStore span 记录）
 * @param {Function} fn — 在上下文中执行的函数（同步或异步）
 * @returns {*} fn 的返回值
 */
function createTraceContext(overrides, fn) {
  if (typeof overrides === 'function') {
    fn = overrides;
    overrides = {};
  }
  const upstream = _als.getStore() || null;

  const ctx = {
    traceId: overrides.traceId || upstream?.traceId || generateTraceId(),
    parentSpanId: overrides.parentSpanId ?? upstream?.spanId ?? '',
    spanId: overrides.spanId || generateSpanId(),
    agentId: overrides.agentId || upstream?.agentId || '',
  };

  return _als.run(ctx, fn);
}

/**
 * 获取当前 async 上下文中的 trace 信息。未创建过则返回 null。
 * @returns {{traceId: string, parentSpanId: string, spanId: string, agentId: string} | null}
 */
function currentTraceContext() {
  return _als.getStore() || null;
}

module.exports = {
  createTraceContext,
  currentTraceContext,
  generateTraceId,
  generateSpanId,
};
