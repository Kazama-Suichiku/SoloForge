/**
 * SoloForge - Agent 协作工具
 * 允许 Agent 之间进行沟通、委派任务、协作
 * @module tools/collaboration-tools
 */

const { toolRegistry } = require('./tool-registry');
const { agentCommunication } = require('../collaboration/agent-communication');
const { agentConfigStore } = require('../config/agent-config-store');
const { devPlanQueue } = require('../collaboration/dev-plan-queue');
const { logger } = require('../utils/logger');
const { formatLocalTime } = require('../utils/time-format');

// ═══════════════════════════════════════════════════════════
// 同步消息工具
// ═══════════════════════════════════════════════════════════

/**
 * 发送消息给其他同事（同步等待回复）
 */
const sendToAgentTool = {
  name: 'send_to_agent',
  description: `发送消息给其他同事，等待对方回复后返回结果。

使用场景：
- 需要咨询其他同事的专业意见
- 需要确认某事或获取信息
- 需要与其他同事讨论问题

注意：
- 这是同步通信，会等待对方回复
- 对方会收到你的消息并直接回复
- 适合需要立即得到答复的情况`,
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
  requiredPermissions: [],
  async execute(args, context) {
    const { target_agent, message } = args;
    const { agentId } = context;

    if (!target_agent || !message) {
      return { error: '缺少必要参数：target_agent 和 message' };
    }

    // 检查调用者自身是否被停职
    const callerConfig = agentConfigStore.get(agentId);
    if (callerConfig && (callerConfig.status === 'suspended' || callerConfig.status === 'terminated')) {
      return { error: '你当前处于停职状态，无法与同事沟通。如需申诉，请直接与老板对话。' };
    }

    // 通过 ID 或显示名解析目标 Agent
    const resolved = agentConfigStore.resolve(target_agent);
    const resolvedId = resolved?.agentId || target_agent;

    if (resolvedId === agentId) {
      return { error: '不能给自己发消息' };
    }

    // 获取目标 Agent 信息
    const targetConfig = resolved?.config || agentConfigStore.get(resolvedId);
    if (!targetConfig) {
      // 列出可用的 Agent
      const allConfigs = agentConfigStore.getAll();
      const available = allConfigs.map((c) => `${c.id} (${c.name})`).join(', ');
      return { error: `找不到同事 "${target_agent}"。可用的同事有：${available}` };
    }

    // 检查目标 Agent 是否可用
    const targetStatus = targetConfig.status || 'active';
    if (targetStatus === 'suspended') {
      return { error: `${targetConfig.name} 当前处于停职状态，无法接收消息。` };
    }
    if (targetStatus === 'terminated') {
      return { error: `${targetConfig.name} 已离职，无法接收消息。` };
    }

    logger.info(`Agent 协作: ${agentId} 发送消息给 ${resolvedId}`);

    const result = await agentCommunication.sendMessage({
      fromAgent: agentId,
      toAgent: resolvedId,
      message,
      conversationId: context.conversationId,
    });

    if (result.success) {
      return {
        success: true,
        from: target_agent,
        response: result.response,
        message: `${targetConfig.name} 已回复`,
      };
    } else {
      return {
        success: false,
        error: result.error || '消息发送失败',
      };
    }
  },
};

// ═══════════════════════════════════════════════════════════
// 异步任务委派工具
// ═══════════════════════════════════════════════════════════

/**
 * 委派任务给其他同事
 */
const delegateTaskTool = {
  name: 'delegate_task',
  description: `委派任务给其他同事执行。

使用场景：
- 需要其他同事帮忙完成某项工作
- 任务需要其他人的专业能力
- 分解大任务给不同的人

参数说明：
- wait_for_result: 
  - true: 同步等待任务完成并获取结果（适合简单任务）
  - false: 异步委派，任务会排队等待执行（适合复杂任务）
- create_branch:
  - true: 自动为任务创建 Git 工作分支（格式: agentId/taskId），适合代码类任务
  - false: 不创建分支（默认）
- require_plan_approval:
  - true: 要求下属先提交开发计划，审批通过后才能开始编码（推荐对复杂开发任务启用）
  - false: 不需要审批，直接开始执行（默认）`,
  category: 'collaboration',
  parameters: {
    target_agent: {
      type: 'string',
      description: '被委派的同事 ID',
      required: true,
    },
    task_description: {
      type: 'string',
      description: '任务描述（要做什么、期望的结果）',
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
    create_branch: {
      type: 'boolean',
      description: '是否为该任务创建 Git 工作分支（适合代码类任务，默认 false）',
      required: false,
    },
    require_plan_approval: {
      type: 'boolean',
      description: '是否要求下属先提交开发计划审批（通过后才能开始编码，默认 false）。建议对复杂开发任务启用。',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { target_agent, task_description, priority = 3, wait_for_result = true, create_branch = false, require_plan_approval = false } = args;
    const { agentId } = context;

    if (!target_agent || !task_description) {
      return { error: '缺少必要参数：target_agent 和 task_description' };
    }

    // 检查调用者自身是否被停职
    const callerConfig = agentConfigStore.get(agentId);
    if (callerConfig && (callerConfig.status === 'suspended' || callerConfig.status === 'terminated')) {
      return { error: '你当前处于停职状态，无法委派任务。如需申诉，请直接与老板对话。' };
    }

    // 通过 ID 或显示名解析目标 Agent
    const resolvedTarget = agentConfigStore.resolve(target_agent);
    const targetId = resolvedTarget?.agentId || target_agent;

    if (targetId === agentId) {
      return { error: '不能给自己委派任务' };
    }

    const targetConfig = resolvedTarget?.config || agentConfigStore.get(targetId);
    if (!targetConfig) {
      const allConfigs = agentConfigStore.getAll();
      const available = allConfigs.map((c) => `${c.id} (${c.name})`).join(', ');
      return { error: `找不到同事 "${target_agent}"。可用的同事有：${available}` };
    }

    // 检查目标 Agent 是否可用
    const targetStatus = targetConfig.status || 'active';
    if (targetStatus === 'suspended') {
      return { error: `${targetConfig.name} 当前处于停职状态，无法接收任务。` };
    }
    if (targetStatus === 'terminated') {
      return { error: `${targetConfig.name} 已离职，无法接收任务。` };
    }

    logger.info(`任务委派: ${agentId} → ${targetId}`, { task: task_description.slice(0, 50), createBranch: create_branch });

    // 如果指定了创建 Git 分支，在任务开始前就创建，以便员工能在正确的分支上工作
    let branchInfo = null;
    let gitBranchName = null;
    let gitWorkspace = null;
    if (create_branch) {
      try {
        const { resolveWorkspace } = require('./git-tool');
        const { PRManager } = require('../git/pr-manager');
        gitWorkspace = resolveWorkspace();
        const manager = new PRManager(gitWorkspace);

        const isRepo = await manager.isGitRepository();
        if (isRepo) {
          // 用 taskId 的临时占位，委派后会更新
          const tempTaskId = `${Date.now()}`;
          const branchResult = await manager.createTaskBranch(targetId, tempTaskId, {
            checkout: false,
          });
          gitBranchName = branchResult.branch;
          branchInfo = {
            branch: gitBranchName,
            workspace: gitWorkspace,
            message: `已为任务创建 Git 工作分支: ${gitBranchName}`,
          };
          logger.info(`任务分支已创建: ${gitBranchName}`);
        } else {
          branchInfo = { error: '工作区不是 Git 仓库，跳过分支创建' };
        }
      } catch (error) {
        logger.warn('创建任务分支失败:', error.message);
        branchInfo = { error: `创建分支失败: ${error.message}` };
      }
    }

    const result = await agentCommunication.delegateTask({
      fromAgent: agentId,
      toAgent: targetId,
      taskDescription: task_description,
      priority,
      waitForResult: wait_for_result,
      conversationId: context.conversationId,
      // 传递 Git 信息给任务执行上下文
      gitBranch: gitBranchName,
      gitWorkspace,
      // 开发计划审批
      requirePlanApproval: require_plan_approval,
    });

    if (result.success) {
      if (wait_for_result && result.result) {
        return {
          success: true,
          taskId: result.taskId,
          executor: targetConfig.name,
          result: result.result,
          message: `${targetConfig.name} 已完成任务`,
          ...(branchInfo ? { git: branchInfo } : {}),
        };
      } else {
        return {
          success: true,
          taskId: result.taskId,
          executor: targetConfig.name,
          message: `任务已委派给 ${targetConfig.name}，任务 ID: ${result.taskId}`,
          ...(branchInfo ? { git: branchInfo } : {}),
        };
      }
    } else {
      return {
        success: false,
        error: result.error || '任务委派失败',
      };
    }
  },
};

/**
 * 查看我的待办任务
 */
const myTasksTool = {
  name: 'my_tasks',
  description: `查看分配给我的任务列表。

可以筛选：
- 我收到的任务（received）
- 我分配出去的任务（assigned）
- 所有相关任务（all）`,
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
  requiredPermissions: [],
  async execute(args, context) {
    const { type = 'all', status } = args;
    const { agentId } = context;

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
      createdAt: formatLocalTime(t.createdAt),
      result: t.result ? t.result.slice(0, 100) + (t.result.length > 100 ? '...' : '') : null,
    }));

    return {
      total: tasks.length,
      tasks: formattedTasks,
    };
  },
};

/**
 * 查看通信历史（基础版，获取最近记录）
 * 同时显示消息记录和任务委派记录
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
  requiredPermissions: [],
  async execute(args, context) {
    const { limit = 10 } = args;
    const { agentId } = context;

    // 获取消息记录
    const messages = agentCommunication.getMessages(agentId, { limit });

    // 获取任务委派记录（包括分配给我的和我分配出去的）
    const tasks = agentCommunication.getTasks(agentId, { type: 'all' }).slice(-limit);

    // 合并并按时间排序
    const allRecords = [];

    // 添加消息记录
    for (const m of messages) {
      allRecords.push({
        id: m.id,
        type: '消息',
        direction: m.fromAgent === agentId ? '发送' : '接收',
        peer: m.fromAgent === agentId ? m.toAgent : m.fromAgent,
        content: m.content.slice(0, 100) + (m.content.length > 100 ? '...' : ''),
        response: m.response ? m.response.slice(0, 100) + (m.response.length > 100 ? '...' : '') : null,
        status: m.status,
        time: formatLocalTime(m.createdAt),
        timestamp: m.createdAt,
      });
    }

    // 添加任务委派记录
    for (const t of tasks) {
      allRecords.push({
        id: t.id,
        type: '任务委派',
        direction: t.fromAgent === agentId ? '委派出去' : '收到任务',
        peer: t.fromAgent === agentId ? t.toAgent : t.fromAgent,
        content: t.taskDescription.slice(0, 100) + (t.taskDescription.length > 100 ? '...' : ''),
        result: t.result ? t.result.slice(0, 100) + (t.result.length > 100 ? '...' : '') : null,
        status: t.status,
        time: formatLocalTime(t.createdAt),
        timestamp: t.createdAt,
      });
    }

    // 按时间排序，最新的在前
    allRecords.sort((a, b) => b.timestamp - a.timestamp);

    // 取前 limit 条
    const result = allRecords.slice(0, limit);

    if (result.length === 0) {
      return { message: '暂无通信记录或任务委派', history: [] };
    }

    return {
      total: result.length,
      messageCount: messages.length,
      taskCount: tasks.length,
      history: result,
      hint: '如需查看更早的记录，使用 browse_communication_history 工具进行分页浏览；使用 my_tasks 工具查看详细任务列表',
    };
  },
};

/**
 * 分页浏览通信历史
 */
const browseHistoryTool = {
  name: 'browse_communication_history',
  description: `分页浏览与同事的历史沟通记录。

使用场景：
- 需要回顾与某位同事的过往沟通
- 查找之前讨论过的内容
- 了解历史决策和结论

分页说明：
- page=1 表示最新一页（默认）
- page=2 表示倒数第二页（更早的记录）
- 以此类推，页码越大记录越早`,
  category: 'collaboration',
  parameters: {
    with_agent: {
      type: 'string',
      description: '筛选与特定同事的通信（Agent ID，如 ceo, cto 等）',
      required: false,
    },
    page: {
      type: 'number',
      description: '页码（从 1 开始，1 = 最新一页，默认 1）',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { with_agent, page = 1 } = args;
    const { agentId } = context;

    // 如果指定了特定同事，使用双方专属的分页方法
    if (with_agent) {
      if (with_agent === agentId) {
        return { error: '不能查看与自己的通信记录' };
      }

      // 先获取统计信息
      const info = agentCommunication.getPairwiseHistoryInfo(agentId, with_agent);

      if (info.total === 0) {
        return {
          message: `暂无与 ${with_agent} 的通信记录`,
          history: [],
        };
      }

      // 获取分页数据
      const result = agentCommunication.getPairwiseHistoryPaginated(agentId, with_agent, { page });

      if (result.error) {
        return { error: result.error };
      }

      return {
        withAgent: with_agent,
        page: result.page,
        totalPages: result.totalPages,
        totalRecords: result.total,
        hasMore: result.hasMore,
        history: result.messages,
        hint: result.hint,
      };
    }

    // 不指定同事时，获取所有通信记录
    const result = agentCommunication.getMessagesPaginated(agentId, { page });

    if (result.messages.length === 0) {
      return {
        message: '暂无通信记录',
        history: [],
      };
    }

    return {
      page: result.page,
      totalPages: result.totalPages,
      totalRecords: result.total,
      hasMore: result.hasMore,
      history: result.messages,
      hint: result.hasMore ? `还有更早的记录，使用 page=${page + 1} 查看` : '已是最早的记录',
    };
  },
};

/**
 * 获取与某同事的通信概览
 */
const communicationInfoTool = {
  name: 'communication_info',
  description: '获取与某位同事的通信统计信息，了解有多少历史记录、分多少页等',
  category: 'collaboration',
  parameters: {
    with_agent: {
      type: 'string',
      description: '目标同事的 ID（如 ceo, cto, cfo 等）',
      required: true,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { with_agent } = args;
    const { agentId } = context;

    if (!with_agent) {
      return { error: '请指定要查询的同事 ID (with_agent)' };
    }

    if (with_agent === agentId) {
      return { error: '不能查看与自己的通信信息' };
    }

    const info = agentCommunication.getPairwiseHistoryInfo(agentId, with_agent);

    return {
      withAgent: with_agent,
      totalMessages: info.total,
      totalPages: info.totalPages,
      pageSize: info.pageSize,
      hasOlderRecords: info.hasMore,
      hint:
        info.total > 0
          ? `使用 browse_communication_history 工具查看详细记录，page=1 为最新，page=${info.totalPages} 为最早`
          : `暂无与 ${with_agent} 的通信记录`,
    };
  },
};

/**
 * 查看同事列表（支持按部门过滤）
 */
const listColleaguesTool = {
  name: 'list_colleagues',
  description: `查看同事列表和基本信息。可按部门过滤，快速了解自己团队的人力情况。

部门 ID 列表：executive（高管）、tech（技术）、finance（财务）、admin（行政）、hr（人力）、product（产品）、marketing（市场）、sales（销售）、operations（运营）、legal（法务）`,
  category: 'collaboration',
  parameters: {
    department: {
      type: 'string',
      description: '按部门过滤（如 tech, finance, marketing 等），不填则返回全部同事',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const configs = agentConfigStore.getAll();
    const { agentId } = context;
    const { department } = args;

    let colleagues = configs
      .filter((c) => c.id !== agentId) // 不包括自己
      .map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        level: c.level,
        department: c.department,
        status: (c.status === 'suspended') ? '停职' : (c.status === 'terminated') ? '离职' : '在职',
        reportsTo: c.reportsTo || null,
        description: c.description,
      }));

    // 按部门过滤
    if (department) {
      colleagues = colleagues.filter((c) => c.department === department);
    }

    // 统计在职人数
    const activeCount = colleagues.filter((c) => c.status === '在职').length;

    return {
      total: colleagues.length,
      activeCount,
      department: department || '全部',
      colleagues,
      tip: department && colleagues.length === 0
        ? `${department} 部门目前没有其他成员。可以使用 recruit_request 工具提交招聘申请。`
        : `以上是完整的同事列表（共 ${colleagues.length} 人，${activeCount} 人在职）。请仔细查看每个人的信息后再做决策。使用 send_to_agent 可以向同事发消息，使用 delegate_task 可以委派任务。`,
    };
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
  requiredPermissions: [],
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

// ═══════════════════════════════════════════════════════════
// 主动汇报工具
// ═══════════════════════════════════════════════════════════

/**
 * 向老板（用户）主动发送私信汇报
 * 消息会实时出现在用户的聊天窗口中
 */
const notifyBossTool = {
  name: 'notify_boss',
  description: `向老板发送一条私信汇报。消息会实时出现在老板的聊天窗口中。

使用场景：
- 任务安排完毕后，向老板汇报进展
- 招聘申请提交或审批通过后，通知老板
- 任何需要主动向老板报告的情况
- 重要事项的进展更新

注意：
- 消息会以你的名义出现在老板与你的私聊窗口中
- 适合简短的状态更新和汇报，不要写太长
- 老板看到后可以回复你继续沟通`,
  category: 'collaboration',
  parameters: {
    message: {
      type: 'string',
      description: '要向老板汇报的内容（简洁明了）',
      required: true,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { message } = args;
    const { agentId } = context;

    if (!message) {
      return { error: '缺少必要参数：message' };
    }

    try {
      // 延迟加载 chatManager 避免循环依赖
      const { chatManager } = require('../chat');
      chatManager.pushProactiveMessage(agentId, message);

      logger.info(`Agent ${agentId} 向老板发送了主动汇报`, { messageLength: message.length });

      return {
        success: true,
        message: '已发送给老板',
      };
    } catch (error) {
      logger.error(`notify_boss 执行失败:`, error);
      return {
        success: false,
        error: error.message || '发送失败',
      };
    }
  },
};

// ═══════════════════════════════════════════════════════════
// 开发计划审批工具
// ═══════════════════════════════════════════════════════════

/**
 * 提交开发计划（员工使用）
 */
const submitDevPlanTool = {
  name: 'submit_dev_plan',
  description: `提交开发计划给上级审批。审批通过后才能开始编码。

使用场景：
- 收到需要审批的委派任务时，调研完代码后提交开发计划
- 计划被驳回后，根据反馈修改后重新提交

计划内容应包含：
1. 目标：要实现什么
2. 技术方案：怎么实现、用什么技术
3. 影响范围：涉及哪些文件/模块
4. 预估工时：大约需要多长时间
5. 风险点：可能遇到的问题`,
  category: 'collaboration',
  parameters: {
    plan_content: {
      type: 'string',
      description: '开发计划的详细内容',
      required: true,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { plan_content } = args;
    const { agentId, taskId } = context;

    if (!plan_content) {
      return { error: '缺少必要参数：plan_content' };
    }

    if (!taskId) {
      return { error: '当前不在任务执行上下文中，无法提交开发计划。此工具仅在收到需要审批的委派任务时可用。' };
    }

    // 查找关联的委派任务
    const task = agentCommunication.delegatedTasks.find((t) => t.id === taskId);
    if (!task) {
      return { error: `找不到关联的任务: ${taskId}` };
    }

    if (!task.planApprovalRequired) {
      return { error: '此任务不需要开发计划审批，可以直接开始执行。' };
    }

    // 获取审批者（任务委派方）信息
    const reviewerConfig = agentConfigStore.get(task.fromAgent);
    const agentConfig = agentConfigStore.get(agentId);

    const result = devPlanQueue.submit({
      taskId: task.id,
      agentId,
      agentName: agentConfig?.name || agentId,
      reviewerId: task.fromAgent,
      reviewerName: reviewerConfig?.name || task.fromAgent,
      content: plan_content,
    });

    if (!result.success) {
      return { error: result.error };
    }

    // 更新任务的 planStatus
    task.planStatus = 'submitted';
    agentCommunication._saveToDisk();

    logger.info(`开发计划已提交: ${agentId} → ${task.fromAgent}`, {
      planId: result.plan.id,
      taskId: task.id,
    });

    return {
      success: true,
      planId: result.plan.id,
      message: `开发计划已提交给 ${reviewerConfig?.name || task.fromAgent} 审批。请等待审批结果，审批通过后你将获得完整的开发工具权限并继续执行任务。`,
      revision: result.plan.revisionCount,
    };
  },
};

/**
 * 批准开发计划（Leader 使用）
 */
const approveDevPlanTool = {
  name: 'approve_dev_plan',
  description: `批准下属提交的开发计划。批准后下属将获得开发工具权限，开始执行任务。

使用场景：
- 收到下属的开发计划审批通知后使用
- 审阅计划内容，确认技术方案合理后批准`,
  category: 'dev_plan_review',
  parameters: {
    plan_id: {
      type: 'string',
      description: '开发计划 ID',
      required: true,
    },
    comment: {
      type: 'string',
      description: '批准备注（可选）',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { plan_id, comment = '' } = args;
    const { agentId } = context;

    if (!plan_id) {
      return { error: '缺少必要参数：plan_id' };
    }

    const plan = devPlanQueue.get(plan_id);
    if (!plan) {
      // 尝试模糊匹配：用户可能提供了部分 ID
      const allPending = devPlanQueue.getPending();
      if (allPending.length === 1) {
        // 只有一个待审批计划，自动匹配
        return await this.execute({ plan_id: allPending[0].id, comment }, context);
      }
      return { error: `找不到计划: ${plan_id}。使用 my_tasks 查看待审批的计划。` };
    }

    // 验证审批者身份：必须是该计划的审批者或 C-Level
    if (plan.reviewerId && plan.reviewerId !== agentId) {
      const agentConfig = agentConfigStore.get(agentId);
      const isCLevel = agentConfig?.level === 'c_level';
      if (!isCLevel) {
        return { error: `你不是此计划的审批者。审批者为: ${plan.reviewerName} (${plan.reviewerId})` };
      }
    }

    const result = devPlanQueue.approve(plan_id, agentId, comment);

    if (!result.success) {
      return { error: result.error };
    }

    logger.info(`开发计划已批准: ${plan_id}`, {
      reviewer: agentId,
      agent: plan.agentId,
      taskId: plan.taskId,
    });

    return {
      success: true,
      planId: plan_id,
      agent: plan.agentName,
      message: `已批准 ${plan.agentName} 的开发计划。系统将自动解锁开发工具并恢复任务执行。`,
    };
  },
};

/**
 * 驳回开发计划（Leader 使用）
 */
const rejectDevPlanTool = {
  name: 'reject_dev_plan',
  description: `驳回下属提交的开发计划。下属将收到反馈并需要修改后重新提交。

使用场景：
- 技术方案不合理
- 影响范围评估不足
- 缺少关键考虑
- 需要修改方向`,
  category: 'dev_plan_review',
  parameters: {
    plan_id: {
      type: 'string',
      description: '开发计划 ID',
      required: true,
    },
    feedback: {
      type: 'string',
      description: '驳回理由和修改建议（必填）',
      required: true,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { plan_id, feedback } = args;
    const { agentId } = context;

    if (!plan_id || !feedback) {
      return { error: '缺少必要参数：plan_id 和 feedback' };
    }

    const plan = devPlanQueue.get(plan_id);
    if (!plan) {
      const allPending = devPlanQueue.getPending();
      if (allPending.length === 1) {
        return await this.execute({ plan_id: allPending[0].id, feedback }, context);
      }
      return { error: `找不到计划: ${plan_id}` };
    }

    // 验证审批者身份
    if (plan.reviewerId && plan.reviewerId !== agentId) {
      const agentConfig = agentConfigStore.get(agentId);
      const isCLevel = agentConfig?.level === 'c_level';
      if (!isCLevel) {
        return { error: `你不是此计划的审批者。审批者为: ${plan.reviewerName} (${plan.reviewerId})` };
      }
    }

    const result = devPlanQueue.reject(plan_id, agentId, feedback);

    if (!result.success) {
      return { error: result.error };
    }

    logger.info(`开发计划已驳回: ${plan_id}`, {
      reviewer: agentId,
      agent: plan.agentId,
      taskId: plan.taskId,
      feedback: feedback.slice(0, 100),
    });

    return {
      success: true,
      planId: plan_id,
      agent: plan.agentName,
      message: `已驳回 ${plan.agentName} 的开发计划，反馈已发送。${plan.agentName} 将根据反馈修改计划并重新提交。`,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 创建群聊工具
// ═══════════════════════════════════════════════════════════

/**
 * 创建群聊（秘书和 CXO 可用）
 */
const createGroupChatTool = {
  name: 'create_group_chat',
  description: `创建一个群聊，邀请多个同事一起讨论问题。

使用场景：
- 需要多人协作讨论某个议题
- 跨部门沟通需要拉相关负责人
- 项目启动/复盘会议
- 需要多个 Agent 同时参与的决策

注意：
- 群聊创建后，老板和所有参与者都会看到
- 群聊中需要 @某人 才会触发该人回复
- 你可以在群里发初始消息说明讨论主题`,
  category: 'group_chat',
  parameters: {
    name: {
      type: 'string',
      description: '群聊名称（如"SmartTodo 项目讨论"、"Q1 预算审查"等）',
      required: true,
    },
    participants: {
      type: 'string',
      description: '参与者 Agent ID 列表，用逗号分隔（如 "cto,cfo,chro"）。不需要包含自己和老板，会自动加入。',
      required: true,
    },
    initial_message: {
      type: 'string',
      description: '群聊创建后的第一条消息，说明讨论主题和目的（可选）',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { name, participants, initial_message } = args;
    const { agentId } = context;

    if (!name) {
      return { error: '缺少必要参数：name（群聊名称）' };
    }
    if (!participants) {
      return { error: '缺少必要参数：participants（参与者列表）' };
    }

    // 解析参与者列表
    const participantIds = participants
      .split(/[,，\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (participantIds.length === 0) {
      return { error: '至少需要一个参与者' };
    }

    // 解析并验证每个参与者
    const resolvedParticipants = [];
    const invalidParticipants = [];
    for (const p of participantIds) {
      const resolved = agentConfigStore.resolve(p);
      if (resolved) {
        // 不重复添加自己
        if (resolved.agentId !== agentId) {
          resolvedParticipants.push(resolved.agentId);
        }
      } else {
        invalidParticipants.push(p);
      }
    }

    // 确保创建者自己也在群里
    if (!resolvedParticipants.includes(agentId)) {
      resolvedParticipants.push(agentId);
    }

    if (resolvedParticipants.length < 2) {
      return { error: '群聊至少需要 2 个 Agent 参与（不含老板）' };
    }

    if (invalidParticipants.length > 0) {
      const allConfigs = agentConfigStore.getAll();
      const available = allConfigs.map((c) => `${c.id} (${c.name})`).join(', ');
      return { error: `找不到以下同事：${invalidParticipants.join(', ')}。可用的同事有：${available}` };
    }

    // 调用 ChatManager 创建群聊
    try {
      const { chatManager } = require('../chat');
      const result = chatManager.createGroupFromBackend({
        name,
        participants: resolvedParticipants,
        creatorId: agentId,
        initialMessage: initial_message || null,
      });

      if (!result.success) {
        return { error: result.error || '群聊创建失败' };
      }

      const participantNames = resolvedParticipants.map((id) => {
        const config = agentConfigStore.get(id);
        return config ? `${config.name}(${id})` : id;
      });

      logger.info(`Agent 创建群聊: ${agentId} → ${name}`, { participants: resolvedParticipants });

      return {
        success: true,
        groupId: result.groupId,
        name,
        participants: participantNames,
        message: `群聊「${name}」已创建，参与者：${participantNames.join(', ')}`,
        note: '群聊已出现在老板的消息列表中。群内需要 @对方人名 才能触发回复。',
      };
    } catch (error) {
      logger.error('创建群聊失败:', error);
      return { error: `创建群聊失败: ${error.message}` };
    }
  },
};

// ═══════════════════════════════════════════════════════════
// 停职/复职管理工具
// ═══════════════════════════════════════════════════════════

/**
 * 停职下属（上司和 CHRO 可用）
 */
const suspendSubordinateTool = {
  name: 'suspend_subordinate',
  description: `停职一个下属 Agent。停职后该 Agent 的所有工具权限将被冻结，无法与任何同事沟通，只能与老板对话。

使用场景：
- 下属严重不遵守工作规范（不按 Git 流程、不执行任务）
- 下属反复出错、行为异常
- 需要临时冻结某个员工的操作权限

权限要求：
- 你必须是目标 Agent 的直属上级，或者你是 CHRO
- 核心成员（secretary, ceo, cto, cfo, chro）不可被停职

停职后果：
- 该员工的所有工具被冻结
- 无法接收或发送同事消息
- 无法执行任何委派任务
- 复职需要老板批准`,
  category: 'suspension',
  parameters: {
    target_agent: {
      type: 'string',
      description: '要停职的下属 Agent ID 或名称',
      required: true,
    },
    reason: {
      type: 'string',
      description: '停职原因（必填）',
      required: true,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { target_agent, reason } = args;
    const { agentId } = context;

    if (!target_agent || !reason) {
      return { error: '缺少必要参数：target_agent 和 reason' };
    }

    // 解析目标 Agent
    const resolved = agentConfigStore.resolve(target_agent);
    const targetId = resolved?.agentId || target_agent;
    const targetConfig = resolved?.config || agentConfigStore.get(targetId);

    if (!targetConfig) {
      return { error: `找不到 Agent: ${target_agent}` };
    }

    // 权限检查：调用者必须是目标的上级 or CHRO
    const callerConfig = agentConfigStore.get(agentId);
    const callerRole = callerConfig?.role;
    const isChro = callerRole === 'chro';
    const isSuperior = targetConfig.reportsTo === agentId;
    const isCLevel = callerConfig?.level === 'c_level';

    // CXO 可以停职同部门下属；CHRO 可以停职任何人
    if (!isChro && !isSuperior && !isCLevel) {
      return { error: '你没有权限停职该员工。只有直属上级、C-Level 管理层或 CHRO 可以执行停职。' };
    }

    // 执行停职
    const result = agentConfigStore.suspend(targetId, reason);
    if (!result.success) {
      return { error: result.error };
    }

    // 通知老板
    try {
      const { chatManager } = require('../chat');
      chatManager.pushProactiveMessage(agentId,
        `已对 ${targetConfig.name}（${targetConfig.title}）执行停职处理。\n原因：${reason}`
      );
    } catch (e) {
      logger.warn('通知老板停职结果失败:', e.message);
    }

    logger.info(`Agent 停职: ${agentId} 停职了 ${targetId}`, { reason });

    return {
      success: true,
      message: `已将「${targetConfig.name}（${targetConfig.title}）」停职`,
      agent: {
        id: targetId,
        name: targetConfig.name,
        title: targetConfig.title,
        status: 'suspended',
      },
      reason,
      note: '停职期间该员工无法使用任何工具、无法与同事沟通。复职需要老板批准后由 CHRO 执行。',
    };
  },
};

/**
 * 复职下属（CHRO 可用）
 */
const reinstateSubordinateTool = {
  name: 'reinstate_subordinate',
  description: `恢复一个被停职的 Agent，使其回到正常工作状态。

权限要求：
- 仅 CHRO 可执行复职操作
- 复职前应确认已获得老板批准`,
  category: 'suspension',
  parameters: {
    target_agent: {
      type: 'string',
      description: '要复职的 Agent ID 或名称',
      required: true,
    },
    comment: {
      type: 'string',
      description: '复职备注（如改进情况、后续要求等）',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { target_agent, comment = '' } = args;
    const { agentId } = context;

    if (!target_agent) {
      return { error: '缺少必要参数：target_agent' };
    }

    // 权限检查：仅 CHRO 可复职
    const callerConfig = agentConfigStore.get(agentId);
    if (callerConfig?.role !== 'chro') {
      return { error: '只有 CHRO 可以执行复职操作。请联系 CHRO 处理。' };
    }

    // 解析目标 Agent
    const resolved = agentConfigStore.resolve(target_agent);
    const targetId = resolved?.agentId || target_agent;
    const targetConfig = resolved?.config || agentConfigStore.get(targetId);

    if (!targetConfig) {
      return { error: `找不到 Agent: ${target_agent}` };
    }

    // 执行复职
    const result = agentConfigStore.reinstate(targetId, comment);
    if (!result.success) {
      return { error: result.error };
    }

    // 通知老板
    try {
      const { chatManager } = require('../chat');
      chatManager.pushProactiveMessage('chro',
        `已恢复 ${targetConfig.name}（${targetConfig.title}）的工作状态。${comment ? `\n备注：${comment}` : ''}`
      );
    } catch (e) {
      logger.warn('通知老板复职结果失败:', e.message);
    }

    logger.info(`Agent 复职: CHRO 恢复了 ${targetId}`, { comment });

    return {
      success: true,
      message: `已恢复「${targetConfig.name}（${targetConfig.title}）」的工作状态`,
      agent: {
        id: targetId,
        name: targetConfig.name,
        title: targetConfig.title,
        status: 'active',
      },
      note: comment || '该员工已恢复所有权限。',
    };
  },
};

/**
 * 取消委派任务（支持单个/批量取消）
 */
const cancelDelegatedTaskTool = {
  name: 'cancel_delegated_task',
  description: `取消委派任务。支持单个取消或批量取消。

使用方式：
- 取消单个任务：提供 task_id
- 批量取消：提供 filter 条件（如 status=in_progress），会取消所有匹配的、由你发起的任务
- 只能取消自己发起（assigned）的任务，不能取消别人分配给你的任务`,
  category: 'collaboration',
  parameters: {
    task_id: {
      type: 'string',
      description: '要取消的任务 ID（取消单个任务时使用）',
      required: false,
    },
    filter_status: {
      type: 'string',
      description: '批量取消时的状态筛选：pending、in_progress（不提供 task_id 时必填）',
      required: false,
    },
    filter_to_agent: {
      type: 'string',
      description: '批量取消时筛选接收人 Agent ID（可选）',
      required: false,
    },
    reason: {
      type: 'string',
      description: '取消原因',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { task_id, filter_status, filter_to_agent, reason } = args;
    const { agentId } = context;

    if (!task_id && !filter_status) {
      return { error: '请提供 task_id（取消单个任务）或 filter_status（批量取消）' };
    }

    const cancelReason = reason || '任务已取消';
    const now = Date.now();
    let cancelled = [];

    if (task_id) {
      // 单个取消
      const tasks = agentCommunication.getTasks(agentId, { type: 'assigned' });
      const task = tasks.find((t) => t.id === task_id);
      if (!task) {
        return { error: `未找到任务 ${task_id}，或你不是该任务的发起人` };
      }
      if (task.status === 'completed' || task.status === 'cancelled') {
        return { error: `任务 ${task_id} 已经是 ${task.status} 状态，无需取消` };
      }
      agentCommunication.updateTask(task_id, {
        status: 'cancelled',
        cancelledAt: now,
        cancelReason: cancelReason,
      });
      cancelled.push({ id: task_id, to: task.toAgent, description: task.taskDescription?.slice(0, 60) });
    } else {
      // 批量取消
      const tasks = agentCommunication.getTasks(agentId, { type: 'assigned' });
      const toCancel = tasks.filter((t) => {
        if (t.status === 'completed' || t.status === 'cancelled') return false;
        if (filter_status && t.status !== filter_status) return false;
        if (filter_to_agent && t.toAgent !== filter_to_agent) return false;
        return true;
      });

      if (toCancel.length === 0) {
        return { message: '没有找到匹配条件的可取消任务', cancelled: 0 };
      }

      for (const task of toCancel) {
        agentCommunication.updateTask(task.id, {
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: cancelReason,
        });
        cancelled.push({ id: task.id, to: task.toAgent, description: task.taskDescription?.slice(0, 60) });
      }
    }

    logger.info(`Agent ${agentId} 取消了 ${cancelled.length} 个委派任务`, {
      reason: cancelReason,
      taskIds: cancelled.map((t) => t.id),
    });

    return {
      message: `已取消 ${cancelled.length} 个任务`,
      cancelled: cancelled.length,
      tasks: cancelled,
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
  toolRegistry.register(communicationHistoryTool);
  toolRegistry.register(browseHistoryTool);
  toolRegistry.register(communicationInfoTool);
  toolRegistry.register(listColleaguesTool);
  toolRegistry.register(collaborationStatsTool);
  toolRegistry.register(notifyBossTool);
  toolRegistry.register(submitDevPlanTool);
  toolRegistry.register(approveDevPlanTool);
  toolRegistry.register(rejectDevPlanTool);
  toolRegistry.register(createGroupChatTool);
  toolRegistry.register(suspendSubordinateTool);
  toolRegistry.register(reinstateSubordinateTool);
  toolRegistry.register(cancelDelegatedTaskTool);

  logger.info('Agent 协作工具已注册');
}

module.exports = {
  registerCollaborationTools,
  sendToAgentTool,
  delegateTaskTool,
  myTasksTool,
  communicationHistoryTool,
  browseHistoryTool,
  communicationInfoTool,
  listColleaguesTool,
  collaborationStatsTool,
  notifyBossTool,
  submitDevPlanTool,
  approveDevPlanTool,
  rejectDevPlanTool,
  createGroupChatTool,
  suspendSubordinateTool,
  reinstateSubordinateTool,
  cancelDelegatedTaskTool,
};
