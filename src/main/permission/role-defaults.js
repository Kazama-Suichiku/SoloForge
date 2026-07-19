/**
 * SoloForge - 角色默认权限矩阵（Phase 2-A）
 *
 * 20 个 category × 6 个 role 的默认权限矩阵。
 * 返回每个角色默认允许 / 禁止的 category 列表，供 PermissionStore.mergeWithDefaults 使用。
 *
 * 角色：secretary, ceo, cto, cfo, chro, staff/manager
 * Category：collaboration, chat, file, shell, git, network, memory, context,
 *           todo, pm, operations, cfo, hr, recruit, suspension, dismiss_confirm,
 *           dev_plan_review, group_chat, math, permission
 *
 * 权限矩阵来源：docs/refactor/multi-agent-architecture-plan.md 「角色默认权限矩阵」章节。
 *
 * 秘书特殊规则：secretaryOverride = ['*'] — 开放所有 category，不受 roleDefaults 限制。
 *   实现方式：getRoleDefaultPermissions('secretary', ...) 返回 allowedCategories: ['*']，
 *   deniedCategories: []。PermissionManager 在合并时识别 '*' 并视作全量放行。
 *
 * @module permission/role-defaults
 */

'use strict';

/**
 * 全部 category 列表（顺序固定，便于遍历与日志展示）
 * @type {string[]}
 */
const ALL_CATEGORIES = [
  'collaboration',
  'chat',
  'file',
  'shell',
  'git',
  'network',
  'memory',
  'context',
  'todo',
  'pm',
  'operations',
  'cfo',
  'hr',
  'recruit',
  'suspension',
  'dismiss_confirm',
  'dev_plan_review',
  'group_chat',
  'math',
  'permission',
];

/**
 * 全部角色列表
 * @type {string[]}
 */
const ALL_ROLES = ['secretary', 'ceo', 'cto', 'cfo', 'chro', 'staff'];

/**
 * 秘书 Override：开放所有 category。
 * 使用 '*' 通配符，PermissionManager 需识别此符号。
 * @type {string[]}
 */
const SECRETARY_OVERRIDE = ['*'];

/**
 * 角色默认权限矩阵。
 * 每个角色记录默认允许的 category 列表（未列入即默认禁止）。
 * staff 角色对应 staff / manager（manager+ 通过 level 进一步细分）。
 *
 * 矩阵对照设计文档：
 * | Category | secretary | ceo | cto | cfo | chro | staff/manager |
 *   collaboration      | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
 *   chat               | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
 *   file               | ✅ | ✅ | ✅ | ✅ | ✅ | ✅(受限路径) |  ← staff 允许 category，文件路径受限由 fileAccess 控制
 *   shell              | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
 *   git                | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
 *   network            | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
 *   memory             | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
 *   context            | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
 *   todo               | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
 *   pm                 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
 *   operations         | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
 *   cfo                | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
 *   hr                 | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
 *   recruit            | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
 *   suspension         | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
 *   dismiss_confirm    | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
 *   dev_plan_review    | ✅ | ✅ | ✅ | ❌ | ❌ | manager+ |  ← staff 默认禁止，manager 由 level 判定
 *   group_chat         | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
 *   math               | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
 *   permission         | (secretaryOverride) | ✅ | ❌ | ❌ | ❌ | ❌ |  ← 只有 secretary + ceo
 *
 * @type {Object<string, string[]>}
 */
const ROLE_ALLOWED_CATEGORIES = {
  // 秘书：secretaryOverride = ['*']，直接返回通配符
  // 此处保留完整列表用于文档对照与降级回退，实际调用由 getRoleDefaultPermissions 特判返回 ['*']
  secretary: [
    'collaboration', 'chat', 'file', 'shell', 'git', 'network',
    'memory', 'context', 'todo', 'pm', 'operations', 'cfo',
    'hr', 'recruit', 'suspension', 'dismiss_confirm', 'dev_plan_review',
    'group_chat', 'math', 'permission',
  ],
  ceo: [
    'collaboration', 'chat', 'file', 'shell', 'git', 'network',
    'memory', 'context', 'todo', 'pm', 'operations', 'cfo',
    'hr', 'recruit', 'suspension', 'dev_plan_review',
    'group_chat', 'math', 'permission',
  ],
  cto: [
    'collaboration', 'chat', 'file', 'shell', 'git', 'network',
    'memory', 'context', 'todo', 'pm', 'operations',
    'recruit', 'dev_plan_review',
    'group_chat', 'math',
  ],
  cfo: [
    'collaboration', 'chat', 'file', 'network',
    'memory', 'context', 'todo', 'pm', 'operations', 'cfo',
    'recruit',
    'group_chat', 'math',
  ],
  chro: [
    'collaboration', 'chat', 'file', 'network',
    'memory', 'context', 'todo', 'pm', 'operations',
    'hr', 'recruit', 'suspension',
    'group_chat', 'math',
  ],
  // staff / manager 基础集（dev_plan_review 由 level=manager+ 开启）
  staff: [
    'collaboration', 'chat', 'file', 'network',
    'memory', 'context', 'todo', 'pm',
    'math',
  ],
};

/**
 * staff 角色可由 level 提权得到的额外 category。
 * 当 role === 'staff' 且 level 属于 manager+ 时，叠加 dev_plan_review。
 * （manager 级别及以上的 staff 才有 dev_plan_review 权限）
 * @type {string[]}
 */
const STAFF_MANAGER_EXTRA = ['dev_plan_review'];

/**
 * 判断给定 level 是否属于 manager 及以上。
 * 与 agent-config-store.js 的 LEVELS rank 对齐：
 *   manager=40, director=60, vp=80, c_level=100
 * @param {string} level - agent-config-store 中定义的 level id
 * @returns {boolean}
 */
function isManagerOrAbove(level) {
  const MANAGER_RANKS = new Set([
    'manager',
    'director',
    'vp',
    'c_level',
  ]);
  return MANAGER_RANKS.has(level);
}

/**
 * 获取某角色的默认 category 权限。
 * @param {string} role - secretary | ceo | cto | cfo | chro | staff
 * @param {string} [level] - 职级 id（仅 staff 角色用到，用于区分 manager+）
 * @returns {{ allowedCategories: string[], deniedCategories: string[] }}
 *   - allowedCategories: 该角色默认允许的 category 列表
 *   - deniedCategories: 该角色默认禁止的 category 列表（ALL_CATEGORIES - allowed）
 *   - 秘书返回 allowedCategories: ['*']，deniedCategories: []（secretaryOverride）
 */
function getRoleDefaultPermissions(role, level) {
  // 秘书特殊规则：secretaryOverride = ['*']
  if (role === 'secretary') {
    return {
      allowedCategories: [...SECRETARY_OVERRIDE],
      deniedCategories: [],
    };
  }

  const allowed = ROLE_ALLOWED_CATEGORIES[role];
  if (!allowed) {
    // 未知角色默认最小权限（只允许最基础的协作与聊天）
    return {
      allowedCategories: ['collaboration', 'chat', 'todo'],
      deniedCategories: ALL_CATEGORIES.filter(
        (c) => c !== 'collaboration' && c !== 'chat' && c !== 'todo'
      ),
    };
  }

  // staff 角色根据 level 进一步细分
  let finalAllowed = allowed;
  if (role === 'staff') {
    if (level && isManagerOrAbove(level)) {
      finalAllowed = allowed.concat(STAFF_MANAGER_EXTRA);
    }
  }

  // denied = 全集 - allowed
  const allowedSet = new Set(finalAllowed);
  const denied = ALL_CATEGORIES.filter((c) => !allowedSet.has(c));

  return {
    allowedCategories: [...finalAllowed],
    deniedCategories: denied,
  };
}

/**
 * 判断某 category 是否为某角色默认允许。
 * 便捷方法，等价于 getRoleDefaultPermissions(role, level).allowedCategories.includes(category)
 * 但对秘书的 '*' 通配符做特殊处理。
 * @param {string} role
 * @param {string} category
 * @param {string} [level]
 * @returns {boolean}
 */
function isCategoryAllowedByDefault(role, category, level) {
  // 秘书 override：全量放行
  if (role === 'secretary') return true;
  const { allowedCategories } = getRoleDefaultPermissions(role, level);
  return allowedCategories.includes(category);
}

module.exports = {
  ALL_CATEGORIES,
  ALL_ROLES,
  SECRETARY_OVERRIDE,
  ROLE_ALLOWED_CATEGORIES,
  STAFF_MANAGER_EXTRA,
  isManagerOrAbove,
  getRoleDefaultPermissions,
  isCategoryAllowedByDefault,
};
