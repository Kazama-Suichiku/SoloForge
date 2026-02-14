/**
 * SoloForge - 任务状态管理 (Zustand)
 * 管理任务列表、当前任务、进度与结果
 * @module store/task-store
 */

import { create } from 'zustand';

/**
 * @typedef {'pending' | 'running' | 'completed' | 'error' | 'cancelled'} TaskStatus
 */

/**
 * @typedef {Object} TaskState
 * @property {string} id - 任务唯一标识
 * @property {string} prompt - 用户输入的任务描述
 * @property {TaskStatus} status - 任务状态
 * @property {number} progress - 进度百分比 0-100
 * @property {string} [currentAgent] - 当前执行的 Agent ID
 * @property {string} [message] - 状态描述
 * @property {Object} [result] - 执行结果 (output)
 * @property {string} [error] - 错误信息
 * @property {number} [createdAt] - 创建时间戳
 */

/** @type {() => Map<string, TaskState>} */
const createTasksMap = () => new Map();

/**
 * Agent ID 到显示名称的映射 (Writer → Reviewer 流程)
 */
const AGENT_DISPLAY_NAMES = {
  writer: 'Writer',
  reviewer: 'Reviewer',
};

/**
 * @param {string} agentId
 * @returns {string}
 */
export function getAgentDisplayName(agentId) {
  return AGENT_DISPLAY_NAMES[agentId] ?? agentId;
}

export const useTaskStore = create((set, get) => ({
  /** @type {Map<string, TaskState>} */
  tasks: createTasksMap(),
  /** @type {string | null} */
  currentTask: null,

  /**
   * 添加新任务
   * @param {Object} task
   * @param {string} task.id
   * @param {string} task.prompt
   */
  addTask: ({ id, prompt }) => {
    const taskState = {
      id,
      prompt,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
    };
    set((state) => {
      const next = new Map(state.tasks);
      next.set(id, taskState);
      return { tasks: next, currentTask: id };
    });
  },

  /**
   * 更新任务进度
   * @param {string} taskId
   * @param {{ progress?: number; currentAgent?: string; message?: string }} progress
   */
  updateTaskProgress: (taskId, { progress, currentAgent, message }) => {
    set((state) => {
      const task = state.tasks.get(taskId);
      if (!task) return state;
      const next = new Map(state.tasks);
      next.set(taskId, {
        ...task,
        status: 'running',
        progress: progress ?? task.progress,
        currentAgent: currentAgent ?? task.currentAgent,
        message: message ?? task.message,
      });
      return { tasks: next };
    });
  },

  /**
   * 完成任务（成功或失败）
   * @param {string} taskId
   * @param {{ success: boolean; result?: Object; error?: string }} payload
   */
  completeTask: (taskId, { success, result, error }) => {
    set((state) => {
      const task = state.tasks.get(taskId);
      if (!task) return state;
      const next = new Map(state.tasks);
      next.set(taskId, {
        ...task,
        status: success ? 'completed' : 'error',
        progress: success ? 100 : task.progress,
        result,
        error,
        currentAgent: undefined,
        message: undefined,
      });
      return { tasks: next };
    });
  },

  /**
   * 标记任务为已取消
   * @param {string} taskId
   */
  cancelTask: (taskId) => {
    set((state) => {
      const task = state.tasks.get(taskId);
      if (!task) return state;
      const next = new Map(state.tasks);
      next.set(taskId, {
        ...task,
        status: 'cancelled',
        currentAgent: undefined,
        message: undefined,
      });
      return { tasks: next };
    });
  },

  /**
   * 设置当前选中的任务
   * @param {string | null} taskId
   */
  setCurrentTask: (taskId) => {
    set({ currentTask: taskId });
  },

  /**
   * 获取当前任务
   * @returns {TaskState | undefined}
   */
  getCurrentTask: () => {
    const { tasks, currentTask } = get();
    return currentTask ? tasks.get(currentTask) : undefined;
  },

  /**
   * 获取任务列表（按创建时间倒序）
   * @returns {TaskState[]}
   */
  getTaskList: () => {
    const { tasks } = get();
    return Array.from(tasks.values()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  },
}));
