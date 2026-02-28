/**
 * LLM Manager - 管理多个 LLM Provider
 */

const { DeepSeekProvider } = require('./deepseek-provider');
const { OpenAIProvider } = require('./openai-provider');
const { MockProvider } = require('./mock-provider');
const { logger } = require('../../utils/logger');

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

function isRetryableError(err) {
  const msg = (err && err.message) || '';
  const code = err && err.code;
  return (
    err instanceof TypeError ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    msg.includes('fetch') ||
    msg.includes('network')
  );
}

class LLMManager {
  constructor() {
    this.providers = new Map();
    this.defaultProviderName = null;
    this.fallbackOrder = ['deepseek', 'openai', 'mock'];
    this._initialized = false;
  }

  initialize() {
    if (this._initialized) return;

    // 注册 providers
    this.registerProvider(new DeepSeekProvider());
    this.registerProvider(new OpenAIProvider());
    this.registerProvider(new MockProvider());

    this._initialized = true;
    logger.info('LLM Manager initialized', { providers: this.getProviderNames() });
  }

  registerProvider(provider) {
    this.providers.set(provider.name, provider);
    if (!this.defaultProviderName) {
      this.defaultProviderName = provider.name;
    }
  }

  getProvider(name) {
    return this.providers.get(name) ?? null;
  }

  setDefaultProvider(name) {
    if (this.providers.has(name)) {
      this.defaultProviderName = name;
    }
  }

  getProviderNames() {
    return [...this.providers.keys()];
  }

  getAvailableModels() {
    return [
      { id: 'deepseek-chat', name: 'DeepSeek V3', provider: 'deepseek' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
    ];
  }

  getDefaultModel() {
    return 'deepseek-chat';
  }

  async _chatWithRetry(provider, messages, rest) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await provider.chat(messages, rest);
      } catch (err) {
        lastError = err;
        if (!isRetryableError(err) || attempt === MAX_RETRIES) {
          throw err;
        }
        const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        logger.warn(`LLM retry ${attempt + 1}/${MAX_RETRIES}, waiting ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  _getProviderFallbackList(preferredName) {
    const names = preferredName
      ? [preferredName, ...this.fallbackOrder.filter((n) => n !== preferredName)]
      : [...this.fallbackOrder];
    return names.map((n) => this.getProvider(n)).filter(Boolean);
  }

  async chat(messages, options = {}) {
    const { provider: providerName, ...rest } = options;
    const preferredName = providerName || this.defaultProviderName;
    const providers = this._getProviderFallbackList(preferredName);

    let lastError = null;
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      try {
        const result = await this._chatWithRetry(provider, messages, rest);
        if (i > 0) {
          logger.info(`Fell back to provider "${provider.name}"`);
        }
        return result;
      } catch (err) {
        lastError = err;
        logger.warn(`Provider "${provider.name}" failed: ${err.message}`);
        if (!isRetryableError(err)) {
          throw err;
        }
      }
    }
    throw lastError || new Error('No available LLM provider');
  }

  async complete(prompt, options = {}) {
    return this.chat([{ role: 'user', content: prompt }], options);
  }
}

// 单例
const llmManager = new LLMManager();

module.exports = { LLMManager, llmManager };
