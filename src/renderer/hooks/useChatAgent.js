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
  DEPT_COOLDOWN_MS,
  extractMentions,
  buildIdNameMaps,
  buildParticipantsList,
  buildGroupRules,
  buildIdentityReminder,
  buildHistoryFromMessages,
  findLatestAgentReply,
  filterNewMentions,
  sortByLevel,
  cleanContentPrefix,
  filterImageAttachments,
  isAgentInDeptCooldown as isAgentInDeptCooldownPure,
  recordDeptTrigger as recordDeptTriggerPure,
  shouldStopChain,
  isMaxRoundsReached,
  MAX_CHAIN_ROUNDS,
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

  // 群聊中断控制
  const groupAbortRef = useRef(false);

  // 部门群聊冷却机制（与后端同步，防止重复触发）
  // key: `${conversationId}:${agentId}`, value: lastTriggerTimestamp
  const deptCooldownRef = useRef(new Map());

  /**
   * 检查 Agent 是否在部门群聊冷却中（包装为带 ref 的回调，供 IPC 订阅使用）
   */
  const isAgentInDeptCooldown = useCallback((conversationId, agentId) => {
    return isAgentInDeptCooldownPure(
      deptCooldownRef.current,
      conversationId,
      agentId
    );
  }, []);

  /**
   * 记录 Agent 在部门群聊的触发时间（包装为带 ref 的回调，供 IPC 订阅使用）
   * 直接修改 ref 内的 Map（保持与原实现一致的命令式语义）。
   */
  const recordDeptTrigger = useCallback((conversationId, agentId) => {
    const key = `${conversationId}:${agentId}`;
    deptCooldownRef.current.set(key, Date.now());
  }, []);

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
   * 处理群聊消息（支持 Agent 间 @ 连锁回复）
   * 最多允许 MAX_CHAIN_ROUNDS 轮连锁，防止无限循环
   *
   * 业务逻辑（map 构建、规则文本、历史构建、提及相关）已委托给 chat-agent-logic 纯函数，
   * 本函数仅保留与 store 读取 + sendToSingleAgent 编排相关的不可纯化部分。
   */
  const handleGroupChat = useCallback(
    async (conversationId, conversation, agentIds, userContent) => {
      const agentsMap = useAgentStore.getState().agents;

      // 重置中断标记
      groupAbortRef.current = false;

      // ── 构建 ID ↔ 人名 映射 ────────────────────────
      const { idToName, nameToId } = buildIdNameMaps(agentIds, agentsMap);

      // 构建参与者列表（人名格式）
      const participantsList = buildParticipantsList(agentIds, agentsMap, idToName);

      // 判断是否是部门群聊
      const isDepartmentChat = conversation.type === 'department';
      const groupTypeLabel = isDepartmentChat ? '部门工作群' : '群聊';

      // 通用群聊规则（不含身份信息，身份信息在每个 Agent 的消息中单独注入）
      const groupRules = buildGroupRules({
        groupTypeLabel,
        conversationName: conversation.name,
        participantsList,
        isDepartmentChat,
        firstAgentMention: idToName.get(agentIds[0]) || agentIds[0],
      });

      // 第一轮：用户 @ 的 Agent（同时支持 @ID 和 @人名）
      const initialMentions = extractMentions(userContent, agentIds, nameToId);
      if (initialMentions.length === 0) {
        console.log('群聊消息未 @ 任何成员，不触发回复');
        return;
      }

      // 待回复队列 + 已回复记录
      let pendingAgents = [...initialMentions];
      const repliedAgents = new Set(); // 本轮已回复的 Agent（防止重复）
      let round = 0;

      while (pendingAgents.length > 0 && round < MAX_CHAIN_ROUNDS) {
        // 检查中断标记
        if (shouldStopChain(groupAbortRef.current)) {
          console.log('群聊已被肃静，停止后续回复');
          break;
        }

        round++;

        // 按层级排序
        const sorted = sortByLevel(pendingAgents, agentsMap);

        // 本轮新 @ 的 Agent（下一轮待处理）
        const nextPending = [];

        for (const { id: targetAgent } of sorted) {
          // 检查中断标记
          if (shouldStopChain(groupAbortRef.current)) {
            console.log('群聊已被肃静，跳过剩余 Agent');
            break;
          }
          if (repliedAgents.has(targetAgent)) continue; // 已经回复过了
          repliedAgents.add(targetAgent);

          const agentName = idToName.get(targetAgent) || targetAgent;

          // 个性化身份提醒（注入到每个 Agent 的消息开头）
          const identityReminder = buildIdentityReminder(agentName);

          // 获取最新 history（排除已删除的消息）
          const updatedMessages =
            useChatStore.getState().messagesByConversation.get(conversationId) ?? [];
          const updatedHistory = buildHistoryFromMessages(updatedMessages, idToName);

          // 让 Agent 回复（注入身份提醒 + 群规 + 用户消息）
          await sendToSingleAgent(
            conversationId,
            targetAgent,
            identityReminder + groupRules + userContent,
            updatedHistory
          );

          // 检查 Agent 的回复中是否 @ 了其他 Agent（支持人名和ID两种格式）
          const latestMsgs =
            useChatStore.getState().messagesByConversation.get(conversationId) ?? [];
          const agentReply = findLatestAgentReply(latestMsgs, targetAgent);

          if (agentReply?.content) {
            const newMentions = filterNewMentions(
              agentReply.content,
              agentIds,
              nameToId,
              repliedAgents,
              targetAgent
            );
            if (newMentions.length > 0) {
              console.log(
                `群聊: ${agentName} @ 了 [${newMentions.map((id) => idToName.get(id) || id).join(', ')}]，触发连锁回复 (第 ${round} 轮)`
              );
              nextPending.push(...newMentions);
            }
          }
        }

        // 下一轮处理新 @ 的 Agent
        pendingAgents = [...new Set(nextPending)];
      }

      if (isMaxRoundsReached(round) && pendingAgents.length > 0) {
        console.warn('群聊连锁回复达到最大轮数限制:', MAX_CHAIN_ROUNDS);
      }
    },
    [sendToSingleAgent]
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
  useAgentIpcEvents({
    handleGroupChat,
    isAgentInDeptCooldown,
    recordDeptTrigger,
    setAgentIdle,
  });

  /**
   * 肃静！—— 停止群聊中所有 Agent 发言
   * @param {string} conversationId - 群聊对话 ID
   */
  const silenceGroup = useCallback(
    (conversationId) => {
      // 1. 设置中断标记，阻止后续 Agent 被调用
      groupAbortRef.current = true;

      // 2. 获取群聊参与者，逐个中止后端任务
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

      // 3. 添加系统提示消息到群聊
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
