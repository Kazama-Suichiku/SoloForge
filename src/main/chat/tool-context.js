/**
 * SoloForge - 工具与上下文相关辅助函数
 *
 * 原先位于 chat-manager.js 的以下方法，抽出为独立模块：
 *   - _getPermissionContext
 *   - getToolDefinitionsForAgent / getToolsForAgent
 *   - getPaginatedHistory
 *   - _getTurnReminder
 *   - _cleanHistoryForLLM
 *   - _getRecentCommunicationContext
 *
 * @module chat/tool-context
 */

const { logger } = require('../utils/logger');
const { toolRegistry } = require('../tools/tool-registry');
const { permissionStore } = require('../config/permission-store');
const { agentConfigStore } = require('../config/agent-config-store');
const { historyManager, PAGE_SIZE } = require('./history-manager');
const { setConversationHistory } = require('../tools/history-tool');
const { estimateTokens, estimateMessages, getAvailableBudget } = require('../llm/token-estimator');

/**
 * 生成当前权限的上下文描述，注入到工具提示中
 */
function getPermissionContext() {
  const perms = permissionStore.get();
  const lines = ['【当前权限与可访问路径】'];

  const paths = perms.files?.allowedPaths ?? [];
  if (paths.length > 0) {
    lines.push(`- 可访问目录（文件操作必须在这些目录之下）：`);
    for (const p of paths) {
      lines.push(`  • ${p}`);
    }
    lines.push(`- 文件写入：${perms.files?.writeEnabled ? '已启用' : '未启用'}`);
  } else {
    lines.push('- 文件访问：用户尚未配置任何可访问目录。请提醒用户在 SoloForge 设置中添加项目目录。');
  }

  lines.push(`- Shell 命令：${perms.shell?.enabled ? '已启用' : '未启用'}`);
  lines.push(`- Git 操作：${perms.git?.enabled ? '已启用' : '未启用'}`);
  lines.push(`- 网络搜索：${perms.network?.searchEnabled ? '已启用' : '未启用'}`);

  lines.push('');
  lines.push('重要：使用 list_files、read_file、write_file 工具时，path 参数必须是上述"可访问目录"下的绝对路径，否则会被权限系统拒绝。');

  return lines.join('\n');
}

/**
 * 获取 Agent 可用的原始工具定义列表（用于传递给 LLM Provider 的原生工具调用）
 * @param {Object} chatManager
 * @param {string} agentId
 */
function getToolDefinitionsForAgent(chatManager, agentId) {
  const allTools = toolRegistry.getAll();
  const agent = chatManager.getAgent(agentId);
  const agentConfig = agentConfigStore.get(agentId);

  const agentStatus = agentConfig?.status || 'active';
  if (agentStatus === 'suspended' || agentStatus === 'terminated') {
    return [];
  }

  let availableTools = allTools;
  const role = agent?.role || agentConfig?.role;
  const level = agentConfig?.level;

  if (role !== 'cfo') {
    availableTools = availableTools.filter((t) => t.category !== 'cfo');
  }
  if (role !== 'chro') {
    availableTools = availableTools.filter((t) => t.category !== 'hr');
  }
  const cxoRoles = ['ceo', 'cto', 'cfo'];
  const isCxo = cxoRoles.includes(role) || level === 'c_level';
  if (!isCxo && role !== 'chro') {
    availableTools = availableTools.filter((t) => t.category !== 'recruit');
  }
  if (role !== 'secretary') {
    availableTools = availableTools.filter((t) => t.category !== 'dismiss_confirm');
  }
  const isLeader = isCxo || ['manager', 'director', 'vp'].includes(level);
  if (!isLeader) {
    availableTools = availableTools.filter((t) => t.category !== 'dev_plan_review');
  }
  if (!isCxo && role !== 'chro') {
    availableTools = availableTools.filter((t) => t.category !== 'suspension');
  }
  if (role !== 'secretary' && !isCxo && role !== 'chro') {
    availableTools = availableTools.filter((t) => t.category !== 'group_chat');
  }

  return availableTools;
}

/**
 * 获取 Agent 可用的工具描述（XML Schema 格式，用于注入 prompt）
 */
function getToolsForAgent(chatManager, agentId) {
  const availableTools = getToolDefinitionsForAgent(chatManager, agentId);
  if (availableTools.length === 0) {
    return '';
  }
  return toolRegistry.getToolCallSchema(availableTools);
}

/**
 * 获取分页优化后的历史消息
 * 支持两种模式：
 *   1. Token 预算模式（传 model + contextualMessage）—— 动态裁剪
 *   2. 固定条数模式（不传 model）—— 向后兼容
 */
function getPaginatedHistory(fullHistory, conversationId, budgetParams) {
  setConversationHistory(conversationId, fullHistory);

  let tokenBudget;
  if (budgetParams?.model && budgetParams?.systemPrompt) {
    const systemPromptTokens = estimateTokens(budgetParams.systemPrompt);
    const userMessageTokens = estimateTokens(budgetParams.contextualMessage || '');
    tokenBudget = getAvailableBudget({
      model: budgetParams.model,
      systemPromptTokens,
      userMessageTokens,
    });
    logger.debug('getPaginatedHistory: token 预算模式', {
      model: budgetParams.model,
      systemPromptTokens,
      userMessageTokens,
      tokenBudget,
    });
  }

  const optimized = historyManager.getOptimizedHistory(
    fullHistory,
    conversationId,
    { recentCount: PAGE_SIZE, tokenBudget, includeSummary: true }
  );

  return {
    paginatedHistory: optimized.messages,
    historyInfo: optimized.historyInfo,
    hasMoreHistory: optimized.hasMoreHistory,
    totalMessages: optimized.totalMessages,
    shownMessages: optimized.shownMessages,
  };
}

/**
 * 每轮用户消息前的行动提醒
 * 放在 user message 正前方，处于 LLM 注意力最集中的位置
 */
function getTurnReminder() {
  return `【本轮行动提醒】
这是一条新消息，请认真阅读用户的最新消息并直接回应。
- 如果历史对话中已有相关信息（如之前已询问过同事并得到回复），请直接引用那些结果，不要重复调用工具
- 只有当你需要获取新的、历史中没有的信息时，才调用工具
- 不要说"我已经做了"来指代本轮没做的事，但可以引用历史中已有的工具返回结果`;
}

/**
 * 清洗历史消息，去除工具调用标记和中间产物
 * 避免 LLM 把历史中的工具调用误认为当前轮次已完成的操作
 */
function cleanHistoryForLLM(history) {
  if (!history || history.length === 0) return history;

  return history.map((msg) => {
    if (!msg.content || typeof msg.content !== 'string') return msg;

    let cleaned = msg.content;

    cleaned = cleaned.replace(/_正在查询:.*?\.{3}_/g, '');
    cleaned = cleaned.replace(/正在查询:.*?\.{3}/g, '');
    cleaned = cleaned.replace(/（已达到最大工具调用次数）/g, '');
    cleaned = cleaned.replace(/_?（任务已被终止[^）]*）_?/g, '');

    // 去除 tool_call / tool_result 块（注意：伪标签书写避免被本文件误识别）
    cleaned = cleaned.replace(/<tool_call[\s\S]*?<\/tool_call>/g, '');
    cleaned = cleaned.replace(/<tool_result[\s\S]*?<\/tool_result>/g, '');

    cleaned = cleaned.replace(/工具执行结果：[\s\S]*$/g, '');

    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    if (!cleaned) {
      cleaned = msg.role === 'assistant' ? '（之前的回复）' : '（之前的消息）';
    }

    return { ...msg, content: cleaned };
  });
}

/**
 * 获取 Agent 最近的内部通信记录，注入到对话上下文中
 */
function getRecentCommunicationContext(agentId) {
  const RECENT_COUNT = 5;

  try {
    const { agentCommunication } = require('../collaboration/agent-communication');

    const allMessages = agentCommunication.getMessages(agentId, { limit: 200 });
    const responded = allMessages.filter((m) => m.status === 'responded');

    if (responded.length === 0) return null;

    const totalCount = responded.length;
    const recentPage = responded.slice(-RECENT_COUNT);

    const lines = [];

    if (totalCount > RECENT_COUNT) {
      lines.push(
        `【内部通信记录】共 ${totalCount} 条，当前显示最近 ${recentPage.length} 条。` +
          `如需查看更早记录，请使用 browse_communication_history 工具翻页查询。`
      );
    } else {
      lines.push(`【内部通信记录】共 ${totalCount} 条：`);
    }
    lines.push('');

    for (let i = 0; i < recentPage.length; i++) {
      const msg = recentPage[i];
      const idx = totalCount - recentPage.length + i + 1;
      const time = new Date(msg.timestamp).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const peerAgent = msg.fromAgent === agentId ? msg.toAgent : msg.fromAgent;
      const direction = msg.fromAgent === agentId ? `你 → ${peerAgent}` : `${peerAgent} → 你`;

      const msgText =
        msg.message?.length > 120 ? msg.message.slice(0, 120) + '...' : msg.message || '';
      const respText =
        msg.response?.length > 200 ? msg.response.slice(0, 200) + '...' : msg.response || '';

      lines.push(`#${idx} [${time}] ${direction}`);
      lines.push(`  消息: ${msgText}`);
      if (respText) {
        lines.push(`  回复: ${respText}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  } catch (error) {
    logger.debug('获取内部通信上下文失败:', error.message);
    return null;
  }
}

module.exports = {
  getPermissionContext,
  getToolDefinitionsForAgent,
  getToolsForAgent,
  getPaginatedHistory,
  getTurnReminder,
  cleanHistoryForLLM,
  getRecentCommunicationContext,
};
