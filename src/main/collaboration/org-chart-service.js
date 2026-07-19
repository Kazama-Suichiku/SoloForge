/**
 * SoloForge - 组织架构服务
 * 从 agent-config-store 推导组织架构树、上下级关系、跨部门同事、汇报链、团队状态等。
 *
 * 设计要点：
 * - 不持久化任何数据，所有信息均从 agentConfigStore 动态推导
 * - 支持内置 Agent（DEFAULT_AGENT_CONFIGS）和动态招聘的 Agent（reportsTo 从 recruit_request 来）
 * - getTeamStatus 依赖 ChatManager.activeTasks（可选注入，未注入时返回 idle）
 *
 * @module collaboration/org-chart-service
 */

const { agentConfigStore, AGENT_STATUS, LEVELS } = require('../config/agent-config-store');
const { getAgentDepartments, getPrimaryDepartment } = require('../config/agent-config-store');
const { logger } = require('../utils/logger');

/**
 * 组织架构服务（单例）
 */
class OrgChartService {
  constructor() {
    /** @type {Object | null} ChatManager 实例（可选注入，用于 getTeamStatus） */
    this.chatManager = null;
  }

  /**
   * 注入 ChatManager（用于 getTeamStatus 查询 activeTasks）
   * 不注入时 getTeamStatus 返回 status='idle'。
   * @param {Object} chatManager
   */
  setChatManager(chatManager) {
    this.chatManager = chatManager;
  }

  // ─────────────────────────────────────────────────────────────
  // 内部辅助
  // ─────────────────────────────────────────────────────────────

  /**
   * 判断 Agent 是否在职（非 terminated）
   * @param {Object} config
   * @returns {boolean}
   * @private
   */
  _isActive(config) {
    if (!config) return false;
    const status = config.status || 'active';
    return status !== AGENT_STATUS.TERMINATED;
  }

  /**
   * 获取所有在职 Agent 配置
   * @returns {Object[]}
   * @private
   */
  _getAllActiveConfigs() {
    return agentConfigStore.getAll().filter((c) => this._isActive(c));
  }

  /**
   * 提取组织架构节点所需的基础信息
   * @param {Object} config
   * @returns {Object}
   * @private
   */
  _toNode(config) {
    return {
      id: config.id,
      name: config.name,
      title: config.title,
      role: config.role,
      level: config.level,
      levelName: LEVELS[config.level?.toUpperCase()]?.name || config.level || '',
      department: getPrimaryDepartment(config),
      departments: getAgentDepartments(config),
      avatar: config.avatar,
      description: config.description,
      status: config.status || 'active',
      reportsTo: config.reportsTo || null,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 对外接口
  // ─────────────────────────────────────────────────────────────

  /**
   * 获取完整组织架构树（从 CEO 开始递归构建）
   * @returns {Object|null} 根节点（CEO），无 CEO 时返回 null
   */
  getOrgChart() {
    const configs = this._getAllActiveConfigs();

    // 找 CEO 作为根
    const ceoConfig = configs.find((c) => c.id === 'ceo' || c.role === 'ceo');
    if (!ceoConfig) {
      logger.warn('OrgChartService.getOrgChart: 未找到 CEO');
      return null;
    }

    // 构建 id → config 索引
    const configMap = new Map(configs.map((c) => [c.id, c]));

    // 递归构建下属树，防止循环引用
    const buildNode = (config, visited) => {
      if (!config || visited.has(config.id)) return null;
      visited.add(config.id);

      const node = this._toNode(config);
      node.subordinates = [];

      // 找出所有 reportsTo === config.id 的 Agent
      for (const child of configs) {
        if (child.reportsTo === config.id) {
          const childNode = buildNode(child, visited);
          if (childNode) node.subordinates.push(childNode);
        }
      }

      // 按职级排序：高 → 低
      node.subordinates.sort((a, b) => {
        const rankA = LEVELS[a.level?.toUpperCase()]?.rank || 0;
        const rankB = LEVELS[b.level?.toUpperCase()]?.rank || 0;
        return rankB - rankA;
      });

      return node;
    };

    return buildNode(ceoConfig, new Set());
  }

  /**
   * 获取直接下属列表
   * @param {string} agentId - 上级 Agent ID
   * @returns {Object[]} 直接下属节点列表
   */
  getSubordinates(agentId) {
    const configs = this._getAllActiveConfigs();
    return configs
      .filter((c) => c.reportsTo === agentId)
      .map((c) => this._toNode(c))
      .sort((a, b) => {
        const rankA = LEVELS[a.level?.toUpperCase()]?.rank || 0;
        const rankB = LEVELS[b.level?.toUpperCase()]?.rank || 0;
        return rankB - rankA;
      });
  }

  /**
   * 获取直接上级
   * @param {string} agentId - 下级 Agent ID
   * @returns {Object|null} 上级节点，无上级或不存在时返回 null
   */
  getSuperior(agentId) {
    const config = agentConfigStore.get(agentId);
    if (!config) return null;
    const reportsTo = config.reportsTo;
    if (!reportsTo) return null;
    const superiorConfig = agentConfigStore.get(reportsTo);
    if (!superiorConfig || !this._isActive(superiorConfig)) return null;
    return this._toNode(superiorConfig);
  }

  /**
   * 获取直接下属列表（语义同 getSubordinates，常用语"谁向我汇报"）
   * @param {string} agentId
   * @returns {Object[]}
   */
  getDirectReports(agentId) {
    return this.getSubordinates(agentId);
  }

  /**
   * 获取部门成员列表
   * @param {string} deptId - 部门 ID
   * @returns {Object[]} 该部门所有在职成员
   */
  getDepartmentMembers(deptId) {
    if (!deptId) return [];
    const configs = this._getAllActiveConfigs();
    return configs
      .filter((c) => getAgentDepartments(c).includes(deptId))
      .map((c) => this._toNode(c))
      .sort((a, b) => {
        const rankA = LEVELS[a.level?.toUpperCase()]?.rank || 0;
        const rankB = LEVELS[b.level?.toUpperCase()]?.rank || 0;
        return rankB - rankA;
      });
  }

  /**
   * 获取跨部门同事（不与自己同部门，且在职）
   * @param {string} agentId
   * @returns {Object[]}
   */
  getCrossDeptColleagues(agentId) {
    const config = agentConfigStore.get(agentId);
    if (!config) return [];

    const myDepts = new Set(getAgentDepartments(config));
    const configs = this._getAllActiveConfigs();

    return configs
      .filter((c) => c.id !== agentId)
      .filter((c) => {
        const depts = getAgentDepartments(c);
        // 不与自己同部门
        return !depts.some((d) => myDepts.has(d));
      })
      .map((c) => this._toNode(c))
      .sort((a, b) => {
        const rankA = LEVELS[a.level?.toUpperCase()]?.rank || 0;
        const rankB = LEVELS[b.level?.toUpperCase()]?.rank || 0;
        return rankB - rankA;
      });
  }

  /**
   * 获取汇报链（从自己到 CEO，包含自己）
   * @param {string} agentId
   * @returns {Object[]} 汇报链，第一个是自己，最后一个是 CEO
   */
  getReportingChain(agentId) {
    const chain = [];
    const visited = new Set();
    let currentId = agentId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const config = agentConfigStore.get(currentId);
      if (!config || !this._isActive(config)) break;

      chain.push(this._toNode(config));
      currentId = config.reportsTo || null;
    }

    return chain;
  }

  /**
   * 获取团队工作状态（自己 + 所有下属的当前任务负载）
   * 依赖 chatManager.activeTasks，未注入时所有成员 status='idle'。
   * @param {string} agentId - 团队负责人 ID
   * @param {Object} [options]
   * @param {boolean} [options.includeSubteams=false] - 是否包含下属的下属（递归收集所有间接下属）
   * @returns {{ leader: Object, members: Array, summary: Object }}
   */
  getTeamStatus(agentId, options = {}) {
    const { includeSubteams = false } = options;
    const leaderConfig = agentConfigStore.get(agentId);
    if (!leaderConfig || !this._isActive(leaderConfig)) {
      return { leader: null, members: [], summary: { total: 0, busy: 0, idle: 0 } };
    }

    const leader = this._toNode(leaderConfig);

    // 收集下属：includeSubteams=true 时递归收集所有间接下属（BFS，避免自环）
    /** @type {Object[]} 直接或全部下属节点 */
    let subordinates = this.getSubordinates(agentId);
    if (includeSubteams) {
      const seen = new Set([agentId, ...subordinates.map((s) => s.id)]);
      const queue = subordinates.slice();
      const allSubs = subordinates.slice();
      while (queue.length > 0) {
        const current = queue.shift();
        const childSubs = this.getSubordinates(current.id);
        for (const child of childSubs) {
          if (!seen.has(child.id)) {
            seen.add(child.id);
            allSubs.push(child);
            queue.push(child);
          }
        }
      }
      subordinates = allSubs;
    }

    // 收集 leader + subordinates
    const allMembers = [
      { config: leaderConfig, node: leader },
      ...subordinates.map((node) => ({ config: agentConfigStore.get(node.id), node })),
    ];

    const activeTasks = this.chatManager?.activeTasks;
    const members = allMembers.map(({ config, node }) => {
      let taskInfo = null;
      let status = 'idle';

      if (activeTasks && activeTasks instanceof Map) {
        const task = activeTasks.get(config.id);
        if (task) {
          status = 'busy';
          taskInfo = {
            taskId: task.taskId,
            stage: task.stage || 'thinking',
            startTime: task.startTime || null,
            task: task.task || '',
            conversationId: task.conversationId || null,
            messageId: task.messageId || null,
          };
        }
      }

      return {
        ...node,
        status,
        currentTask: taskInfo,
      };
    });

    const busyCount = members.filter((m) => m.status === 'busy').length;
    const idleCount = members.length - busyCount;

    return {
      leader,
      members,
      summary: {
        total: members.length,
        busy: busyCount,
        idle: idleCount,
      },
    };
  }
}

// 单例
const orgChartService = new OrgChartService();

module.exports = {
  OrgChartService,
  orgChartService,
};
