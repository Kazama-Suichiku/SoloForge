/**
 * SoloForge Mobile - 历史消息工具
 * 让 Agent 可以主动翻阅历史消息
 * @module core/tools/history-tools
 */

const { toolRegistry } = require('./tool-registry');
const { logger } = require('../../utils/logger');

const PAGE_SIZE = 50;

function getChatManager() {
  return require('../chat').chatManager;
}

function formatMessagesForAgent(messages, options = {}) {
  const { showSender = true } = options;
  return messages
    .map((msg, index) => {
      const parts = [`[${index + 1}]`];
      if (showSender && msg.agentName) {
        parts.push(`${msg.agentName}:`);
      } else {
        parts.push(`${msg.role}:`);
      }
      parts.push(msg.content);
      return parts.join(' ');
    })
    .join('\n\n');
}

function paginateHistory(fullHistory, page) {
  const totalMessages = fullHistory.length;
  const totalPages = Math.ceil(totalMessages / PAGE_SIZE);
  if (totalMessages === 0) {
    return {
      pageIndex: page,
      messages: [],
      hasMoreHistory: false,
      messageCount: 0,
    };
  }
  if (page >= totalPages) {
    return {
      pageIndex: page,
      messages: [],
      hasMoreHistory: true,
      messageCount: 0,
      error: '已经是最早的历史了',
    };
  }
  const endIndex = totalMessages - page * PAGE_SIZE;
  const startIndex = Math.max(0, endIndex - PAGE_SIZE);
  const messages = fullHistory.slice(startIndex, endIndex);
  return {
    pageIndex: page,
    messages,
    hasMoreHistory: startIndex > 0,
    messageCount: messages.length,
  };
}

const loadHistoryTool = {
  name: 'load_history',
  description: `加载更早的历史消息。默认只显示最近 ${PAGE_SIZE} 条消息，使用此工具可以查看更早的消息。
使用场景：用户提到"之前说过"、"上次讨论"等需要回顾历史的情况；需要了解讨论的完整上下文；查找之前的决策或结论。`,
  category: 'chat',
  parameters: {
    page: {
      type: 'number',
      description: `要加载的页码。1 = 第二新的一页，2 = 第三新的一页。每页 ${PAGE_SIZE} 条消息。`,
      required: true,
    },
    conversation_id: {
      type: 'string',
      description: '对话 ID（通常由系统自动提供）',
      required: false,
    },
  },
  async execute(args, context) {
    const { page, conversation_id } = args;
    const conversationId = conversation_id || context.conversationId;

    if (!conversationId) {
      return { success: false, error: '无法确定对话 ID' };
    }

    const chatManager = getChatManager();
    const fullHistory = chatManager.getHistory(conversationId);

    if (!fullHistory || fullHistory.length === 0) {
      return { success: false, error: '没有找到历史消息' };
    }

    const pageData = paginateHistory(fullHistory, page);

    if (pageData.error) {
      return { success: false, error: pageData.error };
    }

    const formattedMessages = formatMessagesForAgent(pageData.messages, { showSender: true });

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
  async execute(args, context) {
    const conversationId = args.conversation_id || context.conversationId;

    if (!conversationId) {
      return { success: false, error: '无法确定对话 ID' };
    }

    const chatManager = getChatManager();
    const fullHistory = chatManager.getHistory(conversationId);

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

function registerHistoryTools() {
  toolRegistry.register(loadHistoryTool);
  toolRegistry.register(historyInfoTool);
  logger.info('历史消息工具已注册');
}

module.exports = {
  loadHistoryTool,
  historyInfoTool,
  registerHistoryTools,
  PAGE_SIZE,
};
