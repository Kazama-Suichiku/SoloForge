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
const { salaryScheduler } = require('./budget/salary-scheduler');
const { TaskPatrol } = require('./patrol/task-patrol');
const { chatHistoryStore } = require('./chat/chat-history-store');
const { todoStore } = require('./tools/todo-store');
const { memoryManager } = require('./memory');
const { registerMemoryIPCHandlers } = require('./memory/memory-ipc-handlers');
const { setupAttachmentIpcHandlers } = require('./attachments/attachment-ipc-handlers');
const { setupSTTIpcHandlers } = require('./stt/stt-ipc-handlers');
const { setupBudgetIpcHandlers } = require('./budget/budget-ipc-handlers');

// ─── 多账号系统 ───────────────────────────────────────────────
const { setupAccountIpcHandlers } = require('./account/account-ipc-handlers');
const { dataPath } = require('./account/data-path');
const { sessionManager } = require('./account/session-manager');
const { companyStore } = require('./account/company-store');
const { agentConfigStore, AGENT_STATUS } = require('./config/agent-config-store');
const { operationsStore } = require('./operations/operations-store');
const { agentCommunication } = require('./collaboration/agent-communication');
const departmentGroup = require('./chat/department-group');

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
/** 用户是否手动关闭了任务巡查（跨公司切换保留偏好） */
let patrolUserDisabled = false;

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
  const { departmentStore } = require('./config/department-store');
  departmentStore.reinitialize(); // 必须在 agentConfigStore 之前，因为后者可能依赖部门数据
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

  // 2.5 初始化上下文管理模块（虚拟文件、暂存区）
  // 必须在 dataPath.setCurrentContext() 之后执行，确保路径正确
  try {
    const { virtualFileStore } = require('./context/virtual-file-store');
    const { scratchpadManager } = require('./context/agent-scratchpad');
    virtualFileStore.reinitialize(); // 从新公司路径加载索引
    scratchpadManager.reinitialize(); // 清空缓存，下次 get() 会从新路径加载
  } catch (e) {
    logger.warn('上下文模块初始化失败:', e.message);
  }

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

  // 4.5 初始化部门群聊（为现有员工创建）
  // 注意：如果窗口尚未创建（webContents 不可用），会在 createWindow 中重试
  try {
    initializeDepartmentGroups();
  } catch (err) {
    // 如果是 webContents 不可用的错误，不打印警告，等窗口创建后重试
    if (!err.message?.includes('webContents')) {
      logger.error('初始化部门群聊失败:', err);
    }
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

  // 7. 重启任务巡查（尊重用户手动关闭的偏好）
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
  if (!patrolUserDisabled) {
    taskPatrol.start(5 * 60 * 1000); // 每 5 分钟巡查一次
    logger.info('任务巡查系统已启动');
  } else {
    logger.info('任务巡查系统已创建但未启动（用户此前手动关闭）');
  }

  // 8. 启动工资调度器（每日 00:00 自动发薪）
  salaryScheduler.start();

  // 9. 订阅 Agent 配置变更，同步部门群聊成员
  setupAgentConfigSubscription();

  logger.info('公司数据初始化完成', { accountId, companyId });
}

/**
 * 初始化部门群聊（为现有员工创建）
 * 在应用启动或公司切换时调用，确保所有 CXO 团队都有对应的部门群聊
 */
function initializeDepartmentGroups() {
  const allConfigs = agentConfigStore.getAll();
  
  // 找出所有 CXO 级别的 Agent
  const cxoAgents = allConfigs.filter(
    (c) => c.level === 'c_level' && (c.status || 'active') !== AGENT_STATUS.TERMINATED
  );

  // 统计每个 CXO 有多少活跃下属
  const cxoTeams = new Map(); // cxoId -> [subordinateIds]
  
  for (const config of allConfigs) {
    // 跳过已离职的
    if ((config.status || 'active') === AGENT_STATUS.TERMINATED) continue;
    // 跳过 CXO 本身
    if (config.level === 'c_level') continue;
    
    // 查找该员工所属的 CXO
    const deptInfo = departmentGroup.getAgentDepartmentInfo(config.id);
    if (deptInfo?.ownerId) {
      if (!cxoTeams.has(deptInfo.ownerId)) {
        cxoTeams.set(deptInfo.ownerId, []);
      }
      cxoTeams.get(deptInfo.ownerId).push(config.id);
    }
  }

  // 为有下属的 CXO 创建部门群聊
  let created = 0;
  for (const [cxoId, subordinates] of cxoTeams) {
    if (subordinates.length === 0) continue;
    
    const cxoConfig = agentConfigStore.get(cxoId);
    if (!cxoConfig) continue;
    
    const departmentId = cxoConfig.department;
    if (!departmentId) continue;
    
    // 创建/确保部门群聊存在
    const result = departmentGroup.ensureDepartmentGroup(departmentId, cxoId);
    if (result.success) {
      created++;
      logger.info('初始化部门群聊:', {
        departmentId,
        ownerId: cxoId,
        ownerName: cxoConfig.name,
        members: subordinates.length + 1, // +1 for CXO
      });
    }
  }

  if (created > 0) {
    logger.info(`部门群聊初始化完成: 创建了 ${created} 个部门群`);
  }
}

// 用于跟踪之前的 Agent 状态（检测状态变更）
let _previousAgentStatuses = new Map();
let _agentConfigUnsubscribe = null;

/**
 * 设置 Agent 配置变更订阅，用于同步部门群聊成员
 */
function setupAgentConfigSubscription() {
  // 取消之前的订阅
  if (_agentConfigUnsubscribe) {
    _agentConfigUnsubscribe();
    _agentConfigUnsubscribe = null;
  }

  // 初始化状态快照
  const configs = agentConfigStore.getAll();
  _previousAgentStatuses.clear();
  for (const config of configs) {
    _previousAgentStatuses.set(config.id, config.status || 'active');
  }

  // 订阅变更
  _agentConfigUnsubscribe = agentConfigStore.subscribe((newConfigs) => {
    for (const config of newConfigs) {
      const prevStatus = _previousAgentStatuses.get(config.id);
      const newStatus = config.status || 'active';

      // 检测状态变更为 terminated（离职）
      if (prevStatus !== AGENT_STATUS.TERMINATED && newStatus === AGENT_STATUS.TERMINATED) {
        // 从部门群聊移除
        const deptInfo = departmentGroup.getAgentDepartmentInfo(config.id);
        if (deptInfo) {
          departmentGroup.removeMemberFromGroup(deptInfo.departmentId, config.id);
          logger.info('员工离职，已从部门群聊移除:', {
            agentId: config.id,
            agentName: config.name,
            departmentId: deptInfo.departmentId,
          });
        }
      }

      // 检测状态从 terminated 恢复（理论上不应该发生，但以防万一）
      if (prevStatus === AGENT_STATUS.TERMINATED && newStatus === AGENT_STATUS.ACTIVE) {
        const deptInfo = departmentGroup.getAgentDepartmentInfo(config.id);
        if (deptInfo) {
          departmentGroup.addMemberToGroup(deptInfo.departmentId, config.id);
          logger.info('员工复职，已加入部门群聊:', {
            agentId: config.id,
            agentName: config.name,
            departmentId: deptInfo.departmentId,
          });
        }
      }

      // 更新状态快照
      _previousAgentStatuses.set(config.id, newStatus);
    }
  });
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

  // 3. 清理运行时状态（避免旧公司数据残留）
  // 注意：这里只做内存清理，不要调用 reinitialize()（会从磁盘加载，但 dataPath 还指向旧公司）
  // 真正的 reinitialize() 在 initializeForCompany() 中 dataPath 切换后执行
  try {
    // 清理 chatManager 运行时状态
    chatManager.reinitialize();

    // 清理 historyManager 摘要缓存
    const { historyManager } = require('./chat/history-manager');
    historyManager.reinitialize();

    // 清理 scratchpadManager 内存缓存（只清 Map，不加载）
    const { scratchpadManager } = require('./context/agent-scratchpad');
    scratchpadManager.reinitialize();

    // 清理 virtualFileStore 内存索引（只清 Map，不加载旧公司数据）
    const { virtualFileStore } = require('./context/virtual-file-store');
    virtualFileStore._index.clear();
    virtualFileStore._initialized = false;

    // 清理动态 Agent 工厂
    const { dynamicAgentFactory } = require('./agent-factory/dynamic-agent');
    dynamicAgentFactory.dynamicAgents.clear();
  } catch (e) {
    logger.warn('清理运行时状态时出错:', e.message);
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
  
  // 设置部门群聊管理器的 webContents
  departmentGroup.setWebContents(mainWindow.webContents);
  
  // 初始化部门群聊（webContents 现在可用了）
  // 这会为已存在但在 initializeForCompany 时尚无 webContents 的部门创建群聊
  try {
    initializeDepartmentGroups();
  } catch (err) {
    logger.error('窗口创建后初始化部门群聊失败:', err);
  }
  
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

  // 预算系统 IPC
  setupBudgetIpcHandlers();

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
  patrolUserDisabled = !enabled; // 记住用户偏好
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
