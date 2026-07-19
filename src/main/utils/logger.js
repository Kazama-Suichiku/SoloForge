/**
 * SoloForge - 日志工具
 * 支持 debug / info / warn / error 级别
 *
 * Phase 2 可观测性升级：
 * - 自动附加当前异步链路上的 traceId（来自 utils/trace 的 AsyncLocalStorage）
 * - logToFile 实现：写入 ~/.soloforge/logs/soloforge-{date}.log，按日轮转
 *   - dev 模式同时输出 console 和文件
 *   - prod 模式只输出文件（warn/error 也写文件），不打印 console 噪声
 *   - 文件写入采用批处理 + flush 调度，避免高频日志阻塞主进程
 * - 向后兼容：接口 info/warn/error/debug/setLevel 不变；无 traceId 时照常输出
 *
 * @module utils/logger
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTraceId } = require('./trace');

const isDev =
  process.env.NODE_ENV !== 'production' ||
  (() => {
    try {
      return require('electron-is-dev');
    } catch (_e) {
      return false;
    }
  })();

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** @type {number} 当前日志级别（默认 info，不显示 debug） */
let currentLevel = LEVELS.info;

// ---------------------------------------------------------------------------
// 日志目录与文件名
// ---------------------------------------------------------------------------

function getLogDir() {
  return path.join(os.homedir(), '.soloforge', 'logs');
}

function getTodayLogFile() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(getLogDir(), `soloforge-${date}.log`);
}

// ---------------------------------------------------------------------------
// 文件写入：批处理 + 定时 flush
// ---------------------------------------------------------------------------
// 设计目标：日志不阻塞主进程、不频繁 fsync、按天轮转。
// - writeQueue 缓存待写行；到达 batchFlushThreshold 或定时器触发时一次性 append。
// - 使用 fs.appendFile（异步），不等待。
// - 写入失败时降级为只 console.error，绝不让日志本身把进程打挂。

const BATCH_FLUSH_THRESHOLD = 50; // 行数阈值
const BATCH_FLUSH_INTERVAL_MS = 1000; // 定时 flush 间隔

const writeQueue = [];
let flushTimer = null;
let lastLogFile = null; // 上次写入的文件路径，用于检测跨天轮转
let logDirEnsured = false;

function ensureLogDir() {
  if (logDirEnsured) return;
  try {
    fs.mkdirSync(getLogDir(), { recursive: true });
    logDirEnsured = true;
  } catch (err) {
    // 目录创建失败：降级，后续写文件会直接报错并被吞掉
    console.error('[logger] 无法创建日志目录:', err.message);
    logDirEnsured = true; // 避免反复尝试
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, BATCH_FLUSH_INTERVAL_MS);
  if (flushTimer && typeof flushTimer.unref === 'function') {
    flushTimer.unref(); // 不阻塞 Electron 退出
  }
}

function flush() {
  flushTimer = null;
  if (writeQueue.length === 0) return;

  // 按 targetFile 分组写入（跨天时会分到两个文件）
  const buckets = new Map();
  let entry;
  while ((entry = writeQueue.shift())) {
    const arr = buckets.get(entry.file) || [];
    arr.push(entry.line);
    buckets.set(entry.file, arr);
  }

  for (const [file, lines] of buckets) {
    // 每行已在入队时补过 \n；统一确保以 \n 结尾
    const payload = lines.map((l) => (l.endsWith('\n') ? l : l + '\n')).join('');
    fs.appendFile(file, payload, (err) => {
      if (err) {
        // 写入失败：只 console.error 一次，避免无限递归
        console.error('[logger] 写入日志文件失败:', err.message);
      }
    });
  }
}

function enqueueLine(file, line) {
  writeQueue.push({ file, line });
  if (writeQueue.length >= BATCH_FLUSH_THRESHOLD) {
    // 达到阈值，立即 flush（取消定时器）
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
  } else {
    scheduleFlush();
  }
}

/**
 * 进程退出前强制 flush（如果还有残余日志）
 */
function flushSync() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (writeQueue.length === 0) return;
  // 同步写一次，避免退出时丢日志
  const buckets = new Map();
  let entry;
  while ((entry = writeQueue.shift())) {
    const arr = buckets.get(entry.file) || [];
    arr.push(entry.line);
    buckets.set(entry.file, arr);
  }
  for (const [file, lines] of buckets) {
    try {
      const payload = lines.map((l) => (l.endsWith('\n') ? l : l + '\n')).join('');
      fs.appendFileSync(file, payload);
    } catch (_err) {
      // 忽略
    }
  }
}

// 进程退出钩子
process.once('exit', flushSync);
process.once('SIGINT', () => {
  flushSync();
  process.exit(0);
});
process.once('SIGTERM', () => {
  flushSync();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------

/**
 * 格式化日志前缀（console 用）
 * @param {string} level
 * @param {string} [traceId]
 * @returns {string}
 */
function formatPrefix(level, traceId) {
  const ts = new Date().toISOString();
  const tid = traceId ? ` [${traceId}]` : '';
  return `[${ts}] [${level.toUpperCase()}]${tid}`;
}

/**
 * 构造一行 JSON 日志（文件用，每行一个 JSON）
 * @param {string} level
 * @param {string} traceId
 * @param {any[]} args
 * @returns {string} 以 \n 结尾的 JSON 字符串
 */
function formatJsonLine(level, traceId, args) {
  const record = {
    ts: new Date().toISOString(),
    level,
    traceId: traceId || null,
    msg: args.map((a) => {
      if (a instanceof Error) {
        return { name: a.name, message: a.message, stack: a.stack };
      }
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.parse(JSON.stringify(a));
        } catch (_e) {
          return String(a);
        }
      }
      return a;
    }),
  };
  try {
    return JSON.stringify(record) + '\n';
  } catch (_e) {
    return JSON.stringify({ ts: record.ts, level, traceId: traceId || null, msg: '[unserializable]' }) + '\n';
  }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function logToConsole(level, traceId, ...args) {
  // 生产模式下不输出 console，避免噪声（仍写文件）
  if (!isDev && level !== 'warn' && level !== 'error') return;

  const prefix = formatPrefix(level, traceId);
  const fn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'debug'
          ? console.debug
          : console.log;
  fn(prefix, ...args);
}

function logToFile(level, traceId, ...args) {
  try {
    ensureLogDir();
    const file = getTodayLogFile();
    if (lastLogFile !== file) {
      lastLogFile = file; // 跨天时自动切到新文件
    }
    const line = formatJsonLine(level, traceId, args);
    enqueueLine(file, line);
  } catch (err) {
    // 文件日志失败不能影响主流程
    console.error('[logger] logToFile 异常:', err.message);
  }
}

/**
 * 统一日志入口
 * @param {string} level
 * @param {any[]} args
 */
function log(level, ...args) {
  if (LEVELS[level] < currentLevel) return;
  const traceId = getTraceId();
  logToConsole(level, traceId, ...args);
  logToFile(level, traceId, ...args);
}

const logger = {
  debug(...args) {
    log('debug', ...args);
  },
  info(...args) {
    log('info', ...args);
  },
  warn(...args) {
    log('warn', ...args);
  },
  error(...args) {
    log('error', ...args);
  },
  /**
   * 设置日志级别
   * @param {'debug'|'info'|'warn'|'error'} level
   */
  setLevel(level) {
    if (LEVELS[level] !== undefined) {
      currentLevel = LEVELS[level];
    }
  },
  /**
   * 强制 flush 日志文件缓冲（主要用于测试 / 显式落盘）
   * @returns {void}
   */
  flush: flushSync,
};

// 向后兼容：同时支持 `const logger = require('./logger')`（原用法）
// 和 `const { logger } = require('./logger')`（新用法）。
// 直接把 logger 对象作为 module.exports，并附加命名导出。
module.exports = logger;
module.exports.logger = logger;
module.exports.default = logger;
