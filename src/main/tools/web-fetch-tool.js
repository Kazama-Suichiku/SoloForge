/**
 * SoloForge - 网页内容抓取工具
 * 获取网页正文内容，支持按行分页
 * 参考自 Houdini Agent 的 fetch_webpage 实现
 * @module tools/web-fetch-tool
 */

const { toolRegistry } = require('./tool-registry');
const { logger } = require('../utils/logger');
const { browserPool } = require('./browser-pool');

/**
 * 网页内容缓存：url -> { timestamp, lines }
 * @type {Map<string, { timestamp: number, lines: string[] }>}
 */
const pageCache = new Map();
const PAGE_CACHE_TTL = 600 * 1000; // 10 分钟
const MAX_CACHE_SIZE = 50;

/**
 * 通用请求头
 */
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/**
 * HTML 实体解码
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * 检测并修正响应编码
 * @param {Response} response
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function fixEncoding(response, buffer) {
  // 1) 优先从 Content-Type header 获取编码
  const contentType = response.headers.get('content-type') || '';
  let charset = contentType.match(/charset=([^\s;]+)/i)?.[1];

  // 2) 如果 header 没有，尝试从 HTML meta 标签获取
  if (!charset) {
    const previewBytes = buffer.slice(0, 8192);
    const preview = new TextDecoder('utf-8', { fatal: false }).decode(previewBytes);
    const metaMatch = preview.match(/<meta[^>]*charset=["']?\s*([a-zA-Z0-9_-]+)/i);
    charset = metaMatch?.[1];
  }

  // 3) 默认 UTF-8
  charset = (charset || 'utf-8').toLowerCase();

  // 映射常见编码名称
  const charsetMap = {
    'gb2312': 'gbk',
    'gb_2312': 'gbk',
    'gb18030': 'gbk',
  };
  charset = charsetMap[charset] || charset;

  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}

/**
 * 从 HTML 中提取正文（正则方式，无需外部依赖）
 * @param {string} html
 * @returns {string}
 */
function extractTextFromHtml(html) {
  // 移除无用区块
  const tagsToRemove = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'svg', 'iframe'];
  for (const tag of tagsToRemove) {
    html = html.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), '');
  }

  // 移除 HTML 注释
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // 块级标签 → 换行
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|blockquote|section|article|dd|dt)>/gi, '\n');

  // 列表项添加标记
  html = html.replace(/<li[^>]*>/gi, '\n• ');

  // 移除剩余 HTML 标签
  html = html.replace(/<[^>]+>/g, ' ');

  // 解码 HTML 实体
  html = decodeEntities(html);

  // 清理多余空白
  const lines = [];
  for (const line of html.split('\n')) {
    const cleaned = line.replace(/[ \t]+/g, ' ').trim();
    if (cleaned) {
      lines.push(cleaned);
    }
  }

  return lines.join('\n');
}

/**
 * 对行列表做分页返回
 * @param {string} url
 * @param {string[]} lines
 * @param {number} startLine - 1-based
 * @param {number} maxLines
 * @returns {Object}
 */
function paginateLines(url, lines, startLine, maxLines) {
  const totalLines = lines.length;
  const offset = Math.max(0, startLine - 1);
  const pageLines = lines.slice(offset, offset + maxLines);
  const endLine = offset + pageLines.length;

  if (pageLines.length === 0) {
    return {
      success: true,
      url,
      content: `[已到末尾] 该网页共 ${totalLines} 行，start_line=${startLine} 超出范围。`,
      totalLines,
      currentRange: null,
    };
  }

  let content = pageLines.join('\n');

  if (endLine < totalLines) {
    const nextStart = endLine + 1;
    content += `\n\n[分页提示] 当前显示第 ${offset + 1}-${endLine} 行，共 ${totalLines} 行。`;
    content += `\n如需后续内容，请调用 fetch_webpage(url="${url}", start_line=${nextStart})。`;
  } else {
    content += `\n\n[全部内容已显示] 第 ${offset + 1}-${endLine} 行，共 ${totalLines} 行。`;
  }

  return {
    success: true,
    url,
    content,
    totalLines,
    currentRange: { start: offset + 1, end: endLine },
  };
}

/**
 * 使用隐藏浏览器窗口抓取网页（处理 JS 渲染的 SPA 页面）
 * @param {string} url
 * @param {number} startLine
 * @param {number} maxLines
 * @returns {Promise<Object>}
 */
async function fetchWithBrowser(url, startLine, maxLines) {
  logger.info('使用浏览器渲染抓取:', url);

  const text = await browserPool.getPageText(url, {
    timeout: 20000,
    settleMs: 2000,
  });

  if (!text || typeof text !== 'string') {
    return { success: false, url, error: '浏览器抓取：页面无文本内容' };
  }

  const lines = text.split('\n').filter((line) => line.trim());

  if (lines.length === 0) {
    return { success: false, url, error: '浏览器抓取：提取内容为空' };
  }

  // 缓存（浏览器抓取的结果也复用翻页缓存）
  pageCache.set(url, { timestamp: Date.now(), lines });

  // 限制缓存大小
  if (pageCache.size > MAX_CACHE_SIZE) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, value] of pageCache) {
      if (value.timestamp < oldestTime) {
        oldestTime = value.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey) pageCache.delete(oldestKey);
  }

  logger.info('浏览器抓取成功:', { url, lines: lines.length });
  return paginateLines(url, lines, startLine, maxLines);
}

/**
 * 获取网页内容（支持缓存和分页，HTTP 失败或内容过少时自动 fallback 到浏览器）
 * @param {string} url
 * @param {number} startLine - 从第几行开始（1-based）
 * @param {number} maxLines - 每页最大行数
 * @param {number} timeout - 超时毫秒数
 * @returns {Promise<Object>}
 */
async function fetchWebpage(url, startLine = 1, maxLines = 80, timeout = 15000) {
  // --- 缓存查找（翻页时复用已抓取的内容） ---
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.timestamp < PAGE_CACHE_TTL) {
    logger.debug('网页缓存命中:', url);
    return paginateLines(url, cached.lines, startLine, maxLines);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // 获取原始字节以正确处理编码
    const buffer = await response.arrayBuffer();
    const html = fixEncoding(response, buffer);

    // 提取正文
    const text = extractTextFromHtml(html);
    const lines = text.split('\n').filter((line) => line.trim());

    // 内容为空或过少 → 可能是 JS 渲染的 SPA，尝试浏览器 fallback
    if (lines.length < 5 || text.length < 200) {
      logger.info('HTTP 抓取内容过少，尝试浏览器渲染:', { url, lines: lines.length, textLen: text.length });
      try {
        return await fetchWithBrowser(url, startLine, maxLines);
      } catch (browserErr) {
        logger.warn('浏览器 fallback 也失败:', browserErr.message);
        // 如果浏览器也失败，但 HTTP 至少拿到了一些内容，还是返回
        if (lines.length > 0) {
          pageCache.set(url, { timestamp: Date.now(), lines });
          return paginateLines(url, lines, startLine, maxLines);
        }
        return { success: false, url, error: '无法提取网页正文内容（HTTP 和浏览器均失败）' };
      }
    }

    // 缓存此页面（翻页时复用）
    pageCache.set(url, { timestamp: Date.now(), lines });

    // 限制缓存大小
    if (pageCache.size > MAX_CACHE_SIZE) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, value] of pageCache) {
        if (value.timestamp < oldestTime) {
          oldestTime = value.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) pageCache.delete(oldestKey);
    }

    return paginateLines(url, lines, startLine, maxLines);
  } catch (error) {
    clearTimeout(timeoutId);

    // HTTP 完全失败时，也尝试浏览器 fallback
    logger.info('HTTP 抓取失败，尝试浏览器渲染:', { url, error: error.message });
    try {
      return await fetchWithBrowser(url, startLine, maxLines);
    } catch (browserErr) {
      logger.warn('浏览器 fallback 也失败:', browserErr.message);
      return {
        success: false,
        url,
        error: `HTTP: ${error.name === 'AbortError' ? '请求超时' : error.message}; 浏览器: ${browserErr.message}`,
      };
    }
  }
}

// ============================================================
// 工具注册
// ============================================================

/**
 * 网页内容抓取工具
 */
const webFetchTool = {
  name: 'fetch_webpage',
  description:
    '获取指定 URL 的网页正文内容（按行分页）。首次调用返回第 1 行起的内容；如结果末尾有 [分页提示]，可传入 start_line 获取后续行。适合深入阅读搜索结果中的具体网页。',
  category: 'network',
  parameters: {
    url: {
      type: 'string',
      description: '要获取的网页 URL',
      required: true,
    },
    start_line: {
      type: 'number',
      description: '从第几行开始读取（1-based），用于翻页',
      required: false,
      default: 1,
    },
    max_lines: {
      type: 'number',
      description: '每页最大行数（默认 80）',
      required: false,
      default: 80,
    },
  },
  requiredPermissions: ['network.searchEnabled'],

  async execute(args) {
    const { url, start_line = 1, max_lines = 80 } = args;

    if (!url || typeof url !== 'string') {
      throw new Error('请提供有效的 URL');
    }

    // 验证 URL 格式
    try {
      new URL(url);
    } catch {
      throw new Error('无效的 URL 格式');
    }

    logger.info('获取网页内容:', { url, start_line, max_lines });

    const result = await fetchWebpage(url, start_line, max_lines);

    if (!result.success) {
      logger.warn('网页获取失败:', url, result.error);
    } else {
      logger.info('网页获取成功:', {
        url,
        totalLines: result.totalLines,
        range: result.currentRange,
      });
    }

    return result;
  },
};

/**
 * 注册网页抓取工具
 */
function registerWebFetchTool() {
  toolRegistry.register(webFetchTool);
}

module.exports = {
  webFetchTool,
  registerWebFetchTool,
  fetchWebpage,
};
