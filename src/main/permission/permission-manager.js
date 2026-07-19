/**
 * SoloForge - 权限管理器
 *
 * 基于 PermissionStore（持久化）+ RoleDefaults（角色默认权限）实现细粒度工具权限管理。
 *
 * 权限优先级（从高到低）：
 *   1. deniedTools        — 明确禁止的个别工具（最高，不可被覆盖）
 *   2. deniedCategories   — 明确禁止的 category
 *   3. allowedTools       — 明确允许的个别工具
 *   4. allowedCategories  — 明确允许的 category
 *   5. roleDefaults       — 角色默认权限（role + level 推导）
 *   6. secretaryOverride  — 秘书默认开放所有工具
 *
 * 依赖（2-A 产物，接口已约定，文件可能尚未创建）：
 *   - PermissionStore（permission-store.js）:
 *       getPermissionSet(agentId) / setPermissionSet(agentId, set)
 *       updatePermissionSet(agentId, updater)
 *       addAuditLog(entry) / getAuditLog({ agentId?, limit? })
 *   - RoleDefaults（role-defaults.js）:
 *       getRoleDefaultPermissions(role, level) → { allowedCategories, deniedCategories }
 *
 * 其它依赖（已存在）：
 *   - toolRegistry.getAll() / get(name)
 *   - agentConfigStore.get(agentId)
 *
 * @module permission/permission-manager
 */

const { logger } = require('../utils/logger');

// ─────────────────────────────────────────────────────────────
// 依赖加载（懒加载 + 容错）
//
// 2-A 的 permission-store / role-defaults 可能尚未创建，
// 这里使用懒加载：首次调用对应方法时才 require，缺失时返回 null，
// 由调用方降级处理（例如回退到 roleDefaults 缺失即拒绝）。
// 这样保证本模块在 2-A 未完成时仍可被 require 不抛异常。
// ─────────────────────────────────────────────────────────────

let _permissionStore = null;
let _permissionStoreChecked = false;
function getPermissionStore() {
  if (!_permissionStoreChecked) {
    _permissionStoreChecked = true;
    try {
      // 优先从 2-A 约定路径加载
      const mod = require('./permission-store');
      _permissionStore = mod.permissionStore || mod.PermissionStore?.instance || mod.default || mod;
    } catch (e) {
      logger.warn('permission-store 未就绪，权限数据将临时降级到内存:', e.message);
      _permissionStore = null;
    }
  }
  return _permissionStore;
}

let _roleDefaults = null;
let _roleDefaultsChecked = false;
function getRoleDefaults() {
  if (!_roleDefaultsChecked) {
    _roleDefaultsChecked = true;
    try {
      const mod = require('./role-defaults');
      _roleDefaults = mod.getRoleDefaultPermissions
        ? mod
        : (mod.default || mod);
    } catch (e) {
      logger.warn('role-defaults 未就绪，角色默认权限将缺失:', e.message);
      _roleDefaults = null;
    }
  }
  return _roleDefaults;
}

let _toolRegistry = null;
let _toolRegistryChecked = false;
function getToolRegistry() {
  if (!_toolRegistryChecked) {
    _toolRegistryChecked = true;
    try {
      const mod = require('../tools/tool-registry');
      _toolRegistry = mod.toolRegistry || mod.ToolRegistry?.instance || mod.default || mod;
    } catch (e) {
      logger.warn('tool-registry 加载失败:', e.message);
      _toolRegistry = null;
    }
  }
  return _toolRegistry;
}

let _agentConfigStore = null;
let _agentConfigStoreChecked = false;
function getAgentConfigStore() {
  if (!_agentConfigStoreChecked) {
    _agentConfigStoreChecked = true;
    try {
      const mod = require('../config/agent-config-store');
      _agentConfigStore = mod.agentConfigStore || mod.AgentConfigStore?.instance || mod.default || mod;
    } catch (e) {
      logger.warn('agent-config-store 加载失败:', e.message);
      _agentConfigStore = null;
    }
  }
  return _agentConfigStore;
}

// ─────────────────────────────────────────────────────────────
// 降级用的内存 PermissionStore
// ─────────────────────────────────────────────────────────────

/** @type {Map<string, Object>} agentId → PermissionSet */
const _memoryStore = new Map();
/** @type {Array<Object>} audit log entries */
const _memoryAudit = [];

function _memoryGet(agentId) {
  return _memoryStore.get(agentId) || null;
}
function _memorySet(agentId, set) {
  _memoryStore.set(agentId, set);
}
function _memoryUpdate(agentId, updater) {
  const cur = _memoryGet(agentId) || _emptyPermissionSet();
  const next = updater(cur) || cur;
  _memorySet(agentId, next);
  return next;
}
function _memoryAddAudit(entry) {
  _memoryAudit.push(entry);
  // 限制大小，避免无限增长
  if (_memoryAudit.length > 1000) _memoryAudit.shift();
}
function _memoryGetAudit({ agentId, limit }) {
  let entries = _memoryAudit;
  if (agentId) entries = entries.filter((e) => e.agentId === agentId);
  if (limit) entries = entries.slice(-limit);
  return entries;
}

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

/**
 * 空的 PermissionSet 模板
 * @returns {Object}
 */
function _emptyPermissionSet() {
  return {
    allowedTools: [],
    deniedTools: [],
    allowedCategories: [],
    deniedCategories: [],
    fileAccess: { allowedPaths: [], writeEnabled: false, writeConfirm: true },
    shellAccess: { enabled: false, blacklist: [], confirmEach: true },
    networkAccess: { enabled: false },
    gitAccess: { enabled: false, autoCommit: false },
    customRules: [],
    grantedBy: 'system',
    grantedAt: 0,
    expiresAt: null,
  };
}

/**
 * 数组去重
 * @param {Array} arr
 * @returns {Array}
 */
function _uniq(arr) {
  if (!Array.isArray(arr)) return [];
  return Array.from(new Set(arr.filter((x) => x != null && x !== '')));
}

/**
 * 数组相减：返回 a 中存在但 b 中不存在的元素
 * @param {Array} a
 * @param {Array} b
 * @returns {Array}
 */
function _subtract(a, b) {
  const setB = new Set(b || []);
  return (a || []).filter((x) => !setB.has(x));
}

/**
 * 判断 agentId 是否为秘书（secretary）
 * @param {string} agentId
 * @returns {boolean}
 */
function _isSecretary(agentId) {
  if (!agentId) return false;
  if (agentId === 'secretary') return true;
  const store = getAgentConfigStore();
  if (store && typeof store.get === 'function') {
    const cfg = store.get(agentId);
    if (cfg && cfg.role === 'secretary') return true;
  }
  return false;
}

/**
 * 获取 agent 的角色信息
 * @param {string} agentId
 * @returns {{ role: string|null, level: string|null }}
 */
function _getRoleInfo(agentId) {
  const store = getAgentConfigStore();
  if (!store || typeof store.get !== 'function') return { role: null, level: null };
  const cfg = store.get(agentId);
  if (!cfg) return { role: null, level: null };
  return { role: cfg.role || null, level: cfg.level || null };
}

/**
 * 从 toolRegistry 查工具的 category
 * @param {string} toolName
 * @returns {string|null}
 */
function _getToolCategory(toolName) {
  const registry = getToolRegistry();
  if (!registry || typeof registry.get !== 'function') return null;
  const tool = registry.get(toolName);
  return tool?.category || null;
}

/**
 * 检查 PermissionSet 是否已过期
 * @param {Object} set
 * @returns {boolean}
 */
function _isExpired(set) {
  if (!set || set.expiresAt == null) return false;
  return Date.now() >= set.expiresAt;
}

// ─────────────────────────────────────────────────────────────
// PermissionManager
// ─────────────────────────────────────────────────────────────

class PermissionManager {
  // ── Store 抽象（优先 2-A 的 PermissionStore，降级到内存） ──

  /** @private */
  _getStoreEntry(agentId) {
    const store = getPermissionStore();
    if (store && typeof store.getPermissionSet === 'function') {
      const set = store.getPermissionSet(agentId);
      return set || null;
    }
    return _memoryGet(agentId);
  }

  /** @private */
  _setStoreEntry(agentId, set) {
    const store = getPermissionStore();
    if (store && typeof store.setPermissionSet === 'function') {
      store.setPermissionSet(agentId, set);
      return;
    }
    _memorySet(agentId, set);
  }

  /** @private */
  _updateStoreEntry(agentId, updater) {
    const store = getPermissionStore();
    if (store && typeof store.updatePermissionSet === 'function') {
      return store.updatePermissionSet(agentId, updater);
    }
    return _memoryUpdate(agentId, updater);
  }

  /** @private */
  _addAuditEntry(entry) {
    const store = getPermissionStore();
    if (store && typeof store.addAuditLog === 'function') {
      store.addAuditLog(entry);
      return;
    }
    _memoryAddAudit(entry);
  }

  /** @private */
  _getAuditEntries({ agentId, limit } = {}) {
    const store = getPermissionStore();
    if (store && typeof store.getAuditLog === 'function') {
      return store.getAuditLog({ agentId, limit }) || [];
    }
    return _memoryGetAudit({ agentId, limit });
  }

  // ── 公开接口 ──

  /**
   * 检查 Agent 是否拥有使用某工具的权限
   * 权限优先级（从高到低）：
   *   1. secretaryOverride（秘书=全部）
   *   2. deniedTools → false
   *   3. deniedCategories → false
   *   4. allowedTools → true
   *   5. allowedCategories → true
   *   6. roleDefaults（category 允许） → true
   *   7. 否则 false
   *
   * @param {string} agentId
   * @param {string} toolName
   * @returns {boolean}
   */
  hasPermission(agentId, toolName) {
    if (!agentId || !toolName) return false;

    // 1. 秘书 = 全部
    if (_isSecretary(agentId)) return true;

    const set = this._getStoreEntry(agentId);

    // 过期的 PermissionSet 视为不存在（降级到 roleDefaults）
    const effectiveSet = (set && !_isExpired(set)) ? set : null;

    // 2. deniedTools
    if (effectiveSet?.deniedTools?.includes(toolName)) return false;

    // 3. deniedCategories
    const category = _getToolCategory(toolName);
    if (category && effectiveSet?.deniedCategories?.includes(category)) return false;

    // 4. allowedTools
    if (effectiveSet?.allowedTools?.includes(toolName)) return true;

    // 5. allowedCategories
    if (category && effectiveSet?.allowedCategories?.includes(category)) return true;

    // 6. roleDefaults
    if (category) {
      const defaults = this._getRoleDefaultCategories(agentId);
      if (defaults.allowed.includes(category)) return true;
      if (defaults.denied.includes(category)) return false;
    }

    // 7. 默认拒绝
    return false;
  }

  /**
   * 获取 Agent 的有效 PermissionSet（合并 roleDefaults + allowedTools + allowedCategories
   * - deniedTools - deniedCategories）。秘书返回含 '*' 的全集标记。
   *
   * 注意：返回的是计算后的"视图"快照，不直接写回 store。
   *
   * @param {string} agentId
   * @returns {Object}
   */
  getPermissionSet(agentId) {
    if (!agentId) return _emptyPermissionSet();

    if (_isSecretary(agentId)) {
      return {
        ..._emptyPermissionSet(),
        allowedCategories: ['*'],
        fileAccess: { allowedPaths: ['*'], writeEnabled: true, writeConfirm: false },
        shellAccess: { enabled: true, blacklist: [], confirmEach: false },
        networkAccess: { enabled: true },
        gitAccess: { enabled: true, autoCommit: true },
        grantedBy: 'system',
        grantedAt: 0,
        expiresAt: null,
        secretaryOverride: true,
      };
    }

    const stored = this._getStoreEntry(agentId) || _emptyPermissionSet();
    if (_isExpired(stored)) {
      // 过期 → 只保留 roleDefaults
      return this._mergeWithRoleDefaults(agentId, _emptyPermissionSet());
    }
    return this._mergeWithRoleDefaults(agentId, stored);
  }

  /**
   * 获取 Agent 最终可用的工具名列表
   * 从 toolRegistry.getAll() 获取所有工具，按 hasPermission 过滤
   * @param {string} agentId
   * @returns {string[]}
   */
  getAccessibleTools(agentId) {
    const registry = getToolRegistry();
    if (!registry || typeof registry.getAll !== 'function') return [];

    const all = registry.getAll();
    if (!Array.isArray(all)) return [];

    const accessible = [];
    for (const tool of all) {
      if (!tool || !tool.name) continue;
      if (this.hasPermission(agentId, tool.name)) {
        accessible.push(tool.name);
      }
    }
    return accessible;
  }

  /**
   * 授予工具权限（加入 allowedTools）
   * @param {string} agentId
   * @param {string[]} tools
   * @param {string} grantedBy
   * @param {string} [reason]
   * @returns {{ success: boolean, added: string[], skipped: string[], error?: string }}
   */
  grantTools(agentId, tools, grantedBy, reason) {
    if (!agentId) return { success: false, added: [], skipped: [], error: '缺少 agentId' };
    if (!Array.isArray(tools) || tools.length === 0) {
      return { success: false, added: [], skipped: [], error: 'tools 参数为空' };
    }

    const next = this._updateStoreEntry(agentId, (cur) => {
      const base = cur || _emptyPermissionSet();
      // 先从 deniedTools 移除（授权时自动解除禁止）
      const deniedTools = _subtract(base.deniedTools || [], tools);
      // 加入 allowedTools，但跳过已在 deniedCategories 里的（避免矛盾）
      const added = [];
      const skipped = [];
      for (const t of tools) {
        const cat = _getToolCategory(t);
        if (cat && base.deniedCategories?.includes(cat)) {
          skipped.push(t);
          continue;
        }
        added.push(t);
      }
      return {
        ...base,
        deniedTools,
        allowedTools: _uniq([...(base.allowedTools || []), ...added]),
        grantedBy: grantedBy || base.grantedBy || 'system',
        grantedAt: Date.now(),
      };
    });

    const added = _uniq(tools);
    this._addAuditEntry({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: 'grant',
      kind: 'tools',
      agentId,
      by: grantedBy || 'unknown',
      tools: added,
      reason: reason || '',
      timestamp: Date.now(),
    });

    logger.info(`PermissionManager.grantTools: ${agentId} ← [${added.join(', ')}] by ${grantedBy}`);
    return { success: true, added, skipped: [], grantedAt: next?.grantedAt };
  }

  /**
   * 撤销工具权限（加入 deniedTools / 从 allowedTools 移除）
   * @param {string} agentId
   * @param {string[]} tools
   * @param {string} revokedBy
   * @param {string} [reason]
   * @returns {{ success: boolean, revoked: string[], error?: string }}
   */
  revokeTools(agentId, tools, revokedBy, reason) {
    if (!agentId) return { success: false, revoked: [], error: '缺少 agentId' };
    if (!Array.isArray(tools) || tools.length === 0) {
      return { success: false, revoked: [], error: 'tools 参数为空' };
    }

    this._updateStoreEntry(agentId, (cur) => {
      const base = cur || _emptyPermissionSet();
      const allowedTools = _subtract(base.allowedTools || [], tools);
      const deniedTools = _uniq([...(base.deniedTools || []), ...tools]);
      return {
        ...base,
        allowedTools,
        deniedTools,
        grantedBy: base.grantedBy || 'system',
        grantedAt: base.grantedAt || Date.now(),
      };
    });

    const revoked = _uniq(tools);
    this._addAuditEntry({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: 'revoke',
      kind: 'tools',
      agentId,
      by: revokedBy || 'unknown',
      tools: revoked,
      reason: reason || '',
      timestamp: Date.now(),
    });

    logger.info(`PermissionManager.revokeTools: ${agentId} ← revoke [${revoked.join(', ')}] by ${revokedBy}`);
    return { success: true, revoked };
  }

  /**
   * 授予某个 category 的权限（加入 allowedCategories，从 deniedCategories 移除）
   * @param {string} agentId
   * @param {string} category
   * @param {string} grantedBy
   * @param {string} [reason]
   * @returns {{ success: boolean, category: string, error?: string }}
   */
  grantCategory(agentId, category, grantedBy, reason) {
    if (!agentId) return { success: false, category, error: '缺少 agentId' };
    if (!category) return { success: false, category, error: '缺少 category' };

    this._updateStoreEntry(agentId, (cur) => {
      const base = cur || _emptyPermissionSet();
      const deniedCategories = _subtract(base.deniedCategories || [], [category]);
      const allowedCategories = _uniq([...(base.allowedCategories || []), category]);
      return {
        ...base,
        allowedCategories,
        deniedCategories,
        grantedBy: grantedBy || base.grantedBy || 'system',
        grantedAt: Date.now(),
      };
    });

    this._addAuditEntry({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: 'grant',
      kind: 'category',
      agentId,
      by: grantedBy || 'unknown',
      category,
      reason: reason || '',
      timestamp: Date.now(),
    });

    logger.info(`PermissionManager.grantCategory: ${agentId} ← +category[${category}] by ${grantedBy}`);
    return { success: true, category };
  }

  /**
   * 撤销某个 category 的权限（加入 deniedCategories，从 allowedCategories 移除）
   * @param {string} agentId
   * @param {string} category
   * @param {string} revokedBy
   * @param {string} [reason]
   * @returns {{ success: boolean, category: string, error?: string }}
   */
  revokeCategory(agentId, category, revokedBy, reason) {
    if (!agentId) return { success: false, category, error: '缺少 agentId' };
    if (!category) return { success: false, category, error: '缺少 category' };

    this._updateStoreEntry(agentId, (cur) => {
      const base = cur || _emptyPermissionSet();
      const allowedCategories = _subtract(base.allowedCategories || [], [category]);
      const deniedCategories = _uniq([...(base.deniedCategories || []), category]);
      return {
        ...base,
        allowedCategories,
        deniedCategories,
        grantedBy: base.grantedBy || 'system',
        grantedAt: base.grantedAt || Date.now(),
      };
    });

    this._addAuditEntry({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: 'revoke',
      kind: 'category',
      agentId,
      by: revokedBy || 'unknown',
      category,
      reason: reason || '',
      timestamp: Date.now(),
    });

    logger.info(`PermissionManager.revokeCategory: ${agentId} ← -category[${category}] by ${revokedBy}`);
    return { success: true, category };
  }

  // ── 细粒度资源访问检查 ──

  /**
   * 检查文件路径访问权限
   * 秘书始终允许。否则沿用 PermissionChecker 的 allowedPaths 逻辑，
   * 数据源来自 PermissionStore.fileAccess。
   *
   * @param {string} agentId
   * @param {string} filePath
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkFileAccess(agentId, filePath) {
    if (!agentId) return { allowed: false, reason: '缺少 agentId' };
    if (_isSecretary(agentId)) return { allowed: true };

    if (!filePath || typeof filePath !== 'string') {
      return { allowed: false, reason: '未提供有效的路径参数' };
    }

    const set = this.getPermissionSet(agentId);
    const fa = set?.fileAccess || {};
    const allowedPaths = fa.allowedPaths || [];

    if (allowedPaths.includes('*')) return { allowed: true };
    if (allowedPaths.length === 0) {
      return { allowed: false, reason: '该员工未配置任何可访问目录' };
    }

    const path = require('path');
    const os = require('os');
    const expand = (p) => (typeof p === 'string' && p.startsWith('~'))
      ? path.join(os.homedir(), p.slice(1)) : p;

    const normalizedTarget = path.resolve(expand(filePath));
    for (const allowed of allowedPaths) {
      const normalizedAllowed = path.resolve(expand(allowed));
      if (
        normalizedTarget === normalizedAllowed ||
        normalizedTarget.startsWith(normalizedAllowed + path.sep)
      ) {
        return { allowed: true };
      }
    }
    return {
      allowed: false,
      reason: `路径 "${filePath}" 不在该员工允许访问的目录列表中`,
    };
  }

  /**
   * 检查 Shell 命令访问权限
   * @param {string} agentId
   * @param {string} command
   * @returns {{ allowed: boolean, reason?: string, needConfirm?: boolean }}
   */
  checkShellAccess(agentId, command) {
    if (!agentId) return { allowed: false, reason: '缺少 agentId' };
    if (_isSecretary(agentId)) return { allowed: true, needConfirm: false };

    const set = this.getPermissionSet(agentId);
    const sa = set?.shellAccess || {};
    if (!sa.enabled) {
      return { allowed: false, reason: '该员工未启用 Shell 命令权限' };
    }

    if (!command || typeof command !== 'string') {
      return { allowed: false, reason: '未提供有效的命令参数' };
    }

    const blacklist = sa.blacklist || [];
    for (const pattern of blacklist) {
      if (command.includes(pattern)) {
        return { allowed: false, reason: `命令包含禁止的模式: "${pattern}"` };
      }
    }

    return { allowed: true, needConfirm: sa.confirmEach ?? true };
  }

  /**
   * 检查网络访问权限
   * @param {string} agentId
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkNetworkAccess(agentId) {
    if (!agentId) return { allowed: false, reason: '缺少 agentId' };
    if (_isSecretary(agentId)) return { allowed: true };

    const set = this.getPermissionSet(agentId);
    const na = set?.networkAccess || {};
    if (!na.enabled) {
      return { allowed: false, reason: '该员工未启用网络访问权限' };
    }
    return { allowed: true };
  }

  /**
   * 检查 Git 访问权限
   * @param {string} agentId
   * @returns {{ allowed: boolean, reason?: string, autoCommit?: boolean }}
   */
  checkGitAccess(agentId) {
    if (!agentId) return { allowed: false, reason: '缺少 agentId' };
    if (_isSecretary(agentId)) return { allowed: true, autoCommit: true };

    const set = this.getPermissionSet(agentId);
    const ga = set?.gitAccess || {};
    if (!ga.enabled) {
      return { allowed: false, reason: '该员工未启用 Git 协作权限' };
    }
    return { allowed: true, autoCommit: !!ga.autoCommit };
  }

  // ── 审计 / 查询 ──

  /**
   * 获取权限审计日志
   * @param {Object} [opts]
   * @param {string} [opts.agentId]
   * @param {number} [opts.limit]
   * @returns {Array<Object>}
   */
  getAuditLog({ agentId, limit } = {}) {
    return this._getAuditEntries({ agentId, limit });
  }

  /**
   * 获取全公司权限分布（按 agentId 索引）
   * @returns {Object<string, Object>}
   */
  getAllPermissionSets() {
    const store = getPermissionStore();
    let agentIds = [];
    if (store && typeof store.getAllAgentIds === 'function') {
      agentIds = store.getAllAgentIds() || [];
    } else {
      // 降级：从 agentConfigStore 拿已知 agent + 内存里的
      const configStore = getAgentConfigStore();
      if (configStore && typeof configStore.getAll === 'function') {
        agentIds = (configStore.getAll() || []).map((c) => c.id);
      }
      for (const id of _memoryStore.keys()) {
        if (!agentIds.includes(id)) agentIds.push(id);
      }
    }
    const result = {};
    for (const id of agentIds) {
      result[id] = this.getPermissionSet(id);
    }
    return result;
  }

  // ── 内部辅助 ──

  /**
   * 获取角色的默认 category 允许/禁止列表
   * @private
   * @param {string} agentId
   * @returns {{ allowed: string[], denied: string[] }}
   */
  _getRoleDefaultCategories(agentId) {
    const defaultsMod = getRoleDefaults();
    if (!defaultsMod || typeof defaultsMod.getRoleDefaultPermissions !== 'function') {
      return { allowed: [], denied: [] };
    }
    const { role, level } = _getRoleInfo(agentId);
    if (!role) return { allowed: [], denied: [] };
    try {
      const d = defaultsMod.getRoleDefaultPermissions(role, level) || {};
      return {
        allowed: Array.isArray(d.allowedCategories) ? d.allowedCategories : [],
        denied: Array.isArray(d.deniedCategories) ? d.deniedCategories : [],
      };
    } catch (e) {
      logger.warn(`getRoleDefaultPermissions(${role}, ${level}) 失败:`, e.message);
      return { allowed: [], denied: [] };
    }
  }

  /**
   * 将 stored PermissionSet 与 roleDefaults 合并，生成有效视图
   * @private
   * @param {string} agentId
   * @param {Object} stored
   * @returns {Object}
   */
  _mergeWithRoleDefaults(agentId, stored) {
    const base = { ..._emptyPermissionSet(), ...(stored || {}) };
    const defaults = this._getRoleDefaultCategories(agentId);

    // 合并 allowedCategories：显式 + 默认
    const allowedCategories = _uniq([
      ...(base.allowedCategories || []),
      ...defaults.allowed,
    ]);
    // 合并 deniedCategories：显式 + 默认
    const deniedCategories = _uniq([
      ...(base.deniedCategories || []),
      ...defaults.denied,
    ]);
    // 从 allowed 中扣除 denied（denied 优先）
    const effectiveAllowed = _subtract(allowedCategories, deniedCategories);

    return {
      ...base,
      allowedCategories: effectiveAllowed,
      deniedCategories,
      // allowedTools 不受 roleDefaults 影响（roleDefaults 按 category 粒度）
    };
  }
}

// ─────────────────────────────────────────────────────────────
// 单例
// ─────────────────────────────────────────────────────────────

const permissionManager = new PermissionManager();

module.exports = {
  PermissionManager,
  permissionManager,
  // 便于测试：暴露内部 helper
  _emptyPermissionSet,
};
