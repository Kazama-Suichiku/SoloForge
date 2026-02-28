/**
 * 网络搜索工具 - 移动端版
 * 多引擎自动降级（Brave HTML → DuckDuckGo HTML）
 */

const { toolRegistry } = require('./tool-registry');
const { logger } = require('../../utils/logger');

const searchCache = new Map();
const CACHE_TTL = 300 * 1000; // 5 分钟

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];
let _uaIndex = 0;
function getUA() {
  return USER_AGENTS[_uaIndex++ % USER_AGENTS.length];
}

function getHeaders() {
  return {
    'User-Agent': getUA(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

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

function stripHtml(html) {
  if (!html) return '';
  return decodeEntities(html.replace(/<[^>]+>/g, '').trim());
}

/**
 * Brave Search HTML 抓取
 */
async function searchBraveHtml(query, maxResults, timeout) {
  const params = new URLSearchParams({ q: query, source: 'web' });
  const url = `https://search.brave.com/search?${params}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 2000));
      const retryResp = await fetch(url, { headers: getHeaders() });
      if (retryResp.ok) {
        const retryHtml = await retryResp.text();
        const retryResults = parseBraveHtml(retryHtml, maxResults);
        if (retryResults.length > 0) {
          return { success: true, query, results: retryResults, source: 'Brave' };
        }
      }
      return { success: false, error: 'Brave: 频率限制 (429)', results: [] };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const results = parseBraveHtml(html, maxResults);

    if (results.length > 0) {
      return { success: true, query, results, source: 'Brave' };
    }
    return { success: false, error: 'Brave 返回页面但未解析到结果', results: [] };
  } catch (error) {
    clearTimeout(timeoutId);
    return { success: false, error: error.message, results: [] };
  }
}

function parseBraveHtml(html, maxResults) {
  const results = [];
  const blockStarts = [...html.matchAll(/<div[^>]*class="snippet\b[^"]*"[^>]*data-type="web"[^>]*>/gi)];

  for (let i = 0; i < blockStarts.length && results.length < maxResults; i++) {
    const start = blockStarts[i].index;
    const end = blockStarts[i + 1]?.index || html.length;
    const block = html.slice(start, end);

    const urlMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/i);
    const url = urlMatch?.[1] || '';
    if (!url || url.includes('brave.com')) continue;

    let title = '';
    const titlePatterns = [
      /class="title\b[^"]*search-snippet-title[^"]*"[^>]*>(.*?)<\/div>/is,
      /class="[^"]*search-snippet-title[^"]*"[^>]*>(.*?)<\/(?:span|div)>/is,
    ];
    for (const pattern of titlePatterns) {
      const match = block.match(pattern);
      if (match) {
        title = stripHtml(match[1]);
        title = title.replace(/\s*\d{4}年\d{1,2}月\d{1,2}日\s*[-—]?\s*$/, '').trim();
        break;
      }
    }
    if (!title) continue;

    let snippet = '';
    const descPatterns = [
      /class="snippet-description[^"]*"[^>]*>(.*?)<\/(?:div|p|span)>/is,
      /class="[^"]*snippet-content[^"]*"[^>]*>(.*?)<\/(?:div|p|span)>/is,
    ];
    for (const pattern of descPatterns) {
      const match = block.match(pattern);
      if (match) {
        snippet = stripHtml(match[1]);
        break;
      }
    }

    results.push({ title, snippet, url, type: 'web' });
  }

  return results;
}

/**
 * DuckDuckGo Lite 搜索
 */
async function searchDuckDuckGoHtml(query, maxResults, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok && response.status !== 202) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    if (html.includes('anomaly') || html.includes('bots use DuckDuckGo')) {
      return { success: false, error: 'DuckDuckGo 触发反爬验证', results: [] };
    }

    const results = parseDuckDuckGoLite(html, maxResults);

    if (results.length > 0) {
      return { success: true, query, results, source: 'DuckDuckGo' };
    }
    return { success: false, error: 'DuckDuckGo 返回页面但未解析到结果', results: [] };
  } catch (error) {
    clearTimeout(timeoutId);
    return { success: false, error: error.message, results: [] };
  }
}

function parseDuckDuckGoLite(html, maxResults) {
  const results = [];
  const linkMatches = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi)];
  const snippetMatches = [...html.matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)];

  for (let i = 0; i < linkMatches.length && results.length < maxResults; i++) {
    let url = linkMatches[i][1];
    const title = stripHtml(linkMatches[i][2]);
    if (!url || !title) continue;

    if (url.includes('uddg=')) {
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
    }
    if (url.startsWith('//')) url = 'https:' + url;
    if (url.includes('duckduckgo.com')) continue;

    const snippet = snippetMatches[i] ? stripHtml(snippetMatches[i][1]) : '';
    results.push({ title, snippet, url, type: 'web' });
  }

  return results;
}

/**
 * 主搜索函数
 */
async function search(query, maxResults = 5, timeout = 10000) {
  const cacheKey = `${query}|${maxResults}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug('搜索缓存命中:', query);
    return { ...cached.result, fromCache: true };
  }

  const errors = [];

  // 1. Brave Search HTML
  const braveResult = await searchBraveHtml(query, maxResults, timeout);
  if (braveResult.success && braveResult.results.length > 0) {
    searchCache.set(cacheKey, { timestamp: Date.now(), result: braveResult });
    return braveResult;
  }
  errors.push(`Brave: ${braveResult.error || 'no results'}`);

  // 2. DuckDuckGo HTML
  const ddgResult = await searchDuckDuckGoHtml(query, maxResults, timeout);
  if (ddgResult.success && ddgResult.results.length > 0) {
    searchCache.set(cacheKey, { timestamp: Date.now(), result: ddgResult });
    return ddgResult;
  }
  errors.push(`DDG: ${ddgResult.error || 'no results'}`);

  return {
    success: false,
    query,
    results: [],
    error: `所有搜索引擎失败: ${errors.join('; ')}`,
  };
}

const webSearchTool = {
  name: 'web_search',
  description: '搜索互联网获取信息。可搜索天气、新闻、技术文档、百科知识等任何内容。',
  category: 'network',
  parameters: {
    query: {
      type: 'string',
      description: '搜索查询词',
      required: true,
    },
    max_results: {
      type: 'number',
      description: '最大返回结果数（默认 5）',
      required: false,
    },
  },
  async execute(args) {
    const { query, max_results = 5 } = args;

    if (!query || typeof query !== 'string') {
      throw new Error('请提供有效的搜索查询');
    }

    logger.info('执行网络搜索:', query);
    const result = await search(query, max_results);

    return {
      query: result.query,
      provider: result.source || 'Unknown',
      results: result.results,
      resultCount: result.results.length,
      ...(result.error && { error: result.error }),
    };
  },
};

function registerWebSearchTool() {
  toolRegistry.register(webSearchTool);
}

module.exports = { webSearchTool, registerWebSearchTool, search };
