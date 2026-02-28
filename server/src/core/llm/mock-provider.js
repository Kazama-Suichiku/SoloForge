/**
 * Mock Provider - 用于测试和降级
 */

const { LLMProvider } = require('./llm-provider');

class MockProvider extends LLMProvider {
  constructor(options = {}) {
    super('mock', options);
  }

  async chat(messages, _options = {}) {
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    const userInput = lastUser?.content?.slice?.(0, 50) ?? '';

    return {
      content: `[Mock] 模拟回复。当前 LLM 服务不可用。\n\n(用户: ${userInput})`,
      model: 'mock',
    };
  }

  async complete(prompt, _options = {}) {
    return {
      content: `[Mock] 模拟补全。(Prompt: ${String(prompt).slice(0, 50)})`,
      model: 'mock',
    };
  }

  getModelInfo() {
    return { name: 'mock', type: 'mock' };
  }
}

module.exports = { MockProvider };
