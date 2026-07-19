/**
 * SoloForge - Agent 权限持久化存储（Phase 2-A）
 *
 * 每个 Agent 一个 PermissionSet。支持细粒度的工具/类别/文件/Shell/网络/Git 权限。
 *
 * PermissionSet 结构：
 * {
 *   allowedTools: string[],       // 明确允许的工具名
 *   deniedTools: string[],        // 明确禁止的工具名（最高优先级，不可被覆盖）
 *   allowedCategories: string[],  // 允许的 category
 *   deniedCategories: string[],   // 禁止的 category
 *   fileAccess: { allowedPaths: string[], writeEnabled: boolean, writeConfirm: boolean },
 *   shellAccess: { enabled: boolean, blacklist: string[], confirmEach: boolean },
 *   networkAccess: { searchEnabled: boolean },
 *   gitAccess: { enabled: boolean, autoCommit: boolean },
 *   grantedBy: string,
 *   grantedAt: number,
 *   expiresAt: number | null       // null=永久
 * }
 *
 * 接口：
 *   - loadFromDisk() / saveToDisk() — 持久化到 ~/.soloforge/data/<user>/<company>/agent-permissions.json
 *   - getPermissionSet(agentId)
 *   - setPermissionSet(agentId, permSet)
 *   - updatePermissionSet(agentId, changes) — 局部更新（深合并 fileAccess/shellAccess 等子对象）
 *   - addAuditLog(entry) / getAuditLog(agentId?, limit?)
 *   - reinitialize(companyPath) — 公司切换时重新加载
 *
 * 持久化风格与 comm-event-store.js / agent-config-store.js 保持一致：
 *   - 构造时 loadFromDisk()
 *   - saveToDisk() 异步防抖（PERM_SAVE_DEBOUNCE_MS）
 *   - saveToDiskSync() 同步刷盘（应用退出前由 lifecycle flushAll 调用）
 *   - reinitialize() 公司切换时清空内存并从新路径重新加载
 *
 * @module permission/permission-store
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');
const { atomicWrite, atomicWriteSync } = require('../utils/atomic-write');
const { getRoleDefaultPermissions } = require('./role-defaults');

// 防抖保存
let _permSaveTimer = null;
const PERM_SAVE_DEBOUNCE_MS = 1000;

// 内存中最多保留的审计日志条数
const MAX_AUDIT_LOGS_IN_MEMORY = 500;

/**
 * @typedef {Object} FileAccess
 * @property {string[]} allowedPaths - 允许访问的文件/目录路径
 * @property {boolean} writeEnabled - 是否允许写入
 * @property {boolean} writeConfirm - 写入是否需要确认
 */

/**
 * @typedef {Object} ShellAccess
 * @property {boolean} enabled - 是否允许执行 shell
 * @property {string[]} blacklist - 禁止的命令前缀列表
 * @property {boolean} confirmEach - 每条命令是否需要确认
 */

/**
 * @typedef {Object} NetworkAccess
 * @property {boolean} searchEnabled - 是否允许网络搜索
 */

/**
 * @typedef {Object} GitAccess
 * @property {boolean} enabled - 是否允许 git 操作
 * @property {boolean} autoCommit - 是否自动提交
 */

/**
 * @typedef {Object} PermissionSet
 * @property {string[]} allowedTools - 明确允许的工具名列表
 * @property {string[]} deniedTools - 明确禁止的工具名列表
 * @property {string[]} allowedCategories - 允许的 category 列表
 * @property {string[]} deniedCategories - 禁止的 category 列表
 * @property {FileAccess} fileAccess - 文件路径权限
 * @property {ShellAccess} shellAccess - Shell 权限
 * @property {NetworkAccess} networkAccess - 网络权限
 * @property {GitAccess} gitAccess - Git 权限
 * @property {string} grantedBy - 授权者（agentId 或 'user'/'system'）
 * @property {number} grantedAt - 授权时间戳
 * @property {number|null} expiresAt - 过期时间戳（null=永久）
 */

/**
 * @typedef {Object} AuditLogEntry
 * @property {string} id - 日志 ID
 * @property {string} agentId - 被操作的 Agent
 * @property {string} action - 动作类型：grant_tool | revoke_tool | grant_category | revoke_category
 *                             | set_file_access | set_shell_access | set_network_access
 *                             | set_git_access | reset
 * @property {string} [toolName] - 涉及的工具名（grant/revoke tool 时）
 * @property {string} [category] - 涉及的 category（grant/revoke category 时）
 * @property {string} by - 操作者（agentId 或 'user'）
 * @property {number} timestamp - 时间戳
 * @property {string} [reason] - 原因
 * @property {Object} [details] - 其他细节
 */

/**
 * 创建一个空的 PermissionSet（所有字段填默认值）。
 * @param {string} [grantedBy='system']
 * @returns {PermissionSet}
 */
function createEmptyPermissionSet(grantedBy = 'system') {
  return {
    allowedTools: [],
    deniedTools: [],
    allowedCategories: [],
    deniedCategories: [],
    fileAccess: {
      allowedPaths: [],
      writeEnabled: false,
      writeConfirm: true,
    },
    shellAccess: {
      enabled: false,
      blacklist: [],
      confirmEach: true,
    },
    networkAccess: {
      searchEnabled: true,
    },
    gitAccess: {
      enabled: false,
      autoCommit: false,
    },
    grantedBy,
    grantedAt: Date.now(),
    expiresAt: null,
  };
}

/**
 * 创建一个从 roleDefaults 推导出的 PermissionSet。
 * @param {string} role - 角色
 * @param {string} [level] - 职级（用于 staff 角色的 manager+ 判定）
 * @param {string} [grantedBy='system']
 * @returns {PermissionSet}
 */
function createPermissionSetFromRole(role, level, grantedBy = 'system') {
  const { allowedCategories, deniedCategories } = getRoleDefaultPermissions(
    role,
    level
  );
  const permSet = createEmptyPermissionSet(grantedBy);
  permSet.allowedCategories = [...allowedCategories];
  permSet.deniedCategories = [...deniedCategories];
  // roleDefaults 推导出来的不允许单独工具；fileAccess/shellAccess/gitAccess 按角色默认值再细化
  // C-Level 与秘书：开放文件/Shell/Git（shell 与 git 仅 secretary/ceo/cto 默认开放）
  if (role === 'secretary' || role === 'ceo' || role === 'cto') {
    permSet.fileAccess.writeEnabled = true;
    permSet.fileAccess.writeConfirm = role !== 'secretary'; // 秘书写文件不需确认
    permSet.shellAccess.enabled = true;
    permSet.shellAccess.confirmEach = role !== 'secretary';
    permSet.gitAccess.enabled = true;
    permSet.gitAccess.autoCommit = role === 'secretary'; // 仅秘书默认自动提交
  } else {
    // 其他角色文件只读、shell/git 关闭
    permSet.fileAccess.writeEnabled = false;
    permSet.fileAccess.writeConfirm = true;
    permSet.shellAccess.enabled = false;
    permSet.gitAccess.enabled = false;
  }
  // 网络搜索默认全部开放（矩阵中所有角色 network 都是 ✅）
  permSet.networkAccess.searchEnabled = true;
  return permSet;
}

/**
 * 校验并补全 PermissionSet 字段（防止磁盘上旧数据缺字段）。
 * @param {Object} raw - 原始对象
 * @returns {PermissionSet}
 */
function normalizePermissionSet(raw) {
  if (!raw || typeof raw !== 'object') {
    return createEmptyPermissionSet();
  }
  const base = createEmptyPermissionSet(raw.grantedBy || 'system');
  return {
    allowedTools: Array.isArray(raw.allowedTools) ? [...raw.allowedTools] : [],
    deniedTools: Array.isArray(raw.deniedTools) ? [...raw.deniedTools] : [],
    allowedCategories: Array.isArray(raw.allowedCategories)
      ? [...raw.allowedCategories]
      : [],
    deniedCategories: Array.isArray(raw.deniedCategories)
      ? [...raw.deniedCategories]
      : [],
    fileAccess: {
      allowedPaths: Array.isArray(raw.fileAccess?.allowedPaths)
        ? [...raw.fileAccess.allowedPaths]
        : [],
      writeEnabled: Boolean(raw.fileAccess?.writeEnabled),
      writeConfirm:
        raw.fileAccess?.writeConfirm != null
          ? Boolean(raw.fileAccess.writeConfirm)
          : true,
    },
    shellAccess: {
      enabled: Boolean(raw.shellAccess?.enabled),
      blacklist: Array.isArray(raw.shellAccess?.blacklist)
        ? [...raw.shellAccess.blacklist]
        : [],
      confirmEach:
        raw.shellAccess?.confirmEach != null
          ? Boolean(raw.shellAccess.confirmEach)
          : true,
    },
    networkAccess: {
      searchEnabled:
        raw.networkAccess?.searchEnabled != null
          ? Boolean(raw.networkAccess.searchEnabled)
          : true,
    },
    gitAccess: {
      enabled: Boolean(raw.gitAccess?.enabled),
      autoCommit: Boolean(raw.gitAccess?.autoCommit),
    },
    grantedBy: raw.grantedBy || 'system',
    grantedAt: typeof raw.grantedAt === 'number' ? raw.grantedAt : Date.now(),
    expiresAt:
      typeof raw.expiresAt === 'number' || raw.expiresAt === null
        ? raw.expiresAt
        : null,
  };
}

/**
 * 深合并 PermissionSet 的局部更新（对子对象 fileAccess/shellAccess/networkAccess/gitAccess 做字段级合并）。
 * @param {PermissionSet} current - 当前 PermissionSet
 * @param {Object} changes - 局部更新
 * @returns {PermissionSet} 合并后的新对象
 */
function mergePermissionSetChanges(current, changes) {
  if (!current) current = createEmptyPermissionSet();
  const merged = {
    ...current,
    ...changes,
  };
  // 子对象深合并（changes 里的子对象会覆盖 current 中同名字段，但不影响其他字段）
  if (changes.fileAccess || current.fileAccess) {
    merged.fileAccess = {
      ...(current.fileAccess || {}),
      ...(changes.fileAccess || {}),
    };
  }
  if (changes.shellAccess || current.shellAccess) {
    merged.shellAccess = {
      ...(current.shellAccess || {}),
      ...(changes.shellAccess || {}),
    };
  }
  if (changes.networkAccess || current.networkAccess) {
    merged.networkAccess = {
      ...(current.networkAccess || {}),
      ...(changes.networkAccess || {}),
    };
  }
  if (changes.gitAccess || current.gitAccess) {
    merged.gitAccess = {
      ...(current.gitAccess || {}),
      ...(changes.gitAccess || {}),
    };
  }
  return merged;
}

/**
 * Agent 权限持久化存储管理器（单例）
 */
class AgentPermissionStore {
  constructor() {
    /** @type {Map<string, PermissionSet>} */
    this.permissionSets = new Map();
    /** @type {AuditLogEntry[]} */
    this.auditLog = [];
    this._ensureDataDir();
    this.loadFromDisk();
  }

  // ─── 路径辅助 ───────────────────────────────────────────────

  _ensureDataDir() {
    const dir = dataPath.getBasePath();
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        logger.warn('permission-store: 创建数据目录失败:', error.message);
      }
    }
  }

  _getFilePath() {
    // 使用 agent-permissions.json，避免与现有 src/main/config/permission-store.js
    // （用户级权限，permissions.json）冲突。两者职责不同：
    //   - permissions.json       — 用户安全边界（files/shell/network/git），由 config/permission-store 管理
    //   - agent-permissions.json — 每 Agent 的 PermissionSet，由本 store 管理
    return path.join(dataPath.getBasePath(), 'agent-permissions.json');
  }

  // ─── 持久化 ─────────────────────────────────────────────────

  /**
   * 从磁盘加载权限集与审计日志
   */
  loadFromDisk() {
    try {
      const filePath = this._getFilePath();
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // 兼容两种格式：{ permissionSets: {...}, auditLog: [...] } 或裸 { agentId: permSet, ... }
        const permSetsObj = data.permissionSets || data;
        const auditArr = data.auditLog || [];

        this.permissionSets = new Map();
        if (permSetsObj && typeof permSetsObj === 'object') {
          for (const [agentId, raw] of Object.entries(permSetsObj)) {
            this.permissionSets.set(agentId, normalizePermissionSet(raw));
          }
        }
        this.auditLog = Array.isArray(auditArr)
          ? auditArr.slice(-MAX_AUDIT_LOGS_IN_MEMORY)
          : [];
        logger.info('Agent 权限已加载', {
          agentCount: this.permissionSets.size,
          auditCount: this.auditLog.length,
        });
      } else {
        this.permissionSets = new Map();
        this.auditLog = [];
      }
    } catch (error) {
      logger.error('加载 Agent 权限失败:', error);
      this.permissionSets = new Map();
      this.auditLog = [];
    }
  }

  /**
   * 异步防抖保存
   */
  saveToDisk() {
    if (_permSaveTimer) {
      clearTimeout(_permSaveTimer);
    }
    _permSaveTimer = setTimeout(() => {
      _permSaveTimer = null;
      this._doSave();
    }, PERM_SAVE_DEBOUNCE_MS);
  }

  /**
   * 实际执行保存（异步原子写入，不阻塞主进程）
   * @private
   */
  _doSave() {
    try {
      this._ensureDataDir();
      const data = {
        permissionSets: Object.fromEntries(this.permissionSets),
        auditLog: this.auditLog.slice(-MAX_AUDIT_LOGS_IN_MEMORY),
      };
      const content = JSON.stringify(data, null, 2);
      atomicWrite(this._getFilePath(), content).catch((error) => {
        logger.error('保存 Agent 权限失败:', error);
      });
    } catch (error) {
      logger.error('保存 Agent 权限失败:', error);
    }
  }

  /**
   * 同步保存（仅用于应用退出前，由 lifecycle flushAll 调用）
   */
  saveToDiskSync() {
    try {
      this._ensureDataDir();
      const data = {
        permissionSets: Object.fromEntries(this.permissionSets),
        auditLog: this.auditLog.slice(-MAX_AUDIT_LOGS_IN_MEMORY),
      };
      atomicWriteSync(this._getFilePath(), JSON.stringify(data, null, 2));
      logger.info('Agent 权限已同步保存');
    } catch (error) {
      logger.error('同步保存 Agent 权限失败:', error);
    }
  }

  /**
   * 重新初始化（公司切换时调用）。
   * 清空内存状态并从新路径重新加载。
   * @param {string} [companyPath] - 可选的新公司路径（目前 dataPath 已由上层切换）
   */
  reinitialize(companyPath) {
    this.permissionSets = new Map();
    this.auditLog = [];
    this._ensureDataDir();
    this.loadFromDisk();
    if (companyPath) {
      logger.info('Agent 权限 store 已按公司路径重新初始化', { companyPath });
    } else {
      logger.info('Agent 权限 store 已重新初始化');
    }
  }

  // ─── PermissionSet 读写 ──────────────────────────────────────

  /**
   * 获取某 Agent 的权限集。
   * 不存在时返回 null（调用方应自行根据 roleDefaults 初始化）。
   * @param {string} agentId
   * @returns {PermissionSet | null}
   */
  getPermissionSet(agentId) {
    if (!agentId) return null;
    return this.permissionSets.get(agentId) || null;
  }

  /**
   * 设置某 Agent 的权限集（整体替换）。
   * @param {string} agentId
   * @param {PermissionSet} permSet
   * @returns {PermissionSet} 实际保存的（已 normalize 的）权限集
   */
  setPermissionSet(agentId, permSet) {
    if (!agentId) {
      logger.warn('permission-store.setPermissionSet: agentId 为空');
      return null;
    }
    const normalized = normalizePermissionSet(permSet);
    this.permissionSets.set(agentId, normalized);
    this.saveToDisk();
    return normalized;
  }

  /**
   * 局部更新某 Agent 的权限集（深合并子对象）。
   * @param {string} agentId
   * @param {Object} changes - 要更新的字段
   * @returns {PermissionSet | null} 更新后的权限集；agentId 不存在则返回 null
   */
  updatePermissionSet(agentId, changes) {
    if (!agentId) return null;
    const current = this.permissionSets.get(agentId);
    if (!current) {
      logger.warn('permission-store.updatePermissionSet: Agent 不存在', {
        agentId,
      });
      return null;
    }
    const merged = mergePermissionSetChanges(current, changes);
    this.permissionSets.set(agentId, merged);
    this.saveToDisk();
    return merged;
  }

  /**
   * 删除某 Agent 的权限集（用于开除 Agent 时清理）。
   * @param {string} agentId
   * @returns {boolean} 是否删除成功
   */
  deletePermissionSet(agentId) {
    if (!agentId) return false;
    const deleted = this.permissionSets.delete(agentId);
    if (deleted) this.saveToDisk();
    return deleted;
  }

  /**
   * 判断某 Agent 是否已有权限集。
   * @param {string} agentId
   * @returns {boolean}
   */
  hasPermissionSet(agentId) {
    return this.permissionSets.has(agentId);
  }

  /**
   * 获取所有 Agent 权限集的快照（用于 list_all_permissions 工具）。
   * @returns {{ agentId: string, permissionSet: PermissionSet }[]}
   */
  getAllPermissionSets() {
    const result = [];
    for (const [agentId, permissionSet] of this.permissionSets.entries()) {
      result.push({ agentId, permissionSet });
    }
    return result;
  }

  // ─── 审计日志 ───────────────────────────────────────────────

  _generateAuditId() {
    return `pa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 追加一条审计日志。
   * @param {Partial<AuditLogEntry>} entry
   * @returns {AuditLogEntry} 实际写入的日志
   */
  addAuditLog(entry) {
    if (!entry || typeof entry !== 'object') {
      logger.warn('permission-store.addAuditLog: 无效 entry', entry);
      return null;
    }
    const full = {
      id: entry.id || this._generateAuditId(),
      agentId: entry.agentId || '',
      action: entry.action || 'unknown',
      toolName: entry.toolName || undefined,
      category: entry.category || undefined,
      by: entry.by || 'system',
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
      reason: entry.reason || undefined,
      details: entry.details || undefined,
    };
    this.auditLog.push(full);
    if (this.auditLog.length > MAX_AUDIT_LOGS_IN_MEMORY) {
      this.auditLog = this.auditLog.slice(-MAX_AUDIT_LOGS_IN_MEMORY);
    }
    this.saveToDisk();
    return full;
  }

  /**
   * 查询审计日志。
   * @param {string} [agentId] - 可选：过滤特定 Agent
   * @param {number} [limit=20] - 返回条数（默认 20，0=全部）
   * @returns {AuditLogEntry[]}
   */
  getAuditLog(agentId, limit = 20) {
    let matched = this.auditLog;
    if (agentId) {
      matched = matched.filter((e) => e.agentId === agentId);
    }
    // 最新的排在最后（与 comm-event-store 的顺序一致）
    matched = matched.slice().sort((a, b) => a.timestamp - b.timestamp);
    if (limit > 0) {
      matched = matched.slice(-limit);
    }
    return matched;
  }
}

// 单例
const agentPermissionStore = new AgentPermissionStore();

module.exports = {
  agentPermissionStore,
  AgentPermissionStore,
  createEmptyPermissionSet,
  createPermissionSetFromRole,
  normalizePermissionSet,
  mergePermissionSetChanges,
};
