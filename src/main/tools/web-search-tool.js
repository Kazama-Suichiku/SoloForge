/**
 * SoloForge - 网络搜索工具
 * 多引擎自动降级（Brave HTML → DuckDuckGo HTML）+ 缓存
 * 参考自 Houdini Agent 的 WebSearcher 实现
 * @module tools/web-search-tool
 */

const { toolRegistry } = require('./tool-registry');
const { logger } = require('../utils/logger');
const { browserPool } = require('./browser-pool');

/**
 * 搜索结果缓存
 * @type {Map<string, { timestamp: number, result: Object }>}
 */
const searchCache = new Map();
const CACHE_TTL = 300 * 1000; // 5 分钟

/**
 * User-Agent 池（轮换防 429）
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
];
let _uaIndex = 0;
function getUA() {
  return USER_AGENTS[_uaIndex++ % USER_AGENTS.length];
}

/**
 * 通用请求头（每次调用轮换 UA）
 */
function getHeaders() {
  return {
    'User-Agent': getUA(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

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
 * 清理 HTML 标签
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  if (!html) return '';
  return decodeEntities(html.replace(/<[^>]+>/g, '').trim());
}

/**
 * 搜索提供商配置
 */
const SEARCH_PROVIDERS = {
  // Brave Search（HTML 抓取，无需 API Key，结果质量好）
  brave: {
    name: 'Brave Search',
    url: 'https://search.brave.com/search',
  },
  // DuckDuckGo Lite 搜索（备用，无 CAPTCHA）
  duckduckgo: {
    name: 'DuckDuckGo',
    url: 'https://lite.duckduckgo.com/lite/',
  },
  // Brave Search API（需要 API Key，最优质）
  braveApi: {
    name: 'Brave Search API',
    url: 'https://api.search.brave.com/res/v1/web/search',
    keyEnvVar: 'BRAVE_SEARCH_API_KEY',
  },
};

// ============================================================
// Brave Search HTML 抓取（无需 API Key）
// ============================================================

/**
 * 使用 Brave Search HTML 抓取
 * @param {string} query
 * @param {number} maxResults
 * @param {number} timeout
 * @returns {Promise<Object>}
 */
async function searchBraveHtml(query, maxResults, timeout) {
  const params = new URLSearchParams({ q: query, source: 'web' });
  const url = `${SEARCH_PROVIDERS.brave.url}?${params}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // 429 限流 → 等 2 秒后重试一次
    if (response.status === 429) {
      logger.warn('Brave Search 429 限流，等待重试...');
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

/**
 * 解析 Brave Search 结果页（Svelte SSR 结构）
 * @param {string} html
 * @param {number} maxResults
 * @returns {Array<{title: string, snippet: string, url: string}>}
 */
function parseBraveHtml(html, maxResults) {
  const results = [];

  // Brave 结构: <div class="snippet svelte-..." data-type="web" data-pos="N">
  const blockStarts = [...html.matchAll(/<div[^>]*class="snippet\b[^"]*"[^>]*data-type="web"[^>]*>/gi)];

  for (let i = 0; i < blockStarts.length && results.length < maxResults; i++) {
    const start = blockStarts[i].index;
    const end = blockStarts[i + 1]?.index || html.length;
    const block = html.slice(start, end);

    // URL: 第一个外部 <a href="https://...">
    const urlMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/i);
    const url = urlMatch?.[1] || '';
    if (!url || url.includes('brave.com')) continue;

    // Title: class="title search-snippet-title ..."
    let title = '';
    const titlePatterns = [
      /class="title\b[^"]*search-snippet-title[^"]*"[^>]*>(.*?)<\/div>/is,
      /class="[^"]*search-snippet-title[^"]*"[^>]*>(.*?)<\/(?:span|div)>/is,
      /class="snippet-title[^"]*"[^>]*>(.*?)<\/(?:span|div)>/is,
    ];
    for (const pattern of titlePatterns) {
      const match = block.match(pattern);
      if (match) {
        title = stripHtml(match[1]);
        // 去掉日期后缀（如 "Title 2025年11月6日 -"）
        title = title.replace(/\s*\d{4}年\d{1,2}月\d{1,2}日\s*[-—]?\s*$/, '').trim();
        break;
      }
    }
    if (!title) continue;

    // Description
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

    // 如果没有摘要，尝试从块中提取任何文本
    if (!snippet) {
      const textMatch = block.match(/<p[^>]*>(.*?)<\/p>/is);
      if (textMatch) {
        snippet = stripHtml(textMatch[1]);
      }
    }

    results.push({ title, snippet, url, type: 'web' });
  }

  return results;
}

// ============================================================
// DuckDuckGo Lite 搜索（备用，无 CAPTCHA）
// ============================================================

/**
 * 使用 DuckDuckGo Lite 搜索
 * @param {string} query
 * @param {number} maxResults
 * @param {number} timeout
 * @returns {Promise<Object>}
 */
async function searchDuckDuckGoHtml(query, maxResults, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // DDG Lite 接受 GET 请求
    const url = `${SEARCH_PROVIDERS.duckduckgo.url}?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: getHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok && response.status !== 202) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // 检测是否为验证码页面
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

/**
 * 解析 DuckDuckGo Lite 搜索结果
 * DDG Lite 结构: <a class='result-link' href="//duckduckgo.com/l/?uddg=...">Title</a>
 *              + <td class='result-snippet'>Snippet...</td>
 * @param {string} html
 * @param {number} maxResults
 * @returns {Array<{title: string, snippet: string, url: string}>}
 */
function parseDuckDuckGoLite(html, maxResults) {
  const results = [];

  // 提取所有 result-link（DDG Lite 格式: href="..." class='result-link'）
  const linkMatches = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi)];

  // 提取所有 result-snippet（DDG Lite 格式: <td class='result-snippet'>）
  const snippetMatches = [...html.matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)];

  for (let i = 0; i < linkMatches.length && results.length < maxResults; i++) {
    let url = linkMatches[i][1];
    const title = stripHtml(linkMatches[i][2]);
    if (!url || !title) continue;

    // 解码 DDG 跳转 URL: //duckduckgo.com/l/?uddg=ENCODED_URL&rut=...
    if (url.includes('uddg=')) {
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
    }
    // 处理协议相对 URL
    if (url.startsWith('//')) url = 'https:' + url;
    if (url.includes('duckduckgo.com')) continue;

    const snippet = snippetMatches[i] ? stripHtml(snippetMatches[i][1]) : '';

    results.push({ title, snippet, url, type: 'web' });
  }

  return results;
}

// ============================================================
// Brave Search API（需要 API Key，最优质）
// ============================================================

/**
 * 使用 Brave Search API
 * @param {string} query
 * @param {string} apiKey
 * @param {number} maxResults
 * @param {number} timeout
 * @returns {Promise<Object>}
 */
async function searchBraveApi(query, apiKey, maxResults, timeout) {
  const params = new URLSearchParams({ q: query, count: String(maxResults) });
  const url = `${SEARCH_PROVIDERS.braveApi.url}?${params}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const results = (data.web?.results || []).map((r) => ({
      title: r.title,
      snippet: r.description,
      url: r.url,
      type: 'web',
    }));

    return { success: true, query, results, source: 'Brave API' };
  } catch (error) {
    clearTimeout(timeoutId);
    return { success: false, error: error.message, results: [] };
  }
}

// ============================================================
// Google HTML 搜索（额外 fallback）
// ============================================================

/**
 * 使用 Google HTML 搜索
 * @param {string} query
 * @param {number} maxResults
 * @param {number} timeout
 * @returns {Promise<Object>}
 */
async function searchGoogleHtml(query, maxResults, timeout) {
  const params = new URLSearchParams({ q: query, num: String(maxResults + 3), hl: 'en' });
  const url = `https://www.google.com/search?${params}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: {
        ...getHeaders(),
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // 检查是否被重定向到验证或同意页
    if (html.includes('Please click') && html.includes('not redirected') && !html.includes('class="g"')) {
      return { success: false, error: 'Google 返回了重定向页面', results: [] };
    }

    const results = parseGoogleHtml(html, maxResults);

    if (results.length > 0) {
      return { success: true, query, results, source: 'Google' };
    }
    return { success: false, error: 'Google 返回页面但未解析到结果', results: [] };
  } catch (error) {
    clearTimeout(timeoutId);
    return { success: false, error: error.message, results: [] };
  }
}

/**
 * 解析 Google HTML 搜索结果
 * @param {string} html
 * @param {number} maxResults
 * @returns {Array<{title: string, snippet: string, url: string}>}
 */
function parseGoogleHtml(html, maxResults) {
  const results = [];

  // Google 搜索结果块: class="g" 或 data-hveid
  const blocks = [...html.matchAll(/<div[^>]*class="[^"]*\bg\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)];

  for (const blockMatch of blocks) {
    if (results.length >= maxResults) break;
    const block = blockMatch[0];

    // URL
    const urlMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i);
    const url = urlMatch?.[1] || '';
    if (!url || url.includes('google.com')) continue;

    // Title: <h3>...</h3>
    const titleMatch = block.match(/<h3[^>]*>(.*?)<\/h3>/is);
    const title = titleMatch ? stripHtml(titleMatch[1]) : '';
    if (!title) continue;

    // Snippet
    let snippet = '';
    const snippetMatch = block.match(/class="VwiC3b[^"]*"[^>]*>(.*?)<\/(?:div|span)>/is)
      || block.match(/<span[^>]*class="[^"]*st[^"]*"[^>]*>(.*?)<\/span>/is);
    if (snippetMatch) {
      snippet = stripHtml(snippetMatch[1]);
    }

    results.push({ title, snippet, url, type: 'web' });
  }

  return results;
}

// ============================================================
// Electron BrowserWindow 搜索（终极 fallback，零 API Key）
// ============================================================

/**
 * 使用隐藏浏览器窗口进行 Google 搜索
 * 利用 Electron 自带 Chromium 完整渲染页面，提取 DOM 中的搜索结果
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<Object>}
 */
async function searchWithBrowser(query, maxResults) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-CN&num=${maxResults + 5}`;

  try {
    const results = await browserPool.executeOnPage(
      searchUrl,
      `
      (() => {
        const items = [];
        // Google 搜索结果主容器
        const blocks = document.querySelectorAll('#search .g, #rso .g');
        for (const block of blocks) {
          if (items.length >= ${maxResults}) break;
          const linkEl = block.querySelector('a[href^="http"]');
          const titleEl = block.querySelector('h3');
          if (!linkEl || !titleEl) continue;
          const url = linkEl.href;
          if (!url || url.includes('google.com/search')) continue;
          const title = titleEl.textContent || '';
          // 摘要：尝试多种选择器
          let snippet = '';
          const snippetEl = block.querySelector('[data-sncf]')
            || block.querySelector('.VwiC3b')
            || block.querySelector('[data-content-feature]')
            || block.querySelector('.lEBKkf');
          if (snippetEl) snippet = snippetEl.textContent || '';
          if (!snippet) {
            // 回退：取块内除标题和 URL 外的文本
            const allText = block.innerText || '';
            const lines = allText.split('\\n').filter(l => l.length > 20);
            snippet = lines.slice(1, 3).join(' ');
          }
          items.push({ title: title.trim(), snippet: snippet.trim(), url, type: 'web' });
        }
        return items;
      })()
      `,
      {
        timeout: 20000,
        settleMs: 2000,
        waitForSelector: '#search, #rso',
      }
    );

    if (results && results.length > 0) {
      return { success: true, query, results: results.slice(0, maxResults), source: 'Google (Browser)' };
    }
    return { success: false, error: '浏览器搜索未提取到结果', results: [] };
  } catch (error) {
    return { success: false, error: `浏览器搜索失败: ${error.message}`, results: [] };
  }
}

// ============================================================
// 主搜索函数（带缓存 + 多引擎自动降级）
// ============================================================

/**
 * 执行网络搜索
 * 优先级：缓存 → Brave API（如有 Key）→ Brave HTML → DuckDuckGo Lite → Google HTML → 浏览器 Google 搜索
 * @param {string} query
 * @param {number} maxResults
 * @param {number} timeout
 * @returns {Promise<Object>}
 */
async function search(query, maxResults = 5, timeout = 10000) {
  // --- 缓存查找 ---
  const cacheKey = `${query}|${maxResults}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug('搜索缓存命中:', query);
    return { ...cached.result, fromCache: true };
  }

  const errors = [];

  // 1. Brave Search API（如果配置了 API Key）
  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveApiKey) {
    const result = await searchBraveApi(query, braveApiKey, maxResults, timeout);
    if (result.success && result.results.length > 0) {
      searchCache.set(cacheKey, { timestamp: Date.now(), result });
      return result;
    }
    errors.push(`Brave API: ${result.error || 'no results'}`);
  }

  // 2. Brave Search HTML 抓取
  const braveResult = await searchBraveHtml(query, maxResults, timeout);
  if (braveResult.success && braveResult.results.length > 0) {
    searchCache.set(cacheKey, { timestamp: Date.now(), result: braveResult });
    return braveResult;
  }
  errors.push(`Brave: ${braveResult.error || 'no results'}`);

  // 3. DuckDuckGo HTML 抓取
  const ddgResult = await searchDuckDuckGoHtml(query, maxResults, timeout);
  if (ddgResult.success && ddgResult.results.length > 0) {
    searchCache.set(cacheKey, { timestamp: Date.now(), result: ddgResult });
    return ddgResult;
  }
  errors.push(`DDG: ${ddgResult.error || 'no results'}`);

  // 4. Google HTML 抓取
  const googleResult = await searchGoogleHtml(query, maxResults, timeout);
  if (googleResult.success && googleResult.results.length > 0) {
    searchCache.set(cacheKey, { timestamp: Date.now(), result: googleResult });
    return googleResult;
  }
  errors.push(`Google: ${googleResult.error || 'no results'}`);

  // 5. 浏览器 fallback（Google）-- 利用 Electron 内置 Chromium
  try {
    const browserResult = await searchWithBrowser(query, maxResults);
    if (browserResult.success && browserResult.results.length > 0) {
      searchCache.set(cacheKey, { timestamp: Date.now(), result: browserResult });
      return browserResult;
    }
    errors.push(`Browser: ${browserResult.error || 'no results'}`);
  } catch (browserErr) {
    errors.push(`Browser: ${browserErr.message}`);
  }

  return {
    success: false,
    query,
    results: [],
    error: `所有搜索引擎失败: ${errors.join('; ')}`,
    note: '所有 HTTP 抓取和浏览器搜索均失败，可配置 BRAVE_SEARCH_API_KEY 提高稳定性',
  };
}

// ============================================================
// 工具注册
// ============================================================

/**
 * 网络搜索工具
 */
const webSearchTool = {
  name: 'web_search',
  description:
    '搜索互联网获取信息。可搜索天气、新闻、技术文档、百科知识等任何内容。只要涉及你不确定或需要最新数据的信息，都应主动调用此工具。',
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
      default: 5,
    },
  },
  requiredPermissions: ['network.searchEnabled'],

  async execute(args) {
    const { query, max_results = 5 } = args;

    if (!query || typeof query !== 'string') {
      throw new Error('请提供有效的搜索查询');
    }

    logger.info('执行网络搜索:', query);

    const result = await search(query, max_results);

    if (!result.success || result.results.length === 0) {
      logger.warn('搜索无结果:', query, result.error);
    } else {
      logger.info('搜索完成:', {
        query,
        source: result.source,
        count: result.results.length,
      });
    }

    return {
      query: result.query,
      provider: result.source || 'Unknown',
      results: result.results,
      resultCount: result.results.length,
      ...(result.error && { error: result.error }),
      ...(result.note && { note: result.note }),
    };
  },
};

/**
 * 注册网络搜索工具
 */
function registerWebSearchTool() {
  toolRegistry.register(webSearchTool);
}

module.exports = {
  webSearchTool,
  registerWebSearchTool,
  search,
  searchBraveHtml,
  searchDuckDuckGoHtml,
  searchBraveApi,
  searchGoogleHtml,
  searchWithBrowser,
  SEARCH_PROVIDERS,
};
