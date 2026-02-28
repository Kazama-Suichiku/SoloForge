/**
 * 工具系统 - 移动端版
 * 注册除 shell 和 file 外的所有工具
 */

const { ToolRegistry, toolRegistry } = require('./tool-registry');
const { ToolExecutor, parseToolCalls, hasToolCalls, removeToolCalls } = require('./tool-executor');
const { registerCalculatorTool } = require('./calculator-tool');
const { registerCollaborationTools } = require('./collaboration-tools');
const { registerCFOTools } = require('./cfo-tools');
const { registerWebSearchTool } = require('./web-search-tool');
const { registerWebFetchTool } = require('./web-fetch-tool');
const { registerTodoTools } = require('./todo-tools');
const { registerHistoryTools } = require('./history-tools');
const { registerMemoryTools } = require('./memory-tools');
const { registerHRTools } = require('./hr-tools');
const { registerOperationsTools } = require('./operations-tools');
const { logger } = require('../../utils/logger');

/**
 * 初始化所有工具
 */
function initializeTools() {
  // 数学计算
  registerCalculatorTool();
  
  // Agent 协作工具
  registerCollaborationTools();

  // CFO 预算/Token 工具
  registerCFOTools();
  
  // 网络工具
  registerWebSearchTool();
  registerWebFetchTool();
  
  // TODO 工具
  registerTodoTools();
  
  // 历史消息工具
  registerHistoryTools();

  // 记忆工具
  registerMemoryTools();

  // HR 工具
  registerHRTools();

  // 运营工具（目标/KPI/任务）
  registerOperationsTools();

  logger.info(`工具系统初始化完成，共注册 ${toolRegistry.getAll().length} 个工具`);
  
  // 列出已注册的工具
  const tools = toolRegistry.getAll();
  logger.info('已注册工具:', tools.map(t => t.name).join(', '));
}

module.exports = {
  ToolRegistry,
  toolRegistry,
  ToolExecutor,
  parseToolCalls,
  hasToolCalls,
  removeToolCalls,
  initializeTools,
};
