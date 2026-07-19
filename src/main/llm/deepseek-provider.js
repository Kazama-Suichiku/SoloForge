/**
 * SoloForge - DeepSeek 官方 API Provider
 * 使用 DeepSeek 官方 OpenAI 兼容 API
 * 支持 deepseek-chat (V3) 和 deepseek-reasoner (R1)
 * @module llm/deepseek-provider
 */

const { LLMProvider } = require('./llm-provider');

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

// DeepSeek 支持的模型
const SUPPORTED_MODELS = [
  'deepseek-chat',      // DeepSeek-V3
  'deepseek-reasoner',  // DeepSeek-R1（带推理链）
];

// 模型上下文长度限制
const MODEL_CONTEXT_LIMITS = {
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,
};

class DeepSeekProvider extends LLMProvider {
  constructor(options = {}) {
    super('deepseek', options);
    this.apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.model = options.model || 'deepseek-chat';
    this.baseUrl = options.baseUrl || DEEPSEEK_BASE_URL;
  }

  /**
   * 检查 API Key 是否已配置
   * @returns {boolean}
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * 健康检查：查询 DeepSeek /models 是否可达。
   * 无 apiKey 时直接返回不可用，避免必然 401 的请求。
   * @returns {Promise<{available: boolean, error?: string, model?: string}>}
   */
  async checkHealth() {
    if (!this.apiKey) {
      return { available: false, error: 'DEEPSEEK_API_KEY not configured' };
    }
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
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
   * 获取请求头
   */
  _getHeaders() {
    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY 未设置。请在环境变量中设置 DEEPSEEK_API_KEY。');
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  /**
   * 转换消息格式
   * 支持 string 和多模态 content
   */
  _convertMessages(messages) {
    return messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
  }

  /**
   * 将内部工具定义转换为 OpenAI function calling 格式
   * @param {Array<Object>} tools - 内部 ToolDefinition 列表
   * @returns {Array<Object>} OpenAI tools 格式
   */
  _convertToolsToOpenAI(tools) {
    if (!tools || tools.length === 0) return [];
    return tools.map((tool) => {
      // 转换参数格式：内部格式每个参数有 required 属性，需要提取为数组
      const properties = {};
      const requiredFields = [];

      for (const [paramName, paramDef] of Object.entries(tool.parameters || {})) {
        // 复制参数定义，但移除 required 字段（OpenAI 格式不允许在 properties 内有 required）
        const { required, ...cleanParamDef } = paramDef;
        properties[paramName] = cleanParamDef;

        // 收集 required 字段名
        if (required === true) {
          requiredFields.push(paramName);
        }
      }

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: (tool.description || '').slice(0, 1024),
          parameters: {
            type: 'object',
            properties,
            required: requiredFields.length > 0 ? requiredFields : undefined,
          },
        },
      };
    });
  }

  /**
   * 将 OpenAI function call 响应转换为内部 XML 格式
   * @param {string} name - 工具名称
   * @param {Object|string} args - 工具参数
   * @returns {string}
   */
  _functionCallToXml(name, args) {
    let argsObj = args;
    if (typeof args === 'string') {
      try {
        argsObj = JSON.parse(args);
      } catch {
        argsObj = {};
      }
    }

    let argsXml = '';
    for (const [key, value] of Object.entries(argsObj || {})) {
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      argsXml += `<${key}>${valueStr}</${key}>`;
    }

    return `<tool_call><name>${name}</name><arguments>${argsXml}</arguments></tool_call>`;
  }

  /**
   * 发送对话请求
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} options
   * @returns {Promise<{content: string, usage: Object} | AsyncGenerator<string>>}
   */
  async chat(messages, options = {}) {
    if (options.stream) {
      return this.chatStream(messages, options);
    }

    const model = options.model || this.model;
    const { logger } = require('../utils/logger');

    const body = {
      model,
      messages: this._convertMessages(messages),
      max_tokens: options.maxTokens || 8192,
      temperature: options.temperature ?? 0.7,
      stream: false,
    };

    // 添加原生 function calling 支持
    if (options.tools?.length > 0) {
      body.tools = this._convertToolsToOpenAI(options.tools);
    }

    logger.info('DeepSeek API 请求', { model, messagesCount: messages.length, toolsCount: body.tools?.length || 0 });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API 错误: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    let content = choice?.message?.content ?? '';

    // 处理原生 function call：转换为内部 XML 格式
    const toolCalls = choice?.message?.tool_calls;
    if (toolCalls?.length > 0) {
      for (const tc of toolCalls) {
        if (tc.type === 'function' && tc.function) {
          content += this._functionCallToXml(tc.function.name, tc.function.arguments);
        }
      }
      logger.info('DeepSeek 原生工具调用', { count: toolCalls.length, names: toolCalls.map(tc => tc.function?.name) });
    }

    // DeepSeek-R1 的推理链在 reasoning_content 字段
    const reasoningContent = choice?.message?.reasoning_content;

    const result = {
      content,
      model: data.model,
      usage: data.usage ? {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
        // camelCase 别名兼容旧调用方
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      finish_reason: choice?.finish_reason,
    };

    if (reasoningContent) {
      result.reasoningContent = reasoningContent;
    }

    return result;
  }

  /**
   * 流式对话请求
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} options
   * @returns {AsyncGenerator<string>}
   */
  async *chatStream(messages, options = {}) {
    const model = options.model || this.model;
    const { logger } = require('../utils/logger');

    const body = {
      model,
      messages: this._convertMessages(messages),
      max_tokens: options.maxTokens || 8192,
      temperature: options.temperature ?? 0.7,
      stream: true,
    };

    // 添加原生 function calling 支持
    if (options.tools?.length > 0) {
      body.tools = this._convertToolsToOpenAI(options.tools);
    }

    logger.info('DeepSeek 流式请求', { model, messagesCount: messages.length, toolsCount: body.tools?.length || 0 });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API 错误: ${response.status} - ${errText}`);
    }

    logger.info('DeepSeek 流式响应状态', { status: response.status, ok: response.ok });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkNum = 0;

    // 用于累积流式 function call
    const pendingToolCalls = new Map(); // index -> { name, arguments }

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
          if (data === '[DONE]') {
            // 流结束时，输出所有累积的 function calls
            for (const [, tc] of pendingToolCalls) {
              if (tc.name) {
                yield this._functionCallToXml(tc.name, tc.arguments);
                logger.info('DeepSeek 流式工具调用完成', { name: tc.name });
              }
            }
            logger.info('DeepSeek 流式收到 [DONE]');
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            // 处理文本内容
            if (delta?.content) {
              chunkNum++;
              if (chunkNum <= 3) {
                logger.info('DeepSeek 流式收到数据块', {
                  chunkNum,
                  length: data.length,
                  preview: data.slice(0, 200),
                });
              }
              yield delta.content;
            }

            // 处理流式 function call
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!pendingToolCalls.has(idx)) {
                  pendingToolCalls.set(idx, { name: '', arguments: '' });
                }
                const pending = pendingToolCalls.get(idx);
                if (tc.function?.name) {
                  pending.name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  pending.arguments += tc.function.arguments;
                }
              }
            }
          } catch {
            // 忽略解析失败的行
          }
        }
      }

      // 如果没有收到 [DONE]，也要输出累积的 function calls
      for (const [, tc] of pendingToolCalls) {
        if (tc.name) {
          yield this._functionCallToXml(tc.name, tc.arguments);
          logger.info('DeepSeek 流式工具调用完成（无 DONE）', { name: tc.name });
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 补全请求
   */
  async complete(prompt, options = {}) {
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  /**
   * 获取模型信息
   */
  getModelInfo() {
    return {
      name: this.model,
      type: 'deepseek',
      hasApiKey: !!this.apiKey,
      supportedModels: SUPPORTED_MODELS,
    };
  }
}

module.exports = {
  DeepSeekProvider,
  SUPPORTED_MODELS,
  MODEL_CONTEXT_LIMITS,
};
