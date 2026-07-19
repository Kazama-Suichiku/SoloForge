/**
 * SoloForge - 组织架构工具
 * 提供查看组织架构树、下属、上级、汇报链、团队状态等能力，
 * 以及基于组织架构的协作动作：越级上报、跨部门协作请求、向下属广播。
 *
 * 所有工具 category: 'collaboration'，让所有 Agent 都能使用。
 *
 * @module tools/org-chart-tools
 */

const { toolRegistry } = require('./tool-registry');
const { agentCommunication } = require('../collaboration/agent-communication');
const { agentConfigStore, LEVELS } = require('../config/agent-config-store');
const { getAgentDepartments, getPrimaryDepartment } = require('../config/agent-config-store');
const { orgChartService } = require('../collaboration/org-chart-service');
const { logger } = require('../utils/logger');

// ═══════════════════════════════════════════════════════════
// 内部辅助
// ═══════════════════════════════════════════════════════════

/**
 * 从工具上下文取调用者 agentId
 * @param {Object} context
 * @returns {string|null}
 * @private
 */
function _getAgentId(context) {
  return context?.agentId || null;
}

/**
 * 延迟获取 chatManager（避免循环依赖）
 * @returns {Object|null}
 * @private
 */
function _getChatManager() {
  try {
    const { chatManager } = require('../chat');
    return chatManager || null;
  } catch (e) {
    logger.debug('org-chart-tools: chatManager 加载失败:', e.message);
    return null;
  }
}

/**
 * 延迟加载 comm-event-store（与 collaboration-tools.js 一致，失败不阻断主流程）
 * @returns {Object|null}
 * @private
 */
let _commEventStore = null;
function _getCommEventStore() {
  if (!_commEventStore) {
    try {
      const m = require('../collaboration/comm-event-store');
      _commEventStore = m.commEventStore;
    } catch (e) {
      logger.debug('org-chart-tools: comm-event-store 加载失败:', e.message);
      _commEventStore = null;
    }
  }
  return _commEventStore;
}

/**
 * 写一条结构化通信事件（尽力写入，失败不影响主流程）
 * @param {Object} evt
 * @private
 */
function _appendCommEvent(evt) {
  try {
    const store = _getCommEventStore();
    if (store) store.append(evt);
  } catch (e) {
    logger.debug('org-chart-tools: 写通信事件失败（不影响主流程）:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// (1) get_org_chart — 查看完整组织架构树
// ═══════════════════════════════════════════════════════════

const getOrgChartTool = {
  name: 'get_org_chart',
  description: '查看完整组织架构树，包括所有层级的上下级关系。用于了解公司整体结构。',
  category: 'collaboration',
  parameters: {},
  requiredPermissions: [],
  async execute(_args, _context) {
    const tree = orgChartService.getOrgChart();
    if (!tree) {
      return { error: '未找到组织架构（缺少 CEO 或无在职 Agent）' };
    }
    return {
      success: true,
      root: tree,
      tip: '以上是从 CEO 开始的完整组织架构树，subordinates 为直接下属，按职级从高到低排序。',
    };
  },
};

// ═══════════════════════════════════════════════════════════
// (2) get_subordinates — 查看自己的直接下属
// ═══════════════════════════════════════════════════════════

const getSubordinatesTool = {
  name: 'get_subordinates',
  description: '查看自己的直接下属列表。用于委派任务前了解可用人力。',
  category: 'collaboration',
  parameters: {
    department: {
      type: 'string',
      description: '按部门过滤（如 tech、finance 等），不填则返回所有直接下属',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const agentId = _getAgentId(context);
    if (!agentId) return { error: '无法确定当前 Agent 身份' };

    const { department } = args || {};
    let subs = orgChartService.getSubordinates(agentId);

    if (department) {
      subs = subs.filter((n) => getAgentDepartments(n).includes(department));
    }

    if (subs.length === 0) {
      return {
        success: true,
        total: 0,
        subordinates: [],
        message: department
          ? `你在 ${department} 部门没有直接下属`
          : '你目前没有直接下属',
      };
    }

    return {
      success: true,
      total: subs.length,
      department: department || '全部',
      subordinates: subs,
      tip: '使用 delegate_task 可以向下属委派任务，使用 broadcast_to_subordinates 可以向所有下属广播消息。',
    };
  },
};

// ═══════════════════════════════════════════════════════════
// (3) get_direct_report — 查看某位同事的直接上级
// ═══════════════════════════════════════════════════════════

const getDirectReportTool = {
  name: 'get_direct_report',
  description: '查看某位同事的直接上级是谁。用于确定汇报路径。',
  category: 'collaboration',
  parameters: {
    agent_id: {
      type: 'string',
      description: '同事 ID（不填默认查自己的直接上级）',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const args_ = args || {};
    const callerId = _getAgentId(context);
    const targetId = args_.agent_id || callerId;

    if (!targetId) return { error: '无法确定要查询的同事' };

    // 通过 ID 或显示名解析
    const resolved = agentConfigStore.resolve(targetId);
    const resolvedId = resolved?.agentId || targetId;
    const targetConfig = resolved?.config || agentConfigStore.get(resolvedId);
    if (!targetConfig) {
      return { error: `找不到同事 "${targetId}"` };
    }

    const superior = orgChartService.getSuperior(resolvedId);
    if (!superior) {
      return {
        success: true,
        agent: { id: resolvedId, name: targetConfig.name },
        superior: null,
        message: `${targetConfig.name} 没有直接上级（可能是 CEO 或顶层角色）`,
      };
    }

    return {
      success: true,
      agent: { id: resolvedId, name: targetConfig.name },
      superior,
      tip: `${targetConfig.name} 的直接上级是 ${superior.name}（${superior.title || superior.role}）。使用 get_reporting_chain 可以查看完整的汇报链。`,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// (4) escalate — 越级上报（给上级的上级）
// ═══════════════════════════════════════════════════════════

const escalateTool = {
  name: 'escalate',
  description: '将问题升级给上级的上级（越级上报）。当直接上级无法解决或问题超出其权限时使用。',
  category: 'collaboration',
  parameters: {
    message: {
      type: 'string',
      description: '要上报的消息内容（应说明问题、已尝试的途径、希望上级的上级做什么）',
      required: true,
    },
    urgency: {
      type: 'string',
      description: '紧急程度：normal（普通）、urgent（紧急）、critical（严重）',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { message, urgency = 'normal' } = args || {};
    const agentId = _getAgentId(context);
    if (!agentId) return { error: '无法确定当前 Agent 身份' };
    if (!message) return { error: '缺少必要参数：message' };

    // 检查调用者自身是否被停职
    const callerConfig = agentConfigStore.get(agentId);
    if (callerConfig && (callerConfig.status === 'suspended' || callerConfig.status === 'terminated')) {
      return { error: '你当前处于停职状态，无法发起越级上报。如需申诉，请直接与老板对话。' };
    }

    // 找自己的直接上级
    const directSuperior = orgChartService.getSuperior(agentId);
    if (!directSuperior) {
      return { error: '你没有直接上级，无法越级上报（你已经是顶层角色）' };
    }

    // 找上级的上级
    const skipLevelSuperior = orgChartService.getSuperior(directSuperior.id);
    if (!skipLevelSuperior) {
      return {
        success: false,
        error: `你的直接上级 ${directSuperior.name} 已经是顶层角色，没有更上级可以越级上报。可以直接用 send_to_agent 联系 ${directSuperior.name}。`,
        directSuperior,
      };
    }

    // 构造越级上报消息（附上调用链信息，便于上级的上级理解上下文）
    const urgencyTag = urgency === 'critical' ? '[严重-越级上报] '
      : urgency === 'urgent' ? '[紧急-越级上报] '
      : '[越级上报] ';
    const composedMessage = `${urgencyTag}${callerConfig?.name || agentId} 越级向你上报问题（直接上级：${directSuperior.name}）：\n${message}`;

    const callChain = context.callChain || [];
    const nestingDepth = context.nestingDepth || 0;

    const result = await agentCommunication.sendMessage({
      fromAgent: agentId,
      toAgent: skipLevelSuperior.id,
      message: composedMessage,
      conversationId: context.conversationId,
      callChain,
      nestingDepth,
    });

    // 记录通信事件
    _appendCommEvent({
      type: 'escalation',
      from: agentId,
      to: skipLevelSuperior.id,
      content: message,
      response: result.success ? (result.response || '') : '',
      conversationId: context.conversationId || '',
      groupId: null,
    });

    if (result.success) {
      return {
        success: true,
        escalatedTo: { id: skipLevelSuperior.id, name: skipLevelSuperior.name, title: skipLevelSuperior.title },
        skippedLevel: { id: directSuperior.id, name: directSuperior.name, title: directSuperior.title },
        response: result.response,
        message: `已越级上报给 ${skipLevelSuperior.name}（跳过直接上级 ${directSuperior.name}）`,
      };
    }
    return {
      success: false,
      error: result.error || '越级上报失败',
      escalatedTo: { id: skipLevelSuperior.id, name: skipLevelSuperior.name },
    };
  },
};

// ═══════════════════════════════════════════════════════════
// (5) request_cross_dept_collab — 跨部门协作请求
// ═══════════════════════════════════════════════════════════

const requestCrossDeptCollabTool = {
  name: 'request_cross_dept_collab',
  description: '向其他部门的负责人发起跨部门协作请求。自动找到目标部门的负责人并异步发送。',
  category: 'collaboration',
  parameters: {
    target_department: {
      type: 'string',
      description: '目标部门 ID（如 tech、finance、marketing、hr、product 等）',
      required: true,
    },
    task_description: {
      type: 'string',
      description: '协作任务描述（要做什么、为什么需要对方部门配合、期望的产出）',
      required: true,
    },
    priority: {
      type: 'number',
      description: '优先级 1-5（1 最高，默认 3）',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { target_department, task_description, priority = 3 } = args || {};
    const agentId = _getAgentId(context);
    if (!agentId) return { error: '无法确定当前 Agent 身份' };
    if (!target_department || !task_description) {
      return { error: '缺少必要参数：target_department 和 task_description' };
    }

    // 检查调用者自身是否被停职
    const callerConfig = agentConfigStore.get(agentId);
    if (callerConfig && (callerConfig.status === 'suspended' || callerConfig.status === 'terminated')) {
      return { error: '你当前处于停职状态，无法发起跨部门协作。' };
    }

    // 找目标部门成员（已按职级从高到低排序）
    const members = orgChartService.getDepartmentMembers(target_department);
    if (members.length === 0) {
      return {
        success: false,
        error: `部门 "${target_department}" 没有在职成员，无法发起协作请求。`,
      };
    }

    // 部门负责人 = level rank 最高的成员（getDepartmentMembers 已按 rank 降序排序）
    const leader = members[0];

    // 检查目标是否就是自己（自己部门）
    if (leader.id === agentId) {
      return {
        success: false,
        error: `你本人就是 ${target_department} 部门的负责人，无需发起跨部门协作请求。可直接使用 delegate_task 委派本部门成员。`,
      };
    }

    const callerName = callerConfig?.name || agentId;
    const callerDept = callerConfig ? getPrimaryDepartment(callerConfig) : null;
    const composedMessage = `[跨部门协作请求] 来自 ${callerName}（${callerDept || '?'} 部门）的协作请求：\n${task_description}\n\n优先级：${priority}`;

    const callChain = context.callChain || [];
    const nestingDepth = context.nestingDepth || 0;

    const result = await agentCommunication.sendMessage({
      fromAgent: agentId,
      toAgent: leader.id,
      message: composedMessage,
      conversationId: context.conversationId,
      callChain,
      nestingDepth,
    });

    _appendCommEvent({
      type: 'cross_dept_request',
      from: agentId,
      to: leader.id,
      content: task_description,
      response: result.success ? (result.response || '') : '',
      conversationId: context.conversationId || '',
      groupId: null,
    });

    if (result.success) {
      return {
        success: true,
        targetDepartment: target_department,
        departmentHead: { id: leader.id, name: leader.name, title: leader.title },
        memberCount: members.length,
        response: result.response,
        message: `已向 ${target_department} 部门负责人 ${leader.name} 发送跨部门协作请求`,
      };
    }
    return {
      success: false,
      error: result.error || '跨部门协作请求发送失败',
      targetDepartment: target_department,
      departmentHead: { id: leader.id, name: leader.name },
    };
  },
};

// ═══════════════════════════════════════════════════════════
// (6) broadcast_to_subordinates — 向所有直接下属广播
// ═══════════════════════════════════════════════════════════

const broadcastToSubordinatesTool = {
  name: 'broadcast_to_subordinates',
  description: '向所有直接下属广播消息（并行发送，不等回复）。',
  category: 'collaboration',
  parameters: {
    message: {
      type: 'string',
      description: '要广播的消息内容',
      required: true,
    },
    include_indirect: {
      type: 'boolean',
      description: '是否包含间接下属（下属的下属），默认 false 只发给直接下属',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { message, include_indirect = false } = args || {};
    const agentId = _getAgentId(context);
    if (!agentId) return { error: '无法确定当前 Agent 身份' };
    if (!message) return { error: '缺少必要参数：message' };

    // 检查调用者自身是否被停职
    const callerConfig = agentConfigStore.get(agentId);
    if (callerConfig && (callerConfig.status === 'suspended' || callerConfig.status === 'terminated')) {
      return { error: '你当前处于停职状态，无法向下属广播消息。' };
    }

    // 收集目标下属列表
    let targetIds = [];
    if (include_indirect) {
      // 递归收集所有下属（含间接下属）
      const visited = new Set([agentId]); // 避免自环
      const queue = [agentId];
      while (queue.length > 0) {
        const currentId = queue.shift();
        const subs = orgChartService.getSubordinates(currentId);
        for (const sub of subs) {
          if (!visited.has(sub.id)) {
            visited.add(sub.id);
            targetIds.push(sub.id);
            queue.push(sub.id);
          }
        }
      }
    } else {
      targetIds = orgChartService.getSubordinates(agentId).map((n) => n.id);
    }

    if (targetIds.length === 0) {
      return {
        success: true,
        total: 0,
        sent: 0,
        message: include_indirect ? '你没有直接或间接下属' : '你没有直接下属',
      };
    }

    const callerName = callerConfig?.name || agentId;
    const broadcastTag = include_indirect ? '[全员广播]' : '[团队广播]';
    const composedMessage = `${broadcastTag} 来自上级 ${callerName} 的广播：\n${message}`;

    const callChain = context.callChain || [];
    const nestingDepth = context.nestingDepth || 0;

    // 并行异步发送（mode:'async' fire-and-forget），不等回复
    const sendResults = await Promise.all(
      targetIds.map(async (subId) => {
        try {
          const r = await agentCommunication.sendMessage({
            fromAgent: agentId,
            toAgent: subId,
            message: composedMessage,
            conversationId: context.conversationId,
            callChain,
            nestingDepth,
            mode: 'async',
          });
          return { id: subId, success: r.success, error: r.error || null };
        } catch (e) {
          return { id: subId, success: false, error: e.message };
        }
      })
    );

    // 写通信事件（每条广播都记录）
    for (const r of sendResults) {
      _appendCommEvent({
        type: 'broadcast',
        from: agentId,
        to: r.id,
        content: message,
        response: '',
        conversationId: context.conversationId || '',
        groupId: null,
      });
    }

    const succeeded = sendResults.filter((r) => r.success);
    const failed = sendResults.filter((r) => !r.success);

    return {
      success: true,
      total: targetIds.length,
      sent: succeeded.length,
      failed: failed.length,
      scope: include_indirect ? 'direct+indirect' : 'direct',
      recipients: succeeded.map((r) => r.id),
      ...(failed.length > 0 ? { failures: failed } : {}),
      message: `已向 ${succeeded.length}/${targetIds.length} 位下属广播消息`,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// (7) get_reporting_chain — 查看完整汇报链（自己 → CEO）
// ═══════════════════════════════════════════════════════════

const getReportingChainTool = {
  name: 'get_reporting_chain',
  description: '查看从自己到 CEO 的完整汇报链。用于确定多级上报路径。',
  category: 'collaboration',
  parameters: {
    agent_id: {
      type: 'string',
      description: '同事 ID（不填默认查自己的汇报链）',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const args_ = args || {};
    const callerId = _getAgentId(context);
    const targetId = args_.agent_id || callerId;

    if (!targetId) return { error: '无法确定要查询的同事' };

    // 通过 ID 或显示名解析
    const resolved = agentConfigStore.resolve(targetId);
    const resolvedId = resolved?.agentId || targetId;
    const targetConfig = resolved?.config || agentConfigStore.get(resolvedId);
    if (!targetConfig) {
      return { error: `找不到同事 "${targetId}"` };
    }

    const chain = orgChartService.getReportingChain(resolvedId);
    if (chain.length === 0) {
      return { error: `无法获取 ${targetConfig.name} 的汇报链` };
    }

    return {
      success: true,
      agent: { id: resolvedId, name: targetConfig.name },
      chain,
      depth: chain.length,
      tip: '汇报链从自己开始到 CEO 结束。使用 escalate 可以越级上报，使用 send_to_agent 可以按链路逐级沟通。',
    };
  },
};

// ═══════════════════════════════════════════════════════════
// (8) get_team_status — 查看团队实时工作状态
// ═══════════════════════════════════════════════════════════

const getTeamStatusTool = {
  name: 'get_team_status',
  description: '查看自己团队的实时工作状态：正在做什么、任务负载、在线状态。',
  category: 'collaboration',
  parameters: {
    include_subteams: {
      type: 'boolean',
      description: '是否包含下属的下属（次级团队），默认 false 只看直接团队',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { include_subteams = false } = args || {};
    const agentId = _getAgentId(context);
    if (!agentId) return { error: '无法确定当前 Agent 身份' };

    const leaderConfig = agentConfigStore.get(agentId);
    if (!leaderConfig) return { error: `找不到 Agent "${agentId}"` };

    // 直接调用 orgChartService.getTeamStatus（已支持 includeSubteams 参数）
    const status = orgChartService.getTeamStatus(agentId, { includeSubteams: include_subteams });

    if (!status.leader) {
      return { error: '无法获取团队状态' };
    }

    return {
      success: true,
      ...status,
      scope: include_subteams ? 'leader+direct+indirect' : 'leader+direct',
      tip: status.summary.busy > 0
        ? `团队有 ${status.summary.busy} 人正在忙碌，${status.summary.idle} 人空闲。可向空闲成员委派任务。`
        : `团队全部 ${status.summary.total} 人当前空闲，可以接受任务委派。`,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 注册所有组织架构工具
// ═══════════════════════════════════════════════════════════

/**
 * 注册所有组织架构工具
 */
function registerOrgChartTools() {
  toolRegistry.register(getOrgChartTool);
  toolRegistry.register(getSubordinatesTool);
  toolRegistry.register(getDirectReportTool);
  toolRegistry.register(escalateTool);
  toolRegistry.register(requestCrossDeptCollabTool);
  toolRegistry.register(broadcastToSubordinatesTool);
  toolRegistry.register(getReportingChainTool);
  toolRegistry.register(getTeamStatusTool);

  logger.info('组织架构工具已注册（8 个）');
}

module.exports = {
  registerOrgChartTools,
  // 导出各工具定义，便于其他模块引用/测试
  getOrgChartTool,
  getSubordinatesTool,
  getDirectReportTool,
  escalateTool,
  requestCrossDeptCollabTool,
  broadcastToSubordinatesTool,
  getReportingChainTool,
  getTeamStatusTool,
};
