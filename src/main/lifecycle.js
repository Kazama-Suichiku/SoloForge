/**
 * SoloForge - 应用生命周期与退出刷盘（P1-2 拆分产物）
 *
 * 从 main.js 抽出：
 * - flushableStores 数组 + flushAll()（Phase 0 统一退出刷盘）
 * - window-all-closed 钩子（macOS 保留 dock，其他平台退出）
 * - before-quit 钩子（刷盘 + 停维护调度）
 * - SIGINT / SIGTERM 钩子（被 kill 时也刷盘，再走 app.quit 触发 before-quit 链）
 *
 * 设计：本模块只负责“退出/刷盘”这条链。它 require 的 store 都是单例模块，
 * flushAll 不依赖任何运行时状态。registerLifecycle(app) 在 app.whenReady 之后调用一次，
 * 把钩子挂上去；flushAll 也导出供 ipc-bootstrap 的 app:quit handler 调用。
 */

const { app } = require('electron');
const { isMac } = require('./utils/platform');
const { logger } = require('./utils/logger');
const { chatHistoryStore } = require('./chat/chat-history-store');
const { todoStore } = require('./tools/todo-store');
const { memoryManager } = require('./memory');
const { budgetManager } = require('./budget/budget-manager');
const { tokenTracker } = require('./budget/token-tracker');
const { agentConfigStore } = require('./config/agent-config-store');
const { agentCommunication } = require('./collaboration/agent-communication');
const { operationsStore } = require('./operations/operations-store');
const { projectStore } = require('./pm/project-store');

// ─── 统一退出刷盘（P0-3）─────────────────────────────────────
// 所有需要在退出时刷盘的 store 集中在这里管理，避免遗漏
// 每个 store 至少具备 flush() / saveToDiskSync() / _saveToDiskSync() / saveToDisk() 之一
const flushableStores = [
  { name: 'chatHistoryStore', store: chatHistoryStore },
  { name: 'todoStore', store: todoStore },
  { name: 'memoryManager', store: memoryManager },
  { name: 'budgetManager', store: budgetManager },
  { name: 'tokenTracker', store: tokenTracker },
  { name: 'agentConfigStore', store: agentConfigStore },
  { name: 'agentCommunication', store: agentCommunication },
  { name: 'operationsStore', store: operationsStore },
  { name: 'projectStore', store: projectStore },
];

/**
 * 遍历 flushableStores，调用每个 store 的刷盘方法。
 * 优先调用 flush()（通常包含防抖清理），其次 saveToDiskSync() / _saveToDiskSync()，
 * 最后回退到 saveToDisk()（projectStore/operationsStore 的 saveToDisk 实际使用 sync fs API）。
 * 每个 store 独立 try-catch，单个失败不影响其他。
 */
function flushAll() {
  for (const { name, store } of flushableStores) {
    try {
      if (!store) continue;
      if (typeof store.flush === 'function') {
        store.flush();
      } else if (typeof store.saveToDiskSync === 'function') {
        store.saveToDiskSync();
      } else if (typeof store._saveToDiskSync === 'function') {
        store._saveToDiskSync();
      } else if (typeof store.saveToDisk === 'function') {
        // operationsStore / projectStore 的 saveToDisk 实际使用 atomicWriteSync / writeFileSync
        store.saveToDisk();
      } else {
        logger.warn(`flushAll: store "${name}" 没有可用的刷盘方法，已跳过`);
      }
    } catch (err) {
      // 单个 store 失败不影响其他 store 的刷盘
      try { logger.error(`flushAll: store "${name}" 刷盘失败:`, err); } catch (_) { console.error(`flushAll: store "${name}" 刷盘失败:`, err); }
    }
  }
}

/**
 * 注册应用退出相关钩子。必须在 app.whenReady 之后调用一次。
 */
function registerLifecycle() {
  // macOS: 所有窗口关闭后不退出应用，保留 dock 图标
  // Windows/Linux: 所有窗口关闭后退出应用
  app.on('window-all-closed', () => {
    if (!isMac()) {
      app.quit();
    }
  });

  // 应用退出前确保所有 store 刷盘（P0-3：覆盖全部需要 flush 的 store）
  app.on('before-quit', () => {
    flushAll();
    memoryManager.stopMaintenanceSchedule();
  });

  // 进程信号处理：确保被 kill/Ctrl+C 终止时也能刷盘
  // 先 flushAll()，再调用 app.quit() 让 Electron 触发 before-quit 钩子链（而不是 process.exit(0) 绕过它）
  process.on('SIGINT', () => {
    flushAll();
    app.quit();
  });
  process.on('SIGTERM', () => {
    flushAll();
    app.quit();
  });
}

module.exports = {
  flushableStores,
  flushAll,
  registerLifecycle,
};
