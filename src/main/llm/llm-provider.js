/**
 * LLM Provider 抽象基类
 * 定义统一的 LLM 调用接口
 */

class LLMProvider {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
  }

  /**
   * 发送对话请求
   * @param {Array<{role: string, content: string}>} messages - 对话消息列表
   * @param {Object} options - 可选配置 { stream?: boolean }
   * @returns {Promise<{content: string, ...}> | AsyncGenerator} 非流式返回完整响应，流式返回 AsyncGenerator
   */
  async chat(messages, options = {}) {
    throw new Error('chat() must be implemented by subclass');
  }

  /**
   * 补全请求（单轮 prompt）
   * @param {string} prompt - 输入提示
   * @param {Object} options - 可选配置 { stream?: boolean }
   * @returns {Promise<{content: string, ...}> | AsyncGenerator} 非流式返回完整响应，流式返回 AsyncGenerator
   */
  async complete(prompt, options = {}) {
    throw new Error('complete() must be implemented by subclass');
  }

  /**
   * 获取模型信息
   * @returns {Object} { name, type, ... }
   */
  getModelInfo() {
    throw new Error('getModelInfo() must be implemented by subclass');
  }
}

module.exports = { LLMProvider };
