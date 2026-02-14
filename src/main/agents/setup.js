/**
 * SoloForge - Agent 初始化与注册
 * 初始化 LLM Manager，创建并注册 Writer、Reviewer 等 Agent
 * @module agents/setup
 */

const { LLMManager } = require('../llm');
const { WriterAgent } = require('./writer-agent');
const { ReviewerAgent } = require('./reviewer-agent');
const { registry } = require('./agent-registry');

/** @type {import('../llm/llm-manager').LLMManager | null} */
let llmManager = null;

/**
 * 初始化 Agent 环境并注册到 registry
 * 应在应用启动时、IPC handler 注册之前调用
 */
function setup() {
  if (llmManager) {
    return llmManager;
  }

  llmManager = new LLMManager();

  const writer = new WriterAgent(llmManager);
  const reviewer = new ReviewerAgent(llmManager);

  registry.registerAgent(writer);
  registry.registerAgent(reviewer);

  return llmManager;
}

/**
 * 获取已初始化的 LLM Manager（setup 之后可用）
 * @returns {import('../llm/llm-manager').LLMManager | null}
 */
function getLLMManager() {
  return llmManager;
}

module.exports = { setup, getLLMManager };
