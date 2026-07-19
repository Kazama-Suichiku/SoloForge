/**
 * tests/mock-electron.js
 *
 * 在 Node 纯命令行（非 electron 运行时）下测试主进程模块时，
 * require('electron') 返回的是 electron 包可执行文件路径（string）而非 API 对象，
 * 任何 `const { app } = require('electron')` 都会失败。
 *
 * 本文件提供一个可在测试启动前注入的 electron stub，覆盖：
 *   app / BrowserWindow / ipcMain / protocol / shell / dialog / net / screen / Menu / Tray
 *
 * 用法（在 tests/setup.js 中调用）：
 *     require('./mock-electron').install();
 * 必须在任何主进程模块被 require 之前调用（Node 的 require 缓存是单例）。
 */

'use strict';

function makeEventEmitter() {
  const handlers = new Map();
  return {
    on(evt, cb) {
      if (!handlers.has(evt)) handlers.set(evt, new Set());
      handlers.get(evt).add(cb);
      return this;
    },
    once(evt, cb) {
      const wrapped = (...args) => {
        this.off(evt, wrapped);
        cb(...args);
      };
      this.on(evt, wrapped);
      return this;
    },
    off(evt, cb) {
      if (handlers.has(evt)) handlers.get(evt).delete(cb);
      return this;
    },
    removeAllListeners(evt) {
      if (evt) handlers.delete(evt);
      else handlers.clear();
      return this;
    },
    emit(evt, ...args) {
      if (handlers.has(evt)) {
        for (const cb of handlers.get(evt)) {
          try { cb(...args); } catch (_) {}
        }
      }
      return this;
    },
    listenerCount(evt) {
      return handlers.has(evt) ? handlers.get(evt).size : 0;
    },
  };
}

function makeWebContents() {
  const bus = makeEventEmitter();
  return Object.assign(bus, {
    isDestroyed() { return false; },
    isCrashed() { return false; },
    isLoading() { return false; },
    loadURL() {},
    loadFile() {},
    send(channel, ..._args) {
      // 测试可订阅 'send' 事件捕获
      this.emit('__send__', { channel, args: Array.from(arguments).slice(1) });
    },
    sendTo() {},
    postMessage() {},
    executeJavaScript() { return Promise.resolve(); },
    openDevTools() {},
    closeDevTools() {},
    toggleDevTools() {},
    goBack() {},
    goForward() {},
    reload() {},
    setWindowOpenHandler() {},
    setMenu() {},
    copy() {},
    paste() {},
  });
}

function makeBrowserWindow() {
  function BrowserWindow(opts) {
    this.opts = opts || {};
    this.webContents = makeWebContents();
    this.isDestroyed = () => false;
    this.show = () => {};
    this.hide = () => {};
    this.close = () => { this.isDestroyed = () => true; };
    this.minimize = () => {};
    this.maximize = () => {};
    this.unmaximize = () => {};
    this.restore = () => {};
    this.focus = () => {};
    this.blur = () => {};
    this.loadURL = () => {};
    this.loadFile = () => {};
    this.setFullScreen = () => {};
    this.setMenuBarVisibility = () => {};
    this.setBounds = () => {};
    this.getBounds = () => ({ x: 0, y: 0, width: 1280, height: 800 });
    this.setSize = () => {};
    this.getSize = () => [1280, 800];
    this.setPosition = () => {};
    this.getPosition = () => [0, 0];
    this.on = (_evt, _cb) => {};
    this.once = (_evt, _cb) => {};
    this.off = (_evt, _cb) => {};
    this.webContents.send = (channel, ...args) => {
      this.webContents.emit('__send__', { channel, args });
    };
  }
  BrowserWindow.getAllWindows = () => [];
  BrowserWindow.fromWebContents = () => null;
  BrowserWindow.fromId = () => null;
  BrowserWindow.getFocusedWindow = () => null;
  BrowserWindow.addDevToolsExtension = () => {};
  return BrowserWindow;
}

function makeApp() {
  const bus = makeEventEmitter();
  const app = Object.assign(bus, {
    isPackaged: false,
    isReady: false,
    ready: false,
    whenReady() { return Promise.resolve(); },
    on: bus.on,
    once: bus.once,
    off: bus.off,
    emit: bus.emit,
    quit(_opts) { this.emit('quit'); },
    exit(_code) { this.emit('exit'); },
    relaunch() {},
    hide() {},
    show() {},
    focus() {},
    getName() { return 'SoloForge'; },
    getName() { return 'SoloForge'; },
    setName(_n) {},
    getVersion() { return '0.0.0-test'; },
    getPath(name) {
      const os = require('os');
      const path = require('path');
      const map = {
        userData: path.join(os.tmpdir(), 'soloforge-test-userdata'),
        temp: os.tmpdir(),
        home: os.homedir(),
        downloads: path.join(os.tmpdir(), 'soloforge-test-downloads'),
        desktop: path.join(os.tmpdir(), 'soloforge-test-desktop'),
        documents: path.join(os.tmpdir(), 'soloforge-test-documents'),
        appData: path.join(os.tmpdir(), 'soloforge-test-appdata'),
        logs: path.join(os.tmpdir(), 'soloforge-test-logs'),
      };
      return map[name] || path.join(os.tmpdir(), 'soloforge-test', name);
    },
    setPath(_name, _val) {},
    getAppPath() { return process.cwd(); },
    getPath: function (name) {
      const os = require('os');
      const path = require('path');
      const map = {
        userData: path.join(os.tmpdir(), 'soloforge-test-userdata'),
        temp: os.tmpdir(),
        home: os.homedir(),
        downloads: path.join(os.tmpdir(), 'soloforge-test-downloads'),
        desktop: path.join(os.tmpdir(), 'soloforge-test-desktop'),
        documents: path.join(os.tmpdir(), 'soloforge-test-documents'),
        appData: path.join(os.tmpdir(), 'soloforge-test-appdata'),
        logs: path.join(os.tmpdir(), 'soloforge-test-logs'),
      };
      return map[name] || path.join(os.tmpdir(), 'soloforge-test', name);
    },
    requestSingleInstanceLock() { return true; },
    releaseSingleInstance() {},
    allowRendererProcessReuse: true,
    disableHardwareAcceleration() {},
    enableSandbox() {},
    commandLine: { appendSwitch() {}, appendArgument() {} },
  });
  // 去重 getPath（上面定义了两遍，第二遍会胜出）
  return app;
}

function makeIpcMain() {
  const handlers = new Map();
  return {
    on(channel, listener) {
      if (!handlers.has(channel)) handlers.set(channel, []);
      handlers.get(channel).push({ listener, handle: false });
    },
    once(channel, listener) {
      if (!handlers.has(channel)) handlers.set(channel, []);
      handlers.get(channel).push({ listener, handle: false, once: true });
    },
    handle(channel, listener) {
      if (!handlers.has(channel)) handlers.set(channel, []);
      handlers.get(channel).push({ listener, handle: true });
    },
    handleOnce(channel, listener) {
      if (!handlers.has(channel)) handlers.set(channel, []);
      handlers.get(channel).push({ listener, handle: true, once: true });
    },
    off(channel, listener) {
      const arr = handlers.get(channel);
      if (arr) {
        const idx = arr.findIndex((h) => h.listener === listener);
        if (idx >= 0) arr.splice(idx, 1);
      }
    },
    removeHandler(channel) { handlers.delete(channel); },
    removeAllListeners(channel) {
      if (channel) handlers.delete(channel);
      else handlers.clear();
    },
    _invoke(channel, ...args) {
      // 仅供测试触发：模拟 renderer 调用 ipc
      const arr = handlers.get(channel) || [];
      for (const h of arr) {
        if (h.handle) {
          return Promise.resolve(h.listener({}, ...args));
        } else {
          // on/once 风格：listener(event, ...args)
          h.listener({}, ...args);
        }
      }
      return Promise.resolve(undefined);
    },
    _handlers: handlers,
  };
}

function makeIpcRenderer() {
  return Object.assign(makeEventEmitter(), {
    send() {},
    invoke() { return Promise.resolve(); },
    sendSync() { return undefined; },
    sendTo() {},
    postMessage() {},
  });
}

function makeProtocol() {
  return {
    registerSchemesAsPrivileged() {},
    registerFileProtocol() {},
    registerHttpProtocol() {},
    registerBufferProtocol() {},
    registerStreamProtocol() {},
    unregisterProtocol() {},
    absoluteUrl() { return ''; },
  };
}

function makeShell() {
  return {
    openExternal() { return Promise.resolve(); },
    openPath() { return Promise.resolve(''); },
    showItemInFolder() {},
    showInFolder() {},
    moveItemToTrash() { return Promise.resolve(true); },
    trashItem() { return Promise.resolve(); },
    writeShortcutLink() {},
    readShortcutLink() { return {}; },
    beep() {},
    clipboard: {
      readText() { return ''; },
      writeText() {},
      clear() {},
      readHTML() { return ''; },
      writeHTML() {},
      availableFormats() { return []; },
    },
  };
}

function makeDialog() {
  return {
    showMessageBox() { return Promise.resolve({ response: 0, checkboxChecked: false }); },
    showMessageBoxSync() { return 0; },
    showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
    showOpenDialogSync() { return []; },
    showSaveDialog() { return Promise.resolve({ canceled: true, filePath: '' }); },
    showSaveDialogSync() { return ''; },
    showErrorBox() {},
    showCertificateTrustDialog() { return Promise.resolve(); },
  };
}

function makeNet() {
  return {
    request() {
      return {
        on() {},
        write() {},
        end() {},
        abort() {},
      };
    },
    fetch(url, _opts) {
      // 默认不可达：测试如需网络应自行 mock fetch 全局
      return Promise.reject(new Error(`mock-electron net.fetch not supported: ${url}`));
    },
    isOnline() { return true; },
    online: makeEventEmitter(),
  };
}

function makeScreen() {
  return {
    getPrimaryDisplay() {
      return { workArea: { x: 0, y: 0, width: 1440, height: 900 }, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2, id: 1 };
    },
    getAllDisplays() { return [this.getPrimaryDisplay()]; },
    getCursorScreenPoint() { return { x: 0, y: 0 }; },
    on() {},
    off() {},
  };
}

function makeMenu() {
  return {
    buildFromTemplate() { return {}; },
    setApplicationMenu() {},
    getApplicationMenu() { return null; },
    popup() {},
    append() {},
    insert() {},
    remove() {},
  };
}

function makeTray() {
  function Tray() {
    this.setToolTip = () => {};
    this.setImage = () => {};
    this.setContextMenu = () => {};
    this.destroy = () => {};
    this.on = () => {};
    this.popUpContextMenu = () => {};
  }
  return Tray;
}

function makeNativeImage() {
  return {
    createFromPath() { return { isEmpty: () => false, getSize: () => ({ width: 0, height: 0 }) }; },
    createFromBuffer() { return { isEmpty: () => false, getSize: () => ({ width: 0, height: 0 }) }; },
    createEmpty() { return { isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }; },
  };
}

function makePowerMonitor() {
  return Object.assign(makeEventEmitter(), {
    getSystemIdleTime() { return 0; },
    getCurrentThermalState() { return 'nominal'; },
  });
}

function makeElectronStub() {
  return {
    app: makeApp(),
    BrowserWindow: makeBrowserWindow(),
    ipcMain: makeIpcMain(),
    ipcRenderer: makeIpcRenderer(),
    protocol: makeProtocol(),
    shell: makeShell(),
    dialog: makeDialog(),
    net: makeNet(),
    screen: makeScreen(),
    Menu: makeMenu(),
    Tray: makeTray(),
    nativeImage: makeNativeImage(),
    powerMonitor: makePowerMonitor(),
    crashReporter: { start() {}, addExtraParameter() {} },
    contextBridge: {
      exposeInMainWorld() {},
    },
    webFrame: { setVisualZoomLevelLimits() {}, setZoomFactor() {}, getZoomFactor() { return 1; } },
    // 真实 electron 包的 require 返回 string，这里返回 object 以便解构
  };
}

let _installed = false;
let _originalElectronCache = null;

/**
 * 安装 electron stub：在 Module._cache 里塞入一个假的 'electron' 模块，
 * 使后续 require('electron') 返回本文件构造的 stub。
 *
 * 必须在 require 任何主进程模块之前调用。
 */
function install() {
  if (_installed) return makeElectronStub();
  const Module = require('module');
  const stub = makeElectronStub();
  // 解析 'electron' -> node_modules/electron/index.js 的真实路径
  let electronPath;
  try {
    electronPath = Module._resolveFilename('electron', module);
  } catch (e) {
    electronPath = 'electron';
  }
  // 构造一个假模块对象塞入缓存
  const fakeModule = new Module(electronPath, module);
  fakeModule.exports = stub;
  fakeModule.loaded = true;
  fakeModule.paths = Module._nodeModulePaths(require('path').dirname(electronPath));
  // 备份并覆盖缓存
  _originalElectronCache = require.cache[electronPath] || null;
  require.cache[electronPath] = fakeModule;
  // 同时处理 electron-is-dev：它在 require 时会读 electron.app.isPackaged，
  // 我们的 stub.app.isPackaged = false，所以 isDev 返回 true（开发模式），
  // 与 NODE_ENV=development 一致，logger 会输出所有级别日志（对测试无害）。
  _installed = true;
  return stub;
}

/**
 * 卸载 stub，恢复真实 electron 缓存（如果在测试之间需要重置）。
 * 大多数测试一次性安装即可，无需调用 uninstall。
 */
function uninstall() {
  if (!_installed) return;
  const Module = require('module');
  let electronPath;
  try {
    electronPath = Module._resolveFilename('electron', module);
  } catch (e) {
    electronPath = 'electron';
  }
  if (_originalElectronCache) {
    require.cache[electronPath] = _originalElectronCache;
  } else {
    delete require.cache[electronPath];
  }
  _installed = false;
  _originalElectronCache = null;
}

module.exports = {
  install,
  uninstall,
  makeElectronStub,
  makeApp,
  makeBrowserWindow,
  makeWebContents,
  makeIpcMain,
};
