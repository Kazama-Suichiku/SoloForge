/**
 * SoloForge - 主进程全局状态容器（P1-2 拆分产物 / P3-E DI 升级）
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
 * P3-E 升级：在保留原有 getter/setter 接口（向后兼容）的基础上，叠加轻量 DI 容器能力：
 *   - register(name, instance|factory, options?)：注册依赖，options.lazy=true 时第二参为 factory
 *   - get(name)：获取依赖；lazy 依赖首次 get 时调 factory(appContext) 实例化并缓存
 *   - override(name, instance)：测试用临时覆盖（原值存入 _overrides 栈，可多次 restore）
 *   - restore(name)：恢复上一次 override 前的值
 *   - listDependencies()：列出所有已注册依赖名（调试用）
 *   - DEPENDENCIES：依赖元信息常量（name → { factory?, lazy?, description }），显式化依赖关系
 *
 * 设计原则：
 * - 只放“跨模块共享的可变单例”和“跨公司切换需要保留的用户偏好”
 * - 不放持久化数据（store 自己管）
 * - 不做初始化逻辑（初始化在 company-switch / scheduler-bootstrap 里）
 * - getter 返回当前值（可能为 null），调用方需自行判空
 * - DI 能力是叠加的：旧代码用 getXxx/setXxx 完全照旧工作，新代码用 register/get
 */

const { logger } = require('./utils/logger');

/**
 * 依赖元信息映射。每项描述一个可注册到 AppContext 的依赖：
 *   - factory?: (ctx: AppContext) => any  —— 懒加载工厂（lazy=true 时必填）
 *   - lazy?: boolean                       —— 是否懒加载（懒加载时 register 第二参是 factory）
 *   - description?: string                —— 给人类看的依赖说明
 *
 * 这里只列出“可被 DI 容器管理”的依赖；并不强制所有依赖都出现在这里。
 * 现有的 getter/setter（mainWindow/llmManager/pmEngine/taskPatrol）仍保留，
 * 它们对应的依赖名分别记为 'mainWindow' / 'llmManager' / 'pmEngine' / 'taskPatrol'。
 * patrolUserDisabled 是“偏好”而非“依赖”，沿用专门方法管理，不进入 DEPENDENCIES。
 *
 * 注：此映射本身不触发任何实例化。它只是“依赖关系文档 + factory 仓库”，
 * 实际注册时机由各 bootstrap 模块决定（main.js 注册 llmManager、scheduler-bootstrap
 * 注册 pmEngine/taskPatrol、window-manager 注册 mainWindow）。
 */
const DEPENDENCIES = {
  mainWindow: {
    description: 'Electron BrowserWindow 主窗口实例（由 window-manager 注册）',
  },
  llmManager: {
    description: 'LLMManager 实例（由 main.js 在 app.whenReady 时注册）',
  },
  pmEngine: {
    description: 'PM 引擎实例（由 scheduler-bootstrap 注册/重启）',
  },
  taskPatrol: {
    description: 'TaskPatrol 任务巡查实例（由 scheduler-bootstrap 注册/重启）',
  },
};

/**
 * AppContext：跨模块共享可变单例容器 + 轻量 DI。
 *
 * 内部存储分三层：
 *   - _deps：Map<string, { instance, factory, lazy, instantiated }>
 *       正常注册的依赖。lazy=true 且未 instantiated 时，get() 会调 factory(appContext)。
 *   - _overrides：Map<string, Array<{ instance, factory, lazy, instantiated }>>
 *       override() 时把当前 _deps[name] 压栈，restore() 弹栈恢复。支持多次叠加。
 *   - _patrolUserDisabled：boolean 偏好（非依赖，独立字段）。
 */
class AppContext {
  constructor() {
    this._deps = new Map();
    this._overrides = new Map();
    /** 用户是否手动关闭了任务巡查（跨公司切换保留偏好） */
    this._patrolUserDisabled = true; // 默认关闭自动巡查，用户需在界面手动开启

    // 预注册 DEPENDENCIES 中声明的依赖（占位，等待 register 写入实例/factory）。
    // 这样 listDependencies() 一开始就能反映全部已知依赖名，
    // 调用方也能在 instance 尚未就位时拿到 null 而非 undefined，行为与旧 getter 一致。
    for (const name of Object.keys(DEPENDENCIES)) {
      this._deps.set(name, {
        instance: null,
        factory: null,
        lazy: false,
        instantiated: false,
      });
    }
  }

  // ─── DI 核心 API ──────────────────────────────────────────────

  /**
   * 注册一个依赖。
   * @param {string} name 依赖名
   * @param {any} instanceOrFactory 实例；若 options.lazy=true 则为 factory(appContext)=>instance
   * @param {{ lazy?: boolean }} [options] 仅 lazy 字段被识别
   * @returns {AppContext} this（链式调用）
   */
  register(name, instanceOrFactory, options = {}) {
    const lazy = !!options.lazy;
    const entry = {
      instance: lazy ? null : instanceOrFactory,
      factory: lazy ? instanceOrFactory : null,
      lazy,
      instantiated: !lazy && instanceOrFactory != null,
    };
    this._deps.set(name, entry);
    logger.debug(`AppContext: register("${name}"${lazy ? ' [lazy]' : ''})`);
    return this;
  }

  /**
   * 获取依赖。lazy 依赖首次 get 时调 factory 实例化并缓存。
   * @param {string} name
   * @returns {any} 实例（未注册返回 undefined；已注册但未就位返回 null）
   */
  get(name) {
    const entry = this._deps.get(name);
    if (!entry) return undefined;
    if (entry.lazy && !entry.instantiated) {
      const factory = entry.factory;
      if (typeof factory === 'function') {
        try {
          entry.instance = factory(this);
        } catch (err) {
          logger.error(`AppContext: lazy 实例化 "${name}" 失败:`, err);
          throw err;
        }
        entry.instantiated = true;
        logger.debug(`AppContext: lazy 实例化 "${name}"`);
      }
    }
    return entry.instance;
  }

  /**
   * 测试用：临时覆盖某个依赖。原值压入 override 栈，可多次叠加，配合 restore() 弹回。
   * @param {string} name
   * @param {any} instance
   * @returns {AppContext} this
   */
  override(name, instance) {
    const current = this._deps.get(name);
    if (!current) {
      // 尚未注册的依赖，也允许 override：先建空 entry 再压栈
      this.register(name, instance);
      return this;
    }
    const stack = this._overrides.get(name) || [];
    stack.push(current);
    this._overrides.set(name, stack);
    this._deps.set(name, {
      instance,
      factory: null,
      lazy: false,
      instantiated: instance != null,
    });
    logger.debug(`AppContext: override("${name}")`);
    return this;
  }

  /**
   * 恢复 override 之前的值（弹出最近一次 override）。栈空则保持现状。
   * @param {string} name
   * @returns {boolean} 是否成功弹回（栈空或无依赖返回 false）
   */
  restore(name) {
    const stack = this._overrides.get(name);
    if (!stack || stack.length === 0) return false;
    const prev = stack.pop();
    this._deps.set(name, prev);
    if (stack.length === 0) this._overrides.delete(name);
    logger.debug(`AppContext: restore("${name}")`);
    return true;
  }

  /**
   * 列出所有已注册依赖名（含 DEPENDENCIES 中预声明的占位）。
   * @returns {string[]}
   */
  listDependencies() {
    return Array.from(this._deps.keys());
  }

  // ─── 向后兼容的专用 getter/setter ───────────────────────────
  // 内部全部走 register/get，保持单一存储通道（DI 与兼容接口不再有两份状态）。

  // ─── mainWindow ──────────────────────────────────────────────
  getMainWindow() {
    return this.get('mainWindow');
  }

  setMainWindow(win) {
    this.register('mainWindow', win);
    logger.debug('AppContext: mainWindow 已设置', { isNull: win === null });
  }

  /**
   * 获取 webContents（可能为 null）。便捷方法，避免到处判空 mainWindow。
   * @returns {import('electron').WebContents | null}
   */
  getWebContents() {
    const win = this.get('mainWindow');
    if (!win || win.isDestroyed()) return null;
    return win.webContents;
  }

  // ─── llmManager ─────────────────────────────────────────────
  getLLMManager() {
    return this.get('llmManager');
  }

  setLLMManager(mgr) {
    this.register('llmManager', mgr);
  }

  // ─── pmEngine ───────────────────────────────────────────────
  getPMEngine() {
    return this.get('pmEngine');
  }

  setPMEngine(engine) {
    this.register('pmEngine', engine);
  }

  // ─── taskPatrol ─────────────────────────────────────────────
  getTaskPatrol() {
    return this.get('taskPatrol');
  }

  setTaskPatrol(patrol) {
    this.register('taskPatrol', patrol);
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

module.exports = { AppContext, appContext, DEPENDENCIES };
