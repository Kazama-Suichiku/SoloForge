/**
 * LLM Manager - 管理多个 LLM Provider
 * 支持连接检测、自动降级、重试（指数退避）
 */

const { OllamaProvider } = require('./ollama-provider');
const { OpenAIProvider } = require('./openai-provider');
const { DuojieProvider } = require('./duojie-provider');
const { DeepSeekProvider } = require('./deepseek-provider');
const { MockProvider } = require('./mock-provider');
const { logger } = require('../utils/logger');

/** 最大重试次数 */
const MAX_RETRIES = 3;
/** 初始退避毫秒 */
const INITIAL_BACKOFF_MS = 1000;

/** 可重试的错误类型（网络相关或服务端 5xx） */
function isRetryableError(err) {
  const msg = (err && err.message) || '';
  const code = err && err.code;
  const status = err?.response?.status ?? err?.status;
  const has5xx = status
    ? isRetryableStatus(status)
    : /\b(502|503|504)\b/.test(msg);
  return (
    has5xx ||
    err instanceof TypeError ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ENETUNREACH' ||
    msg.includes('fetch') ||
    msg.includes('network')
  );
}

/** 可重试的 HTTP 状态码 */
function isRetryableStatus(status) {
  return status === 502 || status === 503 || status === 504;
}

/**
 * 检测是否为上下文窗口超限错误
 * 常见于发送的 messages 总 token 超过了模型的 context window
 * @param {Error} err
 * @returns {boolean}
 */
function isContextTooLongError(err) {
  const msg = ((err && err.message) || '').toLowerCase();
  const status = err?.response?.status ?? err?.status;
  return (
    msg.includes('context_length') ||
    msg.includes('context length') ||
    msg.includes('too many tokens') ||
    msg.includes('maximum context') ||
    msg.includes('too long') ||
    msg.includes('token limit') ||
    msg.includes('max_tokens') ||
    msg.includes('prompt is too long') ||
    msg.includes('input too long') ||
    (status === 400 && (msg.includes('token') || msg.includes('length')))
  );
}

/**
 * 模型 ID → Provider 名称 映射
 * 当 Agent 配置了特定模型时，自动路由到对应的 provider
 */
const MODEL_TO_PROVIDER = {
  'deepseek-chat': 'deepseek',
  'deepseek-reasoner': 'deepseek',
  // 其他模型默认走 duojie
};

class LLMManager {
  constructor() {
    this.providers = new Map();
    this.defaultProviderName = null;
    /** 备用 provider 顺序（降级时依次尝试） */
    this.fallbackOrder = ['duojie', 'deepseek', 'ollama', 'openai', 'mock'];

    // 预注册 provider（duojie 优先，mock 作为最终降级）
    this.registerProvider(new DuojieProvider());
    this.registerProvider(new DeepSeekProvider());
    this.registerProvider(new OllamaProvider());
    this.registerProvider(new OpenAIProvider());
    this.registerProvider(new MockProvider());
  }

  /**
   * 根据模型 ID 解析应使用的 provider 名称
   * @param {string} model - 模型 ID（如 'deepseek-chat'）
   * @returns {string|null} provider 名称，未匹配时返回 null
   */
  _resolveProviderForModel(model) {
    if (!model) return null;
    return MODEL_TO_PROVIDER[model] || null;
  }

  /**
   * 注册 provider
   * @param {LLMProvider} provider
   */
  registerProvider(provider) {
    this.providers.set(provider.name, provider);
    if (!this.defaultProviderName) {
      this.defaultProviderName = provider.name;
    }
  }

  /**
   * 获取指定 provider
   * @param {string} name - provider 名称 ('ollama' | 'openai')
   * @returns {LLMProvider|null}
   */
  getProvider(name) {
    return this.providers.get(name) ?? null;
  }

  /**
   * 设置默认 provider
   * @param {string} name
   */
  setDefaultProvider(name) {
    if (this.providers.has(name)) {
      this.defaultProviderName = name;
    } else {
      throw new Error(`Provider "${name}" not found`);
    }
  }

  /**
   * 获取默认 provider
   * @returns {LLMProvider}
   */
  _getDefaultProvider() {
    const provider = this.providers.get(this.defaultProviderName);
    if (!provider) {
      throw new Error(
        `No default provider. Available: ${[...this.providers.keys()].join(', ')}`
      );
    }
    return provider;
  }

  /**
   * 检测指定 provider 是否可用
   * @param {string} providerName - 'ollama' | 'openai' | 'mock'
   * @returns {Promise<{ available: boolean, error?: string }>}
   */
  async checkConnection(providerName) {
    const provider = this.getProvider(providerName);
    if (!provider) {
      return { available: false, error: `Provider "${providerName}" not found` };
    }
    if (providerName === 'mock') {
      return { available: true };
    }

    try {
      if (providerName === 'ollama') {
        const baseUrl = provider.baseUrl || 'http://localhost:11434';
        const res = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
        return { available: res.ok };
      }
      if (providerName === 'openai') {
        const url = 'https://api.openai.com/v1/models';
        let headers = { 'Content-Type': 'application/json' };
        try {
          if (typeof provider._getAuthHeaders === 'function') {
            Object.assign(headers, provider._getAuthHeaders());
          }
        } catch {
          // 无 API Key 时仍可检测网络
        }
        const res = await fetch(url, { method: 'GET', headers });
        return { available: res.ok || res.status === 401 };
      }
      if (providerName === 'duojie') {
        // 检测 Duojie API 可用性
        if (!provider.apiKey) {
          return { available: false, error: 'DUOJIE_API_KEY not configured' };
        }
        const url = 'https://api.duojie.games/v1/models';
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${provider.apiKey}` },
        });
        return { available: res.ok || res.status === 401 };
      }
      if (providerName === 'deepseek') {
        if (!provider.apiKey) {
          return { available: false, error: 'DEEPSEEK_API_KEY not configured' };
        }
        const url = `${provider.baseUrl || 'https://api.deepseek.com/v1'}/models`;
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${provider.apiKey}` },
        });
        return { available: res.ok || res.status === 401 };
      }
      return { available: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { available: false, error: msg };
    }
  }

  /**
   * 带重试与降级的 chat 实现
   * @param {LLMProvider} provider
   * @param {Array} messages
   * @param {Object} rest
   */
  async _chatWithRetry(provider, messages, rest) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await provider.chat(messages, rest);
      } catch (err) {
        lastError = err;
        const status = err?.response?.status ?? err?.status;
        const canRetry =
          isRetryableError(err) || (status && isRetryableStatus(status));

        if (!canRetry || attempt === MAX_RETRIES) {
          throw err;
        }
        const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        logger.warn(`LLM chat 重试 ${attempt + 1}/${MAX_RETRIES}，${delay}ms 后重试:`, err?.message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  /**
   * 带重试与降级的 complete 实现
   */
  async _completeWithRetry(provider, prompt, rest) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await provider.complete(prompt, rest);
      } catch (err) {
        lastError = err;
        const status = err?.response?.status ?? err?.status;
        const canRetry =
          isRetryableError(err) || (status && isRetryableStatus(status));

        if (!canRetry || attempt === MAX_RETRIES) {
          throw err;
        }
        const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        logger.warn(`LLM complete 重试 ${attempt + 1}/${MAX_RETRIES}，${delay}ms 后重试:`, err?.message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  /**
   * 获取待尝试的 provider 列表（按降级顺序）
   */
  _getProviderFallbackList(preferredName) {
    const names = preferredName
      ? [preferredName, ...this.fallbackOrder.filter((n) => n !== preferredName)]
      : [...this.fallbackOrder];
    return names.map((n) => this.getProvider(n)).filter(Boolean);
  }

  /**
   * 代理 chat 到指定或默认 provider（支持自动降级与重试）
   * @param {Array} messages
   * @param {Object} options - 可包含 provider?: string
   */
  async chat(messages, options = {}) {
    const { provider: providerName, ...rest } = options;
    // 自动根据 model 选择 provider（如 deepseek-chat → deepseek）
    const modelProvider = this._resolveProviderForModel(rest.model);
    const preferredName = providerName || modelProvider || this.defaultProviderName;
    const providers = this._getProviderFallbackList(preferredName);

    let lastError = null;
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      try {
        const result = await this._chatWithRetry(provider, messages, rest);
        if (i > 0) {
          logger.info(`已降级到 provider "${provider.name}" 并成功`);
        }
        return result;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Provider "${provider.name}" 失败: ${msg}`);
        if (!isRetryableError(err)) {
          throw err;
        }
      }
    }
    throw lastError || new Error('无可用 LLM provider');
  }

  /**
   * 代理 complete 到指定或默认 provider（支持自动降级与重试）
   * @param {string} prompt
   * @param {Object} options - 可包含 provider?: string
   */
  async complete(prompt, options = {}) {
    const { provider: providerName, ...rest } = options;
    const modelProvider = this._resolveProviderForModel(rest.model);
    const preferredName = providerName || modelProvider || this.defaultProviderName;
    const providers = this._getProviderFallbackList(preferredName);

    let lastError = null;
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      try {
        const result = await this._completeWithRetry(provider, prompt, rest);
        if (i > 0) {
          logger.info(`已降级到 provider "${provider.name}" 并成功`);
        }
        return result;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Provider "${provider.name}" 失败: ${msg}`);
        if (!isRetryableError(err)) {
          throw err;
        }
      }
    }
    throw lastError || new Error('无可用 LLM provider');
  }

  /**
   * 获取所有已注册的 provider 名称
   */
  getProviderNames() {
    return [...this.providers.keys()];
  }
}

module.exports = { LLMManager, isContextTooLongError };
