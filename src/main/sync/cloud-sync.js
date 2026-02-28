/**
 * 桌面版云同步服务
 * 实现与 Cloudflare Workers 的双向增量同步
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class CloudSyncService {
  constructor() {
    this.syncUrl = null;
    this.userId = null;
    this.deviceId = null;
    this.lastSyncAt = {};
    this.configPath = path.join(app.getPath('userData'), 'cloud-sync-config.json');
    this.dataPath = null;
  }

  /**
   * 初始化同步服务
   */
  async initialize(dataPath) {
    this.dataPath = dataPath;
    this.loadConfig();
    
    if (!this.deviceId) {
      this.deviceId = `desktop-${uuidv4().substring(0, 8)}`;
      this.saveConfig();
    }
  }

  /**
   * 配置同步服务
   */
  configure(options) {
    if (options.syncUrl) this.syncUrl = options.syncUrl;
    if (options.userId) this.userId = options.userId;
    this.saveConfig();
  }

  /**
   * 获取配置
   */
  getConfig() {
    return {
      syncUrl: this.syncUrl,
      userId: this.userId,
      deviceId: this.deviceId,
      lastSyncAt: this.lastSyncAt,
      isConfigured: !!(this.syncUrl && this.userId),
    };
  }

  /**
   * 加载配置
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.syncUrl = config.syncUrl || null;
        this.userId = config.userId || null;
        this.deviceId = config.deviceId || null;
        this.lastSyncAt = config.lastSyncAt || {};
      }
    } catch (error) {
      console.error('加载云同步配置失败:', error);
    }
  }

  /**
   * 保存配置
   */
  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify({
        syncUrl: this.syncUrl,
        userId: this.userId,
        deviceId: this.deviceId,
        lastSyncAt: this.lastSyncAt,
      }, null, 2));
    } catch (error) {
      console.error('保存云同步配置失败:', error);
    }
  }

  /**
   * 执行完整同步（先拉后推）
   */
  async sync() {
    if (!this.syncUrl || !this.userId) {
      throw new Error('云同步未配置');
    }

    console.log('[CloudSync] 开始同步...');
    const results = { pulled: {}, pushed: {} };

    // 1. 先拉取远程变更
    const pullResult = await this.pull();
    results.pulled = pullResult;

    // 2. 再推送本地变更
    const pushResult = await this.push();
    results.pushed = pushResult;

    console.log('[CloudSync] 同步完成:', results);
    return results;
  }

  /**
   * 拉取远程变更
   */
  async pull() {
    const since = Math.min(
      this.lastSyncAt.messages || 0,
      this.lastSyncAt.conversations || 0,
      this.lastSyncAt.agents || 0,
      this.lastSyncAt.boss || 0
    );

    const response = await fetch(`${this.syncUrl}/sync/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: this.userId,
        deviceId: this.deviceId,
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

    // 合并远程数据到本地
    const merged = await this.mergeRemoteData(result.data);
    
    // 更新同步时间
    this.lastSyncAt = {
      messages: result.serverTime,
      conversations: result.serverTime,
      agents: result.serverTime,
      boss: result.serverTime,
    };
    this.saveConfig();

    return merged;
  }

  /**
   * 推送本地变更
   */
  async push() {
    const data = await this.collectLocalChanges();

    const response = await fetch(`${this.syncUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: this.userId,
        deviceId: this.deviceId,
        deviceType: 'desktop',
        data,
      }),
    });

    if (!response.ok) {
      throw new Error(`推送失败: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || '推送失败');
    }

    // 更新同步时间
    this.lastSyncAt = {
      messages: result.syncedAt,
      conversations: result.syncedAt,
      agents: result.syncedAt,
      boss: result.syncedAt,
    };
    this.saveConfig();

    return result.stats;
  }

  /**
   * 收集本地变更数据
   */
  async collectLocalChanges() {
    const data = {
      messages: [],
      conversations: [],
      agents: [],
      bossConfig: null,
    };

    if (!this.dataPath) return data;

    // 读取聊天历史
    const chatHistoryPath = path.join(this.dataPath, 'chat-history.json');
    if (fs.existsSync(chatHistoryPath)) {
      try {
        const chatHistory = JSON.parse(fs.readFileSync(chatHistoryPath, 'utf-8'));
        
        if (chatHistory.state?.conversations) {
          for (const [convId, conv] of Object.entries(chatHistory.state.conversations)) {
            const agentId = conv.participants?.find(p => p !== 'user') || convId.replace('private-', '');
            data.conversations.push({
              id: convId,
              agentId,
              title: conv.name || agentId,
              createdAt: conv.createdAt || Date.now(),
              updatedAt: conv.lastMessage?.timestamp || Date.now(),
            });
          }
        }

        if (chatHistory.state?.messagesByConversation) {
          for (const [convId, messages] of Object.entries(chatHistory.state.messagesByConversation)) {
            if (!Array.isArray(messages)) continue;
            for (const msg of messages) {
              data.messages.push({
                id: msg.id,
                conversationId: convId,
                role: msg.senderType === 'user' || msg.senderId === 'user' ? 'user' : 'assistant',
                content: msg.content || '',
                timestamp: msg.timestamp || Date.now(),
                updatedAt: msg.timestamp || Date.now(),
              });
            }
          }
        }
      } catch (error) {
        console.error('读取聊天历史失败:', error);
      }
    }

    // 读取 Agent 配置
    const agentConfigPath = path.join(this.dataPath, 'agent-configs.json');
    if (fs.existsSync(agentConfigPath)) {
      try {
        const agents = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));
        for (const [id, agent] of Object.entries(agents)) {
          data.agents.push({
            id,
            name: agent.name,
            title: agent.title,
            role: agent.role,
            level: agent.level,
            department: agent.department,
            departments: agent.departments,
            avatar: agent.avatar,
            description: agent.description,
            model: agent.model,
            status: agent.status || 'active',
            updatedAt: Date.now(),
          });
        }
      } catch (error) {
        console.error('读取 Agent 配置失败:', error);
      }
    }

    // 读取 Boss 配置
    const bossConfigPath = path.join(this.dataPath, 'boss-config.json');
    if (fs.existsSync(bossConfigPath)) {
      try {
        const boss = JSON.parse(fs.readFileSync(bossConfigPath, 'utf-8'));
        data.bossConfig = {
          name: boss.name || '老板',
          avatar: boss.avatar,
          updatedAt: Date.now(),
        };
      } catch (error) {
        console.error('读取 Boss 配置失败:', error);
      }
    }

    return data;
  }

  /**
   * 合并远程数据到本地
   */
  async mergeRemoteData(remoteData) {
    const stats = { conversations: 0, messages: 0, agents: 0, boss: 0 };
    if (!this.dataPath) return stats;

    // 合并会话和消息
    const chatHistoryPath = path.join(this.dataPath, 'chat-history.json');
    let chatHistory = { state: { conversations: {}, messagesByConversation: {} } };
    
    if (fs.existsSync(chatHistoryPath)) {
      try {
        chatHistory = JSON.parse(fs.readFileSync(chatHistoryPath, 'utf-8'));
      } catch (error) {
        console.error('读取本地聊天历史失败:', error);
      }
    }

    // 合并会话
    if (remoteData.conversations?.length) {
      for (const conv of remoteData.conversations) {
        if (conv.deleted) {
          delete chatHistory.state.conversations[conv.id];
        } else {
          const existing = chatHistory.state.conversations[conv.id];
          if (!existing || conv.updatedAt > (existing.lastMessage?.timestamp || 0)) {
            chatHistory.state.conversations[conv.id] = {
              ...existing,
              name: conv.title,
              participants: ['user', conv.agentId],
              createdAt: conv.createdAt,
              lastMessage: existing?.lastMessage || { timestamp: conv.updatedAt },
            };
            stats.conversations++;
          }
        }
      }
    }

    // 合并消息
    if (remoteData.messages?.length) {
      for (const msg of remoteData.messages) {
        if (!chatHistory.state.messagesByConversation[msg.conversationId]) {
          chatHistory.state.messagesByConversation[msg.conversationId] = [];
        }
        
        const messages = chatHistory.state.messagesByConversation[msg.conversationId];
        const existingIndex = messages.findIndex(m => m.id === msg.id);
        
        if (msg.deleted) {
          if (existingIndex !== -1) {
            messages.splice(existingIndex, 1);
          }
        } else {
          const newMsg = {
            id: msg.id,
            senderId: msg.role === 'user' ? 'user' : msg.conversationId.replace('private-', ''),
            senderType: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
          };
          
          if (existingIndex !== -1) {
            if (msg.updatedAt > messages[existingIndex].timestamp) {
              messages[existingIndex] = newMsg;
            }
          } else {
            messages.push(newMsg);
          }
          stats.messages++;
        }
      }
      
      // 按时间排序消息
      for (const convId of Object.keys(chatHistory.state.messagesByConversation)) {
        chatHistory.state.messagesByConversation[convId].sort((a, b) => a.timestamp - b.timestamp);
      }
    }

    // 保存聊天历史
    fs.writeFileSync(chatHistoryPath, JSON.stringify(chatHistory, null, 2));

    // 合并 Agents
    if (remoteData.agents?.length) {
      const agentConfigPath = path.join(this.dataPath, 'agent-configs.json');
      let agents = {};
      
      if (fs.existsSync(agentConfigPath)) {
        try {
          agents = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));
        } catch (error) {
          console.error('读取本地 Agent 配置失败:', error);
        }
      }

      for (const agent of remoteData.agents) {
        if (agent.deleted) {
          delete agents[agent.id];
        } else {
          const existing = agents[agent.id];
          if (!existing || agent.updatedAt > (existing.updatedAt || 0)) {
            agents[agent.id] = {
              ...existing,
              ...agent,
            };
            stats.agents++;
          }
        }
      }

      fs.writeFileSync(agentConfigPath, JSON.stringify(agents, null, 2));
    }

    // 合并 Boss 配置
    if (remoteData.bossConfig) {
      const bossConfigPath = path.join(this.dataPath, 'boss-config.json');
      let boss = { name: '老板', avatar: '👑' };
      
      if (fs.existsSync(bossConfigPath)) {
        try {
          boss = JSON.parse(fs.readFileSync(bossConfigPath, 'utf-8'));
        } catch (error) {
          console.error('读取本地 Boss 配置失败:', error);
        }
      }

      if (remoteData.bossConfig.updatedAt > (boss.updatedAt || 0)) {
        boss = { ...boss, ...remoteData.bossConfig };
        fs.writeFileSync(bossConfigPath, JSON.stringify(boss, null, 2));
        stats.boss = 1;
      }
    }

    return stats;
  }

  /**
   * 获取同步状态
   */
  async getStatus() {
    if (!this.syncUrl || !this.userId) {
      return { configured: false };
    }

    try {
      const response = await fetch(
        `${this.syncUrl}/sync/status?userId=${encodeURIComponent(this.userId)}&deviceId=${encodeURIComponent(this.deviceId)}`
      );

      if (!response.ok) {
        throw new Error(`状态查询失败: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      return { error: error.message };
    }
  }
}

const cloudSync = new CloudSyncService();
module.exports = { cloudSync };
