/**
 * SoloForge - Agent TODO 前端 Store
 * 从主进程获取 Agent 的待办事项并实时监听更新
 * @module store/todo-store
 */

import { create } from 'zustand';

/**
 * @typedef {Object} Todo
 * @property {string} id
 * @property {string} title
 * @property {'pending'|'in_progress'|'done'} status
 * @property {string} [note]
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export const useTodoStore = create((set, get) => ({
  /** @type {Object<string, Todo[]>} agentId → todos */
  todosByAgent: {},

  /** 是否已初始化 */
  initialized: false,

  /**
   * 从主进程加载所有 Agent 的 TODO
   */
  loadAll: async () => {
    try {
      const data = await window.electronAPI?.getTodoAll?.();
      if (data) {
        set({ todosByAgent: data, initialized: true });
      }
    } catch (err) {
      console.error('加载 TODO 失败:', err);
    }
  },

  /**
   * 处理来自主进程的 TODO 更新推送
   * @param {string} agentId
   * @param {Todo[]} todos
   */
  handleUpdate: (agentId, todos) => {
    set((state) => ({
      todosByAgent: {
        ...state.todosByAgent,
        [agentId]: todos,
      },
    }));
  },

  /**
   * 获取指定 Agent 的 TODO 列表
   * @param {string} agentId
   * @returns {Todo[]}
   */
  getAgentTodos: (agentId) => {
    return get().todosByAgent[agentId] || [];
  },

  /**
   * 获取指定 Agent 列表的合并 TODO（用于群聊）
   * @param {string[]} agentIds
   * @returns {Array<{agentId: string, todos: Todo[]}>}
   */
  getMultiAgentTodos: (agentIds) => {
    const { todosByAgent } = get();
    return agentIds
      .map((id) => ({
        agentId: id,
        todos: todosByAgent[id] || [],
      }))
      .filter((entry) => entry.todos.length > 0);
  },
}));
