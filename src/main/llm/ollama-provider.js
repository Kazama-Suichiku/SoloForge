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
    return {
      content: data.message?.content ?? '',
      model: data.model,
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
    return {
      content: data.response ?? '',
      model: data.model,
      done: data.done,
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
