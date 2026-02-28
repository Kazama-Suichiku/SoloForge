/**
 * LLM Provider 抽象基类
 */

class LLMProvider {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
  }

  async chat(messages, options = {}) {
    throw new Error('chat() must be implemented by subclass');
  }

  async complete(prompt, options = {}) {
    throw new Error('complete() must be implemented by subclass');
  }

  getModelInfo() {
    throw new Error('getModelInfo() must be implemented by subclass');
  }
}

module.exports = { LLMProvider };
