/**
 * SoloForge - Writer Agent
 * 根据任务描述生成内容（邮件、文章等）
 * @module agents/writer-agent
 */

const { BaseAgent } = require('./base-agent');

/**
 * Writer Agent - 内容生成 Agent
 */
class WriterAgent extends BaseAgent {
  /**
   * @param {import('../llm/llm-manager').LLMManager} llmManager - LLM 管理器实例
   */
  constructor(llmManager) {
    super('writer', 'Writer Agent', '根据任务描述生成邮件、文章等内容');
    if (!llmManager) {
      throw new Error('WriterAgent: 需要传入 llmManager');
    }
    this.llmManager = llmManager;
  }

  /**
   * 执行内容生成任务
   * @param {Record<string, unknown>} input - 输入数据，含 prompt 或 task
   * @param {{ taskId: string; isCancelled: () => boolean }} context - 执行上下文
   * @returns {Promise<Record<string, unknown>>} { content, metadata }
   */
  async execute(input, context) {
    const taskDesc =
      (input && typeof input.prompt === 'string' && input.prompt) ||
      (input && typeof input.task === 'string' && input.task) ||
      '';

    if (!taskDesc.trim()) {
      throw new Error('WriterAgent: 需要提供 input.prompt 或 input.task');
    }

    if (context.isCancelled && context.isCancelled()) {
      throw new Error('任务已取消');
    }

    const messages = [
      {
        role: 'system',
        content:
          '你是一个专业的写作助手。根据用户给出的任务描述，生成相应内容（如邮件、文章、报告等）。输出应清晰、得体、符合场景。只输出最终内容，不要添加说明或元信息。',
      },
      {
        role: 'user',
        content: taskDesc,
      },
    ];

    const response = await this.llmManager.chat(messages);

    const content =
      (response && typeof response.content === 'string' && response.content) ||
      '';

    return {
      content: content.trim(),
      metadata: {
        model: response?.model,
        taskDesc,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

module.exports = { WriterAgent };
