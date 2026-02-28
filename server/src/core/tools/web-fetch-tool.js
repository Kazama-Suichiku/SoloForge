/**
 * 网页内容抓取工具 - 移动端版
 */

const { toolRegistry } = require('./tool-registry');
const { logger } = require('../../utils/logger');

const pageCache = new Map();
const PAGE_CACHE_TTL = 600 * 1000; // 10 分钟
const MAX_CACHE_SIZE = 50;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

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

function extractTextFromHtml(html) {
  const tagsToRemove = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'svg', 'iframe'];
  for (const tag of tagsToRemove) {
    html = html.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), '');
  }

  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|blockquote|section|article|dd|dt)>/gi, '\n');
  html = html.replace(/<li[^>]*>/gi, '\n• ');
  html = html.replace(/<[^>]+>/g, ' ');
  html = decodeEntities(html);

  const lines = [];
  for (const line of html.split('\n')) {
    const cleaned = line.replace(/[ \t]+/g, ' ').trim();
    if (cleaned) {
      lines.push(cleaned);
    }
  }

  return lines.join('\n');
}

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

async function fetchWebpage(url, startLine = 1, maxLines = 80, timeout = 15000) {
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

    const html = await response.text();
    const text = extractTextFromHtml(html);
    const lines = text.split('\n').filter((line) => line.trim());

    if (lines.length === 0) {
      return { success: false, url, error: '无法提取网页正文内容' };
    }

    pageCache.set(url, { timestamp: Date.now(), lines });

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
    return {
      success: false,
      url,
      error: error.name === 'AbortError' ? '请求超时' : error.message,
    };
  }
}

const webFetchTool = {
  name: 'fetch_webpage',
  description: '获取指定 URL 的网页正文内容（按行分页）。适合深入阅读搜索结果中的具体网页。',
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
    },
    max_lines: {
      type: 'number',
      description: '每页最大行数（默认 80）',
      required: false,
    },
  },
  async execute(args) {
    const { url, start_line = 1, max_lines = 80 } = args;

    if (!url || typeof url !== 'string') {
      throw new Error('请提供有效的 URL');
    }

    try {
      new URL(url);
    } catch {
      throw new Error('无效的 URL 格式');
    }

    logger.info('获取网页内容:', { url, start_line, max_lines });
    return await fetchWebpage(url, start_line, max_lines);
  },
};

function registerWebFetchTool() {
  toolRegistry.register(webFetchTool);
}

module.exports = { webFetchTool, registerWebFetchTool, fetchWebpage };
