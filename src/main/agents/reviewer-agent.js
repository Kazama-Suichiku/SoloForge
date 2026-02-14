/**
 * SoloForge - Reviewer Agent
 * 对内容进行审核与改进
 * @module agents/reviewer-agent
 */

const { BaseAgent } = require('./base-agent');

/**
 * Reviewer Agent - 内容审核与改进 Agent
 */
class ReviewerAgent extends BaseAgent {
  /**
   * @param {import('../llm/llm-manager').LLMManager} llmManager - LLM 管理器实例
   */
  constructor(llmManager) {
    super('reviewer', 'Reviewer Agent', '对内容进行审核、改进，提供修改建议');
    if (!llmManager) {
      throw new Error('ReviewerAgent: 需要传入 llmManager');
    }
    this.llmManager = llmManager;
  }

  /**
   * 执行审核任务
   * @param {Record<string, unknown>} input - 上一个 Agent 输出，含 content
   * @param {{ taskId: string; isCancelled: () => boolean }} context - 执行上下文
   * @returns {Promise<Record<string, unknown>>} { originalContent, reviewedContent, suggestions }
   */
  async execute(input, context) {
    const content =
      (input && typeof input.content === 'string' && input.content) || '';

    if (!content.trim()) {
      throw new Error('ReviewerAgent: 需要提供 input.content（来自 Writer 的输出）');
    }

    if (context.isCancelled && context.isCancelled()) {
      throw new Error('任务已取消');
    }

    const messages = [
      {
        role: 'system',
        content: `你是一个专业的内容审核与编辑助手。请对用户提供的内容进行审核，并做必要的改进。
要求：
1. 分析原文的语法、措辞、逻辑与可读性
2. 输出改进后的完整内容（reviewedContent）
3. 以 JSON 格式返回，结构如下：
{
  "reviewedContent": "改进后的完整内容",
  "suggestions": ["建议1", "建议2", ...]
}
只输出 JSON，不要添加其他说明。`,
      },
      {
        role: 'user',
        content: `请审核并改进以下内容：\n\n${content}`,
      },
    ];

    const response = await this.llmManager.chat(messages);

    const rawContent =
      (response && typeof response.content === 'string' && response.content) ||
      '';

    let reviewedContent = content;
    let suggestions = [];

    try {
      const jsonStr = rawContent.trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.reviewedContent === 'string') {
          reviewedContent = parsed.reviewedContent;
        }
        if (Array.isArray(parsed.suggestions)) {
          suggestions = parsed.suggestions.filter((s) => typeof s === 'string');
        }
      }
    } catch {
      reviewedContent = rawContent.trim() || content;
      suggestions = ['未能解析结构化建议，已输出改进全文'];
    }

    return {
      originalContent: content,
      reviewedContent,
      suggestions,
      metadata: {
        model: response?.model,
        reviewedAt: new Date().toISOString(),
      },
    };
  }
}

module.exports = { ReviewerAgent };
