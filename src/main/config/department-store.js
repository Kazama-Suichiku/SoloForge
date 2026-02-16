/**
 * SoloForge - 部门管理存储
 * 支持动态创建、修改、删除部门
 * @module config/department-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');
const { atomicWriteSync } = require('../utils/atomic-write');

/**
 * 预设部门定义（系统内置，不可删除但可修改名称和颜色）
 */
const PRESET_DEPARTMENTS = {
  executive: { id: 'executive', name: '高管办公室', color: '#8B5CF6', preset: true },
  tech: { id: 'tech', name: '技术部', color: '#3B82F6', preset: true },
  finance: { id: 'finance', name: '财务部', color: '#10B981', preset: true },
  admin: { id: 'admin', name: '行政部', color: '#F59E0B', preset: true },
  hr: { id: 'hr', name: '人力资源部', color: '#EC4899', preset: true },
  product: { id: 'product', name: '产品部', color: '#6366F1', preset: true },
  marketing: { id: 'marketing', name: '市场部', color: '#EF4444', preset: true },
  sales: { id: 'sales', name: '销售部', color: '#14B8A6', preset: true },
  operations: { id: 'operations', name: '运营部', color: '#F97316', preset: true },
  legal: { id: 'legal', name: '法务部', color: '#64748B', preset: true },
};

/**
 * 默认颜色池（用于新建部门时选择颜色）
 */
const COLOR_POOL = [
  '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EC4899',
  '#6366F1', '#EF4444', '#14B8A6', '#F97316', '#64748B',
  '#84CC16', '#06B6D4', '#A855F7', '#F43F5E', '#78716C',
];

/**
 * @typedef {Object} Department
 * @property {string} id - 部门 ID（英文小写，唯一）
 * @property {string} name - 部门名称（中文显示名）
 * @property {string} color - 部门主题色（hex）
 * @property {boolean} [preset] - 是否为预设部门
 * @property {string} [description] - 部门描述
 * @property {string} [headAgentId] - 部门负责人 Agent ID
 * @property {string} [createdAt] - 创建时间
 * @property {string} [updatedAt] - 更新时间
 */

/**
 * 部门管理器
 */
class DepartmentStore {
  constructor() {
    /** @type {Map<string, Department>} */
    this.departments = new Map();
    this.subscribers = new Set();
    this.loadFromDisk();
  }

  _getConfigPath() {
    return path.join(dataPath.getBasePath(), 'departments.json');
  }

  /**
   * 从磁盘加载部门配置
   */
  loadFromDisk() {
    try {
      // 首先加载预设部门
      for (const [id, dept] of Object.entries(PRESET_DEPARTMENTS)) {
        this.departments.set(id, { ...dept });
      }

      // 然后加载自定义部门和覆盖配置
      const configPath = this._getConfigPath();
      if (fs.existsSync(configPath)) {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        for (const [id, dept] of Object.entries(data)) {
          if (this.departments.has(id)) {
            // 预设部门：只覆盖 name, color, description, headAgentId
            const existing = this.departments.get(id);
            this.departments.set(id, {
              ...existing,
              name: dept.name || existing.name,
              color: dept.color || existing.color,
              description: dept.description,
              headAgentId: dept.headAgentId,
              updatedAt: dept.updatedAt,
            });
          } else {
            // 自定义部门：完整加载
            this.departments.set(id, dept);
          }
        }
        logger.info('部门配置已加载', { count: this.departments.size });
      }
    } catch (error) {
      logger.error('加载部门配置失败', error);
    }
  }

  /**
   * 保存部门配置到磁盘
   */
  saveToDisk() {
    try {
      const configDir = dataPath.getBasePath();
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      const data = Object.fromEntries(this.departments);
      atomicWriteSync(this._getConfigPath(), JSON.stringify(data, null, 2));
      logger.debug('部门配置已保存');
    } catch (error) {
      logger.error('保存部门配置失败', error);
    }
  }

  /**
   * 通知订阅者
   */
  notify() {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(this.getAll());
      } catch (e) {
        logger.error('部门订阅者通知失败', e);
      }
    }
  }

  /**
   * 订阅部门变更
   * @param {Function} callback
   * @returns {Function} 取消订阅函数
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * 重新初始化（切换公司时调用）
   */
  reinitialize() {
    this.departments.clear();
    this.loadFromDisk();
  }

  // ═══════════════════════════════════════════════════════════════
  // CRUD 操作
  // ═══════════════════════════════════════════════════════════════

  /**
   * 获取所有部门
   * @returns {Department[]}
   */
  getAll() {
    return Array.from(this.departments.values());
  }

  /**
   * 获取部门（兼容旧代码的对象格式）
   * @returns {Object<string, Department>}
   */
  getAllAsObject() {
    const result = {};
    for (const [id, dept] of this.departments) {
      result[id.toUpperCase()] = dept;
    }
    return result;
  }

  /**
   * 获取单个部门
   * @param {string} deptId
   * @returns {Department | null}
   */
  get(deptId) {
    return this.departments.get(deptId?.toLowerCase()) || null;
  }

  /**
   * 检查部门是否存在
   * @param {string} deptId
   * @returns {boolean}
   */
  exists(deptId) {
    return this.departments.has(deptId?.toLowerCase());
  }

  /**
   * 创建新部门
   * @param {Object} params
   * @param {string} params.id - 部门 ID（英文小写，3-20字符）
   * @param {string} params.name - 部门名称
   * @param {string} [params.color] - 主题色
   * @param {string} [params.description] - 描述
   * @param {string} [params.headAgentId] - 负责人
   * @returns {{ success: boolean, department?: Department, error?: string }}
   */
  create(params) {
    const { id, name, color, description, headAgentId } = params;

    // 验证 ID
    if (!id || typeof id !== 'string') {
      return { success: false, error: '部门 ID 不能为空' };
    }

    const normalizedId = id.toLowerCase().trim();

    // ID 格式验证
    if (!/^[a-z][a-z0-9_]{1,19}$/.test(normalizedId)) {
      return { 
        success: false, 
        error: '部门 ID 格式无效：必须以字母开头，仅包含小写字母、数字和下划线，长度 2-20 字符' 
      };
    }

    if (this.departments.has(normalizedId)) {
      return { success: false, error: `部门 ID "${normalizedId}" 已存在` };
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return { success: false, error: '部门名称不能为空' };
    }

    // 检查名称是否重复
    const nameExists = Array.from(this.departments.values()).some(
      (d) => d.name === name.trim()
    );
    if (nameExists) {
      return { success: false, error: `部门名称 "${name}" 已存在` };
    }

    // 分配颜色
    const usedColors = new Set(Array.from(this.departments.values()).map((d) => d.color));
    const availableColors = COLOR_POOL.filter((c) => !usedColors.has(c));
    const assignedColor = color || availableColors[0] || COLOR_POOL[Math.floor(Math.random() * COLOR_POOL.length)];

    const now = new Date().toISOString();
    const department = {
      id: normalizedId,
      name: name.trim(),
      color: assignedColor,
      description: description?.trim() || '',
      headAgentId: headAgentId || null,
      preset: false,
      createdAt: now,
      updatedAt: now,
    };

    this.departments.set(normalizedId, department);
    this.saveToDisk();
    this.notify();

    logger.info('创建新部门', { id: normalizedId, name: department.name });

    return { success: true, department };
  }

  /**
   * 更新部门信息
   * @param {string} deptId
   * @param {Object} updates
   * @returns {{ success: boolean, department?: Department, error?: string }}
   */
  update(deptId, updates) {
    const normalizedId = deptId?.toLowerCase();
    const existing = this.departments.get(normalizedId);

    if (!existing) {
      return { success: false, error: `部门 "${deptId}" 不存在` };
    }

    const validUpdates = {};

    // 名称更新
    if (updates.name !== undefined) {
      const newName = updates.name?.trim();
      if (!newName) {
        return { success: false, error: '部门名称不能为空' };
      }
      // 检查名称是否与其他部门重复
      const nameExists = Array.from(this.departments.values()).some(
        (d) => d.id !== normalizedId && d.name === newName
      );
      if (nameExists) {
        return { success: false, error: `部门名称 "${newName}" 已被其他部门使用` };
      }
      validUpdates.name = newName;
    }

    // 颜色更新
    if (updates.color !== undefined) {
      validUpdates.color = updates.color;
    }

    // 描述更新
    if (updates.description !== undefined) {
      validUpdates.description = updates.description?.trim() || '';
    }

    // 负责人更新
    if (updates.headAgentId !== undefined) {
      validUpdates.headAgentId = updates.headAgentId || null;
    }

    if (Object.keys(validUpdates).length === 0) {
      return { success: false, error: '没有提供要更新的字段' };
    }

    const updated = {
      ...existing,
      ...validUpdates,
      updatedAt: new Date().toISOString(),
    };

    this.departments.set(normalizedId, updated);
    this.saveToDisk();
    this.notify();

    logger.info('更新部门', { id: normalizedId, updates: validUpdates });

    return { success: true, department: updated };
  }

  /**
   * 删除部门
   * @param {string} deptId
   * @returns {{ success: boolean, error?: string }}
   */
  delete(deptId) {
    const normalizedId = deptId?.toLowerCase();
    const existing = this.departments.get(normalizedId);

    if (!existing) {
      return { success: false, error: `部门 "${deptId}" 不存在` };
    }

    if (existing.preset) {
      return { success: false, error: `预设部门 "${existing.name}" 不可删除` };
    }

    this.departments.delete(normalizedId);
    this.saveToDisk();
    this.notify();

    logger.info('删除部门', { id: normalizedId, name: existing.name });

    return { success: true };
  }

  /**
   * 获取部门成员数量
   * @param {string} deptId
   * @returns {number}
   */
  getMemberCount(deptId) {
    // 延迟加载避免循环依赖
    const { agentConfigStore } = require('./agent-config-store');
    const agents = agentConfigStore.getAll();
    return agents.filter((a) => 
      a.department?.toLowerCase() === deptId?.toLowerCase() &&
      (a.status || 'active') !== 'terminated'
    ).length;
  }

  /**
   * 获取部门统计信息
   * @returns {Array<{ department: Department, memberCount: number }>}
   */
  getStats() {
    return this.getAll().map((dept) => ({
      department: dept,
      memberCount: this.getMemberCount(dept.id),
    }));
  }
}

// 单例
const departmentStore = new DepartmentStore();

// 兼容旧代码：导出动态 DEPARTMENTS 对象（getter）
// 这样旧代码中的 DEPARTMENTS[xxx] 仍然可用
const DEPARTMENTS = new Proxy({}, {
  get(target, prop) {
    if (typeof prop === 'string') {
      return departmentStore.get(prop.toLowerCase()) || 
             departmentStore.get(prop) ||
             { id: prop.toLowerCase(), name: prop };
    }
    return undefined;
  },
  ownKeys() {
    return departmentStore.getAll().map((d) => d.id.toUpperCase());
  },
  getOwnPropertyDescriptor(target, prop) {
    const dept = departmentStore.get(prop.toLowerCase());
    if (dept) {
      return { enumerable: true, configurable: true, value: dept };
    }
    return undefined;
  },
});

module.exports = {
  DepartmentStore,
  departmentStore,
  DEPARTMENTS,
  PRESET_DEPARTMENTS,
  COLOR_POOL,
};
