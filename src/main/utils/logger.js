/**
 * SoloForge - 日志工具
 * 支持 info, warn, error 级别
 * 开发模式打印到 console，可扩展为写入文件
 * @module utils/logger
 */

const isDev = process.env.NODE_ENV !== 'production' || require('electron-is-dev');

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** @type {number} 当前日志级别（默认 info，不显示 debug） */
let currentLevel = LEVELS.info;

/**
 * 格式化日志前缀
 * @param {string} level
 * @returns {string}
 */
function formatPrefix(level) {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}]`;
}

/**
 * 输出到 console
 * 开发模式：输出所有日志
 * 生产模式：只输出 warn 和 error
 * @param {string} level
 * @param {any[]} args
 */
function logToConsole(level, ...args) {
  // 生产模式下只输出 warn / error 级别
  if (!isDev && level !== 'warn' && level !== 'error') return;

  const prefix = formatPrefix(level);
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

/**
 * 写入文件（预留扩展）
 * @param {string} level
 * @param {any[]} args
 */
function logToFile(_level, ..._args) {
  // TODO: 可扩展为 fs.appendFile 写入日志文件
}

/**
 * 统一日志入口
 * @param {string} level
 * @param {any[]} args
 */
function log(level, ...args) {
  if (LEVELS[level] < currentLevel) return;
  logToConsole(level, ...args);
  logToFile(level, ...args);
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
};

module.exports = { logger };
