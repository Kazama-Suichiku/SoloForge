/**
 * 核心模块初始化
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

// 桌面版数据路径（自动检测）
const DESKTOP_DATA_PATHS = [
  // 用户主目录下的 .soloforge
  path.join(process.env.HOME || '', '.soloforge/data'),
];

/**
 * 查找桌面版数据目录
 */
function findDesktopDataPath() {
  for (const basePath of DESKTOP_DATA_PATHS) {
    if (!fs.existsSync(basePath)) continue;
    
    // 查找 acc-*/comp-* 结构
    const accDirs = fs.readdirSync(basePath).filter(d => d.startsWith('acc-'));
    for (const accDir of accDirs) {
      const accPath = path.join(basePath, accDir);
      const compDirs = fs.readdirSync(accPath).filter(d => d.startsWith('comp-'));
      if (compDirs.length > 0) {
        // 返回最新的 comp 目录
        const latestComp = compDirs.sort().pop();
        return path.join(accPath, latestComp);
      }
    }
  }
  return null;
}

async function initializeCore() {
  logger.info('Initializing core modules...');

  // 初始化配置存储
  const { agentConfigStore } = require('./config');
  agentConfigStore.initialize();
  logger.info('Config store initialized');

  // 初始化 LLM
  const { llmManager } = require('./llm');
  llmManager.initialize();
  logger.info('LLM manager initialized');

  // 初始化工具系统（含 CFO 预算工具，会加载 budget 模块）
  const { initializeTools } = require('./tools');
  initializeTools();
  logger.info('Tool system initialized');

  // 预算/Token 模块（工具已加载，此处做启动清理）
  const { tokenTracker } = require('./budget');
  tokenTracker.purgeZeroTokenRecords();

  // 初始化聊天管理器
  const { chatManager } = require('./chat');
  chatManager.initialize();
  logger.info('Chat manager initialized');

  // 自动同步桌面版数据（首次或有更新时）
  await autoSyncDesktopData();

  logger.info('All core modules initialized');
}

/**
 * 自动同步桌面版数据
 */
async function autoSyncDesktopData() {
  const desktopPath = findDesktopDataPath();
  if (!desktopPath) {
    logger.info('Desktop data not found, skipping auto-sync');
    return;
  }

  const { importService } = require('./import');
  const DATA_DIR = path.join(__dirname, '../../data');
  const SYNC_MARKER = path.join(DATA_DIR, '.last-sync');

  // 检查是否需要同步（比较时间戳）
  const desktopConfigPath = path.join(desktopPath, 'agent-configs.json');
  if (!fs.existsSync(desktopConfigPath)) {
    return;
  }

  const desktopMtime = fs.statSync(desktopConfigPath).mtime.getTime();
  let lastSync = 0;
  
  if (fs.existsSync(SYNC_MARKER)) {
    lastSync = parseInt(fs.readFileSync(SYNC_MARKER, 'utf-8') || '0', 10);
  }

  if (desktopMtime > lastSync) {
    logger.info('Auto-syncing desktop data...', { desktopPath });
    
    try {
      const result = await importService.importFromDesktop(desktopPath);
      
      // 统一模型为 deepseek-chat
      const { agentConfigStore } = require('./config');
      for (const agent of agentConfigStore.getAll()) {
        if (agent.model !== 'deepseek-chat') {
          agentConfigStore.update(agent.id, { model: 'deepseek-chat' });
        }
      }
      
      // 记录同步时间
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(SYNC_MARKER, Date.now().toString());
      
      logger.info('Desktop data synced', result.stats);
    } catch (error) {
      logger.error('Auto-sync failed', error);
    }
  } else {
    logger.info('Desktop data already in sync');
  }
}

// 导出核心模块
const { agentConfigStore, LEVELS, DEPARTMENTS } = require('./config');
const { llmManager } = require('./llm');
const { chatManager } = require('./chat');
const { toolRegistry, ToolExecutor, parseToolCalls, hasToolCalls, removeToolCalls } = require('./tools');

module.exports = {
  initializeCore,
  agentConfigStore,
  llmManager,
  chatManager,
  toolRegistry,
  ToolExecutor,
  parseToolCalls,
  hasToolCalls,
  removeToolCalls,
  LEVELS,
  DEPARTMENTS,
};
