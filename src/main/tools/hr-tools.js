/**
 * SoloForge - HR 专属工具
 * CHRO 使用的人事管理工具，支持完整招聘流程、开除、停职、绩效、晋升等
 * @module tools/hr-tools
 */

const { toolRegistry } = require('./tool-registry');
const {
  agentConfigStore,
  LEVELS,
  DEPARTMENTS,
  CORE_AGENT_IDS,
  AGENT_STATUS,
  createDefaultOnboardingChecklist,
} = require('../config/agent-config-store');
const { approvalQueue } = require('../agent-factory/approval-queue');
const { terminationQueue } = require('../agent-factory/termination-queue');
const { formatProfileForReview, validateProfile } = require('../agent-factory/agent-request');
const { tokenTracker } = require('../budget/token-tracker');
const { budgetManager } = require('../budget/budget-manager');
const { logger } = require('../utils/logger');

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

    // 按部门筛选
    if (args.department) {
      agents = agents.filter(
        (a) => a.department?.toLowerCase() === args.department.toLowerCase()
      );
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
      const dept = DEPARTMENTS[agent.department?.toUpperCase()] || { name: agent.department };
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
        department: dept.name,
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
  description: `更新 Agent 的人事信息，如姓名、职位、职级、部门、职责描述等。

可更新的字段：
- name: 姓名
- title: 职位头衔
- level: 职级（c_level, vp, director, manager, senior, staff, intern, assistant）
- department: 部门（executive, tech, finance, admin, hr, product, marketing, sales, operations, legal）
- description: 职责描述
- avatar: 头像（emoji）`,
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
    department: {
      type: 'string',
      description: '新的部门 ID',
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

    // 验证部门
    if (validUpdates.department) {
      const deptExists = Object.values(DEPARTMENTS).some(
        (d) => d.id === validUpdates.department.toLowerCase()
      );
      if (!deptExists) {
        return {
          success: false,
          error: `无效的部门: ${validUpdates.department}`,
          validDepartments: Object.values(DEPARTMENTS).map((d) => d.id),
        };
      }
      validUpdates.department = validUpdates.department.toLowerCase();
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
 * 查看待审批的招聘申请（支持多轮讨论）
 */
const hrAgentRequestsTool = {
  name: 'agent_requests',
  description: `查看 Agent 招聘申请列表。

状态说明：
- pending: 待审核（新提交或已修订）
- discussing: 讨论中（已提出质疑，等待业务方回应）
- approved: 已批准
- rejected: 已拒绝

使用此工具查看申请详情，然后决定：
1. 批准（使用 agent_approve）
2. 拒绝（使用 agent_approve）
3. 提出质疑（使用 hr_question）`,
  category: 'hr',
  parameters: {
    status: {
      type: 'string',
      description: '筛选状态：pending, discussing, approved, rejected。不填则显示待处理的申请。',
      required: false,
    },
    request_id: {
      type: 'string',
      description: '如果提供，只查看指定申请的详细信息',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { status, request_id } = args;

    // 如果指定了 ID，返回详细信息
    if (request_id) {
      const details = approvalQueue.getFullDetails(request_id);
      if (!details) {
        return { success: false, error: '申请不存在' };
      }

      return {
        success: true,
        request: {
          id: details.id,
          status: details.status,
          requester: details.requesterName,
          requesterId: details.requesterId,
          reason: details.reason,
          businessNeed: details.businessNeed,
          revisionCount: details.revisionCount,
          createdAt: details.createdAt,
          updatedAt: details.updatedAt,
        },
        profile: details.formattedProfile,
        originalProfile: details.revisionCount > 0 ? details.formattedOriginalProfile : null,
        discussion: details.discussion.map((d) => ({
          author: d.authorName,
          type: d.type,
          content: d.content,
          time: d.createdAt,
        })),
        validation: validateProfile(details.profile),
      };
    }

    // 获取列表
    let requests;
    if (!status) {
      requests = approvalQueue.getPending();
    } else {
      requests = approvalQueue.getAll({ status });
    }

    const formattedRequests = requests.map((r) => ({
      id: r.id,
      candidateName: r.profile?.name || '(未命名)',
      candidateTitle: r.profile?.title || '(未指定)',
      department: r.profile?.department || '(未指定)',
      status: r.status,
      requester: r.requesterName,
      reason: r.reason?.slice(0, 100) + (r.reason?.length > 100 ? '...' : ''),
      revisionCount: r.revisionCount,
      discussionCount: r.discussion?.length || 0,
      createdAt: r.createdAt,
      lastActivity: r.updatedAt || r.createdAt,
    }));

    return {
      success: true,
      totalCount: formattedRequests.length,
      pendingCount: requests.filter((r) => r.status === 'pending').length,
      discussingCount: requests.filter((r) => r.status === 'discussing').length,
      requests: formattedRequests,
      hint: '使用 agent_requests(request_id="xxx") 查看完整详情',
    };
  },
};

/**
 * 对招聘申请提出质疑
 */
const hrQuestionTool = {
  name: 'hr_question',
  description: `对 Agent 招聘申请提出质疑或问题。

使用场景：
- 简历信息不完整（缺少关键技能、职责不清晰等）
- 对招聘必要性有疑问
- 职责与现有成员可能重叠
- 需要业务方补充更多信息

提出质疑后，状态会变为 "discussing"，等待业务方回应。
业务方可能会：
1. 回答你的问题
2. 修订简历（状态会回到 pending）`,
  category: 'hr',
  parameters: {
    request_id: {
      type: 'string',
      description: '招聘申请 ID',
      required: true,
    },
    question: {
      type: 'string',
      description: '质疑内容。尽量具体，指出需要改进的地方。',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { request_id, question } = args;

    if (!request_id) {
      return { success: false, error: '必须指定 request_id' };
    }
    if (!question) {
      return { success: false, error: '必须提供质疑内容' };
    }

    const agentConfig = agentConfigStore.get(context?.agentId || 'chro') || {};

    const result = approvalQueue.raiseQuestion(request_id, {
      reviewerId: context?.agentId || 'chro',
      reviewerName: agentConfig.name || 'CHRO',
      question,
    });

    if (!result.success) {
      return result;
    }

    logger.info('HR 提出质疑', { request_id, question: question.slice(0, 50) });

    return {
      success: true,
      message: '已提出质疑，等待业务方回应',
      request: {
        id: result.request.id,
        status: result.request.status,
        discussionCount: result.request.discussion.length,
      },
    };
  },
};

/**
 * 最终审批招聘申请
 */
const hrAgentApproveTool = {
  name: 'agent_approve',
  description: `最终审批 Agent 招聘申请。

审批前请确认：
1. 简历信息完整、合理
2. 招聘理由充分
3. 与现有成员职责不冲突
4. 预算已与 CFO 确认（或建议老板咨询 CFO）

如果信息不完整，请先使用 hr_question 提出质疑。`,
  category: 'hr',
  parameters: {
    request_id: {
      type: 'string',
      description: '招聘申请 ID',
      required: true,
    },
    approved: {
      type: 'boolean',
      description: '是否批准（true 批准 / false 拒绝）',
      required: true,
    },
    comment: {
      type: 'string',
      description: '审批意见。批准时说明认可的理由；拒绝时说明原因和改进建议。',
      required: true,
    },
    assigned_budget: {
      type: 'number',
      description: '如果批准，分配的 Token 预算。建议先向 CFO 确认。',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { request_id, approved, comment, assigned_budget } = args;

    if (!request_id) {
      return { success: false, error: '必须指定 request_id' };
    }

    if (approved === undefined || approved === null) {
      return { success: false, error: '必须指定 approved (true/false)' };
    }

    if (!comment) {
      return { success: false, error: '必须提供审批意见' };
    }

    const agentConfig = agentConfigStore.get(context?.agentId || 'chro') || {};

    const result = approvalQueue.review(request_id, {
      approved,
      reviewerId: context?.agentId || 'chro',
      reviewerName: agentConfig.name || 'CHRO',
      comment,
      assignedBudget: assigned_budget,
    });

    if (!result.success) {
      return result;
    }

    logger.info('HR 审批招聘申请', {
      request_id,
      approved,
      revisionCount: result.request.revisionCount,
    });

    if (approved) {
      return {
        success: true,
        message: '✅ 招聘申请已批准！',
        newAgent: {
          id: result.request.createdAgentId,
          name: result.request.profile.name,
          title: result.request.profile.title,
          department: result.request.profile.department,
        },
        nextStep: '新成员已加入团队。可使用 hr_list_agents 查看更新后的组织架构。',
      };
    } else {
      return {
        success: true,
        message: '❌ 招聘申请已拒绝',
        reason: comment,
        suggestion: '业务方可以根据反馈修改申请后重新提交。',
      };
    }
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

    // 按部门分组
    const byDepartment = {};
    for (const agent of agents) {
      const deptId = agent.department || 'other';
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
      byDepartment[deptId].members.push({
        id: agent.id,
        name: agent.name,
        title: agent.title,
        level: level.name,
        levelRank: level.rank,
        avatar: agent.avatar,
        status,
        statusLabel: status === 'suspended' ? '停职中' : status === 'terminated' ? '已离职' : '在职',
      });
    }

    // 每个部门内按职级排序
    for (const dept of Object.values(byDepartment)) {
      dept.members.sort((a, b) => b.levelRank - a.levelRank);
    }

    // 统计信息
    const allAgents = agentConfigStore.getAll();
    const stats = {
      totalMembers: allAgents.filter((a) => (a.status || 'active') === 'active').length,
      suspendedCount: allAgents.filter((a) => a.status === 'suspended').length,
      terminatedCount: allAgents.filter((a) => a.status === 'terminated').length,
      departmentCount: Object.keys(byDepartment).length,
      cLevelCount: allAgents.filter((a) => a.level === 'c_level' && (a.status || 'active') === 'active').length,
    };

    return {
      success: true,
      stats,
      departments: Object.values(byDepartment),
      organizationInfo: agentConfigStore.getOrganizationInfo(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 开除流程工具
// ═══════════════════════════════════════════════════════════════

/**
 * CHRO 提出开除申请（需要老板确认）
 */
const hrDismissRequestTool = {
  name: 'hr_dismiss_request',
  description: `提出开除 Agent 的申请。

开除申请需要老板确认后才会生效。提交后系统会自动通知老板。

注意：
- 核心成员（secretary, ceo, cto, cfo, chro）不可被开除
- 只能对动态创建的 Agent 提出开除
- 需要提供充分的开除原因和影响分析`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: '要开除的 Agent ID',
      required: true,
    },
    reason: {
      type: 'string',
      description: '开除原因（需详细说明，如绩效不达标、职责重叠等）',
      required: true,
    },
    severity: {
      type: 'string',
      description: '严重程度：normal（一般）或 urgent（紧急）',
      required: false,
    },
    impact_analysis: {
      type: 'string',
      description: '影响分析：开除后对团队和业务的影响，以及应对措施',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { agent_id, reason, severity, impact_analysis } = args;

    if (!agent_id) {
      return { success: false, error: '必须指定要开除的 Agent ID' };
    }
    if (!reason) {
      return { success: false, error: '必须提供开除原因' };
    }

    // 检查是否为核心 Agent
    if (CORE_AGENT_IDS.includes(agent_id)) {
      return { success: false, error: `${agent_id} 是核心成员，不可被开除` };
    }

    // 获取 Agent 信息
    const agentConfig = agentConfigStore.get(agent_id);
    if (!agentConfig) {
      return { success: false, error: `找不到 Agent: ${agent_id}` };
    }

    const agentStatus = agentConfig.status || 'active';
    if (agentStatus === AGENT_STATUS.TERMINATED) {
      return { success: false, error: `Agent ${agent_id} 已被开除` };
    }

    // 获取提出者信息
    const proposerConfig = agentConfigStore.get(context?.agentId || 'chro') || {};

    const result = terminationQueue.propose({
      agentId: agent_id,
      agentName: agentConfig.name,
      agentTitle: agentConfig.title,
      department: agentConfig.department,
      proposedBy: context?.agentId || 'chro',
      proposedByName: proposerConfig.name || 'CHRO',
      reason,
      severity: severity || 'normal',
      impactAnalysis: impact_analysis || '',
    });

    if (!result.success) {
      return result;
    }

    logger.info('CHRO 提出开除申请', {
      requestId: result.request.id,
      agentId: agent_id,
      agentName: agentConfig.name,
    });

    return {
      success: true,
      message: `已提交开除「${agentConfig.name}（${agentConfig.title}）」的申请，等待老板确认`,
      requestId: result.request.id,
      agent: {
        id: agent_id,
        name: agentConfig.name,
        title: agentConfig.title,
        department: agentConfig.department,
      },
      nextStep: '系统已自动通知老板，请等待老板的确认或拒绝。',
    };
  },
};

/**
 * 老板确认/拒绝开除申请（Secretary 使用）
 */
const dismissConfirmTool = {
  name: 'dismiss_confirm',
  description: `确认或拒绝 CHRO 提出的开除申请。

此工具由老板通过秘书使用。当 CHRO 提出开除某个 Agent 时，老板需要确认后才能执行。`,
  category: 'dismiss_confirm',
  parameters: {
    request_id: {
      type: 'string',
      description: '开除申请 ID',
      required: true,
    },
    approved: {
      type: 'boolean',
      description: '是否批准开除（true 批准 / false 拒绝）',
      required: true,
    },
    comment: {
      type: 'string',
      description: '老板的批复意见',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { request_id, approved, comment } = args;

    if (!request_id) {
      return { success: false, error: '必须指定 request_id' };
    }
    if (approved === undefined || approved === null) {
      return { success: false, error: '必须指定 approved (true/false)' };
    }

    const result = terminationQueue.confirm(request_id, {
      approved,
      comment: comment || (approved ? '同意开除' : '不同意开除'),
    });

    if (!result.success) {
      return result;
    }

    if (approved) {
      return {
        success: true,
        message: `已确认开除「${result.request.agentName}」`,
        request: {
          id: result.request.id,
          agentId: result.request.agentId,
          agentName: result.request.agentName,
          status: result.request.status,
        },
      };
    } else {
      return {
        success: true,
        message: `已拒绝开除「${result.request.agentName}」的申请`,
        request: {
          id: result.request.id,
          agentId: result.request.agentId,
          agentName: result.request.agentName,
          status: result.request.status,
        },
      };
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// 停职/复职工具
// ═══════════════════════════════════════════════════════════════

/**
 * CHRO 停职 Agent
 */
const hrSuspendAgentTool = {
  name: 'hr_suspend_agent',
  description: `停职一个 Agent。停职后该 Agent 将无法响应消息和执行任务。

CHRO 可以直接停职（不需要老板确认）。
核心成员（secretary, ceo, cto, cfo, chro）不可被停职。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: '要停职的 Agent ID',
      required: true,
    },
    reason: {
      type: 'string',
      description: '停职原因',
      required: true,
    },
    duration_days: {
      type: 'number',
      description: '停职天数（可选，不填则为无限期）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, reason, duration_days } = args;

    if (!agent_id) {
      return { success: false, error: '必须指定 agent_id' };
    }
    if (!reason) {
      return { success: false, error: '必须提供停职原因' };
    }

    const result = agentConfigStore.suspend(agent_id, reason);
    if (!result.success) {
      return result;
    }

    const durationInfo = duration_days ? `停职 ${duration_days} 天` : '无限期停职';

    logger.info('Agent 停职', { agent_id, reason, duration_days });

    return {
      success: true,
      message: `已将「${result.agent.name}（${result.agent.title}）」停职`,
      agent: {
        id: agent_id,
        name: result.agent.name,
        title: result.agent.title,
        status: 'suspended',
      },
      duration: durationInfo,
      note: '停职期间该 Agent 无法响应消息。使用 hr_reinstate_agent 可恢复其工作状态。',
    };
  },
};

/**
 * CHRO 恢复停职 Agent
 */
const hrReinstateAgentTool = {
  name: 'hr_reinstate_agent',
  description: `恢复一个被停职的 Agent，使其回到正常工作状态。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: '要复职的 Agent ID',
      required: true,
    },
    comment: {
      type: 'string',
      description: '复职备注（如改进情况、后续要求等）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, comment } = args;

    if (!agent_id) {
      return { success: false, error: '必须指定 agent_id' };
    }

    const result = agentConfigStore.reinstate(agent_id, comment);
    if (!result.success) {
      return result;
    }

    logger.info('Agent 复职', { agent_id, comment });

    return {
      success: true,
      message: `已恢复「${result.agent.name}（${result.agent.title}）」的工作状态`,
      agent: {
        id: agent_id,
        name: result.agent.name,
        title: result.agent.title,
        status: 'active',
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 绩效分析工具
// ═══════════════════════════════════════════════════════════════

/**
 * 绩效分析工具
 */
const hrPerformanceReviewTool = {
  name: 'hr_performance_review',
  description: `查看 Agent 的绩效数据，包括 Token 使用量、调用次数、活跃度等。

可查看单个 Agent 或全部 Agent 的绩效数据，支持按时间段筛选。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: '指定 Agent ID。不填则查看全部 Agent。',
      required: false,
    },
    period: {
      type: 'string',
      description: '统计时间段：7d（7天）, 30d（30天）, 90d（90天）, all（全部）。默认 30d。',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, period } = args;

    // 计算时间范围
    const now = Date.now();
    const periodMap = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      'all': 0,
    };
    const periodMs = periodMap[period] || periodMap['30d'];
    const sinceTimestamp = periodMs > 0 ? now - periodMs : undefined;
    const periodLabel = period || '30d';

    // 获取 Token 使用统计
    const tokenSummaries = tokenTracker.getSummary(agent_id || undefined, sinceTimestamp);

    // 获取 Agent 配置信息
    const agentConfigs = agent_id
      ? [agentConfigStore.get(agent_id)].filter(Boolean)
      : agentConfigStore.getActive();

    // 获取预算信息
    let budgetInfo = {};
    try {
      if (agent_id) {
        budgetInfo[agent_id] = budgetManager.getAgentBudget(agent_id);
      } else {
        for (const config of agentConfigs) {
          budgetInfo[config.id] = budgetManager.getAgentBudget(config.id);
        }
      }
    } catch {
      // budgetManager 可能没有某些 Agent 的预算数据
    }

    // 构建绩效报告
    const reviews = agentConfigs.map((config) => {
      const tokenData = tokenSummaries.find((s) => s.agentId === config.id) || {
        totalTokens: 0,
        callCount: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        lastUsed: '无记录',
      };
      const budget = budgetInfo[config.id];

      return {
        agentId: config.id,
        name: config.name,
        title: config.title,
        department: config.department,
        status: config.status || 'active',
        metrics: {
          totalTokens: tokenData.totalTokens,
          promptTokens: tokenData.totalPromptTokens,
          completionTokens: tokenData.totalCompletionTokens,
          callCount: tokenData.callCount,
          avgTokensPerCall: tokenData.callCount > 0
            ? Math.round(tokenData.totalTokens / tokenData.callCount)
            : 0,
          lastUsed: tokenData.lastUsed,
        },
        budget: budget ? {
          dailyLimit: budget.dailyLimit,
          totalLimit: budget.totalLimit,
          todayUsed: budget.todayUsed || 0,
          totalUsed: budget.totalUsed || 0,
          utilization: budget.totalLimit > 0
            ? `${Math.round(((budget.totalUsed || 0) / budget.totalLimit) * 100)}%`
            : 'N/A',
        } : null,
        hireDate: config.hireDate || null,
        probationEnd: config.probationEnd || null,
      };
    });

    // 排名
    const byTokens = [...reviews].sort((a, b) => b.metrics.totalTokens - a.metrics.totalTokens);
    const byActivity = [...reviews].sort((a, b) => b.metrics.callCount - a.metrics.callCount);

    return {
      success: true,
      period: periodLabel,
      totalAgents: reviews.length,
      reviews,
      rankings: {
        byTokenUsage: byTokens.slice(0, 10).map((r, i) => ({
          rank: i + 1,
          name: r.name,
          agentId: r.agentId,
          totalTokens: r.metrics.totalTokens,
        })),
        byActivity: byActivity.slice(0, 10).map((r, i) => ({
          rank: i + 1,
          name: r.name,
          agentId: r.agentId,
          callCount: r.metrics.callCount,
        })),
      },
    };
  },
};

/**
 * 团队分析工具
 */
const hrTeamAnalyticsTool = {
  name: 'hr_team_analytics',
  description: `获取团队分析数据，包括人员统计、Token 花费分布、活跃度等。

可生成完整的 HR 仪表板数据。`,
  category: 'hr',
  parameters: {
    metric: {
      type: 'string',
      description: '分析维度：headcount（人员统计）, token_spend（Token花费）, activity（活跃度）, budget_utilization（预算使用率）, all（全部）。默认 all。',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const metric = args.metric || 'all';
    const allAgents = agentConfigStore.getAll();
    const activeAgents = allAgents.filter((a) => (a.status || 'active') === 'active');
    const result = { success: true, metric };

    // 人员统计
    if (metric === 'headcount' || metric === 'all') {
      const byDepartment = {};
      const byLevel = {};

      for (const agent of activeAgents) {
        const deptId = agent.department || 'other';
        const dept = DEPARTMENTS[deptId.toUpperCase()] || { name: deptId };
        byDepartment[deptId] = byDepartment[deptId] || { name: dept.name, count: 0 };
        byDepartment[deptId].count++;

        const levelId = agent.level || 'other';
        const level = LEVELS[levelId.toUpperCase()] || { name: levelId };
        byLevel[levelId] = byLevel[levelId] || { name: level.name, count: 0 };
        byLevel[levelId].count++;
      }

      // 试用期人员
      const onProbation = activeAgents.filter((a) => a.probationEnd && new Date(a.probationEnd) > new Date());

      result.headcount = {
        total: allAgents.length,
        active: activeAgents.length,
        suspended: allAgents.filter((a) => a.status === 'suspended').length,
        terminated: allAgents.filter((a) => a.status === 'terminated').length,
        coreMembers: CORE_AGENT_IDS.length,
        dynamicMembers: activeAgents.length - activeAgents.filter((a) => CORE_AGENT_IDS.includes(a.id)).length,
        onProbation: onProbation.length,
        byDepartment: Object.values(byDepartment).sort((a, b) => b.count - a.count),
        byLevel: Object.values(byLevel).sort((a, b) => b.count - a.count),
      };
    }

    // Token 花费分布
    if (metric === 'token_spend' || metric === 'all') {
      const last30Days = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const summaries = tokenTracker.getSummary(undefined, last30Days);

      const byAgent = summaries.map((s) => {
        const config = agentConfigStore.get(s.agentId);
        return {
          agentId: s.agentId,
          name: config?.name || s.agentId,
          department: config?.department || 'unknown',
          totalTokens: s.totalTokens,
          callCount: s.callCount,
        };
      }).sort((a, b) => b.totalTokens - a.totalTokens);

      // 按部门汇总
      const byDept = {};
      for (const item of byAgent) {
        const dept = item.department;
        byDept[dept] = byDept[dept] || { department: dept, totalTokens: 0, callCount: 0 };
        byDept[dept].totalTokens += item.totalTokens;
        byDept[dept].callCount += item.callCount;
      }

      const totalUsage = tokenTracker.getTotalUsage(last30Days);

      result.tokenSpend = {
        period: '近30天',
        total: totalUsage,
        byAgent: byAgent.slice(0, 20),
        byDepartment: Object.values(byDept).sort((a, b) => b.totalTokens - a.totalTokens),
      };
    }

    // 活跃度
    if (metric === 'activity' || metric === 'all') {
      const last7Days = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentSummaries = tokenTracker.getSummary(undefined, last7Days);

      const activeIds = new Set(recentSummaries.map((s) => s.agentId));
      const inactiveAgents = activeAgents
        .filter((a) => !activeIds.has(a.id))
        .map((a) => ({ id: a.id, name: a.name, title: a.title }));

      result.activity = {
        period: '近7天',
        activeCount: activeIds.size,
        inactiveCount: inactiveAgents.length,
        inactiveAgents,
        mostActive: recentSummaries
          .sort((a, b) => b.callCount - a.callCount)
          .slice(0, 5)
          .map((s) => {
            const config = agentConfigStore.get(s.agentId);
            return { agentId: s.agentId, name: config?.name || s.agentId, callCount: s.callCount };
          }),
      };
    }

    // 预算使用率
    if (metric === 'budget_utilization' || metric === 'all') {
      const budgetData = [];
      for (const agent of activeAgents) {
        try {
          const budget = budgetManager.getAgentBudget(agent.id);
          if (budget && budget.totalLimit > 0) {
            budgetData.push({
              agentId: agent.id,
              name: agent.name,
              totalLimit: budget.totalLimit,
              totalUsed: budget.totalUsed || 0,
              utilization: Math.round(((budget.totalUsed || 0) / budget.totalLimit) * 100),
            });
          }
        } catch {
          // 忽略没有预算的 Agent
        }
      }

      budgetData.sort((a, b) => b.utilization - a.utilization);

      result.budgetUtilization = {
        agentsWithBudget: budgetData.length,
        overBudget: budgetData.filter((b) => b.utilization > 100),
        highUsage: budgetData.filter((b) => b.utilization >= 80 && b.utilization <= 100),
        normalUsage: budgetData.filter((b) => b.utilization < 80),
        details: budgetData,
      };
    }

    return result;
  },
};

// ═══════════════════════════════════════════════════════════════
// 晋升/降级工具
// ═══════════════════════════════════════════════════════════════

/**
 * 正式晋升 Agent
 */
const hrPromoteAgentTool = {
  name: 'hr_promote_agent',
  description: `正式晋升一个 Agent 的职级。

与 hr_update_agent 不同，晋升会：
1. 记录晋升历史（可追溯）
2. 自动通知当事人和相关 Agent
3. 向老板汇报

可用职级（从低到高）：intern, assistant, staff, senior, manager, director, vp, c_level`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID',
      required: true,
    },
    new_level: {
      type: 'string',
      description: '新职级 ID（必须高于当前职级）',
      required: true,
    },
    new_title: {
      type: 'string',
      description: '新的职位头衔（可选，不填则保持原头衔）',
      required: false,
    },
    reason: {
      type: 'string',
      description: '晋升原因（表现优异的具体体现）',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, new_level, new_title, reason } = args;

    if (!agent_id) return { success: false, error: '必须指定 agent_id' };
    if (!new_level) return { success: false, error: '必须指定 new_level' };
    if (!reason) return { success: false, error: '必须提供晋升原因' };

    const config = agentConfigStore.get(agent_id);
    if (!config) return { success: false, error: `找不到 Agent: ${agent_id}` };

    // 验证新职级
    const newLevelObj = Object.values(LEVELS).find((l) => l.id === new_level.toLowerCase());
    if (!newLevelObj) {
      return {
        success: false,
        error: `无效的职级: ${new_level}`,
        validLevels: Object.values(LEVELS).map((l) => ({ id: l.id, name: l.name })),
      };
    }

    const currentLevelObj = LEVELS[config.level?.toUpperCase()] || { rank: 0 };
    if (newLevelObj.rank <= currentLevelObj.rank) {
      return {
        success: false,
        error: `新职级（${newLevelObj.name}）不高于当前职级（${currentLevelObj.name}）。如需降级请使用 hr_demote_agent`,
      };
    }

    // 记录并执行晋升
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
      agent: {
        id: agent_id,
        name: config.name,
        previousLevel: currentLevelObj.name,
        newLevel: newLevelObj.name,
        previousTitle: config.title,
        newTitle: new_title || config.title,
      },
      note: '建议使用 notify_boss 向老板汇报此晋升决定。',
    };
  },
};

/**
 * 正式降级 Agent
 */
const hrDemoteAgentTool = {
  name: 'hr_demote_agent',
  description: `正式降级一个 Agent 的职级。

降级会记录到晋升历史中，并通知相关人员。需要提供充分的降级原因。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID',
      required: true,
    },
    new_level: {
      type: 'string',
      description: '新职级 ID（必须低于当前职级）',
      required: true,
    },
    new_title: {
      type: 'string',
      description: '新的职位头衔（可选）',
      required: false,
    },
    reason: {
      type: 'string',
      description: '降级原因（必须详细说明）',
      required: true,
    },
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
    if (!newLevelObj) {
      return {
        success: false,
        error: `无效的职级: ${new_level}`,
        validLevels: Object.values(LEVELS).map((l) => ({ id: l.id, name: l.name })),
      };
    }

    const currentLevelObj = LEVELS[config.level?.toUpperCase()] || { rank: 0 };
    if (newLevelObj.rank >= currentLevelObj.rank) {
      return {
        success: false,
        error: `新职级（${newLevelObj.name}）不低于当前职级（${currentLevelObj.name}）。如需晋升请使用 hr_promote_agent`,
      };
    }

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
      agent: {
        id: agent_id,
        name: config.name,
        previousLevel: currentLevelObj.name,
        newLevel: newLevelObj.name,
        previousTitle: config.title,
        newTitle: new_title || config.title,
      },
      note: '建议使用 notify_boss 向老板汇报此决定。',
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 试用期管理工具
// ═══════════════════════════════════════════════════════════════

/**
 * 试用期管理工具
 */
const hrEndProbationTool = {
  name: 'hr_end_probation',
  description: `管理 Agent 的试用期。

操作类型：
- confirm: 转正（试用期通过）
- extend: 延长试用期
- terminate: 试用期不合格，提出开除`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID',
      required: true,
    },
    action: {
      type: 'string',
      description: '操作类型：confirm（转正）, extend（延长试用期）, terminate（不合格开除）',
      required: true,
    },
    comment: {
      type: 'string',
      description: '备注说明（转正评语、延长原因或不合格原因）',
      required: true,
    },
    extend_days: {
      type: 'number',
      description: '延长天数（仅 action=extend 时需要）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { agent_id, action, comment, extend_days } = args;

    if (!agent_id) return { success: false, error: '必须指定 agent_id' };
    if (!action) return { success: false, error: '必须指定 action' };
    if (!comment) return { success: false, error: '必须提供备注说明' };

    const config = agentConfigStore.get(agent_id);
    if (!config) return { success: false, error: `找不到 Agent: ${agent_id}` };

    if (!config.probationEnd) {
      return { success: false, error: `Agent ${config.name} 不在试用期中` };
    }

    switch (action) {
      case 'confirm': {
        // 转正
        agentConfigStore.update(agent_id, {
          probationEnd: null, // 清除试用期
        });
        logger.info('Agent 转正', { agent_id, comment });
        return {
          success: true,
          message: `「${config.name}」已正式转正！`,
          agent: { id: agent_id, name: config.name, title: config.title },
          comment,
        };
      }

      case 'extend': {
        if (!extend_days || extend_days <= 0) {
          return { success: false, error: '必须指定有效的 extend_days（正整数）' };
        }
        const currentEnd = new Date(config.probationEnd);
        const newEnd = new Date(Math.max(currentEnd.getTime(), Date.now()) + extend_days * 24 * 60 * 60 * 1000);
        agentConfigStore.update(agent_id, { probationEnd: newEnd.toISOString() });
        logger.info('延长试用期', { agent_id, extend_days, newEnd: newEnd.toISOString() });
        return {
          success: true,
          message: `「${config.name}」的试用期已延长 ${extend_days} 天，新截止日期：${newEnd.toLocaleDateString('zh-CN')}`,
          agent: { id: agent_id, name: config.name },
          newProbationEnd: newEnd.toISOString(),
        };
      }

      case 'terminate': {
        // 试用期不合格，走开除流程
        const proposerConfig = agentConfigStore.get(context?.agentId || 'chro') || {};
        const result = terminationQueue.propose({
          agentId: agent_id,
          agentName: config.name,
          agentTitle: config.title,
          department: config.department,
          proposedBy: context?.agentId || 'chro',
          proposedByName: proposerConfig.name || 'CHRO',
          reason: `试用期不合格：${comment}`,
          severity: 'normal',
          impactAnalysis: '试用期员工，开除影响较小。',
        });

        if (!result.success) return result;

        logger.info('试用期不合格，提出开除', { agent_id, comment });
        return {
          success: true,
          message: `「${config.name}」试用期不合格，已提交开除申请（需老板确认）`,
          requestId: result.request.id,
          agent: { id: agent_id, name: config.name },
        };
      }

      default:
        return { success: false, error: `无效的操作类型: ${action}。可用值: confirm, extend, terminate` };
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// 入职引导工具
// ═══════════════════════════════════════════════════════════════

/**
 * 入职引导管理工具
 */
const hrOnboardingStatusTool = {
  name: 'hr_onboarding_status',
  description: `查看和管理 Agent 的入职引导进度。

新员工入职后会自动生成入职引导清单，CHRO 可以查看进度和标记完成。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID',
      required: true,
    },
    action: {
      type: 'string',
      description: '操作类型：view（查看进度）, update（更新某项）, reset（重置清单）。默认 view。',
      required: false,
    },
    item_id: {
      type: 'string',
      description: '清单项 ID（action=update 时需要）',
      required: false,
    },
    completed: {
      type: 'boolean',
      description: '是否完成（action=update 时需要）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, action, item_id, completed } = args;

    if (!agent_id) return { success: false, error: '必须指定 agent_id' };

    const config = agentConfigStore.get(agent_id);
    if (!config) return { success: false, error: `找不到 Agent: ${agent_id}` };

    const currentAction = action || 'view';

    switch (currentAction) {
      case 'view': {
        const checklist = config.onboardingChecklist || [];
        if (checklist.length === 0) {
          return {
            success: true,
            message: `「${config.name}」没有入职引导清单（可能是核心成员或清单已删除）`,
            agent: { id: agent_id, name: config.name },
            checklist: [],
          };
        }

        const completedCount = checklist.filter((i) => i.completed).length;
        return {
          success: true,
          agent: { id: agent_id, name: config.name, title: config.title, hireDate: config.hireDate },
          progress: `${completedCount}/${checklist.length}`,
          isComplete: completedCount === checklist.length,
          checklist,
        };
      }

      case 'update': {
        if (!item_id) return { success: false, error: 'action=update 时必须提供 item_id' };
        if (completed === undefined || completed === null) {
          return { success: false, error: 'action=update 时必须提供 completed (true/false)' };
        }

        const checklist = config.onboardingChecklist || [];
        const item = checklist.find((i) => i.id === item_id);
        if (!item) {
          return {
            success: false,
            error: `找不到清单项: ${item_id}`,
            availableItems: checklist.map((i) => ({ id: i.id, title: i.title })),
          };
        }

        item.completed = completed;
        item.completedAt = completed ? new Date().toISOString() : null;
        agentConfigStore.update(agent_id, { onboardingChecklist: checklist });

        const completedCount = checklist.filter((i) => i.completed).length;
        return {
          success: true,
          message: `已${completed ? '完成' : '取消完成'}「${item.title}」`,
          progress: `${completedCount}/${checklist.length}`,
          isComplete: completedCount === checklist.length,
        };
      }

      case 'reset': {
        const newChecklist = createDefaultOnboardingChecklist();
        agentConfigStore.update(agent_id, { onboardingChecklist: newChecklist });
        return {
          success: true,
          message: `已重置「${config.name}」的入职引导清单`,
          checklist: newChecklist,
        };
      }

      default:
        return { success: false, error: `无效的操作: ${currentAction}。可用值: view, update, reset` };
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// 工具注册
// ═══════════════════════════════════════════════════════════════

/**
 * 注册 HR 工具
 */
function registerHRTools() {
  // 基础人事管理
  toolRegistry.register(hrListAgentsTool);
  toolRegistry.register(hrUpdateAgentTool);
  toolRegistry.register(hrOrgChartTool);

  // 招聘审批
  toolRegistry.register(hrAgentRequestsTool);
  toolRegistry.register(hrQuestionTool);
  toolRegistry.register(hrAgentApproveTool);

  // 开除流程
  toolRegistry.register(hrDismissRequestTool);
  toolRegistry.register(dismissConfirmTool);

  // 停职/复职
  toolRegistry.register(hrSuspendAgentTool);
  toolRegistry.register(hrReinstateAgentTool);

  // 绩效分析
  toolRegistry.register(hrPerformanceReviewTool);
  toolRegistry.register(hrTeamAnalyticsTool);

  // 晋升/降级
  toolRegistry.register(hrPromoteAgentTool);
  toolRegistry.register(hrDemoteAgentTool);

  // 试用期管理
  toolRegistry.register(hrEndProbationTool);

  // 入职引导
  toolRegistry.register(hrOnboardingStatusTool);
}

module.exports = {
  hrListAgentsTool,
  hrUpdateAgentTool,
  hrAgentRequestsTool,
  hrQuestionTool,
  hrAgentApproveTool,
  hrOrgChartTool,
  hrDismissRequestTool,
  dismissConfirmTool,
  hrSuspendAgentTool,
  hrReinstateAgentTool,
  hrPerformanceReviewTool,
  hrTeamAnalyticsTool,
  hrPromoteAgentTool,
  hrDemoteAgentTool,
  hrEndProbationTool,
  hrOnboardingStatusTool,
  registerHRTools,
};
