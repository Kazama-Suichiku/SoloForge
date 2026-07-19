/**
 * SoloForge - 聊天 Agent 纯业务逻辑
 * 从 useChatAgent 抽出的纯函数集合，不依赖 React、不依赖 IPC、不依赖 window。
 * 所有函数均为纯函数（相同输入 → 相同输出，无副作用），可独立单测。
 * @module hooks/chat-agent-logic
 */

/**
 * 部门群聊冷却时间（与后端同步，防止重复触发）
 * @type {number}
 */
export const DEPT_COOLDOWN_MS = 30 * 1000; // 30秒

/**
 * 群聊连锁回复最大轮数
 * @type {number}
 */
export const MAX_CHAIN_ROUNDS = 5;

/**
 * 从文本中提取 @mention 的 Agent ID
 * 支持 @agentId 和 @人名 两种格式
 * @param {string} text - 文本内容
 * @param {string[]} validAgentIds - 有效的 Agent ID 列表
 * @param {Map<string,string>} [nameToIdMap] - 人名→ID 映射（用于识别 @人名）
 * @returns {string[]} 去重后的被 @ 的 Agent ID 列表
 */
export function extractMentions(text, validAgentIds, nameToIdMap) {
  if (!text) return [];
  const mentioned = new Set();

  // 1. 检测 @agentId 格式
  for (const id of validAgentIds) {
    if (text.includes(`@${id}`)) {
      mentioned.add(id);
    }
  }

  // 2. 检测 @人名 格式（如果提供了映射）
  if (nameToIdMap) {
    for (const [name, id] of nameToIdMap.entries()) {
      if (text.includes(`@${name}`)) {
        mentioned.add(id);
      }
    }
  }

  return [...mentioned];
}

/**
 * 构建 Agent ID ↔ 人名 的双向映射
 * @param {string[]} agentIds - Agent ID 列表
 * @param {Map<string, {name?: string}>} agentsMap - agentId → agent 信息
 * @returns {{ idToName: Map<string,string>, nameToId: Map<string,string> }}
 */
export function buildIdNameMaps(agentIds, agentsMap) {
  const idToName = new Map(); // agentId → 人名
  const nameToId = new Map(); // 人名 → agentId
  for (const id of agentIds) {
    const agent = agentsMap.get(id);
    const name = agent?.name || id;
    idToName.set(id, name);
    nameToId.set(name, id);
  }
  return { idToName, nameToId };
}

/**
 * 构建群聊参与者列表（人名格式，含 title）
 * @param {string[]} agentIds - Agent ID 列表
 * @param {Map<string, {name?: string, title?: string}>} agentsMap - agent 信息
 * @param {Map<string,string>} idToName - agentId → 人名
 * @returns {string} 多行文本，每行 "  - 人名（职位）"
 */
export function buildParticipantsList(agentIds, agentsMap, idToName) {
  return agentIds
    .map((id) => {
      const agent = agentsMap.get(id);
      const name = idToName.get(id);
      const title = agent?.title || '';
      return `  - ${name}${title ? `（${title}）` : ''}`;
    })
    .join('\n');
}

/**
 * 构建部门群聊额外规则文本
 * @param {boolean} isDepartmentChat - 是否部门群聊
 * @returns {string}
 */
export function buildDepartmentRules(isDepartmentChat) {
  if (!isDepartmentChat) return '';
  return `
7. 这是部门工作群，主要用于工作进度汇报和项目讨论。
8. 发言要简洁专业，聚焦工作相关内容。
9. 如果需要汇报进度，请使用 post_to_department 工具而不是直接发消息。
10. 老板能看到所有消息，请保持专业态度。
`;
}

/**
 * 构建通用群聊规则（不含身份信息，身份信息在每个 Agent 的消息中单独注入）
 * @param {object} params
 * @param {string} params.groupTypeLabel - 群类型标签（"部门工作群" 或 "群聊"）
 * @param {string} params.conversationName - 群聊名称
 * @param {string} params.participantsList - 参与者列表文本
 * @param {boolean} params.isDepartmentChat - 是否部门群聊
 * @param {string} params.firstAgentMention - 第一个 Agent 的 @ 人名（用于规则示例）
 * @returns {string}
 */
export function buildGroupRules({
  groupTypeLabel,
  conversationName,
  participantsList,
  isDepartmentChat,
  firstAgentMention,
}) {
  const departmentRules = buildDepartmentRules(isDepartmentChat);
  return `[${groupTypeLabel}: ${conversationName}]

【群内成员】
${participantsList}

【群聊规则 - 必须严格遵守】
0. 你已经被点名发言了（系统只会把消息发给被 @ 的人），请直接回复。
1. 禁止使用 send_to_agent 联系群内成员！群里所有人都能看到你的发言，直接说即可。需要其他成员回应时，用 @人名 的格式（如 @${firstAgentMention}）。只有联系群外人员才可用 send_to_agent。
2. 提到其他群成员时，必须使用 @人名，不要使用 @ID 格式。绝对禁止 @你自己——你不能点名自己。
3. 发言前务必仔细阅读上方所有人的发言内容。如果别人已经提出了某个观点或方案，你不要重复提出类似的内容。
4. 你应该基于他人已有的发言进行补充、提出不同角度、指出潜在问题、或表示认同并补充细节。避免"各说各话"。
5. 只从你自己的专业领域角度发言。不要越界分析其他部门的专业问题。
6. 如果前面已有人充分阐述了与你观点一致的内容，简要表示认同并补充你的专业视角即可，不必重复长篇论述。
${departmentRules}`;
}

/**
 * 构建个性化身份提醒（注入到每个 Agent 的消息开头）
 * @param {string} agentName - Agent 的人名
 * @returns {string}
 */
export function buildIdentityReminder(agentName) {
  return `【你的身份提醒】你是「${agentName}」。你在这个群聊中被点名了，请直接发言。记住：不要 @${agentName}（那是你自己）。\n\n`;
}

/**
 * 从消息列表构建对话历史（排除已删除消息，只保留最近 20 条）
 * @param {Array<{deleted?: boolean, senderType: string, senderId: string, content: string}>} messages
 * @param {Map<string,string>} [idToName] - agentId → 人名（群聊时用于给 agent 消息加 [人名]: 前缀）
 * @returns {Array<{role: string, content: string}>}
 */
export function buildHistoryFromMessages(messages, idToName) {
  if (!messages) return [];
  return messages
    .filter((m) => !m.deleted)
    .slice(-20)
    .map((m) => ({
      role: m.senderType === 'user' ? 'user' : 'assistant',
      content:
        m.senderType === 'agent'
          ? `[${(idToName && idToName.get(m.senderId)) || m.senderId}]: ${m.content}`
          : m.content,
    }));
}

/**
 * 从消息列表中查找指定 Agent 最近一条 agent 消息
 * @param {Array<{senderId: string, senderType: string, content?: string}>} messages
 * @param {string} targetAgent - 目标 Agent ID
 * @returns {{ content?: string } | undefined}
 */
export function findLatestAgentReply(messages, targetAgent) {
  if (!messages) return undefined;
  return [...messages]
    .reverse()
    .find((m) => m.senderId === targetAgent && m.senderType === 'agent');
}

/**
 * 从 Agent 回复中提取新的 @ 提及，过滤掉已回复过和自己的
 * @param {string} replyContent - Agent 回复内容
 * @param {string[]} agentIds - 群内所有 Agent ID
 * @param {Map<string,string>} nameToId - 人名 → agentId
 * @param {Set<string>} repliedAgents - 已回复的 Agent 集合
 * @param {string} targetAgent - 当前 Agent ID（排除自己）
 * @returns {string[]} 新的被 @ 的 Agent ID 列表
 */
export function filterNewMentions(
  replyContent,
  agentIds,
  nameToId,
  repliedAgents,
  targetAgent
) {
  return extractMentions(replyContent, agentIds, nameToId).filter(
    (id) => !repliedAgents.has(id) && id !== targetAgent
  );
}

/**
 * 按 Agent 层级排序（level 小的先发言）
 * @param {string[]} agentIds - 待排序的 Agent ID 列表
 * @param {Map<string, {level?: number}>} agentsMap - agent 信息
 * @returns {Array<{id: string, level: number}>} 排序后的 { id, level } 列表
 */
export function sortByLevel(agentIds, agentsMap) {
  return agentIds
    .map((id) => ({ id, level: agentsMap.get(id)?.level ?? 99 }))
    .sort((a, b) => a.level - b.level);
}

/**
 * 清理消息内容开头的 [role]: 或 [role-id]: 前缀
 * 支持两种正则：`^\[(\w+)\]:\s*`（原 sendToSingleAgent 用）和 `^\[[\w-]+\]:\s*`（onComplete 用，支持 ID 含连字符）
 * 这里统一使用更宽松的 `^\[[\w-]+\]:\s*` 以同时兼容两种情况。
 * @param {string} content - 原始内容
 * @returns {string} 清理后的内容（若无前缀则原样返回）
 */
export function cleanContentPrefix(content) {
  if (!content) return content;
  const prefixMatch = content.match(/^\[[\w-]+\]:\s*/);
  if (prefixMatch) {
    return content.slice(prefixMatch[0].length);
  }
  return content;
}

/**
 * 从附件列表中过滤出图片附件
 * @param {Array<{type: string}>} attachments - 附件列表
 * @returns {Array} 图片附件列表（可能为空数组）
 */
export function filterImageAttachments(attachments) {
  if (!attachments) return [];
  return attachments.filter((a) => a.type === 'image');
}

/**
 * 检查 Agent 是否在部门群聊冷却中（纯函数，时间由参数传入）
 * @param {Map<string, number>} cooldownMap - key: `${conversationId}:${agentId}`, value: 上次触发时间戳
 * @param {string} conversationId - 对话 ID
 * @param {string} agentId - Agent ID
 * @param {number} [now=Date.now()] - 当前时间戳
 * @param {number} [cooldownMs=DEPT_COOLDOWN_MS] - 冷却时长
 * @returns {boolean} true 表示在冷却中
 */
export function isAgentInDeptCooldown(
  cooldownMap,
  conversationId,
  agentId,
  now = Date.now(),
  cooldownMs = DEPT_COOLDOWN_MS
) {
  const key = `${conversationId}:${agentId}`;
  const lastTime = cooldownMap.get(key);
  if (!lastTime) return false;
  return now - lastTime < cooldownMs;
}

/**
 * 记录 Agent 在部门群聊的触发时间（返回新 Map，不修改原 Map）
 * @param {Map<string, number>} cooldownMap - 原 Map
 * @param {string} conversationId - 对话 ID
 * @param {string} agentId - Agent ID
 * @param {number} [now=Date.now()] - 当前时间戳
 * @returns {Map<string, number>} 新的 Map（含本次记录）
 */
export function recordDeptTrigger(cooldownMap, conversationId, agentId, now = Date.now()) {
  const next = new Map(cooldownMap);
  const key = `${conversationId}:${agentId}`;
  next.set(key, now);
  return next;
}

/**
 * 过滤出有效的部门群聊 @ 提及（必须是群成员、不是发送者、不在冷却中）
 * @param {string[]} mentions - 被 @ 的 Agent ID 列表
 * @param {string} senderId - 发送者 ID
 * @param {string[]} participants - 群成员列表
 * @param {(agentId: string) => boolean} isCooldown - 判断是否在冷却中的函数
 * @returns {string[]} 有效的 @ 提及列表
 */
export function filterValidDeptMentions(mentions, senderId, participants, isCooldown) {
  return mentions.filter((id) => {
    if (id === senderId) return false;
    if (!participants.includes(id)) return false;
    if (isCooldown(id)) return false;
    return true;
  });
}

/**
 * 构造部门群聊触发回复的内容（确保包含 @ID 格式以便 extractMentions 识别）
 * @param {string} senderName - 发送者人名
 * @param {string} content - 原始消息内容
 * @param {string[]} validMentions - 有效的被 @ 的 Agent ID 列表
 * @returns {string} 例如：`[发送者]: 原始内容\n\n（被点名的同事：@agent1 @agent2）`
 */
export function buildDeptTriggerContent(senderName, content, validMentions) {
  const mentionTags = validMentions.map((id) => `@${id}`).join(' ');
  return `[${senderName}]: ${content}\n\n（被点名的同事：${mentionTags}）`;
}

/**
 * 判断是否应停止群聊连锁（中断标记已设置）
 * @param {boolean} abortFlag - 中断标记
 * @returns {boolean}
 */
export function shouldStopChain(abortFlag) {
  return abortFlag === true;
}

/**
 * 判断是否达到最大连锁轮数
 * @param {number} round - 当前轮数
 * @param {number} [maxRounds=MAX_CHAIN_ROUNDS] - 最大轮数
 * @returns {boolean}
 */
export function isMaxRoundsReached(round, maxRounds = MAX_CHAIN_ROUNDS) {
  return round >= maxRounds;
}

export default {
  DEPT_COOLDOWN_MS,
  MAX_CHAIN_ROUNDS,
  extractMentions,
  buildIdNameMaps,
  buildParticipantsList,
  buildDepartmentRules,
  buildGroupRules,
  buildIdentityReminder,
  buildHistoryFromMessages,
  findLatestAgentReply,
  filterNewMentions,
  sortByLevel,
  cleanContentPrefix,
  filterImageAttachments,
  isAgentInDeptCooldown,
  recordDeptTrigger,
  filterValidDeptMentions,
  buildDeptTriggerContent,
  shouldStopChain,
  isMaxRoundsReached,
};
