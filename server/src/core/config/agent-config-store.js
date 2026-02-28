/**
 * Agent 配置存储 - 移动端简化版
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');

const DATA_DIR = path.join(__dirname, '../../../data');

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
  ASSISTANT: { id: 'assistant', name: '助理', rank: 5 },
};

/**
 * 部门定义
 */
const DEPARTMENTS = {
  EXECUTIVE: { id: 'executive', name: '高管办公室' },
  TECH: { id: 'tech', name: '技术部' },
  FINANCE: { id: 'finance', name: '财务部' },
  ADMIN: { id: 'admin', name: '行政部' },
  HR: { id: 'hr', name: '人力资源部' },
};

/**
 * Agent 状态
 */
const AGENT_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  TERMINATED: 'terminated',
};

/**
 * 核心 Agent ID（不可删除）
 */
const CORE_AGENT_IDS = ['secretary', 'ceo', 'cto', 'cfo', 'chro'];

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
    department: DEPARTMENTS.ADMIN.id,
    description: '老板的私人秘书，负责日常事务协调',
    avatar: '👩‍💼',
    model: 'deepseek-chat',
    status: AGENT_STATUS.ACTIVE,
  },
  ceo: {
    id: 'ceo',
    name: '张总',
    role: 'ceo',
    title: '首席执行官',
    level: LEVELS.C_LEVEL.id,
    department: DEPARTMENTS.EXECUTIVE.id,
    description: '负责公司战略决策和整体运营',
    avatar: '👨‍💼',
    model: 'deepseek-chat',
    status: AGENT_STATUS.ACTIVE,
  },
  cto: {
    id: 'cto',
    name: '李工',
    role: 'cto',
    title: '首席技术官',
    level: LEVELS.C_LEVEL.id,
    department: DEPARTMENTS.TECH.id,
    description: '负责技术架构和研发团队',
    avatar: '👨‍💻',
    model: 'deepseek-chat',
    status: AGENT_STATUS.ACTIVE,
  },
  cfo: {
    id: 'cfo',
    name: '王财',
    role: 'cfo',
    title: '首席财务官',
    level: LEVELS.C_LEVEL.id,
    department: DEPARTMENTS.FINANCE.id,
    description: '负责财务分析和预算管理',
    avatar: '💰',
    model: 'deepseek-chat',
    status: AGENT_STATUS.ACTIVE,
  },
  chro: {
    id: 'chro',
    name: '孙人',
    role: 'chro',
    title: '首席人力资源官',
    level: LEVELS.C_LEVEL.id,
    department: DEPARTMENTS.HR.id,
    description: '负责人事管理和组织架构',
    avatar: '👥',
    model: 'deepseek-chat',
    status: AGENT_STATUS.ACTIVE,
  },
};

/**
 * Agent 配置存储管理器
 */
class AgentConfigStore {
  constructor() {
    this.configs = new Map();
    this._initialized = false;
  }

  _getConfigPath() {
    return path.join(DATA_DIR, 'agent-configs.json');
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  initialize() {
    if (this._initialized) return;
    this._ensureDataDir();
    this.loadFromDisk();
    this._initialized = true;
  }

  loadFromDisk() {
    try {
      const configPath = this._getConfigPath();
      
      if (fs.existsSync(configPath)) {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        // 合并默认配置
        for (const [id, defaultConfig] of Object.entries(DEFAULT_AGENT_CONFIGS)) {
          const savedConfig = data[id] || {};
          this.configs.set(id, { ...defaultConfig, ...savedConfig });
        }
        // 加载自定义 Agent
        for (const [id, config] of Object.entries(data)) {
          if (!this.configs.has(id)) {
            this.configs.set(id, config);
          }
        }
        logger.info('Agent configs loaded', { count: this.configs.size });
      } else {
        // 使用默认配置
        for (const [id, config] of Object.entries(DEFAULT_AGENT_CONFIGS)) {
          this.configs.set(id, { ...config });
        }
        this.saveToDisk();
        logger.info('Using default agent configs');
      }
    } catch (error) {
      logger.error('Failed to load agent configs', error);
      for (const [id, config] of Object.entries(DEFAULT_AGENT_CONFIGS)) {
        this.configs.set(id, { ...config });
      }
    }
  }

  saveToDisk() {
    try {
      this._ensureDataDir();
      const data = Object.fromEntries(this.configs);
      fs.writeFileSync(this._getConfigPath(), JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save agent configs', error);
    }
  }

  get(agentId) {
    return this.configs.get(agentId) || null;
  }

  getByName(name) {
    if (!name) return null;
    for (const [agentId, config] of this.configs.entries()) {
      if (config.name === name) {
        return { agentId, config };
      }
    }
    return null;
  }

  resolve(idOrName) {
    if (!idOrName) return null;
    const byId = this.configs.get(idOrName);
    if (byId) return { agentId: idOrName, config: byId };
    return this.getByName(idOrName);
  }

  getAll() {
    return Array.from(this.configs.values());
  }

  getActive() {
    return this.getAll().filter((c) => (c.status || 'active') === AGENT_STATUS.ACTIVE);
  }

  update(agentId, updates) {
    const existing = this.configs.get(agentId);
    if (!existing) return null;

    const updated = { ...existing, ...updates, id: agentId };
    this.configs.set(agentId, updated);
    this.saveToDisk();
    return updated;
  }

  add(config) {
    if (!config.id) {
      throw new Error('Agent ID is required');
    }
    this.configs.set(config.id, config);
    this.saveToDisk();
  }

  isCoreAgent(agentId) {
    return CORE_AGENT_IDS.includes(agentId);
  }

  /** 停职 Agent */
  suspend(agentId, reason) {
    const config = this.configs.get(agentId);
    if (!config) return { success: false, error: `找不到 Agent: ${agentId}` };
    if (CORE_AGENT_IDS.includes(agentId)) return { success: false, error: '核心成员不可停职' };
    if ((config.status || 'active') === 'suspended') return { success: false, error: '已是停职状态' };
    this.update(agentId, { status: 'suspended', suspendReason: reason, suspendedAt: new Date().toISOString() });
    return { success: true, agent: this.configs.get(agentId) };
  }

  /** 复职 Agent */
  reinstate(agentId, comment) {
    const config = this.configs.get(agentId);
    if (!config) return { success: false, error: `找不到 Agent: ${agentId}` };
    if ((config.status || 'active') !== 'suspended') return { success: false, error: '未处于停职状态' };
    this.update(agentId, { status: 'active', suspendReason: null, suspendedAt: null });
    return { success: true, agent: this.configs.get(agentId) };
  }

  /** 添加晋升/降级记录 */
  addPromotionRecord(agentId, record) {
    const config = this.configs.get(agentId);
    if (!config) return { success: false, error: `找不到 Agent: ${agentId}` };
    const history = config.promotionHistory || [];
    history.push({ ...record, date: new Date().toISOString() });
    this.update(agentId, { ...record, promotionHistory: history, level: record.toLevel, title: record.toTitle });
    return { success: true };
  }

  getOrganizationInfo() {
    const lines = ['# 公司组织架构\n'];
    
    const byDepartment = new Map();
    for (const config of this.configs.values()) {
      if ((config.status || 'active') === AGENT_STATUS.TERMINATED) continue;
      
      const deptId = config.department || 'unassigned';
      const dept = DEPARTMENTS[deptId?.toUpperCase()] || { id: deptId, name: deptId };
      
      if (!byDepartment.has(deptId)) {
        byDepartment.set(deptId, { dept, members: [] });
      }
      byDepartment.get(deptId).members.push(config);
    }

    for (const { dept, members } of byDepartment.values()) {
      lines.push(`## ${dept.name}`);
      members.sort((a, b) => {
        const levelA = LEVELS[a.level?.toUpperCase()] || { rank: 0 };
        const levelB = LEVELS[b.level?.toUpperCase()] || { rank: 0 };
        return levelB.rank - levelA.rank;
      });
      
      for (const member of members) {
        const level = LEVELS[member.level?.toUpperCase()] || { name: member.level || '' };
        lines.push(`- **${member.name}**（${member.title}）- ${level.name}`);
        if (member.description) {
          lines.push(`  - ${member.description}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

const agentConfigStore = new AgentConfigStore();

/** 获取 Agent 的部门列表（移动端简化：单部门，返回数组兼容接口） */
function getAgentDepartments(config) {
  if (!config) return [];
  if (Array.isArray(config.departments)) return config.departments;
  return config.department ? [config.department] : [];
}

module.exports = {
  AgentConfigStore,
  agentConfigStore,
  LEVELS,
  DEPARTMENTS,
  DEFAULT_AGENT_CONFIGS,
  CORE_AGENT_IDS,
  AGENT_STATUS,
  getAgentDepartments,
};
