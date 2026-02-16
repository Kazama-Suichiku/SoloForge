/**
 * SoloForge - 部门群聊管理器
 * 管理 CXO 部门群聊的创建、成员同步和消息推送
 * @module chat/department-group
 */

const { logger } = require('../utils/logger');
const { agentConfigStore, DEPARTMENTS } = require('../config/agent-config-store');

// IPC 通道（延迟加载避免循环依赖）
let CHANNELS = null;
function getChannels() {
  if (!CHANNELS) {
    CHANNELS = require('../../shared/ipc-channels');
  }
  return CHANNELS;
}

// webContents 引用（由 main.js 注入）
let _webContents = null;

// 部门群聊节流机制：防止对话风暴
// key: `${groupId}:${agentId}`, value: lastMessageTimestamp
const _agentCooldowns = new Map();
const AGENT_COOLDOWN_MS = 30 * 1000; // 同一 Agent 30 秒内最多被触发一次回复

// 部门群聊全局节流：同一群聊 10 秒内最多 3 条消息
const _groupRateLimits = new Map();
const GROUP_RATE_LIMIT_WINDOW = 10 * 1000;
const GROUP_RATE_LIMIT_MAX = 3;

/**
 * 检查 Agent 是否在冷却中（防止被频繁触发回复）
 * @param {string} groupId - 群聊 ID
 * @param {string} agentId - Agent ID
 * @returns {boolean} 是否在冷却中
 */
function isAgentOnCooldown(groupId, agentId) {
  const key = `${groupId}:${agentId}`;
  const lastTime = _agentCooldowns.get(key);
  if (!lastTime) return false;
  return Date.now() - lastTime < AGENT_COOLDOWN_MS;
}

/**
 * 记录 Agent 的最后触发时间
 * @param {string} groupId - 群聊 ID
 * @param {string} agentId - Agent ID
 */
function recordAgentTrigger(groupId, agentId) {
  const key = `${groupId}:${agentId}`;
  _agentCooldowns.set(key, Date.now());
}

/**
 * 检查群聊速率限制
 * @param {string} groupId - 群聊 ID
 * @returns {boolean} 是否超出限制
 */
function isGroupRateLimited(groupId) {
  const now = Date.now();
  let history = _groupRateLimits.get(groupId) || [];
  
  // 清理过期记录
  history = history.filter((t) => now - t < GROUP_RATE_LIMIT_WINDOW);
  
  if (history.length >= GROUP_RATE_LIMIT_MAX) {
    return true;
  }
  
  // 记录本次
  history.push(now);
  _groupRateLimits.set(groupId, history);
  return false;
}

/**
 * 过滤掉冷却中的 Agent，返回有效的 mentions
 * @param {string} groupId - 群聊 ID
 * @param {string[]} mentions - 被 @ 的 Agent ID 列表
 * @returns {{ valid: string[], filtered: string[] }}
 */
function filterCooldownMentions(groupId, mentions) {
  const valid = [];
  const filtered = [];
  
  for (const agentId of mentions) {
    if (isAgentOnCooldown(groupId, agentId)) {
      filtered.push(agentId);
    } else {
      valid.push(agentId);
      recordAgentTrigger(groupId, agentId);
    }
  }
  
  return { valid, filtered };
}

/**
 * 设置 webContents 引用
 * @param {Electron.WebContents} webContents
 */
function setWebContents(webContents) {
  _webContents = webContents;
}

/**
 * 获取部门群聊 ID
 * @param {string} departmentId - 部门 ID
 * @returns {string} 群聊 ID
 */
function getDepartmentGroupId(departmentId) {
  return `dept-${departmentId}`;
}

/**
 * 根据 Agent ID 获取其所属的部门群聊信息
 * 基于员工的 department 字段来判断，而非 reportsTo
 * @param {string} agentId - Agent ID
 * @returns {{ departmentId: string, ownerId: string } | null}
 */
function getAgentDepartmentInfo(agentId) {
  const config = agentConfigStore.get(agentId);
  if (!config) return null;

  // 获取员工的部门（支持多部门，取主部门）
  const departmentId = Array.isArray(config.departments) && config.departments.length > 0
    ? config.departments[0]
    : config.department;
  
  if (!departmentId) return null;

  // CXO 级别：直接是部门负责人
  if (config.level === 'c_level') {
    return {
      departmentId,
      ownerId: agentId,
    };
  }

  // 普通员工：查找该部门的 CXO 负责人
  const allConfigs = agentConfigStore.getAll();
  const departmentCXO = allConfigs.find(
    (c) => c.level === 'c_level' && 
           (c.department === departmentId || 
            (Array.isArray(c.departments) && c.departments.includes(departmentId))) &&
           (c.status || 'active') !== 'terminated'
  );

  if (departmentCXO) {
    return {
      departmentId,
      ownerId: departmentCXO.id,
    };
  }

  // 如果该部门没有 CXO，尝试使用 reportsTo 作为备选
  const supervisor = config.reportsTo;
  if (supervisor) {
    const supervisorConfig = agentConfigStore.get(supervisor);
    if (supervisorConfig?.level === 'c_level') {
      return {
        departmentId: supervisorConfig.department,
        ownerId: supervisor,
      };
    }
  }

  return null;
}

/**
 * 获取部门下所有活跃成员
 * 基于员工的 department/departments 字段来判断
 * @param {string} departmentId - 部门 ID
 * @param {string} ownerId - 部门负责人 ID
 * @returns {string[]} 成员 Agent ID 列表（含 ownerId）
 */
function getDepartmentMembers(departmentId, ownerId) {
  const allConfigs = agentConfigStore.getAll();
  const members = new Set([ownerId]);

  for (const config of allConfigs) {
    // 跳过已离职的
    if (config.status === 'terminated') continue;
    // 跳过负责人本人（已在集合中）
    if (config.id === ownerId) continue;
    
    // 检查是否属于该部门（支持多部门）
    const agentDepts = Array.isArray(config.departments) && config.departments.length > 0
      ? config.departments
      : (config.department ? [config.department] : []);
    
    if (agentDepts.includes(departmentId)) {
      members.add(config.id);
    }
  }

  return Array.from(members);
}

/**
 * 确保部门群聊存在（如果不存在则创建）
 * @param {string} departmentId - 部门 ID
 * @param {string} ownerId - 群主（CXO）Agent ID
 * @param {string} [customName] - 自定义群名（可选）
 * @returns {{ success: boolean, groupId?: string, error?: string }}
 */
function ensureDepartmentGroup(departmentId, ownerId, customName) {
  if (!_webContents || _webContents.isDestroyed()) {
    // webContents 不可用时静默返回，等窗口创建后重试
    // 这在应用启动时是正常情况
    return { success: false, error: 'UI 未就绪', pending: true };
  }

  const groupId = getDepartmentGroupId(departmentId);
  const ownerConfig = agentConfigStore.get(ownerId);
  const deptInfo = DEPARTMENTS[departmentId.toUpperCase()] || { name: departmentId };
  
  // 默认群名：CXO 名字 + 团队
  const defaultName = ownerConfig ? `${ownerConfig.name}团队` : `${deptInfo.name}`;
  const name = customName || defaultName;

  // 获取部门所有活跃成员
  const participants = getDepartmentMembers(departmentId, ownerId);

  const channels = getChannels();
  _webContents.send(channels.CHAT_DEPT_GROUP_CREATE, {
    groupId,
    departmentId,
    ownerId,
    name,
    participants,
  });

  logger.info(`部门群聊创建/确保: ${name} (${groupId})`, {
    departmentId,
    ownerId,
    members: participants.length,
  });

  return { success: true, groupId };
}

/**
 * 添加成员到部门群聊
 * @param {string} departmentId - 部门 ID
 * @param {string} agentId - 新成员 Agent ID
 * @returns {{ success: boolean, error?: string }}
 */
function addMemberToGroup(departmentId, agentId) {
  if (!_webContents || _webContents.isDestroyed()) {
    logger.warn('addMemberToGroup: webContents 不可用');
    return { success: false, error: 'UI 未就绪' };
  }

  const groupId = getDepartmentGroupId(departmentId);
  const agentConfig = agentConfigStore.get(agentId);
  const agentName = agentConfig?.name || agentId;

  const channels = getChannels();
  _webContents.send(channels.CHAT_DEPT_GROUP_UPDATE, {
    action: 'add',
    groupId,
    departmentId,
    agentId,
    agentName,
  });

  logger.info(`部门群聊添加成员: ${agentName} -> ${groupId}`);
  return { success: true };
}

/**
 * 从部门群聊移除成员
 * @param {string} departmentId - 部门 ID
 * @param {string} agentId - 成员 Agent ID
 * @returns {{ success: boolean, error?: string }}
 */
function removeMemberFromGroup(departmentId, agentId) {
  if (!_webContents || _webContents.isDestroyed()) {
    logger.warn('removeMemberFromGroup: webContents 不可用');
    return { success: false, error: 'UI 未就绪' };
  }

  const groupId = getDepartmentGroupId(departmentId);
  const agentConfig = agentConfigStore.get(agentId);
  const agentName = agentConfig?.name || agentId;

  const channels = getChannels();
  _webContents.send(channels.CHAT_DEPT_GROUP_UPDATE, {
    action: 'remove',
    groupId,
    departmentId,
    agentId,
    agentName,
  });

  logger.info(`部门群聊移除成员: ${agentName} <- ${groupId}`);
  return { success: true };
}

/**
 * 在部门群聊中发送消息
 * @param {string} departmentId - 部门 ID
 * @param {string} senderId - 发送者 Agent ID
 * @param {string} content - 消息内容
 * @param {string[]} [mentions] - 被 @ 的 Agent ID 列表
 * @returns {{ success: boolean, error?: string, filteredMentions?: string[] }}
 */
function postToDepartment(departmentId, senderId, content, mentions = []) {
  if (!_webContents || _webContents.isDestroyed()) {
    logger.warn('postToDepartment: webContents 不可用');
    return { success: false, error: 'UI 未就绪' };
  }

  const groupId = getDepartmentGroupId(departmentId);
  const senderConfig = agentConfigStore.get(senderId);
  const senderName = senderConfig?.name || senderId;

  // 检查群聊速率限制
  if (isGroupRateLimited(groupId)) {
    logger.warn(`部门群聊速率限制: ${groupId} 消息过于频繁`);
    return {
      success: false,
      error: '消息发送过于频繁，请稍后再试（每 10 秒最多 3 条消息）',
    };
  }

  // 过滤冷却中的 mentions（防止同一 Agent 被频繁触发）
  let effectiveMentions = mentions;
  let filteredAgents = [];
  if (mentions.length > 0) {
    const { valid, filtered } = filterCooldownMentions(groupId, mentions);
    effectiveMentions = valid;
    filteredAgents = filtered;
    
    if (filtered.length > 0) {
      logger.info(`部门群聊冷却过滤: ${filtered.join(', ')} 正在冷却中，不触发回复`);
    }
  }

  const channels = getChannels();
  _webContents.send(channels.CHAT_DEPT_GROUP_MESSAGE, {
    groupId,
    departmentId,
    senderId,
    senderName,
    content,
    mentions: effectiveMentions, // 只发送有效的 mentions
    timestamp: Date.now(),
  });

  logger.info(`部门群聊消息: ${senderName} -> ${groupId}`, {
    contentLength: content.length,
    requestedMentions: mentions.length,
    effectiveMentions: effectiveMentions.length,
    filteredMentions: filteredAgents.length,
  });

  return {
    success: true,
    effectiveMentions,
    filteredMentions: filteredAgents,
  };
}

/**
 * 重命名部门群聊
 * @param {string} departmentId - 部门 ID
 * @param {string} newName - 新群名
 * @returns {{ success: boolean, error?: string }}
 */
function renameDepartmentGroup(departmentId, newName) {
  if (!_webContents || _webContents.isDestroyed()) {
    logger.warn('renameDepartmentGroup: webContents 不可用');
    return { success: false, error: 'UI 未就绪' };
  }

  const groupId = getDepartmentGroupId(departmentId);

  const channels = getChannels();
  _webContents.send(channels.CHAT_DEPT_GROUP_RENAME, {
    groupId,
    departmentId,
    newName,
  });

  logger.info(`部门群聊重命名: ${groupId} -> ${newName}`);
  return { success: true };
}

/**
 * 获取所有应该存在的部门群聊列表
 * 用于前端初始化时同步
 * 基于部门的 CXO 负责人和该部门的员工来生成群聊
 * @returns {Array<{ groupId: string, departmentId: string, ownerId: string, name: string, participants: string[] }>}
 */
function getAllDepartmentGroups() {
  const allConfigs = agentConfigStore.getAll();
  const groups = [];

  // 找出所有 CXO 及其负责的部门
  const cxoByDepartment = new Map(); // departmentId -> cxoConfig

  for (const config of allConfigs) {
    if ((config.status || 'active') === 'terminated') continue;
    if (config.level === 'c_level') {
      const deptId = config.department;
      if (deptId) {
        cxoByDepartment.set(deptId, config);
      }
    }
  }

  // 统计每个部门的非 CXO 成员数量
  const departmentMembers = new Map(); // departmentId -> [memberIds]

  for (const config of allConfigs) {
    if ((config.status || 'active') === 'terminated') continue;
    if (config.level === 'c_level') continue;

    // 获取员工所属的所有部门
    const agentDepts = Array.isArray(config.departments) && config.departments.length > 0
      ? config.departments
      : (config.department ? [config.department] : []);

    for (const deptId of agentDepts) {
      if (!departmentMembers.has(deptId)) {
        departmentMembers.set(deptId, []);
      }
      departmentMembers.get(deptId).push(config.id);
    }
  }

  // 为每个有 CXO 且有下属的部门生成群聊信息
  for (const [departmentId, cxoConfig] of cxoByDepartment) {
    const members = departmentMembers.get(departmentId) || [];
    if (members.length === 0) continue; // 没有下属的部门不创建群聊

    const groupId = getDepartmentGroupId(departmentId);
    const deptInfo = DEPARTMENTS[departmentId.toUpperCase()] || { name: departmentId };
    const name = `${cxoConfig.name}团队`;
    const participants = getDepartmentMembers(departmentId, cxoConfig.id);

    groups.push({
      groupId,
      departmentId,
      ownerId: cxoConfig.id,
      name,
      participants,
    });
  }

  return groups;
}

module.exports = {
  setWebContents,
  getDepartmentGroupId,
  getAgentDepartmentInfo,
  getDepartmentMembers,
  ensureDepartmentGroup,
  addMemberToGroup,
  removeMemberFromGroup,
  postToDepartment,
  renameDepartmentGroup,
  getAllDepartmentGroups,
};
