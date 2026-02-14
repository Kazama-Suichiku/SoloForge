/**
 * SoloForge - Agent 基类
 * 所有具体 Agent 需继承此类并实现 execute 方法
 * @module agents/base-agent
 */

const VALID_STATUSES = Object.freeze(['idle', 'running', 'completed', 'error']);

/**
 * @typedef {import('../../shared/ipc-types').AgentStatus} AgentStatus
 */

/**
 * Agent 基类
 */
class BaseAgent {
  /**
   * @param {string} id - Agent 唯一标识
   * @param {string} name - Agent 显示名称
   * @param {string} description - Agent 功能描述
   */
  constructor(id, name, description) {
    if (!id || typeof id !== 'string') {
      throw new Error('BaseAgent: id 必须为非空字符串');
    }
    if (!name || typeof name !== 'string') {
      throw new Error('BaseAgent: name 必须为非空字符串');
    }

    this.id = id;
    this.name = name;
    this.description = description || '';
    this._status = 'idle';
    this._currentTask = null;
    this._lastError = null;
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
   * 获取 Agent 状态
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
   * @param {'idle' | 'running' | 'completed' | 'error'} status
   * @param {string|null} [currentTask]
   * @param {Error|string|null} [error]
   */
  _setStatus(status, currentTask = null, error = null) {
    if (VALID_STATUSES.includes(status)) {
      this._status = status;
    }
    this._currentTask = currentTask;
    this._lastError = error;
  }

  /**
   * 获取上次错误信息
   * @returns {string|null}
   */
  getLastError() {
    if (this._lastError instanceof Error) {
      return this._lastError.message;
    }
    return this._lastError;
  }
}

module.exports = { BaseAgent, VALID_STATUSES };
