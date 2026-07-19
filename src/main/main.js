/**
 * SoloForge - Main Process 主进程入口（P1-2 拆分收尾）
 *
 * 本文件现在只做三件事：
 * 1. 顶层初始化（必须在 app.ready 之前完成的部分）
 * 2. require 各拆分模块
 * 3. 在 app.whenReady 中编排调用顺序
 *
 * 拆分后的职责分布（详见各模块头部注释）：
 * - app-context.js         全局可变单例容器（mainWindow / llmManager / pmEngine / taskPatrol / patrolUserDisabled）
 * - lifecycle.js            flushAll + window-all-closed / before-quit / SIGINT / SIGTERM 钩子
 * - window-manager.js       createWindow + sf-local 协议 + webContents 事件
 * - ipc-bootstrap.js        14 个 setup*IpcHandlers + 10 个内联 handler + todoStore.onChanged
 * - scheduler-bootstrap.js  PM / alert / taskPatrol / salaryScheduler 重启 + stopSchedulers
 * - company-switch.js       cleanupCurrentCompany + initializeForCompany（9 步）+
 *                          initializeDepartmentGroups + setupAgentConfigSubscription + STORES 数组
 *
 * 开发模式：加载 http://localhost:5173（Vite 热更新）
 * 生产模式：加载 dist-renderer/index.html（打包后）
 */

const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

// ─── 顶层初始化（必须在 app.ready 之前）─────────────────────────

// 1. 全局异常处理（P0-5）：最先注册，捕获后续所有阶段的未处理异常。
//    只记录日志不退出，避免单点错误拖垮整个主进程。
const { logger } = require('./utils/logger');
process.on('uncaughtException', (err) => {
  try { logger.error('未捕获异常:', err); } catch (_) { console.error('未捕获异常:', err); }
});
process.on('unhandledRejection', (reason) => {
  try { logger.error('未处理的 Promise rejection:', reason); } catch (_) { console.error('未处理的 Promise rejection:', reason); }
});

// 2. 注册自定义协议（必须在 app.ready 之前）
//    sf-local:// 协议用于安全访问本地文件（图片/音频附件），
//    解决开发模式下 http://localhost:5173 无法加载 file:// 资源的跨域问题。
//    协议处理器本身（protocol.handle）在 window-manager.createWindow 内注册。
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

// 3. 加载环境变量（必须在 app.ready 之前）
//    开发模式：从项目根目录加载；生产模式：从 app.asar 内加载
const dotenvPath = isDev
  ? path.join(__dirname, '../../.env')
  : path.join(process.resourcesPath, 'app.asar', '.env');
require('dotenv').config({ path: dotenvPath });

// ─── require 各拆分模块 ─────────────────────────────────────────
// 依赖关系为有向无环图：
//   app-context ← { lifecycle, scheduler-bootstrap, company-switch,
//                   ipc-bootstrap, window-manager }
//   lifecycle ← ipc-bootstrap
//   scheduler-bootstrap ← company-switch
//   ipc-bootstrap ← window-manager
//   company-switch ← window-manager
// 无真正循环依赖，可全部在模块加载期 require。
const { appContext } = require('./app-context');
const { registerLifecycle } = require('./lifecycle');
const { createWindow } = require('./window-manager');
const { registerGlobalIpcHandlers, registerAccountIpcHandlers } = require('./ipc-bootstrap');
const { cleanupCurrentCompany, initializeForCompany } = require('./company-switch');

// 仍需在入口初始化的全局服务（不随公司切换变化）
const { setup } = require('./agents/setup');
const { setupTools } = require('./tools/setup');
const { chatManager } = require('./chat');
const { LLMManager } = require('./llm');
const { sessionManager } = require('./account/session-manager');
const { companyStore } = require('./account/company-store');
const { dataPath } = require('./account/data-path');

// ─── app.whenReady 编排 ──────────────────────────────────────────
app.whenReady().then(async () => {
  // 1. 账号系统 IPC（渲染进程启动后立即调用，必须最先注册）
  //    公司切换回调串起 cleanup → initialize 的完整流程。
  registerAccountIpcHandlers({
    onCompanySelected: async (accountId, companyId) => {
      await cleanupCurrentCompany();
      await initializeForCompany(accountId, companyId);
    },
    onLogout: async () => {
      await cleanupCurrentCompany();
    },
  });

  // 2. 注册不依赖 webContents 的全局 IPC（app:* / chat-history:* / todo:* /
  //    patrol:* / sync:* + todoStore.onChanged 订阅）。
  //    sync 与 account 同时机注册（登录走 account handler，本处仅注册 sync 操作类通道）。
  registerGlobalIpcHandlers();

  // 3. 全局服务初始化（不依赖公司选择）
  //    LLMManager / Agent 实例 / 工具都是全局的，公司切换时不重新创建。
  const llmManager = new LLMManager();
  appContext.setLLMManager(llmManager);
  logger.info('LLM Manager 已创建');

  setup();
  setupTools();
  chatManager.setLLMManager(llmManager);
  chatManager.initToolExecutor();
  logger.info('全局 Agent 和工具系统已初始化');

  // 3.5 清理孤儿 .tmp 文件（atomic-write 崩溃残留），异步执行不阻塞启动
  //    数据根目录下所有 JSON 的临时文件，超过 1 小时视为孤儿
  const { cleanupOrphanedTempFiles } = require('./utils/atomic-write');
  const { SOLOFORGE_ROOT } = require('./account/data-path');
  cleanupOrphanedTempFiles(SOLOFORGE_ROOT, { maxAgeMs: 60 * 60 * 1000, recursive: true })
    .then((deleted) => { if (deleted.length > 0) logger.info(`清理孤儿临时文件 ${deleted.length} 个`); })
    .catch((err) => logger.warn('清理孤儿临时文件失败', { error: String(err) }));

  // 4. 恢复上次会话（如有）
  const session = sessionManager.getSession();
  if (session && session.accountId && session.lastCompanyId) {
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

  // 5. 创建主窗口（内部注册 sf-local 协议 + 依赖 webContents 的 IPC +
  //    部门群聊 webContents 设置 + webContents 事件）
  createWindow();

  // 6. 生命周期钩子（window-all-closed / before-quit / SIGINT / SIGTERM）
  //    注册一次，内部已挂 flushAll + memoryManager.stopMaintenanceSchedule。
  registerLifecycle();

  // 7. macOS：点击 dock 图标时若无窗口则重建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
