/**
 * TimeoutManager — 带超时的 Promise 包装，修复资源泄漏
 *
 * 从 agent-communication.js 拆出。原 _withTimeout（255-264 行）的问题：
 *   1. 超时后底层 LLM 调用不取消，继续在后台运行
 *   2. setTimeout 不清理，Promise.race 完成后定时器仍可能触发
 *   3. 队列槽位不释放（任务 reject 了但 _agentProcessing 未清）
 *
 * 修复方案：
 *   - 使用 AbortController，超时后 signal.aborted=true
 *   - 清理 setTimeout（无论成功/失败/超时都 clearTimeout）
 *   - 如果原 Promise 支持 AbortSignal（agent.chat 可选传入），超时后取消底层调用
 *   - 队列槽位的释放由 MessageQueue 的 finally 处理，本模块只负责超时本身
 *
 * 注意：本模块只管超时；真正的"取消底层 LLM 调用"需要调用方把 signal 传给 agent.chat
 * 或 toolExecutor。本模块导出 createTimeoutPromise 工厂，调用方自行接入。
 *
 * @module collaboration/timeout-manager
 */

/**
 * 创建一个带超时的 Promise 包装
 *
 * @param {Promise} promise - 原始 Promise
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @param {string} operationName - 操作名称（用于错误信息）
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal] - 外部 AbortSignal，aborted 时立即 reject
 * @param {Function} [opts.onTimeout] - 超时回调（在 reject 之前调用，可用于清理）
 * @returns {Promise}
 */
function withTimeout(promise, timeoutMs, operationName = '操作', opts = {}) {
  const { signal: externalSignal, onTimeout } = opts;

  return new Promise((resolve, reject) => {
    // 已超时（外部 signal 已 aborted）
    if (externalSignal?.aborted) {
      reject(new Error(`${operationName}已被取消`));
      return;
    }

    let timer = null;
    let settled = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onResolve = (val) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const onReject = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    // 超时定时器
    timer = setTimeout(() => {
      if (settled) return;
      if (typeof onTimeout === 'function') {
        try {
          onTimeout();
        } catch (e) {
          // 忽略回调错误
        }
      }
      onReject(new Error(`${operationName}超时（${timeoutMs / 1000}秒）`));
    }, timeoutMs);

    // 外部 signal 取消
    if (externalSignal) {
      externalSignal.addEventListener(
        'abort',
        () => {
          if (settled) return;
          onReject(new Error(`${operationName}已被取消`));
        },
        { once: true }
      );
    }

    // 原始 Promise 结算
    Promise.resolve(promise).then(onResolve, onReject);
  });
}

/**
 * 创建一个 AbortController + 超时组合，返回 { signal, promise, cancel }
 *
 * 调用方可以：
 *   const { signal, racePromise } = createTimeoutSignal(timeoutMs, opName);
 *   const result = await Promise.race([
 *     someAsyncFn({ signal }),     // 底层调用可接收 signal
 *     racePromise,
 *   ]);
 *
 * @param {number} timeoutMs - 超时时间
 * @param {string} operationName - 操作名称
 * @returns {{ signal: AbortSignal, racePromise: Promise, abort: Function, cancel: Function }}
 */
function createTimeoutSignal(timeoutMs, operationName = '操作') {
  const controller = new AbortController();
  const signal = controller.signal;

  const racePromise = new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        if (signal.reason) {
          reject(signal.reason);
        } else {
          reject(new Error(`${operationName}超时（${timeoutMs / 1000}秒）`));
        }
      },
      { once: true }
    );
  });

  const timer = setTimeout(() => {
    controller.abort(new Error(`${operationName}超时（${timeoutMs / 1000}秒）`));
  }, timeoutMs);

  return {
    signal,
    racePromise,
    abort: (reason) => controller.abort(reason),
    cancel: () => clearTimeout(timer),
  };
}

module.exports = {
  withTimeout,
  createTimeoutSignal,
};
