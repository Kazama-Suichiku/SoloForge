/**
 * SoloForge Mobile - Agent TODO 工具
 * 让 Agent 能创建、更新、查看和清理待办事项
 * @module core/tools/todo-tools
 */

const { toolRegistry } = require('./tool-registry');
const { todoStore } = require('../todo/todo-store');
const { logger } = require('../../utils/logger');

const todoCreateTool = {
  name: 'todo_create',
  description: '创建一个待办事项。接到复杂任务时，先用此工具将任务拆解为多个 TODO 步骤，然后逐步完成。',
  category: 'todo',
  parameters: {
    title: {
      type: 'string',
      description: '待办事项的简要描述（如："分析项目架构"、"编写单元测试"）',
      required: true,
    },
  },
  async execute(args, context) {
    const { title } = args;
    if (!title || !title.trim()) {
      return { success: false, error: '标题不能为空' };
    }
    const todo = todoStore.create(context.agentId, title.trim());
    logger.info('TODO 创建', { agentId: context.agentId, todo: todo.id, title: todo.title });
    return {
      success: true,
      todo_id: todo.id,
      title: todo.title,
      message: `待办已创建: ${todo.title}`,
    };
  },
};

const todoUpdateTool = {
  name: 'todo_update',
  description: '更新待办事项的状态。开始执行时设为 in_progress，完成时设为 done。',
  category: 'todo',
  parameters: {
    todo_id: {
      type: 'string',
      description: '待办事项的 ID',
      required: true,
    },
    status: {
      type: 'string',
      description: '新状态: pending（待办）、in_progress（进行中）、done（已完成）',
      required: true,
    },
    note: {
      type: 'string',
      description: '可选的进度备注（如："已完成架构分析，发现3个优化点"）',
      required: false,
    },
  },
  async execute(args, context) {
    const { todo_id, status, note } = args;
    const validStatuses = ['pending', 'in_progress', 'done'];
    if (!validStatuses.includes(status)) {
      return { success: false, error: `无效状态: ${status}，可选: ${validStatuses.join(', ')}` };
    }
    const updated = todoStore.update(context.agentId, todo_id, status, note);
    if (!updated) {
      return { success: false, error: `未找到 TODO: ${todo_id}` };
    }
    const statusLabels = { pending: '待办', in_progress: '进行中', done: '已完成' };
    logger.info('TODO 更新', { agentId: context.agentId, todo: todo_id, status });
    return {
      success: true,
      todo_id: updated.id,
      title: updated.title,
      status: updated.status,
      message: `「${updated.title}」已标记为${statusLabels[status]}${note ? `（${note}）` : ''}`,
    };
  },
};

const todoListTool = {
  name: 'todo_list',
  description: '查看你当前的所有待办事项列表。用来回顾任务进度和确认下一步工作。',
  category: 'todo',
  parameters: {},
  async execute(_args, context) {
    const todos = todoStore.getTodos(context.agentId);
    if (todos.length === 0) {
      return { success: true, todos: [], message: '当前没有待办事项。' };
    }
    const statusLabels = { pending: '⬜ 待办', in_progress: '🔄 进行中', done: '✅ 已完成' };
    const formatted = todos.map((t, i) => {
      const label = statusLabels[t.status] || t.status;
      const noteStr = t.note ? ` — ${t.note}` : '';
      return `${i + 1}. ${label} ${t.title}${noteStr} [${t.id}]`;
    });
    const pending = todos.filter((t) => t.status === 'pending').length;
    const inProgress = todos.filter((t) => t.status === 'in_progress').length;
    const done = todos.filter((t) => t.status === 'done').length;
    return {
      success: true,
      todos: todos.map((t) => ({ id: t.id, title: t.title, status: t.status, note: t.note })),
      summary: `共 ${todos.length} 项: ${pending} 待办, ${inProgress} 进行中, ${done} 已完成`,
      formatted: formatted.join('\n'),
    };
  },
};

const todoClearDoneTool = {
  name: 'todo_clear_done',
  description: '清除所有已完成的待办事项。任务全部完成后调用此工具保持列表整洁。',
  category: 'todo',
  parameters: {},
  async execute(_args, context) {
    const cleared = todoStore.clearDone(context.agentId);
    logger.info('TODO 清除已完成', { agentId: context.agentId, cleared });
    return {
      success: true,
      cleared,
      message: cleared > 0 ? `已清除 ${cleared} 项已完成的待办。` : '没有需要清除的已完成待办。',
    };
  },
};

function registerTodoTools() {
  toolRegistry.register(todoCreateTool);
  toolRegistry.register(todoUpdateTool);
  toolRegistry.register(todoListTool);
  toolRegistry.register(todoClearDoneTool);
  logger.info('TODO 工具已注册');
}

module.exports = { registerTodoTools };
