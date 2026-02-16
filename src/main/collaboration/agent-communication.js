/**
 * SoloForge - Agent 间通信系统
 * 支持 Agent 之间的消息传递、任务委派和协作
 * 包含上下文管理：通信历史记忆 + 用户对话摘要传递
 * 支持 Agent 间通信中的工具调用
 * @module collaboration/agent-communication
 */

const { logger } = require('../utils/logger');
const { agentConfigStore } = require('../config/agent-config-store');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { dataPath } = require('../account/data-path');
const { scratchpadManager } = require('../context/agent-scratchpad');

function getDataDir() {
  return dataPath.getBasePath();
}

function getCommFile() {
  return path.join(dataPath.getBasePath(), 'agent-communications.json');
}

// 上下文配置（已优化：参考 Cursor/Claude Code 最佳实践）
const MAX_HISTORY_MESSAGES = 30; // Agent 间对话最多保留的历史条数（从 15 增加到 30）
const HISTORY_PAGE_SIZE = 30; // 分页查看历史时每页条数
const MAX_USER_CONTEXT_LENGTH = 800; // 用户对话摘要最大长度（从 500 增加到 800）
const MAX_INTERNAL_TOOL_ITERATIONS = 100; // 安全上限，允许复杂任务（从 20 增加到 100）
const BROWSE_CONTENT_LIMIT = 600; // 分页浏览时单条消息内容截断长度（防 token 爆炸）

// 协作健壮性配置
const MAX_NESTING_DEPTH = 5; // 最大嵌套深度，防止 A→B→C→... 无限链
const DEFAULT_TIMEOUT_MS = 120000; // 默认通信超时时间（2分钟）
const DELEGATE_TIMEOUT_MS = 300000; // 委派任务超时时间（5分钟）

/**
 * 截断过长文本，附带原始长度提示
 * @param {string} text
 * @param {number} [limit=BROWSE_CONTENT_LIMIT]
 * @returns {string}
 */
function truncateForBrowse(text, limit = BROWSE_CONTENT_LIMIT) {
  if (!text || text.length <= limit) return text;
  return text.slice(0, limit) + `...（已截断，完整内容共 ${text.length} 字符）`;
}

/**
 * @typedef {Object} AgentMessage
 * @property {string} id - 消息 ID
 * @property {string} fromAgent - 发送方 Agent ID
 * @property {string} toAgent - 接收方 Agent ID
 * @property {string} content - 消息内容
 * @property {string} response - 回复内容
 * @property {'pending' | 'responded' | 'failed'} status - 状态
 * @property {number} createdAt - 创建时间
 * @property {number} [respondedAt] - 回复时间
 * @property {string} [context] - 上下文（来自哪个用户对话）
 */

/**
 * @typedef {Object} DelegatedTask
 * @property {string} id - 任务 ID
 * @property {string} fromAgent - 委派方 Agent ID
 * @property {string} toAgent - 被委派方 Agent ID
 * @property {string} taskDescription - 任务描述
 * @property {'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'} status
 * @property {string} [result] - 执行结果
 * @property {number} priority - 优先级 (1-5, 1 最高)
 * @property {number} createdAt - 创建时间
 * @property {number} [startedAt] - 开始时间
 * @property {number} [completedAt] - 完成时间
 * @property {string} [conversationId] - 关联的用户对话 ID
 * @property {Array<{agent: string, content: string, timestamp: number}>} discussion - 讨论记录
 */

/**
 * Agent 通信管理器
 */
class AgentCommunicationManager {
  constructor() {
    /** @type {AgentMessage[]} */
    this.messages = [];
    /** @type {DelegatedTask[]} */
    this.delegatedTasks = [];
    /** @type {Object | null} */
    this.chatManager = null;
    /** @type {Object | null} - 工具执行器引用 */
    this.toolExecutor = null;
    /** @type {Object | null} - 工具注册表引用 */
    this.toolRegistry = null;

    // ═══════════════════════════════════════════════════════════
    // 协作健壮性：消息队列和并发控制
    // ═══════════════════════════════════════════════════════════
    /** @type {Map<string, Array<{task: Function, resolve: Function, reject: Function}>>} - 每个 Agent 的消息队列 */
    this._agentQueues = new Map();
    /** @type {Map<string, boolean>} - 每个 Agent 是否正在处理消息 */
    this._agentProcessing = new Map();

    this._ensureDataDir();
    this._loadFromDisk();
  }

  /**
   * 重新初始化（切换公司后调用）
   * 清空内存状态并从新路径重新加载
   */
  reinitialize() {
    this.messages = [];
    this.delegatedTasks = [];
    // 清空消息队列
    this._agentQueues.clear();
    this._agentProcessing.clear();
    this._ensureDataDir();
    this._loadFromDisk();
  }

  /**
   * 清理指定 Agent 的消息队列（开除时调用）
   * @param {string} agentId - 要清理的 Agent ID
   * @returns {{queueCleared: number, wasProcessing: boolean}}
   */
  clearAgentQueues(agentId) {
    // 获取队列中待处理的任务数
    const queue = this._agentQueues.get(agentId) || [];
    const queueCleared = queue.length;

    // 拒绝所有排队中的任务
    for (const { reject } of queue) {
      try {
        reject(new Error('Agent 已被开除，任务已取消'));
      } catch (e) {
        // 忽略 reject 时的错误
      }
    }

    // 清理队列和处理状态
    const wasProcessing = this._agentProcessing.get(agentId) || false;
    this._agentQueues.delete(agentId);
    this._agentProcessing.delete(agentId);

    if (queueCleared > 0 || wasProcessing) {
      logger.info(`AgentCommunication: 已清理 Agent ${agentId} 的通信队列`, {
        queueCleared,
        wasProcessing,
      });
    }

    return { queueCleared, wasProcessing };
  }

  // ═══════════════════════════════════════════════════════════
  // 消息队列和并发控制（协作健壮性核心）
  // ═══════════════════════════════════════════════════════════

  /**
   * 将任务加入 Agent 的消息队列
   * 确保同一 Agent 同时只处理一个任务
   * @param {string} agentId - 目标 Agent ID
   * @param {Function} task - 异步任务函数
   * @returns {Promise<any>} 任务执行结果
   */
  _enqueue(agentId, task) {
    return new Promise((resolve, reject) => {
      if (!this._agentQueues.has(agentId)) {
        this._agentQueues.set(agentId, []);
      }
      this._agentQueues.get(agentId).push({ task, resolve, reject });
      // 尝试处理队列
      this._processQueue(agentId);
    });
  }

  /**
   * 处理 Agent 的消息队列
   * @param {string} agentId - Agent ID
   */
  async _processQueue(agentId) {
    // 如果该 Agent 正在处理，退出（当前任务完成后会继续处理队列）
    if (this._agentProcessing.get(agentId)) {
      return;
    }

    const queue = this._agentQueues.get(agentId);
    if (!queue || queue.length === 0) {
      return;
    }

    // 标记正在处理
    this._agentProcessing.set(agentId, true);

    // 取出队列中的第一个任务
    const { task, resolve, reject } = queue.shift();

    try {
      // 执行任务
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      // 标记处理完成
      this._agentProcessing.set(agentId, false);
      // 使用 setImmediate 让出事件循环，然后继续处理队列中的下一个任务
      setImmediate(() => this._processQueue(agentId));
    }
  }

  /**
   * 检测循环调用
   * @param {string[]} callChain - 调用链（从发起者到当前）
   * @param {string} targetAgent - 目标 Agent
   * @returns {{isCycle: boolean, cycleInfo?: string}}
   */
  _detectCycle(callChain, targetAgent) {
    if (!callChain || callChain.length === 0) {
      return { isCycle: false };
    }

    // 检查目标是否已在调用链中
    if (callChain.includes(targetAgent)) {
      const cycleStart = callChain.indexOf(targetAgent);
      const cycleInfo = [...callChain.slice(cycleStart), targetAgent].join(' → ');
      return { isCycle: true, cycleInfo };
    }

    return { isCycle: false };
  }

  /**
   * 检查嵌套深度
   * @param {number} nestingDepth - 当前嵌套深度
   * @returns {{tooDeep: boolean, maxDepth: number}}
   */
  _checkNestingDepth(nestingDepth) {
    if (nestingDepth >= MAX_NESTING_DEPTH) {
      return { tooDeep: true, maxDepth: MAX_NESTING_DEPTH };
    }
    return { tooDeep: false, maxDepth: MAX_NESTING_DEPTH };
  }

  /**
   * 带超时的 Promise 包装
   * @param {Promise} promise - 原始 Promise
   * @param {number} timeoutMs - 超时时间（毫秒）
   * @param {string} operationName - 操作名称（用于错误信息）
   * @returns {Promise}
   */
  _withTimeout(promise, timeoutMs, operationName = '操作') {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`${operationName}超时（${timeoutMs / 1000}秒）`));
        }, timeoutMs);
      }),
    ]);
  }

  /**
   * 设置 ChatManager 引用（用于调用其他 Agent）
   * @param {Object} chatManager
   */
  setChatManager(chatManager) {
    this.chatManager = chatManager;
    // 同时获取工具执行器和注册表引用
    if (chatManager) {
      this.toolExecutor = chatManager.toolExecutor;
      // 延迟加载工具注册表
      this.toolRegistry = require('../tools/tool-registry').toolRegistry;
    }
  }

  /**
   * 确保数据目录存在
   */
  _ensureDataDir() {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 从磁盘加载数据
   */
  _loadFromDisk() {
    try {
      const commFile = getCommFile();
      if (fs.existsSync(commFile)) {
        const data = JSON.parse(fs.readFileSync(commFile, 'utf-8'));
        this.messages = data.messages || [];
        this.delegatedTasks = data.delegatedTasks || [];
        logger.info('Agent 通信记录已加载', {
          messages: this.messages.length,
          tasks: this.delegatedTasks.length,
        });
      }
    } catch (error) {
      logger.error('加载 Agent 通信记录失败', error);
    }
  }

  /**
   * 保存到磁盘
   */
  _saveToDisk() {
    try {
      const { atomicWriteSync } = require('../utils/atomic-write');
      const content = JSON.stringify(
        {
          messages: this.messages.slice(-500), // 只保留最近 500 条消息
          delegatedTasks: this.delegatedTasks.slice(-200), // 只保留最近 200 个任务
        },
        null,
        2
      );
      // 使用原子写入，防止写入过程中崩溃导致文件损坏
      atomicWriteSync(getCommFile(), content);
    } catch (error) {
      logger.error('保存 Agent 通信记录失败', error);
    }
  }

  /**
   * 生成唯一 ID
   */
  _generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ═══════════════════════════════════════════════════════════
  // 活跃任务追踪（与控制面板联动）
  // ═══════════════════════════════════════════════════════════

  /**
   * 注册 Agent 活跃状态到 ChatManager 的任务追踪系统
   * 让控制面板能看到通过内部通信工作的 Agent
   * @param {string} agentId - Agent ID
   * @param {string} taskDescription - 任务描述
   * @returns {string|null} taskId - 用于后续 _untrackAgentActivity 匹配
   */
  _trackAgentActivity(agentId, taskDescription) {
    if (!this.chatManager) return null;
    try {
      // 使用 ChatManager 的 _startTask 方法注册
      if (typeof this.chatManager._startTask === 'function') {
        const { taskId } = this.chatManager._startTask(agentId, {
          task: taskDescription,
          stage: 'thinking',
        });
        return taskId;
      }
    } catch (error) {
      logger.debug('注册活跃任务追踪失败:', error.message);
    }
    return null;
  }

  /**
   * 更新 Agent 活跃状态阶段
   * @param {string} agentId - Agent ID
   * @param {string} stage - 阶段（thinking/tools/responding）
   */
  _updateAgentActivityStage(agentId, stage) {
    if (!this.chatManager) return;
    try {
      if (typeof this.chatManager._updateTaskStage === 'function') {
        this.chatManager._updateTaskStage(agentId, stage);
      }
    } catch (error) {
      logger.debug('更新活跃任务阶段失败:', error.message);
    }
  }

  /**
   * 取消注册 Agent 活跃状态
   * @param {string} agentId - Agent ID
   * @param {string} [taskId] - 任务 ID，用于匹配防止误删
   */
  _untrackAgentActivity(agentId, taskId) {
    if (!this.chatManager) return;
    try {
      if (typeof this.chatManager._finishTask === 'function') {
        this.chatManager._finishTask(agentId, taskId);
      }
    } catch (error) {
      logger.debug('取消活跃任务追踪失败:', error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 权限上下文
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取权限上下文（复用 ChatManager 的方法）
   * 让内部通信中的 Agent 知道文件系统访问权限
   * @returns {string}
   */
  _getPermissionContext() {
    if (this.chatManager && typeof this.chatManager._getPermissionContext === 'function') {
      return this.chatManager._getPermissionContext();
    }
    // 降级：直接读取权限配置
    try {
      const { permissionStore } = require('../config/permission-store');
      const perms = permissionStore.getAll();
      const paths = perms.files?.allowedPaths || [];
      const lines = ['【文件系统权限】'];
      if (paths.length > 0) {
        lines.push('可访问目录：');
        for (const p of paths) {
          lines.push(`  • ${p}`);
        }
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

  // ═══════════════════════════════════════════════════════════
  // 内部工具调用支持
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取 Agent 可用的工具 schema（复用 ChatManager 的逻辑）
   * @param {string} agentId
   * @returns {string}
   */
  _getToolsForAgent(agentId) {
    if (!this.chatManager) {
      return '';
    }
    return this.chatManager.getToolsForAgent(agentId);
  }

  /**
   * 获取规划阶段允许的工具名称集合
   * @returns {Set<string>}
   */
  _getPlanningToolNames() {
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

  /**
   * 获取过滤后的工具 schema（规划阶段只读工具）
   * @param {string} agentId
   * @param {'planning' | 'full'} mode
   * @returns {string}
   */
  _getFilteredToolSchema(agentId, mode = 'full') {
    if (mode === 'full' || !this.toolRegistry) {
      return this._getToolsForAgent(agentId);
    }

    // 规划模式：只返回只读 + 通信 + submit_dev_plan 的 schema
    const planningNames = this._getPlanningToolNames();
    const allTools = this.toolRegistry.getAll();
    const filteredTools = allTools.filter((t) => planningNames.has(t.name));
    return this.toolRegistry.getToolCallSchema(filteredTools);
  }

  /**
   * 带工具调用循环的内部 Agent 通信
   * @param {Object} agent - 目标 Agent
   * @param {string} message - 消息内容
   * @param {Array} history - 对话历史
   * @param {Object} context - 上下文信息
   * @param {Object} [options] - 额外选项
   * @param {'planning' | 'full'} [options.toolFilter='full'] - 工具过滤模式
   * @param {Function} [options.onToolExecuted] - 工具执行后的回调（可设置 break flag）
   * @returns {Promise<{content: string, toolsUsed: string[]}>} 最终回复和使用的工具列表
   */
  async _chatWithToolLoop(agent, message, history, context = {}, options = {}) {
    const { toolFilter = 'full', onToolExecuted } = options;

    // 延迟加载工具解析器（避免循环依赖）
    const { parseToolCalls, hasToolCalls, removeToolCalls } = require('../tools/tool-executor');

    let currentHistory = [...history];
    let currentMessage = message;
    let finalContent = '';
    let iteration = 0;
    let shouldBreak = false;

    // 追踪本次调用中实际执行过的工具名称（局部变量，避免实例共享问题）
    const toolsUsedInThisCall = [];

    // 获取 Agent 可用的工具 schema（根据过滤模式）
    const toolSchema = this._getFilteredToolSchema(agent.id, toolFilter);

    // CXO 级别不限制工具调用次数，其他 Agent 限制 100 次
    const agentConfig = agentConfigStore.get(agent.id);
    const isCxoLevel = agentConfig?.level === 'c_level' || 
                       ['ceo', 'cto', 'cfo', 'chro', 'secretary'].includes(agent.role);
    const maxIterations = isCxoLevel ? Infinity : MAX_INTERNAL_TOOL_ITERATIONS;

    while (iteration < maxIterations && !shouldBreak) {
      iteration++;

      // 构建包含工具说明的消息（包括权限上下文）
      let messageWithTools = currentMessage;
      if (toolSchema && iteration === 1) {
        // 第一轮添加权限上下文 + 工具说明
        const permContext = this._getPermissionContext();
        messageWithTools = `${currentMessage}\n\n---\n\n${permContext}\n\n【可用工具】\n${toolSchema}`;
      } else if (toolSchema && iteration > 1) {
        // 后续轮次注入简短提醒，确保 Agent 记得工具调用格式
        messageWithTools = `${currentMessage}\n\n---\n提醒：你仍然可以继续使用工具。请使用 <tool_call><name>工具名</name><arguments><参数名>参数值</参数名></arguments></tool_call> 格式。常用工具名：read_file、write_file、list_files、shell、git_branch、git_commit、git_create_pr、git_status。不要使用 fs_write、read_code、list_dir、execute_command 等错误名称。`;
      }

      // 调用 Agent（非流式）
      const response = await agent.chat(messageWithTools, currentHistory, { stream: false });

      // 第 2 层防御：停职 Agent 即使生成了工具调用也跳过解析
      const runtimeConfig = agentConfigStore.get(agent.id);
      const runtimeStatus = runtimeConfig?.status || 'active';
      if (runtimeStatus === 'suspended' || runtimeStatus === 'terminated') {
        finalContent = removeToolCalls(response) || response;
        break;
      }

      // 检查是否有工具调用
      if (!hasToolCalls(response)) {
        // 没有工具调用，返回最终内容
        finalContent = response;
        break;
      }

      logger.info(`Agent 内部通信: ${agent.id} 第 ${iteration} 轮工具调用`);

      // 更新活跃任务状态为工具执行中
      this._updateAgentActivityStage(agent.id, 'tools');

      // 解析工具调用
      const toolCalls = parseToolCalls(response);
      const textContent = removeToolCalls(response);

      // 如果有文本内容（工具调用前的说明），先记录
      if (textContent.trim()) {
        finalContent += textContent.trim() + '\n\n';
      }

      // 执行工具
      if (this.toolExecutor && toolCalls.length > 0) {
        const toolResults = await this.toolExecutor.executeToolCalls(toolCalls, {
          agentId: agent.id,
          agentName: agent.name,
          isInternalCommunication: true, // 标记为内部通信
          // 传递调用链和嵌套深度（用于协作工具的循环检测）
          callChain: context.callChain || [],
          nestingDepth: context.nestingDepth || 0,
          ...context,
        });

        // 格式化工具结果
        const formattedResults = this.toolExecutor.formatToolResults(toolResults);

        // 更新历史，添加 Agent 响应和工具结果
        currentHistory = [
          ...currentHistory,
          { role: 'assistant', content: response },
          { role: 'user', content: `工具执行结果：\n\n${formattedResults}` },
        ];

        // 记录已使用的工具（局部变量）
        const usedToolNames = toolCalls.map((t) => t.name).join(', ');
        for (const tc of toolCalls) {
          if (!toolsUsedInThisCall.includes(tc.name)) {
            toolsUsedInThisCall.push(tc.name);
          }
        }

        // 调用工具执行回调（用于检测 submit_dev_plan 等触发中断的工具）
        if (onToolExecuted) {
          const callbackResult = onToolExecuted(toolCalls, toolResults);
          if (callbackResult?.shouldBreak) {
            finalContent += formattedResults;
            break;
          }
        }

        // 下一轮使用工具结果提示，明确告诉 Agent 不要重复调用相同工具
        currentMessage = `【系统指令】工具已执行完毕。请根据工具返回的结果完成任务。

规则：
1. 如果结果已经足够，直接给出最终答案
2. 如果需要继续使用工具，必须使用不同的工具或不同的参数
3. 禁止重复调用刚才已执行的工具：${usedToolNames}
4. 不要重复问候语或解释

直接输出你的处理结论或下一步操作。`;

        logger.info(`Agent 内部通信: 工具执行完成`, {
          agent: agent.id,
          tools: toolCalls.map((t) => t.name),
          iteration,
          resultsLength: formattedResults.length,
        });
      } else {
        // 没有工具执行器或没有工具调用，直接返回
        finalContent = response;
        break;
      }
    }

    if (iteration >= maxIterations) {
      logger.warn(`Agent 内部通信: ${agent.id} 达到最大工具调用轮数`, { iteration, maxIterations });
      // 不要显示这个提示，让 Agent 的最后回复作为最终内容
      if (!finalContent.trim()) {
        finalContent = '（任务处理中，请稍后查看结果）';
      }
    }

    // 返回内容和使用的工具列表（避免实例级共享问题）
    return { content: finalContent, toolsUsed: toolsUsedInThisCall };
  }

  // ═══════════════════════════════════════════════════════════
  // 上下文管理
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取两个 Agent 之间的通信历史（用于构建对话上下文）
   * @param {string} agentA - Agent A ID
   * @param {string} agentB - Agent B ID
   * @param {number} [limit=MAX_HISTORY_MESSAGES] - 最大条数
   * @returns {Array<{role: string, content: string}>} LLM 格式的历史消息
   */
  _getPairwiseHistory(agentA, agentB, limit = MAX_HISTORY_MESSAGES) {
    // 筛选出这两个 Agent 之间的通信
    const pairMessages = this.messages
      .filter(
        (m) =>
          (m.fromAgent === agentA && m.toAgent === agentB) ||
          (m.fromAgent === agentB && m.toAgent === agentA)
      )
      .filter((m) => m.status === 'responded') // 只取已回复的
      .slice(-limit);

    // 转换为 LLM 历史格式
    const history = [];
    for (const msg of pairMessages) {
      // 发送方的消息
      history.push({
        role: msg.toAgent === agentB ? 'user' : 'assistant',
        content: `[${msg.fromAgent}]: ${msg.content}`,
      });
      // 接收方的回复
      if (msg.response) {
        history.push({
          role: msg.toAgent === agentB ? 'assistant' : 'user',
          content: `[${msg.toAgent}]: ${msg.response}`,
        });
      }
    }

    return history;
  }

  // ─── 分层历史上下文 ─────────────────────────────────────

  /**
   * 构建分层通信历史上下文
   * 将历史分为远期（压缩摘要）+ 近期（完整保留），并生成分隔标记
   * 解决上下文过长导致 LLM 注意力分散、忘记调用工具等问题
   *
   * @param {string} agentA - 通常是 fromAgent
   * @param {string} agentB - 通常是 toAgent（目标 Agent，历史按其视角格式化 role）
   * @param {Object} [options]
   * @param {'full'|'focused'|'minimal'} [options.strategy='full']
   *   - full:    远期压缩摘要 + 近期完整（默认，适合普通同事对话）
   *   - focused: 只保留最近 2 条完整记录 + 强分隔（审阅/关键操作）
   *   - minimal: 只保留最近 1 条完整记录（独立任务、首次通信）
   * @param {number} [options.recentCount=5] - full 策略下近期保留的完整记录条数
   * @returns {{ history: Array<{role:string,content:string}>, contextBlock: string }}
   *   - history: 注入到 LLM messages 数组中的近期完整历史
   *   - contextBlock: 插入到当前消息前面的文本（含远期摘要和分隔线）
   */
  _buildContextHistory(agentA, agentB, options = {}) {
    const {
      strategy = 'full',
      recentCount = 5,
    } = options;

    // 获取双方之间所有已回复的通信记录
    const allMessages = this.messages.filter(
      (m) =>
        ((m.fromAgent === agentA && m.toAgent === agentB) ||
         (m.fromAgent === agentB && m.toAgent === agentA)) &&
        m.status === 'responded'
    );

    // ── focused 策略：极少上下文 + 强分隔，用于审阅等关键操作 ──
    if (strategy === 'focused') {
      const recent = allMessages.slice(-2);
      const toolHint = allMessages.length > 2
        ? '\n💡 如需回顾更早的沟通记录，可使用 browse_communication_history(with_agent="对方ID", page=页码) 工具分页查看。\n'
        : '';
      return {
        history: this._formatAsLLMHistory(recent, agentB),
        contextBlock: `━━━ 以下是你当前需要处理的任务，请专注执行，不要被历史消息干扰 ━━━${toolHint}\n`,
      };
    }

    // ── minimal 策略：独立任务 ──
    if (strategy === 'minimal') {
      const recent = allMessages.slice(-1);
      return {
        history: this._formatAsLLMHistory(recent, agentB),
        contextBlock: '',
      };
    }

    // ── full 策略：远期摘要 + 近期完整 ──
    if (allMessages.length <= recentCount) {
      // 历史较短，全部保留完整内容
      return {
        history: this._formatAsLLMHistory(allMessages, agentB),
        contextBlock: allMessages.length > 0
          ? '━━━ 当前任务 ━━━\n\n'
          : '',
      };
    }

    // 历史较长 → 分层处理
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

    return {
      history: recentHistory,
      contextBlock,
    };
  }

  /**
   * 将消息记录压缩为摘要文本（纯规则，不调用 LLM）
   * 每条记录提取：时间、发送方→接收方、内容摘要、回复摘要
   * @param {Array} messages - 消息记录数组
   * @returns {string} 压缩后的摘要文本
   */
  _compressToSummary(messages) {
    if (!messages || messages.length === 0) return '';

    const lines = messages.map((m) => {
      const time = new Date(m.createdAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      // 尝试获取更友好的名称
      const fromName = this.chatManager?.getAgent(m.fromAgent)?.name || m.fromAgent;
      const toName = this.chatManager?.getAgent(m.toAgent)?.name || m.toAgent;

      const content = m.content.slice(0, 100).replace(/\n/g, ' ').trim();
      const result = m.response ? m.response.slice(0, 80).replace(/\n/g, ' ').trim() : '';

      let line = `• [${time}] ${fromName} → ${toName}: ${content}`;
      if (result) {
        line += `\n  ↪ 回复: ${result}`;
      }
      return line;
    });

    return lines.join('\n');
  }

  /**
   * 将消息记录格式化为 LLM 历史消息数组（user/assistant 交替格式）
   * @param {Array} messages - 消息记录
   * @param {string} targetAgentId - 目标 Agent ID（用于确定 role 视角）
   * @returns {Array<{role:string,content:string}>}
   */
  _formatAsLLMHistory(messages, targetAgentId) {
    const history = [];
    for (const msg of messages) {
      // 发送方的消息
      history.push({
        role: msg.toAgent === targetAgentId ? 'user' : 'assistant',
        content: `[${msg.fromAgent}]: ${msg.content}`,
      });
      // 接收方的回复
      if (msg.response) {
        history.push({
          role: msg.toAgent === targetAgentId ? 'assistant' : 'user',
          content: `[${msg.toAgent}]: ${msg.response}`,
        });
      }
    }
    return history;
  }

  /**
   * 获取用户对话的摘要（用于给 Agent 提供背景）
   * @param {string} conversationId - 用户对话 ID
   * @returns {string} 简短的上下文摘要
   */
  _getUserContextSummary(conversationId) {
    if (!conversationId || !this.chatManager) {
      return '';
    }

    try {
      // 从 history-tool 获取对话历史
      const { getConversationHistory } = require('../tools/history-tool');
      const history = getConversationHistory(conversationId);

      if (!history || history.length === 0) {
        return '';
      }

      // 取最近几条消息构建摘要
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
  // 同步消息通信
  // ═══════════════════════════════════════════════════════════

  /**
   * Agent 发送消息给另一个 Agent（同步，等待回复）
   * 支持通信历史记忆、用户对话上下文，以及工具调用
   * 协作健壮性：消息队列、循环检测、嵌套深度限制、超时机制
   * @param {Object} params
   * @param {string} params.fromAgent - 发送方 Agent ID
   * @param {string} params.toAgent - 接收方 Agent ID
   * @param {string} params.message - 消息内容
   * @param {string} [params.conversationId] - 关联的用户对话 ID
   * @param {boolean} [params.includeUserContext=true] - 是否包含用户对话上下文
   * @param {boolean} [params.allowTools=true] - 是否允许目标 Agent 使用工具
   * @param {string[]} [params.callChain=[]] - 调用链（用于循环检测）
   * @param {number} [params.nestingDepth=0] - 当前嵌套深度
   * @param {number} [params.timeout] - 超时时间（毫秒）
   * @returns {Promise<{success: boolean, response?: string, error?: string}>}
   */
  async sendMessage(params) {
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
    } = params;

    if (!this.chatManager) {
      return { success: false, error: 'ChatManager 未初始化' };
    }

    // ═══════════════════════════════════════════════════════════
    // 协作健壮性检查
    // ═══════════════════════════════════════════════════════════

    // 1. 循环调用检测
    const cycleCheck = this._detectCycle(callChain, toAgent);
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

    // 2. 嵌套深度检查
    const depthCheck = this._checkNestingDepth(nestingDepth);
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

    // 检查目标 Agent 状态（system 消息不受限制）
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

    const targetAgent = this.chatManager.getAgent(toAgent);
    if (!targetAgent) {
      return { success: false, error: `找不到目标同事: ${toAgent}` };
    }

    const fromAgentInfo = this.chatManager.getAgent(fromAgent);
    const fromAgentName = fromAgentInfo?.name || fromAgent;

    // 构建新的调用链（用于传递给下层调用）
    const newCallChain = [...callChain, fromAgent];
    const newNestingDepth = nestingDepth + 1;

    logger.info(`Agent 通信: ${fromAgent} → ${toAgent}`, {
      message: message.slice(0, 100),
      allowTools,
      nestingDepth,
      callChainLength: newCallChain.length,
    });

    // ═══════════════════════════════════════════════════════════
    // 使用消息队列确保同一 Agent 串行处理
    // ═══════════════════════════════════════════════════════════
    const executeTask = async () => {
      const msgRecord = {
        id: this._generateId(),
        fromAgent,
        toAgent,
        content: message,
        response: '',
        status: 'pending',
        createdAt: Date.now(),
        context: conversationId,
      };

      this.messages.push(msgRecord);

      // 注册活跃任务追踪（让控制面板能看到 Agent 在工作），获取 taskId 用于完成时匹配
      const activityTaskId = this._trackAgentActivity(toAgent, `内部通信: 来自 ${fromAgentName}`);

      try {
        // 1. 构建分层通信历史（远期摘要 + 近期完整，避免上下文过长）
        let pairwiseHistory;
        let contextBlock = '';

        if (historyStrategy) {
          // 使用新的分层策略
          const ctx = this._buildContextHistory(fromAgent, toAgent, { strategy: historyStrategy });
          pairwiseHistory = ctx.history;
          contextBlock = ctx.contextBlock;
        } else if (maxHistory) {
          // 兼容旧调用：直接限制条数
          pairwiseHistory = this._getPairwiseHistory(fromAgent, toAgent, maxHistory);
          contextBlock = '━━━ 当前任务 ━━━\n\n';
        } else {
          // 默认：使用智能分层策略
          const ctx = this._buildContextHistory(fromAgent, toAgent, { strategy: 'full' });
          pairwiseHistory = ctx.history;
          contextBlock = ctx.contextBlock;
        }

        // 2. 获取用户对话上下文（如果有）
        let userContextPart = '';
        if (includeUserContext && conversationId) {
          const userSummary = this._getUserContextSummary(conversationId);
          if (userSummary) {
            userContextPart = `\n\n[用户对话背景]\n${userSummary}\n`;
          }
        }

        // 2.5 获取目标 Agent 的暂存区上下文（工作状态恢复）
        let scratchpadPart = '';
        try {
          const scratchpad = scratchpadManager.get(toAgent);
          if (scratchpad.hasContent()) {
            scratchpadPart = `\n\n${scratchpad.getContextSummary()}`;
          }
        } catch (err) {
          logger.debug('获取暂存区失败', { toAgent, error: err.message });
        }

        // 3. 构建给目标 Agent 的消息（添加上下文分隔标记）
        const contextMessage = `${contextBlock}${scratchpadPart}[内部消息 - 来自 ${fromAgentName} (${fromAgent})]${userContextPart}\n\n${message}`;

        // 4. 调用目标 Agent
        logger.debug(`Agent 通信历史条数: ${pairwiseHistory.length}`);

        let response;
        let toolsUsed = [];
        if (allowTools && this.toolExecutor) {
          // 使用工具调用循环，传递调用链和嵌套深度
          const loopResult = await this._chatWithToolLoop(targetAgent, contextMessage, pairwiseHistory, {
            conversationId,
            fromAgent,
            isInternalCommunication: true,
            callChain: newCallChain,
            nestingDepth: newNestingDepth,
          });
          response = loopResult.content;
          toolsUsed = loopResult.toolsUsed || [];
        } else {
          // 不使用工具，直接调用
          response = await targetAgent.chat(contextMessage, pairwiseHistory, { stream: false });
        }

        msgRecord.response = response;
        msgRecord.status = 'responded';
        msgRecord.respondedAt = Date.now();

        this._saveToDisk();

        logger.info(`Agent 通信完成: ${fromAgent} ← ${toAgent}`, {
          responseLength: response.length,
          historyUsed: pairwiseHistory.length,
          allowTools,
          nestingDepth,
          toolsUsed,
        });

        // 异步触发记忆提取
        this._triggerMemoryExtraction('communication', {
          fromAgent,
          toAgent,
          message,
          response,
        });

        return { success: true, response, toolsUsed };
      } catch (error) {
        msgRecord.status = 'failed';
        msgRecord.response = error.message;
        this._saveToDisk();

        logger.error(`Agent 通信失败: ${fromAgent} → ${toAgent}`, error);
        return { success: false, error: error.message };
      } finally {
        this._untrackAgentActivity(toAgent, activityTaskId);
      }
    };

    // 将任务加入目标 Agent 的队列，并应用超时
    try {
      const result = await this._withTimeout(
        this._enqueue(toAgent, executeTask),
        timeout,
        `与 ${toAgent} 通信`
      );
      return result;
    } catch (error) {
      logger.error(`Agent 通信超时或异常: ${fromAgent} → ${toAgent}`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取 Agent 的通信记录
   * @param {string} agentId
   * @param {Object} [options]
   * @param {number} [options.limit=20]
   * @returns {AgentMessage[]}
   */
  getMessages(agentId, options = {}) {
    const { limit = 20 } = options;
    return this.messages
      .filter((m) => m.fromAgent === agentId || m.toAgent === agentId)
      .slice(-limit);
  }

  // ═══════════════════════════════════════════════════════════
  // 历史分页查询
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取两个 Agent 之间的通信历史总数
   * @param {string} agentA - Agent A ID
   * @param {string} agentB - Agent B ID
   * @returns {{total: number, totalPages: number, pageSize: number}}
   */
  getPairwiseHistoryInfo(agentA, agentB) {
    const pairMessages = this.messages.filter(
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

  /**
   * 分页获取两个 Agent 之间的通信历史
   * @param {string} agentA - Agent A ID（当前 Agent）
   * @param {string} agentB - Agent B ID（对方 Agent）
   * @param {Object} [options]
   * @param {number} [options.page=1] - 页码（1 开始，1 = 最新一页）
   * @param {number} [options.pageSize=HISTORY_PAGE_SIZE] - 每页条数
   * @returns {{
   *   messages: Array<{id: string, from: string, to: string, content: string, response: string, time: string}>,
   *   page: number,
   *   totalPages: number,
   *   total: number,
   *   hasMore: boolean
   * }}
   */
  getPairwiseHistoryPaginated(agentA, agentB, options = {}) {
    const { page = 1, pageSize = HISTORY_PAGE_SIZE } = options;
    const { formatLocalTime } = require('../utils/time-format');

    // 筛选并按时间排序（最新在后）
    const pairMessages = this.messages
      .filter(
        (m) =>
          ((m.fromAgent === agentA && m.toAgent === agentB) ||
            (m.fromAgent === agentB && m.toAgent === agentA)) &&
          m.status === 'responded'
      )
      .sort((a, b) => a.createdAt - b.createdAt);

    const total = pairMessages.length;
    const totalPages = Math.ceil(total / pageSize);

    // 计算分页（从后往前）
    // page=1 表示最新一页（最后 pageSize 条）
    // page=2 表示倒数第二页，以此类推
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

    // 格式化消息（截断过长内容防止 token 爆炸）
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

  /**
   * 获取 Agent 的所有通信历史（分页）
   * @param {string} agentId - Agent ID
   * @param {Object} [options]
   * @param {number} [options.page=1] - 页码
   * @param {number} [options.pageSize=HISTORY_PAGE_SIZE] - 每页条数
   * @param {string} [options.withAgent] - 筛选与特定 Agent 的通信
   * @returns {Object}
   */
  getMessagesPaginated(agentId, options = {}) {
    const { page = 1, pageSize = HISTORY_PAGE_SIZE, withAgent } = options;
    const { formatLocalTime } = require('../utils/time-format');

    // 筛选消息
    let filteredMessages = this.messages.filter(
      (m) => (m.fromAgent === agentId || m.toAgent === agentId) && m.status === 'responded'
    );

    // 如果指定了对方 Agent，进一步筛选
    if (withAgent) {
      filteredMessages = filteredMessages.filter(
        (m) => m.fromAgent === withAgent || m.toAgent === withAgent
      );
    }

    // 按时间排序
    filteredMessages.sort((a, b) => a.createdAt - b.createdAt);

    const total = filteredMessages.length;
    const totalPages = Math.ceil(total / pageSize);

    // 计算分页（从后往前，page=1 是最新）
    const endIndex = total - (page - 1) * pageSize;
    const startIndex = Math.max(0, endIndex - pageSize);

    if (startIndex >= endIndex || page < 1) {
      return {
        messages: [],
        page,
        totalPages,
        total,
        hasMore: false,
      };
    }

    const pageMessages = filteredMessages.slice(startIndex, endIndex);

    // 格式化（截断过长内容防止 token 爆炸）
    const formattedMessages = pageMessages.map((m) => ({
      id: m.id,
      direction: m.fromAgent === agentId ? 'sent' : 'received',
      peer: m.fromAgent === agentId ? m.toAgent : m.fromAgent,
      content: truncateForBrowse(m.content),
      response: m.response ? truncateForBrowse(m.response) : null,
      time: formatLocalTime(m.createdAt),
    }));

    return {
      messages: formattedMessages,
      page,
      totalPages,
      total,
      hasMore: page < totalPages,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 异步任务委派
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取任务相关的历史讨论（用于任务执行上下文）
   * @param {DelegatedTask} task - 任务对象
   * @returns {Array<{role: string, content: string}>} LLM 格式的历史消息
   */
  _getTaskHistory(task) {
    const history = [];

    // 添加任务讨论记录作为历史
    for (const disc of task.discussion || []) {
      history.push({
        role: disc.agent === task.toAgent ? 'assistant' : 'user',
        content: `[${disc.agent}]: ${disc.content}`,
      });
    }

    // 也添加双方之间的相关通信记录
    const pairwiseHistory = this._getPairwiseHistory(task.fromAgent, task.toAgent, 5);

    return [...pairwiseHistory, ...history];
  }

  /**
   * 委派任务给另一个 Agent
   * 现在支持通信历史和用户上下文
   * @param {Object} params
   * @param {string} params.fromAgent - 委派方 Agent ID
   * @param {string} params.toAgent - 被委派方 Agent ID
   * @param {string} params.taskDescription - 任务描述
   * @param {number} [params.priority=3] - 优先级 (1-5)
   * @param {boolean} [params.waitForResult=false] - 是否等待结果
   * @param {string} [params.conversationId] - 关联的用户对话
   * @param {boolean} [params.includeUserContext=true] - 是否包含用户对话上下文
   * @returns {Promise<{success: boolean, taskId: string, result?: string}>}
   */
  async delegateTask(params) {
    const {
      fromAgent,
      toAgent,
      taskDescription,
      priority = 3,
      waitForResult = false,
      conversationId,
      includeUserContext = true,
      gitBranch = null,
      gitWorkspace = null,
      requirePlanApproval = false,
    } = params;

    if (!this.chatManager) {
      return { success: false, error: 'ChatManager 未初始化' };
    }

    // 防止自我委派（项目负责人不能给自己委派任务，否则会产生自我审阅循环）
    if (fromAgent === toAgent) {
      logger.warn(`阻止自我委派: ${fromAgent} 试图给自己委派任务`, { taskDescription: taskDescription?.slice(0, 100) });
      return { success: false, error: '不能给自己委派任务' };
    }

    // 检查目标 Agent 状态
    const targetConfig = agentConfigStore.get(toAgent);
    const targetStatus = targetConfig?.status || 'active';
    if (targetStatus === 'suspended') {
      return { success: false, error: `${targetConfig?.name || toAgent} 当前处于停职状态，无法接收任务。` };
    }
    if (targetStatus === 'terminated') {
      return { success: false, error: `${targetConfig?.name || toAgent} 已离职，无法接收任务。` };
    }

    const targetAgent = this.chatManager.getAgent(toAgent);
    if (!targetAgent) {
      return { success: false, error: `找不到目标同事: ${toAgent}` };
    }

    const fromAgentInfo = this.chatManager.getAgent(fromAgent);
    const fromAgentName = fromAgentInfo?.name || fromAgent;

    // 获取用户对话上下文
    let userContextSummary = '';
    if (includeUserContext && conversationId) {
      userContextSummary = this._getUserContextSummary(conversationId);
    }

    const task = {
      id: this._generateId(),
      fromAgent,
      fromAgentName,
      toAgent,
      taskDescription,
      status: 'pending',
      priority,
      createdAt: Date.now(),
      conversationId,
      userContextSummary,
      gitBranch: gitBranch || null,
      gitWorkspace: gitWorkspace || null,
      planApprovalRequired: requirePlanApproval,
      planStatus: requirePlanApproval ? 'planning' : null,
      discussion: [],
    };

    this.delegatedTasks.push(task);
    this._saveToDisk();

    // 同步创建运营系统 task（Dashboard 可追踪）
    try {
      const { operationsStore } = require('../operations/operations-store');
      const opsTask = operationsStore.createTask({
        title: taskDescription.slice(0, 80),
        description: taskDescription,
        priority: priority <= 2 ? 'high' : priority <= 3 ? 'medium' : 'low',
        assigneeId: toAgent,
        assigneeName: targetAgent.name,
        requesterId: fromAgent,
        requesterName: fromAgentName,
      });
      // 在委派任务上保存运营任务 ID，方便后续状态同步
      task.opsTaskId = opsTask.id;
      this._saveToDisk();
      logger.info(`运营任务已创建: ${opsTask.id}`, { delegatedTaskId: task.id });
    } catch (error) {
      logger.warn('创建运营任务失败（不影响委派）:', error.message);
    }

    logger.info(`任务委派: ${fromAgent} → ${toAgent}`, {
      taskId: task.id,
      description: taskDescription.slice(0, 100),
      hasUserContext: !!userContextSummary,
    });

    if (waitForResult) {
      // 同步执行任务并等待结果
      return await this.executeTask(task.id);
    }

    // 异步执行任务（不阻塞调用方，但任务会在后台实际执行）
    setImmediate(async () => {
      try {
        logger.info(`异步执行委派任务: ${task.id}`, { executor: toAgent });
        await this.executeTask(task.id);
      } catch (error) {
        logger.error(`异步任务执行失败: ${task.id}`, error);
      }
    });

    return { success: true, taskId: task.id, message: '任务已委派，正在后台执行' };
  }

  /**
   * 执行委派的任务
   * 支持任务历史、用户上下文，以及工具调用
   * @param {string} taskId
   * @param {Object} [options]
   * @param {boolean} [options.allowTools=true] - 是否允许使用工具
   * @returns {Promise<{success: boolean, result?: string, error?: string}>}
   */
  async executeTask(taskId, options = {}) {
    const { allowTools = true } = options;

    const task = this.delegatedTasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `任务不存在: ${taskId}` };
    }

    // 允许 awaiting_plan_approval 状态的任务在计划批准后重新进入执行
    if (task.status !== 'pending' && task.status !== 'in_progress' && task.status !== 'awaiting_plan_approval') {
      return { success: false, error: `任务状态不正确: ${task.status}` };
    }

    // 检查执行者状态
    const executorConfig = agentConfigStore.get(task.toAgent);
    const executorStatus = executorConfig?.status || 'active';
    if (executorStatus === 'suspended') {
      task.status = 'failed';
      task.result = `执行者 ${executorConfig?.name || task.toAgent} 处于停职状态，无法执行任务`;
      this._saveToDisk();
      return { success: false, error: task.result };
    }
    if (executorStatus === 'terminated') {
      task.status = 'failed';
      task.result = `执行者 ${executorConfig?.name || task.toAgent} 已离职，无法执行任务`;
      this._saveToDisk();
      return { success: false, error: task.result };
    }

    const targetAgent = this.chatManager?.getAgent(task.toAgent);
    if (!targetAgent) {
      task.status = 'failed';
      task.result = '找不到执行者';
      this._saveToDisk();
      return { success: false, error: '找不到执行者' };
    }

    // ═══════════════════════════════════════════════════════════
    // Phase 1: 规划阶段（如果需要开发计划审批且尚未通过）
    // ═══════════════════════════════════════════════════════════
    if (task.planApprovalRequired && task.planStatus !== 'approved') {
      // 如果是驳回后重新进入规划，获取反馈信息
      const { devPlanQueue } = require('./dev-plan-queue');
      const latestPlan = devPlanQueue.getByTask(task.id);
      const rejectionFeedback = (task.planStatus === 'planning' && latestPlan?.status === 'rejected')
        ? latestPlan.feedback
        : null;

      task.status = 'in_progress';
      task.planStatus = task.planStatus || 'planning';
      if (!task.startedAt) task.startedAt = Date.now();
      if (!task.discussion) task.discussion = [];
      this._saveToDisk();

      const fromAgentName = task.fromAgentName || task.fromAgent;

      // 注册活跃任务追踪，获取 taskId 用于完成时匹配
      const planActivityTaskId = this._trackAgentActivity(task.toAgent, `规划任务: 来自 ${fromAgentName}`);

      logger.info(`进入规划阶段: ${task.id}`, {
        executor: task.toAgent,
        planStatus: task.planStatus,
        hasRejectionFeedback: !!rejectionFeedback,
      });

      try {
        const taskHistory = this._getTaskHistory(task);

        let userContextPart = '';
        if (task.userContextSummary) {
          userContextPart = `\n\n[用户对话背景]\n${task.userContextSummary}\n`;
        }

        // 获取目标 Agent 的暂存区上下文（工作状态恢复）
        let planScratchpadContext = '';
        try {
          const scratchpad = scratchpadManager.get(task.toAgent);
          if (scratchpad.hasContent()) {
            planScratchpadContext = `\n${scratchpad.getContextSummary()}\n`;
          }
        } catch (err) {
          logger.debug('获取暂存区失败', { toAgent: task.toAgent, error: err.message });
        }

        // 构建规划阶段的消息
        let feedbackSection = '';
        if (rejectionFeedback) {
          feedbackSection = `
═══════════════════════════════════════
上级反馈（你之前的计划被驳回）：
═══════════════════════════════════════
${rejectionFeedback}

请根据以上反馈修改你的开发计划，然后用 submit_dev_plan 重新提交。
`;
        }

        const planningMessage = `[工作指令 - 来自上级 ${fromAgentName}]${userContextPart}${planScratchpadContext}
═══════════════════════════════════════
任务要求：
═══════════════════════════════════════
${task.taskDescription}
${feedbackSection}
═══════════════════════════════════════
重要：此任务需要先提交开发计划审批
═══════════════════════════════════════

你当前处于【规划阶段】，只能使用以下工具：
- read_file / list_files：调研代码和项目结构
- send_to_agent / list_colleagues：与同事沟通、了解情况
- submit_dev_plan：提交开发计划

你现在不能写代码、执行命令或做 Git 操作。

请按以下步骤操作：
1. 使用 read_file 和 list_files 充分调研代码
2. 制定开发计划，内容需包含：
   - 目标：要实现什么
   - 技术方案：怎么实现、用什么技术
   - 影响范围：涉及哪些文件/模块
   - 预估工时：大约需要多少时间
   - 风险点：可能遇到的问题
3. 使用 submit_dev_plan(plan_content="你的计划") 提交审批

审批通过后，系统会自动解锁所有开发工具，你就可以开始编码了。`;

        // 规划阶段使用受限工具集
        const planLoopResult = await this._chatWithToolLoop(
          targetAgent,
          planningMessage,
          taskHistory,
          {
            conversationId: task.conversationId,
            fromAgent: task.fromAgent,
            taskId: task.id,
            isInternalCommunication: true,
          },
          {
            toolFilter: 'planning',
            onToolExecuted: (toolCalls) => {
              // 当 submit_dev_plan 被调用时，中断循环
              const submitted = toolCalls.some((tc) => tc.name === 'submit_dev_plan');
              if (submitted) {
                return { shouldBreak: true };
              }
              return null;
            },
          }
        );
        const planResult = planLoopResult.content;

        // 规划阶段完成，任务进入等待审批状态
        if (task.planStatus === 'submitted') {
          task.status = 'awaiting_plan_approval';
          task.discussion.push({
            agent: task.toAgent,
            content: `[规划阶段] ${planResult}`,
            timestamp: Date.now(),
          });
          this._saveToDisk();

          logger.info(`任务进入等待审批状态: ${task.id}`, { executor: task.toAgent });

          return {
            success: true,
            taskId: task.id,
            status: 'awaiting_plan_approval',
            message: '员工已提交开发计划，等待审批',
          };
        }

        // 如果员工没有调用 submit_dev_plan（规划循环结束但没提交），提示错误
        logger.warn(`规划阶段结束但未提交计划: ${task.id}`);
        task.discussion.push({
          agent: task.toAgent,
          content: `[规划阶段 - 未提交计划] ${planResult}`,
          timestamp: Date.now(),
        });
        this._saveToDisk();

        return {
          success: false,
          taskId: task.id,
          error: '员工未提交开发计划',
        };
      } catch (error) {
        task.status = 'failed';
        task.result = `规划阶段失败: ${error.message}`;
        task.completedAt = Date.now();
        this._saveToDisk();
        this._syncOpsTaskStatus(task, 'cancelled', error.message);
        logger.error(`规划阶段执行失败: ${task.id}`, error);
        return { success: false, error: error.message };
      } finally {
        this._untrackAgentActivity(task.toAgent, planActivityTaskId);
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Phase 2: 正常执行阶段（计划已通过或不需要审批）
    // ═══════════════════════════════════════════════════════════

    task.status = 'in_progress';
    if (!task.startedAt) task.startedAt = Date.now();
    if (!task.discussion) task.discussion = [];
    this._saveToDisk();

    // 注册活跃任务追踪，获取 taskId 用于完成时匹配
    const execActivityTaskId = this._trackAgentActivity(task.toAgent, `执行任务: 来自 ${task.fromAgentName || task.fromAgent}`);

    logger.info(`开始执行任务: ${task.id}`, { executor: task.toAgent, allowTools, planApproved: task.planStatus === 'approved' });

    try {
      // 1. 获取任务相关的历史上下文
      const taskHistory = this._getTaskHistory(task);

      // 2. 构建用户对话上下文部分
      let userContextPart = '';
      if (task.userContextSummary) {
        userContextPart = `\n\n[用户对话背景]\n${task.userContextSummary}\n`;
      }

      // 2.5 获取目标 Agent 的暂存区上下文（工作状态恢复）
      let scratchpadContext = '';
      try {
        const scratchpad = scratchpadManager.get(task.toAgent);
        if (scratchpad.hasContent()) {
          scratchpadContext = `\n${scratchpad.getContextSummary()}\n`;
        }
      } catch (err) {
        logger.debug('获取暂存区失败', { toAgent: task.toAgent, error: err.message });
      }

      // 3. 构建任务执行消息（必须足够明确，Agent 要知道这是工作指令而非闲聊）
      const fromAgentName = task.fromAgentName || task.fromAgent;

      // 构建 Git 工作流指令（如果有 Git 分支）
      let gitInstructions = '';
      if (task.gitBranch) {
        gitInstructions = `
═══════════════════════════════════════
Git 工作流（强制执行）：
═══════════════════════════════════════
你的工作分支: ${task.gitBranch}
工作区路径: ${task.gitWorkspace || '（使用默认工作区）'}

你必须按以下流程工作：
1. 开始前：用 git_branch 切换到工作分支 ${task.gitBranch}
   <tool_call><name>git_branch</name><arguments><action>checkout</action><branch_name>${task.gitBranch}</branch_name></arguments></tool_call>
2. 编码：在该分支上读取代码、编写代码（使用 read_file / write_file）
3. 每完成一个功能点：用 git_commit 提交
   <tool_call><name>git_commit</name><arguments><message>描述你做了什么</message></arguments></tool_call>
4. 全部完成后：用 git_create_pr 提交 Pull Request 给上级审核
   <tool_call><name>git_create_pr</name><arguments><title>任务标题</title><description>完成了什么</description><source_branch>${task.gitBranch}</source_branch><target_branch>main</target_branch></arguments></tool_call>

严禁：
- 不切换分支就直接写代码
- 写完代码不 commit
- 不提 PR 就汇报"完成了"
`;
      }

      // 如果计划已批准，注入批准信息
      let planApprovalNote = '';
      if (task.planApprovalRequired && task.planStatus === 'approved') {
        const { devPlanQueue } = require('./dev-plan-queue');
        const approvedPlan = devPlanQueue.getByTask(task.id);
        if (approvedPlan) {
          planApprovalNote = `
═══════════════════════════════════════
开发计划（已批准）：
═══════════════════════════════════════
${approvedPlan.content}
${approvedPlan.approveComment ? `\n上级备注：${approvedPlan.approveComment}` : ''}

请严格按照以上已批准的计划执行开发工作。
`;
        }
      }

      const taskMessage = `[工作指令 - 来自上级 ${fromAgentName}]${userContextPart}${scratchpadContext}
═══════════════════════════════════════
任务要求（你必须完成以下工作）：
═══════════════════════════════════════
${task.taskDescription}
${planApprovalNote}${gitInstructions}
═══════════════════════════════════════
执行规范：
═══════════════════════════════════════
1. 这是一个工作任务，不是闲聊。你必须立即开始执行，不要反问"需要我帮什么"
2. 使用工具完成实际工作（读文件、写代码、执行命令等），不要只是描述你"打算"做什么
3. 完成所有工作后，汇报你实际做了什么、产出了什么文件、遇到了什么问题
4. 可用的工具名：read_file（读文件）、write_file（写文件）、list_files（列目录）、shell（执行命令）、git_branch / git_commit / git_create_pr（Git 操作）
5. 不要使用 fs_write、read_code、list_dir、execute_command 等错误工具名`;

      // 4. 调用目标 Agent
      logger.debug(`任务执行历史条数: ${taskHistory.length}`);

      let result;
      let toolsUsedInTask = [];
      if (allowTools && this.toolExecutor) {
        // 使用工具调用循环
        const loopResult = await this._chatWithToolLoop(targetAgent, taskMessage, taskHistory, {
          conversationId: task.conversationId,
          fromAgent: task.fromAgent,
          taskId: task.id,
          isInternalCommunication: true,
        });
        result = loopResult.content;
        toolsUsedInTask = loopResult.toolsUsed || [];
      } else {
        // 不使用工具，直接调用
        result = await targetAgent.chat(taskMessage, taskHistory, { stream: false });
      }

      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      if (!task.discussion) task.discussion = [];
      task.discussion.push({
        agent: task.toAgent,
        content: result,
        timestamp: Date.now(),
      });

      this._saveToDisk();

      // ─── 同步更新运营系统 task 状态 ────────────────────────────
      this._syncOpsTaskStatus(task, 'review', result);
      this._notifyPMEngine('completed', task.id);

      logger.info(`任务完成: ${task.id}`, {
        resultLength: result.length,
        historyUsed: taskHistory.length,
        allowTools,
      });

      // 异步触发记忆提取
      this._triggerMemoryExtraction('task', {
        taskId: task.id,
        fromAgent: task.fromAgent,
        toAgent: task.toAgent,
        taskDescription: task.taskDescription,
        result,
        wasRejected: false,
      });

      // ─── 任务完成后自动触发上司审阅流程 ────────────────────────
      // 员工完成 → 向上司提交报告 → 上司审阅 → 推回/汇报老板
      this._triggerSupervisorReview(task, result);

      return { success: true, taskId: task.id, result };
    } catch (error) {
      task.status = 'failed';
      task.result = error.message;
      task.completedAt = Date.now();
      this._saveToDisk();

      // 同步运营系统 task 状态为 cancelled
      this._syncOpsTaskStatus(task, 'cancelled', error.message);
      this._notifyPMEngine('failed', task.id);

      logger.error(`任务执行失败: ${task.id}`, error);
      return { success: false, error: error.message };
    } finally {
      this._untrackAgentActivity(task.toAgent, execActivityTaskId);
    }
  }

  /**
   * 任务完成后触发上司审阅流程
   * 员工完成任务 → 自动向上司提交报告 → 上司审阅 → 推回或汇报老板
   * @param {DelegatedTask} task - 已完成的任务
   * @param {string} result - 任务执行结果
   */
  _triggerSupervisorReview(task, result) {
    if (!this.chatManager) return;

    // 如果委派者和执行者是同一个人，跳过自我审阅，直接推送结果给老板
    if (task.fromAgent === task.toAgent) {
      const selfAgent = this.chatManager.getAgent(task.fromAgent);
      const selfName = selfAgent?.name || task.fromAgent;
      logger.info(`跳过自我审阅: ${selfName} 既是委派者又是执行者`, { taskId: task.id });

      // 直接通知老板完成
      const resultPreview = result.length > 500 ? result.slice(0, 500) + '...' : result;
      this.chatManager.pushProactiveMessage(task.fromAgent,
        `任务已完成：${task.taskDescription.slice(0, 100)}\n\n结果：${resultPreview}`
      );

      // 同步运营状态
      this._syncOpsTaskStatus(task, 'done', '任务完成（自行执行）');
      this._notifyPMEngine('approved', task.id);
      return;
    }

    const fromAgent = this.chatManager.getAgent(task.fromAgent);
    const toAgent = this.chatManager.getAgent(task.toAgent);
    const fromAgentName = fromAgent?.name || task.fromAgentName || task.fromAgent;
    const toAgentName = toAgent?.name || task.toAgent;

    // 截断过长的结果（避免消息过大）
    const resultPreview = result.length > 2000 ? result.slice(0, 2000) + '\n\n...(结果已截断，完整内容请查看任务记录)' : result;

    logger.info(`触发上司审阅: ${toAgentName} → ${fromAgentName}`, {
      taskId: task.id,
      resultLength: result.length,
    });

    // 通知用户
    this.chatManager.pushProactiveMessage(task.fromAgent,
      `${toAgentName} 已完成任务并提交了工作报告，我正在审阅...`
    );

    // 异步触发上司审阅
    setImmediate(async () => {
      try {
        const reviewMsg = `【系统通知 - 下属任务完成报告】

你的下属 ${toAgentName} (${task.toAgent}) 已完成你委派的任务并提交了工作报告。

【委派的任务】
${task.taskDescription.slice(0, 500)}

【${toAgentName} 的完成报告】
${resultPreview}

【任务 ID】${task.id}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
请立即审阅并决定下一步行动：

1. **如果工作质量合格、任务已完成**：
   - 使用 notify_boss 向老板汇报工作成果，包括：员工姓名、任务内容、完成情况、产出质量评价
   - 示例：notify_boss(message="老板，${toAgentName}已完成XX任务，产出质量..., 总结...")

2. **如果工作质量不足或任务未完全完成**：
   - 使用 delegate_task(target_agent="${task.toAgent}", task_description="具体的修改要求和改进意见...", wait_for_result=false) 布置修改任务
   - 修改任务完成后你会再次收到审阅通知，形成"审阅→推回→修改→再审阅"的循环
   - 注意：请使用 delegate_task 而非 send_to_agent，这样修改完成后系统会自动通知你再次审阅

3. **【必须】更新项目进度**：
   - 审阅后，使用 ops_list_goals 查看当前项目目标
   - 如果有关联目标，使用 ops_update_goal 更新目标进度和状态（根据此任务完成情况调整 progress 百分比）
   - 如果还没有项目目标，使用 ops_create_goal 创建一个项目目标，然后更新进度
   - 老板通过控制面板查看项目进展，你必须保持进度信息最新！
   - 示例：ops_update_goal(goal_id="xxx", progress=30, status="in_progress")

4. **你的审阅应当包含**：
   - 产出是否符合任务要求
   - 质量评价（专业度、完整性、可行性）
   - 具体的改进建议（如果需要）

⚠️⚠️⚠️ 极其重要：
- 你必须调用工具来执行操作！在文字中描述"我已汇报"或"我已写入文件"是无效的！
- 如果你认为工作合格 → 必须调用 notify_boss(message="你的汇报内容") 工具
- 如果你认为需要返工 → 必须调用 delegate_task(target_agent="${task.toAgent}", task_description="修改要求", wait_for_result=false) 工具
- 审阅后必须更新项目进度 → 调用 ops_list_goals 和 ops_update_goal（或 ops_create_goal）
- 不调用工具 = 什么都没做！

请立刻开始审阅并调用相应工具，不要等待进一步指示。`;

        const reviewResult = await this.sendMessage({
          fromAgent: 'system',
          toAgent: task.fromAgent,
          message: reviewMsg,
          allowTools: true,
          historyStrategy: 'focused', // 审阅用专注策略：只保留最近 2 条 + 强分隔，避免 LLM 迷失
        });

        // 检查上司是否实际调用了工具（notify_boss 或 delegate_task）
        // 使用 sendMessage 返回的 toolsUsed，避免实例级共享问题
        const reviewToolsUsed = reviewResult?.toolsUsed || [];
        const usedNotifyBoss = reviewToolsUsed.includes('notify_boss');
        const usedDelegateTask = reviewToolsUsed.includes('delegate_task');

        if (usedDelegateTask) {
          // 上司退回任务 → 运营任务状态回到 in_progress
          this._syncOpsTaskStatus(task, 'in_progress', '上司要求返工修改');
          // PM 引擎钩子：审阅退回
          this._notifyPMEngine('rejected', task.id);
        } else {
          // 上司通过或未调用工具 → 运营任务标记完成
          this._syncOpsTaskStatus(task, 'done', '上司审阅通过');
          // PM 引擎钩子：审阅通过
          this._notifyPMEngine('approved', task.id);
        }

        if (!usedNotifyBoss && !usedDelegateTask) {
          const supervisorResponse = reviewResult?.response || '';

          // ─── 意图检测：上司是否表达了退回/返工意图但没调用工具？ ───
          const rejectKeywords = ['重新', '返工', '不符合', '执行有误', '有误', '不正确', '需要修改', '让他', '退回', '打回', '重做', '不合格', '需要改'];
          const wantsReject = rejectKeywords.some((kw) => supervisorResponse.includes(kw));

          if (wantsReject) {
            // 上司想退回但没调用工具 → 系统自动执行退回
            logger.info(`检测到退回意图，系统自动退回任务: ${fromAgentName} → ${toAgentName}`, {
              taskId: task.id,
              responsePreview: supervisorResponse.slice(0, 100),
            });

            // 从上司的回复中提取修改要求作为新任务描述
            const reworkDescription = `【${fromAgentName}审阅退回】\n\n你之前提交的任务被上司退回，原因如下：\n${supervisorResponse.slice(0, 800)}\n\n请根据上述反馈重新执行任务。原始任务：\n${task.taskDescription.slice(0, 500)}`;

            try {
              await this.delegateTask({
                fromAgent: task.fromAgent,
                toAgent: task.toAgent,
                taskDescription: reworkDescription,
                priority: 2,
                waitForResult: false,
                conversationId: task.conversationId,
              });

              // 修正运营状态和 PM 状态
              this._syncOpsTaskStatus(task, 'in_progress', `${fromAgentName}审阅退回，要求返工`);
              this._notifyPMEngine('rejected', task.id);

              // 通知老板
              this.chatManager.pushProactiveMessage(task.fromAgent,
                `${fromAgentName}审阅了${toAgentName}的工作，发现问题并已自动退回返工：\n${supervisorResponse.slice(0, 200)}`
              );
            } catch (delegateError) {
              logger.error('自动退回任务失败:', delegateError);
              // 退回失败，把审阅内容推给老板
              this.chatManager.pushProactiveMessage(task.fromAgent,
                `【${toAgentName}任务报告审阅】\n\n${supervisorResponse}\n\n⚠️ 系统尝试自动退回任务但失败，请手动处理。`
              );
            }
          } else {
            // 上司没表达退回意图（可能认为合格但忘了调用 notify_boss）→ 推送给老板
            logger.warn(`上司审阅未调用工具，自动推送审阅结果给老板: ${fromAgentName}`, {
              taskId: task.id,
              responsePreview: supervisorResponse.slice(0, 100),
            });

            const bossMsg = supervisorResponse.trim()
              ? `【${toAgentName}任务报告审阅】\n\n${supervisorResponse}`
              : `${toAgentName} 已完成任务「${task.taskDescription.slice(0, 60)}」，${fromAgentName}已审阅。`;

            this.chatManager.pushProactiveMessage(task.fromAgent, bossMsg);
            logger.info(`自动推送审阅结果完成: ${fromAgentName} → 老板`, { taskId: task.id });
          }
        }

        logger.info(`上司审阅完成: ${fromAgentName} 已审阅 ${toAgentName} 的报告`, {
          taskId: task.id,
        });
      } catch (error) {
        logger.error(`触发上司审阅失败: ${task.id}`, error);
        // 即使审阅失败，也通知用户
        this.chatManager.pushProactiveMessage(task.fromAgent,
          `审阅 ${toAgentName} 的工作报告时遇到了问题：${error.message}`
        );
      }
    });
  }

  /**
   * 同步运营系统 task 状态
   * 将委派任务的状态变化同步到 Dashboard 运营系统
   * @param {DelegatedTask} task - 委派任务
   * @param {string} opsStatus - 运营 task 状态: todo, in_progress, review, done, cancelled
   * @param {string} [progressNote] - 进度说明
   */
  _syncOpsTaskStatus(task, opsStatus, progressNote = '') {
    if (!task.opsTaskId) return;

    try {
      const { operationsStore } = require('../operations/operations-store');
      const config = agentConfigStore.get(task.toAgent) || {};

      const updates = { status: opsStatus };
      operationsStore.updateTask(
        task.opsTaskId,
        updates,
        task.toAgent,
        config.name || task.toAgent
      );

      // 记录进度日志
      if (progressNote) {
        const opsTask = operationsStore.getTask(task.opsTaskId);
        if (opsTask) {
          if (!opsTask.progressLog) opsTask.progressLog = [];
          opsTask.progressLog.push({
            agent: task.toAgent,
            agentName: config.name || task.toAgent,
            content: progressNote,
            timestamp: Date.now(),
          });
          operationsStore.saveToDisk();
        }
      }

      logger.debug(`运营 task 状态同步: ${task.opsTaskId} → ${opsStatus}`, {
        delegatedTaskId: task.id,
        progressNote,
      });
    } catch (error) {
      logger.warn('同步运营 task 状态失败:', error.message);
    }
  }

  /**
   * 通知 PM 引擎（钩子）
   * @param {'approved'|'rejected'|'completed'|'failed'} event
   * @param {string} delegatedTaskId
   */
  /**
   * 异步触发记忆系统提取
   * @param {'communication'|'task'} type
   * @param {Object} params
   */
  _triggerMemoryExtraction(type, params) {
    try {
      // 延迟 require 避免循环依赖
      const { memoryManager } = require('../memory');
      if (!memoryManager || !memoryManager._initialized) return;

      if (type === 'communication') {
        memoryManager.onCommunicationComplete(params);
      } else if (type === 'task') {
        memoryManager.onTaskComplete(params);
      }
    } catch (error) {
      // 记忆系统可能未初始化，静默忽略
      logger.debug('记忆提取触发失败（可能未初始化）:', error.message);
    }
  }

  _notifyPMEngine(event, delegatedTaskId) {
    try {
      // 延迟 require 避免循环依赖
      const { pmEngine } = require('../pm');
      if (!pmEngine) return;

      if (event === 'approved') {
        pmEngine.onTaskReviewApproved(delegatedTaskId);
      } else if (event === 'rejected') {
        pmEngine.onTaskReviewRejected(delegatedTaskId);
      } else if (event === 'completed') {
        pmEngine.onDelegatedTaskStatusChange(delegatedTaskId, 'completed');
      } else if (event === 'failed') {
        pmEngine.onDelegatedTaskStatusChange(delegatedTaskId, 'failed');
      }
    } catch (error) {
      // PM 引擎可能还没初始化，静默忽略
      logger.debug('PM 引擎通知失败（可能未初始化）:', error.message);
    }
  }

  /**
   * 获取 Agent 的委派任务
   * @param {string} agentId
   * @param {Object} [options]
   * @param {'all' | 'assigned' | 'received'} [options.type='all']
   * @param {string} [options.status]
   * @returns {DelegatedTask[]}
   */
  getTasks(agentId, options = {}) {
    const { type = 'all', status } = options;

    let tasks = this.delegatedTasks;

    if (type === 'assigned') {
      tasks = tasks.filter((t) => t.fromAgent === agentId);
    } else if (type === 'received') {
      tasks = tasks.filter((t) => t.toAgent === agentId);
    } else {
      tasks = tasks.filter((t) => t.fromAgent === agentId || t.toAgent === agentId);
    }

    if (status) {
      tasks = tasks.filter((t) => t.status === status);
    }

    return tasks;
  }

  /**
   * 获取待处理的任务（分配给某 Agent 的）
   * @param {string} agentId
   * @returns {DelegatedTask[]}
   */
  getPendingTasks(agentId) {
    return this.delegatedTasks.filter(
      (t) => t.toAgent === agentId && (t.status === 'pending' || t.status === 'in_progress')
    );
  }

  /**
   * 添加任务讨论记录
   * @param {string} taskId
   * @param {string} agentId
   * @param {string} content
   */
  addTaskDiscussion(taskId, agentId, content) {
    const task = this.delegatedTasks.find((t) => t.id === taskId);
    if (task) {
      if (!task.discussion) task.discussion = [];
      task.discussion.push({
        agent: agentId,
        content,
        timestamp: Date.now(),
      });
      this._saveToDisk();
    }
  }

  /**
   * 更新任务状态
   * @param {string} taskId
   * @param {Object} updates
   */
  updateTask(taskId, updates) {
    const task = this.delegatedTasks.find((t) => t.id === taskId);
    if (task) {
      Object.assign(task, updates);
      this._saveToDisk();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 统计和查询
  // ═══════════════════════════════════════════════════════════

  /**
   * 获取 Agent 协作统计
   * @param {string} agentId
   * @returns {Object}
   */
  getStats(agentId) {
    const sentMessages = this.messages.filter((m) => m.fromAgent === agentId).length;
    const receivedMessages = this.messages.filter((m) => m.toAgent === agentId).length;
    const assignedTasks = this.delegatedTasks.filter((t) => t.fromAgent === agentId).length;
    const receivedTasks = this.delegatedTasks.filter((t) => t.toAgent === agentId).length;
    const completedTasks = this.delegatedTasks.filter(
      (t) => t.toAgent === agentId && t.status === 'completed'
    ).length;
    const pendingTasks = this.delegatedTasks.filter(
      (t) => t.toAgent === agentId && t.status === 'pending'
    ).length;

    return {
      messages: { sent: sentMessages, received: receivedMessages },
      tasks: {
        assigned: assignedTasks,
        received: receivedTasks,
        completed: completedTasks,
        pending: pendingTasks,
      },
    };
  }

  /**
   * 获取最近的协作活动
   * @param {number} [limit=20]
   * @returns {Array}
   */
  getRecentActivity(limit = 20) {
    const activities = [];

    // 消息活动
    for (const msg of this.messages) {
      activities.push({
        type: 'message',
        id: msg.id,
        from: msg.fromAgent,
        to: msg.toAgent,
        summary: msg.content.slice(0, 50) + (msg.content.length > 50 ? '...' : ''),
        content: msg.content,
        response: msg.response || '',
        status: msg.status,
        timestamp: msg.createdAt,
        respondedAt: msg.respondedAt || null,
      });
    }

    // 任务活动
    for (const task of this.delegatedTasks) {
      activities.push({
        type: 'task',
        id: task.id,
        from: task.fromAgent,
        to: task.toAgent,
        summary: task.taskDescription.slice(0, 50) + (task.taskDescription.length > 50 ? '...' : ''),
        content: task.taskDescription,
        result: task.result || '',
        status: task.status,
        priority: task.priority,
        timestamp: task.createdAt,
        startedAt: task.startedAt || null,
        completedAt: task.completedAt || null,
        discussionCount: task.discussion?.length || 0,
      });
    }

    // 按时间排序，limit <= 0 表示返回全部
    const sorted = activities.sort((a, b) => b.timestamp - a.timestamp);
    return limit > 0 ? sorted.slice(0, limit) : sorted;
  }

  /**
   * 清理积压的任务（超过指定天数的 in_progress/pending 任务标记为 cancelled）
   * @param {Object} [options]
   * @param {number} [options.maxAgeDays=1] - 超过多少天的任务会被清理
   * @param {string} [options.agentId] - 只清理指定 Agent 的任务
   * @returns {{ success: boolean, clearedCount: number, clearedTasks: string[] }}
   */
  clearStaleTasks(options = {}) {
    const maxAgeDays = options.maxAgeDays ?? 1;
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const clearedTasks = [];

    for (const task of this.delegatedTasks) {
      // 只处理 in_progress 或 pending 状态的任务
      if (task.status !== 'in_progress' && task.status !== 'pending') continue;
      
      // 如果指定了 agentId，只清理该 Agent 的任务
      if (options.agentId && task.toAgent !== options.agentId && task.fromAgent !== options.agentId) {
        continue;
      }
      
      const taskAge = now - task.createdAt;
      if (taskAge > maxAgeMs) {
        task.status = 'cancelled';
        task.completedAt = now;
        task.result = `[系统自动关闭] 任务超过 ${maxAgeDays} 天未完成，已自动取消`;
        clearedTasks.push(task.id);
        logger.info('清理积压任务', { taskId: task.id, toAgent: task.toAgent, ageHours: Math.round(taskAge / 3600000) });
      }
    }

    if (clearedTasks.length > 0) {
      this._saveToDisk();
    }

    return { success: true, clearedCount: clearedTasks.length, clearedTasks };
  }

  /**
   * 清空所有已完成/已取消的任务记录
   * @returns {{ success: boolean, clearedCount: number }}
   */
  clearCompletedTasks() {
    const before = this.delegatedTasks.length;
    this.delegatedTasks = this.delegatedTasks.filter(
      (t) => t.status === 'in_progress' || t.status === 'pending'
    );
    const clearedCount = before - this.delegatedTasks.length;
    
    if (clearedCount > 0) {
      this._saveToDisk();
      logger.info(`清空了 ${clearedCount} 条已完成/已取消的任务记录`);
    }
    
    return { success: true, clearedCount };
  }

  /**
   * 清空所有消息记录
   * @returns {{ success: boolean, clearedCount: number }}
   */
  clearMessages() {
    const clearedCount = this.messages.length;
    
    if (clearedCount > 0) {
      this.messages = [];
      this._saveToDisk();
      logger.info(`清空了 ${clearedCount} 条协作消息记录`);
    }
    
    return { success: true, clearedCount };
  }
}

// 单例
const agentCommunication = new AgentCommunicationManager();

module.exports = { AgentCommunicationManager, agentCommunication };
