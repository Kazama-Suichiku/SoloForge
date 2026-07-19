/**
 * SoloForge - Agent 间通信系统（聚合入口）
 *
 * Phase 1 批次 3a 重构：本文件从 2383 行的上帝对象拆分为薄聚合层。
 * 实际职责分散到：
 *   - collaboration/message-queue.js     — 队列管理（入队/出队/优先级/槽位/长度上限）
 *   - collaboration/timeout-manager.js   — 超时管理（AbortController + clearTimeout，修复资源泄漏）
 *   - collaboration/agent-messaging.js    — 点对点消息、@提及、分层历史上下文、历史分页
 *   - collaboration/task-delegation.js   — 任务委派、执行、上司审阅、任务查询/清理
 *   - agents/tool-loop-runner.js         — 可复用的工具调用循环（P1-5，agent-communication + chat-manager 共用）
 *
 * 本文件保留：
 *   - 单例状态（messages / delegatedTasks / chatManager / toolExecutor / toolRegistry）
 *   - 磁盘持久化（_loadFromDisk / _saveToDisk / _saveToDiskSync / _ensureDataDir）
 *   - 活跃任务追踪钩子（_trackAgentActivity / _updateAgentActivityStage / _untrackAgentActivity）
 *   - 记忆提取触发（_triggerMemoryExtraction）
 *   - setChatManager / reinitialize / clearAgentQueues
 *   - 所有对外导出的方法（接口与重构前完全一致）
 *
 * 外部调用方（chat-manager、tools、pm、patrol、company-switch 等）无需任何修改。
 *
 * @module collaboration/agent-communication
 */

const { logger } = require('../utils/logger');
const { agentConfigStore } = require('../config/agent-config-store');
const path = require('path');
const fs = require('fs');
const { dataPath } = require('../account/data-path');
const { atomicWrite, atomicWriteSync } = require('../utils/atomic-write');

// 子模块
const { MessageQueue } = require('./message-queue');
const { withTimeout } = require('./timeout-manager');
const { AgentMessaging } = require('./agent-messaging');
const { TaskDelegation } = require('./task-delegation');
const { runToolLoop } = require('../agents/tool-loop-runner');

// 防抖保存
let _commSaveTimer = null;
const COMM_SAVE_DEBOUNCE_MS = 2000;

function getDataDir() {
  return dataPath.getBasePath();
}

function getCommFile() {
  return path.join(dataPath.getBasePath(), 'agent-communications.json');
}

/**
 * Agent 通信管理器（聚合层）
 * 导出接口与重构前完全一致。
 */
class AgentCommunicationManager {
  constructor() {
    /** @type {any[]} */
    this.messages = [];
    /** @type {any[]} */
    this.delegatedTasks = [];
    /** @type {Object | null} */
    this.chatManager = null;
    /** @type {Object | null} */
    this.toolExecutor = null;
    /** @type {Object | null} */
    this.toolRegistry = null;

    // 协作健壮性：消息队列和并发控制（拆到 message-queue.js）
    this.queue = new MessageQueue();

    // 超时工具（拆到 timeout-manager.js）
    this.timeout = { withTimeout };

    // 子模块（注入 this 作为 host）
    this.messaging = new AgentMessaging(this);
    this.delegation = new TaskDelegation(this);

    this._ensureDataDir();
    this._loadFromDisk();
  }

  /**
   * 重新初始化（切换公司后调用）
   */
  reinitialize() {
    this.messages = [];
    this.delegatedTasks = [];
    this.queue.clearAll();
    this._ensureDataDir();
    this._loadFromDisk();
  }

  /**
   * 清理指定 Agent 的消息队列（开除时调用）
   * @param {string} agentId
   * @returns {{queueCleared: number, wasProcessing: boolean}}
   */
  clearAgentQueues(agentId) {
    return this.queue.clearAgentQueues(agentId);
  }

  /**
   * 设置 ChatManager 引用（用于调用其他 Agent）
   */
  setChatManager(chatManager) {
    this.chatManager = chatManager;
    if (chatManager) {
      this.toolExecutor = chatManager.toolExecutor;
      // 延迟加载工具注册表
      this.toolRegistry = require('../tools/tool-registry').toolRegistry;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 磁盘持久化
  // ═══════════════════════════════════════════════════════════

  _ensureDataDir() {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

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

  _saveToDisk() {
    if (_commSaveTimer) {
      clearTimeout(_commSaveTimer);
    }
    _commSaveTimer = setTimeout(() => {
      _commSaveTimer = null;
      this._doSave();
    }, COMM_SAVE_DEBOUNCE_MS);
  }

  _doSave() {
    try {
      const content = JSON.stringify(
        {
          messages: this.messages.slice(-500),
          delegatedTasks: this.delegatedTasks.slice(-200),
        },
        null,
        2
      );
      atomicWrite(getCommFile(), content).catch((error) => {
        logger.error('保存 Agent 通信记录失败', error);
      });
    } catch (error) {
      logger.error('保存 Agent 通信记录失败', error);
    }
  }

  _saveToDiskSync() {
    try {
      const content = JSON.stringify(
        {
          messages: this.messages.slice(-500),
          delegatedTasks: this.delegatedTasks.slice(-200),
        },
        null,
        2
      );
      atomicWriteSync(getCommFile(), content);
    } catch (error) {
      logger.error('同步保存 Agent 通信记录失败', error);
    }
  }

  _generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ═══════════════════════════════════════════════════════════
  // 活跃任务追踪（与控制面板联动）
  // ═══════════════════════════════════════════════════════════

  _trackAgentActivity(agentId, taskDescription) {
    if (!this.chatManager) return null;
    try {
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
  // 记忆提取触发
  // ═══════════════════════════════════════════════════════════

  _triggerMemoryExtraction(type, params) {
    try {
      const { memoryManager } = require('../memory');
      if (!memoryManager || !memoryManager._initialized) return;
      if (type === 'communication') memoryManager.onCommunicationComplete(params);
      else if (type === 'task') memoryManager.onTaskComplete(params);
    } catch (error) {
      logger.debug('记忆提取触发失败（可能未初始化）:', error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ToolLoopRunner 适配层
  // 保留原 _chatWithToolLoop 签名，内部转调 runToolLoop
  // ═══════════════════════════════════════════════════════════

  /**
   * 带工具调用循环的内部 Agent 通信（保留原签名，内部用 ToolLoopRunner）
   * @param {Object} agent - 目标 Agent
   * @param {string} message - 消息内容
   * @param {Array} history - 对话历史
   * @param {Object} [context={}]
   * @param {Object} [options={}]
   * @param {'planning' | 'full'} [options.toolFilter='full']
   * @param {Function} [options.onToolExecuted]
   * @returns {Promise<{content: string, toolsUsed: string[]}>}
   */
  async _chatWithToolLoop(agent, message, history, context = {}, options = {}) {
    const { toolFilter = 'full', onToolExecuted } = options;
    const toolSchema = this.messaging.getFilteredToolSchema(agent.id, toolFilter);
    const result = await runToolLoop(agent, message, history, context, {
      toolSchema,
      toolExecutor: this.toolExecutor,
      getPermissionContext: () => this.messaging.getPermissionContext(),
      onToolExecuted,
      onStageChange: (stage) => this._updateAgentActivityStage(agent.id, stage),
    });
    return { content: result.content, toolsUsed: result.toolsUsed };
  }

  /**
   * 供子模块调用的统一入口（host.runToolLoop）
   */
  runToolLoop(agent, message, history, context, options) {
    return runToolLoop(agent, message, history, context, options);
  }

  // ═══════════════════════════════════════════════════════════
  // 对外导出方法（全部转调子模块，保持原签名）
  // ═══════════════════════════════════════════════════════════

  /** Agent 间同步消息 */
  sendMessage(params) {
    return this.messaging.sendMessage(params);
  }

  /** 获取 Agent 通信记录 */
  getMessages(agentId, options) {
    return this.messaging.getMessages(agentId, options);
  }

  /** 两个 Agent 之间的通信历史总数 */
  getPairwiseHistoryInfo(agentA, agentB) {
    return this.messaging.getPairwiseHistoryInfo(agentA, agentB);
  }

  /** 分页获取两个 Agent 之间的通信历史 */
  getPairwiseHistoryPaginated(agentA, agentB, options) {
    return this.messaging.getPairwiseHistoryPaginated(agentA, agentB, options);
  }

  /** 获取 Agent 的所有通信历史（分页） */
  getMessagesPaginated(agentId, options) {
    return this.messaging.getMessagesPaginated(agentId, options);
  }

  /** 委派任务 */
  delegateTask(params) {
    return this.delegation.delegateTask(params);
  }

  /** 执行委派任务 */
  executeTask(taskId, options) {
    return this.delegation.executeTask(taskId, options);
  }

  /** 获取 Agent 的委派任务 */
  getTasks(agentId, options) {
    return this.delegation.getTasks(agentId, options);
  }

  /** 获取待处理任务 */
  getPendingTasks(agentId) {
    return this.delegation.getPendingTasks(agentId);
  }

  /** 添加任务讨论 */
  addTaskDiscussion(taskId, agentId, content) {
    return this.delegation.addTaskDiscussion(taskId, agentId, content);
  }

  /** 更新任务状态 */
  updateTask(taskId, updates) {
    return this.delegation.updateTask(taskId, updates);
  }

  /** Agent 协作统计 */
  getStats(agentId) {
    return this.delegation.getStats(agentId);
  }

  /** 最近协作活动 */
  getRecentActivity(limit) {
    return this.delegation.getRecentActivity(limit);
  }

  /** 清理积压任务 */
  clearStaleTasks(options) {
    return this.delegation.clearStaleTasks(options);
  }

  /** 清空已完成/已取消的任务 */
  clearCompletedTasks() {
    return this.delegation.clearCompletedTasks();
  }

  /** 清空所有消息 */
  clearMessages() {
    return this.delegation.clearMessages();
  }
}

// 单例
const agentCommunication = new AgentCommunicationManager();

module.exports = { AgentCommunicationManager, agentCommunication };
