/**
 * tests/setup.js
 *
 * 测试启动前的全局环境设置。被每个测试文件通过 require('./setup') 引入：
 *   - 安装 electron stub（必须早于任何主进程模块 require）
 *   - 抑制 logger 噪音（NODE_ENV=test，logger 在生产模式下只输出 warn/error，
 *     但 SoloForge 的 logger 默认级别是 info，所以这里另外 monkey-patch console）
 *   - 提供创建临时 SoloForge 数据目录的 helper（每个测试用独立 tmpdir，
 *     切换 dataPath 单例上下文到该目录，避免污染 ~/.soloforge）
 *   - 提供 requireFresh helper：清除主进程模块缓存，让每个测试文件可以
 *     拿到独立实例（对单例 store 模块至关重要）
 *
 * 重要：本文件本身不得 require 任何 src/main/** 模块（否则 mock-electron
 * 来不及生效）。
 */

'use strict';

// 1. 先安装 electron stub —— 必须在任何主进程模块 require 之前
const mockElectron = require('./mock-electron');
mockElectron.install();

// 2. 抑制 logger 输出噪音（SoloForge logger 用 console.log/warn/error/debug）
// 测试时我们不需要 INFO 日志，但保留 error 用于排障。
const originalConsoleLog = console.log;
const originalConsoleDebug = console.debug;
const originalConsoleWarn = console.warn;
if (process.env.KEEP_TEST_LOGS !== '1') {
  console.log = () => {};
  console.debug = () => {};
  // console.warn 保留，警告往往是潜在 bug 的信号
  // console.error 保留
}

// 3. helper：创建独立的临时数据目录，并把 dataPath 单例切换过去
const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * 创建一个临时的 SoloForge 数据目录，返回 { root, accountId, companyId, basePath, cleanup }。
 * 注意：本函数不直接修改 dataPath 单例（dataPath 由 src/main/account/data-path 导出，
 * 是单例，且在 mock-electron 已安装后才能 require）。调用方需要自己切换：
 *
 *   const { dataPath } = require('../src/main/account/data-path');
 *   const ctx = makeTmpDataContext();
 *   dataPath.setCurrentContext(ctx.accountId, ctx.companyId);
 *
 * cleanup() 会递归删除临时目录。
 */
function makeTmpDataContext(prefix = 'soloforge-test-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const accountId = 'test-account';
  const companyId = 'test-company-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const basePath = path.join(root, 'data', accountId, companyId);
  fs.mkdirSync(basePath, { recursive: true });
  return {
    root,
    accountId,
    companyId,
    basePath,
    cleanup() {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

/**
 * 清除指定模块及所有依赖它的子模块缓存，使其下次 require 时重新加载。
 * 用于在测试之间获取独立的 store 单例。
 *
 * 用法：
 *   const { dataPath } = requireFresh('../src/main/account/data-path');
 *
 * 注意：传入的路径必须是相对当前 setup.js 的路径，或者绝对路径。
 */
function requireFresh(modulePath) {
  const Module = require('module');
  const absPath = Module._resolveFilename(modulePath, module);
  // 递归清除该模块及其 require 子树的所有缓存
  function purge(p) {
    const cached = require.cache[p];
    if (!cached) return;
    const children = cached.children || [];
    delete require.cache[p];
    for (const c of children) {
      if (c.id) purge(c.id);
    }
  }
  purge(absPath);
  return require(absPath);
}

/**
 * 全量清除 src/main/ 下的所有缓存（用于需要彻底隔离的测试）。
 * 注意：electron stub 不会被清除（它由 mock-electron 管，独立于 require.cache）。
 */
function clearAllMainModuleCache() {
  const path = require('path');
  const mainDir = path.resolve(__dirname, '..', 'src', 'main');
  for (const id of Object.keys(require.cache)) {
    if (id.startsWith(mainDir + path.sep)) {
      delete require.cache[id];
    }
  }
}

/**
 * 等待 microtask 队列排空（用于异步 flush 类操作的快速同步等待）。
 * 注意：真正的 setTimeout 防抖不会因此触发，只适用于 Promise.resolve 链。
 */
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * 等待指定毫秒（用于防抖定时器或调度器的真实等待）。
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 简单的 console 暂时恢复（用于调试某个失败测试时看日志）。
 */
function withLogs(fn) {
  return async function () {
    console.log = originalConsoleLog;
    console.debug = originalConsoleDebug;
    try {
      return await fn.apply(this, arguments);
    } finally {
      if (process.env.KEEP_TEST_LOGS !== '1') {
        console.log = () => {};
        console.debug = () => {};
      }
    }
  };
}

module.exports = {
  mockElectron,
  makeTmpDataContext,
  requireFresh,
  clearAllMainModuleCache,
  flushMicrotasks,
  sleep,
  withLogs,
};
