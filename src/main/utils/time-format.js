/**
 * SoloForge - 时间格式化工具
 * 统一处理时间显示，使用本地时区
 * @module utils/time-format
 */

/**
 * 将时间戳或 ISO 字符串转换为本地可读格式
 * @param {number|string|Date} time - 时间戳、ISO 字符串或 Date 对象
 * @param {Object} [options] - 格式化选项
 * @param {boolean} [options.includeDate=true] - 是否包含日期
 * @param {boolean} [options.includeSeconds=false] - 是否包含秒
 * @returns {string} 格式化后的本地时间字符串
 */
function formatLocalTime(time, options = {}) {
  const { includeDate = true, includeSeconds = false } = options;

  if (!time) return '';

  const date = time instanceof Date ? time : new Date(time);

  // 检查是否是有效日期
  if (isNaN(date.getTime())) {
    return String(time);
  }

  const formatOptions = {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };

  if (includeDate) {
    formatOptions.year = 'numeric';
    formatOptions.month = '2-digit';
    formatOptions.day = '2-digit';
  }

  if (includeSeconds) {
    formatOptions.second = '2-digit';
  }

  return date.toLocaleString('zh-CN', formatOptions);
}

/**
 * 将时间转换为相对描述（如"3分钟前"）
 * @param {number|string|Date} time - 时间戳、ISO 字符串或 Date 对象
 * @returns {string} 相对时间描述
 */
function formatRelativeTime(time) {
  if (!time) return '';

  const date = time instanceof Date ? time : new Date(time);
  if (isNaN(date.getTime())) {
    return String(time);
  }

  const now = Date.now();
  const diff = now - date.getTime();

  // 毫秒转换
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return '刚刚';
  } else if (minutes < 60) {
    return `${minutes}分钟前`;
  } else if (hours < 24) {
    return `${hours}小时前`;
  } else if (days < 7) {
    return `${days}天前`;
  } else {
    // 超过 7 天显示具体日期
    return formatLocalTime(date, { includeSeconds: false });
  }
}

/**
 * 将 ISO 字符串或时间戳格式化为日期（不含时间）
 * @param {number|string|Date} time
 * @returns {string} 格式化的日期
 */
function formatLocalDate(time) {
  if (!time) return '';

  const date = time instanceof Date ? time : new Date(time);
  if (isNaN(date.getTime())) {
    return String(time);
  }

  return date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

module.exports = {
  formatLocalTime,
  formatRelativeTime,
  formatLocalDate,
};
