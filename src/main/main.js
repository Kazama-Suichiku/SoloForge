/**
 * SoloForge - Main Process 主进程入口
 * 负责窗口管理、应用生命周期
 *
 * 开发模式：加载 http://localhost:5173（Vite 热更新）
 * 生产模式：加载 dist-renderer/index.html（打包后）
 */

const { app, BrowserWindow, ipcMain, shell, protocol, net } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

// ─── 注册自定义协议（必须在 app.ready 之前） ───────────────────────
// sf-local:// 协议用于安全访问本地文件（图片/音频附件）
// 解决开发模式下 http://localhost:5173 无法加载 file:// 资源的跨域问题
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sf-local',
    privileges: {
      standard: false,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: false,
    },
  },
]);

// 在最开始加载环境变量 - 需要指定正确的路径
// 开发模式：从项目根目录加载
// 生产模式：从 app.asar 内加载
const dotenvPath = isDev
  ? path.join(__dirname, '../../.env')
  : path.join(process.resourcesPath, 'app.asar', '.env');
require('dotenv').config({ path: dotenvPath });

const { setup } = require('./agents/setup');
const { setupAgentIpcHandlers } = require('./ipc-handlers');
const { setupChatIpcHandlers } = require('./chat-ipc-handlers');
const { setupPermissionsIpcHandlers } = require('./permissions-ipc-handlers');
const { setupReportIpcHandlers } = require('./report-ipc-handlers');
const { setupAgentConfigIpcHandlers } = require('./agent-config-ipc-handlers');
const { setupOperationsIpcHandlers } = require('./operations/operations-ipc-handlers');
const { setupCollaborationIpcHandlers } = require('./collaboration/collaboration-ipc-handlers');
const { setupSyncIpcHandlers } = require('./sync/sync-ipc-handlers');
const { initializeSync } = require('./sync');
const { setupPMIpcHandlers } = require('./pm/pm-ipc-handlers');
const { chatManager } = require('./chat');
const { LLMManager } = require('./llm');
const { isMac } = require('./utils/platform');
const { logger } = require('./utils/logger');
const { permissionStore } = require('./config/permission-store');
const { setupTools } = require('./tools/setup');
const { alertSystem } = require('./budget/alert-system');
const { TaskPatrol } = require('./patrol/task-patrol');
const { chatHistoryStore } = require('./chat/chat-history-store');
const { todoStore } = require('./tools/todo-store');
const { memoryManager } = require('./memory');
const { registerMemoryIPCHandlers } = require('./memory/memory-ipc-handlers');
const { setupAttachmentIpcHandlers } = require('./attachments/attachment-ipc-handlers');
const { setupSTTIpcHandlers } = require('./stt/stt-ipc-handlers');

// ─── 多账号系统 ───────────────────────────────────────────────
const { setupAccountIpcHandlers } = require('./account/account-ipc-handlers');
const { dataPath } = require('./account/data-path');
const { sessionManager } = require('./account/session-manager');
const { companyStore } = require('./account/company-store');
const { agentConfigStore } = require('./config/agent-config-store');
const { operationsStore } = require('./operations/operations-store');
const { agentCommunication } = require('./collaboration/agent-communication');

// Store 引用（用于公司切换时重初始化）
const { memoryStore } = require('./memory/memory-store');
const { projectStore } = require('./pm/project-store');
const { devPlanQueue } = require('./collaboration/dev-plan-queue');
const { approvalQueue } = require('./agent-factory/approval-queue');
const { terminationQueue } = require('./agent-factory/termination-queue');
const { tokenTracker } = require('./budget/token-tracker');
const { budgetManager } = require('./budget/budget-manager');
const { attachmentManager } = require('./attachments/attachment-manager');

let mainWindow = null;
let llmManager = null;
let pmEngine = null;
let taskPatrol = null;

// ─── 公司切换：初始化所有 Store ─────────────────────────────
/**
 * 当用户选择公司后，初始化（或重初始化）所有子系统
 * @param {string} accountId
 * @param {string} companyId
 */
async function initializeForCompany(accountId, companyId) {
  logger.info('初始化公司数据...', { accountId, companyId });

  // 1. 设置数据路径上下文（所有 store 的路径都会指向新目录）
  dataPath.setCurrentContext(accountId, companyId);
  dataPath.ensureDirectories();

  // 2. 重初始化所有 store（从新路径加载数据）
  agentConfigStore.reinitialize();
  chatHistoryStore.reinitialize();
  todoStore.reinitialize();
  todoStore.load();
  permissionStore.reinitialize();
  operationsStore.reinitialize();
  projectStore.reinitialize();
  agentCommunication.reinitialize();
  devPlanQueue.reinitialize();
  approvalQueue.reinitialize();
  terminationQueue.reinitialize();
  tokenTracker.reinitialize();
  tokenTracker.purgeZeroTokenRecords(); // 清理历史遗留的 0-token 无效记录
  budgetManager.reinitialize();
  memoryStore.reinitialize();
  attachmentManager.reinitialize();

  // 3. 重新初始化依赖 store 数据的子系统
  // 注意：setup() 和 setupTools() 不在此调用
  // 工具定义和 Agent 实例是全局的，已在 app.whenReady() 中注册，不随公司切换变化

  if (llmManager) {
    chatManager.setLLMManager(llmManager);
    chatManager.initToolExecutor();
    memoryManager.initialize(llmManager);
    memoryManager.startMaintenanceSchedule();
  }

  // 4. 恢复已批准的动态 Agent
  try {
    const { dynamicAgentFactory } = require('./agent-factory/dynamic-agent');
    const restoreResult = dynamicAgentFactory.restoreApprovedAgents();
    if (restoreResult.restored > 0) {
      logger.info('动态 Agent 恢复结果:', restoreResult);
    }
  } catch (err) {
    logger.error('恢复动态 Agent 失败:', err);
  }

  // 5. 重启 PM 引擎
  if (pmEngine) {
    pmEngine.stop();
    pmEngine = null;
  }
  const { initPMEngine } = require('./pm');
  pmEngine = initPMEngine({
    operationsStore,
    agentCommunication,
    chatManager,
  }, 3 * 60 * 1000);
  logger.info('PM 引擎已启动');

  // 6. 重启预算预警
  alertSystem.stop?.();
  alertSystem.start(60000);

  // 7. 重启任务巡查
  if (taskPatrol) {
    taskPatrol.stop();
    taskPatrol = null;
  }
  taskPatrol = new TaskPatrol({
    operationsStore,
    todoStore,
    agentCommunication,
    chatManager,
    projectStore,
    approvalQueue,
    memoryManager,
    llmManager,
    tokenTracker,
    budgetManager,
  });
  taskPatrol.start(5 * 60 * 1000); // 每 5 分钟巡查一次
  logger.info('任务巡查系统已启动');

  logger.info('公司数据初始化完成', { accountId, companyId });
}

/**
 * 清理当前公司状态（切换公司前调用）
 */
async function cleanupCurrentCompany() {
  logger.info('清理当前公司状态...');

  // 1. 刷盘所有数据
  chatHistoryStore.flush();
  todoStore.flush();
  memoryManager.flush();

  // 2. 停止定时器
  memoryManager.stopMaintenanceSchedule();
  alertSystem.stop?.();
  if (pmEngine) {
    pmEngine.stop();
    pmEngine = null;
  }
  if (taskPatrol) {
    taskPatrol.stop();
    taskPatrol = null;
  }

  logger.info('当前公司状态已清理');
}

function createWindow() {
  // 注册 sf-local:// 协议处理器，将 sf-local:///path → file:///path
  protocol.handle('sf-local', (request) => {
    // sf-local:///Users/xxx/file.png → file:///Users/xxx/file.png
    const filePath = request.url.slice('sf-local://'.length);
    return net.fetch(`file://${filePath}`);
  });
  logger.info('自定义协议 sf-local:// 已注册');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // macOS: 隐藏标题栏但保留红绿灯，内容延伸到标题栏区域
    ...(isMac() ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 开发模式：Vite dev server | 生产模式：打包后的 dist-renderer
  const prodHtml = path.join(__dirname, '../../dist-renderer/index.html');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      // dev server 未运行时回退到打包后的 HTML
      logger.warn('Vite dev server 不可用，回退到本地 HTML');
      mainWindow.loadFile(prodHtml);
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(prodHtml);
  }

  // ─── 注册需要 webContents 的 IPC 处理器 ─────────────────────
  // 注意：账号系统 IPC 已在 app.whenReady() 中提前注册，不在此处
  setupAgentIpcHandlers(mainWindow.webContents);
  setupChatIpcHandlers(mainWindow.webContents);
  setupPermissionsIpcHandlers(mainWindow.webContents);
  setupReportIpcHandlers();
  setupAgentConfigIpcHandlers();
  setupOperationsIpcHandlers();
  setupCollaborationIpcHandlers();
  setupSyncIpcHandlers();

  // 初始化云同步系统
  initializeSync();
  setupPMIpcHandlers();
  registerMemoryIPCHandlers(memoryManager);
  setupAttachmentIpcHandlers();

  try {
    setupSTTIpcHandlers();
  } catch (err) {
    logger.error('STT IPC 注册失败:', err);
  }

  // ─── 外部链接拦截：阻止窗口内跳转，改用系统浏览器打开 ────────
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 允许开发模式下的 Vite HMR 和 localhost 导航
    if (url.startsWith('http://localhost')) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' }; // 阻止在新窗口中打开
  });

  // ─── 窗口崩溃恢复 ───────────────────────────────────────────
  // 捕获渲染器控制台错误用于调试
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2 && !sourceId?.includes('devtools://')) { // warning and error, skip devtools
      console.log(`[Renderer] ${message} (${sourceId}:${line})`);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error('渲染进程崩溃:', details.reason, details.exitCode);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    logger.warn('渲染进程无响应');
  });

  mainWindow.webContents.on('responsive', () => {
    logger.info('渲染进程已恢复响应');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('app:get-version', () => app.getVersion());

// 用系统默认浏览器打开外部链接
ipcMain.handle('app:open-external', (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    return shell.openExternal(url);
  }
});

// 渲染进程主动退出时调用
ipcMain.handle('app:quit', () => {
  chatHistoryStore.flush(); // 退出前刷盘
  todoStore.flush();        // TODO 刷盘
  memoryManager.flush();    // 记忆系统刷盘
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
ipcMain.handle('patrol:get-status', () => {
  return { running: taskPatrol?._running ?? false };
});

ipcMain.handle('patrol:toggle', (_event, enabled) => {
  if (!taskPatrol) {
    return { success: false, running: false, error: '巡查系统未初始化' };
  }
  if (enabled) {
    taskPatrol.start(5 * 60 * 1000);
    logger.info('任务巡查系统已手动开启');
  } else {
    taskPatrol.stop();
    logger.info('任务巡查系统已手动关闭');
  }
  return { success: true, running: taskPatrol._running };
});

// TODO 变更时推送给所有渲染进程
todoStore.onChanged((agentId, todos) => {
  const { BrowserWindow } = require('electron');
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('todo:updated', { agentId, todos });
  }
});

app.whenReady().then(async () => {
  // ─── 全局初始化（不依赖公司选择） ──────────────────────────

  // 账号系统 IPC 必须最先注册（渲染进程启动后立即调用）
  setupAccountIpcHandlers({
    onCompanySelected: async (accountId, companyId) => {
      await cleanupCurrentCompany();
      await initializeForCompany(accountId, companyId);
    },
    onLogout: async () => {
      await cleanupCurrentCompany();
    },
  });
  logger.info('账号系统 IPC 已注册');

  // LLM Manager 全局共享
  llmManager = new LLMManager();
  logger.info('LLM Manager 已创建');

  // 全局注册：Agent 实例 & 工具（仅注册一次，不随公司切换变化）
  setup();
  setupTools();
  chatManager.setLLMManager(llmManager);
  chatManager.initToolExecutor();
  logger.info('全局 Agent 和工具系统已初始化');

  // ─── 恢复上次会话（如有） ──────────────────────────────────
  const session = sessionManager.getSession();
  if (session && session.accountId && session.lastCompanyId) {
    // 恢复账号上下文
    companyStore.initForAccount(session.accountId);
    const company = companyStore.getCompany(session.lastCompanyId);
    if (company) {
      logger.info('恢复上次会话', { accountId: session.accountId, companyId: session.lastCompanyId });
      dataPath.setCurrentContext(session.accountId, session.lastCompanyId, company.name);
      await initializeForCompany(session.accountId, session.lastCompanyId);
    } else {
      logger.info('上次会话的公司已不存在，等待用户重新选择');
    }
  } else {
    logger.info('无活跃会话，等待用户登录');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// macOS: 所有窗口关闭后不退出应用，保留 dock 图标
// Windows/Linux: 所有窗口关闭后退出应用
app.on('window-all-closed', () => {
  if (!isMac()) {
    app.quit();
  }
});

// 应用退出前确保聊天历史和记忆系统刷盘
app.on('before-quit', () => {
  chatHistoryStore.flush();
  todoStore.flush();
  memoryManager.flush();
  memoryManager.stopMaintenanceSchedule();
});

// 进程信号处理：确保被 kill/Ctrl+C 终止时也能刷盘
process.on('SIGINT', () => {
  chatHistoryStore.flush();
  todoStore.flush();
  memoryManager.flush();
  process.exit(0);
});
process.on('SIGTERM', () => {
  chatHistoryStore.flush();
  todoStore.flush();
  memoryManager.flush();
  process.exit(0);
});
