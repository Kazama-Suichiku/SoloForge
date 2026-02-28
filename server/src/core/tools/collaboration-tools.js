/**
 * Agent 协作工具 - 移动端版
 * 允许 Agent 之间进行沟通、委派任务、协作
 */

const { toolRegistry } = require('./tool-registry');
const { agentCommunication } = require('../collaboration/agent-communication');
const { logger } = require('../../utils/logger');

// 延迟加载避免循环依赖
const getAgentConfigStore = () => require('../config').agentConfigStore;

/**
 * 发送消息给其他同事
 */
const sendToAgentTool = {
  name: 'send_to_agent',
  description: `发送消息给其他同事，等待对方回复后返回结果。

使用场景：
- 需要咨询其他同事的专业意见
- 需要确认某事或获取信息
- 需要与其他同事讨论问题`,
  category: 'collaboration',
  parameters: {
    target_agent: {
      type: 'string',
      description: '目标同事的 ID（如 ceo, cto, cfo, chro, secretary 等）',
      required: true,
    },
    message: {
      type: 'string',
      description: '要发送的消息内容',
      required: true,
    },
  },
  async execute(args, context) {
    const { target_agent, message } = args;
    const { agentId } = context;
    const agentConfigStore = getAgentConfigStore();

    if (!target_agent || !message) {
      return { error: '缺少必要参数：target_agent 和 message' };
    }

    // 检查调用者是否被停职
    const callerConfig = agentConfigStore.get(agentId);
    if (callerConfig && (callerConfig.status === 'suspended' || callerConfig.status === 'terminated')) {
      return { error: '你当前处于停职状态，无法与同事沟通。' };
    }

    if (target_agent === agentId) {
      return { error: '不能给自己发消息' };
    }

    const targetConfig = agentConfigStore.get(target_agent);
    if (!targetConfig) {
      const allConfigs = agentConfigStore.getAll();
      const available = allConfigs.map((c) => `${c.id} (${c.name})`).join(', ');
      return { error: `找不到同事 "${target_agent}"。可用的同事有：${available}` };
    }

    const targetStatus = targetConfig.status || 'active';
    if (targetStatus === 'suspended') {
      return { error: `${targetConfig.name} 当前处于停职状态，无法接收消息。` };
    }

    logger.info(`Agent 协作: ${agentId} 发送消息给 ${target_agent}`);

    const callChain = context.callChain || [];
    const nestingDepth = context.nestingDepth || 0;

    const result = await agentCommunication.sendMessage({
      fromAgent: agentId,
      toAgent: target_agent,
      message,
      conversationId: context.conversationId,
      callChain,
      nestingDepth,
    });

    if (result.success) {
      return {
        success: true,
        from: target_agent,
        response: result.response,
        message: `${targetConfig.name} 已回复`,
      };
    } else {
      return { success: false, error: result.error || '消息发送失败' };
    }
  },
};

/**
 * 委派任务给其他同事
 */
const delegateTaskTool = {
  name: 'delegate_task',
  description: `委派任务给其他同事执行。

使用场景：
- 需要其他同事帮忙完成某项工作
- 任务需要其他人的专业能力
- 分解大任务给不同的人`,
  category: 'collaboration',
  parameters: {
    target_agent: {
      type: 'string',
      description: '被委派的同事 ID',
      required: true,
    },
    task_description: {
      type: 'string',
      description: '任务描述',
      required: true,
    },
    priority: {
      type: 'number',
      description: '优先级 1-5（1 最高，默认 3）',
      required: false,
    },
    wait_for_result: {
      type: 'boolean',
      description: '是否等待任务完成（默认 true）',
      required: false,
    },
  },
  async execute(args, context) {
    const { target_agent, task_description, priority = 3, wait_for_result = true } = args;
    const { agentId } = context;
    const agentConfigStore = getAgentConfigStore();

    if (!target_agent || !task_description) {
      return { error: '缺少必要参数：target_agent 和 task_description' };
    }

    const callerConfig = agentConfigStore.get(agentId);
    if (callerConfig && (callerConfig.status === 'suspended' || callerConfig.status === 'terminated')) {
      return { error: '你当前处于停职状态，无法委派任务。' };
    }

    if (target_agent === agentId) {
      return { error: '不能给自己委派任务' };
    }

    const targetConfig = agentConfigStore.get(target_agent);
    if (!targetConfig) {
      const allConfigs = agentConfigStore.getAll();
      const available = allConfigs.map((c) => `${c.id} (${c.name})`).join(', ');
      return { error: `找不到同事 "${target_agent}"。可用的同事有：${available}` };
    }

    const targetStatus = targetConfig.status || 'active';
    if (targetStatus === 'suspended' || targetStatus === 'terminated') {
      return { error: `${targetConfig.name} 当前不可用，无法接收任务。` };
    }

    logger.info(`任务委派: ${agentId} → ${target_agent}`, { task: task_description.slice(0, 50) });

    const result = await agentCommunication.delegateTask({
      fromAgent: agentId,
      toAgent: target_agent,
      taskDescription: task_description,
      priority,
      waitForResult: wait_for_result,
      conversationId: context.conversationId,
    });

    if (result.success) {
      if (wait_for_result && result.result) {
        return {
          success: true,
          taskId: result.taskId,
          executor: targetConfig.name,
          result: result.result,
          message: `${targetConfig.name} 已完成任务`,
        };
      } else {
        return {
          success: true,
          taskId: result.taskId,
          executor: targetConfig.name,
          message: `任务已委派给 ${targetConfig.name}，任务 ID: ${result.taskId}`,
        };
      }
    } else {
      return { success: false, error: result.error || '任务委派失败' };
    }
  },
};

/**
 * 查看我的待办任务
 */
const myTasksTool = {
  name: 'my_tasks',
  description: '查看分配给我的任务列表。',
  category: 'collaboration',
  parameters: {
    type: {
      type: 'string',
      description: '任务类型：all（所有）、received（收到的）、assigned（分配出去的）',
      required: false,
    },
    status: {
      type: 'string',
      description: '状态筛选：pending、in_progress、completed、failed',
      required: false,
    },
  },
  async execute(args, context) {
    const { type = 'all', status } = args;
    const { agentId } = context;
    const agentConfigStore = getAgentConfigStore();

    const tasks = agentCommunication.getTasks(agentId, { type, status });

    if (tasks.length === 0) {
      return { message: '暂无相关任务', tasks: [] };
    }

    const formattedTasks = tasks.map((t) => ({
      taskId: t.id,
      from: t.fromAgent,
      to: t.toAgent,
      description: t.taskDescription,
      status: t.status,
      priority: t.priority,
      createdAt: new Date(t.createdAt).toLocaleString('zh-CN'),
      result: t.result ? t.result.slice(0, 100) + (t.result.length > 100 ? '...' : '') : null,
    }));

    return { total: tasks.length, tasks: formattedTasks };
  },
};

/**
 * 查看同事列表
 */
const listColleaguesTool = {
  name: 'list_colleagues',
  description: '查看同事列表和基本信息。',
  category: 'collaboration',
  parameters: {
    department: {
      type: 'string',
      description: '按部门过滤（如 tech, finance, marketing 等）',
      required: false,
    },
  },
  async execute(args, context) {
    const { agentId } = context;
    const { department } = args;
    const agentConfigStore = getAgentConfigStore();

    const configs = agentConfigStore.getAll();
    let colleagues = configs
      .filter((c) => c.id !== agentId)
      .map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        level: c.level,
        department: c.department,
        status: c.status === 'suspended' ? '停职' : c.status === 'terminated' ? '离职' : '在职',
        reportsTo: c.reportsTo || null,
        description: c.description,
      }));

    if (department) {
      colleagues = colleagues.filter((c) => c.department === department);
    }

    const activeCount = colleagues.filter((c) => c.status === '在职').length;

    return {
      total: colleagues.length,
      activeCount,
      department: department || '全部',
      colleagues,
    };
  },
};

/**
 * 查看通信历史
 */
const communicationHistoryTool = {
  name: 'communication_history',
  description: '查看与其他同事的沟通记录和任务委派（最近的）',
  category: 'collaboration',
  parameters: {
    limit: {
      type: 'number',
      description: '返回记录数量（默认 10）',
      required: false,
    },
  },
  async execute(args, context) {
    const { limit = 10 } = args;
    const { agentId } = context;

    const messages = agentCommunication.getMessages(agentId, { limit });
    const tasks = agentCommunication.getTasks(agentId, { type: 'all' }).slice(-limit);

    const allRecords = [];

    for (const m of messages) {
      allRecords.push({
        id: m.id,
        type: '消息',
        direction: m.fromAgent === agentId ? '发送' : '接收',
        peer: m.fromAgent === agentId ? m.toAgent : m.fromAgent,
        content: m.content.slice(0, 100) + (m.content.length > 100 ? '...' : ''),
        response: m.response ? m.response.slice(0, 100) + (m.response.length > 100 ? '...' : '') : null,
        status: m.status,
        time: new Date(m.createdAt).toLocaleString('zh-CN'),
        timestamp: m.createdAt,
      });
    }

    for (const t of tasks) {
      allRecords.push({
        id: t.id,
        type: '任务委派',
        direction: t.fromAgent === agentId ? '委派出去' : '收到任务',
        peer: t.fromAgent === agentId ? t.toAgent : t.fromAgent,
        content: t.taskDescription.slice(0, 100) + (t.taskDescription.length > 100 ? '...' : ''),
        result: t.result ? t.result.slice(0, 100) + (t.result.length > 100 ? '...' : '') : null,
        status: t.status,
        time: new Date(t.createdAt).toLocaleString('zh-CN'),
        timestamp: t.createdAt,
      });
    }

    allRecords.sort((a, b) => b.timestamp - a.timestamp);
    const result = allRecords.slice(0, limit);

    if (result.length === 0) {
      return { message: '暂无通信记录', history: [] };
    }

    return { total: result.length, history: result };
  },
};

/**
 * 协作统计
 */
const collaborationStatsTool = {
  name: 'collaboration_stats',
  description: '查看我的协作统计数据',
  category: 'collaboration',
  parameters: {},
  async execute(args, context) {
    const { agentId } = context;
    const stats = agentCommunication.getStats(agentId);

    return {
      agentId,
      messages: {
        sent: stats.messages.sent,
        received: stats.messages.received,
        total: stats.messages.sent + stats.messages.received,
      },
      tasks: {
        delegatedToOthers: stats.tasks.assigned,
        receivedFromOthers: stats.tasks.received,
        completed: stats.tasks.completed,
        pending: stats.tasks.pending,
      },
    };
  },
};

/**
 * 向老板发送私信汇报
 */
const notifyBossTool = {
  name: 'notify_boss',
  description: `向老板发送一条私信汇报。消息会实时出现在老板的聊天窗口中。

使用场景：
- 任务完成后向老板汇报进展
- 重要事项的进展更新
- 需要主动向老板报告的情况`,
  category: 'collaboration',
  parameters: {
    message: {
      type: 'string',
      description: '要向老板汇报的内容',
      required: true,
    },
  },
  async execute(args, context) {
    const { message } = args;
    const { agentId } = context;

    if (!message) {
      return { error: '缺少必要参数：message' };
    }

    try {
      const { chatManager } = require('../chat');
      chatManager.pushProactiveMessage(agentId, message);

      logger.info(`Agent ${agentId} 向老板发送了主动汇报`, { messageLength: message.length });

      return { success: true, message: '已发送给老板' };
    } catch (error) {
      logger.error(`notify_boss 执行失败:`, error);
      return { success: false, error: error.message || '发送失败' };
    }
  },
};

/**
 * 取消委派任务
 */
const cancelDelegatedTaskTool = {
  name: 'cancel_delegated_task',
  description: '取消委派任务。只能取消自己发起的任务。',
  category: 'collaboration',
  parameters: {
    task_id: {
      type: 'string',
      description: '要取消的任务 ID',
      required: true,
    },
    reason: {
      type: 'string',
      description: '取消原因',
      required: false,
    },
  },
  async execute(args, context) {
    const { task_id, reason } = args;
    const { agentId } = context;

    if (!task_id) {
      return { error: '请提供 task_id' };
    }

    const tasks = agentCommunication.getTasks(agentId, { type: 'assigned' });
    const task = tasks.find((t) => t.id === task_id);
    
    if (!task) {
      return { error: `未找到任务 ${task_id}，或你不是该任务的发起人` };
    }

    const cancellableStatuses = ['pending', 'in_progress'];
    if (!cancellableStatuses.includes(task.status)) {
      return { error: `任务 ${task_id} 当前状态为 ${task.status}，无法取消` };
    }

    agentCommunication.updateTask(task_id, {
      status: 'cancelled',
      cancelledAt: Date.now(),
      cancelReason: reason || '任务已取消',
    });

    logger.info(`Agent ${agentId} 取消了任务 ${task_id}`, { reason });

    return {
      success: true,
      message: `任务 ${task_id} 已取消`,
      taskId: task_id,
    };
  },
};

/**
 * 注册所有协作工具
 */
function registerCollaborationTools() {
  toolRegistry.register(sendToAgentTool);
  toolRegistry.register(delegateTaskTool);
  toolRegistry.register(myTasksTool);
  toolRegistry.register(listColleaguesTool);
  toolRegistry.register(communicationHistoryTool);
  toolRegistry.register(collaborationStatsTool);
  toolRegistry.register(notifyBossTool);
  toolRegistry.register(cancelDelegatedTaskTool);

  logger.info('协作工具已注册');
}

module.exports = {
  registerCollaborationTools,
  sendToAgentTool,
  delegateTaskTool,
  myTasksTool,
  listColleaguesTool,
  communicationHistoryTool,
  collaborationStatsTool,
  notifyBossTool,
  cancelDelegatedTaskTool,
};
