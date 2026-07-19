/**
 * Ollama LLM Provider
 * 使用本地 Ollama API (http://localhost:11434)
 */

const { LLMProvider } = require('./llm-provider');

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3';

class OllamaProvider extends LLMProvider {
  constructor(options = {}) {
    super('ollama', options);
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.model = options.model || DEFAULT_MODEL;
  }

  /**
   * 是否已配置：本地 Ollama 服务，无需凭据，始终视为已配置（应被探测）。
   * @returns {boolean}
   */
  isConfigured() {
    return true;
  }

  /**
   * 健康检查：查询 Ollama /api/tags 是否可达。
   * @returns {Promise<{available: boolean, error?: string, model?: string}>}
   */
  async checkHealth() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      if (!res.ok) {
        return { available: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const hasModel = Array.isArray(data.models) && data.models.some((m) => m.name === this.model);
      return { available: true, model: this.model, hasModel };
    } catch (err) {
      return { available: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 转换消息格式为 Ollama 格式
   * OpenAI 格式: { role: 'user'|'assistant'|'system', content }
   * Ollama 格式: { role: 'user'|'assistant'|'system', content }
   */
  _convertMessages(messages) {
    return messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
  }

  /**
   * 处理流式响应
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
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.response !== undefined) {
            yield data.response;
          }
          if (data.done) return;
        } catch {
          // 忽略解析失败的行
        }
      }
    }
  }

  async chat(messages, options = {}) {
    const { stream = false } = options;
    const url = `${this.baseUrl}/api/chat`;

    const body = {
      model: options.model || this.model,
      messages: this._convertMessages(messages),
      stream,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${err}`);
    }

    if (stream) {
      return this._parseStream(response);
    }

    const data = await response.json();
    // 统一返回类型：包含 content / model / finish_reason；Ollama 不返回 token usage
    return {
      content: data.message?.content ?? '',
      model: data.model,
      finish_reason: data.done ? 'stop' : undefined,
      done: data.done,
    };
  }

  async complete(prompt, options = {}) {
    const { stream = false } = options;
    const url = `${this.baseUrl}/api/generate`;

    const body = {
      model: options.model || this.model,
      prompt,
      stream,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${err}`);
    }

    if (stream) {
      return this._parseStream(response);
    }

    const data = await response.json();
    // Ollama 的 generate 端点可能返回 eval_count 等统计字段，这里透传为 usage
    const usage = (data.eval_count != null || data.prompt_eval_count != null) ? {
      prompt_tokens: data.prompt_eval_count ?? 0,
      completion_tokens: data.eval_count ?? 0,
      total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      // camelCase 别名兼容旧调用方
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
    } : undefined;
    return {
      content: data.response ?? '',
      model: data.model,
      finish_reason: data.done ? 'stop' : undefined,
      done: data.done,
      ...(usage ? { usage } : {}),
    };
  }

  getModelInfo() {
    return {
      name: this.model,
      type: 'ollama',
      baseUrl: this.baseUrl,
    };
  }
}

module.exports = { OllamaProvider };
