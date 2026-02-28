/**
 * 数据导入服务
 * 从桌面版 SoloForge 迁移数据到移动版
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { agentConfigStore, CORE_AGENT_IDS } = require('../config');
const { chatManager } = require('../chat');

const DATA_DIR = path.join(__dirname, '../../../data');

class ImportService {
  constructor() {
    this.importStats = {
      agents: { imported: 0, skipped: 0, errors: 0 },
      conversations: { imported: 0, skipped: 0, errors: 0 },
      bossConfig: { imported: false },
    };
  }

  /**
   * 从桌面版数据目录导入所有数据
   */
  async importFromDesktop(desktopDataPath) {
    this.importStats = {
      agents: { imported: 0, skipped: 0, errors: 0 },
      conversations: { imported: 0, skipped: 0, errors: 0 },
      bossConfig: { imported: false },
    };

    const results = {
      success: true,
      errors: [],
      stats: this.importStats,
    };

    try {
      // 1. 导入 Agent 配置
      const agentConfigPath = path.join(desktopDataPath, 'agent-configs.json');
      if (fs.existsSync(agentConfigPath)) {
        await this._importAgentConfigs(agentConfigPath, results);
      } else {
        results.errors.push('agent-configs.json not found');
      }

      // 2. 导入老板配置
      const bossConfigPath = path.join(desktopDataPath, 'boss-config.json');
      if (fs.existsSync(bossConfigPath)) {
        await this._importBossConfig(bossConfigPath, results);
      }

      // 3. 导入聊天历史
      const chatHistoryPath = path.join(desktopDataPath, 'chat-history.json');
      if (fs.existsSync(chatHistoryPath)) {
        await this._importChatHistory(chatHistoryPath, results);
      } else {
        results.errors.push('chat-history.json not found');
      }

      // 4. 复制头像文件
      const avatarsPath = path.join(desktopDataPath, 'avatars');
      if (fs.existsSync(avatarsPath)) {
        await this._importAvatars(avatarsPath, results);
      }

      // 5. 导入预算和 Token 使用数据
      const budgetsPath = path.join(desktopDataPath, 'budgets.json');
      const tokenUsagePath = path.join(desktopDataPath, 'token-usage.json');
      if (fs.existsSync(budgetsPath)) {
        const { budgetManager } = require('../budget');
        const budgetResult = budgetManager.importFromDesktop(budgetsPath);
        if (budgetResult.imported) {
          results.stats.budgets = { imported: true };
        }
      }
      if (fs.existsSync(tokenUsagePath)) {
        const { tokenTracker } = require('../budget');
        const tokenResult = tokenTracker.importFromDesktop(tokenUsagePath);
        if (tokenResult.imported > 0) {
          results.stats.tokenUsage = { imported: tokenResult.imported };
        }
      }

      results.stats = this.importStats;
      logger.info('Desktop data import completed', results.stats);
    } catch (error) {
      results.success = false;
      results.errors.push(error.message);
      logger.error('Import failed', error);
    }

    return results;
  }

  /**
   * 导入 Agent 配置
   */
  async _importAgentConfigs(configPath, results) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      
      for (const [agentId, config] of Object.entries(data)) {
        try {
          // 处理头像路径（转为相对路径或保持 emoji）
          let avatar = config.avatar;
          if (avatar && avatar.includes('/')) {
            // 绝对路径转为文件名
            avatar = path.basename(avatar);
          }

          const importConfig = {
            id: agentId,
            name: config.name,
            role: config.role || agentId,
            title: config.title || config.role || agentId,
            level: config.level || 'staff',
            department: this._normalizeDepartment(config.department || config.departments?.[0]),
            description: config.description || '',
            avatar: avatar || '👤',
            model: config.model || 'deepseek-chat',
            status: config.status || 'active',
            isDynamic: config.isDynamic || !CORE_AGENT_IDS.includes(agentId),
            reportsTo: config.reportsTo || null,
            profile: config.profile || null,
          };

          // 更新或添加 Agent
          const existing = agentConfigStore.get(agentId);
          if (existing) {
            agentConfigStore.update(agentId, importConfig);
          } else {
            agentConfigStore.add(importConfig);
          }

          this.importStats.agents.imported++;
        } catch (error) {
          this.importStats.agents.errors++;
          results.errors.push(`Agent ${agentId}: ${error.message}`);
        }
      }

      logger.info('Agent configs imported', this.importStats.agents);
    } catch (error) {
      results.errors.push(`Agent configs: ${error.message}`);
      logger.error('Failed to import agent configs', error);
    }
  }

  /**
   * 标准化部门名称
   */
  _normalizeDepartment(dept) {
    if (!dept) return 'admin';
    
    const deptMap = {
      'tech': 'tech',
      'technology': 'tech',
      '技术部': 'tech',
      'finance': 'finance',
      '财务部': 'finance',
      'hr': 'hr',
      'human_resources': 'hr',
      '人力资源部': 'hr',
      'admin': 'admin',
      '行政部': 'admin',
      'executive': 'executive',
      '高管办公室': 'executive',
      'harem': 'harem',
      '后宫': 'harem',
    };

    return deptMap[dept.toLowerCase()] || dept;
  }

  /**
   * 导入老板配置
   */
  async _importBossConfig(configPath, results) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      
      // 保存到移动版数据目录
      const mobileBossPath = path.join(DATA_DIR, 'boss-config.json');
      
      const bossConfig = {
        name: data.name || '老板',
        avatar: data.avatar || '👑',
        importedAt: new Date().toISOString(),
      };

      // 处理头像路径
      if (bossConfig.avatar && bossConfig.avatar.includes('/')) {
        bossConfig.avatar = path.basename(bossConfig.avatar);
      }

      fs.writeFileSync(mobileBossPath, JSON.stringify(bossConfig, null, 2));
      this.importStats.bossConfig.imported = true;
      logger.info('Boss config imported', bossConfig);
    } catch (error) {
      results.errors.push(`Boss config: ${error.message}`);
      logger.error('Failed to import boss config', error);
    }
  }

  /**
   * 导入聊天历史
   */
  async _importChatHistory(historyPath, results) {
    try {
      const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      const conversations = data.state?.conversations || data.conversations || data;
      const messagesByConversation = data.state?.messagesByConversation || {};

      for (const [convId, conv] of Object.entries(conversations)) {
        try {
          // 跳过群聊，只导入私聊
          if (conv.type === 'group' || conv.type === 'department') {
            this.importStats.conversations.skipped++;
            continue;
          }

          // 提取 agentId（从 participants 或 id）
          let agentId = null;
          if (conv.participants) {
            agentId = conv.participants.find(p => p !== 'user' && p !== 'boss');
          }
          if (!agentId && conv.id) {
            // 从 "private-secretary" 格式提取
            const match = conv.id.match(/^private-(.+)$/);
            if (match) {
              agentId = match[1];
            }
          }

          if (!agentId) {
            this.importStats.conversations.skipped++;
            continue;
          }

          // 获取消息（从 messagesByConversation 或 conv.messages）
          const rawMessages = messagesByConversation[convId] || conv.messages || [];
          
          // 转换消息格式
          const messages = this._convertMessages(rawMessages);
          
          if (messages.length === 0) {
            this.importStats.conversations.skipped++;
            continue;
          }

          // 创建或更新会话
          const importConv = {
            id: convId,
            agentId,
            title: conv.name || `与 ${agentId} 的对话`,
            messages,
            createdAt: conv.createdAt ? new Date(conv.createdAt).toISOString() : new Date().toISOString(),
            updatedAt: conv.lastMessage?.timestamp 
              ? new Date(conv.lastMessage.timestamp).toISOString() 
              : new Date().toISOString(),
          };

          chatManager.conversations.set(convId, importConv);
          this.importStats.conversations.imported++;
        } catch (error) {
          this.importStats.conversations.errors++;
          results.errors.push(`Conversation ${convId}: ${error.message}`);
        }
      }

      // 保存导入的会话
      chatManager._saveConversations();
      logger.info('Chat history imported', this.importStats.conversations);
    } catch (error) {
      results.errors.push(`Chat history: ${error.message}`);
      logger.error('Failed to import chat history', error);
    }
  }

  /**
   * 转换桌面版消息格式到移动版
   */
  _convertMessages(desktopMessages) {
    const messages = [];
    
    for (const msg of desktopMessages) {
      if (!msg.content) continue;

      // 桌面版格式: { senderId, senderType, content, timestamp, ... }
      // 移动版格式: { role, content, timestamp, agentId?, agentName? }
      
      const isUser = msg.senderType === 'user' || msg.senderId === 'user' || msg.senderId === 'boss';
      
      const converted = {
        role: isUser ? 'user' : 'assistant',
        content: msg.content,
        timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
      };

      if (!isUser) {
        converted.agentId = msg.senderId;
        converted.agentName = msg.senderName || msg.senderId;
      }

      messages.push(converted);
    }

    return messages;
  }

  /**
   * 复制头像文件
   */
  async _importAvatars(avatarsPath, results) {
    try {
      const mobileAvatarsPath = path.join(DATA_DIR, 'avatars');
      
      if (!fs.existsSync(mobileAvatarsPath)) {
        fs.mkdirSync(mobileAvatarsPath, { recursive: true });
      }

      const files = fs.readdirSync(avatarsPath);
      let copied = 0;

      for (const file of files) {
        const srcPath = path.join(avatarsPath, file);
        const destPath = path.join(mobileAvatarsPath, file);
        
        if (fs.statSync(srcPath).isFile()) {
          fs.copyFileSync(srcPath, destPath);
          copied++;
        }
      }

      logger.info('Avatars imported', { copied });
    } catch (error) {
      results.errors.push(`Avatars: ${error.message}`);
      logger.error('Failed to import avatars', error);
    }
  }

  /**
   * 获取导入统计
   */
  getImportStats() {
    return this.importStats;
  }
}

const importService = new ImportService();

module.exports = { ImportService, importService };
