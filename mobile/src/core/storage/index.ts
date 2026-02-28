/**
 * 本地存储服务 - 使用 AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS: Record<string, string> = {
  AGENTS: '@soloforge/agents',
  CONVERSATIONS: '@soloforge/conversations',
  MESSAGES: '@soloforge/messages',
  BOSS_CONFIG: '@soloforge/boss_config',
  API_KEY: '@soloforge/api_key',
  MEMORY: '@soloforge/memory',
  TODOS: '@soloforge/todos',
  BUDGETS: '@soloforge/budgets',
  TOKEN_USAGE: '@soloforge/token_usage',
  OPERATIONS: '@soloforge/operations',
  DEPARTMENTS: '@soloforge/departments',
  PERMISSIONS: '@soloforge/permissions',
  PROJECTS: '@soloforge/projects',
  AGENT_REQUESTS: '@soloforge/agent_requests',
  TERMINATION_REQUESTS: '@soloforge/termination_requests',
  AGENT_COMMUNICATIONS: '@soloforge/agent_communications',
  AGENT_TODOS: '@soloforge/agent_todos',
};

class StorageService {
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await AsyncStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Storage get error [${key}]:`, error);
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Storage set error [${key}]:`, error);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error(`Storage remove error [${key}]:`, error);
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(key);
      return value !== null;
    } catch {
      return false;
    }
  }

  async getAgents(): Promise<any[]> {
    return (await this.get<any[]>(KEYS.AGENTS)) || [];
  }

  async setAgents(agents: any[]): Promise<void> {
    await this.set(KEYS.AGENTS, agents);
  }

  async getConversations(): Promise<any[]> {
    return (await this.get<any[]>(KEYS.CONVERSATIONS)) || [];
  }

  async setConversations(conversations: any[]): Promise<void> {
    await this.set(KEYS.CONVERSATIONS, conversations);
  }

  async getMessages(conversationId: string): Promise<any[]> {
    const allMessages = (await this.get<Record<string, any[]>>(KEYS.MESSAGES)) || {};
    return allMessages[conversationId] || [];
  }

  async setMessages(conversationId: string, messages: any[]): Promise<void> {
    const allMessages = (await this.get<Record<string, any[]>>(KEYS.MESSAGES)) || {};
    allMessages[conversationId] = messages;
    await this.set(KEYS.MESSAGES, allMessages);
  }

  async getBossConfig(): Promise<any> {
    return (await this.get(KEYS.BOSS_CONFIG)) || { name: '老板', avatar: '👑' };
  }

  async setBossConfig(config: any): Promise<void> {
    await this.set(KEYS.BOSS_CONFIG, config);
  }

  async getApiKey(): Promise<string | null> {
    return await this.get<string>(KEYS.API_KEY);
  }

  async setApiKey(key: string): Promise<void> {
    await this.set(KEYS.API_KEY, key);
  }

  async getMemory(): Promise<any[]> {
    return (await this.get<any[]>(KEYS.MEMORY)) || [];
  }

  async setMemory(memory: any[]): Promise<void> {
    await this.set(KEYS.MEMORY, memory);
  }

  async getTodos(): Promise<Record<string, any[]>> {
    return (await this.get<Record<string, any[]>>(KEYS.TODOS)) || {};
  }

  async setTodos(todos: Record<string, any[]>): Promise<void> {
    await this.set(KEYS.TODOS, todos);
  }

  async getTokenUsage(): Promise<any> {
    return (await this.get(KEYS.TOKEN_USAGE)) || { total: 0, byAgent: {}, byDay: {} };
  }

  async setTokenUsage(usage: any): Promise<void> {
    await this.set(KEYS.TOKEN_USAGE, usage);
  }

  async getOperations(): Promise<any> {
    return (await this.get(KEYS.OPERATIONS)) || { goals: [], tasks: [], kpis: [] };
  }

  async setOperations(ops: any): Promise<void> {
    await this.set(KEYS.OPERATIONS, ops);
  }

  // 通用数据存取方法
  async getData<T>(dataType: string): Promise<T | null> {
    const keyMap: Record<string, string> = {
      departments: KEYS.DEPARTMENTS,
      operations: KEYS.OPERATIONS,
      budgets: KEYS.BUDGETS,
      tokenUsage: KEYS.TOKEN_USAGE,
      permissions: KEYS.PERMISSIONS,
      projects: KEYS.PROJECTS,
      agentRequests: KEYS.AGENT_REQUESTS,
      terminationRequests: KEYS.TERMINATION_REQUESTS,
      agentCommunications: KEYS.AGENT_COMMUNICATIONS,
      agentTodos: KEYS.AGENT_TODOS,
    };
    const key = keyMap[dataType] || `@soloforge/${dataType}`;
    return await this.get<T>(key);
  }

  async setData(dataType: string, data: any): Promise<void> {
    const keyMap: Record<string, string> = {
      departments: KEYS.DEPARTMENTS,
      operations: KEYS.OPERATIONS,
      budgets: KEYS.BUDGETS,
      tokenUsage: KEYS.TOKEN_USAGE,
      permissions: KEYS.PERMISSIONS,
      projects: KEYS.PROJECTS,
      agentRequests: KEYS.AGENT_REQUESTS,
      terminationRequests: KEYS.TERMINATION_REQUESTS,
      agentCommunications: KEYS.AGENT_COMMUNICATIONS,
      agentTodos: KEYS.AGENT_TODOS,
    };
    const key = keyMap[dataType] || `@soloforge/${dataType}`;
    await this.set(key, data);
  }

  async clear(): Promise<void> {
    try {
      await AsyncStorage.clear();
    } catch (error) {
      console.error('Storage clear error:', error);
    }
  }
}

export const storage = new StorageService();
export { KEYS };
