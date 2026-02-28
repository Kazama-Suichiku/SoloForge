/**
 * 移动版云同步服务
 * 实现与 Cloudflare Workers 的双向增量同步
 * 支持自动同步：启动时、发送消息时、切回前台时、定期轮询
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { storage } from '../storage';
import { authService } from '../auth';

const SYNC_CONFIG_KEY = '@soloforge/cloud_sync_config';
const DEFAULT_SYNC_URL = 'https://soloforge-sync.fengzhongcuizhu.workers.dev';
const SYNC_INTERVAL = 30000; // 30秒轮询一次
const MIN_SYNC_INTERVAL = 5000; // 最小同步间隔5秒，防止频繁同步

interface SyncConfig {
  syncUrl: string;
  userId: string | null;
  deviceId: string;
  lastSyncAt: Record<string, number>;
}

interface SyncResult {
  success: boolean;
  pulled?: { conversations: number; messages: number; agents: number; boss: number };
  pushed?: { conversations: number; messages: number; agents: number; boss: number };
  error?: string;
}

interface MessageRecord {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  timestamp: number;
  updatedAt: number;
}

interface ConversationRecord {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface AgentRecord {
  id: string;
  name: string;
  title?: string;
  role?: string;
  level?: string;
  department?: string;
  departments?: string[];
  avatar?: string;
  avatarThumb?: string;
  avatarFull?: string;
  description?: string;
  model?: string;
  status?: string;
  updatedAt: number;
}

interface BossConfigRecord {
  name: string;
  avatar?: string;
  avatarThumb?: string;
  avatarFull?: string;
  updatedAt: number;
}

type SyncListener = (result: SyncResult) => void;

class CloudSyncService {
  private config: SyncConfig = {
    syncUrl: DEFAULT_SYNC_URL,
    userId: null,
    deviceId: `mobile-${Date.now().toString(36)}`,
    lastSyncAt: {},
  };

  private initialized = false;
  private syncing = false;
  private lastSyncTime = 0;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: any = null;
  private listeners: Set<SyncListener> = new Set();

  async initialize(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(SYNC_CONFIG_KEY);
      if (stored) {
        this.config = { ...this.config, ...JSON.parse(stored) };
      }

      // 从认证服务获取用户ID
      await authService.initialize();
      const authState = authService.getState();
      if (authState.isLoggedIn && authState.userId) {
        const prevUserId = this.config.userId;
        this.config.userId = authState.userId;
        this.config.syncUrl = authState.serverUrl || DEFAULT_SYNC_URL;

        // 如果是新用户或切换了用户，重置同步时间以拉取全量数据
        if (prevUserId !== authState.userId) {
          this.config.lastSyncAt = {};
        }
        await this.saveConfig();
      }

      this.initialized = true;

      // 如果已登录，启动自动同步
      if (this.config.userId) {
        this.startAutoSync();
      }
    } catch (error) {
      console.error('[CloudSync] 初始化失败:', error);
    }
  }

  /**
   * 启动自动同步
   */
  startAutoSync(): void {
    if (!this.config.userId) {
      console.log('[CloudSync] 未登录，跳过自动同步');
      return;
    }

    // 立即同步一次
    this.syncSilent();

    // 定期同步
    if (!this.syncTimer) {
      this.syncTimer = setInterval(() => {
        this.syncSilent();
      }, SYNC_INTERVAL);
      console.log('[CloudSync] 自动同步已启动，间隔', SYNC_INTERVAL / 1000, '秒');
    }

    // 监听应用状态变化
    if (!this.appStateSubscription) {
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    }
  }

  /**
   * 停止自动同步
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    console.log('[CloudSync] 自动同步已停止');
  }

  /**
   * 处理应用状态变化
   */
  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      console.log('[CloudSync] 应用切回前台，触发同步');
      this.syncSilent();
    }
  };

  /**
   * 添加同步监听器
   */
  addListener(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(result: SyncResult): void {
    this.listeners.forEach(listener => {
      try {
        listener(result);
      } catch (e) {
        console.error('[CloudSync] 监听器错误:', e);
      }
    });
  }

  async configure(options: { syncUrl?: string; userId?: string }): Promise<void> {
    if (options.syncUrl !== undefined) this.config.syncUrl = options.syncUrl;
    if (options.userId !== undefined) this.config.userId = options.userId;
    await this.saveConfig();

    // 配置后启动自动同步
    if (this.config.userId) {
      this.startAutoSync();
    }
  }

  getConfig(): SyncConfig & { isConfigured: boolean } {
    return {
      ...this.config,
      isConfigured: !!this.config.userId,
    };
  }

  isConfigured(): boolean {
    return !!this.config.userId;
  }

  private async saveConfig(): Promise<void> {
    try {
      await AsyncStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(this.config));
    } catch (error) {
      console.error('[CloudSync] 保存配置失败:', error);
    }
  }

  /**
   * 静默同步（不抛出错误，用于自动同步）
   */
  async syncSilent(): Promise<SyncResult> {
    try {
      return await this.sync();
    } catch (error) {
      console.error('[CloudSync] 静默同步失败:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 快速同步消息（发送消息后调用）
   */
  async syncMessages(): Promise<void> {
    // 防止频繁同步
    const now = Date.now();
    if (now - this.lastSyncTime < MIN_SYNC_INTERVAL) {
      return;
    }
    await this.syncSilent();
  }

  /**
   * 执行完整同步（先拉后推）
   */
  async sync(): Promise<SyncResult> {
    if (!this.config.syncUrl || !this.config.userId) {
      return { success: false, error: '云同步未配置' };
    }

    // 防止并发同步
    if (this.syncing) {
      console.log('[CloudSync] 同步进行中，跳过');
      return { success: false, error: '同步进行中' };
    }

    // 防止频繁同步
    const now = Date.now();
    if (now - this.lastSyncTime < MIN_SYNC_INTERVAL) {
      return { success: true };
    }

    this.syncing = true;
    this.lastSyncTime = now;

    try {
      console.log('[CloudSync] 开始同步...');

      // 1. 先拉取远程变更
      const pullResult = await this.pull();

      // 2. 再推送本地变更
      const pushResult = await this.push();

      console.log('[CloudSync] 同步完成', { pulled: pullResult, pushed: pushResult });

      const result: SyncResult = {
        success: true,
        pulled: pullResult,
        pushed: pushResult,
      };

      this.notifyListeners(result);
      return result;
    } catch (error) {
      console.error('[CloudSync] 同步失败:', error);
      const result = { success: false, error: String(error) };
      this.notifyListeners(result);
      return result;
    } finally {
      this.syncing = false;
    }
  }

  /**
   * 拉取远程变更
   */
  async pull(): Promise<{ conversations: number; messages: number; agents: number; boss: number }> {
    const since = Math.min(
      this.config.lastSyncAt.messages || 0,
      this.config.lastSyncAt.conversations || 0,
      this.config.lastSyncAt.agents || 0,
      this.config.lastSyncAt.boss || 0
    );

    const response = await fetch(`${this.config.syncUrl}/sync/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: this.config.userId,
        deviceId: this.config.deviceId,
        since,
      }),
    });

    if (!response.ok) {
      throw new Error(`拉取失败: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || '拉取失败');
    }

    const stats = await this.mergeRemoteData(result.data);

    // 更新同步时间
    this.config.lastSyncAt = {
      messages: result.serverTime,
      conversations: result.serverTime,
      agents: result.serverTime,
      boss: result.serverTime,
    };
    await this.saveConfig();

    return stats;
  }

  /**
   * 推送本地变更
   */
  async push(): Promise<{ conversations: number; messages: number; agents: number; boss: number }> {
    const data = await this.collectLocalChanges();

    const response = await fetch(`${this.config.syncUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: this.config.userId,
        deviceId: this.config.deviceId,
        deviceType: 'mobile',
        data,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`推送失败: ${response.status} - ${text}`);
    }

    const result = await response.json();
    if (!result.success && result.errors?.length) {
      console.warn('[CloudSync] 部分数据推送失败:', result.errors);
    }

    // 更新同步时间
    this.config.lastSyncAt = {
      messages: result.syncedAt,
      conversations: result.syncedAt,
      agents: result.syncedAt,
      boss: result.syncedAt,
    };
    await this.saveConfig();

    return result.stats || { conversations: 0, messages: 0, agents: 0, boss: 0 };
  }

  /**
   * 收集本地变更数据
   */
  private async collectLocalChanges(): Promise<{
    messages: MessageRecord[];
    conversations: ConversationRecord[];
    agents: AgentRecord[];
    bossConfig: BossConfigRecord | null;
  }> {
    const data: {
      messages: MessageRecord[];
      conversations: ConversationRecord[];
      agents: AgentRecord[];
      bossConfig: BossConfigRecord | null;
    } = {
      messages: [],
      conversations: [],
      agents: [],
      bossConfig: null,
    };

    // 收集会话
    const conversations = await storage.getConversations();
    for (const conv of conversations) {
      data.conversations.push({
        id: conv.id,
        agentId: conv.agentId,
        title: conv.title || conv.agentId,
        createdAt: new Date(conv.createdAt).getTime(),
        updatedAt: new Date(conv.updatedAt).getTime(),
      });
    }

    // 收集消息
    for (const conv of conversations) {
      const messages = await storage.getMessages(conv.id);
      for (const msg of messages) {
        data.messages.push({
          id: msg.id,
          conversationId: conv.id,
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.timestamp).getTime(),
          updatedAt: new Date(msg.timestamp).getTime(),
        });
      }
    }

    // 收集 Agents
    const agents = await storage.getAgents();
    for (const agent of agents) {
      data.agents.push({
        id: agent.id,
        name: agent.name,
        title: agent.title,
        role: agent.role,
        level: agent.level,
        department: agent.department,
        departments: (agent as any).departments,
        avatar: agent.avatar,
        avatarThumb: (agent as any).avatarThumb,
        avatarFull: (agent as any).avatarFull,
        description: agent.description,
        model: agent.model,
        status: agent.status || 'active',
        updatedAt: Date.now(),
      });
    }

    // 收集 Boss 配置
    const boss = await storage.getBossConfig();
    if (boss) {
      data.bossConfig = {
        name: boss.name || '老板',
        avatar: boss.avatar,
        avatarThumb: boss.avatarThumb,
        avatarFull: boss.avatarFull,
        updatedAt: Date.now(),
      };
    }

    return data;
  }

  /**
   * 合并远程数据到本地
   */
  private async mergeRemoteData(remoteData: {
    conversations?: any[];
    messages?: any[];
    agents?: any[];
    bossConfig?: any;
  }): Promise<{ conversations: number; messages: number; agents: number; boss: number }> {
    const stats = { conversations: 0, messages: 0, agents: 0, boss: 0 };

    // 合并会话
    if (remoteData.conversations?.length) {
      const localConvs = await storage.getConversations();
      const convMap = new Map(localConvs.map(c => [c.id, c]));

      for (const conv of remoteData.conversations) {
        if (conv.deleted) {
          convMap.delete(conv.id);
        } else {
          const existing = convMap.get(conv.id);
          if (!existing || conv.updatedAt > new Date(existing.updatedAt).getTime()) {
            convMap.set(conv.id, {
              id: conv.id,
              agentId: conv.agentId,
              title: conv.title,
              createdAt: new Date(conv.createdAt).toISOString(),
              updatedAt: new Date(conv.updatedAt).toISOString(),
            });
            stats.conversations++;
          }
        }
      }

      await storage.setConversations(Array.from(convMap.values()));
    }

    // 合并消息
    if (remoteData.messages?.length) {
      const messagesByConv: Record<string, any[]> = {};

      for (const msg of remoteData.messages) {
        if (!messagesByConv[msg.conversationId]) {
          messagesByConv[msg.conversationId] = await storage.getMessages(msg.conversationId);
        }

        const messages = messagesByConv[msg.conversationId];
        const existingIndex = messages.findIndex(m => m.id === msg.id);

        if (msg.deleted) {
          if (existingIndex !== -1) {
            messages.splice(existingIndex, 1);
          }
        } else {
          const newMsg = {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.timestamp).toISOString(),
          };

          if (existingIndex !== -1) {
            if (msg.updatedAt > new Date(messages[existingIndex].timestamp).getTime()) {
              messages[existingIndex] = newMsg;
            }
          } else {
            messages.push(newMsg);
          }
          stats.messages++;
        }
      }

      // 保存所有修改的会话消息
      for (const [convId, messages] of Object.entries(messagesByConv)) {
        messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        await storage.setMessages(convId, messages);
      }
    }

    // 合并 Agents
    if (remoteData.agents?.length) {
      const localAgents = await storage.getAgents();
      const agentMap = new Map(localAgents.map(a => [a.id, a]));

      for (const agent of remoteData.agents) {
        if (agent.deleted) {
          agentMap.delete(agent.id);
        } else {
          const existing = agentMap.get(agent.id);
          if (!existing || agent.updatedAt > ((existing as any).updatedAt || 0)) {
            agentMap.set(agent.id, {
              ...existing,
              ...agent,
            });
            stats.agents++;
          }
        }
      }

      await storage.setAgents(Array.from(agentMap.values()));
    }

    // 合并 Boss 配置
    if (remoteData.bossConfig) {
      const localBoss = await storage.getBossConfig();
      if (remoteData.bossConfig.updatedAt > ((localBoss as any)?.updatedAt || 0)) {
        await storage.setBossConfig({
          ...localBoss,
          ...remoteData.bossConfig,
        });
        stats.boss = 1;
      }
    }

    return stats;
  }

  /**
   * 获取同步状态
   */
  async getStatus(): Promise<any> {
    if (!this.config.syncUrl || !this.config.userId) {
      return { configured: false };
    }

    try {
      const response = await fetch(
        `${this.config.syncUrl}/sync/status?userId=${encodeURIComponent(this.config.userId)}&deviceId=${encodeURIComponent(this.config.deviceId)}`
      );

      if (!response.ok) {
        throw new Error(`状态查询失败: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      return { error: String(error) };
    }
  }

  /**
   * 重置同步状态（用于调试）
   */
  async reset(): Promise<void> {
    this.config.lastSyncAt = {};
    await this.saveConfig();
    console.log('[CloudSync] 同步状态已重置');
  }
}

export const cloudSync = new CloudSyncService();
