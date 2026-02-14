/**
 * SoloForge - Agent 模块统一导出
 * @module agents
 */

const { BaseAgent, VALID_STATUSES } = require('./base-agent');
const { AgentRegistry, registry } = require('./agent-registry');
const { AgentOrchestrator } = require('./agent-orchestrator');
const { WriterAgent } = require('./writer-agent');
const { ReviewerAgent } = require('./reviewer-agent');

module.exports = {
  BaseAgent,
  VALID_STATUSES,
  AgentRegistry,
  registry,
  AgentOrchestrator,
  WriterAgent,
  ReviewerAgent,
};
