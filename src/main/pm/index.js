/**
 * SoloForge - PM 模块入口
 * @module pm
 */

const { projectStore } = require('./project-store');
const { PMEngine } = require('./pm-engine');

// PM 引擎单例（需要在 main.js 中初始化依赖后启动）
let pmEngine = null;

/**
 * 初始化并启动 PM 引擎
 * @param {Object} deps
 * @param {import('../operations/operations-store').OperationsStore} deps.operationsStore
 * @param {import('../collaboration/agent-communication').AgentCommunication} deps.agentCommunication
 * @param {import('../chat').ChatManager} deps.chatManager
 * @param {number} [checkIntervalMs] - 检查间隔
 */
function initPMEngine(deps, checkIntervalMs) {
  pmEngine = new PMEngine({
    projectStore,
    ...deps,
  });
  pmEngine.start(checkIntervalMs);
  return pmEngine;
}

module.exports = {
  projectStore,
  PMEngine,
  get pmEngine() { return pmEngine; },
  initPMEngine,
};
