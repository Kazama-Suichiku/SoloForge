/**
 * SoloForge Mobile - 运营管理工具
 * 供 CXO 使用的目标、KPI、任务管理（简化版，无 Electron）
 * @module core/tools/operations-tools
 */

const { toolRegistry } = require('./tool-registry');
const { operationsStore } = require('../operations/operations-store');
const { agentConfigStore } = require('../config/agent-config-store');
const { logger } = require('../../utils/logger');
const { formatLocalTime } = require('../../utils/time-format');

// ─────────────────────────────────────────────────────────────
// 目标管理工具
// ─────────────────────────────────────────────────────────────

const createGoalTool = {
  name: 'ops_create_goal',
  description: `创建业务目标或 OKR。类型: strategic（战略）, quarterly（季度）, monthly（月度）, weekly（周）`,
  category: 'operations',
  parameters: {
    title: { type: 'string', description: '目标标题', required: true },
    description: { type: 'string', description: '详细描述', required: false },
    type: { type: 'string', description: '目标类型: strategic, quarterly, monthly, weekly', required: false },
    key_results: { type: 'array', description: '关键结果列表', required: false },
    due_date: { type: 'string', description: '截止日期（YYYY-MM-DD）', required: false },
    parent_id: { type: 'string', description: '父目标 ID', required: false },
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
    return { success: true, message: `目标已创建: ${goal.title}`, goal: { id: goal.id, title: goal.title, type: goal.type, status: goal.status, keyResults: goal.keyResults } };
  },
};

const updateGoalTool = {
  name: 'ops_update_goal',
  description: '更新目标进度或状态。',
  category: 'operations',
  parameters: {
    goal_id: { type: 'string', description: '目标 ID', required: true },
    progress: { type: 'number', description: '进度百分比（0-100）', required: false },
    status: { type: 'string', description: '状态: pending, in_progress, completed, cancelled', required: false },
    description: { type: 'string', description: '更新描述说明', required: false },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};
    const updates = {};
    if (args.progress !== undefined) updates.progress = args.progress;
    if (args.status) updates.status = args.status;
    if (args.description) updates.description = args.description;
    const goal = operationsStore.updateGoal(args.goal_id, updates, context?.agentId, config.name || '未知');
    if (!goal) return { success: false, error: '目标不存在' };
    return { success: true, message: `目标已更新: ${goal.title}`, goal: { id: goal.id, title: goal.title, progress: goal.progress, status: goal.status } };
  },
};

const listGoalsTool = {
  name: 'ops_list_goals',
  description: '查看目标列表。',
  category: 'operations',
  parameters: {
    status: { type: 'string', description: '按状态筛选: pending, in_progress, completed', required: false },
    type: { type: 'string', description: '按类型筛选: strategic, quarterly, monthly, weekly', required: false },
    my_only: { type: 'boolean', description: '是否只看自己负责的目标', required: false },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const filter = {};
    if (args.status) filter.status = args.status;
    if (args.type) filter.type = args.type;
    if (args.my_only) filter.ownerId = context?.agentId;
    const goals = operationsStore.getGoals(filter);
    return { success: true, totalCount: goals.length, goals: goals.map((g) => ({ id: g.id, title: g.title, type: g.type, owner: g.ownerName, department: g.department, progress: g.progress, status: g.status, dueDate: g.dueDate })) };
  },
};

const deleteGoalTool = {
  name: 'ops_delete_goal',
  description: '删除一个业务目标。必须 confirm=true 确认删除。',
  category: 'operations',
  parameters: { goal_id: { type: 'string', description: '要删除的目标 ID', required: true }, confirm: { type: 'boolean', description: '确认删除（必须为 true）', required: true } },
  requiredPermissions: [],
  async execute(args, context) {
    if (!args.goal_id) return { success: false, error: '必须指定目标 ID' };
    if (!args.confirm) return { success: false, error: '必须设置 confirm=true 确认删除' };
    const config = agentConfigStore.get(context?.agentId) || {};
    const result = operationsStore.deleteGoal(args.goal_id, context?.agentId, config.name || '未知');
    if (!result.success) return result;
    return { success: true, message: `目标「${result.deletedGoal.title}」已被永久删除`, deletedGoal: { id: result.deletedGoal.id, title: result.deletedGoal.title } };
  },
};

// ─────────────────────────────────────────────────────────────
// KPI 管理工具
// ─────────────────────────────────────────────────────────────

const createKPITool = {
  name: 'ops_create_kpi',
  description: '创建 KPI 指标。示例：用户增长率（目标 50%）、系统可用性（目标 99.9%）',
  category: 'operations',
  parameters: {
    name: { type: 'string', description: 'KPI 名称', required: true },
    description: { type: 'string', description: '描述', required: false },
    target: { type: 'number', description: '目标值', required: true },
    current: { type: 'number', description: '当前值', required: false },
    unit: { type: 'string', description: '单位（如 "%"、"ms"）', required: false },
    direction: { type: 'string', description: '方向: higher_better, lower_better, target_exact', required: false },
    period: { type: 'string', description: '周期（如 "2026-Q1"）', required: false },
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
    return { success: true, message: `KPI 已创建: ${kpi.name}`, kpi: { id: kpi.id, name: kpi.name, target: kpi.target, current: kpi.current, unit: kpi.unit } };
  },
};

const updateKPITool = {
  name: 'ops_update_kpi',
  description: '更新 KPI 的当前值。',
  category: 'operations',
  parameters: { kpi_id: { type: 'string', description: 'KPI ID', required: true }, value: { type: 'number', description: '新的当前值', required: true } },
  requiredPermissions: [],
  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};
    const kpi = operationsStore.updateKPIValue(args.kpi_id, args.value, context?.agentId, config.name || '未知');
    if (!kpi) return { success: false, error: 'KPI 不存在' };
    const progress = Math.round((kpi.current / kpi.target) * 100);
    return { success: true, message: `KPI 已更新: ${kpi.name}`, kpi: { id: kpi.id, name: kpi.name, target: kpi.target, current: kpi.current, unit: kpi.unit, progress: `${progress}%` } };
  },
};

const listKPIsTool = {
  name: 'ops_list_kpis',
  description: '查看 KPI 列表及完成情况。',
  category: 'operations',
  parameters: { period: { type: 'string', description: '按周期筛选', required: false }, my_only: { type: 'boolean', description: '是否只看自己负责的 KPI', required: false } },
  requiredPermissions: [],
  async execute(args, context) {
    const filter = {};
    if (args.period) filter.period = args.period;
    if (args.my_only) filter.ownerId = context?.agentId;
    const kpis = operationsStore.getKPIs(filter);
    return { success: true, totalCount: kpis.length, kpis: kpis.map((k) => ({ id: k.id, name: k.name, owner: k.ownerName, target: `${k.target}${k.unit}`, current: `${k.current}${k.unit}`, progress: `${k.target ? Math.round((k.current / k.target) * 100) : 0}%`, period: k.period })) };
  },
};

const deleteKPITool = {
  name: 'ops_delete_kpi',
  description: '删除一个 KPI 指标。必须 confirm=true 确认删除。',
  category: 'operations',
  parameters: { kpi_id: { type: 'string', description: '要删除的 KPI ID', required: true }, confirm: { type: 'boolean', description: '确认删除（必须为 true）', required: true } },
  requiredPermissions: [],
  async execute(args, context) {
    if (!args.kpi_id) return { success: false, error: '必须指定 KPI ID' };
    if (!args.confirm) return { success: false, error: '必须设置 confirm=true 确认删除' };
    const config = agentConfigStore.get(context?.agentId) || {};
    const result = operationsStore.deleteKPI(args.kpi_id, context?.agentId, config.name || '未知');
    if (!result.success) return result;
    return { success: true, message: `KPI「${result.deletedKPI.name}」已被永久删除`, deletedKPI: result.deletedKPI };
  },
};

// ─────────────────────────────────────────────────────────────
// 任务管理工具
// ─────────────────────────────────────────────────────────────

const createTaskTool = {
  name: 'ops_create_task',
  description: '创建任务并分配给团队成员。',
  category: 'operations',
  parameters: {
    title: { type: 'string', description: '任务标题', required: true },
    description: { type: 'string', description: '任务描述', required: false },
    assignee_id: { type: 'string', description: '执行人 Agent ID（如 cto, cfo）', required: true },
    priority: { type: 'string', description: '优先级: high, medium, low', required: false },
    project_id: { type: 'string', description: '关联的项目 ID（可选）', required: false },
    goal_id: { type: 'string', description: '关联的目标 ID', required: false },
    due_date: { type: 'string', description: '截止日期（YYYY-MM-DD）', required: false },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const requesterConfig = agentConfigStore.get(context?.agentId) || {};
    const resolvedAssignee = agentConfigStore.resolve(args.assignee_id);
    if (!resolvedAssignee) return { success: false, error: `找不到执行人: ${args.assignee_id}` };
    const { agentId: assigneeId, config: assigneeConfig } = resolvedAssignee;
    const task = operationsStore.createTask({
      title: args.title,
      description: args.description,
      priority: args.priority || 'medium',
      assigneeId,
      assigneeName: assigneeConfig.name,
      requesterId: context?.agentId,
      requesterName: requesterConfig.name || '未知',
      projectId: args.project_id || null,
      projectName: null,
      goalId: args.goal_id,
      dueDate: args.due_date,
    });
    return { success: true, message: `任务已创建并分配给 ${assigneeConfig.name}`, task: { id: task.id, title: task.title, assignee: task.assigneeName, priority: task.priority, status: task.status } };
  },
};

const updateTaskTool = {
  name: 'ops_update_task',
  description: '更新运营任务状态或优先级。状态: todo, in_progress, review, done, cancelled',
  category: 'operations',
  parameters: {
    task_id: { type: 'string', description: '运营任务 ID', required: true },
    status: { type: 'string', description: '状态: todo, in_progress, review, done, cancelled', required: false },
    priority: { type: 'string', description: '优先级: high, medium, low', required: false },
    cancel_reason: { type: 'string', description: '取消原因（status=cancelled 时建议提供）', required: false },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};
    const updates = {};
    if (args.status) updates.status = args.status;
    if (args.priority) updates.priority = args.priority;
    if (args.cancel_reason) updates.cancelReason = args.cancel_reason;
    const task = operationsStore.updateTask(args.task_id, updates, context?.agentId, config.name || '未知');
    if (!task) return { success: false, error: `任务 ${args.task_id} 不存在` };
    return { success: true, message: args.status === 'cancelled' ? '已取消' : '已更新', task: { id: task.id, title: task.title, status: task.status, priority: task.priority } };
  },
};

const listTasksTool = {
  name: 'ops_list_tasks',
  description: '查看任务列表。',
  category: 'operations',
  parameters: {
    status: { type: 'string', description: '按状态筛选: todo, in_progress, review, done', required: false },
    my_tasks: { type: 'boolean', description: '只看分配给自己的任务', required: false },
    assigned_by_me: { type: 'boolean', description: '只看自己分配的任务', required: false },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const filter = {};
    if (args.status) filter.status = args.status;
    if (args.my_tasks) filter.assigneeId = context?.agentId;
    if (args.assigned_by_me) filter.requesterId = context?.agentId;
    const tasks = operationsStore.getTasks(filter);
    return { success: true, totalCount: tasks.length, tasks: tasks.map((t) => ({ id: t.id, title: t.title, assignee: t.assigneeName, requester: t.requesterName, priority: t.priority, status: t.status, dueDate: t.dueDate, createdAt: formatLocalTime(t.createdAt) })) };
  },
};

const deleteTaskTool = {
  name: 'ops_delete_task',
  description: '删除一个任务。必须 confirm=true 确认删除。',
  category: 'operations',
  parameters: { task_id: { type: 'string', description: '要删除的任务 ID', required: true }, confirm: { type: 'boolean', description: '确认删除（必须为 true）', required: true } },
  requiredPermissions: [],
  async execute(args, context) {
    if (!args.task_id) return { success: false, error: '必须指定任务 ID' };
    if (!args.confirm) return { success: false, error: '必须设置 confirm=true 确认删除' };
    const config = agentConfigStore.get(context?.agentId) || {};
    const result = operationsStore.deleteTask(args.task_id, context?.agentId, config.name || '未知');
    if (!result.success) return result;
    return { success: true, message: `任务「${result.deletedTask.title}」已被永久删除`, deletedTask: { id: result.deletedTask.id, title: result.deletedTask.title } };
  },
};

const claimTaskTool = {
  name: 'ops_claim_task',
  description: '认领一个待办任务。',
  category: 'operations',
  parameters: { task_id: { type: 'string', description: '任务 ID', required: true } },
  requiredPermissions: [],
  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};
    const task = operationsStore.getTask(args.task_id);
    if (!task) return { success: false, error: '任务不存在' };
    if (task.status !== 'todo') return { success: false, error: `任务状态为 ${task.status}，无法认领` };
    const updated = operationsStore.updateTask(args.task_id, { assigneeId: context?.agentId, assigneeName: config.name || context?.agentId, status: 'in_progress' }, context?.agentId, config.name || '未知');
    operationsStore.logActivity('task', `${config.name || context?.agentId} 认领了任务: ${task.title}`, context?.agentId, config.name || '未知', { taskId: task.id });
    return { success: true, message: `已认领任务: ${task.title}`, task: updated };
  },
};

const reportTaskProgressTool = {
  name: 'ops_report_progress',
  description: '汇报任务进度或完成任务。',
  category: 'operations',
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
    progress: { type: 'string', description: '进度描述', required: true },
    status: { type: 'string', description: '更新状态: in_progress, review, done, blocked', required: false },
    result: { type: 'string', description: '任务结果（完成时填写）', required: false },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const config = agentConfigStore.get(context?.agentId) || {};
    const task = operationsStore.getTask(args.task_id);
    if (!task) return { success: false, error: '任务不存在' };
    const updates = {};
    if (args.status) updates.status = args.status;
    if (args.result) updates.result = args.result;
    updates.progressLog = [...(task.progressLog || []), { agent: context?.agentId, agentName: config.name, content: args.progress, timestamp: Date.now() }];
    const updated = operationsStore.updateTask(args.task_id, updates, context?.agentId, config.name || '未知');
    operationsStore.logActivity('task', `${config.name || context?.agentId} 汇报进度: ${args.progress.slice(0, 50)}${args.progress.length > 50 ? '...' : ''}`, context?.agentId, config.name || '未知', { taskId: task.id });
    return { success: true, message: args.status === 'done' ? '任务已完成' : '进度已更新', task: updated };
  },
};

const myAssignedTasksTool = {
  name: 'ops_my_tasks',
  description: '获取分配给我的任务列表。',
  category: 'operations',
  parameters: { status: { type: 'string', description: '状态筛选: todo, in_progress, review, done', required: false } },
  requiredPermissions: [],
  async execute(args, context) {
    const tasks = operationsStore.getTasks({ assigneeId: context?.agentId });
    let filtered = tasks;
    if (args.status) filtered = tasks.filter((t) => t.status === args.status);
    return { success: true, totalCount: filtered.length, tasks: filtered.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, creator: t.requesterName, dueDate: t.dueDate })) };
  },
};

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
        goals: { ...summary.goals, progressBar: `[${'█'.repeat(Math.floor(summary.goals.avgProgress / 10))}${'░'.repeat(10 - Math.floor(summary.goals.avgProgress / 10))}] ${summary.goals.avgProgress}%` },
        tasks: summary.tasks,
        kpis: summary.kpis,
      },
      recentActivity: summary.recentActivity.map((a) => ({ time: formatLocalTime(a.createdAt), actor: a.actorName, action: a.action, category: a.category })),
    };
  },
};

const activityLogTool = {
  name: 'ops_activity_log',
  description: '获取公司活动日志。',
  category: 'operations',
  parameters: { category: { type: 'string', description: '按类别筛选: goal, kpi, task', required: false }, limit: { type: 'number', description: '返回数量限制（默认 20）', required: false } },
  requiredPermissions: [],
  async execute(args) {
    const filter = args.category ? { category: args.category } : {};
    const logs = operationsStore.getActivityLog(filter, args.limit || 20);
    return { success: true, totalCount: logs.length, logs: logs.map((l) => ({ time: formatLocalTime(l.createdAt), category: l.category, actor: l.actorName, action: l.action })) };
  },
};

function registerOperationsTools() {
  toolRegistry.register(createGoalTool);
  toolRegistry.register(updateGoalTool);
  toolRegistry.register(listGoalsTool);
  toolRegistry.register(deleteGoalTool);
  toolRegistry.register(createKPITool);
  toolRegistry.register(updateKPITool);
  toolRegistry.register(listKPIsTool);
  toolRegistry.register(deleteKPITool);
  toolRegistry.register(createTaskTool);
  toolRegistry.register(updateTaskTool);
  toolRegistry.register(listTasksTool);
  toolRegistry.register(deleteTaskTool);
  toolRegistry.register(claimTaskTool);
  toolRegistry.register(reportTaskProgressTool);
  toolRegistry.register(myAssignedTasksTool);
  toolRegistry.register(dashboardSummaryTool);
  toolRegistry.register(activityLogTool);
}

module.exports = {
  registerOperationsTools,
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
};
