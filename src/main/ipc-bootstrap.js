/**
 * SoloForge - IPC 注册集中入口（P1-2 拆分产物）
 *
 * 从 main.js 抽出全部 IPC 注册逻辑：
 * - 14 个 setup*IpcHandlers（账号 / agent / chat / 权限 / 报告 / agent-config /
 *   operations / collaboration / PM / memory / 附件 / STT / 预算 / 云同步）
 * - 10 个内联 ipcMain.handle（app:get-version / app:open-external / app:quit /
 *   chat-history:get|set|remove / todo:get-all|get-agent / patrol:get-status|toggle）
 * - todoStore.onChanged 订阅（向所有窗口广播 todo:updated）
 *
 * 模块结构：
 * - registerGlobalIpcHandlers()：注册不依赖 webContents 的全局 handler + todoStore 订阅。
 *   幂等（内部用 _registered 守卫），由 main.js 在 app.whenReady 时调用一次。
 * - registerWindowHandlers(webContents)：注册依赖 webContents 的 handler + 设置
 *   departmentGroup 的 webContents + 7 个无参 setup handler。由 window-manager.createWindow 调用。
 * - registerAccountIpcHandlers({ onCompanySelected, onLogout })：注册账号系统 IPC，
 *   接收公司切换回调。由 main.js 在 app.whenReady 时调用。
 *
 * 模块加载时无副作用，所有注册都通过显式函数调用。
 */

const { app, ipcMain, shell } = require('electron');
const { logger } = require('./utils/logger');
const { appContext } = require('./app-context');
const { flushAll } = require('./lifecycle');

// 14 个 setup handler 模块（账号 / agent / chat / 权限 / 报告 / agent-config /
// operations / collaboration / PM / memory / 附件 / STT / 预算 / 云同步）
const { setupAgentIpcHandlers } = require('./ipc-handlers');
const { setupChatIpcHandlers } = require('./chat-ipc-handlers');
const { setupPermissionsIpcHandlers } = require('./permissions-ipc-handlers');
const { setupReportIpcHandlers } = require('./report-ipc-handlers');
const { setupAgentConfigIpcHandlers } = require('./agent-config-ipc-handlers');
const { setupOperationsIpcHandlers } = require('./operations/operations-ipc-handlers');
const { setupCollaborationIpcHandlers } = require('./collaboration/collaboration-ipc-handlers');
const { setupPMIpcHandlers } = require('./pm/pm-ipc-handlers');
const { setupAccountIpcHandlers } = require('./account/account-ipc-handlers');

// 依赖单例
const { chatManager } = require('./chat');
const { chatHistoryStore } = require('./chat/chat-history-store');
const { todoStore } = require('./tools/todo-store');
const { memoryManager } = require('./memory');
const { registerMemoryIPCHandlers } = require('./memory/memory-ipc-handlers');
const { setupAttachmentIpcHandlers } = require('./attachments/attachment-ipc-handlers');
const { setupSTTIpcHandlers } = require('./stt/stt-ipc-handlers');
const { setupBudgetIpcHandlers } = require('./budget/budget-ipc-handlers');
// 云同步 IPC（与 account 同时机注册，不依赖 webContents）
const { setupSyncIpcHandlers } = require('./sync/sync-ipc-handlers');
const departmentGroup = require('./chat/department-group');

// ─── 全局内联 IPC（不依赖 webContents） ─────────────────────────
// 原本位于 main.js 顶层，模块加载时注册。这里改为显式函数调用，幂等。

let _globalRegistered = false;

/**
 * 注册不依赖 webContents 的全局 IPC handler + todoStore.onChanged 订阅。
 * 幂等，多次调用安全。由 main.js 在 app.whenReady 时调用一次。
 */
function registerGlobalIpcHandlers() {
  if (_globalRegistered) return;
  _globalRegistered = true;

  ipcMain.handle('app:get-version', () => app.getVersion());

  // 用系统默认浏览器打开外部链接
  ipcMain.handle('app:open-external', (_event, url) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      return shell.openExternal(url);
    }
  });

  // 渲染进程主动退出时调用
  ipcMain.handle('app:quit', () => {
    flushAll(); // 统一刷盘所有 store
    app.quit();
  });

  // ─── 聊天历史持久化 IPC（文件存储，不依赖 localStorage） ───
  ipcMain.handle('chat-history:get', () => {
    return chatHistoryStore.getItem();
  });

  ipcMain.handle('chat-history:set', (_event, value) => {
    chatHistoryStore.setItem(value);
  });

  ipcMain.handle('chat-history:remove', () => {
    chatHistoryStore.removeItem();
  });

  // ─── Agent TODO IPC ───────────────────────────────────────────
  ipcMain.handle('todo:get-all', () => {
    return todoStore.getAll();
  });

  ipcMain.handle('todo:get-agent', (_event, agentId) => {
    return todoStore.getTodos(agentId);
  });

  // ─── 任务巡查开关 IPC ────────────────────────────────────────
  // 注意：这里通过 appContext.getTaskPatrol() 读取当前实例，
  // 用 isRunning() 公开方法代替原来的 _running 私有字段访问（P1-10）。
  ipcMain.handle('patrol:get-status', () => {
    const patrol = appContext.getTaskPatrol();
    return { running: patrol?.isRunning() ?? false };
  });

  ipcMain.handle('patrol:toggle', (_event, enabled) => {
    const patrol = appContext.getTaskPatrol();
    if (!patrol) {
      return { success: false, running: false, error: '巡查系统未初始化' };
    }
    appContext.setPatrolUserDisabled(!enabled); // 记住用户偏好
    if (enabled) {
      patrol.start(5 * 60 * 1000);
      logger.info('任务巡查系统已手动开启');
    } else {
      patrol.stop();
      logger.info('任务巡查系统已手动关闭');
    }
    return { success: true, running: patrol.isRunning() };
  });

  // 云同步 IPC（与 account 同时机注册：登录走 account handler，
  // 本处仅注册 sync 操作类通道 manual-sync/pull/push/get-status/set-auto-sync）
  setupSyncIpcHandlers();
  logger.info('云同步 IPC 已注册');

  // TODO 变更时推送给所有渲染进程
  todoStore.onChanged((agentId, todos) => {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('todo:updated', { agentId, todos });
    }
  });
}

/**
 * 注册依赖 webContents 的 IPC handler + 设置 departmentGroup 的 webContents +
 * 注册 7 个不依赖 webContents 的 setup handler（报告/agent-config/operations/
 * collaboration/PM/附件/STT/预算/memory）。
 * 由 window-manager.createWindow 调用。
 *
 * @param {import('electron').WebContents} webContents
 */
function registerWindowHandlers(webContents) {
  // 依赖 webContents 的 3 个 handler
  setupAgentIpcHandlers(webContents);
  setupChatIpcHandlers(webContents);
  setupPermissionsIpcHandlers(webContents);

  // 设置部门群聊管理器的 webContents
  departmentGroup.setWebContents(webContents);

  // 不依赖 webContents 的 setup handler（原在 createWindow 内一并注册）
  setupReportIpcHandlers();
  setupAgentConfigIpcHandlers();
  setupOperationsIpcHandlers();
  setupCollaborationIpcHandlers();

  setupPMIpcHandlers();
  registerMemoryIPCHandlers(memoryManager);
  setupAttachmentIpcHandlers();

  try {
    setupSTTIpcHandlers();
  } catch (err) {
    logger.error('STT IPC 注册失败:', err);
  }

  // 预算系统 IPC
  setupBudgetIpcHandlers();
}

/**
 * 注册账号系统 IPC。必须在 app.whenReady 最开始调用（渲染进程启动后立即调用）。
 * @param {{ onCompanySelected: (accountId: string, companyId: string) => Promise<void>, onLogout: () => Promise<void> }} handlers
 */
function registerAccountIpcHandlers(handlers) {
  setupAccountIpcHandlers(handlers);
  logger.info('账号系统 IPC 已注册');
}

module.exports = {
  registerGlobalIpcHandlers,
  registerWindowHandlers,
  registerAccountIpcHandlers,
};
