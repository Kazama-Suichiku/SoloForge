/**
 * SoloForge - traceId 生成与传递
 *
 * 基于 node:async_hooks 的 AsyncLocalStorage，让同一异步链路上的日志、
 * IPC handler、工具调用自动携带同一个 traceId，便于事后 grep 串联排障。
 *
 * 设计要点：
 * - generateTraceId(): 生成全局唯一、可读、单调递增的 traceId
 * - withTrace(fn, traceId?): 在 AsyncLocalStorage 中绑定 traceId 后执行 fn；
 *   fn 执行期间（含 await/Promise 链、setTimeout 回调）所有 logger 调用会自动带上该 traceId
 * - withTraceId(traceId, fn): 显式指定 traceId（如复用上游传入的）
 * - getTraceId(): 读取当前 AsyncLocalStorage 中的 traceId（无则 undefined）
 * - bindTraceId(fn, traceId?): 返回一个进入 trace 上下文的包装函数（用于回调场景）
 *
 * 不依赖任何第三方库，仅使用 Node 内置 async_hooks。
 *
 * @module utils/trace
 */

'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const asyncLocalStorage = new AsyncLocalStorage();

/**
 * 生成唯一 traceId
 * 格式: trace-{base36 timestamp}-{8 位随机}
 * - timestamp 用 base36 压缩，单调递增、可排序
 * - 随机 8 位避免同毫秒并发冲突
 * @returns {string}
 */
function generateTraceId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `trace-${ts}-${rand}`;
}

/**
 * 获取当前异步链路上的 traceId
 * 必须在 withTrace / withTraceId / bindTraceId 上下文内调用
 * @returns {string|undefined}
 */
function getTraceId() {
  const store = asyncLocalStorage.getStore();
  return store ? store.traceId : undefined;
}

/**
 * 在指定 traceId 上下文中执行 fn
 * fn 内部所有异步链路上的 logger 调用会自动带上该 traceId
 * @param {string} traceId
 * @param {Function} fn
 * @returns {any} fn 的返回值（支持 Promise）
 */
function withTraceId(traceId, fn) {
  return asyncLocalStorage.run({ traceId }, fn);
}

/**
 * 为 fn 生成新的 traceId 并在其上下文中执行
 * 等价于 withTraceId(generateTraceId(), fn)
 * @param {Function} fn
 * @param {string} [traceId] - 可选，显式指定 traceId（如复用上游）
 * @returns {any}
 */
function withTrace(fn, traceId) {
  return withTraceId(traceId || generateTraceId(), fn);
}

/**
 * 返回一个包装函数，调用时进入 trace 上下文执行原函数
 * 用于回调式的 trace 绑定（如事件回调、Promise.then 链、IPC 返回前的异步等待）
 * @param {Function} fn
 * @param {string} [traceId] - 可选，不传则生成新的
 * @returns {Function}
 */
function bindTraceId(fn, traceId) {
  const tid = traceId || generateTraceId();
  return function bound(...args) {
    return withTraceId(tid, () => fn.apply(this, args));
  };
}

module.exports = {
  generateTraceId,
  getTraceId,
  withTrace,
  withTraceId,
  bindTraceId,
};
