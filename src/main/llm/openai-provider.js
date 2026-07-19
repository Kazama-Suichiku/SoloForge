/**
 * OpenAI LLM Provider
 * 使用 OpenAI API，API Key 从环境变量 OPENAI_API_KEY 读取
 */

require('dotenv').config();
const { LLMProvider } = require('./llm-provider');

const DEFAULT_MODEL = 'gpt-4o-mini';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

class OpenAIProvider extends LLMProvider {
  constructor(options = {}) {
    super('openai', options);
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = options.model || DEFAULT_MODEL;
  }

  _getAuthHeaders() {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is not set. Set it in .env or pass apiKey in options.');
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  /**
   * 是否已配置：检查 OPENAI_API_KEY 是否存在
   * @returns {boolean}
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * 健康检查：查询 OpenAI /v1/models 是否可达。
   * 无 apiKey 时直接返回不可用，避免必然 401 的请求。
   * @returns {Promise<{available: boolean, error?: string, model?: string}>}
   */
  async checkHealth() {
    if (!this.apiKey) {
      return { available: false, error: 'OPENAI_API_KEY not configured' };
    }
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: this._getAuthHeaders(),
      });
      if (res.ok) {
        return { available: true, model: this.model };
      }
      return { available: false, error: `HTTP ${res.status}` };
    } catch (err) {
      return { available: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 转换消息格式为 OpenAI 格式
   * 支持 { role, content }
   */
  _convertMessages(messages) {
    return messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
  }

  /**
   * 处理 OpenAI 流式响应 (SSE)
   */
  async *_parseStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // 忽略解析失败
          }
        }
      }
    }
  }

  async chat(messages, options = {}) {
    const { stream = false } = options;
    const url = options.baseUrl || OPENAI_API_URL;

    const body = {
      model: options.model || this.model,
      messages: this._convertMessages(messages),
      stream,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this._getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${err}`);
    }

    if (stream) {
      return this._parseStream(response);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    // 统一 usage 为下划线字段 + camelCase 别名
    let usage;
    if (data.usage) {
      const prompt_tokens = data.usage.prompt_tokens ?? 0;
      const completion_tokens = data.usage.completion_tokens ?? 0;
      const total_tokens = data.usage.total_tokens ?? (prompt_tokens + completion_tokens);
      usage = {
        prompt_tokens,
        completion_tokens,
        total_tokens,
        // camelCase 别名兼容旧调用方
        promptTokens: prompt_tokens,
        completionTokens: completion_tokens,
        totalTokens: total_tokens,
      };
    }
    return {
      content: choice?.message?.content ?? '',
      model: data.model,
      ...(usage ? { usage } : {}),
      finish_reason: choice?.finish_reason,
    };
  }

  async complete(prompt, options = {}) {
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  getModelInfo() {
    return {
      name: this.model,
      type: 'openai',
      hasApiKey: !!this.apiKey,
    };
  }
}

module.exports = { OpenAIProvider };
