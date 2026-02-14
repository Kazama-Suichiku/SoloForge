/**
 * SoloForge - Agent 状态管理 (Zustand)
 * 管理可用的 Agent 列表、Agent 状态
 * @module store/agent-store
 */

import { create } from 'zustand';

/**
 * @typedef {'idle' | 'working' | 'error'} AgentStatus
 */

/**
 * @typedef {Object} Agent
 * @property {string} id - Agent 唯一标识
 * @property {string} name - Agent 显示名称
 * @property {string} role - Agent 角色标识 (secretary / ceo / cto / cfo / ...)
 * @property {string} avatar - 头像 (emoji 或图片路径)
 * @property {string} description - Agent 描述
 * @property {AgentStatus} status - 当前状态
 * @property {string} [currentTask] - 当前任务描述
 * @property {number} level - 层级（数字越小越高级，0=用户，1=秘书，2=CXO）
 */

/**
 * 预定义的 Agent 列表
 * 层级定义：
 * - 0: 用户（老板）- 不在列表中
 * - 1: 秘书 - 直接汇报给老板
 * - 2: CXO - 汇报给秘书和老板
 * @type {Agent[]}
 */
const DEFAULT_AGENTS = [
  {
    id: 'secretary',
    name: '秘书',
    role: 'secretary',
    avatar: '🤵',
    description: '您的私人秘书，负责接收任务、协调其他成员、汇报进度',
    status: 'idle',
    level: 1, // 最高级员工
  },
  {
    id: 'ceo',
    name: 'CEO',
    role: 'ceo',
    avatar: '👔',
    description: '首席执行官，负责战略决策、业务规划',
    status: 'idle',
    level: 2,
  },
  {
    id: 'cto',
    name: 'CTO',
    role: 'cto',
    avatar: '💻',
    description: '首席技术官，负责技术方案、架构设计、代码实现',
    status: 'idle',
    level: 2,
  },
  {
    id: 'cfo',
    name: 'CFO',
    role: 'cfo',
    avatar: '💰',
    description: '首席财务官，负责 Token 消耗分析、Token 预算管理',
    status: 'idle',
    level: 2,
  },
  {
    id: 'chro',
    name: 'CHRO',
    role: 'chro',
    avatar: '👥',
    description: '首席人力资源官，负责人事管理、组织架构和 Agent 招聘审批',
    status: 'idle',
    level: 2,
  },
];

/**
 * Agent 状态 Store
 */
export const useAgentStore = create((set, get) => ({
  /** @type {Map<string, Agent>} */
  agents: new Map(DEFAULT_AGENTS.map((a) => [a.id, a])),

  /** 可用模型列表（含 multimodal 标志） */
  availableModels: [],

  /** 老板配置 { name, avatar } */
  bossConfig: { name: '老板', avatar: '👑' },

  /** 是否已从后端同步过 */
  initialized: false,

  // ─────────────────────────────────────────────────────────────
  // 初始化：从后端同步 Agent 配置
  // ─────────────────────────────────────────────────────────────

  /**
   * 从后端加载 Agent 配置
   * 将后端的配置与前端的 DEFAULT_AGENTS 合并
   */
  initFromBackend: async () => {
    if (get().initialized) return;

    try {
      const configs = await window.electronAPI?.getAgentConfigs?.();
      if (!configs || !Array.isArray(configs)) return;

      get()._syncAgentConfigs(configs);

      // 加载可用模型列表（含 multimodal 标志）
      try {
        const models = await window.electronAPI?.getAvailableModels?.();
        if (models && Array.isArray(models)) {
          set({ availableModels: models });
        }
      } catch (e) {
        console.warn('加载可用模型列表失败:', e);
      }

      // 加载老板配置
      try {
        const bossConfig = await window.electronAPI?.getBossConfig?.();
        if (bossConfig) {
          set({ bossConfig });
        }
      } catch (e) {
        console.warn('加载老板配置失败:', e);
      }

      set({ initialized: true });

      // 订阅后端配置变更
      window.electronAPI?.onAgentConfigChanged?.((newConfigs) => {
        console.log('Agent 配置变更通知:', newConfigs?.length);
        if (newConfigs && Array.isArray(newConfigs)) {
          get()._syncAgentConfigs(newConfigs);
        }
      });

      // 订阅老板配置变更
      window.electronAPI?.onBossConfigChanged?.((newConfig) => {
        if (newConfig) {
          set({ bossConfig: newConfig });
        }
      });
    } catch (error) {
      console.error('从后端加载 Agent 配置失败:', error);
    }
  },

  /**
   * 同步 Agent 配置（内部方法）
   * @param {Array} configs - 后端配置列表
   */
  _syncAgentConfigs: (configs) => {
    set((state) => {
      const next = new Map(state.agents);

      // 记录后端存在的 Agent ID
      const backendIds = new Set(configs.map((c) => c.id));

      for (const config of configs) {
        const existing = next.get(config.id);
        if (existing) {
          // 更新已有的 Agent 配置
          next.set(config.id, {
            ...existing,
            name: config.name || existing.name,
            avatar: config.avatar || existing.avatar,
            description: config.description || existing.description,
            title: config.title,
            department: config.department,
            level: config.level,
            model: config.model || existing.model, // 模型 ID（用于判断多模态）
            agentStatus: config.status || 'active', // 后端人事状态（active/suspended/terminated）
          });
        } else {
          // 添加新的（动态创建的）Agent
          next.set(config.id, {
            id: config.id,
            name: config.name,
            role: config.role || config.id,
            avatar: config.avatar || '👤',
            description: config.description || '',
            status: 'idle',
            level: 3, // 动态创建的 Agent 默认层级
            title: config.title,
            department: config.department,
            model: config.model, // 模型 ID
            isDynamic: config.isDynamic,
            agentStatus: config.status || 'active',
          });
        }
      }

      // 删除后端不再存在的动态 Agent
      for (const [id, agent] of next.entries()) {
        if (agent.isDynamic && !backendIds.has(id)) {
          next.delete(id);
        }
      }

      return { agents: next };
    });
  },

  // ─────────────────────────────────────────────────────────────
  // 查询
  // ─────────────────────────────────────────────────────────────

  /**
   * 获取所有 Agent 列表
   * @returns {Agent[]}
   */
  getAgentList: () => {
    return Array.from(get().agents.values());
  },

  /**
   * 根据 ID 获取 Agent
   * @param {string} agentId
   * @returns {Agent | null}
   */
  getAgent: (agentId) => {
    return get().agents.get(agentId) ?? null;
  },

  /**
   * 获取秘书 Agent
   * @returns {Agent | null}
   */
  getSecretary: () => {
    return get().agents.get('secretary') ?? null;
  },

  /**
   * 根据角色获取 Agent
   * @param {string} role
   * @returns {Agent | null}
   */
  getAgentByRole: (role) => {
    for (const agent of get().agents.values()) {
      if (agent.role === role) return agent;
    }
    return null;
  },

  // ─────────────────────────────────────────────────────────────
  // 状态更新
  // ─────────────────────────────────────────────────────────────

  /**
   * 更新 Agent 状态
   * @param {string} agentId
   * @param {Partial<Agent>} updates
   */
  updateAgent: (agentId, updates) => {
    set((state) => {
      const next = new Map(state.agents);
      const agent = next.get(agentId);
      if (agent) {
        next.set(agentId, { ...agent, ...updates });
      }
      return { agents: next };
    });
  },

  /**
   * 设置 Agent 为工作中
   * @param {string} agentId
   * @param {string} [taskDescription] - 任务描述
   */
  setAgentWorking: (agentId, taskDescription) => {
    get().updateAgent(agentId, {
      status: 'working',
      currentTask: taskDescription,
    });
  },

  /**
   * 设置 Agent 为空闲
   * @param {string} agentId
   */
  setAgentIdle: (agentId) => {
    get().updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
    });
  },

  /**
   * 设置 Agent 为错误状态
   * @param {string} agentId
   */
  setAgentError: (agentId) => {
    get().updateAgent(agentId, {
      status: 'error',
      currentTask: undefined,
    });
  },

  // ─────────────────────────────────────────────────────────────
  // Agent 管理（动态添加/删除）
  // ─────────────────────────────────────────────────────────────

  /**
   * 添加新 Agent
   * @param {Agent} agent
   */
  addAgent: (agent) => {
    set((state) => {
      const next = new Map(state.agents);
      next.set(agent.id, agent);
      return { agents: next };
    });
  },

  /**
   * 移除 Agent
   * @param {string} agentId
   */
  removeAgent: (agentId) => {
    set((state) => {
      const next = new Map(state.agents);
      next.delete(agentId);
      return { agents: next };
    });
  },

  /**
   * 重置所有 Agent 为默认状态
   */
  resetAgents: () => {
    set({
      agents: new Map(DEFAULT_AGENTS.map((a) => [a.id, a])),
    });
  },

  // ─────────────────────────────────────────────────────────────
  // 多模态能力查询
  // ─────────────────────────────────────────────────────────────

  /**
   * 判断指定 Agent 是否支持图片输入（多模态）
   * @param {string} agentId
   * @returns {boolean}
   */
  isAgentMultimodal: (agentId) => {
    const state = get();
    const agent = state.agents.get(agentId);
    if (!agent?.model) return false;
    const modelDef = state.availableModels.find((m) => m.id === agent.model);
    return modelDef?.multimodal ?? false;
  },
}));

export default useAgentStore;
