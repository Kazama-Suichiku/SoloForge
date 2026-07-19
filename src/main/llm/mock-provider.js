/**
 * Mock LLM Provider
 * 用于离线测试或 LLM 不可用时的降级
 * 返回模拟数据，不依赖外部 API
 * @module llm/mock-provider
 */

const { LLMProvider } = require('./llm-provider');

/** 模拟响应内容 */
const MOCK_RESPONSES = {
  chat: '[Mock] 这是一条模拟的 LLM 回复。当前处于离线模式或 LLM 服务不可用，请检查 Ollama/OpenAI 连接后重试。',
  complete: '[Mock] 模拟补全结果。LLM 服务不可用，已启用降级模式。',
};

class MockProvider extends LLMProvider {
  constructor(options = {}) {
    super('mock', options);
  }

  /**
   * 是否已配置：mock 为最终降级占位，不参与主动探测，返回 false。
   * @returns {boolean}
   */
  isConfigured() {
    return false;
  }

  /**
   * 健康检查：mock 永远可用（无需任何外部依赖）。
   * @returns {Promise<{available: boolean, model?: string}>}
   */
  async checkHealth() {
    return { available: true, model: 'mock' };
  }

  /**
   * 模拟对话响应
   * 返回统一格式 { content, model, finish_reason }
   */
  async chat(messages, _options = {}) {
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    const userInput = lastUser?.content?.slice?.(0, 50) ?? '';

    return {
      content: `${MOCK_RESPONSES.chat}\n\n(用户输入摘要: ${userInput}${userInput.length >= 50 ? '...' : ''})`,
      model: 'mock',
      finish_reason: 'stop',
      done: true,
    };
  }

  /**
   * 模拟补全响应
   * 返回统一格式 { content, model, finish_reason }
   */
  async complete(prompt, _options = {}) {
    const promptPreview = String(prompt).slice(0, 50);

    return {
      content: `${MOCK_RESPONSES.complete}\n\n(Prompt: ${promptPreview}${promptPreview.length >= 50 ? '...' : ''})`,
      model: 'mock',
      finish_reason: 'stop',
      done: true,
    };
  }

  getModelInfo() {
    return {
      name: 'mock',
      type: 'mock',
      description: '离线/降级模式，返回模拟数据',
    };
  }
}

module.exports = { MockProvider };
