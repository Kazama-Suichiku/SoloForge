/**
 * SoloForge - 招聘申请工具
 * 供 CXO 等业务方使用的招聘相关工具
 * @module tools/recruit-tools
 */

const { toolRegistry } = require('./tool-registry');
const { approvalQueue } = require('../agent-factory/approval-queue');
const { validateProfile, formatProfileForReview } = require('../agent-factory/agent-request');
const { agentConfigStore, LEVELS, DEPARTMENTS } = require('../config/agent-config-store');
const { logger } = require('../utils/logger');

/**
 * 提交招聘申请工具
 */
const recruitRequestTool = {
  name: 'recruit_request',
  description: `提交新 Agent 招聘申请。

作为业务负责人，你需要填写完整的"候选人简历"，包括：

【必填项】
- name: 候选人姓名
- title: 职位头衔
- department: 所属部门
- reason: 招聘原因（为什么需要这个人）

【强烈建议填写】（会影响 Agent 的实际表现）
- background: 背景介绍（虚拟的教育经历、工作经验，让 Agent 有"人设"）
- expertise: 专业领域（数组，核心技能清单）
- responsibilities: 主要职责（数组，日常工作内容）
- work_style: 工作风格（如何与人协作、沟通特点）
- personality: 性格特点（影响回复的语气和风格）

【可选项】
- avatar: 头像（emoji，默认 👤）
- level: 职级（默认 staff）
- reports_to: 汇报对象 Agent ID
- limitations: 不擅长的领域（数组）
- tools: 需要使用的工具列表（数组）
- model: LLM 模型
- token_budget: Token 预算

提交后会由 CHRO 审核。CHRO 可能会提出质疑，届时你需要回应或修订简历。`,
  category: 'recruit',
  parameters: {
    // 必填
    name: {
      type: 'string',
      description: '候选人姓名',
      required: true,
    },
    title: {
      type: 'string',
      description: '职位头衔',
      required: true,
    },
    department: {
      type: 'string',
      description: `所属部门 ID: ${Object.values(DEPARTMENTS).map((d) => d.id).join(', ')}`,
      required: true,
    },
    reason: {
      type: 'string',
      description: '招聘原因：为什么需要这个人？解决什么问题？',
      required: true,
    },

    // 建议填写
    background: {
      type: 'string',
      description: '背景介绍：虚拟的教育经历、工作经验、专业特长等',
      required: false,
    },
    expertise: {
      type: 'array',
      description: '专业领域：核心技能清单（字符串数组）',
      required: false,
    },
    responsibilities: {
      type: 'array',
      description: '主要职责：日常工作内容（字符串数组）',
      required: false,
    },
    work_style: {
      type: 'string',
      description: '工作风格：如何与人协作、沟通特点',
      required: false,
    },
    personality: {
      type: 'string',
      description: '性格特点：影响回复的语气和风格',
      required: false,
    },

    // 可选
    business_need: {
      type: 'string',
      description: '业务需求：更详细的问题描述和期望效果',
      required: false,
    },
    avatar: {
      type: 'string',
      description: '头像（emoji，默认 👤）',
      required: false,
    },
    level: {
      type: 'string',
      description: `职级 ID: ${Object.values(LEVELS).map((l) => l.id).join(', ')}`,
      required: false,
    },
    reports_to: {
      type: 'string',
      description: '汇报对象 Agent ID',
      required: false,
    },
    limitations: {
      type: 'array',
      description: '不擅长的领域（字符串数组）',
      required: false,
    },
    tools: {
      type: 'array',
      description: '需要使用的工具列表（字符串数组）',
      required: false,
    },
    model: {
      type: 'string',
      description: 'LLM 模型（默认使用系统默认模型）',
      required: false,
    },
    token_budget: {
      type: 'number',
      description: 'Token 预算（默认 100000）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const {
      name,
      title,
      department,
      reason,
      business_need,
      background,
      expertise,
      responsibilities,
      work_style,
      personality,
      avatar,
      level,
      reports_to,
      limitations,
      tools,
      model,
      token_budget,
    } = args;

    // 安全解析数组字段（LLM 可能传递字符串形式的 JSON 数组）
    const safeParseArray = (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          if (value.includes(',')) {
            return value.split(',').map((s) => s.trim()).filter(Boolean);
          }
        }
      }
      return [];
    };

    // 构建 profile
    const profile = {
      name,
      title,
      department,
      level: level || 'staff',
      reportsTo: reports_to || context?.agentId,
      avatar: avatar || '👤',
      background: background || '',
      expertise: safeParseArray(expertise),
      responsibilities: safeParseArray(responsibilities),
      workStyle: work_style || '',
      personality: personality || '',
      limitations: safeParseArray(limitations),
      tools: safeParseArray(tools),
      model: model || '',
      tokenBudget: token_budget || 100000,
    };

    // 验证
    const validation = validateProfile(profile);

    // 获取申请者信息
    const requesterConfig = agentConfigStore.get(context?.agentId) || {};

    // 提交申请
    const result = approvalQueue.submit({
      requesterId: context?.agentId || 'unknown',
      requesterName: requesterConfig.name || context?.agentName || '业务方',
      reason,
      businessNeed: business_need || '',
      profile,
    });

    if (!result.success) {
      return {
        success: false,
        errors: result.errors,
        warnings: result.warnings,
      };
    }

    logger.info('业务方提交招聘申请', {
      requestId: result.request.id,
      requester: context?.agentId,
      candidateName: name,
    });

    return {
      success: true,
      message: '招聘申请已提交，等待 CHRO 审核',
      requestId: result.request.id,
      warnings: result.warnings,
      profilePreview: formatProfileForReview(profile),
      nextStep: 'CHRO 可能会提出质疑，届时请使用 recruit_respond 工具回应或修订简历。',
    };
  },
};

/**
 * 回应 CHRO 质疑或修订简历
 */
const recruitRespondTool = {
  name: 'recruit_respond',
  description: `回应 CHRO 的质疑或提交简历修订。

当 CHRO 对你的招聘申请提出质疑后，使用此工具：
1. 回答问题：仅提供 answer，解释澄清
2. 修订简历：提供 answer + 需要修改的字段（支持修改 expertise, responsibilities, tools, model, token_budget 等）

修订后状态会回到 pending，CHRO 会重新审核。

【重要】如果 CHRO 要求配置工具权限和模型，请在此工具中使用 tools 和 model 参数提供，例如：
- tools: ["read_file", "write_file", "shell", "web_search"]
- model: "claude-sonnet-4-5"`,
  category: 'recruit',
  parameters: {
    request_id: {
      type: 'string',
      description: '招聘申请 ID',
      required: true,
    },
    answer: {
      type: 'string',
      description: '回应内容：回答质疑、解释原因等',
      required: true,
    },
    // 以下为可选的简历修订字段
    name: {
      type: 'string',
      description: '修订：候选人姓名',
      required: false,
    },
    title: {
      type: 'string',
      description: '修订：职位头衔',
      required: false,
    },
    department: {
      type: 'string',
      description: '修订：所属部门',
      required: false,
    },
    background: {
      type: 'string',
      description: '修订：背景介绍',
      required: false,
    },
    expertise: {
      type: 'array',
      description: '修订：专业领域',
      required: false,
    },
    responsibilities: {
      type: 'array',
      description: '修订：主要职责',
      required: false,
    },
    work_style: {
      type: 'string',
      description: '修订：工作风格',
      required: false,
    },
    personality: {
      type: 'string',
      description: '修订：性格特点',
      required: false,
    },
    limitations: {
      type: 'array',
      description: '修订：不擅长的领域',
      required: false,
    },
    level: {
      type: 'string',
      description: '修订：职级',
      required: false,
    },
    tools: {
      type: 'array',
      description: '修订：工具权限列表（字符串数组，如 ["read_file", "write_file", "shell"]）',
      required: false,
    },
    model: {
      type: 'string',
      description: '修订：使用的 LLM 模型（如 "claude-sonnet-4-5"）',
      required: false,
    },
    token_budget: {
      type: 'number',
      description: '修订：Token 预算',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const {
      request_id,
      answer,
      name,
      title,
      department,
      background,
      expertise,
      responsibilities,
      work_style,
      personality,
      limitations,
      level,
      tools,
      model,
      token_budget,
    } = args;

    if (!request_id) {
      return { success: false, error: '必须指定 request_id' };
    }
    if (!answer) {
      return { success: false, error: '必须提供回应内容' };
    }

    // 安全解析数组字段
    const safeParseArray = (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          if (value.includes(',')) {
            return value.split(',').map((s) => s.trim()).filter(Boolean);
          }
        }
      }
      return null; // 返回 null 表示未提供
    };

    // 收集修订字段
    const profileRevision = {};
    if (name) profileRevision.name = name;
    if (title) profileRevision.title = title;
    if (department) profileRevision.department = department;
    if (background) profileRevision.background = background;
    const parsedExpertise = safeParseArray(expertise);
    if (parsedExpertise) profileRevision.expertise = parsedExpertise;
    const parsedResponsibilities = safeParseArray(responsibilities);
    if (parsedResponsibilities) profileRevision.responsibilities = parsedResponsibilities;
    if (work_style) profileRevision.workStyle = work_style;
    if (personality) profileRevision.personality = personality;
    const parsedLimitations = safeParseArray(limitations);
    if (parsedLimitations) profileRevision.limitations = parsedLimitations;
    if (level) profileRevision.level = level;
    const parsedTools = safeParseArray(tools);
    if (parsedTools) profileRevision.tools = parsedTools;
    if (model) profileRevision.model = model;
    if (token_budget) profileRevision.tokenBudget = token_budget;

    const hasRevision = Object.keys(profileRevision).length > 0;

    // 获取回应者信息
    const responderConfig = agentConfigStore.get(context?.agentId) || {};

    const result = approvalQueue.respond(request_id, {
      authorId: context?.agentId || 'unknown',
      authorName: responderConfig.name || context?.agentName || '业务方',
      content: answer,
      profileRevision: hasRevision ? profileRevision : undefined,
    });

    if (!result.success) {
      return result;
    }

    logger.info('业务方回应招聘质疑', {
      requestId: request_id,
      authorId: context?.agentId,
      hasRevision,
    });

    if (hasRevision) {
      return {
        success: true,
        message: '已提交简历修订，等待 CHRO 重新审核',
        revisionCount: result.request.revisionCount,
        updatedFields: Object.keys(profileRevision),
        updatedProfile: formatProfileForReview(result.request.profile),
      };
    } else {
      return {
        success: true,
        message: '已回应质疑，等待 CHRO 继续审核',
        discussionCount: result.request.discussion.length,
      };
    }
  },
};

/**
 * 查看自己提交的招聘申请
 */
const recruitMyRequestsTool = {
  name: 'recruit_my_requests',
  description: '查看自己提交的招聘申请及其状态。',
  category: 'recruit',
  parameters: {
    status: {
      type: 'string',
      description: '筛选状态：pending, discussing, approved, rejected',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { status } = args;

    let requests = approvalQueue.getAll({
      requesterId: context?.agentId,
    });

    if (status) {
      requests = requests.filter((r) => r.status === status);
    }

    return {
      success: true,
      totalCount: requests.length,
      requests: requests.map((r) => ({
        id: r.id,
        candidateName: r.profile?.name || '(未命名)',
        candidateTitle: r.profile?.title || '(未指定)',
        status: r.status,
        revisionCount: r.revisionCount,
        discussionCount: r.discussion?.length || 0,
        createdAt: r.createdAt,
        lastActivity: r.updatedAt || r.createdAt,
        // 如果有待回应的质疑，提醒
        pendingQuestion:
          r.status === 'discussing'
            ? r.discussion
                .filter((d) => d.type === 'question')
                .slice(-1)[0]?.content?.slice(0, 100)
            : null,
      })),
    };
  },
};

/**
 * 注册招聘工具
 */
function registerRecruitTools() {
  toolRegistry.register(recruitRequestTool);
  toolRegistry.register(recruitRespondTool);
  toolRegistry.register(recruitMyRequestsTool);
}

module.exports = {
  recruitRequestTool,
  recruitRespondTool,
  recruitMyRequestsTool,
  registerRecruitTools,
};
