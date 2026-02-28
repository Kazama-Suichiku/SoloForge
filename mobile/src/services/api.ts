/**
 * API 服务层
 * 与 Express.js 后端通信
 */

import { Agent, Message, Conversation } from '../types';
import { config } from '../config';

// 从配置文件获取 API 地址
const BASE_URL = config.API_BASE_URL;

interface StreamCallbacks {
  onToken?: (token: string) => void;
  onComplete?: (response: string) => void;
  onError?: (error: Error) => void;
}

interface BossConfig {
  name: string;
  avatar: string;
}

interface ImportResult {
  success: boolean;
  stats: {
    agents: { imported: number; skipped: number; errors: number };
    conversations: { imported: number; skipped: number; errors: number };
    bossConfig: { imported: boolean };
  };
  errors: string[];
}

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * 获取老板配置
   */
  async getBossConfig(): Promise<BossConfig> {
    try {
      const response = await fetch(`${this.baseUrl}/config/boss`);
      const data = await response.json();
      if (data.success) {
        return data.boss;
      }
      throw new Error(data.error || 'Failed to get boss config');
    } catch (error) {
      console.error('getBossConfig error:', error);
      return { name: '老板', avatar: '👑' };
    }
  }

  /**
   * 更新老板配置
   */
  async updateBossConfig(updates: Partial<BossConfig>): Promise<BossConfig> {
    const response = await fetch(`${this.baseUrl}/config/boss`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await response.json();
    if (data.success) {
      return data.boss;
    }
    throw new Error(data.error || 'Failed to update boss config');
  }

  /**
   * 创建新 Agent
   */
  async createAgent(agentData: Partial<Agent>): Promise<Agent> {
    const response = await fetch(`${this.baseUrl}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentData),
    });
    const data = await response.json();
    if (data.success) {
      return data.agent;
    }
    throw new Error(data.error || 'Failed to create agent');
  }

  /**
   * 更新 Agent
   */
  async updateAgent(agentId: string, updates: Partial<Agent>): Promise<Agent> {
    const response = await fetch(`${this.baseUrl}/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await response.json();
    if (data.success) {
      return data.agent;
    }
    throw new Error(data.error || 'Failed to update agent');
  }

  /**
   * 删除 Agent
   */
  async deleteAgent(agentId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/agents/${agentId}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to delete agent');
    }
  }

  /**
   * 从桌面版导入数据
   */
  async importFromDesktop(dataPath: string): Promise<ImportResult> {
    const response = await fetch(`${this.baseUrl}/import/desktop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataPath }),
    });
    return await response.json();
  }

  /**
   * 获取所有 Agents
   */
  async getAgents(): Promise<Agent[]> {
    try {
      const response = await fetch(`${this.baseUrl}/agents`);
      const data = await response.json();
      if (data.success) {
        return data.agents;
      }
      throw new Error(data.error || 'Failed to get agents');
    } catch (error) {
      console.error('getAgents error:', error);
      return [];
    }
  }

  /**
   * 获取所有会话
   */
  async getConversations(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/conversations`);
      const data = await response.json();
      if (data.success) {
        return data.conversations;
      }
      return [];
    } catch (error) {
      console.error('getConversations error:', error);
      return [];
    }
  }

  /**
   * 获取单个 Agent
   */
  async getAgent(agentId: string): Promise<Agent | null> {
    try {
      const response = await fetch(`${this.baseUrl}/agents/${agentId}`);
      const data = await response.json();
      if (data.success) {
        return data.agent;
      }
      return null;
    } catch (error) {
      console.error('getAgent error:', error);
      return null;
    }
  }

  /**
   * 获取会话历史
   */
  async getHistory(conversationId: string): Promise<Message[]> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/history/${conversationId}`);
      const data = await response.json();
      if (data.success) {
        return data.messages;
      }
      return [];
    } catch (error) {
      console.error('getHistory error:', error);
      return [];
    }
  }

  /**
   * 发送消息（流式响应）
   */
  async sendMessageStream(
    agentId: string,
    message: string,
    conversationId?: string,
    callbacks: StreamCallbacks = {}
  ): Promise<void> {
    const { onToken, onComplete, onError } = callbacks;

    try {
      const response = await fetch(`${this.baseUrl}/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId,
          message,
          conversationId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      // 读取 SSE 流
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data = line.slice(6);
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'token') {
              fullContent += parsed.content;
              onToken?.(parsed.content);
            } else if (parsed.type === 'complete') {
              onComplete?.(parsed.content || fullContent);
              return;
            } else if (parsed.type === 'error') {
              onError?.(new Error(parsed.error));
              return;
            }
          } catch (e) {
            console.warn('Parse SSE data error:', e);
          }
        }
      }

      // 流结束但没有收到 complete 事件
      if (fullContent) {
        onComplete?.(fullContent);
      }
    } catch (error) {
      console.error('sendMessageStream error:', error);
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 发送消息（非流式，用于简单场景）
   */
  async sendMessage(
    agentId: string,
    message: string,
    conversationId?: string
  ): Promise<{ response: string; conversationId: string }> {
    return new Promise((resolve, reject) => {
      let result = '';
      let convId = conversationId;

      this.sendMessageStream(agentId, message, conversationId, {
        onToken: (token) => {
          result += token;
        },
        onComplete: (response) => {
          resolve({
            response,
            conversationId: convId || '',
          });
        },
        onError: (error) => {
          reject(error);
        },
      });
    });
  }
}

export const api = new ApiService(BASE_URL);
