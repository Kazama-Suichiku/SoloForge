/**
 * Local GLM LLM Provider
 * 连接本地 litellm 代理（opencode 的 local-glm），提供 GLM-5.2 模型。
 * OpenAI 兼容接口，baseURL 默认 http://localhost:4000。
 *
 * 配置（.env 可选覆盖）：
 *   LOCAL_GLM_BASE_URL  - 服务地址，默认 http://localhost:4000
 *   LOCAL_GLM_API_KEY   - API Key，默认 ***（litellm 本地代理不校验）
 *   LOCAL_GLM_MODEL     - 模型 ID，默认 zai-org/GLM-5.2-FP8
 */

require('dotenv').config();
const { LLMProvider } = require('./llm-provider');

const DEFAULT_BASE_URL = 'http://localhost:4000';
const DEFAULT_MODEL = 'zai-org/GLM-5.2-FP8';
const DEFAULT_API_KEY = '***'; // litellm 本地代理通常不校验 key

class LocalGlmProvider extends LLMProvider {
  constructor(options = {}) {
    super('local-glm', options);
    this.baseUrl = (options.baseUrl || process.env.LOCAL_GLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = options.apiKey || process.env.LOCAL_GLM_API_KEY || DEFAULT_API_KEY;
    this.model = options.model || process.env.LOCAL_GLM_MODEL || DEFAULT_MODEL;
  }

  _getAuthHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + this.apiKey,
    };
  }

  /**
   * 转换消息格式为 OpenAI 格式
   */
  _convertMessages(messages) {
    return messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
  }

  /**
   * 处理 OpenAI 流式响应 (SSE)
   * GLM-5.2 为推理模型，delta 中可能含 reasoning_content，仅取 content 输出。
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
            const delta = parsed.choices?.[0]?.delta;
            // 优先正文 content；推理内容 reasoning_content 不作为正文输出
            if (delta?.content) yield delta.content;
          } catch {
            // 忽略解析失败
          }
        }
      }
    }
  }

  /**
   * 从非流式响应中提取正文。
   * GLM-5.2 推理模型：finish_reason=length 时 content 可能为空，
   * 正文在 message.content；某些情况下内容在 reasoning_content，作为兜底。
   */
  _extractContent(choice) {
    const msg = choice?.message || {};
    if (typeof msg.content === 'string' && msg.content.length > 0) {
      return msg.content;
    }
    if (typeof msg.reasoning_content === 'string') {
      return msg.reasoning_content;
    }
    return msg.content ?? '';
  }

  async chat(messages, options = {}) {
    const { stream = false } = options;
    const url = options.baseUrl || `${this.baseUrl}/v1/chat/completions`;

    // 归一化模型别名：glm-5.2 → 本地真实模型 ID
    let model = options.model || this.model;
    if (model === 'glm-5.2') model = DEFAULT_MODEL;

    const body = {
      model,
      messages: this._convertMessages(messages),
      stream,
    };
    // 透传可选生成参数
    if (options.max_tokens != null) body.max_tokens = options.max_tokens;
    if (options.temperature != null) body.temperature = options.temperature;

    const response = await fetch(url, {
      method: 'POST',
      headers: this._getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Local GLM API error: ${response.status} - ${err}`);
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
      content: this._extractContent(choice),
      model: data.model,
      ...(usage ? { usage } : {}),
      finish_reason: choice?.finish_reason,
    };
  }

  async complete(prompt, options = {}) {
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  /**
   * 是否已配置：local-glm 是基础 provider，始终视为已配置（应被巡查监控）。
   */
  isConfigured() {
    return true;
  }

  /**
   * 健康检查：查询 /v1/models 是否可达
   */
  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this._getAuthHeaders(),
      });
      if (!response.ok) {
        return { available: false, error: `HTTP ${response.status}` };
      }
      const data = await response.json();
      const hasModel = Array.isArray(data.data) && data.data.some((m) => m.id === this.model);
      return { available: true, model: this.model, hasModel };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  getModelInfo() {
    return {
      name: this.model,
      type: 'local-glm',
      baseUrl: this.baseUrl,
      hasApiKey: Boolean(this.apiKey),
    };
  }
}

module.exports = { LocalGlmProvider };
