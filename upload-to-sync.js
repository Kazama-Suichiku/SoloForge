#!/usr/bin/env node
/**
 * 上传桌面版数据到本地同步服务器
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SYNC_DATA_DIR = path.join(os.homedir(), '.soloforge-sync');
const EXPORT_FILE = path.join(os.homedir(), 'Desktop', 'soloforge-export.json');
const USER_ID = 'default-user';

// 确保目录存在
if (!fs.existsSync(SYNC_DATA_DIR)) {
  fs.mkdirSync(SYNC_DATA_DIR, { recursive: true });
}

// 读取导出数据
if (!fs.existsSync(EXPORT_FILE)) {
  console.error('未找到导出文件:', EXPORT_FILE);
  console.log('请先运行 node export-desktop-data.js');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf-8'));
data.uploadedAt = new Date().toISOString();
data.version = '2.0';

// 保存到同步目录
const syncFile = path.join(SYNC_DATA_DIR, `${USER_ID}.json`);
fs.writeFileSync(syncFile, JSON.stringify(data, null, 2));

console.log('');
console.log('✅ 数据已上传到同步服务器');
console.log('');
console.log('统计:');
console.log(`  - Agents: ${data.agents?.length || 0}`);
console.log(`  - 会话: ${data.conversations?.length || 0}`);
console.log(`  - 消息: ${Object.values(data.messages || {}).flat().length}`);
console.log(`  - 记忆: ${data.memory?.length || 0}`);
console.log('');
console.log('文件位置:', syncFile);
console.log('');
console.log('现在启动同步服务器: node local-sync-server.js');
console.log('然后在手机 App 设置中点击"从云端下载"');
