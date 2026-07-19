/**
 * SoloForge - 应用生命周期与退出刷盘（P1-2 拆分产物 / P3-E DI 适配）
 *
 * 从 main.js 抽出：
 * - flushableStores 数组 + flushAll()（Phase 0 统一退出刷盘）
 * - window-all-closed 钩子（macOS 保留 dock，其他平台退出）
 * - before-quit 钩子（刷盘 + 停维护调度）
 * - SIGINT / SIGTERM 钩子（被 kill 时也刷盘，再走 app.quit 触发 before-quit 链）
 *
 * P3-E 适配：
 * - flushAll 改为从 appContext.listDependencies() 动态枚举所有已注册依赖，
 *   对其中暴露 flush/saveToDisk* 等方法的实例逐个刷盘。这样新增 store 只要
 *   register 到 DI 容器即可被退出刷盘覆盖，无需修改本模块。
 * - 为保留显式可见性与对外契约，仍导出 flushableStores（描述性清单，
 *   列出已知 store 名 → 其 require 来源，便于人类阅读和外部调用者引用）。
 * - registerLifecycle 退出钩子链不变。
 *
 * 设计：本模块只负责“退出/刷盘”这条链。flushAll 不依赖任何运行时单例引用，
 * 仅依赖 appContext DI 容器（读取已注册依赖）。registerLifecycle(app) 在
 * app.whenReady 之后调用一次，把钩子挂上去；flushAll 也导出供 ipc-bootstrap
 * 的 app:quit handler 调用。
 */

const { app } = require('electron');
const { isMac } = require('./utils/platform');
const { logger } = require('./utils/logger');
const { appContext } = require('./app-context');

// ─── 统一退出刷盘（P0-3 / P3-E DI 化）────────────────────────
// 所有需要在退出时刷盘的 store 都通过 DI 容器统一枚举：
// 只要某个依赖实例暴露以下方法之一就会被刷盘：
//   flush() / saveToDiskSync() / _saveToDiskSync() / saveToDisk()
// 模块加载期直接 require 各 store 单例并 register 到 appContext，使其立即可见。
// 这样 flushAll 就能从 appContext.listDependencies() 拿到完整清单。
const { chatHistoryStore } = require('./chat/chat-history-store');
const { todoStore } = require('./tools/todo-store');
const { memoryManager } = require('./memory');
const { budgetManager } = require('./budget/budget-manager');
const { tokenTracker } = require('./budget/token-tracker');
const { agentConfigStore } = require('./config/agent-config-store');
const { agentCommunication } = require('./collaboration/agent-communication');
const { operationsStore } = require('./operations/operations-store');
const { projectStore } = require('./pm/project-store');

/**
 * 描述性清单：列出“应当被退出刷盘覆盖”的依赖名。
 * flushAll 实际遍历的是 appContext.listDependencies()，此数组仅供人类阅读、
 * 测试断言与外部模块引用依赖名时使用。新增 store 时在此登记名字即可，
 * 实例通过 appContext.register(name, instance) 注入。
 */
const FLUSHABLE_DEPENDENCY_NAMES = [
  'chatHistoryStore',
  'todoStore',
  'memoryManager',
  'budgetManager',
  'tokenTracker',
  'agentConfigStore',
  'agentCommunication',
  'operationsStore',
  'projectStore',
];

/**
 * 向后兼容：保留 flushableStores 导出，结构不变（{ name, store }），
 * 但 store 改为从 appContext 动态读取，避免本模块持有独立实例引用。
 * 注意：这是一个 getter 数组，每次访问都重新构建；旧代码若做了
 * `flushableStores[0].store = xxx` 之类的写入不会影响 DI 容器（属预期行为）。
 */
function getFlushableStores() {
  return FLUSHABLE_DEPENDENCY_NAMES.map((name) => ({
    name,
    store: appContext.get(name),
  }));
}

/**
 * 模块加载期把已知 store 单例 register 到 DI 容器，使它们立即可被
 * listDependencies() / flushAll() 看到。这一步是幂等的（register 覆盖写），
 * 且不影响那些原本就通过 getter/setter 注入的依赖（mainWindow 等）。
 */
function registerFlushableStores() {
  appContext.register('chatHistoryStore', chatHistoryStore);
  appContext.register('todoStore', todoStore);
  appContext.register('memoryManager', memoryManager);
  appContext.register('budgetManager', budgetManager);
  appContext.register('tokenTracker', tokenTracker);
  appContext.register('agentConfigStore', agentConfigStore);
  appContext.register('agentCommunication', agentCommunication);
  appContext.register('operationsStore', operationsStore);
  appContext.register('projectStore', projectStore);
}
registerFlushableStores();

/**
 * 遍历 appContext 中所有已注册依赖，对暴露刷盘方法的实例逐个刷盘。
 * 优先调用 flush()（通常包含防抖清理），其次 saveToDiskSync() / _saveToDiskSync()，
 * 最后回退到 saveToDisk()（projectStore/operationsStore 的 saveToDisk 实际使用 sync fs API）。
 * 每个 store 独立 try-catch，单个失败不影响其他。
 *
 * 仅处理已知“应当刷盘”的依赖名（FLUSHABLE_DEPENDENCY_NAMES），
 * 避免误触发 mainWindow / llmManager 等非 store 依赖上同名方法。
 */
function flushAll() {
  for (const name of FLUSHABLE_DEPENDENCY_NAMES) {
    const store = appContext.get(name);
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
    const mm = appContext.get('memoryManager');
    if (mm && typeof mm.stopMaintenanceSchedule === 'function') {
      mm.stopMaintenanceSchedule();
    }
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

// flushableStores：保留旧导出名（数组形态），供外部引用依赖名时使用。
// 值为数组，元素 { name, store }，store 从 appContext 动态读取。
// 注意：此导出为快照性质（模块加载时刻构建），主要供“依赖名列表”用途。
const flushableStores = getFlushableStores();

module.exports = {
  flushableStores,
  FLUSHABLE_DEPENDENCY_NAMES,
  getFlushableStores,
  flushAll,
  registerLifecycle,
};
