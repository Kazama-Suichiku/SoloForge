/**
 * SoloForge - 群聊排队串行触发（Phase 3-A）
 *
 * 将群聊触发逻辑从渲染进程移到主进程，从串行 await 改为排队串行。
 *
 * 核心设计：
 *   - 队列：待执行项数组，按发起顺序排队
 *   - processing: boolean（串行处理保证）
 *   - perAgentCount: Map（每链每 Agent 发言次数，防循环，最多 2 次）
 *   - MAX_ROUNDS: 6（全链轮数上限）
 *
 * 接口：
 *   - submit({ conversationId, senderId, content, mentions, senderName })
 *       消息落库 + 推 UI + 排队触发被 @ 的人
 *   - process()
 *       串行处理队列：取队首 → 检查防循环 → Agent 独立上下文处理 → 完成
 *   - abort(conversationId)
 *       肃静/中止某群聊（清空该群聊的待执行项，并记录防循环使其不再加入）
 *
 * 闭环说明：
 *   - Agent 处理时通过 post_to_group 工具发言
 *   - post_to_group 工具内部调 GroupQueue.submit（形成闭环）
 *   - 如果 Agent 发言里 @ 了新人，新人自动加入队列尾部（在 submit 中处理）
 *
 * @module chat/group-queue
 */

const { logger } = require('../utils/logger');
const { groupHistoryStore } = require('./group-history-store');

// IPC 通道（延迟加载避免循环依赖）
let CHANNELS = null;
function getChannels() {
  if (!CHANNELS) {
    CHANNELS = require('../../shared/ipc-channels');
  }
  return CHANNELS;
}

// webContents 引用（由 chat-ipc-handlers / ipc-bootstrap 注入）
let _webContents = null;

// 防循环常量
const MAX_AGENT_SPOKEN = 2;   // 每链每 Agent 最多发言 2 次
const MAX_ROUNDS = 6;          // 全链轮数上限（所有 Agent 加起来最多 6 轮）

/**
 * 群聊排队触发管理器
 */
class GroupQueue {
  constructor() {
    /** @type {Array<{ conversationId: string, agentId: string, triggerMessage: string, senderId: string, round: number }>} */
    this.queue = [];
    /** @type {boolean} */
    this.processing = false;
    /**
     * 每链每 Agent 发言次数
     * key: `${conversationId}:${agentId}`, value: number
     * @type {Map<string, number>}
     */
    this.perAgentCount = new Map();
    /**
     * 每群聊的当前轮数（用于 MAX_ROUNDS 检查）
     * key: conversationId, value: number
     * @type {Map<string, number>}
     */
    this.rounds = new Map();
    /**
     * 已中止的群聊集合（abort 后加入，submit 里的排队触发会跳过这些群聊的新项）
     * key: conversationId, value: boolean
     * @type {Set<string>}
     */
    this.aborted = new Set();
    /**
     * 当前正在处理的群聊 conversationId（用于 abort 时识别）
     * @type {string|null}
     */
    this.currentConversationId = null;
  }

  /**
   * 设置 webContents 引用
   * @param {Electron.WebContents} webContents
   */
  setWebContents(webContents) {
    _webContents = webContents;
  }

  /**
   * 生成群聊触发消息 ID（用作 handleStreamMessage 的 messageId）
   * @private
   */
  _genMessageId() {
    return `gq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 重置某群聊的防循环计数（新一轮开始时调用）
   * @param {string} conversationId
   * @private
   */
  _resetCounters(conversationId) {
    // 清掉该群聊的所有 perAgentCount
    for (const key of this.perAgentCount.keys()) {
      if (key.startsWith(`${conversationId}:`)) {
        this.perAgentCount.delete(key);
      }
    }
    this.rounds.delete(conversationId);
    this.aborted.delete(conversationId);
  }

  /**
   * 提交一条群聊消息：落库 + 推 UI + 排队触发被 @ 的人
   *
   * @param {Object} params
   * @param {string} params.conversationId - 群聊 ID（groupId）
   * @param {string} params.senderId - 发送者 ID（Agent ID 或 'user'）
   * @param {string} [params.senderName] - 发送者显示名
   * @param {string} params.content - 消息内容
   * @param {string[]} [params.mentions] - 被 @ 的 Agent ID 列表
   * @returns {Object} 提交结果
   */
  async submit({ conversationId, senderId, content, mentions = [], senderName }) {
    if (!conversationId || !content) {
      logger.warn('GroupQueue.submit: 参数缺失', { conversationId, senderId, content: !!content });
      return { success: false, error: '参数缺失：conversationId 和 content 必填' };
    }

    const agentConfigStore = require('../config/agent-config-store').agentConfigStore;
    const resolvedSenderName = senderName || (() => {
      if (senderId === 'user') return '老板';
      const cfg = agentConfigStore.get(senderId);
      return cfg?.name || senderId;
    })();

    // 如果是新一轮（该群聊当前没有在处理），重置防循环计数
    // 判断依据：rounds 没有这个群聊 或 队列里没有这个群聊的待处理项
    const hasPending = this.queue.some((it) => it.conversationId === conversationId);
    const inAborted = this.aborted.has(conversationId);
    if (!hasPending && !this.processing && this.currentConversationId !== conversationId) {
      // 一条全新的用户/Agent 消息开启新链路 → 重置该群聊计数
      this._resetCounters(conversationId);
    }

    // 1. 消息落库
    const saved = groupHistoryStore.append(conversationId, {
      senderId,
      senderName: resolvedSenderName,
      content,
      mentions,
      timestamp: Date.now(),
    });

    // 2. 推 UI（所有群成员可见）
    if (_webContents && !_webContents.isDestroyed()) {
      try {
        const channels = getChannels();
        _webContents.send(channels.CHAT_DEPT_GROUP_MESSAGE, {
          groupId: conversationId,
          senderId,
          senderName: resolvedSenderName,
          content,
          mentions,
          timestamp: saved ? saved.timestamp : Date.now(),
        });
      } catch (err) {
        logger.warn('GroupQueue.submit: 推送 UI 失败', err.message);
      }
    }

    // 3. 被 @ 的人加入队列尾部（跳过已中止的群聊）
    if (!inAborted && Array.isArray(mentions) && mentions.length > 0) {
      for (const agentId of mentions) {
        // 跳过 @ 自己（没意义）
        if (agentId === senderId) continue;
        // 校验被 @ 的 Agent 是否存在且活跃
        const cfg = agentConfigStore.get(agentId);
        if (!cfg) continue;
        const status = cfg.status || 'active';
        if (status === 'suspended' || status === 'terminated') {
          logger.info(`GroupQueue: @ 的 Agent ${agentId} 状态为 ${status}，跳过排队`);
          continue;
        }
        // 当前轮数
        const round = this.rounds.get(conversationId) || 0;
        this.queue.push({
          conversationId,
          agentId,
          triggerMessage: content,
          senderId,
          senderName: resolvedSenderName,
          round,
        });
      }
      logger.info(`GroupQueue.submit: 排队 ${mentions.length} 个被 @ 的 Agent`, {
        conversationId,
        mentions,
        queueLength: this.queue.length,
      });
    }

    // 4. 如果没在处理则启动 process()
    this.process();

    return { success: true, savedMessage: saved };
  }

  /**
   * 串行处理队列
   * 取队首 → 检查防循环 → Agent 独立上下文处理 → 完成 → 取下一个
   *
   * 闭环：Agent 的回复通过 post_to_group 工具发出，post_to_group 内部调
   * GroupQueue.submit，新消息落库 + 推 UI + 被 @ 的新人加入队列尾部。
   */
  async process() {
    if (this.processing) return; // 已在处理，新提交的会在队列里等着
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        const { conversationId, agentId, triggerMessage, senderId, senderName } = item;

        // 跳过已中止的群聊
        if (this.aborted.has(conversationId)) {
          logger.info(`GroupQueue.process: 群聊 ${conversationId} 已中止，跳过 ${agentId}`);
          continue;
        }

        this.currentConversationId = conversationId;

        // 检查全链轮数上限 MAX_ROUNDS
        const round = this.rounds.get(conversationId) || 0;
        if (round >= MAX_ROUNDS) {
          logger.warn(`GroupQueue.process: 群聊 ${conversationId} 已达 MAX_ROUNDS(${MAX_ROUNDS})，停止处理`);
          continue;
        }

        // 检查每链每 Agent 发言次数（防循环）
        const countKey = `${conversationId}:${agentId}`;
        const count = this.perAgentCount.get(countKey) || 0;
        if (count >= MAX_AGENT_SPOKEN) {
          logger.info(`GroupQueue.process: Agent ${agentId} 在群聊 ${conversationId} 已发言 ${count} 次，跳过`);
          continue;
        }

        // 记录本轮发言 + 累加轮数
        this.perAgentCount.set(countKey, count + 1);
        this.rounds.set(conversationId, round + 1);

        // Agent 独立上下文处理
        logger.info(`GroupQueue.process: 触发 Agent ${agentId} 处理群聊 ${conversationId}`, {
          round: round + 1,
          agentSpoken: count + 1,
          queueRemaining: this.queue.length,
        });

        try {
          await this._runAgent(agentId, conversationId, triggerMessage, senderId, senderName);
        } catch (err) {
          logger.error(`GroupQueue.process: Agent ${agentId} 处理群聊 ${conversationId} 失败`, err);
          // 单个 Agent 失败不影响队列里的其他项
        }
      }
    } finally {
      this.processing = false;
      this.currentConversationId = null;
    }
  }

  /**
   * 让 Agent 处理群聊消息（独立上下文）
   *
   * - 从 groupHistoryStore.getRecent 获取群聊历史作为上下文
   * - 触发消息格式："[群聊消息 - 来自 {senderName}] {content}"
   * - 调 chatManager.handleStreamMessage 让 Agent 走 tool-loop
   * - Agent 的回复通过 post_to_group 工具发出（工具内部调 GroupQueue.submit 形成闭环）
   *
   * @private
   */
  async _runAgent(agentId, conversationId, triggerMessage, senderId, senderName) {
    const { chatManager } = require('./chat');
    const { agentConfigStore } = require('../config/agent-config-store');

    // 前置校验：Agent 是否存在且活跃
    const cfg = agentConfigStore.get(agentId);
    if (!cfg) {
      logger.warn(`GroupQueue._runAgent: Agent ${agentId} 不存在`);
      return;
    }
    const status = cfg.status || 'active';
    if (status === 'suspended' || status === 'terminated') {
      logger.info(`GroupQueue._runAgent: Agent ${agentId} 状态为 ${status}，不触发`);
      return;
    }

    const agent = chatManager.getAgent(agentId);
    if (!agent) {
      logger.warn(`GroupQueue._runAgent: Agent 实例 ${agentId} 不存在`);
      return;
    }
    if (!chatManager.llmManager) {
      logger.warn('GroupQueue._runAgent: LLM Manager 未就绪，跳过');
      return;
    }

    // 获取群聊历史作为上下文
    const history = groupHistoryStore.getRecent(conversationId, 50);

    // 构建群聊历史文本上下文
    let groupContextBlock = '';
    if (history.length > 0) {
      const lines = ['## 群聊最近消息'];
      for (const m of history) {
        const t = new Date(m.timestamp).toLocaleString('zh-CN', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        const mentionTag = (m.mentions && m.mentions.length > 0)
          ? ` @${m.mentions.join(' @')}`
          : '';
        lines.push(`- [${t}] ${m.senderName}:${mentionTag} ${m.content}`);
      }
      groupContextBlock = lines.join('\n');
    }

    // 触发消息格式
    const triggerContent = `[群聊消息 - 来自 ${senderName || senderId}] ${triggerMessage}`;

    // 拼接最终消息：群聊历史 + 触发消息
    let finalMessage = triggerContent;
    if (groupContextBlock) {
      finalMessage = `${groupContextBlock}\n\n---\n\n${finalMessage}`;
    }

    // 调用 chatManager.handleStreamMessage 让 Agent 走 tool-loop
    // conversationId 用群聊 ID，这样 post_to_group 工具能从 context 拿到群聊 ID
    const messageId = this._genMessageId();
    await chatManager.handleStreamMessage({
      conversationId,
      agentId,
      message: finalMessage,
      messageId,
      history: [], // 群聊历史已通过 finalMessage 注入，不传 history 避免与私聊历史混淆
    });
  }

  /**
   * 肃静/中止某群聊：清空该群聊的待执行项，并标记为已中止
   * 已在处理的当前项不会被中断（让当前 Agent 说完），但后续不再排队。
   *
   * @param {string} conversationId - 群聊 ID
   * @returns {{ success: boolean, cleared: number }}
   */
  abort(conversationId) {
    if (!conversationId) return { success: false, error: 'conversationId 必填' };

    // 清空队列中该群聊的待执行项
    const before = this.queue.length;
    this.queue = this.queue.filter((it) => it.conversationId !== conversationId);
    const cleared = before - this.queue.length;

    // 标记为已中止（后续 submit 里的排队触发会跳过）
    this.aborted.add(conversationId);
    // 重置计数，防止下次新链路被旧计数误伤
    this._resetCounters(conversationId);
    // 重新加上 aborted 标记（_resetCounters 会清掉它，这里加回来）
    this.aborted.add(conversationId);

    logger.info(`GroupQueue.abort: 群聊 ${conversationId} 已中止，清空 ${cleared} 个待执行项`);
    return { success: true, cleared };
  }

  /**
   * 获取队列状态（调试/可观测性用）
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      currentConversationId: this.currentConversationId,
      perAgentCount: Object.fromEntries(this.perAgentCount),
      rounds: Object.fromEntries(this.rounds),
      aborted: Array.from(this.aborted),
    };
  }

  /**
   * 重新初始化（公司切换时调用）
   * 清空队列和计数，不中止当前正在处理的项（让其在下一轮自然结束）
   */
  reinitialize() {
    this.queue = [];
    this.processing = false;
    this.perAgentCount.clear();
    this.rounds.clear();
    this.aborted.clear();
    this.currentConversationId = null;
  }
}

// 单例
const groupQueue = new GroupQueue();

module.exports = {
  GroupQueue,
  groupQueue,
  MAX_AGENT_SPOKEN,
  MAX_ROUNDS,
};
