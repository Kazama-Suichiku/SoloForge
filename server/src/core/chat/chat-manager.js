/**
 * 聊天管理器 - 移动端版
 * 支持工具调用和 Agent 间通信
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../../utils/logger');
const { llmManager } = require('../llm');
const { agentConfigStore } = require('../config');
const {
  CEOAgent,
  CTOAgent,
  CFOAgent,
  CHROAgent,
  SecretaryAgent,
} = require('./cxo-agents');

const DATA_DIR = path.join(__dirname, '../../../data');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');

class ChatManager {
  constructor() {
    this.agents = new Map();
    this.conversations = new Map();
    this._proactiveQueue = new Map(); // 主动消息队列
    this._initialized = false;
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  initialize() {
    if (this._initialized) return;
    
    this._ensureDataDir();

    // 初始化核心 Agents
    this._registerAgent(new SecretaryAgent());
    this._registerAgent(new CEOAgent());
    this._registerAgent(new CTOAgent());
    this._registerAgent(new CFOAgent());
    this._registerAgent(new CHROAgent());

    // 加载会话数据
    this._loadConversations();

    this._initialized = true;
    logger.info('ChatManager initialized', { agents: this.agents.size });
  }

  _registerAgent(agent) {
    agent.setLLMManager(llmManager);
    this.agents.set(agent.id, agent);
  }

  _loadConversations() {
    try {
      if (fs.existsSync(CONVERSATIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf-8'));
        for (const [id, conv] of Object.entries(data)) {
          this.conversations.set(id, conv);
        }
        logger.info('Conversations loaded', { count: this.conversations.size });
      }
    } catch (error) {
      logger.error('Failed to load conversations', error);
    }
  }

  _saveConversations() {
    try {
      this._ensureDataDir();
      const data = Object.fromEntries(this.conversations);
      fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save conversations', error);
    }
  }

  getAgent(agentId) {
    return this.agents.get(agentId) || null;
  }

  getAllAgents() {
    return Array.from(this.agents.values()).map((a) => a.getInfo());
  }

  createConversation(agentId, title) {
    const id = uuidv4();
    const conversation = {
      id,
      agentId,
      title: title || `与 ${this.getAgent(agentId)?.name || agentId} 的对话`,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.conversations.set(id, conversation);
    this._saveConversations();
    return conversation;
  }

  getConversation(conversationId) {
    return this.conversations.get(conversationId) || null;
  }

  getConversations() {
    return Array.from(this.conversations.values()).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
  }

  getHistory(conversationId) {
    const conv = this.conversations.get(conversationId);
    return conv?.messages || [];
  }

  /**
   * Agent 间通信：一个 Agent 给另一个 Agent 发消息
   */
  async processAgentMessage({ fromAgent, toAgent, message, conversationId, callChain = [], nestingDepth = 0, isTask = false, taskId = null }) {
    const targetAgent = this.getAgent(toAgent);
    if (!targetAgent) {
      throw new Error(`Agent ${toAgent} not found`);
    }

    const sourceAgent = this.getAgent(fromAgent);
    const sourceName = sourceAgent?.name || fromAgent;

    // 构建消息上下文
    const contextMessage = isTask
      ? `[任务委派] 来自 ${sourceName}:\n${message}`
      : `[来自 ${sourceName} 的消息]:\n${message}`;

    // 调用目标 Agent（非流式，支持工具调用）
    const response = await targetAgent.chat(contextMessage, [], {
      conversationId,
      callChain,
      nestingDepth,
      taskId,
    });

    return response;
  }

  /**
   * 推送主动汇报消息（Agent → 老板）
   */
  pushProactiveMessage(agentId, message) {
    const agent = this.getAgent(agentId);
    const agentName = agent?.name || agentId;
    
    const proactiveMessage = {
      id: uuidv4(),
      agentId,
      agentName,
      content: message,
      timestamp: new Date().toISOString(),
      type: 'proactive',
    };

    // 存入队列
    if (!this._proactiveQueue.has(agentId)) {
      this._proactiveQueue.set(agentId, []);
    }
    this._proactiveQueue.get(agentId).push(proactiveMessage);

    logger.info(`主动汇报消息已入队: ${agentName}`, { messageLength: message.length });
    
    return proactiveMessage;
  }

  /**
   * 获取并清空主动消息队列
   */
  popProactiveMessages(agentId) {
    const messages = this._proactiveQueue.get(agentId) || [];
    this._proactiveQueue.delete(agentId);
    return messages;
  }

  /**
   * 获取所有待处理的主动消息
   */
  getAllProactiveMessages() {
    const all = [];
    for (const [agentId, messages] of this._proactiveQueue) {
      all.push(...messages);
    }
    return all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  /**
   * 发送消息（流式响应）
   */
  async sendMessageStream(agentId, message, conversationId, callbacks = {}) {
    const { onToken, onComplete, onError } = callbacks;

    let agent = this.getAgent(agentId);
    if (!agent) {
      const config = agentConfigStore.get(agentId);
      if (!config) {
        onError?.(new Error(`Agent ${agentId} not found`));
        return;
      }
      agent = this.getAgent('secretary');
    }

    let conversation = conversationId ? this.getConversation(conversationId) : null;
    if (!conversation) {
      conversation = this.createConversation(agentId);
    }

    const history = conversation.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });

    try {
      const stream = await agent.chat(message, history, { 
        stream: true,
        conversationId: conversation.id,
      });

      let fullResponse = '';
      for await (const token of stream) {
        fullResponse += token;
        onToken?.(token);
      }

      conversation.messages.push({
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date().toISOString(),
        agentId: agent.id,
        agentName: agent.name,
      });

      conversation.updatedAt = new Date().toISOString();
      this._saveConversations();

      onComplete?.(fullResponse);
      
      return {
        response: fullResponse,
        conversationId: conversation.id,
      };
    } catch (error) {
      logger.error('Chat error', error);
      onError?.(error);
    }
  }

  /**
   * 发送消息（非流式，支持工具调用）
   */
  async sendMessage(agentId, message, conversationId) {
    let agent = this.getAgent(agentId);
    if (!agent) {
      agent = this.getAgent('secretary');
    }

    let conversation = conversationId ? this.getConversation(conversationId) : null;
    if (!conversation) {
      conversation = this.createConversation(agentId);
    }

    const history = conversation.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });

    const response = await agent.chat(message, history, {
      conversationId: conversation.id,
    });

    conversation.messages.push({
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
      agentId: agent.id,
      agentName: agent.name,
    });

    conversation.updatedAt = new Date().toISOString();
    this._saveConversations();

    return {
      response,
      conversationId: conversation.id,
      agentId: agent.id,
      agentName: agent.name,
    };
  }

  /**
   * 中止 Agent 任务（停职时使用）
   */
  _abortTask(agentId, reason) {
    logger.info(`Aborting tasks for agent ${agentId}: ${reason}`);
    // 移动端简化实现
  }
}

const chatManager = new ChatManager();

module.exports = { ChatManager, chatManager };
