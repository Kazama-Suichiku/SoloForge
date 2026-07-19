/**
 * SoloForge - 主进程全局状态容器（P1-2 拆分产物）
 *
 * 背景：原 main.js 用文件作用域的 `let mainWindow / llmManager / pmEngine / taskPatrol` 等
 * 可变变量直接被多处函数读写。拆分后这些函数分散到 window-manager / company-switch /
 * scheduler-bootstrap / ipc-bootstrap / lifecycle 等模块，如果继续用模块私有变量
 * 会出现“各自持有一份副本”或“互相循环 require”的问题。
 *
 * 解决：用一个最小化的 AppContext 单例集中托管这些共享可变状态。所有模块通过
 * `getMainWindow() / setMainWindow()` 等读写，避免直接 require 对方模块拿变量，
 * 也避免暴露私有字段。store 单例（agentConfigStore、todoStore 等）本身就是单例模块，
 * 各模块直接 require 即可，不需要放这里。
 *
 * 设计原则：
 * - 只放“跨模块共享的可变单例”和“跨公司切换需要保留的用户偏好”
 * - 不放持久化数据（store 自己管）
 * - 不做初始化逻辑（初始化在 company-switch / scheduler-bootstrap 里）
 * - getter 返回当前值（可能为 null），调用方需自行判空
 */

const { logger } = require('./utils/logger');

class AppContext {
  constructor() {
    /** @type {import('electron').BrowserWindow | null} */
    this._mainWindow = null;
    /** @type {import('./llm').LLMManager | null} */
    this._llmManager = null;
    /** @type {any | null} PM 引擎实例 */
    this._pmEngine = null;
    /** @type {import('./patrol/task-patrol').TaskPatrol | null} */
    this._taskPatrol = null;
    /** 用户是否手动关闭了任务巡查（跨公司切换保留偏好） */
    this._patrolUserDisabled = true; // 默认关闭自动巡查，用户需在界面手动开启
  }

  // ─── mainWindow ──────────────────────────────────────────────
  getMainWindow() {
    return this._mainWindow;
  }

  setMainWindow(win) {
    this._mainWindow = win;
    logger.debug('AppContext: mainWindow 已设置', { isNull: win === null });
  }

  /**
   * 获取 webContents（可能为 null）。便捷方法，避免到处判空 mainWindow。
   * @returns {import('electron').WebContents | null}
   */
  getWebContents() {
    const win = this._mainWindow;
    if (!win || win.isDestroyed()) return null;
    return win.webContents;
  }

  // ─── llmManager ─────────────────────────────────────────────
  getLLMManager() {
    return this._llmManager;
  }

  setLLMManager(mgr) {
    this._llmManager = mgr;
  }

  // ─── pmEngine ───────────────────────────────────────────────
  getPMEngine() {
    return this._pmEngine;
  }

  setPMEngine(engine) {
    this._pmEngine = engine;
  }

  // ─── taskPatrol ─────────────────────────────────────────────
  getTaskPatrol() {
    return this._taskPatrol;
  }

  setTaskPatrol(patrol) {
    this._taskPatrol = patrol;
  }

  // ─── patrolUserDisabled 偏好 ────────────────────────────────
  isPatrolUserDisabled() {
    return this._patrolUserDisabled;
  }

  setPatrolUserDisabled(disabled) {
    this._patrolUserDisabled = !!disabled;
  }
}

// 单例
const appContext = new AppContext();

module.exports = { AppContext, appContext };
