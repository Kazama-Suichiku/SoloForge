/**
 * SoloForge - 历史消息工具
 * 让 Agent 可以主动翻阅历史消息
 * @module tools/history-tool
 */

const { toolRegistry } = require('./tool-registry');
const { historyManager, PAGE_SIZE } = require('../chat/history-manager');
const { logger } = require('../utils/logger');

/**
 * 存储当前对话的完整历史（由 ChatManager 在处理消息时设置）
 * @type {Map<string, Array<{role: string, content: string, senderId?: string}>>}
 */
const conversationHistories = new Map();

/**
 * 设置对话历史（供 ChatManager 调用）
 * @param {string} conversationId
 * @param {Array} history
 */
function setConversationHistory(conversationId, history) {
  conversationHistories.set(conversationId, history);
}

/**
 * 获取对话历史
 * @param {string} conversationId
 * @returns {Array<{role: string, content: string, senderId?: string}>|undefined}
 */
function getConversationHistory(conversationId) {
  return conversationHistories.get(conversationId);
}

/**
 * 清除对话历史
 * @param {string} conversationId
 */
function clearConversationHistory(conversationId) {
  conversationHistories.delete(conversationId);
}

/**
 * 加载历史消息工具
 */
const loadHistoryTool = {
  name: 'load_history',
  description: `加载更早的历史消息。默认只显示最近 ${PAGE_SIZE} 条消息，使用此工具可以查看更早的消息。
  
使用场景：
- 用户提到"之前说过"、"上次讨论"等需要回顾历史的情况
- 需要了解讨论的完整上下文
- 查找之前的决策或结论`,
  category: 'chat',
  parameters: {
    page: {
      type: 'number',
      description: `要加载的页码。1 = 第二新的一页（跳过当前已显示的最新页），2 = 第三新的一页，以此类推。每页 ${PAGE_SIZE} 条消息。`,
      required: true,
    },
    conversation_id: {
      type: 'string',
      description: '对话 ID（通常由系统自动提供）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { page, conversation_id } = args;
    const conversationId = conversation_id || context.conversationId;

    if (!conversationId) {
      throw new Error('无法确定对话 ID');
    }

    const fullHistory = conversationHistories.get(conversationId);
    if (!fullHistory || fullHistory.length === 0) {
      return {
        success: false,
        error: '没有找到历史消息',
      };
    }

    const pageData = historyManager.loadHistoryPage(fullHistory, page);

    if (pageData.error) {
      return {
        success: false,
        error: pageData.error,
      };
    }

    // 格式化消息
    const formattedMessages = historyManager.formatMessagesForAgent(
      pageData.messages,
      { showSender: true }
    );

    logger.info('加载历史消息', {
      conversationId,
      page,
      messageCount: pageData.messages.length,
    });

    return {
      success: true,
      page: pageData.pageIndex,
      messageCount: pageData.messageCount,
      hasMoreHistory: pageData.hasMoreHistory,
      messages: formattedMessages,
      hint: pageData.hasMoreHistory
        ? `还有更早的历史，可以使用 load_history 工具加载第 ${page + 1} 页`
        : '这是最早的历史了',
    };
  },
};

/**
 * 获取历史信息工具
 */
const historyInfoTool = {
  name: 'history_info',
  description: '获取当前对话的历史消息统计信息，包括总消息数、页数等。',
  category: 'chat',
  parameters: {
    conversation_id: {
      type: 'string',
      description: '对话 ID（通常由系统自动提供）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const conversationId = args.conversation_id || context.conversationId;

    if (!conversationId) {
      throw new Error('无法确定对话 ID');
    }

    const fullHistory = conversationHistories.get(conversationId);
    if (!fullHistory) {
      return {
        totalMessages: 0,
        totalPages: 0,
        currentlyShown: 0,
        hasHiddenHistory: false,
      };
    }

    const totalMessages = fullHistory.length;
    const totalPages = Math.ceil(totalMessages / PAGE_SIZE);
    const currentlyShown = Math.min(PAGE_SIZE, totalMessages);

    return {
      totalMessages,
      totalPages,
      currentlyShown,
      hasHiddenHistory: totalMessages > PAGE_SIZE,
      hiddenMessages: Math.max(0, totalMessages - PAGE_SIZE),
      pageSize: PAGE_SIZE,
    };
  },
};

/**
 * 注册历史工具
 */
function registerHistoryTools() {
  toolRegistry.register(loadHistoryTool);
  toolRegistry.register(historyInfoTool);
}

module.exports = {
  loadHistoryTool,
  historyInfoTool,
  registerHistoryTools,
  setConversationHistory,
  getConversationHistory,
  clearConversationHistory,
  conversationHistories,
};
