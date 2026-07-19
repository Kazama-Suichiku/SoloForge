/**
 * SoloForge - Agent 配置存储
 * 管理 Agent 的名字、职级、部门等可配置信息
 * @module config/agent-config-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');
const { atomicWriteSync, atomicWrite } = require('../utils/atomic-write');

// 防抖保存
let _configSaveTimer = null;
const CONFIG_SAVE_DEBOUNCE_MS = 1000;

/**
 * 职级定义
 */
const LEVELS = {
  C_LEVEL: { id: 'c_level', name: 'C-Level', rank: 100 },
  VP: { id: 'vp', name: '副总裁', rank: 80 },
  DIRECTOR: { id: 'director', name: '总监', rank: 60 },
  MANAGER: { id: 'manager', name: '经理', rank: 40 },
  SENIOR: { id: 'senior', name: '高级专员', rank: 30 },
  STAFF: { id: 'staff', name: '专员', rank: 20 },
  INTERN: { id: 'intern', name: '实习生', rank: 10 },
  ASSISTANT: { id: 'assistant', name: '助理', rank: 5 },
};

/**
 * 部门定义 - 从 department-store 动态加载
 * 保持向后兼容：DEPARTMENTS 仍然可以像对象一样使用
 */
const { DEPARTMENTS, departmentStore } = require('./department-store');

/**
 * 全局默认模型：所有内置 Agent 的默认模型。
 * 以本地 GLM-5.2 为基础，可用环境变量 SOLOFORGE_DEFAULT_MODEL 覆盖。
 */
const DEFAULT_MODEL = process.env.SOLOFORGE_DEFAULT_MODEL || 'zai-org/GLM-5.2-FP8';

/**
 * 可用的 AI 模型列表
 * multimodal: 是否支持图片输入（多模态）
 */
const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'Anthropic', multimodal: true },
  { id: 'claude-opus-4-5-kiro', name: 'Claude Opus 4.5 Kiro', provider: 'Anthropic', multimodal: true },
  { id: 'claude-opus-4-5-max', name: 'Claude Opus 4.5 Max', provider: 'Anthropic', multimodal: true },
  { id: 'claude-opus-4-6-normal', name: 'Claude Opus 4.6', provider: 'Anthropic', multimodal: true },
  { id: 'claude-opus-4-6-kiro', name: 'Claude Opus 4.6 Kiro', provider: 'Anthropic', multimodal: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'Anthropic', multimodal: true },
  { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro', provider: 'Google', multimodal: true },
  { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex', provider: 'OpenAI', multimodal: false },
  { id: 'deepseek-chat', name: 'DeepSeek-V3', provider: 'DeepSeek', multimodal: false },
  { id: 'deepseek-reasoner', name: 'DeepSeek-R1', provider: 'DeepSeek', multimodal: false },
  { id: 'glm-4.7', name: 'GLM 4.7', provider: 'Zhipu', multimodal: false },
  { id: 'glm-5', name: 'GLM 5', provider: 'Zhipu', multimodal: false },
  { id: 'zai-org/GLM-5.2-FP8', name: 'GLM 5.2 (本地)', provider: 'LocalGLM', multimodal: false },
];

/**
 * 判断模型是否支持图片输入（多模态）
 * @param {string} modelId - 模型 ID
 * @returns {boolean}
 */
function isModelMultimodal(modelId) {
  if (!modelId) return false;
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
  // 已知模型查表，未知模型默认不支持（安全起见）
  return model?.multimodal ?? false;
}

/**
 * 核心 Agent ID 列表（不可被开除或停职）
 */
const CORE_AGENT_IDS = ['secretary', 'ceo', 'cto', 'cfo', 'chro'];

/**
 * Agent 状态定义
 */
const AGENT_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  TERMINATED: 'terminated',
};

/**
 * 默认入职引导清单模板
 * @returns {Array<{id: string, title: string, completed: boolean, completedAt: string|null}>}
 */
function createDefaultOnboardingChecklist() {
  return [
    { id: 'ob-1', title: '了解公司组织架构', completed: false, completedAt: null },
    { id: 'ob-2', title: '与直属上级沟通', completed: false, completedAt: null },
    { id: 'ob-3', title: '明确工作职责和目标', completed: false, completedAt: null },
    { id: 'ob-4', title: '完成第一个任务', completed: false, completedAt: null },
    { id: 'ob-5', title: '与团队成员互相介绍', completed: false, completedAt: null },
  ];
}

/**
 * 默认 Agent 配置
 */
const DEFAULT_AGENT_CONFIGS = {
  secretary: {
    id: 'secretary',
    name: '小秘',
    role: 'secretary',
    title: '秘书',
    level: LEVELS.ASSISTANT.id,
    departments: [DEPARTMENTS.ADMIN.id],
    department: DEPARTMENTS.ADMIN.id, // 兼容字段
    description: '老板的私人秘书，负责日常事务协调',
    avatar: '👩‍💼',
    model: DEFAULT_MODEL,
    status: AGENT_STATUS.ACTIVE,
    hireDate: null,
  },
  ceo: {
    id: 'ceo',
    name: '张总',
    role: 'ceo',
    title: '首席执行官',
    level: LEVELS.C_LEVEL.id,
    departments: [DEPARTMENTS.EXECUTIVE.id],
    department: DEPARTMENTS.EXECUTIVE.id, // 兼容字段
    description: '负责公司战略决策和整体运营',
    avatar: '👨‍💼',
    model: DEFAULT_MODEL,
    status: AGENT_STATUS.ACTIVE,
    hireDate: null,
  },
  cto: {
    id: 'cto',
    name: '李工',
    role: 'cto',
    title: '首席技术官',
    level: LEVELS.C_LEVEL.id,
    departments: [DEPARTMENTS.TECH.id],
    department: DEPARTMENTS.TECH.id, // 兼容字段
    description: '负责技术架构和研发团队',
    avatar: '👨‍💻',
    model: DEFAULT_MODEL,
    status: AGENT_STATUS.ACTIVE,
    hireDate: null,
  },
  cfo: {
    id: 'cfo',
    name: '王财',
    role: 'cfo',
    title: '首席财务官',
    level: LEVELS.C_LEVEL.id,
    departments: [DEPARTMENTS.FINANCE.id],
    department: DEPARTMENTS.FINANCE.id, // 兼容字段
    description: '负责 Token 消耗分析和 Token 预算管理',
    avatar: '💰',
    model: DEFAULT_MODEL,
    status: AGENT_STATUS.ACTIVE,
    hireDate: null,
  },
  chro: {
    id: 'chro',
    name: '孙人',
    role: 'chro',
    title: '首席人力资源官',
    level: LEVELS.C_LEVEL.id,
    departments: [DEPARTMENTS.HR.id],
    department: DEPARTMENTS.HR.id, // 兼容字段
    description: '负责人事管理、组织架构和 Agent 招聘审批',
    avatar: '👥',
    model: DEFAULT_MODEL,
    status: AGENT_STATUS.ACTIVE,
    hireDate: null,
  },
};

/**
 * @typedef {Object} AgentConfig
 * @property {string} id - Agent ID
 * @property {string} name - 显示名称（可自定义）
 * @property {string} title - 职位头衔
 * @property {string} level - 职级 ID
 * @property {string[]} departments - 所属部门 ID 列表（支持多部门）
 * @property {string} [department] - 【兼容字段，已废弃】主部门 ID，请使用 departments
 * @property {string} [description] - 职责描述
 * @property {string} [avatar] - 头像（emoji 或 URL）
 * @property {'active'|'suspended'|'terminated'} [status] - Agent 状态
 * @property {string} [hireDate] - 入职日期 (ISO string)
 * @property {string} [probationEnd] - 试用期截止日期 (ISO string, null=无试用期或已转正)
 * @property {string} [terminatedAt] - 开除日期 (ISO string)
 * @property {string} [terminationReason] - 开除原因
 * @property {string} [suspendedAt] - 停职日期 (ISO string)
 * @property {string} [suspendReason] - 停职原因
 * @property {Array<{date: string, fromLevel: string, toLevel: string, fromTitle: string, toTitle: string, reason: string}>} [promotionHistory] - 晋升/降级记录
 * @property {Array<{id: string, title: string, completed: boolean, completedAt: string|null}>} [onboardingChecklist] - 入职引导清单
 */

/**
 * 标准化部门字段：将旧的 department 字符串转换为 departments 数组
 * @param {Object} config - Agent 配置对象
 * @returns {Object} 标准化后的配置
 */
function normalizeDepartments(config) {
  if (!config) return config;
  
  // 如果已有 departments 数组，确保它是有效的数组
  if (Array.isArray(config.departments) && config.departments.length > 0) {
    // 同时设置 department 为主部门（第一个），保持兼容
    config.department = config.departments[0];
    return config;
  }
  
  // 如果只有旧的 department 字符串，转换为数组
  if (config.department && typeof config.department === 'string') {
    config.departments = [config.department];
    return config;
  }
  
  // 如果都没有，设置为空数组
  config.departments = [];
  return config;
}

/**
 * 获取 Agent 的部门列表（兼容新旧格式）
 * @param {Object} config - Agent 配置对象
 * @returns {string[]} 部门 ID 列表
 */
function getAgentDepartments(config) {
  if (!config) return [];
  if (Array.isArray(config.departments) && config.departments.length > 0) {
    return config.departments;
  }
  if (config.department && typeof config.department === 'string') {
    return [config.department];
  }
  return [];
}

/**
 * 获取 Agent 的主部门（第一个部门）
 * @param {Object} config - Agent 配置对象
 * @returns {string|null} 主部门 ID
 */
function getPrimaryDepartment(config) {
  const depts = getAgentDepartments(config);
  return depts[0] || null;
}

/**
 * Agent 配置存储管理器
 */
class AgentConfigStore {
  constructor() {
    /** @type {Map<string, AgentConfig>} */
    this.configs = new Map();
    this.subscribers = [];
    this.loadFromDisk();
  }

  _getConfigDir() {
    return dataPath.getBasePath();
  }

  _getConfigPath() {
    return path.join(dataPath.getBasePath(), 'agent-configs.json');
  }

  /**
   * 从磁盘加载配置
   */
  loadFromDisk() {
    try {
      let needsSave = false;

      if (fs.existsSync(this._getConfigPath())) {
        const data = JSON.parse(fs.readFileSync(this._getConfigPath(), 'utf-8'));
        // 合并默认配置和已保存配置
        for (const [id, defaultConfig] of Object.entries(DEFAULT_AGENT_CONFIGS)) {
          const savedConfig = data[id] || {};
          const merged = { ...defaultConfig, ...savedConfig };
          // 标准化部门字段（兼容旧数据）
          normalizeDepartments(merged);
          this.configs.set(id, merged);
          // 如果是新增的默认 Agent，标记需要保存
          if (!data[id]) {
            needsSave = true;
            logger.info(`新增默认 Agent 配置: ${id}`);
          }
          // 如果旧数据没有 departments 字段，标记需要保存
          if (!savedConfig.departments && savedConfig.department) {
            needsSave = true;
          }
        }
        // 加载动态创建的 Agent 配置
        for (const [id, config] of Object.entries(data)) {
          if (!this.configs.has(id)) {
            // 标准化部门字段（兼容旧数据）
            normalizeDepartments(config);
            this.configs.set(id, config);
            // 如果旧数据没有 departments 字段，标记需要保存
            if (!config.departments && config.department) {
              needsSave = true;
            }
          }
        }
        logger.info('Agent 配置已加载', { count: this.configs.size });

        // 如果有新增配置或数据迁移，自动保存
        if (needsSave) {
          this.saveToDisk();
          logger.info('Agent 配置已迁移到多部门格式');
        }
      } else {
        // 使用默认配置
        for (const [id, config] of Object.entries(DEFAULT_AGENT_CONFIGS)) {
          this.configs.set(id, { ...config });
        }
        logger.info('使用默认 Agent 配置');
        // 保存初始配置
        this.saveToDisk();
      }
    } catch (error) {
      logger.error('加载 Agent 配置失败', error);
      // 使用默认配置
      for (const [id, config] of Object.entries(DEFAULT_AGENT_CONFIGS)) {
        this.configs.set(id, { ...config });
      }
    }
  }

  /**
   * 保存配置到磁盘（异步防抖）
   */
  saveToDisk() {
    if (_configSaveTimer) {
      clearTimeout(_configSaveTimer);
    }
    _configSaveTimer = setTimeout(() => {
      _configSaveTimer = null;
      this._doSave();
    }, CONFIG_SAVE_DEBOUNCE_MS);
  }

  /**
   * 实际执行保存（异步）
   * @private
   */
  _doSave() {
    try {
      const configDir = this._getConfigDir();
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      const data = Object.fromEntries(this.configs);
      // 使用异步原子写入，不阻塞主进程
      atomicWrite(this._getConfigPath(), JSON.stringify(data, null, 2))
        .then(() => {
          logger.info('Agent 配置已保存');
        })
        .catch((error) => {
          logger.error('保存 Agent 配置失败', error);
        });
    } catch (error) {
      logger.error('保存 Agent 配置失败', error);
    }
  }

  /**
   * 立即同步保存（仅用于应用退出前）
   */
  saveToDiskSync() {
    try {
      const configDir = this._getConfigDir();
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      const data = Object.fromEntries(this.configs);
      atomicWriteSync(this._getConfigPath(), JSON.stringify(data, null, 2));
      logger.info('Agent 配置已同步保存');
    } catch (error) {
      logger.error('同步保存 Agent 配置失败', error);
    }
  }

  /**
   * 获取 Agent 配置
   * @param {string} agentId
   * @returns {AgentConfig | null}
   */
  get(agentId) {
    return this.configs.get(agentId) || null;
  }

  /**
   * 通过显示名查找 Agent 配置（返回 { agentId, config } 或 null）
   * @param {string} name - 显示名，如 "李工"
   * @returns {{ agentId: string, config: AgentConfig } | null}
   */
  getByName(name) {
    if (!name) return null;
    for (const [agentId, config] of this.configs.entries()) {
      if (config.name === name) return { agentId, config };
    }
    return null;
  }

  /**
   * 通过 ID 或显示名解析 Agent（优先 ID 匹配）
   * @param {string} idOrName - Agent ID 或显示名
   * @returns {{ agentId: string, config: AgentConfig } | null}
   */
  resolve(idOrName) {
    if (!idOrName) return null;
    // 先按 ID 查找
    const byId = this.configs.get(idOrName);
    if (byId) return { agentId: idOrName, config: byId };
    // 再按显示名查找
    return this.getByName(idOrName);
  }

  /**
   * 获取所有 Agent 配置
   * @returns {AgentConfig[]}
   */
  getAll() {
    return Array.from(this.configs.values());
  }

  /**
   * 更新 Agent 配置
   * @param {string} agentId
   * @param {Partial<AgentConfig>} updates
   * @returns {AgentConfig | null}
   */
  update(agentId, updates) {
    const existing = this.configs.get(agentId);
    if (!existing) {
      logger.warn('Agent 配置不存在', { agentId });
      return null;
    }

    const updated = { ...existing, ...updates, id: agentId }; // ID 不可更改
    this.configs.set(agentId, updated);
    this.saveToDisk();
    this.notifySubscribers();
    return updated;
  }

  /**
   * 获取 Agent 所属的所有部门
   * @param {string} agentId
   * @returns {string[]} 部门 ID 列表
   */
  getDepartments(agentId) {
    const config = this.configs.get(agentId);
    return getAgentDepartments(config);
  }

  /**
   * 给 Agent 添加一个部门
   * @param {string} agentId
   * @param {string} departmentId
   * @returns {{ success: boolean, error?: string }}
   */
  addDepartment(agentId, departmentId) {
    const config = this.configs.get(agentId);
    if (!config) {
      return { success: false, error: `Agent ${agentId} 不存在` };
    }
    
    // 确保 departments 是数组
    if (!Array.isArray(config.departments)) {
      config.departments = config.department ? [config.department] : [];
    }
    
    // 检查是否已在该部门
    if (config.departments.includes(departmentId)) {
      return { success: false, error: `员工已在部门 ${departmentId}` };
    }
    
    config.departments.push(departmentId);
    // 更新兼容字段（主部门保持为第一个）
    config.department = config.departments[0];
    
    this.configs.set(agentId, config);
    this.saveToDisk();
    this.notifySubscribers();
    logger.info('Agent 添加部门', { agentId, departmentId, departments: config.departments });
    return { success: true };
  }

  /**
   * 从 Agent 移除一个部门
   * @param {string} agentId
   * @param {string} departmentId
   * @returns {{ success: boolean, error?: string }}
   */
  removeDepartment(agentId, departmentId) {
    const config = this.configs.get(agentId);
    if (!config) {
      return { success: false, error: `Agent ${agentId} 不存在` };
    }
    
    // 确保 departments 是数组
    if (!Array.isArray(config.departments)) {
      config.departments = config.department ? [config.department] : [];
    }
    
    // 检查是否在该部门
    const index = config.departments.indexOf(departmentId);
    if (index === -1) {
      return { success: false, error: `员工不在部门 ${departmentId}` };
    }
    
    // 至少保留一个部门
    if (config.departments.length <= 1) {
      return { success: false, error: '员工至少需要属于一个部门' };
    }
    
    config.departments.splice(index, 1);
    // 更新兼容字段（主部门保持为第一个）
    config.department = config.departments[0];
    
    this.configs.set(agentId, config);
    this.saveToDisk();
    this.notifySubscribers();
    logger.info('Agent 移除部门', { agentId, departmentId, departments: config.departments });
    return { success: true };
  }

  /**
   * 设置 Agent 的主部门（第一个部门）
   * @param {string} agentId
   * @param {string} departmentId
   * @returns {{ success: boolean, error?: string }}
   */
  setPrimaryDepartment(agentId, departmentId) {
    const config = this.configs.get(agentId);
    if (!config) {
      return { success: false, error: `Agent ${agentId} 不存在` };
    }
    
    // 确保 departments 是数组
    if (!Array.isArray(config.departments)) {
      config.departments = config.department ? [config.department] : [];
    }
    
    // 检查是否在该部门
    const index = config.departments.indexOf(departmentId);
    if (index === -1) {
      return { success: false, error: `员工不在部门 ${departmentId}，请先添加该部门` };
    }
    
    // 将该部门移到第一位
    config.departments.splice(index, 1);
    config.departments.unshift(departmentId);
    // 更新兼容字段
    config.department = departmentId;
    
    this.configs.set(agentId, config);
    this.saveToDisk();
    this.notifySubscribers();
    logger.info('Agent 设置主部门', { agentId, departmentId, departments: config.departments });
    return { success: true };
  }

  /**
   * 添加新 Agent 配置
   * @param {AgentConfig} config
   */
  add(config) {
    if (!config.id) {
      throw new Error('Agent ID 是必需的');
    }
    // 标准化部门字段
    normalizeDepartments(config);
    this.configs.set(config.id, config);
    this.saveToDisk();
    this.notifySubscribers();
  }

  /**
   * 删除 Agent 配置
   * @param {string} agentId
   * @returns {boolean}
   */
  remove(agentId) {
    // 不允许删除默认 Agent
    if (DEFAULT_AGENT_CONFIGS[agentId]) {
      logger.warn('不能删除默认 Agent 配置', { agentId });
      return false;
    }
    const deleted = this.configs.delete(agentId);
    if (deleted) {
      this.saveToDisk();
      this.notifySubscribers();
    }
    return deleted;
  }

  /**
   * 重置 Agent 配置为默认
   * @param {string} agentId
   * @returns {AgentConfig | null}
   */
  reset(agentId) {
    const defaultConfig = DEFAULT_AGENT_CONFIGS[agentId];
    if (!defaultConfig) {
      return null;
    }
    this.configs.set(agentId, { ...defaultConfig });
    this.saveToDisk();
    this.notifySubscribers();
    return this.configs.get(agentId);
  }

  /**
   * 获取所有活跃的 Agent 配置（status=active）
   * @returns {AgentConfig[]}
   */
  getActive() {
    return this.getAll().filter((c) => (c.status || 'active') === AGENT_STATUS.ACTIVE);
  }

  /**
   * 按状态筛选 Agent
   * @param {string} status - 'active' | 'suspended' | 'terminated'
   * @returns {AgentConfig[]}
   */
  getByStatus(status) {
    return this.getAll().filter((c) => (c.status || 'active') === status);
  }

  /**
   * 判断是否为核心 Agent（不可开除/停职）
   * @param {string} agentId
   * @returns {boolean}
   */
  isCoreAgent(agentId) {
    return CORE_AGENT_IDS.includes(agentId);
  }

  /**
   * 停职 Agent
   * @param {string} agentId
   * @param {string} reason - 停职原因
   * @returns {{ success: boolean, error?: string, agent?: AgentConfig }}
   */
  suspend(agentId, reason) {
    if (this.isCoreAgent(agentId)) {
      return { success: false, error: '核心 Agent 不可被停职' };
    }
    const config = this.configs.get(agentId);
    if (!config) {
      return { success: false, error: `Agent ${agentId} 不存在` };
    }
    if ((config.status || 'active') === AGENT_STATUS.TERMINATED) {
      return { success: false, error: `Agent ${agentId} 已被开除，无法停职` };
    }
    if ((config.status || 'active') === AGENT_STATUS.SUSPENDED) {
      return { success: false, error: `Agent ${agentId} 已处于停职状态` };
    }

    config.status = AGENT_STATUS.SUSPENDED;
    config.suspendedAt = new Date().toISOString();
    config.suspendReason = reason;
    this.configs.set(agentId, config);
    this.saveToDisk();
    this.notifySubscribers();
    logger.info('Agent 已停职', { agentId, reason });
    return { success: true, agent: config };
  }

  /**
   * 复职 Agent
   * @param {string} agentId
   * @param {string} [comment] - 复职备注
   * @returns {{ success: boolean, error?: string, agent?: AgentConfig }}
   */
  reinstate(agentId, comment) {
    const config = this.configs.get(agentId);
    if (!config) {
      return { success: false, error: `Agent ${agentId} 不存在` };
    }
    if ((config.status || 'active') !== AGENT_STATUS.SUSPENDED) {
      return { success: false, error: `Agent ${agentId} 不处于停职状态` };
    }

    config.status = AGENT_STATUS.ACTIVE;
    config.suspendedAt = null;
    config.suspendReason = null;
    this.configs.set(agentId, config);
    this.saveToDisk();
    this.notifySubscribers();
    logger.info('Agent 已复职', { agentId, comment });
    return { success: true, agent: config };
  }

  /**
   * 标记 Agent 为已开除
   * @param {string} agentId
   * @param {string} reason - 开除原因
   * @returns {{ success: boolean, error?: string, agent?: AgentConfig, cancelledTasks?: Array }}
   */
  terminate(agentId, reason) {
    if (this.isCoreAgent(agentId)) {
      return { success: false, error: '核心 Agent 不可被开除' };
    }
    const config = this.configs.get(agentId);
    if (!config) {
      return { success: false, error: `Agent ${agentId} 不存在` };
    }
    if ((config.status || 'active') === AGENT_STATUS.TERMINATED) {
      return { success: false, error: `Agent ${agentId} 已被开除` };
    }

    config.status = AGENT_STATUS.TERMINATED;
    config.terminatedAt = new Date().toISOString();
    config.terminationReason = reason;
    this.configs.set(agentId, config);
    this.saveToDisk();
    this.notifySubscribers();

    // 自动清理该员工的未完成任务
    let cancelledTasks = [];
    try {
      const { operationsStore } = require('../operations/operations-store');
      if (operationsStore) {
        const result = operationsStore.cancelTasksByAssignee(
          agentId,
          `负责人 ${config.name} 已离职`,
          config.name
        );
        cancelledTasks = result.cancelledTasks || [];
        if (cancelledTasks.length > 0) {
          logger.info(`员工离职，自动取消 ${cancelledTasks.length} 个任务`, {
            agentId,
            agentName: config.name,
            tasks: cancelledTasks.map((t) => t.title),
          });
        }
      }
    } catch (e) {
      logger.warn('员工离职时清理任务失败', { agentId, error: e.message });
    }

    // 清理该员工的通信队列和委派任务
    try {
      const { agentCommunication } = require('../collaboration/agent-communication');
      if (agentCommunication) {
        agentCommunication.clearAgentQueues(agentId);
      }
    } catch (e) {
      logger.warn('员工离职时清理通信队列失败', { agentId, error: e.message });
    }

    logger.info('Agent 已开除', { agentId, reason, cancelledTaskCount: cancelledTasks.length });
    return { success: true, agent: config, cancelledTasks };
  }

  /**
   * 记录晋升/降级
   * @param {string} agentId
   * @param {Object} record
   * @param {string} record.fromLevel - 原职级
   * @param {string} record.toLevel - 新职级
   * @param {string} record.fromTitle - 原头衔
   * @param {string} record.toTitle - 新头衔
   * @param {string} record.reason - 原因
   * @returns {{ success: boolean, error?: string, agent?: AgentConfig }}
   */
  addPromotionRecord(agentId, record) {
    const config = this.configs.get(agentId);
    if (!config) {
      return { success: false, error: `Agent ${agentId} 不存在` };
    }

    if (!config.promotionHistory) {
      config.promotionHistory = [];
    }
    config.promotionHistory.push({
      date: new Date().toISOString(),
      ...record,
    });

    // 同时更新职级和头衔
    config.level = record.toLevel;
    if (record.toTitle) {
      config.title = record.toTitle;
    }

    this.configs.set(agentId, config);
    this.saveToDisk();
    this.notifySubscribers();
    logger.info('Agent 晋升/降级记录', { agentId, ...record });
    return { success: true, agent: config };
  }

  /**
   * 获取完整的人员信息描述（用于 Agent 的 System Prompt）
   * @returns {string}
   */
  getOrganizationInfo() {
    const lines = ['# 公司组织架构\n'];
    
    // 按部门分组（排除已开除的）- 支持多部门
    const byDepartment = new Map();
    for (const config of this.configs.values()) {
      const status = config.status || 'active';
      if (status === AGENT_STATUS.TERMINATED) continue;

      // 获取该员工所属的所有部门
      const depts = getAgentDepartments(config);
      if (depts.length === 0) {
        // 未分配部门
        const unassigned = { id: 'unassigned', name: '未分配' };
        if (!byDepartment.has('unassigned')) {
          byDepartment.set('unassigned', { dept: unassigned, members: [] });
        }
        byDepartment.get('unassigned').members.push(config);
      } else {
        // 员工出现在每个所属部门中
        for (const deptId of depts) {
          const dept = DEPARTMENTS[deptId?.toUpperCase()] || { id: deptId, name: deptId || '未知部门' };
          if (!byDepartment.has(dept.id || deptId)) {
            byDepartment.set(dept.id || deptId, { dept, members: [] });
          }
          byDepartment.get(dept.id || deptId).members.push(config);
        }
      }
    }

    // 生成组织架构描述
    for (const { dept, members } of byDepartment.values()) {
      lines.push(`## ${dept.name}`);
      // 按职级排序（高到低），去重（同一员工不在同一部门重复显示）
      const uniqueMembers = [...new Map(members.map(m => [m.id, m])).values()];
      uniqueMembers.sort((a, b) => {
        const levelA = LEVELS[a.level?.toUpperCase()] || { rank: 0 };
        const levelB = LEVELS[b.level?.toUpperCase()] || { rank: 0 };
        return levelB.rank - levelA.rank;
      });
      for (const member of uniqueMembers) {
        const level = LEVELS[member.level?.toUpperCase()] || { name: member.level || '' };
        const statusTag = (member.status || 'active') === AGENT_STATUS.SUSPENDED ? '【停职中】' : '';
        // 如果员工属于多个部门，显示其他部门
        const memberDepts = getAgentDepartments(member);
        const otherDepts = memberDepts.filter(d => d !== dept.id);
        const crossDeptTag = otherDepts.length > 0 
          ? `（兼任：${otherDepts.map(d => DEPARTMENTS[d?.toUpperCase()]?.name || d).join('、')}）`
          : '';
        lines.push(`- **${member.name}**（${member.title}）- ${level.name} ${statusTag}${crossDeptTag}`);
        if (member.description) {
          lines.push(`  - ${member.description}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 获取人员识别提示（用于帮助 Agent 识别对话中提到的人）
   * @returns {string}
   */
  getPeopleRecognitionPrompt() {
    const lines = ['# 人员识别\n'];
    lines.push('当对话中提到以下人员时，你可以识别他们的身份：\n');
    
    for (const config of this.configs.values()) {
      const depts = getAgentDepartments(config);
      const deptNames = depts.map(d => DEPARTMENTS[d?.toUpperCase()]?.name || d || '未知部门').join('、');
      const level = LEVELS[config.level?.toUpperCase()] || { name: config.level || '' };
      
      // 可能的称呼方式
      const names = [config.name];
      if (config.title) {
        names.push(config.title);
      }
      // 常见简称
      if (config.name.length > 1) {
        names.push(config.name[0] + '总'); // 如"张总"
        names.push(config.name[0] + '工'); // 如"李工"
      }

      const deptInfo = depts.length > 1 ? `（跨部门：${deptNames}）` : deptNames;
      lines.push(`- 提到「${names.join('」或「')}」时 → 指的是 ${deptInfo} 的 ${config.title}（${config.name}），职级：${level.name}`);
    }

    return lines.join('\n');
  }

  /**
   * 订阅配置变更
   * @param {Function} callback
   * @returns {Function} 取消订阅函数
   */
  subscribe(callback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback);
    };
  }

  /**
   * 通知订阅者
   */
  notifySubscribers() {
    const configs = this.getAll();
    for (const callback of this.subscribers) {
      try {
        callback(configs);
      } catch (error) {
        logger.error('通知订阅者失败', error);
      }
    }
  }

  /**
   * 重新初始化（切换公司后调用）
   * 清空内存状态并从新路径重新加载
   */
  reinitialize() {
    this.configs.clear();
    this.loadFromDisk();
    this._loadBossConfig();
  }

  // ─── Boss（老板）配置管理 ──────────────────────────────────

  _getBossConfigPath() {
    return path.join(dataPath.getBasePath(), 'boss-config.json');
  }

  /**
   * 加载老板配置
   */
  _loadBossConfig() {
    try {
      if (fs.existsSync(this._getBossConfigPath())) {
        this.bossConfig = JSON.parse(fs.readFileSync(this._getBossConfigPath(), 'utf-8'));
      } else {
        this.bossConfig = { name: '老板', avatar: '👑' };
      }
    } catch (error) {
      logger.error('加载老板配置失败', error);
      this.bossConfig = { name: '老板', avatar: '👑' };
    }
  }

  /**
   * 获取老板配置
   * @returns {{ name: string, avatar: string }}
   */
  getBossConfig() {
    if (!this.bossConfig) {
      this._loadBossConfig();
    }
    return { ...this.bossConfig };
  }

  /**
   * 更新老板配置
   * @param {{ name?: string, avatar?: string }} updates
   * @returns {{ name: string, avatar: string }}
   */
  updateBossConfig(updates) {
    if (!this.bossConfig) {
      this._loadBossConfig();
    }
    this.bossConfig = { ...this.bossConfig, ...updates };
    try {
      const configDir = this._getConfigDir();
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      // 使用原子写入
      atomicWriteSync(this._getBossConfigPath(), JSON.stringify(this.bossConfig, null, 2));
      logger.info('老板配置已保存', this.bossConfig);
    } catch (error) {
      logger.error('保存老板配置失败', error);
    }
    return { ...this.bossConfig };
  }
}

// 单例
const agentConfigStore = new AgentConfigStore();

module.exports = {
  AgentConfigStore,
  agentConfigStore,
  LEVELS,
  DEPARTMENTS,
  departmentStore, // 新增：部门管理器实例
  DEFAULT_AGENT_CONFIGS,
  AVAILABLE_MODELS,
  CORE_AGENT_IDS,
  AGENT_STATUS,
  isModelMultimodal,
  createDefaultOnboardingChecklist,
  // 多部门辅助函数
  getAgentDepartments,
  getPrimaryDepartment,
  normalizeDepartments,
};
