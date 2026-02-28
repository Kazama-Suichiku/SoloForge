/**
 * OpenAI Provider
 */

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
      throw new Error('OPENAI_API_KEY not configured');
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  _convertMessages(messages) {
    return messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
  }

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
            // Ignore parse errors
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
    return {
      content: choice?.message?.content ?? '',
      model: data.model,
      usage: data.usage,
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
