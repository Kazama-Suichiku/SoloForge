/**
 * SoloForge Mobile - HR 工具（简化版）
 * CHRO 使用的人事管理工具，无 Electron 依赖
 * @module core/tools/hr-tools
 */

const { toolRegistry } = require('./tool-registry');
const {
  agentConfigStore,
  LEVELS,
  DEPARTMENTS,
  CORE_AGENT_IDS,
  AGENT_STATUS,
  getAgentDepartments,
} = require('../config/agent-config-store');
const { logger } = require('../../utils/logger');

// ─────────────────────────────────────────────────────────────
// 人事信息查看
// ─────────────────────────────────────────────────────────────

const hrListAgentsTool = {
  name: 'hr_list_agents',
  description: `查看所有 Agent 的人事信息，包括姓名、职位、职级、部门、状态。支持按部门和状态筛选。`,
  category: 'hr',
  parameters: {
    department: { type: 'string', description: '可选，按部门筛选（tech, finance, hr, admin, executive）', required: false },
    status: { type: 'string', description: '可选，按状态筛选：active（在职）, suspended（停职）, terminated（已开除）', required: false },
  },
  requiredPermissions: [],
  async execute(args) {
    let agents = agentConfigStore.getAll();
    if (args.department) {
      const filterDept = args.department.toLowerCase();
      agents = agents.filter((a) => {
        const depts = getAgentDepartments(a);
        return depts.some((d) => (d || '').toLowerCase() === filterDept);
      });
    }
    if (args.status) {
      agents = agents.filter((a) => (a.status || 'active') === args.status.toLowerCase());
    }
    const result = agents.map((agent) => {
      const level = LEVELS[agent.level?.toUpperCase()] || { name: agent.level, rank: 0 };
      const depts = getAgentDepartments(agent);
      const deptNames = depts.map((d) => DEPARTMENTS[d?.toUpperCase()]?.name || d).join('、');
      return {
        id: agent.id,
        name: agent.name,
        title: agent.title,
        level: level.name,
        levelRank: level.rank,
        departments: depts,
        departmentNames: deptNames,
        department: depts[0] || null,
        description: agent.description || '',
        avatar: agent.avatar || '',
        status: agent.status || 'active',
        isCoreAgent: CORE_AGENT_IDS.includes(agent.id),
      };
    });
    result.sort((a, b) => b.levelRank - a.levelRank);
    const allAgents = agentConfigStore.getAll();
    return {
      success: true,
      totalCount: result.length,
      statusCounts: {
        active: allAgents.filter((a) => (a.status || 'active') === 'active').length,
        suspended: allAgents.filter((a) => a.status === 'suspended').length,
        terminated: allAgents.filter((a) => a.status === 'terminated').length,
      },
      agents: result,
      departments: Object.values(DEPARTMENTS).map((d) => ({ id: d.id, name: d.name })),
      levels: Object.values(LEVELS).map((l) => ({ id: l.id, name: l.name, rank: l.rank })),
    };
  },
};

const hrUpdateAgentTool = {
  name: 'hr_update_agent',
  description: `更新 Agent 的人事信息：name（姓名）, title（职位）, level（职级）, description（职责描述）, avatar（头像emoji）。`,
  category: 'hr',
  parameters: {
    agent_id: { type: 'string', description: 'Agent ID', required: true },
    name: { type: 'string', description: '新的姓名', required: false },
    title: { type: 'string', description: '新的职位头衔', required: false },
    level: { type: 'string', description: '新的职级（c_level, vp, director, manager, senior, staff, intern, assistant）', required: false },
    description: { type: 'string', description: '新的职责描述', required: false },
    avatar: { type: 'string', description: '新的头像（emoji）', required: false },
  },
  requiredPermissions: [],
  async execute(args) {
    const { agent_id, ...updates } = args;
    if (!agent_id) return { success: false, error: '必须指定 agent_id' };
    const validUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && value !== null && value !== '') validUpdates[key] = value;
    }
    if (Object.keys(validUpdates).length === 0) return { success: false, error: '没有提供要更新的字段' };
    if (validUpdates.level) {
      const levelExists = Object.values(LEVELS).some((l) => l.id === validUpdates.level.toLowerCase());
      if (!levelExists) return { success: false, error: `无效的职级: ${validUpdates.level}`, validLevels: Object.values(LEVELS).map((l) => l.id) };
      validUpdates.level = validUpdates.level.toLowerCase();
    }
    const result = agentConfigStore.update(agent_id, validUpdates);
    if (!result) return { success: false, error: `找不到 Agent: ${agent_id}` };
    logger.info('HR 更新 Agent 信息', { agent_id, updates: validUpdates });
    return { success: true, message: `已更新 ${result.name} 的信息`, agent: result };
  },
};

const hrOrgChartTool = {
  name: 'hr_org_chart',
  description: '获取公司组织架构概览，按部门和职级展示所有成员。',
  category: 'hr',
  parameters: { include_terminated: { type: 'boolean', description: '是否包含已开除的成员（默认 false）', required: false } },
  requiredPermissions: [],
  async execute(args) {
    let agents = agentConfigStore.getAll();
    if (!args.include_terminated) agents = agents.filter((a) => (a.status || 'active') !== AGENT_STATUS.TERMINATED);
    const byDepartment = {};
    for (const agent of agents) {
      const depts = getAgentDepartments(agent);
      const agentDepts = depts.length > 0 ? depts : ['other'];
      for (const deptId of agentDepts) {
        const dept = DEPARTMENTS[deptId?.toUpperCase()] || { id: deptId, name: deptId };
        if (!byDepartment[deptId]) byDepartment[deptId] = { id: dept.id, name: dept.name, members: [] };
        const level = LEVELS[agent.level?.toUpperCase()] || { name: agent.level, rank: 0 };
        byDepartment[deptId].members.push({
          id: agent.id,
          name: agent.name,
          title: agent.title,
          level: level.name,
          levelRank: level.rank,
          avatar: agent.avatar,
          status: agent.status || 'active',
        });
      }
    }
    for (const dept of Object.values(byDepartment)) dept.members.sort((a, b) => b.levelRank - a.levelRank);
    return {
      success: true,
      stats: {
        totalMembers: agents.filter((a) => (a.status || 'active') === 'active').length,
        suspendedCount: agents.filter((a) => a.status === 'suspended').length,
        terminatedCount: agents.filter((a) => a.status === 'terminated').length,
        departmentCount: Object.keys(byDepartment).length,
      },
      departments: Object.values(byDepartment),
      organizationInfo: agentConfigStore.getOrganizationInfo(),
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 停职/复职
// ─────────────────────────────────────────────────────────────

const hrSuspendAgentTool = {
  name: 'hr_suspend_agent',
  description: '停职一个 Agent。停职后该 Agent 将无法响应消息。核心成员不可被停职。',
  category: 'hr',
  parameters: {
    agent_id: { type: 'string', description: '要停职的 Agent ID', required: true },
    reason: { type: 'string', description: '停职原因', required: true },
  },
  requiredPermissions: [],
  async execute(args) {
    const { agent_id, reason } = args;
    if (!agent_id) return { success: false, error: '必须指定 agent_id' };
    if (!reason) return { success: false, error: '必须提供停职原因' };
    const result = agentConfigStore.suspend(agent_id, reason);
    if (!result.success) return result;
    logger.info('Agent 停职', { agent_id, reason });
    return {
      success: true,
      message: `已将「${result.agent.name}（${result.agent.title}）」停职`,
      agent: { id: agent_id, name: result.agent.name, title: result.agent.title, status: 'suspended' },
    };
  },
};

const hrReinstateAgentTool = {
  name: 'hr_reinstate_agent',
  description: '恢复一个被停职的 Agent。',
  category: 'hr',
  parameters: {
    agent_id: { type: 'string', description: '要复职的 Agent ID', required: true },
    comment: { type: 'string', description: '复职备注', required: false },
  },
  requiredPermissions: [],
  async execute(args) {
    const { agent_id } = args;
    if (!agent_id) return { success: false, error: '必须指定 agent_id' };
    const result = agentConfigStore.reinstate(agent_id);
    if (!result.success) return result;
    logger.info('Agent 复职', { agent_id });
    return {
      success: true,
      message: `已恢复「${result.agent.name}（${result.agent.title}）」的工作状态`,
      agent: { id: agent_id, name: result.agent.name, title: result.agent.title, status: 'active' },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 晋升/降级
// ─────────────────────────────────────────────────────────────

const hrPromoteAgentTool = {
  name: 'hr_promote_agent',
  description: '正式晋升一个 Agent 的职级。可用职级（从低到高）：intern, assistant, staff, senior, manager, director, vp, c_level',
  category: 'hr',
  parameters: {
    agent_id: { type: 'string', description: 'Agent ID', required: true },
    new_level: { type: 'string', description: '新职级 ID（必须高于当前职级）', required: true },
    new_title: { type: 'string', description: '新的职位头衔（可选）', required: false },
    reason: { type: 'string', description: '晋升原因', required: true },
  },
  requiredPermissions: [],
  async execute(args) {
    const { agent_id, new_level, new_title, reason } = args;
    if (!agent_id) return { success: false, error: '必须指定 agent_id' };
    if (!new_level) return { success: false, error: '必须指定 new_level' };
    if (!reason) return { success: false, error: '必须提供晋升原因' };
    const config = agentConfigStore.get(agent_id);
    if (!config) return { success: false, error: `找不到 Agent: ${agent_id}` };
    const newLevelObj = Object.values(LEVELS).find((l) => l.id === new_level.toLowerCase());
    if (!newLevelObj) return { success: false, error: `无效的职级: ${new_level}`, validLevels: Object.values(LEVELS).map((l) => ({ id: l.id, name: l.name })) };
    const currentLevelObj = LEVELS[config.level?.toUpperCase()] || { rank: 0 };
    if (newLevelObj.rank <= currentLevelObj.rank) return { success: false, error: `新职级（${newLevelObj.name}）不高于当前职级（${currentLevelObj.name}）。如需降级请使用 hr_demote_agent` };
    const result = agentConfigStore.addPromotionRecord(agent_id, {
      fromLevel: config.level,
      toLevel: new_level.toLowerCase(),
      fromTitle: config.title,
      toTitle: new_title || config.title,
      reason,
    });
    if (!result.success) return result;
    logger.info('Agent 晋升', { agent_id, from: currentLevelObj.name, to: newLevelObj.name, reason });
    return {
      success: true,
      message: `已将「${config.name}」从 ${currentLevelObj.name} 晋升为 ${newLevelObj.name}`,
      agent: { id: agent_id, name: config.name, previousLevel: currentLevelObj.name, newLevel: newLevelObj.name },
    };
  },
};

const hrDemoteAgentTool = {
  name: 'hr_demote_agent',
  description: '正式降级一个 Agent 的职级。',
  category: 'hr',
  parameters: {
    agent_id: { type: 'string', description: 'Agent ID', required: true },
    new_level: { type: 'string', description: '新职级 ID（必须低于当前职级）', required: true },
    new_title: { type: 'string', description: '新的职位头衔（可选）', required: false },
    reason: { type: 'string', description: '降级原因', required: true },
  },
  requiredPermissions: [],
  async execute(args) {
    const { agent_id, new_level, new_title, reason } = args;
    if (!agent_id) return { success: false, error: '必须指定 agent_id' };
    if (!new_level) return { success: false, error: '必须指定 new_level' };
    if (!reason) return { success: false, error: '必须提供降级原因' };
    const config = agentConfigStore.get(agent_id);
    if (!config) return { success: false, error: `找不到 Agent: ${agent_id}` };
    const newLevelObj = Object.values(LEVELS).find((l) => l.id === new_level.toLowerCase());
    if (!newLevelObj) return { success: false, error: `无效的职级: ${new_level}` };
    const currentLevelObj = LEVELS[config.level?.toUpperCase()] || { rank: 0 };
    if (newLevelObj.rank >= currentLevelObj.rank) return { success: false, error: `新职级（${newLevelObj.name}）不低于当前职级（${currentLevelObj.name}）。如需晋升请使用 hr_promote_agent` };
    const result = agentConfigStore.addPromotionRecord(agent_id, {
      fromLevel: config.level,
      toLevel: new_level.toLowerCase(),
      fromTitle: config.title,
      toTitle: new_title || config.title,
      reason: `【降级】${reason}`,
    });
    if (!result.success) return result;
    logger.info('Agent 降级', { agent_id, from: currentLevelObj.name, to: newLevelObj.name, reason });
    return {
      success: true,
      message: `已将「${config.name}」从 ${currentLevelObj.name} 降级为 ${newLevelObj.name}`,
      agent: { id: agent_id, name: config.name, previousLevel: currentLevelObj.name, newLevel: newLevelObj.name },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 绩效分析（简化版，无 Token 统计）
// ─────────────────────────────────────────────────────────────

const hrPerformanceReviewTool = {
  name: 'hr_performance_review',
  description: '查看 Agent 的人事基本信息（移动端简化版，无 Token 统计）。',
  category: 'hr',
  parameters: {
    agent_id: { type: 'string', description: '指定 Agent ID，不填则查看全部', required: false },
  },
  requiredPermissions: [],
  async execute(args) {
    const agentConfigs = args.agent_id ? [agentConfigStore.get(args.agent_id)].filter(Boolean) : agentConfigStore.getActive();
    const reviews = agentConfigs.map((config) => ({
      agentId: config.id,
      name: config.name,
      title: config.title,
      department: config.department,
      status: config.status || 'active',
      level: config.level,
    }));
    return { success: true, totalAgents: reviews.length, reviews };
  },
};

const hrTeamAnalyticsTool = {
  name: 'hr_team_analytics',
  description: '获取团队分析数据（人员统计）。',
  category: 'hr',
  parameters: { metric: { type: 'string', description: '分析维度：headcount（人员统计）, all（全部）。默认 all', required: false } },
  requiredPermissions: [],
  async execute(args) {
    const metric = args.metric || 'all';
    const allAgents = agentConfigStore.getAll();
    const activeAgents = allAgents.filter((a) => (a.status || 'active') === 'active');
    const result = { success: true, metric };
    if (metric === 'headcount' || metric === 'all') {
      const byDepartment = {};
      const byLevel = {};
      for (const agent of activeAgents) {
        const deptId = agent.department || 'other';
        const dept = DEPARTMENTS[deptId?.toUpperCase()] || { name: deptId };
        byDepartment[deptId] = byDepartment[deptId] || { name: dept.name, count: 0 };
        byDepartment[deptId].count++;
        const levelId = agent.level || 'other';
        const level = LEVELS[levelId?.toUpperCase()] || { name: levelId };
        byLevel[levelId] = byLevel[levelId] || { name: level.name, count: 0 };
        byLevel[levelId].count++;
      }
      result.headcount = {
        total: allAgents.length,
        active: activeAgents.length,
        suspended: allAgents.filter((a) => a.status === 'suspended').length,
        terminated: allAgents.filter((a) => a.status === 'terminated').length,
        coreMembers: CORE_AGENT_IDS.length,
        byDepartment: Object.values(byDepartment).sort((a, b) => b.count - a.count),
        byLevel: Object.values(byLevel).sort((a, b) => b.count - a.count),
      };
    }
    return result;
  },
};

// ─────────────────────────────────────────────────────────────
// 注册
// ─────────────────────────────────────────────────────────────

function registerHRTools() {
  toolRegistry.register(hrListAgentsTool);
  toolRegistry.register(hrUpdateAgentTool);
  toolRegistry.register(hrOrgChartTool);
  toolRegistry.register(hrSuspendAgentTool);
  toolRegistry.register(hrReinstateAgentTool);
  toolRegistry.register(hrPromoteAgentTool);
  toolRegistry.register(hrDemoteAgentTool);
  toolRegistry.register(hrPerformanceReviewTool);
  toolRegistry.register(hrTeamAnalyticsTool);
}

module.exports = {
  registerHRTools,
  hrListAgentsTool,
  hrUpdateAgentTool,
  hrOrgChartTool,
  hrSuspendAgentTool,
  hrReinstateAgentTool,
  hrPromoteAgentTool,
  hrDemoteAgentTool,
  hrPerformanceReviewTool,
  hrTeamAnalyticsTool,
};
