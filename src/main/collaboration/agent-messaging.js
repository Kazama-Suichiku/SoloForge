/**
 * AgentMessaging — 点对点消息、@提及、分层历史上下文
 *
 * 从 agent-communication.js 拆出。职责：
 *   - sendMessage：Agent 间同步消息（等待回复）
 *   - 通信历史构建（pairwise / 分层 / 压缩摘要）
 *   - 用户对话上下文摘要
 *   - 历史分页查询（getPairwiseHistoryInfo / getPairwiseHistoryPaginated / getMessagesPaginated）
 *   - getMessages
 *
 * 依赖注入（由 AgentCommunicationManager 传入 host）：
 *   - host.messages / host.delegatedTasks / host._saveToDisk() / host._generateId()
 *   - host.chatManager / host.toolExecutor / host.toolRegistry
 *   - host.queue (MessageQueue 实例)
 *   - host.timeout (timeout-manager 的 withTimeout)
 *   - host.runToolLoop (tool-loop-runner)
 *   - host._trackAgentActivity / _updateAgentActivityStage / _untrackAgentActivity
 *   - host._triggerMemoryExtraction
 *
 * @module collaboration/agent-messaging
 */

const { logger } = require('../utils/logger');
const { agentConfigStore } = require('../config/agent-config-store');
const { scratchpadManager } = require('../context/agent-scratchpad');

// Phase 1-A: MessageBus + trace-context
const { messageBus, createTraceContext } = require('./message-bus');

// 上下文配置
const MAX_HISTORY_MESSAGES = 30;
const HISTORY_PAGE_SIZE = 30;
const MAX_USER_CONTEXT_LENGTH = 800;
const BROWSE_CONTENT_LIMIT = 600;

// 协作健壮性
const MAX_NESTING_DEPTH = 5;
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * 截断过长文本（分页浏览用）
 */
function truncateForBrowse(text, limit = BROWSE_CONTENT_LIMIT) {
  if (!text || text.length <= limit) return text;
  return text.slice(0, limit) + `...（已截断，完整内容共 ${text.length} 字符）`;
}

class AgentMessaging {
  constructor(host) {
    this.host = host;
    /**
     * 已在 MessageBus 注册 handler 的 Agent 集合。
     * Phase 1-A: 每个 Agent 首次被 sendMessage/delegateTask 作为目标时，懒注册
     * 一个 MessageBus handler。handler 内部转调 _executeMessage 执行真正逻辑。
     * @type {Set<string>}
     */
    this._subscribedAgents = new Set();
  }

  // ═══════════════════════════════════════════════════════════
  // MessageBus handler 注册（Phase 1-A）
  // ═══════════════════════════════════════════════════════════

  /**
   * 为目标 Agent 在 MessageBus 注册 handler（幂等）。
   *
   * handler 接收一个消息对象（{from, to, content, type, conversationId,
   * metadata:{callChain, nestingDepth, timeout}, ...}），执行真正的 tool-loop
   * 逻辑，返回回复内容。MessageBus 会根据 mode（sync/async）决定是否等待。
   *
   * @param {string} agentId
   */
  _ensureSubscribed(agentId) {
    if (this._subscribedAgents.has(agentId)) return;
    this._subscribedAgents.add(agentId);

    messageBus.subscribe(agentId, async (message) => {
      return await this._executeMessage(message);
    });

    logger.debug(`AgentMessaging: 已为 ${agentId} 注册 MessageBus handler`);
  }

  // ═══════════════════════════════════════════════════════════
  // 循环检测 & 嵌套深度
  // ═══════════════════════════════════════════════════════════

  detectCycle(callChain, targetAgent) {
    if (!callChain || callChain.length === 0) {
      return { isCycle: false };
    }
    if (callChain.includes(targetAgent)) {
      const cycleStart = callChain.indexOf(targetAgent);
      const cycleInfo = [...callChain.slice(cycleStart), targetAgent].join(' → ');
      return { isCycle: true, cycleInfo };
    }
    return { isCycle: false };
  }

  checkNestingDepth(nestingDepth) {
    if (nestingDepth >= MAX_NESTING_DEPTH) {
      return { tooDeep: true, maxDepth: MAX_NESTING_DEPTH };
    }
    return { tooDeep: false, maxDepth: MAX_NESTING_DEPTH };
  }

  // ═══════════════════════════════════════════════════════════
  // 上下文管理
  // ═══════════════════════════════════════════════════════════

  getPairwiseHistory(agentA, agentB, limit = MAX_HISTORY_MESSAGES) {
    const pairMessages = this.host.messages
      .filter(
        (m) =>
          (m.fromAgent === agentA && m.toAgent === agentB) ||
          (m.fromAgent === agentB && m.toAgent === agentA)
      )
      .filter((m) => m.status === 'responded')
      .slice(-limit);

    const history = [];
    for (const msg of pairMessages) {
      history.push({
        role: msg.toAgent === agentB ? 'user' : 'assistant',
        content: `[${msg.fromAgent}]: ${msg.content}`,
      });
      if (msg.response) {
        history.push({
          role: msg.toAgent === agentB ? 'assistant' : 'user',
          content: `[${msg.toAgent}]: ${msg.response}`,
        });
      }
    }
    return history;
  }

  buildContextHistory(agentA, agentB, options = {}) {
    const { strategy = 'full', recentCount = 5 } = options;

    const allMessages = this.host.messages.filter(
      (m) =>
        ((m.fromAgent === agentA && m.toAgent === agentB) ||
          (m.fromAgent === agentB && m.toAgent === agentA)) &&
        m.status === 'responded'
    );

    if (strategy === 'focused') {
      const recent = allMessages.slice(-2);
      const toolHint =
        allMessages.length > 2
          ? '\n💡 如需回顾更早的沟通记录，可使用 browse_communication_history(with_agent="对方ID", page=页码) 工具分页查看。\n'
          : '';
      return {
        history: this._formatAsLLMHistory(recent, agentB),
        contextBlock: `━━━ 以下是你当前需要处理的任务，请专注执行，不要被历史消息干扰 ━━━${toolHint}\n`,
      };
    }

    if (strategy === 'minimal') {
      const recent = allMessages.slice(-1);
      return {
        history: this._formatAsLLMHistory(recent, agentB),
        contextBlock: '',
      };
    }

    // full
    if (allMessages.length <= recentCount) {
      return {
        history: this._formatAsLLMHistory(allMessages, agentB),
        contextBlock: allMessages.length > 0 ? '━━━ 当前任务 ━━━\n\n' : '',
      };
    }

    const recentMessages = allMessages.slice(-recentCount);
    const olderStart = Math.max(0, allMessages.length - recentCount - 10);
    const olderEnd = allMessages.length - recentCount;
    const olderMessages = allMessages.slice(olderStart, olderEnd);

    const summary = this._compressToSummary(olderMessages);
    const recentHistory = this._formatAsLLMHistory(recentMessages, agentB);

    let contextBlock = '';
    if (summary) {
      const skippedCount = Math.max(0, allMessages.length - recentCount - olderMessages.length);
      const skipNote = skippedCount > 0 ? `（还有 ${skippedCount} 条更早的记录未显示）` : '';
      contextBlock = `【历史沟通摘要 - 仅供参考，不需要回应这些内容】${skipNote}\n${summary}\n\n💡 如需查看完整的历史沟通记录，可使用 browse_communication_history(with_agent="对方ID", page=页码) 工具分页浏览。\n\n━━━ 以上为历史摘要，以下为当前任务（请专注处理）━━━\n\n`;
    } else {
      contextBlock = '━━━ 当前任务 ━━━\n\n';
    }

    logger.debug('分层历史构建', {
      strategy,
      totalMessages: allMessages.length,
      summaryCount: olderMessages.length,
      recentCount: recentMessages.length,
      historyEntries: recentHistory.length,
    });

    return { history: recentHistory, contextBlock };
  }

  _compressToSummary(messages) {
    if (!messages || messages.length === 0) return '';

    const lines = messages.map((m) => {
      const time = new Date(m.createdAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const fromName = this.host.chatManager?.getAgent(m.fromAgent)?.name || m.fromAgent;
      const toName = this.host.chatManager?.getAgent(m.toAgent)?.name || m.toAgent;
      const content = m.content.slice(0, 100).replace(/\n/g, ' ').trim();
      const result = m.response ? m.response.slice(0, 80).replace(/\n/g, ' ').trim() : '';
      let line = `• [${time}] ${fromName} → ${toName}: ${content}`;
      if (result) line += `\n  ↪ 回复: ${result}`;
      return line;
    });
    return lines.join('\n');
  }

  _formatAsLLMHistory(messages, targetAgentId) {
    const history = [];
    for (const msg of messages) {
      history.push({
        role: msg.toAgent === targetAgentId ? 'user' : 'assistant',
        content: `[${msg.fromAgent}]: ${msg.content}`,
      });
      if (msg.response) {
        history.push({
          role: msg.toAgent === targetAgentId ? 'assistant' : 'user',
          content: `[${msg.toAgent}]: ${msg.response}`,
        });
      }
    }
    return history;
  }

  getUserContextSummary(conversationId) {
    if (!conversationId || !this.host.chatManager) return '';
    try {
      const { getConversationHistory } = require('../tools/history-tool');
      const history = getConversationHistory(conversationId);
      if (!history || history.length === 0) return '';

      const recentMessages = history.slice(-5);
      const summary = recentMessages
        .map((m) => {
          const role = m.role === 'user' ? '用户' : 'Agent';
          const content = m.content.slice(0, 100) + (m.content.length > 100 ? '...' : '');
          return `${role}: ${content}`;
        })
        .join('\n');

      if (summary.length > MAX_USER_CONTEXT_LENGTH) {
        return summary.slice(0, MAX_USER_CONTEXT_LENGTH) + '...';
      }
      return summary;
    } catch {
      return '';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 权限上下文 & 工具 schema
  // ═══════════════════════════════════════════════════════════

  getPermissionContext() {
    const host = this.host;
    if (host.chatManager && typeof host.chatManager._getPermissionContext === 'function') {
      return host.chatManager._getPermissionContext();
    }
    try {
      const { permissionStore } = require('../config/permission-store');
      const perms = permissionStore.getAll();
      const paths = perms.files?.allowedPaths || [];
      const lines = ['【文件系统权限】'];
      if (paths.length > 0) {
        lines.push('可访问目录：');
        for (const p of paths) lines.push(`  • ${p}`);
        lines.push(`文件写入：${perms.files?.writeEnabled ? '已启用' : '未启用'}`);
      } else {
        lines.push('用户尚未配置可访问目录。');
      }
      lines.push(`Shell 命令：${perms.shell?.enabled ? '已启用' : '未启用'}`);
      lines.push(`Git 操作：${perms.git?.enabled ? '已启用' : '未启用'}`);
      lines.push(`网络搜索：${perms.network?.searchEnabled ? '已启用' : '未启用'}`);
      lines.push('');
      lines.push('重要：使用 list_files、read_file、write_file 工具时，path 参数必须是上述"可访问目录"下的绝对路径。');
      return lines.join('\n');
    } catch {
      return '';
    }
  }

  getToolsForAgent(agentId) {
    if (!this.host.chatManager) return '';
    return this.host.chatManager.getToolsForAgent(agentId);
  }

  getPlanningToolNames() {
    return new Set([
      'read_file',
      'list_files',
      'send_to_agent',
      'list_colleagues',
      'submit_dev_plan',
      'communication_history',
      'browse_communication_history',
      'communication_info',
      'memory_recall',
      'memory_search',
      'memory_list_recent',
      'memory_company_facts',
      'memory_project_context',
    ]);
  }

  getFilteredToolSchema(agentId, mode = 'full') {
    const host = this.host;
    if (mode === 'full' || !host.toolRegistry) {
      return this.getToolsForAgent(agentId);
    }
    const planningNames = this.getPlanningToolNames();
    const allTools = host.toolRegistry.getAll();
    const filteredTools = allTools.filter((t) => planningNames.has(t.name));
    return host.toolRegistry.getToolCallSchema(filteredTools);
  }

  // ═══════════════════════════════════════════════════════════
  // 同步消息通信
  // ═══════════════════════════════════════════════════════════

  async sendMessage(params) {
    const host = this.host;
    const {
      fromAgent,
      toAgent,
      message,
      conversationId,
      includeUserContext = true,
      allowTools = true,
      maxHistory,
      historyStrategy,
      callChain = [],
      nestingDepth = 0,
      timeout = DEFAULT_TIMEOUT_MS,
      // Phase 1-A 新增：mode='sync' 默认值保持向后兼容
      //   - 'sync'  → MessageBus.request，等待回复（原行为）
      //   - 'async' → MessageBus.publish，fire-and-forget，立即返回 {success:true}
      mode = 'sync',
    } = params;

    if (!host.chatManager) {
      return { success: false, error: 'ChatManager 未初始化' };
    }

    // 1. 循环检测
    const cycleCheck = this.detectCycle(callChain, toAgent);
    if (cycleCheck.isCycle) {
      logger.warn(`检测到循环调用，已阻断: ${cycleCheck.cycleInfo}`, {
        fromAgent,
        toAgent,
        callChain,
      });
      return {
        success: false,
        error: `检测到循环调用: ${cycleCheck.cycleInfo}，已阻断以防止无限递归`,
      };
    }

    // 2. 嵌套深度
    const depthCheck = this.checkNestingDepth(nestingDepth);
    if (depthCheck.tooDeep) {
      logger.warn(`嵌套深度超限: ${nestingDepth} >= ${depthCheck.maxDepth}`, {
        fromAgent,
        toAgent,
        nestingDepth,
      });
      return {
        success: false,
        error: `通信嵌套深度超过限制（最大 ${depthCheck.maxDepth} 层），请简化协作链路`,
      };
    }

    // 目标 Agent 状态
    if (fromAgent !== 'system') {
      const targetConfig = agentConfigStore.get(toAgent);
      const targetStatus = targetConfig?.status || 'active';
      if (targetStatus === 'suspended') {
        return { success: false, error: `${targetConfig?.name || toAgent} 当前处于停职状态，无法接收消息。` };
      }
      if (targetStatus === 'terminated') {
        return { success: false, error: `${targetConfig?.name || toAgent} 已离职，无法接收消息。` };
      }
    }

    const targetAgent = host.chatManager.getAgent(toAgent);
    if (!targetAgent) {
      return { success: false, error: `找不到目标同事: ${toAgent}` };
    }

    // Phase 1-A: 在 MessageBus 为目标 Agent 懒注册 handler
    this._ensureSubscribed(toAgent);

    const newCallChain = [...callChain, fromAgent];
    const newNestingDepth = nestingDepth + 1;

    logger.info(`Agent 通信: ${fromAgent} → ${toAgent}`, {
      message: message.slice(0, 100),
      allowTools,
      nestingDepth,
      callChainLength: newCallChain.length,
      mode,
    });

    // 构造标准消息对象（MessageBus 格式）
    const busMessage = {
      from: fromAgent,
      to: toAgent,
      type: 'message',
      content: message,
      mode,
      conversationId: conversationId || '',
      priority: 3,
      metadata: {
        callChain: newCallChain,
        nestingDepth: newNestingDepth,
        timeout,
        // 透传 sendMessage 的可选参数给 handler
        allowTools,
        includeUserContext,
        maxHistory: maxHistory || null,
        historyStrategy: historyStrategy || null,
      },
    };

    if (mode === 'async') {
      // fire-and-forget：不等回复，立即返回 {success:true}
      // handler 仍会在 mailbox 串行调度下执行（写 messages[]、tool-loop、
      // memoryExtraction），但调用方不阻塞。
      try {
        const pub = await messageBus.publish(toAgent, busMessage);
        if (!pub.success) {
          return { success: false, error: pub.error };
        }
        return { success: true, messageId: pub.messageId };
      } catch (error) {
        logger.error(`Agent 通信(async)异常: ${fromAgent} → ${toAgent}`, error);
        return { success: false, error: error.message };
      }
    }

    // mode === 'sync'：MessageBus.request 等待回复
    try {
      const req = await messageBus.request(toAgent, busMessage, timeout);
      if (!req.success) {
        // 超时或异常
        logger.error(`Agent 通信(sync)失败: ${fromAgent} → ${toAgent}`, { error: req.error });
        return { success: false, error: req.error };
      }
      // handler 返回 {success, response, toolsUsed}
      const reply = req.response;
      if (reply && typeof reply === 'object' && 'success' in reply) {
        return reply;
      }
      // 兜底：handler 返回的是裸 response 字符串
      return { success: true, response: reply };
    } catch (error) {
      logger.error(`Agent 通信超时或异常: ${fromAgent} → ${toAgent}`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * MessageBus handler 的真正执行体（Phase 1-A）。
   *
   * 由 AgentMailbox.process 串行调用。接收一个标准消息对象，执行原 sendMessage
   * 的 tool-loop 逻辑，返回 {success, response, toolsUsed} 作为回复。
   *
   * 串行保证：本方法内部仍通过 host.queue.enqueue 把实际工作入 MessageQueue，
   * 保证同一 Agent 同时只处理一个任务（与重构前一致）。
   *
   * @param {Object} msg - MessageBus 消息对象
   * @returns {Promise<{success: boolean, response?: string, toolsUsed?: string[], error?: string}>}
   */
  async _executeMessage(msg) {
    const host = this.host;

    // Phase 1-A: 按 type 分发。delegation 交给 TaskDelegation 处理。
    if (msg.type === 'delegation' && host.delegation && typeof host.delegation._executeDelegationMessage === 'function') {
      return await host.delegation._executeDelegationMessage(msg);
    }

    const {
      from: fromAgent,
      to: toAgent,
      content: message,
      conversationId = '',
      metadata = {},
    } = msg;
    const {
      callChain = [],
      nestingDepth = 0,
      timeout = DEFAULT_TIMEOUT_MS,
      allowTools = true,
      includeUserContext = true,
      maxHistory = null,
      historyStrategy = null,
    } = metadata;

    if (!host.chatManager) {
      return { success: false, error: 'ChatManager 未初始化' };
    }

    const targetAgent = host.chatManager.getAgent(toAgent);
    if (!targetAgent) {
      return { success: false, error: `找不到目标同事: ${toAgent}` };
    }
    const fromAgentInfo = host.chatManager.getAgent(fromAgent);
    const fromAgentName = fromAgentInfo?.name || fromAgent;
    const newCallChain = callChain;
    const newNestingDepth = nestingDepth;

    // executeTask 闭包：内部所有写消息记录、tool-loop、memoryExtraction 逻辑
    // 与重构前完全一致，只是参数来源改为消息对象。
    const executeTask = async () => {
      const msgRecord = {
        id: host._generateId(),
        fromAgent,
        toAgent,
        content: message,
        response: '',
        status: 'pending',
        createdAt: Date.now(),
        context: conversationId,
      };
      host.messages.push(msgRecord);

      const activityTaskId = host._trackAgentActivity(toAgent, `内部通信: 来自 ${fromAgentName}`);

      try {
        // 1. 分层通信历史
        let pairwiseHistory;
        let contextBlock = '';
        if (historyStrategy) {
          const ctx = this.buildContextHistory(fromAgent, toAgent, { strategy: historyStrategy });
          pairwiseHistory = ctx.history;
          contextBlock = ctx.contextBlock;
        } else if (maxHistory) {
          pairwiseHistory = this.getPairwiseHistory(fromAgent, toAgent, maxHistory);
          contextBlock = '━━━ 当前任务 ━━━\n\n';
        } else {
          const ctx = this.buildContextHistory(fromAgent, toAgent, { strategy: 'full' });
          pairwiseHistory = ctx.history;
          contextBlock = ctx.contextBlock;
        }

        // 2. 用户对话上下文
        let userContextPart = '';
        if (includeUserContext && conversationId) {
          const userSummary = this.getUserContextSummary(conversationId);
          if (userSummary) {
            userContextPart = `\n\n[用户对话背景]\n${userSummary}\n`;
          }
        }

        // 2.5 暂存区上下文
        let scratchpadPart = '';
        try {
          const scratchpad = scratchpadManager.get(toAgent);
          if (scratchpad.hasContent()) {
            scratchpadPart = `\n\n${scratchpad.getContextSummary()}`;
          }
        } catch (err) {
          logger.debug('获取暂存区失败', { toAgent, error: err.message });
        }

        // 3. 构建消息
        const contextMessage = `${contextBlock}${scratchpadPart}[内部消息 - 来自 ${fromAgentName} (${fromAgent})]${userContextPart}\n\n${message}`;

        logger.debug(`Agent 通信历史条数: ${pairwiseHistory.length}`);

        let response;
        let toolsUsed = [];
        if (allowTools && host.toolExecutor) {
          // 使用 ToolLoopRunner
          const toolSchema = this.getFilteredToolSchema(targetAgent.id, 'full');
          const loopResult = await host.runToolLoop(targetAgent, contextMessage, pairwiseHistory, {
            conversationId,
            fromAgent,
            isInternalCommunication: true,
            callChain: newCallChain,
            nestingDepth: newNestingDepth,
          }, {
            toolSchema,
            toolExecutor: host.toolExecutor,
            getPermissionContext: () => this.getPermissionContext(),
            onStageChange: (stage) => host._updateAgentActivityStage(targetAgent.id, stage),
          });
          response = loopResult.content;
          toolsUsed = loopResult.toolsUsed || [];
        } else {
          response = await targetAgent.chat(contextMessage, pairwiseHistory, { stream: false });
        }

        msgRecord.response = response;
        msgRecord.status = 'responded';
        msgRecord.respondedAt = Date.now();
        host._saveToDisk();

        logger.info(`Agent 通信完成: ${fromAgent} ← ${toAgent}`, {
          responseLength: response.length,
          historyUsed: pairwiseHistory.length,
          allowTools,
          nestingDepth: newNestingDepth,
          toolsUsed,
        });

        host._triggerMemoryExtraction('communication', {
          fromAgent,
          toAgent,
          message,
          response,
        });

        return { success: true, response, toolsUsed };
      } catch (error) {
        msgRecord.status = 'failed';
        msgRecord.response = error.message;
        host._saveToDisk();
        logger.error(`Agent 通信失败: ${fromAgent} → ${toAgent}`, error);
        return { success: false, error: error.message };
      } finally {
        host._untrackAgentActivity(toAgent, activityTaskId);
      }
    };

    // 入队 + 超时（保留 MessageQueue 串行槽位语义）
    try {
      const result = await host.timeout.withTimeout(
        host.queue.enqueue(toAgent, executeTask),
        timeout,
        `与 ${toAgent} 通信`
      );
      return result;
    } catch (error) {
      logger.error(`Agent 通信超时或异常: ${fromAgent} → ${toAgent}`, error);
      return { success: false, error: error.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 历史查询
  // ═══════════════════════════════════════════════════════════

  getMessages(agentId, options = {}) {
    const { limit = 20 } = options;
    return this.host.messages.filter((m) => m.fromAgent === agentId || m.toAgent === agentId).slice(-limit);
  }

  getPairwiseHistoryInfo(agentA, agentB) {
    const pairMessages = this.host.messages.filter(
      (m) =>
        ((m.fromAgent === agentA && m.toAgent === agentB) ||
          (m.fromAgent === agentB && m.toAgent === agentA)) &&
        m.status === 'responded'
    );
    const total = pairMessages.length;
    const totalPages = Math.ceil(total / HISTORY_PAGE_SIZE);
    return {
      total,
      totalPages,
      pageSize: HISTORY_PAGE_SIZE,
      hasMore: total > MAX_HISTORY_MESSAGES,
    };
  }

  getPairwiseHistoryPaginated(agentA, agentB, options = {}) {
    const { page = 1, pageSize = HISTORY_PAGE_SIZE } = options;
    const { formatLocalTime } = require('../utils/time-format');

    const pairMessages = this.host.messages
      .filter(
        (m) =>
          ((m.fromAgent === agentA && m.toAgent === agentB) ||
            (m.fromAgent === agentB && m.toAgent === agentA)) &&
          m.status === 'responded'
      )
      .sort((a, b) => a.createdAt - b.createdAt);

    const total = pairMessages.length;
    const totalPages = Math.ceil(total / pageSize);
    const endIndex = total - (page - 1) * pageSize;
    const startIndex = Math.max(0, endIndex - pageSize);

    if (startIndex >= endIndex || page < 1) {
      return {
        messages: [],
        page,
        totalPages,
        total,
        hasMore: false,
        error: page > totalPages ? `页码超出范围，共 ${totalPages} 页` : null,
      };
    }

    const pageMessages = pairMessages.slice(startIndex, endIndex);
    const formattedMessages = pageMessages.map((m) => ({
      id: m.id,
      from: m.fromAgent,
      to: m.toAgent,
      content: truncateForBrowse(m.content),
      response: m.response ? truncateForBrowse(m.response) : null,
      time: formatLocalTime(m.createdAt),
      respondedAt: m.respondedAt ? formatLocalTime(m.respondedAt) : null,
    }));

    return {
      messages: formattedMessages,
      page,
      totalPages,
      total,
      hasMore: page < totalPages,
      hint: page < totalPages ? `还有更早的记录，使用 page=${page + 1} 查看` : '已是最早的记录',
    };
  }

  getMessagesPaginated(agentId, options = {}) {
    const { page = 1, pageSize = HISTORY_PAGE_SIZE, withAgent } = options;
    const { formatLocalTime } = require('../utils/time-format');

    let filteredMessages = this.host.messages.filter(
      (m) => (m.fromAgent === agentId || m.toAgent === agentId) && m.status === 'responded'
    );

    if (withAgent) {
      filteredMessages = filteredMessages.filter(
        (m) => m.fromAgent === withAgent || m.toAgent === withAgent
      );
    }

    filteredMessages.sort((a, b) => a.createdAt - b.createdAt);
    const total = filteredMessages.length;
    const totalPages = Math.ceil(total / pageSize);
    const endIndex = total - (page - 1) * pageSize;
    const startIndex = Math.max(0, endIndex - pageSize);

    if (startIndex >= endIndex || page < 1) {
      return { messages: [], page, totalPages, total, hasMore: false };
    }

    const pageMessages = filteredMessages.slice(startIndex, endIndex);
    const formattedMessages = pageMessages.map((m) => ({
      id: m.id,
      direction: m.fromAgent === agentId ? 'sent' : 'received',
      peer: m.fromAgent === agentId ? m.toAgent : m.fromAgent,
      content: truncateForBrowse(m.content),
      response: m.response ? truncateForBrowse(m.response) : null,
      time: formatLocalTime(m.createdAt),
    }));

    return { messages: formattedMessages, page, totalPages, total, hasMore: page < totalPages };
  }
}

module.exports = {
  AgentMessaging,
  // 常量一并导出，供 aggregator 复用
  MAX_HISTORY_MESSAGES,
  HISTORY_PAGE_SIZE,
  MAX_USER_CONTEXT_LENGTH,
  BROWSE_CONTENT_LIMIT,
  MAX_NESTING_DEPTH,
  DEFAULT_TIMEOUT_MS,
  truncateForBrowse,
};
