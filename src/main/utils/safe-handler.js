/**
 * SoloForge - IPC 安全处理器高阶函数
 * 统一包裹 ipcMain.handle 回调，避免异常 stack 泄露到渲染进程，
 * 并统一错误返回格式为 { success: false, error, code }
 *
 * Phase 2 可观测性升级：
 * - 每个 IPC 请求自动生成 traceId（或复用请求传入的 traceId）
 * - 通过 AsyncLocalStorage 在 handler 执行期间传递 traceId
 * - 所有错误日志自动带 traceId，事后可 grep 串联
 *
 * @module utils/safe-handler
 */

'use strict';

const { logger } = require('./logger');
const { withTraceId, generateTraceId } = require('./trace');

/**
 * 包裹 IPC handler，统一错误处理与返回格式
 * - 若原 handler 已返回 { success, ... } 格式，则原样透传
 * - 否则包装为 { success: true, data: result }
 * - 抛出的异常只把 err.message / err.code 返回给渲染进程，完整 stack 写入主进程日志
 * - 自动为本次调用生成 traceId，并在 handler 期间通过 AsyncLocalStorage 传递
 *
 * @param {Function} fn - 原始 handler，签名 (event, ...args) => any | Promise<any>
 * @param {Object} [options]
 * @param {string} [options.channel] - IPC channel 名称（用于日志标识）
 * @returns {Function} 包裹后的 async handler，可直接传给 ipcMain.handle
 */
function safeHandler(fn, options = {}) {
  return async (event, ...args) => {
    // 从请求参数中提取上游传入的 traceId（约定：渲染进程可通过 args[0].__traceId 透传）
    let upstreamTraceId = null;
    if (args[0] && typeof args[0] === 'object' && typeof args[0].__traceId === 'string') {
      upstreamTraceId = args[0].__traceId;
      // 不把内部字段暴露给业务 handler（避免污染业务参数）
      // 注意：不删除，避免改动调用方传入的对象引用
    }

    const traceId = upstreamTraceId || generateTraceId();

    return withTraceId(traceId, async () => {
      try {
        const result = await fn(event, ...args);
        // 如果原 handler 已返回 {success,...} 格式则直接返回
        if (result && typeof result === 'object' && 'success' in result) {
          // 注入 traceId，便于渲染进程串联
          if (result && typeof result === 'object' && !('traceId' in result)) {
            result.traceId = traceId;
          }
          return result;
        }
        return { success: true, data: result, traceId };
      } catch (err) {
        // 记录完整错误到日志，但只返回简化信息给渲染进程
        // traceId 已由 AsyncLocalStorage 自动附加到 logger 行
        logger.error(
          `IPC handler error [${options.channel || fn.name || 'anonymous'}]:`,
          err
        );
        return {
          success: false,
          error: err.message || '内部错误',
          code: err.code || 'INTERNAL',
          traceId,
        };
      }
    });
  };
}

module.exports = { safeHandler };
