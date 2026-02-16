/**
 * SoloForge - 项目管理工具
 * 供 PM（秘书）和项目负责人使用的项目管理工具
 * @module tools/pm-tools
 */

const { toolRegistry } = require('./tool-registry');
const { projectStore } = require('../pm/project-store');
const { operationsStore } = require('../operations/operations-store');
const { agentConfigStore } = require('../config/agent-config-store');
const { logger } = require('../utils/logger');
const { formatLocalTime } = require('../utils/time-format');

// ─────────────────────────────────────────────────────────────
// 项目创建与管理
// ─────────────────────────────────────────────────────────────

const createProjectTool = {
  name: 'pm_create_project',
  description: `创建一个新项目。创建后系统会自动跟踪进度、发送站会通知、同步 Dashboard。

使用场景：
- 老板交代了一个新项目
- 开始一个新的产品/功能开发
- 需要多人协作完成的工作

示例：pm_create_project(name="SmartTodo MVP", description="智能待办事项应用第一版", owner_id="cto")`,
  category: 'pm',
  parameters: {
    name: { type: 'string', description: '项目名称', required: true },
    description: { type: 'string', description: '项目描述', required: false },
    owner_id: { type: 'string', description: '项目负责人 Agent ID（如 cto）', required: true },
    standup_interval_minutes: {
      type: 'number',
      description: '站会间隔分钟数（默认 30，即每 30 分钟检查一次进度）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const resolved = agentConfigStore.resolve(args.owner_id);
    if (!resolved) {
      return { success: false, error: `找不到负责人: ${args.owner_id}（请使用 Agent ID 如 "cto"，或显示名如 "李工"）` };
    }
    const ownerId = resolved.agentId;
    const ownerConfig = resolved.config;

    // 同时创建运营目标
    const goal = operationsStore.createGoal({
      title: args.name,
      description: args.description || '',
      type: 'quarterly',
      ownerId,
      ownerName: ownerConfig.name,
      department: ownerConfig.department || '',
    });

    const intervalMs = (args.standup_interval_minutes || 30) * 60 * 1000;

    const project = projectStore.createProject({
      name: args.name,
      description: args.description || '',
      ownerId,
      ownerName: ownerConfig.name,
      goalId: goal.id,
      standupIntervalMs: intervalMs,
    });

    logger.info('PM: 项目已创建', { projectId: project.id, goalId: goal.id });

    return {
      success: true,
      message: `项目「${project.name}」已创建，负责人: ${ownerConfig.name}`,
      project: {
        id: project.id,
        name: project.name,
        owner: ownerConfig.name,
        goalId: goal.id,
        standupInterval: `${args.standup_interval_minutes || 30} 分钟`,
      },
      tip: '接下来使用 pm_add_milestone 添加里程碑，再用 pm_add_tasks 批量添加任务',
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 里程碑管理
// ─────────────────────────────────────────────────────────────

const addMilestoneTool = {
  name: 'pm_add_milestone',
  description: `为项目添加里程碑。里程碑代表项目的重要阶段节点。

示例：pm_add_milestone(project_id="proj-xxx", name="基础组件开发", due_date="2026-03-01")`,
  category: 'pm',
  parameters: {
    project_id: { type: 'string', description: '项目 ID', required: true },
    name: { type: 'string', description: '里程碑名称', required: true },
    description: { type: 'string', description: '描述', required: false },
    due_date: { type: 'string', description: '截止日期（YYYY-MM-DD）', required: false },
    order: { type: 'number', description: '排序序号（从 0 开始）', required: false },
  },
  requiredPermissions: [],

  async execute(args) {
    const ms = projectStore.addMilestone(args.project_id, {
      name: args.name,
      description: args.description,
      dueDate: args.due_date,
      order: args.order,
    });

    if (!ms) return { success: false, error: '项目不存在' };

    return {
      success: true,
      message: `里程碑已添加: ${ms.name}`,
      milestone: { id: ms.id, name: ms.name, dueDate: ms.dueDate },
    };
  },
};

const updateMilestoneTool = {
  name: 'pm_update_milestone',
  description: `更新里程碑信息，包括名称、状态、截止日期等。

可更新字段：
- name: 里程碑名称
- status: 状态（pending/in_progress/completed）
- dueDate: 截止日期（YYYY-MM-DD）

示例：pm_update_milestone(project_id="proj-xxx", milestone_id="ms-xxx", status="completed")`,
  category: 'pm',
  parameters: {
    project_id: { type: 'string', description: '项目 ID', required: true },
    milestone_id: { type: 'string', description: '里程碑 ID', required: true },
    name: { type: 'string', description: '新名称' },
    status: { 
      type: 'string', 
      description: '新状态（pending/in_progress/completed）',
      enum: ['pending', 'in_progress', 'completed'],
    },
    dueDate: { type: 'string', description: '新截止日期（YYYY-MM-DD）' },
  },
  requiredPermissions: [],

  async execute(args) {
    if (!args.project_id) return { success: false, error: '必须指定项目 ID' };
    if (!args.milestone_id) return { success: false, error: '必须指定里程碑 ID' };

    const project = projectStore.getProject(args.project_id);
    if (!project) return { success: false, error: `项目不存在: ${args.project_id}` };

    const milestone = project.milestones.find((ms) => ms.id === args.milestone_id);
    if (!milestone) return { success: false, error: `里程碑不存在: ${args.milestone_id}` };

    const changes = [];

    if (args.name && args.name !== milestone.name) {
      changes.push(`名称: ${milestone.name} → ${args.name}`);
      milestone.name = args.name;
    }
    if (args.status && args.status !== milestone.status) {
      const validStatuses = ['pending', 'in_progress', 'completed'];
      if (!validStatuses.includes(args.status)) {
        return { success: false, error: `无效的状态: ${args.status}，可选: ${validStatuses.join('/')}` };
      }
      changes.push(`状态: ${milestone.status} → ${args.status}`);
      milestone.status = args.status;
      // 如果完成，设置进度为 100%
      if (args.status === 'completed') {
        milestone.progress = 100;
      }
    }
    if (args.dueDate && args.dueDate !== milestone.dueDate) {
      changes.push(`截止日期: ${milestone.dueDate || '未设置'} → ${args.dueDate}`);
      milestone.dueDate = args.dueDate;
    }

    if (changes.length === 0) {
      return { success: false, error: '没有需要更新的字段' };
    }

    projectStore.updateProject(args.project_id, { milestones: project.milestones });
    projectStore.recalculateProgress(args.project_id);

    return {
      success: true,
      message: `里程碑「${milestone.name}」已更新`,
      changes,
      milestone: {
        id: milestone.id,
        name: milestone.name,
        status: milestone.status,
        progress: milestone.progress,
        dueDate: milestone.dueDate,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 任务管理（WBS 分解）
// ─────────────────────────────────────────────────────────────

const addTasksTool = {
  name: 'pm_add_tasks',
  description: `批量为项目添加任务（WBS 分解）。每个任务必须属于一个里程碑。

参数 tasks 是一个 JSON 数组，每个元素包含：
- title (必填): 任务标题
- milestone_id (必填): 所属里程碑 ID
- description: 描述
- assignee_id: 执行人 Agent ID
- priority: high/medium/low
- dependencies: 依赖的任务 ID 数组（该任务完成后才能开始）
- due_date: 截止日期（YYYY-MM-DD）
- estimate_hours: 预估工时

示例：pm_add_tasks(project_id="proj-xxx", tasks=[
  {"title": "实现 TodoList 组件", "milestone_id": "ms-xxx", "assignee_id": "agent-xxx", "priority": "high"},
  {"title": "实现 TodoItem 组件", "milestone_id": "ms-xxx", "assignee_id": "agent-xxx"}
])`,
  category: 'pm',
  parameters: {
    project_id: { type: 'string', description: '项目 ID', required: true },
    tasks: { type: 'array', description: '任务列表 (JSON 数组)', required: true },
  },
  requiredPermissions: [],

  async execute(args) {
    const project = projectStore.getProject(args.project_id);
    if (!project) return { success: false, error: '项目不存在' };

    const tasksData = typeof args.tasks === 'string' ? JSON.parse(args.tasks) : args.tasks;
    const created = [];

    for (const t of tasksData) {
      const resolvedAssignee = t.assignee_id ? agentConfigStore.resolve(t.assignee_id) : null;

      const task = projectStore.addTask(args.project_id, {
        title: t.title,
        description: t.description,
        milestoneId: t.milestone_id,
        assigneeId: resolvedAssignee?.agentId || null,
        assigneeName: resolvedAssignee?.config?.name || '',
        priority: t.priority || 'medium',
        dependencies: t.dependencies || [],
        dueDate: t.due_date || null,
        estimateHours: t.estimate_hours || null,
      });

      if (task) created.push(task);
    }

    return {
      success: true,
      message: `已添加 ${created.length} 个任务到项目`,
      tasks: created.map((t) => ({
        id: t.id,
        title: t.title,
        milestone: t.milestoneId,
        assignee: t.assigneeName || '未分配',
        priority: t.priority,
      })),
      tip: '使用 pm_start_project 激活项目开始执行，系统将自动跟踪进度',
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 项目启动 & 任务分发
// ─────────────────────────────────────────────────────────────

const startProjectTool = {
  name: 'pm_start_project',
  description: `激活项目并自动分发已分配的任务。
项目状态从 planning → active，系统开始自动跟踪进度和触发站会。
已分配执行人的任务会自动通过 delegate_task 委派给执行人。`,
  category: 'pm',
  parameters: {
    project_id: { type: 'string', description: '项目 ID', required: true },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const project = projectStore.getProject(args.project_id);
    if (!project) return { success: false, error: '项目不存在' };
    if (project.status === 'active') return { success: false, error: '项目已经在执行中' };

    // 激活项目
    projectStore.updateProject(args.project_id, {
      status: 'active',
      nextStandupAt: Date.now() + (project.standupIntervalMs || 30 * 60 * 1000),
    });

    // 自动委派已分配的任务
    const { agentCommunication } = require('../collaboration/agent-communication');
    let delegatedCount = 0;

    // 按里程碑顺序，只委派第一个里程碑的无依赖任务
    const sortedMilestones = [...project.milestones].sort((a, b) => a.order - b.order);
    const firstMs = sortedMilestones[0];

    if (firstMs) {
      const firstMsTasks = project.tasks.filter(
        (t) => t.milestoneId === firstMs.id && t.assigneeId && t.status === 'todo'
      );

      for (const task of firstMsTasks) {
        // 检查依赖
        if (!projectStore.areDependenciesMet(args.project_id, task.id)) continue;

        // 跳过自我委派（项目负责人分配给自己的任务不走委派流程）
        if (task.assigneeId === project.ownerId) {
          projectStore.updateTask(args.project_id, task.id, { status: 'in_progress' });
          logger.info(`PM: 跳过自我委派 ${task.title}（负责人自行执行）`);
          continue;
        }

        try {
          const result = await agentCommunication.delegateTask({
            fromAgent: project.ownerId,
            toAgent: task.assigneeId,
            taskDescription: `【项目: ${project.name}】\n任务: ${task.title}\n${task.description || ''}\n\n请执行此任务并汇报结果。`,
            priority: task.priority === 'high' ? 1 : task.priority === 'low' ? 5 : 3,
            waitForResult: false,
          });

          if (result?.success !== false && result?.taskId) {
            // 关联委派任务 ID
            projectStore.updateTask(args.project_id, task.id, {
              status: 'in_progress',
              delegatedTaskId: result.taskId,
            });
            delegatedCount++;
          }
        } catch (error) {
          logger.warn(`PM: 任务委派失败 ${task.title}`, error.message);
        }
      }
    }

    projectStore.recalculateProgress(args.project_id);

    return {
      success: true,
      message: `项目「${project.name}」已激活！`,
      details: {
        status: 'active',
        totalTasks: project.tasks.length,
        delegatedTasks: delegatedCount,
        milestones: project.milestones.length,
      },
      tip: delegatedCount > 0
        ? `已自动委派 ${delegatedCount} 个任务给执行人，系统将每 ${Math.round((project.standupIntervalMs || 30 * 60 * 1000) / 60000)} 分钟检查进度`
        : '没有已分配的任务可以委派，请先用 pm_assign_task 分配执行人',
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 任务分配
// ─────────────────────────────────────────────────────────────

const assignTaskTool = {
  name: 'pm_assign_task',
  description: `为项目任务分配执行人。如果项目已激活，分配后会自动委派任务。`,
  category: 'pm',
  parameters: {
    project_id: { type: 'string', description: '项目 ID', required: true },
    task_id: { type: 'string', description: '项目任务 ID', required: true },
    assignee_id: { type: 'string', description: '执行人 Agent ID', required: true },
    auto_delegate: {
      type: 'boolean',
      description: '是否立即委派任务（默认 true）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const project = projectStore.getProject(args.project_id);
    if (!project) return { success: false, error: '项目不存在' };

    const task = project.tasks.find((t) => t.id === args.task_id);
    if (!task) return { success: false, error: '任务不存在' };

    const resolvedAssignee = agentConfigStore.resolve(args.assignee_id);
    if (!resolvedAssignee) return { success: false, error: `找不到执行人: ${args.assignee_id}（请使用 Agent ID 或显示名）` };
    const assigneeId = resolvedAssignee.agentId;
    const assigneeConfig = resolvedAssignee.config;

    // 更新分配
    projectStore.updateTask(args.project_id, args.task_id, {
      assigneeId,
      assigneeName: assigneeConfig.name,
    });

    let delegated = false;

    // 如果项目已激活且依赖满足，自动委派（跳过自我委派）
    if (project.status === 'active' && (args.auto_delegate !== false) && assigneeId !== project.ownerId) {
      if (projectStore.areDependenciesMet(args.project_id, args.task_id)) {
        try {
          const { agentCommunication } = require('../collaboration/agent-communication');
          const result = await agentCommunication.delegateTask({
            fromAgent: project.ownerId,
            toAgent: assigneeId,
            taskDescription: `【项目: ${project.name}】\n任务: ${task.title}\n${task.description || ''}\n\n请执行此任务并汇报结果。`,
            priority: task.priority === 'high' ? 1 : task.priority === 'low' ? 5 : 3,
            waitForResult: false,
          });

          if (result?.success !== false && result?.taskId) {
            projectStore.updateTask(args.project_id, args.task_id, {
              status: 'in_progress',
              delegatedTaskId: result.taskId,
            });
            delegated = true;
          }
        } catch (error) {
          logger.warn(`PM: 分配后委派失败 ${task.title}`, error.message);
        }
      }
    }

    return {
      success: true,
      message: `任务「${task.title}」已分配给 ${assigneeConfig.name}${delegated ? '，并已自动委派执行' : ''}`,
      task: {
        id: task.id,
        title: task.title,
        assignee: assigneeConfig.name,
        delegated,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 查询工具
// ─────────────────────────────────────────────────────────────

const listProjectsTool = {
  name: 'pm_list_projects',
  description: '查看所有项目列表及进度。',
  category: 'pm',
  parameters: {
    status: { type: 'string', description: '按状态筛选: planning, active, completed', required: false },
  },
  requiredPermissions: [],

  async execute(args) {
    const filter = {};
    if (args.status) filter.status = args.status;

    const projects = projectStore.getProjects(filter);

    return {
      success: true,
      totalCount: projects.length,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        owner: p.ownerName,
        progress: `${p.progress}%`,
        milestones: p.milestones.length,
        tasks: {
          total: p.tasks.length,
          done: p.tasks.filter((t) => t.status === 'done').length,
          inProgress: p.tasks.filter((t) => t.status === 'in_progress').length,
          blocked: p.tasks.filter((t) => t.status === 'blocked').length,
        },
        updatedAt: formatLocalTime(p.updatedAt),
      })),
    };
  },
};

const projectDetailTool = {
  name: 'pm_project_detail',
  description: '查看项目详情，包括里程碑和任务状态。',
  category: 'pm',
  parameters: {
    project_id: { type: 'string', description: '项目 ID', required: true },
  },
  requiredPermissions: [],

  async execute(args) {
    const project = projectStore.getProject(args.project_id);
    if (!project) return { success: false, error: '项目不存在' };

    return {
      success: true,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        owner: project.ownerName,
        progress: `${project.progress}%`,
        milestones: project.milestones.map((ms) => ({
          id: ms.id,
          name: ms.name,
          status: ms.status,
          progress: `${ms.progress}%`,
          dueDate: ms.dueDate,
          tasks: project.tasks
            .filter((t) => t.milestoneId === ms.id)
            .map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              assignee: t.assigneeName || '未分配',
              priority: t.priority,
              dueDate: t.dueDate,
            })),
        })),
        unassignedTasks: project.tasks.filter((t) => !t.assigneeId).length,
        blockedTasks: project.tasks.filter((t) => t.status === 'blocked').length,
      },
    };
  },
};

const updateTaskStatusTool = {
  name: 'pm_update_task',
  description: `更新项目任务状态。用于手动标记任务完成、阻塞等。

状态说明：
- todo: 待办
- in_progress: 进行中
- review: 待审阅
- done: 已完成
- blocked: 阻塞（需提供原因）`,
  category: 'pm',
  parameters: {
    project_id: { type: 'string', description: '项目 ID', required: true },
    task_id: { type: 'string', description: '任务 ID', required: true },
    status: { type: 'string', description: '新状态: todo, in_progress, review, done, blocked', required: true },
    blocker_note: { type: 'string', description: '阻塞原因（status=blocked 时必填）', required: false },
    note: { type: 'string', description: '进度备注', required: false },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const project = projectStore.getProject(args.project_id);
    if (!project) return { success: false, error: '项目不存在' };

    const updates = { status: args.status };
    if (args.blocker_note) updates.blockerNote = args.blocker_note;

    const task = projectStore.updateTask(args.project_id, args.task_id, updates);
    if (!task) return { success: false, error: '任务不存在' };

    if (args.note) {
      const config = agentConfigStore.get(context?.agentId) || {};
      projectStore.addProgressNote(args.project_id, args.task_id, {
        content: args.note,
        updatedBy: context?.agentId || 'unknown',
        updatedByName: config.name || '未知',
      });
    }

    // 重新计算进度
    projectStore.recalculateProgress(args.project_id);

    return {
      success: true,
      message: `任务「${task.title}」状态已更新为 ${args.status}`,
      projectProgress: `${project.progress}%`,
    };
  },
};

const statusReportTool = {
  name: 'pm_status_report',
  description: '生成项目状态报告摘要，包含整体进度、里程碑状态、风险项等。',
  category: 'pm',
  parameters: {
    project_id: { type: 'string', description: '项目 ID', required: true },
  },
  requiredPermissions: [],

  async execute(args) {
    const project = projectStore.getProject(args.project_id);
    if (!project) return { success: false, error: '项目不存在' };

    const overdue = projectStore.getOverdueTasks(args.project_id);
    const blocked = projectStore.getBlockedTasks(args.project_id);
    const now = new Date().toISOString().split('T')[0];
    const overdueMilestones = project.milestones.filter(
      (ms) => ms.dueDate && ms.dueDate < now && ms.status !== 'completed'
    );

    return {
      success: true,
      report: {
        project: project.name,
        status: project.status,
        overallProgress: `${project.progress}%`,
        milestones: project.milestones.map((ms) => ({
          name: ms.name,
          status: ms.status,
          progress: `${ms.progress}%`,
          dueDate: ms.dueDate,
          isOverdue: ms.dueDate && ms.dueDate < now && ms.status !== 'completed',
        })),
        tasksSummary: {
          total: project.tasks.length,
          done: project.tasks.filter((t) => t.status === 'done').length,
          inProgress: project.tasks.filter((t) => t.status === 'in_progress').length,
          review: project.tasks.filter((t) => t.status === 'review').length,
          todo: project.tasks.filter((t) => t.status === 'todo').length,
          blocked: blocked.length,
          overdue: overdue.length,
        },
        risks: {
          overdueTasks: overdue.map((t) => ({ title: t.title, assignee: t.assigneeName, dueDate: t.dueDate })),
          blockedTasks: blocked.map((t) => ({ title: t.title, reason: t.blockerNote })),
          overdueMilestones: overdueMilestones.map((ms) => ({ name: ms.name, dueDate: ms.dueDate })),
        },
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 项目更新
// ─────────────────────────────────────────────────────────────

const updateProjectTool = {
  name: 'pm_update_project',
  description: `更新项目信息，包括名称、描述、状态等。

可更新字段：
- name: 项目名称
- description: 项目描述
- status: 项目状态（planning/active/paused/completed/cancelled/archived）
- priority: 优先级（low/normal/high/critical）

示例：pm_update_project(project_id="proj-xxx", status="cancelled")
示例：pm_update_project(project_id="proj-xxx", name="新名称", priority="high")`,
  category: 'pm',
  parameters: {
    project_id: { type: 'string', description: '项目 ID', required: true },
    name: { type: 'string', description: '新项目名称' },
    description: { type: 'string', description: '新项目描述' },
    status: { 
      type: 'string', 
      description: '新状态（planning/active/paused/completed/cancelled/archived）',
      enum: ['planning', 'active', 'paused', 'completed', 'cancelled', 'archived'],
    },
    priority: { 
      type: 'string', 
      description: '新优先级（low/normal/high/critical）',
      enum: ['low', 'normal', 'high', 'critical'],
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    if (!args.project_id) return { success: false, error: '必须指定项目 ID' };

    const project = projectStore.getProject(args.project_id);
    if (!project) return { success: false, error: `项目不存在: ${args.project_id}` };

    const updates = {};
    const changes = [];

    if (args.name && args.name !== project.name) {
      updates.name = args.name;
      changes.push(`名称: ${project.name} → ${args.name}`);
    }
    if (args.description !== undefined && args.description !== project.description) {
      updates.description = args.description;
      changes.push('描述已更新');
    }
    if (args.status && args.status !== project.status) {
      const validStatuses = ['planning', 'active', 'paused', 'completed', 'cancelled', 'archived'];
      if (!validStatuses.includes(args.status)) {
        return { success: false, error: `无效的状态值: ${args.status}，可选: ${validStatuses.join('/')}` };
      }
      updates.status = args.status;
      changes.push(`状态: ${project.status} → ${args.status}`);
    }
    if (args.priority && args.priority !== project.priority) {
      const validPriorities = ['low', 'normal', 'high', 'critical'];
      if (!validPriorities.includes(args.priority)) {
        return { success: false, error: `无效的优先级: ${args.priority}，可选: ${validPriorities.join('/')}` };
      }
      updates.priority = args.priority;
      changes.push(`优先级: ${project.priority || 'normal'} → ${args.priority}`);
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: '没有需要更新的字段' };
    }

    const updated = projectStore.updateProject(args.project_id, updates);
    if (!updated) {
      return { success: false, error: '更新失败' };
    }

    logger.info('PM 工具: 项目已更新', {
      projectId: args.project_id,
      changes,
      operator: context?.agentId,
    });

    return {
      success: true,
      message: `项目「${updated.name}」已更新`,
      changes,
      project: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        priority: updated.priority || 'normal',
        progress: updated.progress,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 项目删除
// ─────────────────────────────────────────────────────────────

const deleteProjectTool = {
  name: 'pm_delete_project',
  description: `删除一个项目。删除后项目数据将被永久移除。

注意事项：
- active 状态且有未完成任务的项目，需先将状态改为 cancelled 或 completed
- 删除不可恢复，请确认后再操作`,
  category: 'pm',
  parameters: {
    project_id: { type: 'string', description: '要删除的项目 ID', required: true },
    confirm: { type: 'boolean', description: '确认删除（必须为 true）', required: true },
  },
  requiredPermissions: [],

  async execute(args, context) {
    if (!args.project_id) return { success: false, error: '必须指定项目 ID' };
    if (!args.confirm) return { success: false, error: '必须设置 confirm=true 确认删除' };

    const project = projectStore.getProject(args.project_id);
    if (!project) return { success: false, error: `项目不存在: ${args.project_id}` };

    // active 项目且有未完成任务时警告
    const unfinishedTasks = project.tasks.filter((t) => t.status !== 'done');
    if (project.status === 'active' && unfinishedTasks.length > 0) {
      return {
        success: false,
        error: `该项目处于 active 状态且有 ${unfinishedTasks.length} 个未完成任务，建议先将项目状态改为 cancelled 再删除，或确认所有任务已妥善处理`,
        hint: '如果确实要强制删除，请先将项目所有任务标记为 done 或将项目状态改为 cancelled',
      };
    }

    const result = projectStore.deleteProject(args.project_id);
    if (!result.success) return result;

    logger.info('PM 工具: 项目已删除', {
      projectId: args.project_id,
      projectName: project.name,
      operator: context?.agentId,
    });

    return {
      success: true,
      message: `项目「${project.name}」已被永久删除`,
      deletedProject: {
        id: project.id,
        name: project.name,
        status: project.status,
        taskCount: project.tasks.length,
        milestoneCount: project.milestones.length,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 注册
// ─────────────────────────────────────────────────────────────

function registerPMTools() {
  toolRegistry.register(createProjectTool);
  toolRegistry.register(addMilestoneTool);
  toolRegistry.register(updateMilestoneTool);
  toolRegistry.register(addTasksTool);
  toolRegistry.register(startProjectTool);
  toolRegistry.register(assignTaskTool);
  toolRegistry.register(listProjectsTool);
  toolRegistry.register(projectDetailTool);
  toolRegistry.register(updateTaskStatusTool);
  toolRegistry.register(statusReportTool);
  toolRegistry.register(updateProjectTool);
  toolRegistry.register(deleteProjectTool);
  logger.info('PM 工具已注册');
}

module.exports = {
  registerPMTools,
  createProjectTool,
  addMilestoneTool,
  updateMilestoneTool,
  addTasksTool,
  startProjectTool,
  assignTaskTool,
  listProjectsTool,
  projectDetailTool,
  updateTaskStatusTool,
  statusReportTool,
  updateProjectTool,
  deleteProjectTool,
};
