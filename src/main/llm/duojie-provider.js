/**
 * SoloForge - Duojie Provider
 * 拼好饭中转站 API，支持 OpenAI 和 Anthropic 协议
 * 参考：Houdini Agent 项目的实现
 * @module llm/duojie-provider
 */

const { LLMProvider } = require('./llm-provider');

// 使用 Anthropic 协议的模型（Claude 系列 + GLM 系列）
// Claude 使用 Anthropic 协议可以避免代理层通过 OpenAI 协议注入的默认身份
const ANTHROPIC_MODELS = new Set([
  'claude-sonnet-4-5',
  'claude-opus-4-5-kiro',
  'claude-opus-4-5-max',
  'claude-opus-4-6-normal',
  'claude-opus-4-6-kiro',
  'claude-haiku-4-5',
  'glm-4.7',
  'glm-5',
]);

// Duojie 支持的模型列表（对齐 Houdini Agent）
const SUPPORTED_MODELS = [
  // Claude 系列
  'claude-sonnet-4-5',
  'claude-opus-4-5-kiro',
  'claude-opus-4-5-max',
  'claude-opus-4-6-normal',
  'claude-opus-4-6-kiro',
  'claude-haiku-4-5',
  // Gemini
  'gemini-3-pro-image-preview',
  // OpenAI
  'gpt-5.3-codex',
  // GLM（使用 Anthropic 协议）
  'glm-4.7',
  'glm-5',
];

// 模型上下文长度限制
const MODEL_CONTEXT_LIMITS = {
  'claude-sonnet-4-5': 200000,
  'claude-opus-4-5-kiro': 200000,
  'claude-opus-4-5-max': 200000,
  'claude-opus-4-6-normal': 200000,
  'claude-opus-4-6-kiro': 200000,
  'claude-haiku-4-5': 200000,
  'gemini-3-pro-image-preview': 128000,
  'gpt-5.3-codex': 200000,
  'glm-4.7': 200000,
  'glm-5': 200000,
};

class DuojieProvider extends LLMProvider {
  constructor(options = {}) {
    super('duojie', options);
    this.apiKey = options.apiKey || process.env.DUOJIE_API_KEY || '';
    this.model = options.model || process.env.DUOJIE_MODEL || 'claude-sonnet-4-5';
    this.baseUrl = 'https://api.duojie.games/v1';
    this._attachmentManager = null;
  }

  /**
   * 获取附件管理器（延迟加载避免循环依赖）
   */
  _getAttachmentManager() {
    if (!this._attachmentManager) {
      const { attachmentManager } = require('../attachments/attachment-manager');
      this._attachmentManager = attachmentManager;
    }
    return this._attachmentManager;
  }

  /**
   * 判断是否使用 Anthropic 协议
   * @param {string} model
   * @returns {boolean}
   */
  _isAnthropicProtocol(model) {
    return ANTHROPIC_MODELS.has(model?.toLowerCase());
  }

  /**
   * 合并连续相同角色的消息
   * Anthropic API 要求 user/assistant 严格交替，但工具循环中可能产生连续 user 消息
   * （如：tool results + next instruction 都是 user 角色）
   * 此方法将连续相同角色的消息合并为一条，用分隔符连接内容
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Array<{role: string, content: string}>}
   */
  _mergeConsecutiveMessages(messages) {
    if (!messages || messages.length === 0) return messages;

    const merged = [];
    for (const msg of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) {
        // 合并连续相同角色的消息（仅处理纯文本内容，多模态消息不合并）
        if (typeof last.content === 'string' && typeof msg.content === 'string') {
          last.content = last.content + '\n\n---\n\n' + msg.content;
        } else {
          // 多模态消息无法简单合并，直接追加（API 可能仍会报错，但至少不会丢失内容）
          merged.push(msg);
        }
      } else {
        merged.push({ ...msg });
      }
    }
    return merged;
  }

  /**
   * 将内部工具定义转换为 Anthropic 原生工具格式
   * @param {Array<Object>} tools - 内部 ToolDefinition 列表
   * @returns {Array<Object>} Anthropic tools 格式
   */
  _convertToolsToAnthropic(tools) {
    if (!tools || tools.length === 0) return [];
    return tools.map(tool => ({
      name: tool.name,
      description: (tool.description || '').slice(0, 1024), // Anthropic 对描述长度有限制
      input_schema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters || {}).map(([name, param]) => [
            name,
            {
              type: param.type === 'boolean' ? 'boolean'
                : param.type === 'number' || param.type === 'integer' ? 'number'
                : 'string',
              description: param.description || '',
            },
          ])
        ),
        required: Object.entries(tool.parameters || {})
          .filter(([, param]) => param.required)
          .map(([name]) => name),
      },
    }));
  }

  /**
   * 将 Anthropic tool_use 响应转换为内部 XML 格式
   * 下游的 tool-executor 解析 <tool_call> XML 标签来识别工具调用
   * @param {string} name - 工具名称
   * @param {Object} input - 工具参数
   * @returns {string} XML 格式的工具调用
   */
  _toolUseToXml(name, input) {
    const args = Object.entries(input || {})
      .map(([k, v]) => {
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `    <${k}>${val}</${k}>`;
      })
      .join('\n');
    return `\n<tool_call>\n  <name>${name}</name>\n  <arguments>\n${args}\n  </arguments>\n</tool_call>\n`;
  }

  /**
   * 获取 API URL
   * @param {string} model
   * @returns {string}
   */
  _getApiUrl(model) {
    if (this._isAnthropicProtocol(model)) {
      return `${this.baseUrl}/messages`;
    }
    return `${this.baseUrl}/chat/completions`;
  }

  /**
   * 将内部多模态消息格式转换为 API 规范格式
   * 内部格式：content: [{ type: 'text', text }, { type: 'image', path, mimeType }]
   * OpenAI 格式：content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: 'data:...' } }]
   * Anthropic 格式：content: [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type, data } }]
   * @param {Array} messages
   * @param {boolean} isAnthropic
   * @returns {Array}
   */
  _normalizeMessages(messages, isAnthropic) {
    return messages.map((msg) => {
      // 只处理 content 为数组（多模态）的消息
      if (!Array.isArray(msg.content)) return msg;

      const normalizedContent = msg.content.map((part) => {
        if (part.type === 'text') {
          return part; // 文本部分不变
        }
        if (part.type === 'image' && part.path) {
          // 读取图片文件并转为 base64
          try {
            const am = this._getAttachmentManager();
            const { base64, mimeType } = am.getAttachmentAsBase64(part.path);

            if (isAnthropic) {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: base64,
                },
              };
            } else {
              return {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64}`,
                },
              };
            }
          } catch (err) {
            const { logger } = require('../utils/logger');
            logger.warn('读取图片附件失败，跳过:', part.path, err.message);
            return { type: 'text', text: `[图片加载失败: ${part.path}]` };
          }
        }
        return part;
      });

      return { ...msg, content: normalizedContent };
    });
  }

  /**
   * 发送对话请求
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} options
   * @param {boolean} [options.stream=false] - 是否使用流式输出
   * @param {boolean} [options.returnUsage=false] - 是否返回包含 token 用量的对象
   * @returns {Promise<string | AsyncGenerator<string> | { content: string, usage: {...} }>}
   */
  async chat(messages, options = {}) {
    // 如果请求流式输出，返回流式生成器
    if (options.stream) {
      return this.chatStream(messages, options);
    }

    const model = options.model || this.model;
    const url = this._getApiUrl(model);
    const isAnthropic = this._isAnthropicProtocol(model);

    // 预处理多模态消息（将内部图片格式转为 API 格式）
    const normalizedMessages = this._normalizeMessages(messages, isAnthropic);

    let body;
    let headers = {
      'Content-Type': 'application/json',
    };

    if (isAnthropic) {
      // Anthropic 协议
      headers['x-api-key'] = this.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      
      // 分离 system message
      const systemMsg = normalizedMessages.find(m => m.role === 'system');
      const otherMsgs = normalizedMessages.filter(m => m.role !== 'system');
      
      // 映射角色并合并连续相同角色的消息（工具循环中可能产生连续 user 消息）
      const mappedMsgs = otherMsgs.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));
      const mergedMsgs = this._mergeConsecutiveMessages(mappedMsgs);
      
      body = {
        model,
        messages: mergedMsgs,
        max_tokens: options.maxTokens || 8192,
      };
      
      if (systemMsg) {
        body.system = systemMsg.content;
      }

      // 原生工具调用：如果传入了工具定义，转换为 Anthropic 格式
      if (options.tools?.length > 0) {
        body.tools = this._convertToolsToAnthropic(options.tools);
      }
    } else {
      // OpenAI 协议
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      
      body = {
        model,
        messages: normalizedMessages,
        max_tokens: options.maxTokens || 8192,
        temperature: options.temperature ?? 0.7,
        stream: false, // 非流式请求（流式在方法开头已处理）
      };
    }

    const { logger } = require('../utils/logger');
    logger.info('Duojie API 请求', { url, model, messagesCount: normalizedMessages.length });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Duojie API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    logger.info('Duojie API 响应', { data: JSON.stringify(data).slice(0, 500) });

    // 提取 token 用量
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    if (data.usage) {
      // OpenAI 格式
      usage = {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      };
    } else if (isAnthropic && data.usage) {
      // Anthropic 格式
      usage = {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      };
    }

    let content;
    if (isAnthropic) {
      // Anthropic 响应格式：遍历所有 content block，拼接文本和工具调用
      let textParts = '';
      for (const block of data.content || []) {
        if (block.type === 'text') {
          textParts += block.text;
        } else if (block.type === 'tool_use') {
          // 原生工具调用：转换为内部 XML 格式，供下游 tool-executor 解析
          textParts += this._toolUseToXml(block.name, block.input);
        }
      }
      content = textParts || '';
    } else {
      // OpenAI 响应格式
      content = data.choices?.[0]?.message?.content || '';
    }

    // 如果请求返回用量信息，返回对象；否则保持向后兼容返回字符串
    if (options.returnUsage) {
      return { content, usage, model };
    }

    return content;
  }

  /**
   * 流式对话请求
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} options
   * @returns {AsyncGenerator<string>}
   */
  async *chatStream(messages, options = {}) {
    const model = options.model || this.model;
    const url = this._getApiUrl(model);
    const isAnthropic = this._isAnthropicProtocol(model);

    // 预处理多模态消息
    const normalizedMessages = this._normalizeMessages(messages, isAnthropic);

    let body;
    let headers = {
      'Content-Type': 'application/json',
    };

    if (isAnthropic) {
      headers['x-api-key'] = this.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      
      const systemMsg = normalizedMessages.find(m => m.role === 'system');
      const otherMsgs = normalizedMessages.filter(m => m.role !== 'system');
      
      // 映射角色并合并连续相同角色的消息（工具循环中可能产生连续 user 消息）
      const mappedMsgs = otherMsgs.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));
      const mergedMsgs = this._mergeConsecutiveMessages(mappedMsgs);
      
      body = {
        model,
        messages: mergedMsgs,
        max_tokens: options.maxTokens || 8192,
        stream: true,
      };
      
      if (systemMsg) {
        body.system = systemMsg.content;
      }

      // 原生工具调用：如果传入了工具定义，转换为 Anthropic 格式
      if (options.tools?.length > 0) {
        body.tools = this._convertToolsToAnthropic(options.tools);
      }
    } else {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      
      body = {
        model,
        messages: normalizedMessages,
        max_tokens: options.maxTokens || 8192,
        temperature: options.temperature ?? 0.7,
        stream: true,
      };
    }

    const { logger } = require('../utils/logger');
    logger.info('Duojie 流式请求', { url, model, messagesCount: normalizedMessages.length });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    logger.info('Duojie 流式响应状态', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Duojie API error: ${response.status} - ${error}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    // 原生工具调用的流式累积状态
    let currentToolUse = null;     // 当前正在累积的 tool_use 块 { name, id, index }
    let toolUseInputJson = '';     // 累积的 input JSON 字符串

    // 流式 usage 追踪（通过 options._streamUsage 传给调用方）
    const streamUsage = { promptTokens: 0, completionTokens: 0, model };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        logger.info('Duojie 流式完成', { totalChunks: chunkCount, usage: streamUsage });
        break;
      }
      chunkCount++;

      const rawChunk = decoder.decode(value, { stream: true });
      buffer += rawChunk;
      
      if (chunkCount <= 3) {
        logger.info('Duojie 流式收到数据块', { chunkNum: chunkCount, length: rawChunk.length, preview: rawChunk.slice(0, 200) });
      }
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') {
          logger.info('Duojie 流式收到 [DONE]', { usage: streamUsage });
          // 将 usage 写入 options 供调用方读取
          if (options._streamUsage) Object.assign(options._streamUsage, streamUsage);
          return;
        }

        try {
          const parsed = JSON.parse(data);
          
          if (isAnthropic) {
            // Anthropic SSE 格式

            // 0. 捕获 usage 数据（message_start → input_tokens, message_delta → output_tokens）
            if (parsed.type === 'message_start' && parsed.message?.usage) {
              streamUsage.promptTokens = parsed.message.usage.input_tokens || 0;
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              streamUsage.completionTokens = parsed.usage.output_tokens || 0;
            }

            // 1. 普通文本增量
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              yield parsed.delta.text || '';
            }

            // 2. 原生工具调用：content_block_start (type: tool_use)
            if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
              currentToolUse = {
                name: parsed.content_block.name,
                id: parsed.content_block.id,
                index: parsed.index,
              };
              toolUseInputJson = '';
              logger.info('Duojie 流式原生工具调用开始', { toolName: currentToolUse.name, index: parsed.index });
            }

            // 3. 原生工具调用：input_json_delta（增量 JSON）
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
              toolUseInputJson += parsed.delta.partial_json || '';
            }

            // 4. content_block_stop：匹配同一 index 的 tool_use 块，生成完整的 XML
            if (parsed.type === 'content_block_stop' && currentToolUse && parsed.index === currentToolUse.index) {
              let input = {};
              try {
                input = toolUseInputJson ? JSON.parse(toolUseInputJson) : {};
              } catch (jsonErr) {
                logger.warn('Duojie 工具调用 JSON 解析失败', {
                  tool: currentToolUse.name,
                  json: toolUseInputJson.slice(0, 200),
                  error: jsonErr.message,
                });
              }
              const xml = this._toolUseToXml(currentToolUse.name, input);
              logger.info('Duojie 流式原生工具调用完成', {
                toolName: currentToolUse.name,
                inputKeys: Object.keys(input),
              });
              yield xml;
              currentToolUse = null;
              toolUseInputJson = '';
            }
          } else {
            // OpenAI SSE 格式
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
            // OpenAI 流最后一个 chunk 可能包含 usage
            if (parsed.usage) {
              streamUsage.promptTokens = parsed.usage.prompt_tokens || 0;
              streamUsage.completionTokens = parsed.usage.completion_tokens || 0;
            }
          }
        } catch (parseErr) {
          logger.warn('Duojie 流式解析失败', { data: data.slice(0, 100), error: parseErr.message });
        }
      }
    }

    // while 循环通过 break 退出时，也写入 usage
    if (options._streamUsage) Object.assign(options._streamUsage, streamUsage);
  }

  /**
   * 补全请求
   * @param {string} prompt
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async complete(prompt, options = {}) {
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  /**
   * 获取模型信息
   * @returns {Object}
   */
  getModelInfo() {
    return {
      provider: 'duojie',
      name: '拼好饭中转站',
      model: this.model,
      description: '支持 Claude、Gemini、GPT、GLM 等多种模型的中转 API',
      supportedModels: SUPPORTED_MODELS,
      contextLimit: MODEL_CONTEXT_LIMITS[this.model] || 128000,
    };
  }

  /**
   * 获取支持的模型列表
   * @returns {string[]}
   */
  static getSupportedModels() {
    return SUPPORTED_MODELS;
  }

  /**
   * 获取模型上下文限制
   * @param {string} model
   * @returns {number}
   */
  static getContextLimit(model) {
    return MODEL_CONTEXT_LIMITS[model] || 128000;
  }
}

module.exports = { DuojieProvider, SUPPORTED_MODELS, MODEL_CONTEXT_LIMITS };
