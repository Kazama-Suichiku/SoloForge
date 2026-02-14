/**
 * SoloForge - 隐藏浏览器窗口池
 * 利用 Electron 自带 Chromium，为 web_search / fetch_webpage 提供浏览器级抓取能力
 * 零额外依赖，单窗口复用 + 串行队列 + 空闲自动回收
 * @module tools/browser-pool
 */

const { BrowserWindow } = require('electron');
const { logger } = require('../utils/logger');

/** 空闲窗口存活时间（毫秒） */
const IDLE_TIMEOUT = 60 * 1000; // 60 秒

/** 默认导航超时（毫秒） */
const DEFAULT_NAV_TIMEOUT = 15000;

/** 页面加载后等待 JS 渲染的额外时间（毫秒） */
const RENDER_SETTLE_MS = 1500;

/**
 * 隐藏浏览器窗口池
 * - 单例模式，全局共享一个实例
 * - 最多维护 1 个隐藏 BrowserWindow，通过队列串行化并发请求
 * - 空闲超时后自动销毁窗口节省内存，下次使用时懒创建
 * - 使用独立 partition 避免污染主窗口
 */
class BrowserPool {
  constructor() {
    /** @type {BrowserWindow|null} */
    this._window = null;
    /** @type {Promise} 串行任务队列 */
    this._queue = Promise.resolve();
    /** @type {NodeJS.Timeout|null} 空闲回收定时器 */
    this._idleTimer = null;
    /** @type {boolean} 是否已初始化 */
    this._ready = false;
  }

  /**
   * 标记就绪（在 app ready 之后调用）
   */
  init() {
    this._ready = true;
    logger.info('BrowserPool 已就绪（懒创建模式）');
  }

  /**
   * 获取或创建隐藏浏览器窗口
   * @returns {BrowserWindow}
   */
  _getOrCreateWindow() {
    // 清除空闲回收计时器
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }

    if (this._window && !this._window.isDestroyed()) {
      return this._window;
    }

    logger.info('BrowserPool: 创建隐藏浏览器窗口');
    this._window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: 'persist:web-tools',   // 独立会话，不污染主窗口
        contextIsolation: false,          // 允许 executeJavaScript 访问 DOM
        nodeIntegration: false,
        sandbox: false,                   // 需要关闭以支持 executeJavaScript
        images: false,                    // 不加载图片，加速渲染
      },
    });

    // 设置真实浏览器 User-Agent（去掉 Electron 标识）
    const defaultUA = this._window.webContents.getUserAgent();
    const cleanUA = defaultUA
      .replace(/\sElectron\/[\d.]+/, '')
      .replace(/\sSoloForge\/[\d.]+/, '');
    this._window.webContents.setUserAgent(cleanUA);

    // 窗口意外关闭时清理引用
    this._window.on('closed', () => {
      this._window = null;
    });

    return this._window;
  }

  /**
   * 启动空闲回收计时器
   * 任务完成后调用，如果指定时间内没有新任务则销毁窗口
   */
  _scheduleIdleCleanup() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
    }
    this._idleTimer = setTimeout(() => {
      if (this._window && !this._window.isDestroyed()) {
        logger.info('BrowserPool: 空闲超时，销毁隐藏窗口');
        this._window.destroy();
        this._window = null;
      }
      this._idleTimer = null;
    }, IDLE_TIMEOUT);
  }

  /**
   * 将任务加入串行队列
   * @param {Function} fn - 异步任务函数
   * @returns {Promise<any>}
   */
  _enqueue(fn) {
    const task = this._queue.then(fn, () => fn());
    // 更新队列尾部（无论成功失败都继续下一个）
    this._queue = task.catch(() => {});
    return task;
  }

  /**
   * 在隐藏浏览器中导航到 URL 并执行 JS 提取代码
   *
   * @param {string} url - 目标 URL
   * @param {string} jsCode - 在页面 DOM 中执行的 JavaScript 代码（返回值将作为结果）
   * @param {Object} [options]
   * @param {number} [options.timeout=15000] - 导航超时（毫秒）
   * @param {number} [options.settleMs=1500] - 页面加载后等待 JS 渲染的时间（毫秒）
   * @param {boolean} [options.waitForSelector] - 等待指定 CSS 选择器出现
   * @returns {Promise<any>} JS 代码的返回值
   */
  async executeOnPage(url, jsCode, options = {}) {
    if (!this._ready) {
      throw new Error('BrowserPool 未初始化，请在 app ready 之后调用 init()');
    }

    return this._enqueue(async () => {
      const timeout = options.timeout || DEFAULT_NAV_TIMEOUT;
      const settleMs = options.settleMs ?? RENDER_SETTLE_MS;
      const win = this._getOrCreateWindow();
      const wc = win.webContents;

      try {
        // 导航到目标页面
        await Promise.race([
          wc.loadURL(url),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`导航超时 (${timeout}ms): ${url}`)), timeout)
          ),
        ]);

        // 等待 JS 渲染稳定
        if (settleMs > 0) {
          await new Promise((r) => setTimeout(r, settleMs));
        }

        // 如果需要等待特定选择器
        if (options.waitForSelector) {
          const selectorTimeout = Math.min(timeout, 8000);
          await Promise.race([
            wc.executeJavaScript(`
              new Promise((resolve) => {
                const el = document.querySelector(${JSON.stringify(options.waitForSelector)});
                if (el) return resolve(true);
                const observer = new MutationObserver(() => {
                  if (document.querySelector(${JSON.stringify(options.waitForSelector)})) {
                    observer.disconnect();
                    resolve(true);
                  }
                });
                observer.observe(document.body, { childList: true, subtree: true });
              })
            `),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('等待选择器超时')), selectorTimeout)
            ),
          ]).catch((err) => {
            logger.warn('BrowserPool: 等待选择器超时，继续提取:', err.message);
          });
        }

        // 执行提取脚本
        const result = await wc.executeJavaScript(jsCode);
        return result;
      } catch (error) {
        logger.warn('BrowserPool: 页面操作失败:', { url, error: error.message });
        throw error;
      } finally {
        // 任务完成后启动空闲回收
        this._scheduleIdleCleanup();
      }
    });
  }

  /**
   * 在隐藏浏览器中导航到 URL 并获取渲染后的页面文本
   *
   * @param {string} url - 目标 URL
   * @param {Object} [options] - 同 executeOnPage 的 options
   * @returns {Promise<string>} 页面的 innerText
   */
  async getPageText(url, options = {}) {
    return this.executeOnPage(url, 'document.body.innerText', options);
  }

  /**
   * 销毁所有资源（app 退出时调用）
   */
  destroy() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    if (this._window && !this._window.isDestroyed()) {
      this._window.destroy();
      this._window = null;
    }
    this._ready = false;
    logger.info('BrowserPool 已销毁');
  }
}

// 单例实例
const browserPool = new BrowserPool();

module.exports = { browserPool, BrowserPool };
