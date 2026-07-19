/**
 * SoloForge - Agent 模块统一导出
 * @module agents
 */

const { AgentBase, RUNTIME_STATUSES, LIFECYCLE_STATUSES } = require('./agent-base');
const { BaseAgent, VALID_STATUSES } = require('./base-agent');
const { AgentRegistry, registry } = require('./agent-registry');
const { AgentOrchestrator } = require('./agent-orchestrator');
const { WriterAgent } = require('./writer-agent');
const { ReviewerAgent } = require('./reviewer-agent');

module.exports = {
  // 统一基类（双轨 Agent 接口层）
  AgentBase,
  RUNTIME_STATUSES,
  LIFECYCLE_STATUSES,
  // 任务流水线体系
  BaseAgent,
  VALID_STATUSES,
  AgentRegistry,
  registry,
  AgentOrchestrator,
  WriterAgent,
  ReviewerAgent,
};
