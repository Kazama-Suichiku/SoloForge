/**
 * SoloForge - Agent 基类（任务流水线体系）
 *
 * 本类是 agents/ 体系（WriterAgent / ReviewerAgent）的基类，
 * 由 AgentOrchestrator 按 pipeline 编排，用于"任务流水线"场景。
 *
 * 双轨 Agent 统一：本类现已继承 AgentBase（agents/agent-base.js），
 * 与 chat/ 体系的 ChatAgent 共享统一的 getStatus() 接口。
 * 原有的 _setStatus / getStatus / getLastError 接口完全保留，
 * AgentOrchestrator 和 ipc-handlers 无需任何修改。
 *
 * @module agents/base-agent
 */

const { AgentBase, RUNTIME_STATUSES } = require('./agent-base');

/**
 * @typedef {import('../../shared/ipc-types').AgentStatus} AgentStatus
 */

// 兼容旧导出：VALID_STATUSES 即 RUNTIME_STATUSES
const VALID_STATUSES = RUNTIME_STATUSES;

/**
 * Agent 基类（任务流水线体系）
 * 继承 AgentBase 以获得统一的 runtime/lifecycle 双维度状态。
 */
class BaseAgent extends AgentBase {
  /**
   * @param {string} id - Agent 唯一标识
   * @param {string} name - Agent 显示名称
   * @param {string} description - Agent 功能描述
   */
  constructor(id, name, description) {
    super(id, name, { description });
    // 兼容旧字段：_status 代理到 _runtimeStatus
    this._status = 'idle';
  }

  /**
   * 执行 Agent 任务（子类必须实现）
   * @abstract
   * @param {Record<string, unknown>} input - 输入数据
   * @param {{ taskId: string; isCancelled: () => boolean }} context - 执行上下文（含 taskId、是否已取消等）
   * @returns {Promise<Record<string, unknown>>} 输出数据，将传递给下一个 Agent
   */
  async execute(input, context) {
    throw new Error(
      `BaseAgent.execute 为抽象方法，${this.constructor.name} 必须实现`
    );
  }

  /**
   * 获取 Agent 状态（兼容原接口，AgentOrchestrator / ipc-handlers 不需修改）
   * @returns {AgentStatus}
   */
  getStatus() {
    /** @type {AgentStatus['status']} */
    let status = this._status;
    if (!VALID_STATUSES.includes(status)) {
      status = 'idle';
    }
    return {
      agentId: this.id,
      name: this.name,
      status,
      currentTask: this._currentTask || undefined,
    };
  }

  /**
   * 设置内部状态（供子类或编排器调用）
   * 兼容旧接口：同时更新 _status（遗留字段）和 _runtimeStatus（AgentBase 字段）。
   * @param {'idle' | 'running' | 'completed' | 'error'} status
   * @param {string|null} [currentTask]
   * @param {Error|string|null} [error]
   */
  _setStatus(status, currentTask = null, error = null) {
    if (VALID_STATUSES.includes(status)) {
      this._status = status;
      this._runtimeStatus = status;
    }
    this._currentTask = currentTask;
    this._lastError = error;
  }
}

module.exports = { BaseAgent, VALID_STATUSES };
