/**
 * SoloForge - Agent 注册中心
 * 单例模式，集中管理所有已注册的 Agent
 * @module agents/agent-registry
 */

const { BaseAgent } = require('./base-agent');

/** @type {Map<string, import('./base-agent').BaseAgent>} */
const agents = new Map();

let _instance = null;

/**
 * Agent 注册中心（单例）
 */
class AgentRegistry {
  constructor() {
    if (_instance) {
      return _instance;
    }
    _instance = this;
  }

  /**
   * 注册 Agent
   * @param {InstanceType<typeof BaseAgent>} agent
   * @throws {Error} agent.id 已存在时抛出
   */
  registerAgent(agent) {
    if (!agent || !(agent instanceof BaseAgent)) {
      throw new Error('AgentRegistry: 只能注册 BaseAgent 实例');
    }
    if (agents.has(agent.id)) {
      throw new Error(`AgentRegistry: Agent "${agent.id}" 已注册`);
    }
    agents.set(agent.id, agent);
  }

  /**
   * 根据 ID 获取 Agent
   * @param {string} agentId
   * @returns {InstanceType<typeof BaseAgent> | undefined}
   */
  getAgent(agentId) {
    return agents.get(agentId);
  }

  /**
   * 获取所有已注册的 Agent
   * @returns {InstanceType<typeof BaseAgent>[]}
   */
  getAllAgents() {
    return Array.from(agents.values());
  }

  /**
   * 取消注册 Agent（用于测试或动态卸载）
   * @param {string} agentId
   * @returns {boolean}
   */
  unregisterAgent(agentId) {
    return agents.delete(agentId);
  }

  /**
   * 检查 Agent 是否存在
   * @param {string} agentId
   * @returns {boolean}
   */
  hasAgent(agentId) {
    return agents.has(agentId);
  }
}

/** 单例实例 */
const registry = new AgentRegistry();

module.exports = { AgentRegistry, registry };
