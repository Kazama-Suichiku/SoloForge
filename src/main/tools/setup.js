/**
 * SoloForge - 工具系统初始化
 * 注册所有可用工具
 * @module tools/setup
 */

const { registerFileTools } = require('./file-tool');
const { registerCalculatorTool } = require('./calculator-tool');
const { registerCFOTools } = require('./cfo-tools');
const { registerHRTools } = require('./hr-tools');
const { registerRecruitTools } = require('./recruit-tools');
const { registerOperationsTools } = require('./operations-tools');
const { registerCollaborationTools } = require('./collaboration-tools');
const { registerPMTools } = require('./pm-tools');
const { registerShellTool } = require('./shell-tool');
const { registerGitTools } = require('./git-tool');
const { registerWebSearchTool } = require('./web-search-tool');
const { registerWebFetchTool } = require('./web-fetch-tool');
const { registerReportTools } = require('./report-tool');
const { registerHistoryTools } = require('./history-tool');
const { registerMemoryTools } = require('./memory-tools');
const { registerTodoTools } = require('./todo-tools');
const { registerContextTools } = require('./context-tools');
const { browserPool } = require('./browser-pool');
const { toolRegistry } = require('./tool-registry');
const { logger } = require('../utils/logger');
const { app } = require('electron');

/**
 * 初始化工具系统
 */
function setupTools() {
  logger.info('初始化工具系统...');

  // 注册所有工具
  registerFileTools();
  registerCalculatorTool();
  registerShellTool();
  registerGitTools();
  registerWebSearchTool();
  registerWebFetchTool();
  registerReportTools();
  registerHistoryTools();
  registerCFOTools();
  registerHRTools();
  registerRecruitTools();
  registerOperationsTools();
  registerCollaborationTools();
  registerPMTools();
  registerMemoryTools();
  registerTodoTools();
  registerContextTools();

  const tools = toolRegistry.getAll();
  logger.info(`已注册 ${tools.length} 个工具:`, tools.map((t) => t.name));

  // 初始化浏览器窗口池（懒创建模式，不会立即打开窗口）
  browserPool.init();

  // 应用退出时销毁浏览器窗口池
  app.on('before-quit', () => {
    browserPool.destroy();
  });
}

module.exports = { setupTools };
