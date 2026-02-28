/**
 * 时间格式化工具 - 移动端
 */

function formatLocalTime(time, options = {}) {
  const { includeDate = true, includeSeconds = false } = options;
  if (!time) return '';
  const date = time instanceof Date ? time : new Date(time);
  if (isNaN(date.getTime())) return String(time);

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
  if (includeSeconds) formatOptions.second = '2-digit';

  return date.toLocaleString('zh-CN', formatOptions);
}

module.exports = { formatLocalTime };
