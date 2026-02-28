/**
 * 桌面版数据导入服务
 * 通过读取导出的 JSON 文件来导入数据
 * 支持桌面版和手机版两种数据格式
 */

import { storage } from '../storage';
import { Agent } from '../config/agents';

export interface ImportData {
  // 手机版格式
  agents?: Agent[] | Record<string, any>;
  conversations?: any[];
  messages?: Record<string, any[]>;
  bossConfig?: { name: string; avatar: string; avatarThumb?: string; avatarFull?: string };
  memory?: any[];
  apiKey?: string;
  // 桌面版格式
  chatHistory?: any;
  accounts?: any;
  // 完整桌面版格式
  departments?: Record<string, any>;
  operations?: any;
  budgets?: any;
  tokenUsage?: any;
  permissions?: any;
  projects?: any;
  agentRequests?: any;
  terminationRequests?: any;
  agentCommunications?: any;
  agentTodos?: any[];
}

export interface ImportResult {
  success: boolean;
  stats: {
    agents: number;
    conversations: number;
    messages: number;
    memory: number;
  };
  error?: string;
}

class ImportService {
  /**
   * 从 JSON 字符串导入数据
   */
  async importFromJson(jsonString: string): Promise<ImportResult> {
    const stats = { agents: 0, conversations: 0, messages: 0, memory: 0 };

    try {
      const data: ImportData = JSON.parse(jsonString);

      // 导入 Agents（支持数组和对象两种格式）
      if (data.agents) {
        const existingAgents = await storage.getAgents();
        const newAgents = [...existingAgents];
        
        // 将 agents 转换为数组（桌面版是对象格式）
        let agentList: any[] = [];
        if (Array.isArray(data.agents)) {
          agentList = data.agents;
        } else if (typeof data.agents === 'object') {
          // 桌面版格式：{ "secretary": {...}, "ceo": {...} }
          agentList = Object.values(data.agents);
        }
        
        for (const agent of agentList) {
          if (!agent || !agent.id) continue;
          
          const existingIndex = newAgents.findIndex(a => a.id === agent.id);
          const normalizedAgent = this.normalizeAgent(agent);
          
          if (existingIndex !== -1) {
            // 更新已有 Agent（覆盖桌面版数据）
            newAgents[existingIndex] = normalizedAgent;
          } else {
            // 添加新 Agent
            newAgents.push(normalizedAgent);
          }
          stats.agents++;
        }
        
        await storage.setAgents(newAgents);
      }

      // 导入会话
      if (data.conversations && Array.isArray(data.conversations)) {
        console.log('[Import] 导入会话，数量:', data.conversations.length);
        const existingConvs = await storage.getConversations();
        const newConvs = [...existingConvs];
        
        for (const conv of data.conversations) {
          const exists = newConvs.find(c => c.id === conv.id);
          if (!exists) {
            console.log('[Import] 添加会话:', conv.id, conv.agentId);
            newConvs.push({
              id: conv.id,
              agentId: conv.agentId,
              title: conv.title || conv.agentId,
              createdAt: conv.createdAt || new Date().toISOString(),
              updatedAt: conv.updatedAt || new Date().toISOString(),
            });
            stats.conversations++;
          }
        }
        
        console.log('[Import] 保存会话总数:', newConvs.length);
        await storage.setConversations(newConvs);
      }

      // 导入消息（手机版格式）
      if (data.messages && typeof data.messages === 'object') {
        console.log('[Import] 导入消息，会话数:', Object.keys(data.messages).length);
        for (const [convId, msgs] of Object.entries(data.messages)) {
          if (Array.isArray(msgs) && msgs.length > 0) {
            console.log('[Import] 会话', convId, '消息数:', msgs.length);
            const existingMsgs = await storage.getMessages(convId);
            const newMsgs = [...existingMsgs];
            
            for (const msg of msgs) {
              const exists = newMsgs.find(m => m.id === msg.id);
              if (!exists) {
                newMsgs.push({
                  id: msg.id || `msg-${Date.now()}-${Math.random()}`,
                  role: msg.role,
                  content: msg.content,
                  timestamp: msg.timestamp || new Date().toISOString(),
                });
                stats.messages++;
              }
            }
            
            console.log('[Import] 保存消息到', convId, '总数:', newMsgs.length);
            await storage.setMessages(convId, newMsgs);
          }
        }
      }

      // 导入桌面版 chatHistory 格式
      if (data.chatHistory && typeof data.chatHistory === 'object') {
        const existingConvs = await storage.getConversations();
        const newConvs = [...existingConvs];
        
        // 桌面版格式: { "agentId": { messages: [...], lastUpdated: ... } }
        for (const [agentId, chatData] of Object.entries(data.chatHistory)) {
          if (!chatData || typeof chatData !== 'object') continue;
          
          const chat = chatData as { messages?: any[]; lastUpdated?: string };
          const convId = `conv-${agentId}`;
          
          // 创建或更新会话
          let conv = newConvs.find(c => c.agentId === agentId);
          if (!conv) {
            conv = {
              id: convId,
              agentId,
              title: agentId,
              createdAt: new Date().toISOString(),
              updatedAt: chat.lastUpdated || new Date().toISOString(),
            };
            newConvs.push(conv);
            stats.conversations++;
          }
          
          // 导入消息
          if (chat.messages && Array.isArray(chat.messages)) {
            const existingMsgs = await storage.getMessages(conv.id);
            const newMsgs = [...existingMsgs];
            
            for (const msg of chat.messages) {
              if (!msg || !msg.content) continue;
              const msgId = msg.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              const exists = newMsgs.find(m => m.id === msgId);
              if (!exists) {
                newMsgs.push({
                  id: msgId,
                  role: msg.role || 'user',
                  content: msg.content,
                  timestamp: msg.timestamp || new Date().toISOString(),
                });
                stats.messages++;
              }
            }
            
            await storage.setMessages(conv.id, newMsgs);
          }
        }
        
        await storage.setConversations(newConvs);
      }

      // 导入 Boss 配置（保留所有头像字段）
      if (data.bossConfig) {
        const bossConfig: any = {
          name: data.bossConfig.name || '老板',
          avatar: this.normalizeAvatar(data.bossConfig.avatar) || '👑',
        };
        // 保留缩略图和高清头像
        if (data.bossConfig.avatarThumb) {
          bossConfig.avatarThumb = data.bossConfig.avatarThumb;
        }
        if (data.bossConfig.avatarFull) {
          bossConfig.avatarFull = data.bossConfig.avatarFull;
        }
        await storage.setBossConfig(bossConfig);
      }

      // 导入桌面版 accounts 格式（获取 Boss 信息）
      if (data.accounts && typeof data.accounts === 'object') {
        // 桌面版格式: { boss: { name, avatar, ... }, ... }
        const accounts = data.accounts as { boss?: { name?: string; avatar?: string } };
        if (accounts.boss) {
          const avatar = accounts.boss.avatar;
          let normalizedAvatar = '👑';
          if (avatar && typeof avatar === 'string') {
            if (!avatar.startsWith('/') && !avatar.startsWith('file://') && !avatar.includes('.soloforge')) {
              normalizedAvatar = avatar;
            }
          }
          const bossConfig = {
            name: accounts.boss.name || '老板',
            avatar: normalizedAvatar,
          };
          await storage.setBossConfig(bossConfig);
        }
      }

      // 导入记忆
      if (data.memory && Array.isArray(data.memory)) {
        const existingMemory = await storage.getMemory();
        const newMemory = [...existingMemory, ...data.memory];
        await storage.setMemory(newMemory);
        stats.memory = data.memory.length;
      }

      // 导入 API Key
      if (data.apiKey) {
        await storage.setApiKey(data.apiKey);
      }

      // 导入部门配置
      if (data.departments) {
        await storage.setData('departments', data.departments);
      }

      // 导入运营数据
      if (data.operations) {
        await storage.setData('operations', data.operations);
      }

      // 导入预算数据
      if (data.budgets) {
        await storage.setData('budgets', data.budgets);
      }

      // 导入 Token 使用数据
      if (data.tokenUsage) {
        await storage.setData('tokenUsage', data.tokenUsage);
      }

      // 导入权限配置
      if (data.permissions) {
        await storage.setData('permissions', data.permissions);
      }

      // 导入项目数据
      if (data.projects) {
        await storage.setData('projects', data.projects);
      }

      // 导入 Agent 请求
      if (data.agentRequests) {
        await storage.setData('agentRequests', data.agentRequests);
      }

      // 导入解雇请求
      if (data.terminationRequests) {
        await storage.setData('terminationRequests', data.terminationRequests);
      }

      // 导入 Agent 通讯记录
      if (data.agentCommunications) {
        await storage.setData('agentCommunications', data.agentCommunications);
      }

      // 导入 Agent Todos
      if (data.agentTodos) {
        await storage.setData('agentTodos', data.agentTodos);
      }

      return { success: true, stats };
    } catch (error) {
      return {
        success: false,
        stats,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 标准化 Agent 数据（保留所有桌面版字段）
   */
  private normalizeAgent(agent: any): Agent {
    const normalized: any = {
      id: agent.id,
      name: agent.name || agent.id,
      role: agent.role || 'agent',
      title: agent.title || '员工',
      level: agent.level || 'employee',
      department: this.normalizeDepartment(agent.department),
      description: agent.description || '',
      avatar: this.normalizeAvatar(agent.avatar),
      model: agent.model || 'deepseek-chat',
      systemPrompt: agent.systemPrompt,
      status: agent.status || 'active',
      reportsTo: agent.reportsTo,
    };

    // 保留多部门信息
    if (agent.departments && Array.isArray(agent.departments)) {
      normalized.departments = agent.departments;
    }

    // 保留缩略图和高清头像
    if (agent.avatarThumb) {
      normalized.avatarThumb = agent.avatarThumb;
    }
    if (agent.avatarFull) {
      normalized.avatarFull = agent.avatarFull;
    }

    // 保留薪资信息
    if (agent.salary) {
      normalized.salary = agent.salary;
    }

    // 保留入职日期等
    if (agent.hireDate) {
      normalized.hireDate = agent.hireDate;
    }
    if (agent.probationEndDate) {
      normalized.probationEndDate = agent.probationEndDate;
    }
    if (agent.onboardingProgress !== undefined) {
      normalized.onboardingProgress = agent.onboardingProgress;
    }

    return normalized as Agent;
  }

  /**
   * 标准化头像
   * 支持: Base64 图片、http/https URL、emoji
   * 不支持: 本地文件路径（转为 emoji）
   */
  private normalizeAvatar(avatar: any): string {
    if (!avatar) return '👤';
    if (typeof avatar !== 'string') return '👤';
    
    // 如果是 Base64 图片数据，直接保留
    if (avatar.startsWith('data:image/')) {
      return avatar;
    }
    
    // 如果是 http/https URL，保留
    if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
      return avatar;
    }
    
    // 如果是本地文件路径，无法在手机上显示，转为 emoji
    if (avatar.startsWith('/') || avatar.startsWith('file://') || avatar.includes('.soloforge')) {
      return '👤';
    }
    
    // 其他情况（emoji 等），保留
    return avatar;
  }

  /**
   * 标准化部门名称
   */
  private normalizeDepartment(dept: any): string {
    if (!dept) return 'general';
    if (typeof dept === 'string') return dept;
    if (Array.isArray(dept)) return dept[0] || 'general';
    return 'general';
  }

  /**
   * 生成导出数据
   */
  async exportData(): Promise<string> {
    const agents = await storage.getAgents();
    const conversations = await storage.getConversations();
    const bossConfig = await storage.getBossConfig();
    const memory = await storage.getMemory();
    const apiKey = await storage.getApiKey();

    // 获取所有消息
    const messages: Record<string, any[]> = {};
    for (const conv of conversations) {
      const msgs = await storage.getMessages(conv.id);
      if (msgs.length > 0) {
        messages[conv.id] = msgs;
      }
    }

    const exportData: ImportData = {
      agents,
      conversations,
      messages,
      bossConfig,
      memory,
      apiKey: apiKey || undefined,
    };

    return JSON.stringify(exportData, null, 2);
  }
}

export const importService = new ImportService();
