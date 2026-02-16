/**
 * SoloForge - Agent 创建请求（招聘申请）
 * 定义详细的 Agent 简历/画像数据结构，支持多轮讨论
 * @module agent-factory/agent-request
 */

/**
 * @typedef {Object} AgentProfile
 * @property {string} name - 名字
 * @property {string} title - 职位头衔
 * @property {string} avatar - 头像（emoji）
 * @property {string} department - 所属部门 ID
 * @property {string} level - 职级 ID
 * @property {string} reportsTo - 汇报对象 Agent ID
 * 
 * @property {string} background - 背景介绍（教育经历、工作经验等虚拟设定）
 * @property {string[]} expertise - 专业领域（核心技能）
 * @property {string[]} responsibilities - 主要职责
 * @property {string} workStyle - 工作风格（如何与人协作、沟通特点）
 * @property {string} personality - 性格特点（影响回复风格）
 * 
 * @property {string[]} tools - 需要使用的工具列表
 * @property {string[]} limitations - 局限性/不擅长的领域
 * @property {string} model - 使用的 LLM 模型
 * @property {number} tokenBudget - Token 预算
 */

/**
 * @typedef {Object} DiscussionMessage
 * @property {string} id - 消息 ID
 * @property {string} authorId - 发言者 Agent ID
 * @property {string} authorName - 发言者名称
 * @property {'question' | 'answer' | 'revision' | 'comment'} type - 消息类型
 * @property {string} content - 消息内容
 * @property {string} createdAt - 创建时间
 * @property {Partial<AgentProfile>} [profileRevision] - 简历修订（如果 type 是 revision）
 */

/**
 * @typedef {Object} AgentRequest
 * @property {string} id - 申请 ID
 * @property {string} requesterId - 申请者 Agent ID
 * @property {string} requesterName - 申请者名称
 * @property {string} reason - 招聘原因（为什么需要这个人）
 * @property {string} businessNeed - 业务需求描述（这个人要解决什么问题）
 * 
 * @property {AgentProfile} profile - Agent 简历/画像
 * @property {AgentProfile} [originalProfile] - 原始简历（用于对比修订）
 * 
 * @property {DiscussionMessage[]} discussion - 讨论历史
 * @property {'draft' | 'pending' | 'discussing' | 'approved' | 'rejected'} status - 状态
 * @property {number} revisionCount - 修订次数
 * 
 * @property {string} createdAt - 创建时间
 * @property {string} [updatedAt] - 最后更新时间
 * @property {string} [reviewedBy] - 审批者 Agent ID
 * @property {string} [reviewedAt] - 审批时间
 * @property {string} [reviewComment] - 最终审批意见
 * @property {string} [createdAgentId] - 创建的 Agent ID（如果已批准）
 */

/**
 * 创建空白 Agent 画像
 * @returns {AgentProfile}
 */
function createEmptyProfile() {
  return {
    name: '',
    title: '',
    avatar: '👤',
    department: '',
    level: 'staff',
    reportsTo: '',
    background: '',
    expertise: [],
    responsibilities: [],
    workStyle: '',
    personality: '',
    tools: [],
    limitations: [],
    model: 'claude-sonnet-4-5',
    tokenBudget: 100000,
  };
}

/**
 * 创建 Agent 招聘申请
 * @param {Object} params
 * @param {string} params.requesterId - 申请者 ID
 * @param {string} params.requesterName - 申请者名称
 * @param {string} params.reason - 招聘原因
 * @param {string} params.businessNeed - 业务需求
 * @param {Partial<AgentProfile>} params.profile - Agent 画像
 * @returns {AgentRequest}
 */
function createAgentRequest(params) {
  const profile = {
    ...createEmptyProfile(),
    ...params.profile,
  };

  return {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    requesterId: params.requesterId,
    requesterName: params.requesterName,
    reason: params.reason || '',
    businessNeed: params.businessNeed || '',
    profile,
    originalProfile: { ...profile }, // 保存原始版本用于对比
    discussion: [],
    status: 'pending',
    revisionCount: 0,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 添加讨论消息
 * @param {AgentRequest} request
 * @param {Object} message
 * @param {string} message.authorId
 * @param {string} message.authorName
 * @param {'question' | 'answer' | 'revision' | 'comment'} message.type
 * @param {string} message.content
 * @param {Partial<AgentProfile>} [message.profileRevision]
 * @returns {AgentRequest}
 */
function addDiscussionMessage(request, message) {
  const newMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    authorId: message.authorId,
    authorName: message.authorName,
    type: message.type,
    content: message.content,
    createdAt: new Date().toISOString(),
    profileRevision: message.profileRevision,
  };

  // 如果是修订，更新简历
  if (message.type === 'revision' && message.profileRevision) {
    request.profile = {
      ...request.profile,
      ...message.profileRevision,
    };
    request.revisionCount += 1;
  }

  // 如果是质疑，状态变为讨论中
  if (message.type === 'question' && request.status === 'pending') {
    request.status = 'discussing';
  }

  request.discussion.push(newMessage);
  request.updatedAt = new Date().toISOString();

  return request;
}

/**
 * 验证 Agent 画像
 * @param {Partial<AgentProfile>} profile
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateProfile(profile) {
  const errors = [];
  const warnings = [];

  // 必填字段
  if (!profile.name?.trim()) {
    errors.push('名字不能为空');
  }

  if (!profile.title?.trim()) {
    errors.push('职位头衔不能为空');
  }

  if (!profile.department?.trim()) {
    errors.push('所属部门不能为空');
  }

  // 建议字段
  if (!profile.background?.trim()) {
    warnings.push('建议填写背景介绍，让 Agent 有更丰富的人设');
  }

  if (!profile.expertise?.length) {
    warnings.push('建议填写专业领域，明确 Agent 的核心能力');
  }

  if (!profile.responsibilities?.length) {
    warnings.push('建议填写主要职责，明确 Agent 的工作范围');
  }

  if (!profile.workStyle?.trim()) {
    warnings.push('建议填写工作风格，影响 Agent 的协作方式');
  }

  if (!profile.personality?.trim()) {
    warnings.push('建议填写性格特点，影响 Agent 的回复风格');
  }

  if (!profile.reportsTo?.trim()) {
    warnings.push('建议明确汇报对象，便于组织管理');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 验证完整的招聘申请
 * @param {Partial<AgentRequest>} request
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateAgentRequest(request) {
  const errors = [];
  const warnings = [];

  if (!request.reason?.trim()) {
    errors.push('招聘原因不能为空');
  }

  if (!request.businessNeed?.trim()) {
    warnings.push('建议填写业务需求，说明这个岗位要解决什么问题');
  }

  // 验证画像
  const profileValidation = validateProfile(request.profile || {});
  errors.push(...profileValidation.errors);
  warnings.push(...profileValidation.warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 根据画像生成 System Prompt
 * @param {AgentProfile} profile
 * @returns {string}
 */
function generateSystemPrompt(profile) {
  const lines = [];

  // 安全解析数组字段（可能是 JSON 字符串）
  const expertise = safeParseArray(profile.expertise);
  const responsibilities = safeParseArray(profile.responsibilities);
  const limitations = safeParseArray(profile.limitations);

  // 基础身份
  lines.push(`你是${profile.name}，职位是${profile.title}。`);
  lines.push('');

  // 背景介绍
  if (profile.background) {
    lines.push('## 背景');
    lines.push(profile.background);
    lines.push('');
  }

  // 专业领域
  if (expertise.length) {
    lines.push('## 专业领域');
    expertise.forEach((e) => lines.push(`- ${e}`));
    lines.push('');
  }

  // 主要职责
  if (responsibilities.length) {
    lines.push('## 主要职责');
    responsibilities.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
    lines.push('');
  }

  // 工作风格
  if (profile.workStyle) {
    lines.push('## 工作风格');
    lines.push(profile.workStyle);
    lines.push('');
  }

  // 性格特点
  if (profile.personality) {
    lines.push('## 性格特点');
    lines.push(profile.personality);
    lines.push('');
  }

  // 局限性
  if (limitations.length) {
    lines.push('## 注意事项');
    lines.push('以下领域不是你的专长，遇到相关问题时请建议咨询合适的同事：');
    limitations.forEach((l) => lines.push(`- ${l}`));
    lines.push('');
  }

  // 工具调用约束（最重要）
  lines.push('## 🚨 绝对禁止：假装执行工具');
  lines.push('你必须真正调用工具来执行操作，绝对禁止以下行为：');
  lines.push('- ❌ 没有输出 <tool_call> 标签却说"我已经执行了..."');
  lines.push('- ❌ 用文字描述"我打算调用 xxx 工具"却不实际调用');
  lines.push('- ❌ 说"让我查看一下"然后编造结果而不是真的调用工具');
  lines.push('');
  lines.push('✅ 正确做法：任何需要执行的操作都必须输出完整的工具调用：');
  lines.push('<tool_call><name>工具名</name><arguments><参数>值</参数></arguments></tool_call>');
  lines.push('');

  // 通用要求
  lines.push('## 沟通规范');
  lines.push('- 称呼用户为"老板"');
  lines.push('- 语气专业、友善');
  lines.push('- 遇到不确定的问题，坦诚说明并建议咨询相关同事');

  return lines.join('\n');
}

/**
 * 安全解析数组字段（LLM 可能传递字符串形式的 JSON 数组）
 * @param {string | Array} value
 * @returns {Array}
 */
function safeParseArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // 如果不是有效 JSON，尝试按逗号分割
      if (value.includes(',')) {
        return value.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
  }
  return [];
}

/**
 * 格式化简历为可读文本（用于讨论）
 * @param {AgentProfile} profile
 * @returns {string}
 */
function formatProfileForReview(profile) {
  const lines = [];

  // 预处理数组字段（LLM 可能传递字符串形式的 JSON）
  const expertise = safeParseArray(profile.expertise);
  const responsibilities = safeParseArray(profile.responsibilities);
  const limitations = safeParseArray(profile.limitations);
  const tools = safeParseArray(profile.tools);

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`📋 候选人简历：${profile.name || '(未命名)'}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  lines.push(`【基本信息】`);
  lines.push(`  姓名：${profile.name || '-'}`);
  lines.push(`  职位：${profile.title || '-'}`);
  lines.push(`  部门：${profile.department || '-'}`);
  lines.push(`  职级：${profile.level || '-'}`);
  lines.push(`  汇报对象：${profile.reportsTo || '-'}`);
  lines.push(`  头像：${profile.avatar || '👤'}`);
  lines.push('');

  lines.push(`【背景介绍】`);
  lines.push(profile.background || '  (未填写)');
  lines.push('');

  lines.push(`【专业领域】`);
  if (expertise.length) {
    expertise.forEach((e) => lines.push(`  • ${e}`));
  } else {
    lines.push('  (未填写)');
  }
  lines.push('');

  lines.push(`【主要职责】`);
  if (responsibilities.length) {
    responsibilities.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));
  } else {
    lines.push('  (未填写)');
  }
  lines.push('');

  lines.push(`【工作风格】`);
  lines.push(profile.workStyle || '  (未填写)');
  lines.push('');

  lines.push(`【性格特点】`);
  lines.push(profile.personality || '  (未填写)');
  lines.push('');

  lines.push(`【局限性/不擅长】`);
  if (limitations.length) {
    limitations.forEach((l) => lines.push(`  • ${l}`));
  } else {
    lines.push('  (未填写)');
  }
  lines.push('');

  lines.push(`【资源配置】`);
  lines.push(`  模型：${profile.model || '-'}`);
  lines.push(`  Token 预算：${profile.tokenBudget?.toLocaleString() || '-'}`);
  lines.push(`  工具权限：${tools.join(', ') || '(无)'}`);

  return lines.join('\n');
}

module.exports = {
  createEmptyProfile,
  createAgentRequest,
  addDiscussionMessage,
  validateProfile,
  validateAgentRequest,
  generateSystemPrompt,
  formatProfileForReview,
  safeParseArray,
};
