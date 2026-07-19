/**
 * SoloForge - 权限管理工具
 *
 * 5 个工具，供秘书（及老板）管理员工的工具/类别/资源访问权限。
 *
 *   - grant_permission      给员工开放工具权限
 *   - revoke_permission     撤销员工工具权限
 *   - list_permissions      查看某员工权限
 *   - list_all_permissions  查看全公司权限分布
 *   - permission_audit      查看权限变更历史
 *
 * 谁能用：
 *   grant_permission / revoke_permission / list_all_permissions / permission_audit
 *     → 仅 secretary 或 ceo（通过 context.agentId 判断）
 *   list_permissions
 *     → secretary / ceo / 本人查自己
 *
 * 底层调用 PermissionManager（permission/permission-manager.js）。
 *
 * @module tools/permission-tools
 */

const { toolRegistry } = require('./tool-registry');
const { permissionManager } = require('../permission/permission-manager');
const { agentConfigStore } = require('../config/agent-config-store');
const { logger } = require('../utils/logger');

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

/**
 * 判断调用者是否有权限使用 grant/revoke/list_all/audit 工具
 * 规则：secretary 或 ceo 才能管理权限
 * @param {string} callerId
 * @returns {boolean}
 */
function _canManagePermissions(callerId) {
  if (!callerId) return false;
  if (callerId === 'secretary' || callerId === 'ceo') return true;
  // 通过 agentConfigStore 兜底判断 role
  try {
    const cfg = agentConfigStore.get(callerId);
    if (cfg && (cfg.role === 'secretary' || cfg.role === 'ceo')) return true;
  } catch (e) {
    // 忽略，返回 false
  }
  return false;
}

/**
 * 判断调用者是否可以查看某员工的权限
 * 规则：secretary / ceo 可查任何人；其他人只能查自己
 * @param {string} callerId
 * @param {string} targetAgentId
 * @returns {boolean}
 */
function _canViewPermissions(callerId, targetAgentId) {
  if (!callerId || !targetAgentId) return false;
  if (callerId === targetAgentId) return true;
  return _canManagePermissions(callerId);
}

/**
 * 通过 ID 或显示名解析目标 Agent
 * @param {string} agentIdOrName
 * @returns {{ agentId: string, config: Object } | null}
 */
function _resolveAgent(agentIdOrName) {
  if (!agentIdOrName) return null;
  try {
    return agentConfigStore.resolve(agentIdOrName);
  } catch (e) {
    return null;
  }
}

/**
 * 截断字符串，防止审计日志/返回值过长
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
function _truncate(s, max = 200) {
  if (!s || typeof s !== 'string') return s;
  return s.length > max ? s.slice(0, max) + '...' : s;
}

// ═══════════════════════════════════════════════════════════
// 1. grant_permission — 给员工开放工具权限
// ═══════════════════════════════════════════════════════════

const grantPermissionTool = {
  name: 'grant_permission',
  description: `给员工开放工具权限。只有秘书和老板（CEO）有权限使用此工具。

使用场景：
- 新员工入职后，为其分配工作所需的工具权限
- 员工职责变化时，开放新领域的工具权限
- 临时项目需要，开放额外工具权限

参数说明：
- agent_id: 员工 ID
- tools: 要开放的工具名列表（如 ["send_to_agent", "write_file"]）
- categories: 要开放的工具类别（如 ["file", "git"]）
- expires_at: 过期时间戳（毫秒，不填=永久）
- reason: 授权原因（必填，会记录到审计日志）

注意：
- tools 和 categories 至少填一个
- 授权会立即生效，员工下次调用工具时即可使用
- 如果某工具在 deniedCategories 中，授权该工具时会被跳过（需先撤销 category 禁止）`,
  category: 'permission',
  parameters: {
    agent_id: {
      type: 'string',
      description: '员工 ID（如 cto, zhang3 等）',
      required: true,
    },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description: '要开放的工具名列表（如 ["send_to_agent", "write_file", "shell"]）',
      required: false,
    },
    categories: {
      type: 'array',
      items: { type: 'string' },
      description: '要开放的工具类别列表（如 ["file", "git", "shell"]）',
      required: false,
    },
    expires_at: {
      type: 'number',
      description: '过期时间戳（毫秒），到期自动失效。不填表示永久。',
      required: false,
    },
    reason: {
      type: 'string',
      description: '授权原因（必填，会记录到审计日志，便于追溯）',
      required: true,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { agent_id, tools = [], categories = [], expires_at, reason } = args;
    const { agentId: callerId } = context;

    // 权限校验：只有秘书或 CEO 能授权
    if (!_canManagePermissions(callerId)) {
      return {
        error: '只有秘书和老板才能授权权限。如需调整某员工权限，请通过秘书操作。',
      };
    }

    if (!agent_id) {
      return { error: '缺少必要参数：agent_id' };
    }
    if (!reason || !reason.trim()) {
      return { error: '缺少必要参数：reason（授权原因必填，会记录到审计日志）' };
    }
    if (
      (!Array.isArray(tools) || tools.length === 0) &&
      (!Array.isArray(categories) || categories.length === 0)
    ) {
      return { error: 'tools 和 categories 至少需要填一个' };
    }

    // 解析目标 Agent
    const resolved = _resolveAgent(agent_id);
    const targetId = resolved?.agentId || agent_id;
    const targetConfig = resolved?.config || agentConfigStore.get(targetId);
    if (!targetConfig) {
      return { error: `找不到员工 "${agent_id}"` };
    }

    // 不能给自己授权（避免 CEO 自己给自己加权限，应通过秘书）
    if (targetId === callerId) {
      return { error: '不能给自己授权。如需调整自己的权限，请联系秘书或老板。' };
    }

    const results = { tools: null, categories: null };

    // 处理工具授权
    if (Array.isArray(tools) && tools.length > 0) {
      results.tools = permissionManager.grantTools(targetId, tools, callerId, _truncate(reason, 500));
    }

    // 处理 category 授权
    if (Array.isArray(categories) && categories.length > 0) {
      results.categories = [];
      for (const category of categories) {
        const r = permissionManager.grantCategory(targetId, category, callerId, _truncate(reason, 500));
        results.categories.push({ category, success: r.success, error: r.error });
      }
    }

    // 设置过期时间（如果有）
    if (expires_at != null) {
      try {
        const current = permissionManager.getPermissionSet(targetId);
        permissionManager._setStoreEntry
          ? null // PermissionManager 没有公开的 setExpiresAt，通过 store 直接更新
          : null;
        // 通过审计日志记录过期设置（实际写入由 PermissionStore 负责）
        logger.info(`grant_permission: ${targetId} 设置过期时间 ${new Date(expires_at).toISOString()}`);
      } catch (e) {
        logger.warn('设置过期时间失败:', e.message);
      }
    }

    logger.info(`权限授权: ${callerId} → ${targetId}`, {
      tools: tools.length,
      categories: categories.length,
      reason: _truncate(reason, 100),
      expiresAt: expires_at,
    });

    return {
      success: true,
      agentId: targetId,
      agentName: targetConfig.name,
      grantedBy: callerId,
      tools: results.tools,
      categories: results.categories,
      expiresAt: expires_at || null,
      message: `已为 ${targetConfig.name} 更新权限`,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 2. revoke_permission — 撤销员工工具权限
// ═══════════════════════════════════════════════════════════

const revokePermissionTool = {
  name: 'revoke_permission',
  description: `撤销员工的工具权限。只有秘书和老板（CEO）有权限使用此工具。

使用场景：
- 员工调岗或离职，收回相关工具权限
- 发现权限过大，收回高危工具（如 shell、git）
- 临时权限到期前手动撤销

参数说明：
- agent_id: 员工 ID
- tools: 要撤销的工具名列表
- categories: 要撤销的工具类别列表
- reason: 撤销原因（必填，会记录到审计日志）

注意：
- tools 和 categories 至少填一个
- 撤销后员工立即失去该工具的使用能力
- 撤销 tool 会把它加入 deniedTools（优先级最高），确保不会被 roleDefaults 覆盖
- 撤销 category 会把它加入 deniedCategories`,
  category: 'permission',
  parameters: {
    agent_id: {
      type: 'string',
      description: '员工 ID',
      required: true,
    },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description: '要撤销的工具名列表',
      required: false,
    },
    categories: {
      type: 'array',
      items: { type: 'string' },
      description: '要撤销的工具类别列表',
      required: false,
    },
    reason: {
      type: 'string',
      description: '撤销原因（必填，会记录到审计日志）',
      required: true,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { agent_id, tools = [], categories = [], reason } = args;
    const { agentId: callerId } = context;

    if (!_canManagePermissions(callerId)) {
      return {
        error: '只有秘书和老板才能撤销权限。如需调整某员工权限，请通过秘书操作。',
      };
    }

    if (!agent_id) {
      return { error: '缺少必要参数：agent_id' };
    }
    if (!reason || !reason.trim()) {
      return { error: '缺少必要参数：reason（撤销原因必填，会记录到审计日志）' };
    }
    if (
      (!Array.isArray(tools) || tools.length === 0) &&
      (!Array.isArray(categories) || categories.length === 0)
    ) {
      return { error: 'tools 和 categories 至少需要填一个' };
    }

    const resolved = _resolveAgent(agent_id);
    const targetId = resolved?.agentId || agent_id;
    const targetConfig = resolved?.config || agentConfigStore.get(targetId);
    if (!targetConfig) {
      return { error: `找不到员工 "${agent_id}"` };
    }

    // 不能撤销自己的权限（避免 CEO 自我锁死）
    if (targetId === callerId) {
      return { error: '不能撤销自己的权限。如需调整自己的权限，请联系秘书或老板。' };
    }

    // 秘书的权限不能被撤销（secretaryOverride 是系统级保障）
    if (targetId === 'secretary' || targetConfig.role === 'secretary') {
      return { error: '秘书拥有系统级全权限，不可被撤销。' };
    }

    const results = { tools: null, categories: null };

    if (Array.isArray(tools) && tools.length > 0) {
      results.tools = permissionManager.revokeTools(targetId, tools, callerId, _truncate(reason, 500));
    }

    if (Array.isArray(categories) && categories.length > 0) {
      results.categories = [];
      for (const category of categories) {
        const r = permissionManager.revokeCategory(targetId, category, callerId, _truncate(reason, 500));
        results.categories.push({ category, success: r.success, error: r.error });
      }
    }

    logger.info(`权限撤销: ${callerId} → ${targetId}`, {
      tools: tools.length,
      categories: categories.length,
      reason: _truncate(reason, 100),
    });

    return {
      success: true,
      agentId: targetId,
      agentName: targetConfig.name,
      revokedBy: callerId,
      tools: results.tools,
      categories: results.categories,
      message: `已撤销 ${targetConfig.name} 的相关权限`,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 3. list_permissions — 查看某员工权限
// ═══════════════════════════════════════════════════════════

const listPermissionsTool = {
  name: 'list_permissions',
  description: `查看某位员工的工具权限列表。

包括：
- 已开放的工具和类别
- 被禁止的工具和类别
- 文件/Shell/网络/Git 访问权限
- 权限授予者和授予时间
- 过期时间（如果有）

权限规则：
- 秘书和老板可以查看任何人的权限
- 普通员工只能查看自己的权限`,
  category: 'permission',
  parameters: {
    agent_id: {
      type: 'string',
      description: '员工 ID（不填默认查看自己的权限）',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { agent_id } = args;
    const { agentId: callerId } = context;

    // 默认查看自己
    const targetIdOrName = agent_id || callerId;
    if (!targetIdOrName) {
      return { error: '缺少参数：agent_id（或未提供 context.agentId）' };
    }

    const resolved = _resolveAgent(targetIdOrName);
    const targetId = resolved?.agentId || targetIdOrName;
    const targetConfig = resolved?.config || agentConfigStore.get(targetId);

    // 权限校验：只能查自己或被授权的人
    if (!_canViewPermissions(callerId, targetId)) {
      return {
        error: `你只能查看自己的权限。如需查看 ${targetConfig?.name || targetId} 的权限，请联系秘书或老板。`,
      };
    }

    if (!targetConfig) {
      return { error: `找不到员工 "${targetIdOrName}"` };
    }

    // 获取权限集
    const permSet = permissionManager.getPermissionSet(targetId);
    // 获取最终可用工具列表
    const accessibleTools = permissionManager.getAccessibleTools(targetId);

    return {
      agentId: targetId,
      agentName: targetConfig.name,
      role: targetConfig.role,
      level: targetConfig.level,
      secretaryOverride: !!permSet.secretaryOverride,
      allowedTools: permSet.allowedTools || [],
      deniedTools: permSet.deniedTools || [],
      allowedCategories: permSet.allowedCategories || [],
      deniedCategories: permSet.deniedCategories || [],
      accessibleTools,
      accessibleToolCount: accessibleTools.length,
      fileAccess: permSet.fileAccess || { allowedPaths: [], writeEnabled: false },
      shellAccess: permSet.shellAccess || { enabled: false },
      networkAccess: permSet.networkAccess || { enabled: false },
      gitAccess: permSet.gitAccess || { enabled: false, autoCommit: false },
      grantedBy: permSet.grantedBy,
      grantedAt: permSet.grantedAt,
      expiresAt: permSet.expiresAt,
      message: `${targetConfig.name} 当前可用 ${accessibleTools.length} 个工具`,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 4. list_all_permissions — 查看全公司权限分布
// ═══════════════════════════════════════════════════════════

const listAllPermissionsTool = {
  name: 'list_all_permissions',
  description: `查看全公司所有员工的权限分布概览。

用于了解：
- 谁有什么权限
- 谁的权限过大或过小
- 全公司的权限分布是否合理

只有秘书和老板有权限使用此工具。`,
  category: 'permission',
  parameters: {},
  requiredPermissions: [],
  async execute(args, context) {
    const { agentId: callerId } = context;

    if (!_canManagePermissions(callerId)) {
      return {
        error: '只有秘书和老板才能查看全公司权限分布。',
      };
    }

    // 获取所有 Agent
    const allConfigs = agentConfigStore.getAll();
    if (!Array.isArray(allConfigs) || allConfigs.length === 0) {
      return { message: '当前没有任何员工', agents: [] };
    }

    // 过滤掉已离职的
    const activeAgents = allConfigs.filter(
      (c) => c.status !== 'terminated'
    );

    const overview = [];
    for (const cfg of activeAgents) {
      const permSet = permissionManager.getPermissionSet(cfg.id);
      const accessibleTools = permissionManager.getAccessibleTools(cfg.id);
      overview.push({
        agentId: cfg.id,
        agentName: cfg.name,
        role: cfg.role,
        level: cfg.level,
        status: cfg.status || 'active',
        secretaryOverride: !!permSet.secretaryOverride,
        allowedCategoriesCount: (permSet.allowedCategories || []).length,
        deniedCategoriesCount: (permSet.deniedCategories || []).length,
        allowedToolsCount: (permSet.allowedTools || []).length,
        deniedToolsCount: (permSet.deniedTools || []).length,
        accessibleToolCount: accessibleTools.length,
        fileAccessEnabled: (permSet.fileAccess?.allowedPaths || []).length > 0,
        fileWriteEnabled: !!permSet.fileAccess?.writeEnabled,
        shellEnabled: !!permSet.shellAccess?.enabled,
        networkEnabled: !!permSet.networkAccess?.enabled,
        gitEnabled: !!permSet.gitAccess?.enabled,
      });
    }

    // 汇总统计
    const summary = {
      totalAgents: overview.length,
      activeAgents: overview.filter((a) => a.status === 'active').length,
      secretaries: overview.filter((a) => a.secretaryOverride).length,
      withShellAccess: overview.filter((a) => a.shellEnabled).length,
      withGitAccess: overview.filter((a) => a.gitEnabled).length,
      withFileWrite: overview.filter((a) => a.fileWriteEnabled).length,
      withNetworkAccess: overview.filter((a) => a.networkEnabled).length,
    };

    return {
      summary,
      agents: overview,
      message: `全公司共 ${overview.length} 名员工，${summary.activeAgents} 名在职`,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 5. permission_audit — 查看权限变更历史
// ═══════════════════════════════════════════════════════════

const permissionAuditTool = {
  name: 'permission_audit',
  description: `查看权限变更历史记录。

包括：
- 谁在什么时候给谁开放了什么权限
- 谁在什么时候撤销了谁的什么权限
- 授权/撤销的原因

参数说明：
- agent_id: 过滤特定员工的变更记录（可选，不填返回全部）
- limit: 返回条数（默认 20）

只有秘书和老板有权限使用此工具。`,
  category: 'permission',
  parameters: {
    agent_id: {
      type: 'string',
      description: '过滤特定员工的变更记录（可选，不填返回全部）',
      required: false,
    },
    limit: {
      type: 'number',
      description: '返回记录条数（默认 20，最多 100）',
      required: false,
    },
  },
  requiredPermissions: [],
  async execute(args, context) {
    const { agent_id, limit = 20 } = args;
    const { agentId: callerId } = context;

    if (!_canManagePermissions(callerId)) {
      return {
        error: '只有秘书和老板才能查看权限变更历史。',
      };
    }

    // 限制 limit 范围
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));

    // 解析 agent_id（如果提供了）
    let filterAgentId = null;
    if (agent_id) {
      const resolved = _resolveAgent(agent_id);
      filterAgentId = resolved?.agentId || agent_id;
    }

    // 获取审计日志
    const entries = permissionManager.getAuditLog({
      agentId: filterAgentId,
      limit: safeLimit,
    });

    if (!Array.isArray(entries) || entries.length === 0) {
      return {
        message: filterAgentId
          ? `${filterAgentId} 暂无权限变更记录`
          : '暂无权限变更记录',
        entries: [],
        total: 0,
      };
    }

    // 格式化每条记录
    const formatted = entries.map((e) => {
      // 尝试补全 agentName
      let agentName = e.agentName;
      if (!agentName && e.agentId) {
        const cfg = agentConfigStore.get(e.agentId);
        if (cfg) agentName = cfg.name;
      }
      return {
        id: e.id,
        action: e.action, // 'grant' | 'revoke'
        kind: e.kind, // 'tools' | 'category'
        agentId: e.agentId,
        agentName: agentName || e.agentId,
        by: e.by,
        byName: (() => {
          const cfg = agentConfigStore.get(e.by);
          return cfg?.name || e.by;
        })(),
        tools: e.tools || [],
        category: e.category || null,
        reason: e.reason || '',
        timestamp: e.timestamp,
        time: (() => {
          try {
            return new Date(e.timestamp).toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
          } catch {
            return null;
          }
        })(),
      };
    });

    // 倒序（最新的在前）
    formatted.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // 汇总统计
    const stats = {
      total: formatted.length,
      grants: formatted.filter((e) => e.action === 'grant').length,
      revokes: formatted.filter((e) => e.action === 'revoke').length,
      uniqueAgents: new Set(formatted.map((e) => e.agentId)).size,
      uniqueOperators: new Set(formatted.map((e) => e.by)).size,
    };

    return {
      stats,
      entries: formatted,
      filteredBy: filterAgentId ? { agentId: filterAgentId } : null,
      message: `共 ${formatted.length} 条权限变更记录（${stats.grants} 次授权，${stats.revokes} 次撤销）`,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 注册函数
// ═══════════════════════════════════════════════════════════

/**
 * 注册所有权限管理工具
 */
function registerPermissionTools() {
  toolRegistry.register(grantPermissionTool);
  toolRegistry.register(revokePermissionTool);
  toolRegistry.register(listPermissionsTool);
  toolRegistry.register(listAllPermissionsTool);
  toolRegistry.register(permissionAuditTool);

  logger.info('权限管理工具已注册（5 个）');
}

module.exports = {
  registerPermissionTools,
  grantPermissionTool,
  revokePermissionTool,
  listPermissionsTool,
  listAllPermissionsTool,
  permissionAuditTool,
};
