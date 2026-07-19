/**
 * LLM Provider 抽象基类
 * 定义统一的 LLM 调用接口、健康检查与配置状态接口。
 *
 * 统一返回类型约定（非流式 chat / complete）：
 *   {
 *     content: string,                                       // 模型输出正文（必需）
 *     model?: string,                                        // 实际响应模型 ID（可选）
 *     usage?: { prompt_tokens, completion_tokens, total_tokens }, // OpenAI 风格下划线字段（可选）
 *     finish_reason?: string,                               // 停止原因（可选）
 *     ...provider 扩展字段                                    // 如 reasoningContent / done 等
 *   }
 *
 * 各 provider 在非流式分支应始终返回上述对象；
 * usage 字段统一采用 OpenAI 风格的下划线命名（prompt_tokens / completion_tokens / total_tokens）。
 * 兼容字段（promptTokens / completionTokens / totalTokens）可在转换层提供，但新代码应直接使用下划线字段。
 */

class LLMProvider {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
  }

  /**
   * 发送对话请求
   * @param {Array<{role: string, content: string|Array}>} messages - 对话消息列表
   * @param {Object} options - 可选配置 { stream?: boolean, model?: string, maxTokens?: number, temperature?: number, tools?: Array, returnUsage?: boolean }
   * @returns {Promise<{content: string, model?: string, usage?: Object, finish_reason?: string} | AsyncGenerator<string>>}
   *   非流式返回完整响应对象；流式返回 AsyncGenerator<string>。
   */
  async chat(messages, options = {}) {
    throw new Error('chat() must be implemented by subclass');
  }

  /**
   * 补全请求（单轮 prompt）
   * @param {string} prompt - 输入提示
   * @param {Object} options - 可选配置 { stream?: boolean, model?: string, ... }
   * @returns {Promise<{content: string, model?: string, usage?: Object, finish_reason?: string} | AsyncGenerator<string>>}
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

  /**
   * 是否已配置：判断该 provider 是否具备足够凭据/环境值得被探测或纳入降级链。
   * 默认实现返回 true（视为应探测）；子类应按需覆盖。
   * 例：需 apiKey 的 provider 在 apiKey 为空时返回 false；
   *     本地服务（ollama / local-glm）始终返回 true；
   *     mock 返回 false（不参与探测）。
   * @returns {boolean}
   */
  isConfigured() {
    return true;
  }

  /**
   * 健康检查：探测 provider 当前是否可用。
   * 默认实现仅做一次轻量 chat 调用；子类应覆盖为更廉价的 GET（如 /v1/models、/api/tags）。
   * @returns {Promise<{available: boolean, error?: string, model?: string}>}
   *   - available: 是否可用
   *   - error: 不可用时的错误描述（available=false 时提供）
   *   - model: 可用时的模型 ID（available=true 时可选）
   */
  async checkHealth() {
    return { available: true };
  }
}

module.exports = { LLMProvider };
