/**
 * SoloForge - 跨平台工具函数
 * 主进程专用，提供平台检测与路径获取
 * @module utils/platform
 */

const { app } = require('electron');
const path = require('path');

/** @constant {string} */
const PLATFORM = process.platform;

/**
 * 是否为 macOS
 * @returns {boolean}
 */
function isMac() {
  return PLATFORM === 'darwin';
}

/**
 * 是否为 Windows
 * @returns {boolean}
 */
function isWindows() {
  return PLATFORM === 'win32';
}

/**
 * 是否为 Linux
 * @returns {boolean}
 */
function isLinux() {
  return PLATFORM === 'linux';
}

/**
 * 获取平台特定的应用数据目录（含应用名）
 * - macOS: ~/Library/Application Support/SoloForge
 * - Windows: %APPDATA%\SoloForge
 * - Linux: ~/.config/SoloForge (或 $XDG_CONFIG_HOME)
 *
 * 注意：需在 app ready 之后调用，或在主进程生命周期内调用
 * @returns {string}
 */
function getAppDataPath() {
  return app.getPath('userData');
}

/**
 * 获取平台特定的下载目录
 * - macOS: ~/Downloads
 * - Windows: %USERPROFILE%\Downloads
 * - Linux: ~/Downloads 或 $XDG_DOWNLOAD_DIR
 *
 * @returns {string}
 */
function getDefaultDownloadsPath() {
  return app.getPath('downloads');
}

/**
 * 跨平台路径拼接（path.join 的便捷封装）
 * @param {...string} segments - 路径片段
 * @returns {string}
 */
function joinPath(...segments) {
  return path.join(...segments);
}

module.exports = {
  isMac,
  isWindows,
  isLinux,
  getAppDataPath,
  getDefaultDownloadsPath,
  joinPath,
  PLATFORM,
};
