/**
 * SoloForge - 运营管理工具
 * 供 CXO 使用的目标、KPI、任务管理工具
 * @module tools/operations-tools
 */

const { toolRegistry } = require('./tool-registry');
const { operationsStore } = require('../operations/operations-store');
const { agentConfigStore } = require('../config/agent-config-store');
const { logger } = require('../utils/logger');
const { formatLocalTime } = require('../utils/time-format');

// ─────────────────────────────────────────────────────────────
// 目标管理工具
// ─────────────────────────────────────────────────────────────

/**
 * 创建目标
 */
const createGoalTool = {
  name: 'ops_create_goal',
  description: `创建业务目标或 OKR。

目标类型：
- strategic: 战略目标（年度）
- quarterly: 季度目标
- monthly: 月度目标
- weekly: 周目标

示例：
- "本季度完成用户增长 50%"
- "本月完成新功能开发"
- "本周完成 API 文档"`,
  category: 'operations',
  parameters: {
    title: {
      type: 'string',
      description: '目标标题',
      required: true,
    },
    description: {
      type: 'string',
      description: '详细描述',
      required: false,
    },
    type: {
      type: 'string',
      description: '目标类型: strategic, quarterly, monthly, weekly',
      required: false,
    },
    key_results: {
      type: 'array',
      description: '关键结果列表（字符串数组）',
      required: false,
    },
    due_date: {
      type: 'string',
      description: '截止日期（YYYY-MM-DD）',
      required: false,
    },
    parent_id: {
      type: 'string',
      description: '父目标 ID（如果这是子目标）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};

    const goal = operationsStore.createGoal({
      title: args.title,
      description: args.description,
      type: args.type || 'quarterly',
      ownerId: context?.agentId,
      ownerName: config.name || context?.agentName || '未知',
      department: config.department || '',
      keyResults: args.key_results,
      dueDate: args.due_date,
      parentId: args.parent_id,
    });

    logger.info('创建目标', { goalId: goal.id, title: goal.title });

    return {
      success: true,
      message: `目标已创建: ${goal.title}`,
      goal: {
        id: goal.id,
        title: goal.title,
        type: goal.type,
        status: goal.status,
        keyResults: goal.keyResults,
      },
    };
  },
};

/**
 * 更新目标进度
 */
const updateGoalTool = {
  name: 'ops_update_goal',
  description: '更新目标进度或状态。',
  category: 'operations',
  parameters: {
    goal_id: {
      type: 'string',
      description: '目标 ID',
      required: true,
    },
    progress: {
      type: 'number',
      description: '进度百分比（0-100）',
      required: false,
    },
    status: {
      type: 'string',
      description: '状态: pending, in_progress, completed, cancelled',
      required: false,
    },
    description: {
      type: 'string',
      description: '更新描述说明',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};

    const updates = {};
    if (args.progress !== undefined) updates.progress = args.progress;
    if (args.status) updates.status = args.status;
    if (args.description) updates.description = args.description;

    const goal = operationsStore.updateGoal(
      args.goal_id,
      updates,
      context?.agentId,
      config.name || '未知'
    );

    if (!goal) {
      return { success: false, error: '目标不存在' };
    }

    return {
      success: true,
      message: `目标已更新: ${goal.title}`,
      goal: {
        id: goal.id,
        title: goal.title,
        progress: goal.progress,
        status: goal.status,
      },
    };
  },
};

/**
 * 查看目标列表
 */
const listGoalsTool = {
  name: 'ops_list_goals',
  description: '查看目标列表。',
  category: 'operations',
  parameters: {
    status: {
      type: 'string',
      description: '按状态筛选: pending, in_progress, completed',
      required: false,
    },
    type: {
      type: 'string',
      description: '按类型筛选: strategic, quarterly, monthly, weekly',
      required: false,
    },
    my_only: {
      type: 'boolean',
      description: '是否只看自己负责的目标',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const filter = {};
    if (args.status) filter.status = args.status;
    if (args.type) filter.type = args.type;
    if (args.my_only) filter.ownerId = context?.agentId;

    const goals = operationsStore.getGoals(filter);

    return {
      success: true,
      totalCount: goals.length,
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        type: g.type,
        owner: g.ownerName,
        department: g.department,
        progress: g.progress,
        status: g.status,
        dueDate: g.dueDate,
      })),
    };
  },
};

/**
 * 删除目标
 */
const deleteGoalTool = {
  name: 'ops_delete_goal',
  description: `删除一个业务目标。删除后数据将被永久移除。

注意：删除前请确认目标确实不再需要。`,
  category: 'operations',
  parameters: {
    goal_id: {
      type: 'string',
      description: '要删除的目标 ID',
      required: true,
    },
    confirm: {
      type: 'boolean',
      description: '确认删除（必须为 true）',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    if (!args.goal_id) return { success: false, error: '必须指定目标 ID' };
    if (!args.confirm) return { success: false, error: '必须设置 confirm=true 确认删除' };

    const config = agentConfigStore.get(context?.agentId) || {};
    const result = operationsStore.deleteGoal(
      args.goal_id,
      context?.agentId,
      config.name || '未知'
    );

    if (!result.success) {
      return result;
    }

    logger.info('删除目标', { goalId: args.goal_id, title: result.deletedGoal.title });

    return {
      success: true,
      message: `目标「${result.deletedGoal.title}」已被永久删除`,
      deletedGoal: {
        id: result.deletedGoal.id,
        title: result.deletedGoal.title,
        type: result.deletedGoal.type,
        status: result.deletedGoal.status,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// KPI 管理工具
// ─────────────────────────────────────────────────────────────

/**
 * 创建 KPI
 */
const createKPITool = {
  name: 'ops_create_kpi',
  description: `创建 KPI 指标。

示例：
- 用户增长率（目标 50%）
- 系统可用性（目标 99.9%）
- 响应时间（目标 < 100ms）`,
  category: 'operations',
  parameters: {
    name: {
      type: 'string',
      description: 'KPI 名称',
      required: true,
    },
    description: {
      type: 'string',
      description: '描述',
      required: false,
    },
    target: {
      type: 'number',
      description: '目标值',
      required: true,
    },
    current: {
      type: 'number',
      description: '当前值',
      required: false,
    },
    unit: {
      type: 'string',
      description: '单位（如 "%"、"ms"、"次"）',
      required: false,
    },
    direction: {
      type: 'string',
      description: '方向: higher_better（越高越好）, lower_better（越低越好）, target_exact（越接近目标越好）',
      required: false,
    },
    period: {
      type: 'string',
      description: '周期（如 "2026-Q1"、"2026-02"）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};

    const kpi = operationsStore.createKPI({
      name: args.name,
      description: args.description,
      target: args.target,
      current: args.current || 0,
      unit: args.unit || '',
      direction: args.direction || 'higher_better',
      period: args.period || '',
      ownerId: context?.agentId,
      ownerName: config.name || '未知',
      department: config.department || '',
    });

    return {
      success: true,
      message: `KPI 已创建: ${kpi.name}`,
      kpi: {
        id: kpi.id,
        name: kpi.name,
        target: kpi.target,
        current: kpi.current,
        unit: kpi.unit,
      },
    };
  },
};

/**
 * 更新 KPI 值
 */
const updateKPITool = {
  name: 'ops_update_kpi',
  description: '更新 KPI 的当前值。',
  category: 'operations',
  parameters: {
    kpi_id: {
      type: 'string',
      description: 'KPI ID',
      required: true,
    },
    value: {
      type: 'number',
      description: '新的当前值',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};

    const kpi = operationsStore.updateKPIValue(
      args.kpi_id,
      args.value,
      context?.agentId,
      config.name || '未知'
    );

    if (!kpi) {
      return { success: false, error: 'KPI 不存在' };
    }

    const progress = Math.round((kpi.current / kpi.target) * 100);

    return {
      success: true,
      message: `KPI 已更新: ${kpi.name}`,
      kpi: {
        id: kpi.id,
        name: kpi.name,
        target: kpi.target,
        current: kpi.current,
        unit: kpi.unit,
        progress: `${progress}%`,
      },
    };
  },
};

/**
 * 查看 KPI 列表
 */
const listKPIsTool = {
  name: 'ops_list_kpis',
  description: '查看 KPI 列表及完成情况。',
  category: 'operations',
  parameters: {
    period: {
      type: 'string',
      description: '按周期筛选',
      required: false,
    },
    my_only: {
      type: 'boolean',
      description: '是否只看自己负责的 KPI',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const filter = {};
    if (args.period) filter.period = args.period;
    if (args.my_only) filter.ownerId = context?.agentId;

    const kpis = operationsStore.getKPIs(filter);

    return {
      success: true,
      totalCount: kpis.length,
      kpis: kpis.map((k) => {
        const progress = k.target ? Math.round((k.current / k.target) * 100) : 0;
        let status = 'on_track';
        if (k.direction === 'higher_better' && progress < 50) status = 'at_risk';
        if (k.direction === 'lower_better' && progress > 150) status = 'at_risk';

        return {
          id: k.id,
          name: k.name,
          owner: k.ownerName,
          target: `${k.target}${k.unit}`,
          current: `${k.current}${k.unit}`,
          progress: `${progress}%`,
          status,
          period: k.period,
        };
      }),
    };
  },
};

/**
 * 删除 KPI
 */
const deleteKPITool = {
  name: 'ops_delete_kpi',
  description: `删除一个 KPI 指标。删除后数据将被永久移除。

注意：删除前请确认 KPI 确实不再需要。`,
  category: 'operations',
  parameters: {
    kpi_id: {
      type: 'string',
      description: '要删除的 KPI ID',
      required: true,
    },
    confirm: {
      type: 'boolean',
      description: '确认删除（必须为 true）',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    if (!args.kpi_id) return { success: false, error: '必须指定 KPI ID' };
    if (!args.confirm) return { success: false, error: '必须设置 confirm=true 确认删除' };

    const config = agentConfigStore.get(context?.agentId) || {};
    const result = operationsStore.deleteKPI(
      args.kpi_id,
      context?.agentId,
      config.name || '未知'
    );

    if (!result.success) {
      return result;
    }

    logger.info('删除 KPI', { kpiId: args.kpi_id, name: result.deletedKPI.name });

    return {
      success: true,
      message: `KPI「${result.deletedKPI.name}」已被永久删除`,
      deletedKPI: {
        id: result.deletedKPI.id,
        name: result.deletedKPI.name,
        target: result.deletedKPI.target,
        current: result.deletedKPI.current,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 任务管理工具
// ─────────────────────────────────────────────────────────────

/**
 * 创建任务
 */
const createTaskTool = {
  name: 'ops_create_task',
  description: `创建任务并分配给团队成员。

建议：
- 如果任务属于某个项目，请指定 project_id 以便追踪
- 项目取消时，关联的任务会自动取消`,
  category: 'operations',
  parameters: {
    title: {
      type: 'string',
      description: '任务标题',
      required: true,
    },
    description: {
      type: 'string',
      description: '任务描述',
      required: false,
    },
    assignee_id: {
      type: 'string',
      description: '执行人 Agent ID（如 cto, cfo）',
      required: true,
    },
    priority: {
      type: 'string',
      description: '优先级: high, medium, low',
      required: false,
    },
    project_id: {
      type: 'string',
      description: '关联的项目 ID（强烈建议指定，便于项目管理和级联操作）',
      required: false,
    },
    goal_id: {
      type: 'string',
      description: '关联的目标 ID',
      required: false,
    },
    due_date: {
      type: 'string',
      description: '截止日期（YYYY-MM-DD）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const requesterConfig = agentConfigStore.get(context?.agentId) || {};
    const resolvedAssignee = agentConfigStore.resolve(args.assignee_id);

    if (!resolvedAssignee) {
      return { success: false, error: `找不到执行人: ${args.assignee_id}（请使用 Agent ID 或显示名）` };
    }
    const assigneeId = resolvedAssignee.agentId;
    const assigneeConfig = resolvedAssignee.config;

    // 如果指定了项目，获取项目名称
    let projectName = null;
    if (args.project_id) {
      try {
        const { projectStore } = require('../pm/project-store');
        const project = projectStore.getProject(args.project_id);
        if (project) {
          projectName = project.name;
          // 检查项目状态
          if (project.status === 'cancelled') {
            return { success: false, error: `项目 "${project.name}" 已取消，无法创建新任务` };
          }
        } else {
          return { success: false, error: `找不到项目: ${args.project_id}` };
        }
      } catch (e) {
        // projectStore 可能未初始化
      }
    }

    const task = operationsStore.createTask({
      title: args.title,
      description: args.description,
      priority: args.priority || 'medium',
      assigneeId: assigneeId,
      assigneeName: assigneeConfig.name,
      requesterId: context?.agentId,
      requesterName: requesterConfig.name || '未知',
      projectId: args.project_id || null,
      projectName: projectName,
      goalId: args.goal_id,
      dueDate: args.due_date,
    });

    return {
      success: true,
      message: `任务已创建并分配给 ${assigneeConfig.name}${projectName ? ` [项目: ${projectName}]` : ''}`,
      task: {
        id: task.id,
        title: task.title,
        assignee: task.assigneeName,
        priority: task.priority,
        status: task.status,
        projectId: task.projectId,
        projectName: task.projectName,
      },
    };
  },
};

/**
 * 更新任务状态
 */
const updateTaskTool = {
  name: 'ops_update_task',
  description: `更新运营任务（Operations Task）的状态或优先级。

**重要**: 这是运营任务系统，不是委派任务系统！
- 运营任务 ID 格式: task-xxxxxxxxxx-xxxx（带 task- 前缀）
- 委派任务请使用 update_delegated_task 或 cancel_delegated_task 工具

**使用前**: 请先用 ops_list_tasks 或 ops_my_tasks 获取有效的任务 ID。

**可用状态**:
- todo: 待办
- in_progress: 进行中
- review: 待审核
- done: 已完成
- cancelled: 已取消（需要提供 cancel_reason）

**取消任务**: 将 status 设为 cancelled 即可取消任务。`,
  category: 'operations',
  parameters: {
    task_id: {
      type: 'string',
      description: '运营任务 ID（格式: task-xxxxxxxxxx-xxxx，请先用 ops_list_tasks 查询）',
      required: true,
    },
    status: {
      type: 'string',
      description: '状态: todo, in_progress, review, done, cancelled',
      required: false,
    },
    priority: {
      type: 'string',
      description: '优先级: high, medium, low',
      required: false,
    },
    cancel_reason: {
      type: 'string',
      description: '取消原因（当 status=cancelled 时建议提供）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};

    const updates = {};
    if (args.status) updates.status = args.status;
    if (args.priority) updates.priority = args.priority;
    if (args.cancel_reason) updates.cancelReason = args.cancel_reason;

    const task = operationsStore.updateTask(
      args.task_id,
      updates,
      context?.agentId,
      config.name || '未知'
    );

    if (!task) {
      // 提供更详细的错误信息
      return { 
        success: false, 
        error: `任务 ${args.task_id} 不存在。请先使用 ops_list_tasks 工具获取有效的运营任务列表。如果你要操作的是委派任务（Agent 间协作任务），请使用 update_delegated_task 或 cancel_delegated_task 工具。`,
      };
    }

    const statusMsg = args.status === 'cancelled' ? '已取消' : '已更新';
    return {
      success: true,
      message: `任务${statusMsg}: ${task.title}`,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        cancelReason: task.cancelReason,
        cancelledAt: task.cancelledAt,
      },
    };
  },
};

/**
 * 查看任务列表
 */
const listTasksTool = {
  name: 'ops_list_tasks',
  description: '查看任务列表。',
  category: 'operations',
  parameters: {
    status: {
      type: 'string',
      description: '按状态筛选: todo, in_progress, review, done',
      required: false,
    },
    my_tasks: {
      type: 'boolean',
      description: '只看分配给自己的任务',
      required: false,
    },
    assigned_by_me: {
      type: 'boolean',
      description: '只看自己分配的任务',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const filter = {};
    if (args.status) filter.status = args.status;
    if (args.my_tasks) filter.assigneeId = context?.agentId;
    if (args.assigned_by_me) filter.requesterId = context?.agentId;

    const tasks = operationsStore.getTasks(filter);

    return {
      success: true,
      totalCount: tasks.length,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        assignee: t.assigneeName,
        requester: t.requesterName,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate,
        createdAt: formatLocalTime(t.createdAt),
      })),
    };
  },
};

/**
 * 删除任务
 */
const deleteTaskTool = {
  name: 'ops_delete_task',
  description: `删除一个任务。删除后数据将被永久移除。

注意：删除前请确认任务确实不再需要。`,
  category: 'operations',
  parameters: {
    task_id: {
      type: 'string',
      description: '要删除的任务 ID',
      required: true,
    },
    confirm: {
      type: 'boolean',
      description: '确认删除（必须为 true）',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    if (!args.task_id) return { success: false, error: '必须指定任务 ID' };
    if (!args.confirm) return { success: false, error: '必须设置 confirm=true 确认删除' };

    const config = agentConfigStore.get(context?.agentId) || {};
    const result = operationsStore.deleteTask(
      args.task_id,
      context?.agentId,
      config.name || '未知'
    );

    if (!result.success) {
      return result;
    }

    logger.info('删除任务', { taskId: args.task_id, title: result.deletedTask.title });

    return {
      success: true,
      message: `任务「${result.deletedTask.title}」已被永久删除`,
      deletedTask: {
        id: result.deletedTask.id,
        title: result.deletedTask.title,
        assignee: result.deletedTask.assigneeName,
        status: result.deletedTask.status,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 仪表板工具
// ─────────────────────────────────────────────────────────────

/**
 * 获取运营概览
 */
const dashboardSummaryTool = {
  name: 'ops_dashboard',
  description: '获取公司运营仪表板摘要，包括目标、KPI、任务统计和最近活动。',
  category: 'operations',
  parameters: {},
  requiredPermissions: [],

  async execute() {
    const summary = operationsStore.getDashboardSummary();

    return {
      success: true,
      summary: {
        goals: {
          ...summary.goals,
          progressBar: `[${'█'.repeat(Math.floor(summary.goals.avgProgress / 10))}${'░'.repeat(10 - Math.floor(summary.goals.avgProgress / 10))}] ${summary.goals.avgProgress}%`,
        },
        tasks: summary.tasks,
        kpis: summary.kpis,
      },
      recentActivity: summary.recentActivity.map((a) => ({
        time: formatLocalTime(a.createdAt),
        actor: a.actorName,
        action: a.action,
        category: a.category,
      })),
    };
  },
};

/**
 * 获取活动日志
 */
const activityLogTool = {
  name: 'ops_activity_log',
  description: '获取公司活动日志，了解最近发生了什么。',
  category: 'operations',
  parameters: {
    category: {
      type: 'string',
      description: '按类别筛选: goal, kpi, task, recruit, approval, system',
      required: false,
    },
    limit: {
      type: 'number',
      description: '返回数量限制（默认 20）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const filter = {};
    if (args.category) filter.category = args.category;

    const logs = operationsStore.getActivityLog(filter, args.limit || 20);

    return {
      success: true,
      totalCount: logs.length,
      logs: logs.map((l) => ({
        time: formatLocalTime(l.createdAt),
        category: l.category,
        actor: l.actorName,
        action: l.action,
      })),
    };
  },
};

/**
 * 认领任务
 */
const claimTaskTool = {
  name: 'ops_claim_task',
  description: `认领一个待办任务。

使用场景：
- 主动承担一个未分配或待办的任务
- 从任务池中选择自己能做的任务`,
  category: 'operations',
  parameters: {
    task_id: {
      type: 'string',
      description: '任务 ID',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};
    const task = operationsStore.getTask(args.task_id);

    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    if (task.status !== 'todo') {
      return { success: false, error: `任务状态为 ${task.status}，无法认领` };
    }

    const updated = operationsStore.updateTask(
      args.task_id,
      {
        assigneeId: context?.agentId,
        assigneeName: config.name || context?.agentId,
        status: 'in_progress',
      },
      context?.agentId,
      config.name || '未知'
    );

    operationsStore.logActivity(
      'task',
      `${config.name || context?.agentId} 认领了任务: ${task.title}`,
      context?.agentId,
      config.name || '未知',
      { taskId: task.id }
    );

    return {
      success: true,
      message: `已认领任务: ${task.title}`,
      task: updated,
    };
  },
};

/**
 * 汇报任务进度
 */
const reportTaskProgressTool = {
  name: 'ops_report_progress',
  description: `汇报任务进度或完成任务。

使用场景：
- 更新任务执行进度
- 完成任务并提交结果
- 遇到问题需要反馈`,
  category: 'operations',
  parameters: {
    task_id: {
      type: 'string',
      description: '任务 ID',
      required: true,
    },
    progress: {
      type: 'string',
      description: '进度描述',
      required: true,
    },
    status: {
      type: 'string',
      description: '更新状态: in_progress, review, done, blocked',
      required: false,
    },
    result: {
      type: 'string',
      description: '任务结果（完成时填写）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};
    const task = operationsStore.getTask(args.task_id);

    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    const updates = {};
    if (args.status) updates.status = args.status;
    if (args.result) updates.result = args.result;

    // 添加进度记录到任务
    if (!updates.progressLog) {
      updates.progressLog = task.progressLog || [];
    }
    updates.progressLog.push({
      agent: context?.agentId,
      agentName: config.name,
      content: args.progress,
      timestamp: Date.now(),
    });

    const updated = operationsStore.updateTask(
      args.task_id,
      updates,
      context?.agentId,
      config.name || '未知'
    );

    operationsStore.logActivity(
      'task',
      `${config.name || context?.agentId} 汇报进度: ${args.progress.slice(0, 50)}${args.progress.length > 50 ? '...' : ''}`,
      context?.agentId,
      config.name || '未知',
      { taskId: task.id }
    );

    return {
      success: true,
      message: args.status === 'done' ? '任务已完成' : '进度已更新',
      task: updated,
    };
  },
};

/**
 * 获取分配给我的任务
 */
const myAssignedTasksTool = {
  name: 'ops_my_tasks',
  description: '获取分配给我的任务列表，可按状态筛选。',
  category: 'operations',
  parameters: {
    status: {
      type: 'string',
      description: '状态筛选: todo, in_progress, review, done',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const tasks = operationsStore.getTasks({ assigneeId: context?.agentId });

    let filteredTasks = tasks;
    if (args.status) {
      filteredTasks = tasks.filter((t) => t.status === args.status);
    }

    return {
      success: true,
      totalCount: filteredTasks.length,
      tasks: filteredTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        creator: t.requesterName,
        dueDate: t.dueDate,
        goalId: t.goalId,
        progressCount: t.progressLog?.length || 0,
      })),
    };
  },
};

/**
 * 注册运营工具
 */
function registerOperationsTools() {
  // 目标
  toolRegistry.register(createGoalTool);
  toolRegistry.register(updateGoalTool);
  toolRegistry.register(listGoalsTool);
  toolRegistry.register(deleteGoalTool);

  // KPI
  toolRegistry.register(createKPITool);
  toolRegistry.register(updateKPITool);
  toolRegistry.register(listKPIsTool);
  toolRegistry.register(deleteKPITool);

  // 任务
  toolRegistry.register(createTaskTool);
  toolRegistry.register(updateTaskTool);
  toolRegistry.register(listTasksTool);
  toolRegistry.register(deleteTaskTool);
  toolRegistry.register(claimTaskTool);
  toolRegistry.register(reportTaskProgressTool);
  toolRegistry.register(myAssignedTasksTool);

  // 仪表板
  toolRegistry.register(dashboardSummaryTool);
  toolRegistry.register(activityLogTool);
}

module.exports = {
  createGoalTool,
  updateGoalTool,
  listGoalsTool,
  deleteGoalTool,
  createKPITool,
  updateKPITool,
  listKPIsTool,
  deleteKPITool,
  createTaskTool,
  updateTaskTool,
  listTasksTool,
  deleteTaskTool,
  claimTaskTool,
  reportTaskProgressTool,
  myAssignedTasksTool,
  dashboardSummaryTool,
  activityLogTool,
  registerOperationsTools,
};
