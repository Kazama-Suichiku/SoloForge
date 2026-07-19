/**
 * SoloForge - 聊天 Agent 管理器（聚合入口）
 *
 * 本文件是拆分后的聚合入口。原先 2330 行的上帝对象已按职责拆分为：
 *   - tool-editor.js     — initToolExecutor + 3 个审批事件管线 + 启动扫描
 *   - stream-handler.js   — 流式缓冲（过滤 tool_call/thinking 标签）
 *   - tool-loop.js        — 统一的工具循环执行器（合并原两份 _chatWithToolLoop）
 *   - agent-lifecycle.js  — 任务追踪 + 主动推送队列
 *   - tool-context.js     — 权限/工具/历史/行动提醒等上下文辅助
 *
 * 拆分原则：
 *   1. 对外导出接口（ChatManager 类 + chatManager 单例的所有公共方法）完全不变
 *   2. 外部调用方（main、chat-ipc-handlers、agents、collaboration 等）不需修改
 *   3. 模块间依赖单向：chat-manager → 子模块；子模块不反向 require chat-manager
 *      （需要 chatManager 引用的子模块通过参数传入）
 *
 * @module chat/chat-manager
 */

const { SecretaryAgent } = require('./secretary-agent');
const { CEOAgent, CTOAgent, CFOAgent } = require('./cxo-agents');
const { CHROAgent } = require('./chro-agent');
const { logger } = require('../utils/logger');
const { agentConfigStore, AGENT_STATUS } = require('../config/agent-config-store');

// 拆分后的子模块
const { initToolExecutor } = require('./tool-editor');
// 工具循环执行器（P1-5 收敛：统一使用 agents/tool-loop-runner，原 chat/tool-loop.js 已删除）
const { runToolLoop } = require('../agents/tool-loop-runner');
const {
  startTask,
  finishTask,
  abortTask,
  abortAgentTask,
  getActiveTasksList,
  pushProactiveMessage,
  sendProactiveMessage,
} = require('./agent-lifecycle');
const {
  getPermissionContext,
  getToolDefinitionsForAgent,
  getToolsForAgent,
  getPaginatedHistory,
  getTurnReminder,
  cleanHistoryForLLM,
  getRecentCommunicationContext,
} = require('./tool-context');

// 延迟加载记忆系统，避免循环依赖
let _memoryManager = null;
function getMemoryManager() {
  if (!_memoryManager) {
    try {
      const { memoryManager } = require('../memory');
      _memoryManager = memoryManager;
    } catch (e) {
      // 记忆系统可能尚未初始化
    }
  }
  return _memoryManager;
}

/**
 * 聊天 Agent 管理器
 */
class ChatManager {
  constructor() {
    /** @type {Map<string, import('./chat-agent').ChatAgent>} */
    this.agents = new Map();
    this.llmManager = null;
    this.webContents = null;
    this.toolExecutor = null;

    /**
     * 活跃任务追踪
     * key: agentId, value: { agentId, agentName, conversationId, messageId, task, startTime, stage, abortController }
     * @type {Map<string, Object>}
     */
    this.activeTasks = new Map();

    /**
     * 主动推送消息队列
     * key: agentId, value: Array<{ content: string, timestamp: number }>
     * @type {Map<string, Array>}
     */
    this._proactiveQueue = new Map();

    // 初始化默认 Agent
    this._initDefaultAgents();
  }

  // ─────────────────────────────────────────────────────────────
  // 初始化
  // ─────────────────────────────────────────────────────────────

  /**
   * 初始化工具执行器与所有审批事件管线（委托给 tool-editor.js）
   */
  initToolExecutor() {
    initToolExecutor(this);
  }

  /**
   * 初始化默认 Agent
   */
  _initDefaultAgents() {
    const secretary = new SecretaryAgent();
    const ceo = new CEOAgent();
    const cto = new CTOAgent();
    const cfo = new CFOAgent();
    const chro = new CHROAgent();

    this.agents.set(secretary.id, secretary);
    this.agents.set(ceo.id, ceo);
    this.agents.set(cto.id, cto);
    this.agents.set(cfo.id, cfo);
    this.agents.set(chro.id, chro);
  }

  /**
   * 重新初始化（公司切换时调用）
   */
  reinitialize() {
    for (const agentId of this.activeTasks.keys()) {
      this._abortTask(agentId, '公司切换');
    }
    this._proactiveQueue.clear();
    this.agents.clear();
    this._initDefaultAgents();

    if (this.llmManager) {
      this.setLLMManager(this.llmManager);
    }

    logger.info('ChatManager: 已重新初始化');
  }

  /**
   * 设置 LLM Manager
   */
  setLLMManager(llmManager) {
    this.llmManager = llmManager;
    for (const agent of this.agents.values()) {
      agent.setLLMManager(llmManager);
    }
  }

  /**
   * 设置 webContents（用于流式推送）
   */
  setWebContents(webContents) {
    this.webContents = webContents;
  }

  /**
   * 设置工具确认回调
   */
  setToolConfirmCallback(callback) {
    if (this.toolExecutor) {
      this.toolExecutor.setConfirmCallback(callback);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Agent 管理
  // ─────────────────────────────────────────────────────────────

  getAgent(agentId) {
    return this.agents.get(agentId) ?? null;
  }

  getAgentList() {
    return Array.from(this.agents.values()).map((a) => a.getInfo());
  }

  registerAgent(agent) {
    if (this.llmManager) {
      agent.setLLMManager(this.llmManager);
    }
    this.agents.set(agent.id, agent);
    logger.info(`注册 Agent: ${agent.id}`, { name: agent.name });
  }

  /**
   * 注销 Agent（开除场景清理所有相关资源）
   */
  unregisterAgent(agentId, options = {}) {
    const { cleanupResources = false } = options;

    const deleted = this.agents.delete(agentId);
    if (deleted) {
      logger.info(`注销 Agent: ${agentId}`);
    }

    if (cleanupResources) {
      this._abortTask(agentId, 'Agent 已开除');

      if (this._proactiveQueue.has(agentId)) {
        this._proactiveQueue.delete(agentId);
        logger.debug(`已清理 Agent ${agentId} 的主动推送队列`);
      }

      try {
        const { agentCommunication } = require('../collaboration/agent-communication');
        agentCommunication.clearAgentQueues(agentId);
      } catch (e) {
        logger.warn('清理通信队列失败:', e.message);
      }

      try {
        const { budgetManager } = require('../budget/budget-manager');
        budgetManager.removeAgentBudget(agentId);
        logger.debug(`已清理 Agent ${agentId} 的预算配置`);
      } catch (e) {
        logger.warn('清理预算配置失败:', e.message);
      }

      try {
        const { todoStore } = require('../tools/todo-store');
        todoStore.removeAgent(agentId);
        logger.debug(`已清理 Agent ${agentId} 的 TODO 列表`);
      } catch (e) {
        logger.warn('清理 TODO 列表失败:', e.message);
      }

      logger.info(`Agent ${agentId} 相关资源已清理完毕`);
    }

    return deleted;
  }

  /**
   * 从主进程创建群聊（Agent 拉群）
   */
  createGroupFromBackend({ name, participants, creatorId, initialMessage }) {
    if (!this.webContents || this.webContents.isDestroyed()) {
      logger.warn('createGroupFromBackend: webContents 不可用');
      return { success: false, error: 'UI 未就绪，无法创建群聊' };
    }

    const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const creator = this.getAgent(creatorId);
    const creatorName = creator?.name || creatorId;

    const CHANNELS = require('../../shared/ipc-channels');
    this.webContents.send(CHANNELS.CHAT_CREATE_GROUP, {
      groupId,
      name,
      participants,
      creatorId,
      creatorName,
      initialMessage,
    });

    logger.info(`后端创建群聊: ${name} (${groupId})`, {
      creator: creatorName,
      participants,
    });

    return { success: true, groupId };
  }

  // ─────────────────────────────────────────────────────────────
  // 任务追踪与主动推送（委托给 agent-lifecycle.js）
  // ─────────────────────────────────────────────────────────────

  _startTask(agentId, info) {
    return startTask(this, agentId, info);
  }

  _updateTaskStage(agentId, stage) {
    const { updateTaskStage } = require('./agent-lifecycle');
    updateTaskStage(this, agentId, stage);
  }

  _finishTask(agentId, taskId) {
    finishTask(this, agentId, taskId);
  }

  _abortTask(agentId, reason) {
    return abortTask(this, agentId, reason);
  }

  abortAgentTask(agentId) {
    return abortAgentTask(this, agentId);
  }

  getActiveTasksList() {
    return getActiveTasksList(this);
  }

  pushProactiveMessage(agentId, content) {
    pushProactiveMessage(this, agentId, content);
  }

  _sendProactiveMessage(agentId, content, timestamp) {
    sendProactiveMessage(this, agentId, content, timestamp);
  }

  _flushProactiveQueue(agentId) {
    const { flushProactiveQueue } = require('./agent-lifecycle');
    flushProactiveQueue(this, agentId);
  }

  // ─────────────────────────────────────────────────────────────
  // 工具与上下文（委托给 tool-context.js）
  // ─────────────────────────────────────────────────────────────

  _getPermissionContext() {
    return getPermissionContext();
  }

  getToolDefinitionsForAgent(agentId) {
    return getToolDefinitionsForAgent(this, agentId);
  }

  getToolsForAgent(agentId) {
    return getToolsForAgent(this, agentId);
  }

  getPaginatedHistory(fullHistory, conversationId, budgetParams) {
    return getPaginatedHistory(fullHistory, conversationId, budgetParams);
  }

  _getTurnReminder() {
    return getTurnReminder();
  }

  _cleanHistoryForLLM(history) {
    return cleanHistoryForLLM(history);
  }

  _getRecentCommunicationContext(agentId) {
    return getRecentCommunicationContext(agentId);
  }

  // ─────────────────────────────────────────────────────────────
  // 消息处理
  // ─────────────────────────────────────────────────────────────

  /**
   * 处理聊天消息（非流式）
   */
  async handleMessage(request) {
    const { conversationId, agentId, message, history = [], attachments } = request;

    const agentConfig = agentConfigStore.get(agentId);
    if (agentConfig) {
      const agentStatus = agentConfig.status || 'active';
      if (agentStatus === AGENT_STATUS.TERMINATED) {
        return { content: `「${agentConfig.name || agentId}」已离职，无法响应消息。` };
      }
      if (agentStatus === AGENT_STATUS.SUSPENDED) {
        return { content: `「${agentConfig.name || agentId}」目前处于停职状态，无法响应消息。停职原因：${agentConfig.suspendReason || '未说明'}` };
      }
    }

    const agent = this.getAgent(agentId);
    if (!agent) {
      logger.error(`ChatManager: Agent ${agentId} 不存在`);
      return { content: `抱歉，找不到对应的员工 (${agentId})` };
    }

    if (!this.llmManager) {
      logger.error('ChatManager: LLM Manager 未设置');
      return { content: '抱歉，AI 服务暂时不可用' };
    }

    const { taskId } = this._startTask(agentId, {
      conversationId,
      task: message,
      stage: 'thinking',
    });

    try {
      logger.info(`ChatManager: ${agent.name} 处理消息`, { conversationId, message: message.slice(0, 50) });

      // 构建 contextualMessage
      let contextualMessage = message;

      const commContext = this._getRecentCommunicationContext(agentId);
      if (commContext) {
        contextualMessage = `${commContext}\n\n---\n\n${contextualMessage}`;
      }

      const mm = getMemoryManager();
      if (mm && mm._initialized) {
        try {
          const memoryContext = mm.getContextForAgent(agentId, message, conversationId);
          if (memoryContext) {
            contextualMessage = `${memoryContext}\n\n---\n\n${contextualMessage}`;
          }
        } catch (memError) {
          logger.debug('记忆注入失败（不影响对话）:', memError.message);
        }
      }

      const { paginatedHistory, historyInfo, hasMoreHistory, totalMessages, shownMessages } =
        this.getPaginatedHistory(history, conversationId, {
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          contextualMessage,
        });

      const cleanedHistory = this._cleanHistoryForLLM(paginatedHistory);

      if (historyInfo) {
        contextualMessage = `${historyInfo}\n\n---\n\n${contextualMessage}`;
      }

      logger.debug('历史分页信息', {
        conversationId,
        totalMessages,
        shownMessages,
        hasMoreHistory,
      });

      // 秘书特殊处理：只在私聊中检测是否需要委派
      const isGroupChat = message.startsWith('[群聊:');

      if (agentId === 'secretary' && agent.analyzeForDelegation && !isGroupChat) {
        const delegation = agent.analyzeForDelegation(message);

        if (delegation.shouldDelegate && delegation.delegateTo) {
          const delegateAgent = this.getAgent(delegation.delegateTo);

          if (delegateAgent) {
            logger.info(`ChatManager: 秘书委派给 ${delegateAgent.name}`, { reason: delegation.reason });

            const secretaryIntro = `好的老板，这个问题涉及${delegation.reason}，我来安排 ${delegateAgent.name} 为您处理。\n\n---\n\n`;

            const delegateResponse = await this._chatWithToolLoop(
              delegateAgent,
              contextualMessage,
              cleanedHistory,
              { conversationId }
            );

            logger.info(`ChatManager: ${delegateAgent.name} 响应完成`, { contentLength: delegateResponse.length });

            return {
              content: secretaryIntro + `**${delegateAgent.name}：**\n\n${delegateResponse}`,
              delegatedTo: delegation.delegateTo,
            };
          }
        }
      }

      // 带工具调用循环的消息处理
      const content = await this._chatWithToolLoop(
        agent,
        contextualMessage,
        cleanedHistory,
        { conversationId }
      );

      logger.info(`ChatManager: ${agent.name} 响应完成`, { contentLength: content.length });

      return { content };
    } catch (error) {
      logger.error(`ChatManager: ${agent.name} 处理失败`, error);
      return {
        content: `抱歉老板，我在处理您的请求时遇到了问题：${error.message || '未知错误'}`,
      };
    } finally {
      this._finishTask(agentId, taskId);
    }
  }

  /**
   * 处理流式聊天消息
   */
  async handleStreamMessage(request) {
    const { conversationId, agentId, message, messageId, history = [], attachments } = request;
    const CHANNELS = require('../../shared/ipc-channels');

    const streamAgentConfig = agentConfigStore.get(agentId);
    if (streamAgentConfig) {
      const agentStatus = streamAgentConfig.status || 'active';
      if (agentStatus === AGENT_STATUS.TERMINATED) {
        return { content: `「${streamAgentConfig.name || agentId}」已离职，无法响应消息。` };
      }
      if (agentStatus === AGENT_STATUS.SUSPENDED) {
        return { content: `「${streamAgentConfig.name || agentId}」目前处于停职状态，无法响应消息。停职原因：${streamAgentConfig.suspendReason || '未说明'}` };
      }
    }

    const agent = this.getAgent(agentId);
    if (!agent) {
      return { content: `抱歉，找不到对应的员工 (${agentId})` };
    }

    if (!this.llmManager) {
      return { content: '抱歉，AI 服务暂时不可用' };
    }

    // 注册活跃任务并获取 AbortController
    const { taskId, abortController } = this._startTask(agentId, {
      conversationId,
      messageId,
      task: message,
      stage: 'thinking',
    });
    const signal = abortController.signal;

    try {
      let contextualMessage = message;

      const commContext = this._getRecentCommunicationContext(agentId);
      if (commContext) {
        contextualMessage = `${commContext}\n\n---\n\n${contextualMessage}`;
      }

      const mm = getMemoryManager();
      if (mm && mm._initialized) {
        try {
          const memoryContext = mm.getContextForAgent(agentId, message, conversationId);
          if (memoryContext) {
            contextualMessage = `${memoryContext}\n\n---\n\n${contextualMessage}`;
          }
          mm.onNewMessage(conversationId, agentId, history.slice(-10));
        } catch (memError) {
          logger.debug('记忆注入失败（不影响对话）:', memError.message);
        }
      }

      // 注入暂存区上下文（工作状态恢复）
      try {
        const { scratchpadManager } = require('../context/agent-scratchpad');
        const scratchpad = scratchpadManager.get(agentId);
        if (scratchpad.hasContent()) {
          contextualMessage = `${scratchpad.getContextSummary()}\n\n---\n\n${contextualMessage}`;
        }
      } catch (scratchpadError) {
        logger.debug('暂存区注入失败（不影响对话）:', scratchpadError.message);
      }

      const { paginatedHistory, historyInfo } = this.getPaginatedHistory(history, conversationId, {
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        contextualMessage,
      });

      const cleanedHistory = this._cleanHistoryForLLM(paginatedHistory);

      if (historyInfo) {
        contextualMessage = `${historyInfo}\n\n---\n\n${contextualMessage}`;
      }

      // 注入本轮行动提醒
      contextualMessage = `${this._getTurnReminder()}\n\n${contextualMessage}`;

      // 调用统一的工具循环（流式模式）
      const { content: displayContent } = await runToolLoop({
        agent,
        userMessage: contextualMessage,
        history: cleanedHistory,
        context: {
          conversationId,
          messageId,
          attachments,
        },
        options: {
          stream: true,
          webContents: this.webContents,
          signal,
          toolExecutor: this.toolExecutor,
          getToolSchema: (id) => this.getToolsForAgent(id),
          getToolDefinitions: (id) => this.getToolDefinitionsForAgent(id),
          getPermissionContext: () => this._getPermissionContext(),
          getTurnReminder: () => this._getTurnReminder(),
          onStage: (id, stage) => this._updateTaskStage(id, stage),
        },
      });

      // 完成推送
      const { sendStreamComplete } = require('./stream-handler');
      sendStreamComplete(this.webContents, messageId, displayContent);

      return { content: displayContent };
    } catch (error) {
      if (signal.aborted) {
        const abortContent = '（任务已被终止）';
        const { sendStreamComplete } = require('./stream-handler');
        sendStreamComplete(this.webContents, messageId, abortContent);
        return { content: abortContent };
      }
      logger.error(`ChatManager: ${agent.name} 流式处理失败`, error);
      const errorContent = `抱歉老板，我在处理您的请求时遇到了问题：${error.message || '未知错误'}`;
      // 确保即使出错也发送 CHAT_COMPLETE
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send(CHANNELS.CHAT_STREAM, { messageId, content: `\n\n${errorContent}` });
        this.webContents.send(CHANNELS.CHAT_COMPLETE, { messageId, content: errorContent });
      }
      return { content: errorContent };
    } finally {
      this._finishTask(agentId, taskId);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 工具循环（统一入口，委托给 tool-loop.js）
  // ─────────────────────────────────────────────────────────────

  /**
   * 带工具调用循环的消息处理（非流式版本）
   * 原先 chat-manager 内部有两份 _chatWithToolLoop（非流式 + 流式），
   * 现已合并为 tool-loop.js 中的 runToolLoop 一份实现。
   * 本方法是非流式入口，保持与原签名兼容。
   */
  async _chatWithToolLoop(agent, userMessage, history, context = {}) {
    const taskInfo = this.activeTasks.get(agent.id);
    const signal = taskInfo?.abortController?.signal;

    const { content } = await runToolLoop({
      agent,
      userMessage,
      history,
      context,
      options: {
        stream: false,
        webContents: null,
        signal,
        toolExecutor: this.toolExecutor,
        getToolSchema: (id) => this.getToolsForAgent(id),
        getToolDefinitions: (id) => this.getToolDefinitionsForAgent(id),
        getPermissionContext: () => this._getPermissionContext(),
        getTurnReminder: () => this._getTurnReminder(),
      },
    });
    return content;
  }
}

// 单例
const chatManager = new ChatManager();

module.exports = { ChatManager, chatManager };
