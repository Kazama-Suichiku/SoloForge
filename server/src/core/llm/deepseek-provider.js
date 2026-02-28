/**
 * DeepSeek Provider
 */

const { LLMProvider } = require('./llm-provider');
const { logger } = require('../../utils/logger');

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

class DeepSeekProvider extends LLMProvider {
  constructor(options = {}) {
    super('deepseek', options);
    this.apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.model = options.model || 'deepseek-chat';
    this.baseUrl = options.baseUrl || DEEPSEEK_BASE_URL;
  }

  isConfigured() {
    return !!this.apiKey;
  }

  _getHeaders() {
    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY not configured');
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  _convertMessages(messages) {
    return messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
  }

  async chat(messages, options = {}) {
    if (options.stream) {
      return this.chatStream(messages, options);
    }

    const model = options.model || this.model;

    const body = {
      model,
      messages: this._convertMessages(messages),
      max_tokens: options.maxTokens || 8192,
      temperature: options.temperature ?? 0.7,
      stream: false,
    };

    logger.info('DeepSeek API request', { model, messagesCount: messages.length });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content ?? '',
      model: data.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async *chatStream(messages, options = {}) {
    const model = options.model || this.model;

    const body = {
      model,
      messages: this._convertMessages(messages),
      max_tokens: options.maxTokens || 8192,
      temperature: options.temperature ?? 0.7,
      stream: true,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              yield delta.content;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async complete(prompt, options = {}) {
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  getModelInfo() {
    return {
      name: this.model,
      type: 'deepseek',
      hasApiKey: !!this.apiKey,
    };
  }
}

module.exports = { DeepSeekProvider };
