/**
 * SoloForge - 聊天 Agent Hook（组合层）
 *
 * Phase 1 批次 4c 重构：业务逻辑与 IPC 订阅已拆分到独立模块，本文件仅作组合层。
 *
 *  - 业务纯函数（群聊连锁、身份注入、冷却计算、历史构建等）→ hooks/chat-agent-logic.js
 *  - IPC 事件订阅（onStream / onComplete / onProactiveMessage 等 9 个订阅）→ hooks/useAgentIpcEvents.js
 *  - 本文件：保留 sendToSingleAgent / handleGroupChat / sendToAgent / silenceGroup 编排逻辑，
 *    调用 useAgentIpcEvents 完成事件订阅，对外导出接口与重构前完全一致：
 *      { sendToAgent, silenceGroup }
 *
 * @module hooks/useChatAgent
 */

import { useCallback, useRef } from 'react';
import { useChatStore } from '../store/chat-store';
import { useAgentStore } from '../store/agent-store';

import {
  extractMentions,
  buildIdNameMaps,
  buildHistoryFromMessages,
  cleanContentPrefix,
  filterImageAttachments,
  // Phase 3-B：群聊连锁触发已移到主进程 GroupQueue，
  // DEPT_COOLDOWN_MS / isAgentInDeptCooldown / recordDeptTrigger / filterNewMentions 等
  // 不再在渲染进程使用；buildHistoryFromMessages 仍用于私聊历史构建。
} from './chat-agent-logic';
import { useAgentIpcEvents } from './useAgentIpcEvents';

/**
 * 聊天 Agent Hook
 * 管理用户消息到 Agent 的通信
 */
export function useChatAgent() {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const appendMessageContent = useChatStore((s) => s.appendMessageContent);
  const conversations = useChatStore((s) => s.conversations);
  const messagesByConversation = useChatStore((s) => s.messagesByConversation);

  const setAgentWorking = useAgentStore((s) => s.setAgentWorking);
  const setAgentIdle = useAgentStore((s) => s.setAgentIdle);

  // 群聊中断控制（Phase 3-B：主要用于 silenceGroup，群聊触发已移主进程 GroupQueue）
  const groupAbortRef = useRef(false);

  /**
   * 模拟 Agent 响应（开发测试用）
   */
  const simulateAgentResponse = useCallback(
    async (messageId, agentId, userContent) => {
      const responses = {
        secretary: [
          '好的老板，我来安排一下。',
          '收到，我会协调相关人员处理这件事。',
          '明白了，我马上开始处理。',
          '没问题，我来帮您跟进这件事。',
        ],
        ceo: [
          '从战略角度来看，我们需要...',
          '这个方向很好，我建议我们...',
          '我来分析一下业务影响...',
        ],
        cto: [
          '从技术角度来说...',
          '我来评估一下技术可行性...',
          '这个需求的技术方案是...',
        ],
        cfo: [
          '从 Token 消耗角度来看...',
          '我来分析一下 Token 使用情况...',
          'Token 预算方面需要考虑...',
        ],
      };

      const agentResponses = responses[agentId] || responses.secretary;
      const baseResponse =
        agentResponses[Math.floor(Math.random() * agentResponses.length)];

      // 模拟流式输出
      const fullResponse = `${baseResponse}\n\n您说的是：「${userContent}」\n\n我会认真处理这件事，有任何进展会及时向您汇报。`;

      for (let i = 0; i < fullResponse.length; i++) {
        await new Promise((r) => setTimeout(r, 30 + Math.random() * 20));
        appendMessageContent(messageId, fullResponse[i]);
      }

      updateMessage(messageId, { status: 'sent' });
    },
    [appendMessageContent, updateMessage]
  );

  /**
   * 发送消息给单个 Agent（使用流式输出）
   * @param {string} conversationId - 对话 ID
   * @param {string} agentId - Agent ID
   * @param {string} content - 用户消息内容
   * @param {Array} history - 对话历史
   * @param {Array} [attachments] - 附件列表（图片等）
   * @returns {Promise<void>}
   */
  const sendToSingleAgent = useCallback(
    async (conversationId, agentId, content, history, attachments) => {
      // 设置 Agent 为工作中
      setAgentWorking(agentId, '正在思考...');

      // 先添加一条空的 Agent 消息（用于流式填充）
      const agentMsgId = sendMessage({
        conversationId,
        senderId: agentId,
        senderType: 'agent',
        content: '',
      });

      try {
        // 调用主进程的流式聊天接口
        if (window.soloforge?.chat?.sendMessageStream) {
          // 流式调用 - 采用"发起即返回"模式
          // 内容通过 onStream 实时推送，完成通过 onComplete 通知
          const imageAttachments = filterImageAttachments(attachments);

          const startResult = await window.soloforge.chat.sendMessageStream({
            conversationId,
            agentId,
            message: content,
            attachments: imageAttachments?.length > 0 ? imageAttachments : undefined,
            messageId: agentMsgId, // 用于关联流式推送
            history,
          });

          // 检查是否启动成功
          if (!startResult?.success) {
            updateMessage(agentMsgId, {
              content: startResult?.error || '发送失败',
              status: 'error',
            });
            setAgentIdle(agentId);
          }
          // 注意：不再在这里等待完成，setAgentIdle 由 onComplete 回调处理
          return; // 提前返回，让 onComplete 处理后续
        } else if (window.soloforge?.chat?.sendMessage) {
          // 降级到非流式调用
          console.warn('Stream API not available, using non-stream fallback');
          const result = await window.soloforge.chat.sendMessage({
            conversationId,
            agentId,
            message: content,
            history,
          });

          if (result?.content) {
            const cleanContent = cleanContentPrefix(result.content);
            updateMessage(agentMsgId, {
              content: cleanContent,
              status: 'sent',
            });
          } else {
            updateMessage(agentMsgId, {
              content: '抱歉，我暂时无法回应。',
              status: 'error',
            });
          }
        } else {
          // 最终降级：模拟响应
          console.warn('Chat API not available, using simulation');
          await simulateAgentResponse(agentMsgId, agentId, content);
        }
      } catch (error) {
        console.error('Agent response error:', error);
        updateMessage(agentMsgId, {
          content: `抱歉，我遇到了一些问题：${error.message || '未知错误'}`,
          status: 'error',
        });
      } finally {
        setAgentIdle(agentId);
      }
    },
    [sendMessage, updateMessage, setAgentWorking, setAgentIdle, simulateAgentResponse]
  );

  /**
   * 处理群聊消息（Phase 3-B：触发移主进程 GroupQueue）
   *
   * 渲染进程不再做 Agent 连锁触发（串行 await sendToSingleAgent）。
   * 用户在群聊发言时，本函数只做：
   *   1. 从用户消息中提取 @ 的 Agent（mentions）
   *   2. 通过 IPC 把消息提交到主进程 GroupQueue
   * 主进程 GroupQueue 负责：消息落库 + 推 UI（onDeptGroupMessage） + 排队串行触发被 @ 的 Agent。
   * Agent 的回复通过 post_to_group 工具回到 GroupQueue.submit 形成闭环。
   *
   * 私聊仍走 sendToSingleAgent（不走 GroupQueue）。
   */
  const handleGroupChat = useCallback(
    async (conversationId, conversation, agentIds, userContent) => {
      const agentsMap = useAgentStore.getState().agents;

      // ── 构建 ID ↔ 人名 映射（用于提取 @ 人名格式的 mention） ──────
      const { idToName, nameToId } = buildIdNameMaps(agentIds, agentsMap);

      // 从用户消息中提取被 @ 的 Agent（支持 @ID 和 @人名）
      const mentions = extractMentions(userContent, agentIds, nameToId);

      // 把消息提交到主进程 GroupQueue（由主进程排队触发被 @ 的人）
      if (window.soloforge?.chat?.submitGroupMessage) {
        try {
          const result = await window.soloforge.chat.submitGroupMessage({
            conversationId,
            senderId: 'user',
            content: userContent,
            mentions,
          });
          if (!result?.success) {
            console.warn('群聊消息提交到主进程失败:', result?.error);
          }
        } catch (err) {
          console.error('群聊消息提交到主进程异常:', err);
        }
      } else {
        console.warn('submitGroupMessage API 不可用，群聊消息未提交到主进程');
      }
    },
    []
  );

  /**
   * 发送消息给 Agent（支持私聊和群聊）
   * @param {string} conversationId - 对话 ID
   * @param {string} content - 用户消息内容
   * @param {Array} [attachments] - 附件列表（图片等）
   */
  const sendToAgent = useCallback(
    async (conversationId, content, attachments) => {
      const conversation = conversations.get(conversationId);
      if (!conversation) return;

      // 找到对话中的所有 Agent
      const agentIds = conversation.participants.filter((p) => p !== 'user');
      if (agentIds.length === 0) return;

      // 获取对话历史（排除已删除的消息）
      // 重要：直接从 store 获取最新状态，避免 useCallback 闭包导致读到旧数据
      const freshMessages = useChatStore.getState().messagesByConversation.get(conversationId) ?? [];
      const history = buildHistoryFromMessages(freshMessages);

      if (conversation.type === 'private') {
        // 私聊：只发给一个 Agent（含附件）
        await sendToSingleAgent(conversationId, agentIds[0], content, history, attachments);
      } else {
        // 群聊：被 @的 Agent 回复，Agent 也可以 @ 其他 Agent 触发连锁回复
        await handleGroupChat(conversationId, conversation, agentIds, content);
      }
    },
    [conversations, messagesByConversation, sendToSingleAgent, handleGroupChat]
  );

  // ── 订阅主进程 IPC 事件（所有 useEffect 已迁移至 useAgentIpcEvents） ──
  // Phase 3-B：群聊连锁触发移到主进程 GroupQueue，不再传 handleGroupChat / 冷却回调
  useAgentIpcEvents({
    setAgentIdle,
  });

  /**
   * 肃静！—— 停止群聊中所有 Agent 发言
   * Phase 3-B：除了设置前端中断标记 + 中止后端任务，还通知主进程 GroupQueue 肃静。
   * @param {string} conversationId - 群聊对话 ID
   */
  const silenceGroup = useCallback(
    (conversationId) => {
      // 1. 设置前端中断标记（保留以兼容任何残留的串行逻辑）
      groupAbortRef.current = true;

      // 2. 通知主进程 GroupQueue 肃静（Phase 3-B：清空待执行项 + 标记中止）
      if (window.soloforge?.chat?.abortGroupQueue) {
        try {
          window.soloforge.chat.abortGroupQueue(conversationId);
        } catch (e) {
          console.warn(`主进程 GroupQueue 肃静失败:`, e);
        }
      }

      // 3. 获取群聊参与者，逐个中止后端任务
      const conversation = useChatStore.getState().conversations.get(conversationId);
      if (conversation) {
        const agentIds = conversation.participants.filter((p) => p !== 'user');
        for (const agentId of agentIds) {
          try {
            window.electronAPI?.abortAgentTask?.(agentId);
          } catch (e) {
            console.warn(`中止 Agent ${agentId} 任务失败:`, e);
          }
          // 重置 Agent 状态为空闲
          setAgentIdle(agentId);
        }
      }

      // 4. 添加系统提示消息到群聊
      sendMessage({
        conversationId,
        senderId: 'user',
        senderType: 'user',
        content: '肃静！全体停止发言。',
        metadata: { system: true, silence: true },
      });

      console.log('群聊已肃静:', conversationId);
    },
    [sendMessage, setAgentIdle]
  );

  return {
    sendToAgent,
    silenceGroup,
  };
}

export default useChatAgent;
