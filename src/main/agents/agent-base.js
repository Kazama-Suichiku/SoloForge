/**
 * SoloForge - Agent 统一基类（双轨 Agent 接口层统一）
 *
 * 背景：项目存在两套互不相通的 Agent 体系：
 *   A) agents/ 体系：BaseAgent → WriterAgent / ReviewerAgent，由 AgentOrchestrator
 *      按 pipeline 编排，状态机 idle/running/completed/error。用于"任务流水线"。
 *   B) chat/ 体系：ChatAgent → 5 个 C-Level + 动态 Agent，由 ChatManager 管理，
 *      状态存 agentConfigStore（active/suspended/terminated）。用于"聊天对话"。
 *
 * 本模块做"接口层统一"（而非强行合并实现）：
 *   1. 提供 AgentBase 统一基类，两套体系都继承它
 *   2. 统一三套状态机为"运行态（runtime）+ 生命周期（lifecycle）"两个维度：
 *      - runtime:    idle | running | completed | error   （瞬时执行态，对应原 BaseAgent 状态机）
 *      - lifecycle:  active | suspended | terminated        （持久身份态，对应 agentConfigStore）
 *   3. 提供 getStatus() 统一查询接口，返回 { id, name, runtime, lifecycle, ... }
 *   4. 不破坏任何现有功能：原 BaseAgent 的 _setStatus/getStatus 保留，
 *      ChatAgent 的 agentConfigStore 查询保留，两者各自继续工作
 *
 * 这样做的收益：
 *   - 将来可以在 orchestrator、chatManager、UI 三处用统一方式查询 Agent 状态
 *   - 为后续真正合并（如果需要）打下基础，但不强制现在就合并
 *   - 三套状态机的语义被显式区分，不再混淆
 *
 * @module agents/agent-base
 */

const { logger } = require('../utils/logger');

/**
 * 运行态：瞬时执行状态（对应原 BaseAgent 状态机）
 * @typedef {'idle'|'running'|'completed'|'error'} RuntimeStatus
 */
const RUNTIME_STATUSES = Object.freeze(['idle', 'running', 'completed', 'error']);

/**
 * 生命周期态：持久身份状态（对应 agentConfigStore）
 * @typedef {'active'|'suspended'|'terminated'} LifecycleStatus
 */
const LIFECYCLE_STATUSES = Object.freeze(['active', 'suspended', 'terminated']);

/**
 * 统一 Agent 基类
 *
 * 子类只需：
 *   - 构造时传 id/name/role/description
 *   - 可选重写 _getLifecycleStatus()（默认返回 'active'）
 *   - 各自保留 execute() / chat() 等业务方法
 */
class AgentBase {
  /**
   * @param {string} id
   * @param {string} name
   * @param {Object} [opts]
   * @param {string} [opts.role]
   * @param {string} [opts.description]
   */
  constructor(id, name, opts = {}) {
    if (!id || typeof id !== 'string') {
      throw new Error('AgentBase: id 必须为非空字符串');
    }
    if (!name || typeof name !== 'string') {
      throw new Error('AgentBase: name 必须为非空字符串');
    }
    this.id = id;
    // 注意：子类（或其原型链上的任一祖先）可能用 getter 覆盖 `name`
    // （如 ChatAgent 从 agentConfigStore 动态查询）。这种情况不能直接赋值，
    // 否则抛 "Cannot set property name which has only a getter"。
    // 检测方式：沿原型链查找是否有 name 的访问器属性（getter/setter）。
    let nameHasAccessorOnProto = false;
    let proto = Object.getPrototypeOf(this);
    while (proto && proto !== Object.prototype) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'name');
      if (desc && (desc.get || desc.set)) {
        nameHasAccessorOnProto = true;
        break;
      }
      proto = Object.getPrototypeOf(proto);
    }
    if (!nameHasAccessorOnProto) {
      this.name = name;
    } else {
      this._name = name;
    }
    this.role = opts.role || '';
    this.description = opts.description || '';

    // 运行态（瞬时）
    this._runtimeStatus = 'idle';
    this._currentTask = null;
    this._lastError = null;
  }

  // ─────────────────────────────────────────────────────────────
  // 运行态（runtime）—— 瞬时执行状态
  // ─────────────────────────────────────────────────────────────

  /**
   * 设置运行态（供 orchestrator 或子类调用）
   * @param {RuntimeStatus} status
   * @param {string|null} [currentTask]
   * @param {Error|string|null} [error]
   */
  _setRuntimeStatus(status, currentTask = null, error = null) {
    if (RUNTIME_STATUSES.includes(status)) {
      this._runtimeStatus = status;
    }
    this._currentTask = currentTask;
    this._lastError = error;
  }

  /**
   * 获取运行态
   * @returns {RuntimeStatus}
   */
  getRuntimeStatus() {
    let s = this._runtimeStatus;
    if (!RUNTIME_STATUSES.includes(s)) s = 'idle';
    return s;
  }

  /**
   * 获取上次错误信息
   * @returns {string|null}
   */
  getLastError() {
    if (this._lastError instanceof Error) return this._lastError.message;
    return this._lastError;
  }

  // ─────────────────────────────────────────────────────────────
  // 生命周期态（lifecycle）—— 持久身份状态
  // ─────────────────────────────────────────────────────────────

  /**
   * 获取生命周期态。子类可重写以对接 agentConfigStore 等。
   * 默认返回 'active'。
   * @returns {LifecycleStatus}
   */
  _getLifecycleStatus() {
    return 'active';
  }

  /**
   * 获取生命周期态（公共接口）
   * @returns {LifecycleStatus}
   */
  getLifecycleStatus() {
    return this._getLifecycleStatus();
  }

  // ─────────────────────────────────────────────────────────────
  // 统一状态查询
  // ─────────────────────────────────────────────────────────────

  /**
   * 统一状态查询（两套体系共用）
   * 返回同时包含 runtime 和 lifecycle 的状态对象。
   * 兼容原 BaseAgent.getStatus() 的调用方（返回字段 agentId/name/status/currentTask）。
   * @returns {{
   *   agentId: string,
   *   name: string,
   *   status: RuntimeStatus,
   *   runtime: RuntimeStatus,
   *   lifecycle: LifecycleStatus,
   *   currentTask: string|null,
   * }}
   */
  getStatus() {
    return {
      agentId: this.id,
      name: this.name,
      // 兼容字段：原 BaseAgent.getStatus() 返回的 status 是 runtime 态
      status: this.getRuntimeStatus(),
      // 新字段：两个维度的显式状态
      runtime: this.getRuntimeStatus(),
      lifecycle: this.getLifecycleStatus(),
      currentTask: this._currentTask || null,
    };
  }

  /**
   * 是否已停职/离职（lifecycle 非 active）
   * @returns {boolean}
   */
  isInactive() {
    return this.getLifecycleStatus() !== 'active';
  }
}

module.exports = {
  AgentBase,
  RUNTIME_STATUSES,
  LIFECYCLE_STATUSES,
};
