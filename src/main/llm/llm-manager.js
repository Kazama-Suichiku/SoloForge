/**
 * LLM Manager - 管理多个 LLM Provider
 * 支持连接检测、自动降级、重试（指数退避）
 */

const { OllamaProvider } = require('./ollama-provider');
const { OpenAIProvider } = require('./openai-provider');
const { DuojieProvider } = require('./duojie-provider');
const { DeepSeekProvider } = require('./deepseek-provider');
const { LocalGlmProvider } = require('./local-glm-provider');
const { MockProvider } = require('./mock-provider');
const { logger } = require('../utils/logger');

/** 最大重试次数 */
const MAX_RETRIES = 3;
/** 初始退避毫秒 */
const INITIAL_BACKOFF_MS = 1000;

/** 可重试的错误类型（网络相关、限流 429 或服务端 5xx） */
function isRetryableError(err) {
  const msg = (err && err.message) || '';
  const code = err && err.code;
  const status = err?.response?.status ?? err?.status;
  const hasRetryableStatus = status
    ? isRetryableStatus(status)
    : /\b(429|502|503|504)\b/.test(msg);
  return (
    hasRetryableStatus ||
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

/** 可重试的 HTTP 状态码（含 429 限流） */
function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
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
  'zai-org/GLM-5.2-FP8': 'local-glm',
  'glm-5.2': 'local-glm',
  // 其他模型默认走 duojie（glm-4.7 / glm-5 等云端智谱模型仍走 duojie）
};

/**
 * 跨 provider 降级时的等效模型映射表
 * 当请求的模型在降级目标 provider 上不支持时，映射为该 provider 上等效的模型。
 * 结构：{ 原模型: { providerName: 等效模型, ... } }
 *
 * 关键场景：duojie 挂了降级到 deepseek，但 deepseek 不认识 claude-sonnet-4-5，
 * 全链失败。此处将 claude-* / glm-* / gpt-* 等云端模型映射为各 provider 的 default 模型。
 */
const MODEL_EQUIVALENTS = {
  // Claude 系列（仅 duojie 原生支持）
  'claude-sonnet-4-5': { deepseek: 'deepseek-chat', ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  'claude-opus-4-5-kiro': { deepseek: 'deepseek-chat', ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  'claude-opus-4-5-max': { deepseek: 'deepseek-chat', ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  'claude-opus-4-6-normal': { deepseek: 'deepseek-chat', ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  'claude-opus-4-6-kiro': { deepseek: 'deepseek-chat', ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  'claude-haiku-4-5': { deepseek: 'deepseek-chat', ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  // GLM 系列（duojie / local-glm 支持；降级到官方 API 用 deepseek-chat）
  'glm-4.7': { deepseek: 'deepseek-chat', ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  'glm-5': { deepseek: 'deepseek-chat', ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  'glm-5.2': { deepseek: 'deepseek-chat', ollama: 'llama3', openai: 'gpt-4o-mini' }, // local-glm 原生支持，无需映射
  'zai-org/GLM-5.2-FP8': { deepseek: 'deepseek-chat', ollama: 'llama3', openai: 'gpt-4o-mini' },
  // OpenAI 系列（duojie / openai 支持；降级到本地/others 用对应模型）
  'gpt-5.3-codex': { deepseek: 'deepseek-chat', ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  // Gemini
  'gemini-3-pro-image-preview': { deepseek: 'deepseek-chat', ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  // DeepSeek 系列（降级到本地模型）
  'deepseek-chat': { ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  'deepseek-reasoner': { ollama: 'llama3', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
  // Ollama 默认模型降级到云端时
  'llama3': { deepseek: 'deepseek-chat', 'local-glm': 'zai-org/GLM-5.2-FP8', openai: 'gpt-4o-mini' },
};

/**
 * 各 provider 的 default 模型（映射不到等效模型时的兜底）
 */
const PROVIDER_DEFAULT_MODELS = {
  'local-glm': 'zai-org/GLM-5.2-FP8',
  'duojie': 'claude-sonnet-4-5',
  'deepseek': 'deepseek-chat',
  'ollama': 'llama3',
  'openai': 'gpt-4o-mini',
  'mock': 'mock',
};

/**
 * 为降级目标 provider 选择等效模型。
 * 1) 先查 MODEL_EQUIVALENTS[model][providerName]
 * 2) 查不到则用 provider 实例自己的 default（this.model）
 * 3) 再查不到用 PROVIDER_DEFAULT_MODELS[providerName]
 * @param {string} providerName - 降级目标 provider 名称
 * @param {Object} provider - provider 实例（用于读取默认模型）
 * @param {string|undefined} model - 原请求模型
 * @returns {string|undefined} 等效模型；undefined 表示用 provider 默认
 */
function resolveEquivalentModel(providerName, provider, model) {
  if (!model) return undefined;
  // 目标 provider 与原 provider 相同时无需映射
  const mapped = MODEL_EQUIVALENTS[model];
  if (mapped && mapped[providerName]) {
    return mapped[providerName];
  }
  // 模型本身没在映射表里 → 假定目标 provider 不支持，用 provider 的 default
  // 但若 provider.model 就是请求模型（同 provider 降级重试），保持原模型
  if (provider && provider.model === model) {
    return model;
  }
  const fallback = (provider && provider.model) || PROVIDER_DEFAULT_MODELS[providerName];
  return fallback;
}

class LLMManager {
  constructor() {
    this.providers = new Map();
    this.defaultProviderName = null;

    // 预注册 provider（顺序影响首个注册者成为临时默认，最终默认由下方 setDefaultProvider 决定）
    this.registerProvider(new LocalGlmProvider());
    this.registerProvider(new DuojieProvider());
    this.registerProvider(new DeepSeekProvider());
    this.registerProvider(new OllamaProvider());
    this.registerProvider(new OpenAIProvider());
    this.registerProvider(new MockProvider());

    // 默认 provider：以本地 GLM 为基础，可用 env LLM_DEFAULT_PROVIDER 覆盖
    const defaultProvider = process.env.LLM_DEFAULT_PROVIDER || 'local-glm';
    if (this.providers.has(defaultProvider)) {
      this.defaultProviderName = defaultProvider;
    }

    /**
     * 备用 provider 顺序（降级时依次尝试）。
     * 以本地 GLM 为首选，其后是云端中转与官方 API，mock 作为最终降级。
     * 可用 env LLM_FALLBACK_ORDER（逗号分隔）覆盖。
     */
    const envOrder = (process.env.LLM_FALLBACK_ORDER || '').split(',').map((s) => s.trim()).filter(Boolean);
    this.fallbackOrder = envOrder.length > 0
      ? envOrder
      : ['local-glm', 'duojie', 'deepseek', 'ollama', 'openai', 'mock'];
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
   *
   * 优先调用 provider.checkHealth()（基类与各 provider 已统一实现）；
   * 若 provider 未实现 checkHealth，则保留旧分支作为兼容兜底。
   *
   * @param {string} providerName - 'ollama' | 'openai' | 'mock' | 'duojie' | 'deepseek' | 'local-glm'
   * @returns {Promise<{ available: boolean, error?: string, model?: string }>}
   */
  async checkConnection(providerName) {
    const provider = this.getProvider(providerName);
    if (!provider) {
      return { available: false, error: `Provider "${providerName}" not found` };
    }
    if (providerName === 'mock') {
      return { available: true };
    }

    // 优先使用 provider 自带的 checkHealth（统一接口）
    if (typeof provider.checkHealth === 'function') {
      try {
        const h = await provider.checkHealth();
        return { available: !!h.available, error: h.error, model: h.model };
      } catch (err) {
        return { available: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── 以下为兼容兜底（provider 未实现 checkHealth 时） ──
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
        // 优先使用服务端 Retry-After 指示的延迟（429 限流）
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        const delay = typeof err?.retryAfterMs === 'number'
          ? Math.min(err.retryAfterMs, backoff * 4) // 尊重服务端，但设上限防止过长阻塞
          : backoff;
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
        // 优先使用服务端 Retry-After 指示的延迟（429 限流）
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        const delay = typeof err?.retryAfterMs === 'number'
          ? Math.min(err.retryAfterMs, backoff * 4)
          : backoff;
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
   *
   * 降级链模型映射：当降级到非首选 provider 时，若该 provider 不支持原请求模型，
   * 通过 MODEL_EQUIVALENTS 映射为等效模型（例：claude-sonnet-4-5 降级到 deepseek 时用 deepseek-chat），
   * 映射不到则用 provider 的 default 模型。
   *
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
      // 降级时按映射表转换模型
      const localRest = (i === 0)
        ? rest
        : { ...rest, model: resolveEquivalentModel(provider.name, provider, rest.model) };
      try {
        const result = await this._chatWithRetry(provider, messages, localRest);
        if (i > 0) {
          logger.info(`已降级到 provider "${provider.name}" 并成功（模型映射: ${rest.model || '(default)'} → ${localRest.model || '(default)'}）`);
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
   *
   * 降级链模型映射逻辑同 chat。
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
      const localRest = (i === 0)
        ? rest
        : { ...rest, model: resolveEquivalentModel(provider.name, provider, rest.model) };
      try {
        const result = await this._completeWithRetry(provider, prompt, localRest);
        if (i > 0) {
          logger.info(`已降级到 provider "${provider.name}" 并成功（模型映射: ${rest.model || '(default)'} → ${localRest.model || '(default)'}）`);
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

module.exports = { LLMManager, isContextTooLongError, MODEL_EQUIVALENTS, PROVIDER_DEFAULT_MODELS, resolveEquivalentModel };
