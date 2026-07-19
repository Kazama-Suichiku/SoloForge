/**
 * SoloForge - HR 招聘审批相关工具
 *
 * 包含：查看待审批的招聘申请、对申请提出质疑、最终审批招聘申请。
 * @module tools/hr-approval-tools
 */

const {
  agentConfigStore,
  approvalQueue,
  validateProfile,
  logger,
} = require('./hr-shared');

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

module.exports = {
  hrAgentRequestsTool,
  hrQuestionTool,
  hrAgentApproveTool,
};
