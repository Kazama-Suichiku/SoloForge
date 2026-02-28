/**
 * 聊天管理器 - App 端实现
 */

import { storage } from '../storage';
import { llm, Message } from '../llm';
import { getToolsForAgent, toolExecutor } from '../tools';
import { Agent, DEFAULT_AGENTS, getAgentSystemPrompt } from '../config/agents';

export interface Conversation {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolCalls?: any[];
  toolCallId?: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onToolResult?: (toolName: string, result: any) => void;
  onComplete: (message: ChatMessage) => void;
  onError: (error: Error) => void;
}

class ChatManager {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // 初始化 LLM
    await llm.initialize();
    
    // 初始化默认 Agents
    const agents = await storage.getAgents();
    if (agents.length === 0) {
      await storage.setAgents(DEFAULT_AGENTS);
    }
    
    this.initialized = true;
  }

  async getAgents(): Promise<Agent[]> {
    const agents = await storage.getAgents();
    return agents.length > 0 ? agents : DEFAULT_AGENTS;
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    const agents = await this.getAgents();
    return agents.find(a => a.id === agentId) || null;
  }

  async getConversations(): Promise<Conversation[]> {
    return await storage.getConversations();
  }

  async getOrCreateConversation(agentId: string): Promise<Conversation> {
    const conversations = await storage.getConversations();
    
    console.log('[ChatManager] 查找会话, agentId:', agentId);
    console.log('[ChatManager] 现有会话数:', conversations.length);
    conversations.forEach(c => console.log('  -', c.id, c.agentId));
    
    // 查找现有对话
    let conv = conversations.find(c => c.agentId === agentId);
    
    if (!conv) {
      console.log('[ChatManager] 未找到现有会话，创建新会话');
      // 创建新对话
      const agent = await this.getAgent(agentId);
      conv = {
        id: `conv-${Date.now()}`,
        agentId,
        title: agent?.name || agentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      conversations.push(conv);
      await storage.setConversations(conversations);
    } else {
      console.log('[ChatManager] 找到现有会话:', conv.id);
    }
    
    return conv;
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const messages = await storage.getMessages(conversationId);
    console.log('[ChatManager] 获取消息, conversationId:', conversationId, '消息数:', messages.length);
    return messages;
  }

  async sendMessage(
    conversationId: string,
    agentId: string,
    content: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      callbacks.onError(new Error('Agent 不存在'));
      return;
    }

    const bossConfig = await storage.getBossConfig();
    const messages = await storage.getMessages(conversationId);

    // 添加用户消息
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    messages.push(userMessage);
    await storage.setMessages(conversationId, messages);

    // 构建 LLM 消息（过滤掉 tool 相关消息，避免 API 报错）
    const recentMessages = messages.slice(-20)
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content || '(无内容)',
      }));

    const llmMessages: Message[] = [
      {
        role: 'system',
        content: getAgentSystemPrompt(agent, bossConfig.name),
      },
      ...recentMessages,
    ];

    const agentTools = getToolsForAgent(agentId, agent.role);
    let fullContent = '';
    let pendingToolCalls: any[] = [];

    try {
      await llm.chatStream(
        llmMessages,
        { tools: agentTools, stream: true },
        {
          onToken: (token) => {
            fullContent += token;
            callbacks.onToken(token);
          },
          onToolCall: (toolCall) => {
            pendingToolCalls.push(toolCall);
          },
          onComplete: async (content, usage) => {
            // 记录 Token 使用
            if (usage) {
              await this.recordTokenUsage(agentId, usage);
            }

            // 处理工具调用
            if (pendingToolCalls.length > 0) {
              await this.handleToolCalls(
                conversationId,
                agentId,
                pendingToolCalls,
                messages,
                callbacks
              );
            } else {
              // 保存助手消息
              const assistantMessage: ChatMessage = {
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content: fullContent,
                timestamp: new Date().toISOString(),
              };
              messages.push(assistantMessage);
              await storage.setMessages(conversationId, messages);

              // 更新对话时间
              await this.updateConversationTime(conversationId);

              callbacks.onComplete(assistantMessage);
            }
          },
          onError: callbacks.onError,
        }
      );
    } catch (error) {
      callbacks.onError(error as Error);
    }
  }

  private async handleToolCalls(
    conversationId: string,
    agentId: string,
    toolCalls: any[],
    messages: ChatMessage[],
    callbacks: StreamCallbacks
  ): Promise<void> {
    const agent = await this.getAgent(agentId);
    const bossConfig = await storage.getBossConfig();

    // 添加助手消息（带工具调用）
    const assistantMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      toolCalls,
    };
    messages.push(assistantMessage);

    // 执行每个工具
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name;
      let args = {};
      
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}');
      } catch {}

      callbacks.onToolCall?.(toolName, args);

      const result = await toolExecutor.execute(toolName, args, { agentId });
      
      callbacks.onToolResult?.(toolName, result);

      // 添加工具结果消息
      const toolMessage: ChatMessage = {
        id: `msg-${Date.now()}-tool`,
        role: 'tool',
        content: JSON.stringify(result.result || { error: result.error }),
        timestamp: new Date().toISOString(),
        toolCallId: toolCall.id,
      };
      messages.push(toolMessage);
    }

    await storage.setMessages(conversationId, messages);

    // 继续对话，让 LLM 根据工具结果回复
    const llmMessages: Message[] = [
      {
        role: 'system',
        content: getAgentSystemPrompt(agent!, bossConfig.name),
      },
      ...messages.slice(-30).map(m => ({
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
        tool_calls: m.toolCalls,
        tool_call_id: m.toolCallId,
      })),
    ];

    let fullContent = '';

    await llm.chatStream(
      llmMessages,
      { stream: true },
      {
        onToken: (token) => {
          fullContent += token;
          callbacks.onToken(token);
        },
        onComplete: async (content, usage) => {
          if (usage) {
            await this.recordTokenUsage(agentId, usage);
          }

          const finalMessage: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: fullContent,
            timestamp: new Date().toISOString(),
          };
          messages.push(finalMessage);
          await storage.setMessages(conversationId, messages);
          await this.updateConversationTime(conversationId);

          callbacks.onComplete(finalMessage);
        },
        onError: callbacks.onError,
      }
    );
  }

  private async recordTokenUsage(agentId: string, usage: any): Promise<void> {
    const tokenUsage = await storage.getTokenUsage();
    const totalTokens = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
    
    tokenUsage.total = (tokenUsage.total || 0) + totalTokens;
    tokenUsage.byAgent = tokenUsage.byAgent || {};
    tokenUsage.byAgent[agentId] = (tokenUsage.byAgent[agentId] || 0) + totalTokens;
    
    await storage.setTokenUsage(tokenUsage);
  }

  private async updateConversationTime(conversationId: string): Promise<void> {
    const conversations = await storage.getConversations();
    const conv = conversations.find(c => c.id === conversationId);
    if (conv) {
      conv.updatedAt = new Date().toISOString();
      await storage.setConversations(conversations);
    }
  }
}

export const chatManager = new ChatManager();
