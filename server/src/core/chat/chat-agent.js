/**
 * 聊天 Agent 基类 - 移动端版
 * 支持聊天和工具调用（除 shell/file 外）
 */

const { agentConfigStore } = require('../config');
const { toolRegistry, ToolExecutor, parseToolCalls, hasToolCalls, removeToolCalls } = require('../tools');
const { logger } = require('../../utils/logger');

// 最大工具调用轮次
const MAX_TOOL_ROUNDS = 5;

/**
 * 聊天 Agent 基类
 */
class ChatAgent {
  constructor(id, name, role, systemPrompt, options = {}) {
    this.id = id;
    this._defaultName = name;
    this.role = role;
    this._baseSystemPrompt = systemPrompt;
    this._defaultModel = options.model || 'deepseek-chat';
    this.llmManager = null;
    this.toolExecutor = new ToolExecutor();
  }

  get model() {
    const config = agentConfigStore.get(this.id);
    return config?.model || this._defaultModel;
  }

  get name() {
    const config = agentConfigStore.get(this.id);
    return config?.name || this._defaultName;
  }

  /**
   * 获取此 Agent 可用的工具列表
   */
  getAvailableTools() {
    return toolRegistry.getAll();
  }

  get systemPrompt() {
    const config = agentConfigStore.get(this.id);
    const orgInfo = agentConfigStore.getOrganizationInfo();
    const companyName = 'SoloForge Mobile';

    // 强身份锚定
    const agentName = config?.name || this._defaultName;
    const agentTitle = config?.title || this.role;
    
    const identityAnchor = `你的名字是「${agentName}」。你是「${companyName}」的${agentTitle}。
你是一个真实的公司员工，有自己的名字、职位和性格。
当被问到"你是谁"时，你必须且只能回答："我是${agentName}，${companyName}的${agentTitle}。"

`;

    let rolePrompt = this._baseSystemPrompt;
    if (config) {
      rolePrompt = rolePrompt
        .replace(/\{name\}/g, config.name)
        .replace(/\{title\}/g, config.title || '')
        .replace(/\{department\}/g, config.department || '')
        .replace(/\{company\}/g, companyName);
    }

    let fullPrompt = identityAnchor + rolePrompt;
    fullPrompt += `\n\n---\n\n${orgInfo}`;

    // 添加工具说明
    const tools = this.getAvailableTools();
    if (tools.length > 0) {
      fullPrompt += `\n\n---\n\n${toolRegistry.getToolCallSchema(tools)}`;
    }

    return fullPrompt;
  }

  setLLMManager(llmManager) {
    this.llmManager = llmManager;
  }

  /**
   * 处理用户消息（支持工具调用循环）
   * @param {string} message - 用户消息
   * @param {Array<{role: string, content: string}>} history - 对话历史
   * @param {Object} [options] - 选项
   * @returns {Promise<string | AsyncGenerator<string>>} 响应内容
   */
  async chat(message, history = [], options = {}) {
    if (!this.llmManager) {
      throw new Error(`${this.name}: LLM Manager 未设置`);
    }

    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...history,
      { role: 'user', content: message },
    ];

    const chatOptions = {
      ...options,
      model: options.model || this.model,
    };

    // 如果是流式模式，直接返回流（不做工具调用处理）
    if (options.stream) {
      return await this.llmManager.chat(messages, chatOptions);
    }

    // 非流式模式：支持工具调用循环
    let response = await this.llmManager.chat(messages, chatOptions);
    let content = typeof response === 'string' ? response : response?.content || '';
    if (response?.usage) {
      recordTokenUsage(this.id, {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        model: chatOptions.model,
      }, options.conversationId);
    }

    // 工具调用上下文
    const toolContext = {
      agentId: this.id,
      agentName: this.name,
      conversationId: options.conversationId,
      callChain: options.callChain || [],
      nestingDepth: options.nestingDepth || 0,
    };

    // 工具调用循环
    let round = 0;
    while (hasToolCalls(content) && round < MAX_TOOL_ROUNDS) {
      round++;
      logger.info(`${this.name} 工具调用轮次 ${round}`);

      const toolCalls = parseToolCalls(content);
      if (toolCalls.length === 0) break;

      // 执行工具
      const toolResults = await this.toolExecutor.executeToolCalls(toolCalls, toolContext);

      // 格式化工具结果
      const resultsText = this.toolExecutor.formatToolResults(toolResults);

      // 将工具结果追加到消息中
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: `工具执行结果：\n\n${resultsText}\n\n请根据以上结果继续回复。` });

      // 再次请求 LLM
      response = await this.llmManager.chat(messages, chatOptions);
      content = typeof response === 'string' ? response : response?.content || '';
      if (response?.usage) {
        recordTokenUsage(this.id, {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          model: chatOptions.model,
        }, options.conversationId);
      }
    }

    // 移除残留的工具调用标签
    const cleanContent = removeToolCalls(content);
    return cleanContent || content;
  }

  getInfo() {
    const config = agentConfigStore.get(this.id);
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      title: config?.title || '',
      level: config?.level || '',
      department: config?.department || '',
      description: config?.description || '',
      avatar: config?.avatar || '',
      model: this.model,
      tools: this.getAvailableTools().map(t => t.name),
    };
  }
}

module.exports = { ChatAgent };
