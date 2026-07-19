/**
 * SoloForge - HR 组织架构相关工具
 *
 * 包含：查看所有 Agent 人事信息、更新 Agent 人事信息、组织架构概览。
 * @module tools/hr-org-tools
 */

const {
  agentConfigStore,
  LEVELS,
  DEPARTMENTS,
  CORE_AGENT_IDS,
  AGENT_STATUS,
  getAgentDepartments,
} = require('./hr-shared');

/**
 * 查看所有 Agent 人事信息工具
 */
const hrListAgentsTool = {
  name: 'hr_list_agents',
  description: `查看所有 Agent 的人事信息，包括姓名、职位、职级、部门、状态、试用期等。

支持按部门和状态筛选。`,
  category: 'hr',
  parameters: {
    department: {
      type: 'string',
      description: '可选，按部门筛选（如 tech, finance, hr, admin, executive）',
      required: false,
    },
    status: {
      type: 'string',
      description: '可选，按状态筛选：active（在职）, suspended（停职）, terminated（已开除）。默认显示所有。',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    let agents = agentConfigStore.getAll();

    // 按部门筛选（支持多部门）
    if (args.department) {
      const filterDept = args.department.toLowerCase();
      agents = agents.filter((a) => {
        const depts = getAgentDepartments(a);
        return depts.some((d) => d.toLowerCase() === filterDept);
      });
    }

    // 按状态筛选
    if (args.status) {
      agents = agents.filter(
        (a) => (a.status || 'active') === args.status.toLowerCase()
      );
    }

    const now = new Date();

    // 格式化输出
    const result = agents.map((agent) => {
      const level = LEVELS[agent.level?.toUpperCase()] || { name: agent.level, rank: 0 };
      const depts = getAgentDepartments(agent);
      const deptNames = depts.map((d) => DEPARTMENTS[d?.toUpperCase()]?.name || d).join('、');
      const status = agent.status || 'active';

      // 试用期状态
      let probationStatus = null;
      if (agent.probationEnd) {
        const probEnd = new Date(agent.probationEnd);
        if (probEnd > now) {
          const daysLeft = Math.ceil((probEnd - now) / (1000 * 60 * 60 * 24));
          probationStatus = daysLeft <= 7 ? `试用期即将到期（${daysLeft}天）` : `试用中（剩余${daysLeft}天）`;
        } else {
          probationStatus = '试用期已过期，待确认转正';
        }
      }

      // 入职引导进度
      let onboardingProgress = null;
      if (agent.onboardingChecklist && agent.onboardingChecklist.length > 0) {
        const completed = agent.onboardingChecklist.filter((i) => i.completed).length;
        const total = agent.onboardingChecklist.length;
        onboardingProgress = completed < total ? `${completed}/${total}` : '已完成';
      }

      return {
        id: agent.id,
        name: agent.name,
        title: agent.title,
        level: level.name,
        levelRank: level.rank,
        departments: depts,
        departmentNames: deptNames,
        department: depts[0] || null, // 主部门（兼容旧格式）
        isMultiDepartment: depts.length > 1,
        description: agent.description || '',
        avatar: agent.avatar || '',
        status,
        isCoreAgent: CORE_AGENT_IDS.includes(agent.id),
        hireDate: agent.hireDate || null,
        probationStatus,
        onboardingProgress,
        suspendReason: status === 'suspended' ? agent.suspendReason : undefined,
        terminationReason: status === 'terminated' ? agent.terminationReason : undefined,
      };
    });

    // 按职级排序
    result.sort((a, b) => b.levelRank - a.levelRank);

    // 统计
    const allAgents = agentConfigStore.getAll();
    const statusCounts = {
      active: allAgents.filter((a) => (a.status || 'active') === 'active').length,
      suspended: allAgents.filter((a) => a.status === 'suspended').length,
      terminated: allAgents.filter((a) => a.status === 'terminated').length,
    };

    return {
      success: true,
      totalCount: result.length,
      statusCounts,
      agents: result,
      departments: Object.values(DEPARTMENTS).map((d) => ({ id: d.id, name: d.name })),
      levels: Object.values(LEVELS).map((l) => ({ id: l.id, name: l.name, rank: l.rank })),
    };
  },
};

/**
 * 更新 Agent 人事信息工具
 */
const hrUpdateAgentTool = {
  name: 'hr_update_agent',
  description: `更新 Agent 的人事信息，如姓名、职位、职级、职责描述等。

可更新的字段：
- name: 姓名
- title: 职位头衔
- level: 职级（c_level, vp, director, manager, senior, staff, intern, assistant）
- description: 职责描述
- avatar: 头像（emoji）

注意：部门管理请使用专用工具：
- hr_add_department: 添加部门
- hr_remove_department: 移除部门
- hr_set_primary_department: 设置主部门
- hr_transfer_agent: 完整调岗（会记录历史）`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID（如 ceo, cto, cfo, chro, secretary）',
      required: true,
    },
    name: {
      type: 'string',
      description: '新的姓名',
      required: false,
    },
    title: {
      type: 'string',
      description: '新的职位头衔',
      required: false,
    },
    level: {
      type: 'string',
      description: '新的职级 ID',
      required: false,
    },
    description: {
      type: 'string',
      description: '新的职责描述',
      required: false,
    },
    avatar: {
      type: 'string',
      description: '新的头像（emoji）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, ...updates } = args;

    if (!agent_id) {
      return { success: false, error: '必须指定 agent_id' };
    }

    // 检查是否有更新内容
    const validUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && value !== null && value !== '') {
        validUpdates[key] = value;
      }
    }

    if (Object.keys(validUpdates).length === 0) {
      return { success: false, error: '没有提供要更新的字段' };
    }

    // 验证职级
    if (validUpdates.level) {
      const levelExists = Object.values(LEVELS).some(
        (l) => l.id === validUpdates.level.toLowerCase()
      );
      if (!levelExists) {
        return {
          success: false,
          error: `无效的职级: ${validUpdates.level}`,
          validLevels: Object.values(LEVELS).map((l) => l.id),
        };
      }
      validUpdates.level = validUpdates.level.toLowerCase();
    }

    const result = agentConfigStore.update(agent_id, validUpdates);

    if (!result) {
      return { success: false, error: `找不到 Agent: ${agent_id}` };
    }

    logger.info('HR 更新 Agent 信息', { agent_id, updates: validUpdates });

    return {
      success: true,
      message: `已更新 ${result.name} 的信息`,
      agent: result,
    };
  },
};

/**
 * 获取组织架构概览
 */
const hrOrgChartTool = {
  name: 'hr_org_chart',
  description: '获取公司组织架构概览，按部门和职级展示所有成员（含状态标注）。',
  category: 'hr',
  parameters: {
    include_terminated: {
      type: 'boolean',
      description: '是否包含已开除的成员（默认 false）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    let agents = agentConfigStore.getAll();

    // 默认排除已开除
    if (!args.include_terminated) {
      agents = agents.filter((a) => (a.status || 'active') !== AGENT_STATUS.TERMINATED);
    }

    // 按部门分组（支持多部门，同一员工可出现在多个部门）
    const byDepartment = {};
    for (const agent of agents) {
      const depts = getAgentDepartments(agent);
      const agentDepts = depts.length > 0 ? depts : ['other'];
      
      for (const deptId of agentDepts) {
        const dept = DEPARTMENTS[deptId.toUpperCase()] || { id: deptId, name: deptId };

        if (!byDepartment[deptId]) {
          byDepartment[deptId] = {
            id: dept.id,
            name: dept.name,
            color: dept.color || '#6b7280',
            members: [],
          };
        }

        const level = LEVELS[agent.level?.toUpperCase()] || { name: agent.level, rank: 0 };
        const status = agent.status || 'active';
        // 判断是否为该员工的主部门
        const isPrimary = deptId === agentDepts[0];
        // 其他部门
        const otherDepts = agentDepts.filter((d) => d !== deptId);
        const crossDeptInfo = otherDepts.length > 0 
          ? otherDepts.map((d) => DEPARTMENTS[d?.toUpperCase()]?.name || d).join('、')
          : null;
        
        byDepartment[deptId].members.push({
          id: agent.id,
          name: agent.name,
          title: agent.title,
          level: level.name,
          levelRank: level.rank,
          avatar: agent.avatar,
          status,
          statusLabel: status === 'suspended' ? '停职中' : status === 'terminated' ? '已离职' : '在职',
          isPrimaryDepartment: isPrimary,
          crossDepartments: crossDeptInfo,
          isMultiDepartment: agentDepts.length > 1,
        });
      }
    }

    // 每个部门内按职级排序
    for (const dept of Object.values(byDepartment)) {
      dept.members.sort((a, b) => b.levelRank - a.levelRank);
    }

    // 统计信息
    const allAgents = agentConfigStore.getAll();
    const multiDeptCount = allAgents.filter((a) => {
      const depts = getAgentDepartments(a);
      return depts.length > 1 && (a.status || 'active') === 'active';
    }).length;
    
    const stats = {
      totalMembers: allAgents.filter((a) => (a.status || 'active') === 'active').length,
      suspendedCount: allAgents.filter((a) => a.status === 'suspended').length,
      terminatedCount: allAgents.filter((a) => a.status === 'terminated').length,
      departmentCount: Object.keys(byDepartment).length,
      cLevelCount: allAgents.filter((a) => a.level === 'c_level' && (a.status || 'active') === 'active').length,
      multiDepartmentCount: multiDeptCount,
    };

    return {
      success: true,
      stats,
      departments: Object.values(byDepartment),
      organizationInfo: agentConfigStore.getOrganizationInfo(),
    };
  },
};

module.exports = {
  hrListAgentsTool,
  hrUpdateAgentTool,
  hrOrgChartTool,
};
