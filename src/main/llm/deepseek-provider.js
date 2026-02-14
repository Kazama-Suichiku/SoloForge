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

    logger.info('DeepSeek API 请求', { model, messagesCount: messages.length });

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
    const content = choice?.message?.content ?? '';

    // DeepSeek-R1 的推理链在 reasoning_content 字段
    const reasoningContent = choice?.message?.reasoning_content;

    const result = {
      content,
      model: data.model,
      usage: data.usage ? {
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

    logger.info('DeepSeek 流式请求', { model, messagesCount: messages.length });

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
            logger.info('DeepSeek 流式收到 [DONE]');
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

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
            // DeepSeek-R1 的推理链在流式中通过 reasoning_content 传递
            // 目前不输出推理链，只输出最终结果
          } catch {
            // 忽略解析失败的行
          }
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
