/**
 * SoloForge - HR 生命周期相关工具
 *
 * 包含：开除申请/确认、停职/复职、试用期管理、入职引导管理。
 * @module tools/hr-lifecycle-tools
 */

const {
  agentConfigStore,
  AGENT_STATUS,
  CORE_AGENT_IDS,
  createDefaultOnboardingChecklist,
  terminationQueue,
  logger,
} = require('./hr-shared');

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

    // 中止该 Agent 的活跃任务并清理通信队列
    try {
      const { chatManager } = require('../chat');
      chatManager._abortTask(agent_id, '停职');
      chatManager._proactiveQueue.delete(agent_id);

      const { agentCommunication } = require('../collaboration/agent-communication');
      agentCommunication.clearAgentQueues(agent_id);
    } catch (e) {
      logger.warn('停职时清理任务/队列失败:', e.message);
    }

    const durationInfo = duration_days ? `停职 ${duration_days} 天` : '无限期停职';

    logger.info('Agent 停职，已中止相关任务', { agent_id, reason, duration_days });

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
      note: '停职期间该 Agent 无法响应消息，所有进行中的任务已被中止。使用 hr_reinstate_agent 可恢复其工作状态。',
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

module.exports = {
  hrDismissRequestTool,
  dismissConfirmTool,
  hrSuspendAgentTool,
  hrReinstateAgentTool,
  hrEndProbationTool,
  hrOnboardingStatusTool,
};
