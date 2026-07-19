/**
 * SoloForge - 窗口管理（P1-2 拆分产物）
 *
 * 从 main.js 抽出：
 * - sf-local:// 协议处理器注册（在 createWindow 内）
 * - createWindow：创建 BrowserWindow、加载 URL、注册依赖 webContents 的 IPC handler、
 *   挂载 webContents 事件（will-navigate / setWindowOpenHandler / console-message /
 *   render-process-gone / unresponsive / responsive / closed）
 *
 * 设计：
 * - 全局窗口实例通过 app-context 读写（getMainWindow / setMainWindow），不在本模块持有变量
 * - 依赖 webContents 的 IPC handler 注册延迟到 ipc-bootstrap.registerWindowHandlers(webContents)，
 *   避免本模块直接 require 13 个 setup*IpcHandlers（保持 window-manager 单一职责）
 * - createWindow 后重试 initializeDepartmentGroups（company-switch 暴露），覆盖
 *   initializeForCompany 时尚无 webContents 的情况
 */

const { BrowserWindow, shell, protocol, net } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { isMac } = require('./utils/platform');
const { logger } = require('./utils/logger');
const { appContext } = require('./app-context');
// 延迟 require ipc-bootstrap，避免初始化时序问题（其实无循环依赖，但保持显式）
const { registerWindowHandlers } = require('./ipc-bootstrap');
// company-switch 提供 initializeDepartmentGroups（窗口创建后重试）
const { initializeDepartmentGroups } = require('./company-switch');

// sf-local:// 协议只注册一次（Electron 要求 protocol.handle 幂等性由调用方保证）
let _protocolRegistered = false;

/**
 * 注册 sf-local:// 协议处理器，将 sf-local:///path → file:///path
 * 用于安全访问本地文件（图片/音频附件），解决开发模式下 http://localhost:5173
 * 无法加载 file:// 资源的跨域问题。
 */
function registerSfLocalProtocol() {
  if (_protocolRegistered) return;
  protocol.handle('sf-local', (request) => {
    // sf-local:///Users/xxx/file.png → file:///Users/xxx/file.png
    const filePath = request.url.slice('sf-local://'.length);
    return net.fetch(`file://${filePath}`);
  });
  _protocolRegistered = true;
  logger.info('自定义协议 sf-local:// 已注册');
}

/**
 * 创建主窗口。可在 app.whenReady 之后多次调用（macOS activate 时复用）。
 * 每次调用都会：
 * 1. 注册 sf-local:// 协议（幂等）
 * 2. 创建 BrowserWindow 并加载开发/生产 URL
 * 3. 注册依赖 webContents 的 IPC handler（agent/chat/permissions/...）
 * 4. 设置部门群聊管理器的 webContents 并重试初始化部门群聊
 * 5. 挂载 webContents 事件（外部链接拦截、崩溃恢复、控制台日志、关闭清理）
 */
function createWindow() {
  registerSfLocalProtocol();

  const mainWindow = new BrowserWindow({
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
  appContext.setMainWindow(mainWindow);

  // 开发模式：Vite dev server | 生产模式：打包后的 dist-renderer
  const prodHtml = path.join(__dirname, '../../dist-renderer/index.html');
  if (isDev) {
    mainWindow.loadURL('http://localhost:8888').catch(() => {
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
  registerWindowHandlers(mainWindow.webContents);

  // 初始化部门群聊（webContents 现在可用了）
  // 这会为已存在但在 initializeForCompany 时尚无 webContents 的部门创建群聊
  try {
    initializeDepartmentGroups();
  } catch (err) {
    logger.error('窗口创建后初始化部门群聊失败:', err);
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
    appContext.setMainWindow(null);
  });
}

module.exports = {
  createWindow,
  registerSfLocalProtocol,
};
