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

import { useCallback, useEffect, useRef, useState } from 'react';
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

  // ── P1：IPC loading 状态（审计维度 1）──────────────────────────────
  // 问题：关键 IPC 调用（sendMessage / submitGroupMessage / silenceGroup）无 loading 状态，
  // UI 无法显示 spinner 或禁用按钮，用户点击多次会重复发起。
  // 方案：用 Map<action, boolean> 记录每个 action 的 loading 状态，
  // 键格式 `${action}:${conversationId}`（同会话多个 action 互不影响）。
  // setLoad 包装 setState，确保新旧 Map 引用变化触发重渲染。
  const [loadingMap, setLoadingMap] = useState(new Map());

  const setLoad = useCallback((key, isLoading) => {
    setLoadingMap((prev) => {
      // 幂等：状态相同则不产生新引用，避免无谓重渲染
      if (prev.get(key) === isLoading) return prev;
      const next = new Map(prev);
      if (isLoading) next.set(key, true);
      else next.delete(key);
      return next;
    });
  }, []);

  /** 查询某 action 的 loading 状态（供 UI 判断 spinner / disabled） */
  const isLoading = useCallback((key) => loadingMap.get(key) === true, [loadingMap]);

  // 群聊中断控制（Phase 3-B：主要用于 silenceGroup，群聊触发已移主进程 GroupQueue）
  const groupAbortRef = useRef(false);

  // ── P0 流式 watchdog（审计维度 13）──────────────────────────────
  // 问题：发起流式后若 Agent 卡死（既不推 chunk 也不 complete），前端会无限 loading。
  // 方案：为每条发起的流式消息挂一个 90s watchdog：
  //   - 每收到一个 chunk（onStreamTick）重置该消息的定时器 → 正常流式不会误触发；
  //   - 90s 内无任何 chunk 且未 complete → 判定卡死，清理 loading + 显示"响应超时，请重试"。
  // 注意：只在真正卡死时触发，不中断正常流式（正常流式每 chunk 都会重置定时器）。
  const STREAM_WATCHDOG_MS = 90_000;
  // watchdog 状态表：messageId -> { timer, agentId }
  const watchdogsRef = useRef(new Map());

  /** 清除指定消息的 watchdog（流式完成 / 卸载时调用） */
  const clearWatchdog = useCallback((messageId) => {
    if (!messageId) return;
    const map = watchdogsRef.current;
    const w = map.get(messageId);
    if (w) {
      if (w.timer) clearTimeout(w.timer);
      map.delete(messageId);
    }
  }, []);

  /** 启动一条消息的 watchdog（发起流式成功后调用） */
  const startWatchdog = useCallback((messageId, agentId) => {
    if (!messageId) return;
    // 先清掉可能存在的旧定时器（重发场景）
    clearWatchdog(messageId);
    const timer = setTimeout(() => {
      // 卡死处理：清理 loading 状态 + 提示超时
      console.warn(`[watchdog] 流式消息 ${messageId} 超过 ${STREAM_WATCHDOG_MS}ms 无 chunk，判定卡死`);
      watchdogsRef.current.delete(messageId);
      // 1. 把消息标记为错误（若已有内容则保留并补一条提示，避免覆盖已渲染内容）
      const allMsgs = useChatStore.getState().messagesByConversation;
      let hadContent = false;
      for (const [, msgs] of allMsgs) {
        const m = msgs.find((x) => x.id === messageId);
        if (m) { hadContent = !!m.content; break; }
      }
      if (hadContent) {
        // 已有内容：不覆盖，只更新状态为 sent（视为部分响应已送达）
        updateMessage(messageId, { status: 'sent' });
      } else {
        // 完全无内容：显示超时提示
        updateMessage(messageId, {
          content: '响应超时，请重试。',
          status: 'error',
        });
      }
      // 2. 释放 Agent 工作状态
      if (agentId) setAgentIdle(agentId);
      // 3. 通知主进程中止该 Agent 的任务（尽力而为，避免后端继续空转）
      try {
        window.electronAPI?.abortAgentTask?.(agentId);
      } catch (e) {
        console.warn('[watchdog] abortAgentTask 失败:', e);
      }
    }, STREAM_WATCHDOG_MS);
    watchdogsRef.current.set(messageId, { timer, agentId });
  }, [clearWatchdog, updateMessage, setAgentIdle]);

  /** 收到 chunk 时重置 watchdog 定时器（防卡死，不中断正常流式） */
  const onStreamTick = useCallback((messageId) => {
    const w = watchdogsRef.current.get(messageId);
    if (!w) return; // 没挂 watchdog（非本 hook 发起 / 已完成），忽略
    // 重置定时器：clearTimeout + 重新 setTimeout
    if (w.timer) clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      console.warn(`[watchdog] 流式消息 ${messageId} 重置后仍超时，判定卡死`);
      watchdogsRef.current.delete(messageId);
      const allMsgs = useChatStore.getState().messagesByConversation;
      let hadContent = false;
      for (const [, msgs] of allMsgs) {
        const m = msgs.find((x) => x.id === messageId);
        if (m) { hadContent = !!m.content; break; }
      }
      if (hadContent) {
        updateMessage(messageId, { status: 'sent' });
      } else {
        updateMessage(messageId, { content: '响应超时，请重试。', status: 'error' });
      }
      if (w.agentId) setAgentIdle(w.agentId);
      try { window.electronAPI?.abortAgentTask?.(w.agentId); } catch {}
    }, STREAM_WATCHDOG_MS);
  }, [updateMessage, setAgentIdle]);

  /** 流式完成：清除 watchdog */
  const onStreamComplete = useCallback((messageId) => {
    clearWatchdog(messageId);
  }, [clearWatchdog]);

  // 卸载时清理所有 watchdog 定时器，避免内存泄漏与卸载后 setState
  useEffect(() => {
    const map = watchdogsRef.current;
    return () => {
      for (const { timer } of map.values()) {
        if (timer) clearTimeout(timer);
      }
      map.clear();
    };
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
      // P1：标记本会话 sendMessage loading（UI 可据此显示 spinner / 禁用发送按钮）
      const loadKey = `sendMessage:${conversationId}`;
      setLoad(loadKey, true);

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
          } else {
            // P0：流式发起成功，挂 watchdog 防卡死
            // 每收到 chunk 会重置定时器；90s 无任何 chunk 则判定卡死并清理 loading。
            startWatchdog(agentMsgId, agentId);
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
        // P1：释放 loading（无论成功失败，IPC 调用已结束）
        // 注意：流式调用提前 return，真正的完成由 onComplete 清 watchdog + loading，
        // 但 IPC startResult 已 await 完成，这里也兜底清 loading 避免泄漏。
        setLoad(loadKey, false);
      }
    },
    [sendMessage, updateMessage, setAgentWorking, setAgentIdle, simulateAgentResponse, startWatchdog, setLoad]
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

      // P1：标记群聊提交 loading（UI 可据此显示 spinner / 禁用发送按钮）
      const loadKey = `groupSubmit:${conversationId}`;
      setLoad(loadKey, true);

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
        } finally {
          setLoad(loadKey, false);
        }
      } else {
        console.warn('submitGroupMessage API 不可用，群聊消息未提交到主进程');
        setLoad(loadKey, false);
      }
    },
    [setLoad]
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
  // P0：传入 onStreamTick / onStreamComplete 给流式 watchdog 使用。
  useAgentIpcEvents({
    setAgentIdle,
    onStreamTick,
    onStreamComplete,
  });

  /**
   * 肃静！—— 停止群聊中所有 Agent 发言
   * Phase 3-B：除了设置前端中断标记 + 中止后端任务，还通知主进程 GroupQueue 肃静。
   * @param {string} conversationId - 群聊对话 ID
   */
  const silenceGroup = useCallback(
    (conversationId) => {
      // P1：标记肃静 loading（UI 可据此显示 spinner / 禁用肃静按钮）
      const loadKey = `silence:${conversationId}`;
      setLoad(loadKey, true);

      try {
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
      } finally {
        // 肃静是同步操作（IPC 调用非 await），但加载状态在事件循环下一帧清掉，
        // 给用户短暂的「正在肃静」视觉反馈。
        setLoad(loadKey, false);
      }
    },
    [sendMessage, setAgentIdle, setLoad]
  );

  return {
    sendToAgent,
    silenceGroup,
    // P1：IPC loading 状态（供 UI 显示 spinner / 禁用按钮）
    // isLoading(key) 查询单个 action；loadingMap 可整体订阅做复杂判断。
    isLoading,
    loadingMap,
  };
}

export default useChatAgent;
