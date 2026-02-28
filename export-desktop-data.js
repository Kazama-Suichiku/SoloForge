#!/usr/bin/env node
/**
 * 桌面版数据导出脚本
 * 将 SoloForge 桌面版数据导出为 JSON 文件，用于移动端导入
 * 
 * 使用方法：
 * node export-desktop-data.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 桌面版数据目录
const SOLOFORGE_DIR = path.join(os.homedir(), '.soloforge', 'data');

function findLatestDataPath() {
  if (!fs.existsSync(SOLOFORGE_DIR)) {
    console.error('未找到 SoloForge 数据目录:', SOLOFORGE_DIR);
    return null;
  }

  const accounts = fs.readdirSync(SOLOFORGE_DIR).filter(f => f.startsWith('acc-'));
  if (accounts.length === 0) {
    console.error('未找到账号数据');
    return null;
  }

  // 使用最新的账号
  const latestAccount = accounts.sort().pop();
  const accountPath = path.join(SOLOFORGE_DIR, latestAccount);

  const companies = fs.readdirSync(accountPath).filter(f => f.startsWith('comp-'));
  if (companies.length === 0) {
    console.error('未找到公司数据');
    return null;
  }

  const latestCompany = companies.sort().pop();
  return path.join(accountPath, latestCompany);
}

function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.warn('读取失败:', filePath, e.message);
  }
  return null;
}

function main() {
  const dataPath = findLatestDataPath();
  if (!dataPath) {
    process.exit(1);
  }

  console.log('数据目录:', dataPath);

  // 读取 Agent 配置
  const agentConfigs = loadJson(path.join(dataPath, 'agent-configs.json'));
  const agents = agentConfigs ? Object.values(agentConfigs) : [];
  console.log(`找到 ${agents.length} 个 Agent`);

  // 读取聊天历史
  const chatHistory = loadJson(path.join(dataPath, 'chat-history.json'));
  const conversations = [];
  const messages = {};

  if (chatHistory?.state?.conversations) {
    const convsObj = chatHistory.state.conversations;
    const msgsByConv = chatHistory.state.messagesByConversation || {};

    // conversations 是对象，不是数组
    for (const [convId, conv] of Object.entries(convsObj)) {
      // 从会话 ID 提取 agentId (如 "private-secretary" -> "secretary")
      let agentId = conv.participants?.find(p => p !== 'user') || convId.replace('private-', '');
      
      conversations.push({
        id: conv.id || convId,
        agentId: agentId,
        title: conv.name || agentId,
        createdAt: new Date(conv.createdAt).toISOString(),
        updatedAt: new Date(conv.lastMessage?.timestamp || conv.createdAt).toISOString(),
      });

      const convMsgs = msgsByConv[convId] || [];
      if (convMsgs.length > 0) {
        messages[convId] = convMsgs.map(m => ({
          id: m.id,
          role: m.senderType === 'user' ? 'user' : 'assistant',
          content: m.content,
          timestamp: new Date(m.timestamp).toISOString(),
        }));
      }
    }
  }
  console.log(`找到 ${conversations.length} 个会话`);

  // 读取 Boss 配置
  const bossConfig = loadJson(path.join(dataPath, 'boss-config.json'));

  // 读取记忆
  const memoryDir = path.join(dataPath, 'memory');
  const memory = [];
  if (fs.existsSync(memoryDir)) {
    const readMemoryDir = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          readMemoryDir(filePath);
        } else if (file.endsWith('.json')) {
          const data = loadJson(filePath);
          if (data) {
            if (Array.isArray(data)) {
              memory.push(...data);
            } else {
              memory.push(data);
            }
          }
        }
      }
    };
    readMemoryDir(memoryDir);
  }
  console.log(`找到 ${memory.length} 条记忆`);

  // 读取 API Key（从环境变量或 .env 文件）
  let apiKey = process.env.DEEPSEEK_API_KEY;
  const envPath = path.join(os.homedir(), 'Desktop', 'SoloForge', '.env');
  if (!apiKey && fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/DEEPSEEK_API_KEY=(.+)/);
    if (match) {
      apiKey = match[1].trim();
    }
  }

  // 生成导出数据
  const exportData = {
    agents,
    conversations,
    messages,
    bossConfig: bossConfig || { name: '老板', avatar: '👑' },
    memory,
    apiKey: apiKey || undefined,
  };

  // 写入文件
  const outputPath = path.join(os.homedir(), 'Desktop', 'soloforge-export.json');
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

  console.log('');
  console.log('✅ 导出成功!');
  console.log('文件位置:', outputPath);
  console.log('');
  console.log('导出统计:');
  console.log(`  - Agents: ${agents.length}`);
  console.log(`  - 会话: ${conversations.length}`);
  console.log(`  - 消息: ${Object.values(messages).flat().length}`);
  console.log(`  - 记忆: ${memory.length}`);
  console.log(`  - API Key: ${apiKey ? '已包含' : '未找到'}`);
  console.log('');
  console.log('请将此文件传输到手机，然后在 App 设置中导入。');
}

main();
