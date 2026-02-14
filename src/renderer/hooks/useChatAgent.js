/**
 * SoloForge - 聊天 Agent Hook
 * 处理用户消息发送给 Agent，接收 Agent 响应
 * @module hooks/useChatAgent
 */

import { useCallback, useEffect, useRef } from 'react';
import { useChatStore } from '../store/chat-store';
import { useAgentStore } from '../store/agent-store';

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
          // 流式调用 - 内容会通过 onStream 回调实时推送
          // 只传图片附件给 LLM（音频附件仅用于 UI 展示，LLM 收到的是转写文字）
          const imageAttachments = attachments?.filter((a) => a.type === 'image');

          const result = await window.soloforge.chat.sendMessageStream({
            conversationId,
            agentId,
            message: content,
            attachments: imageAttachments?.length > 0 ? imageAttachments : undefined,
            messageId: agentMsgId, // 用于关联流式推送
            history,
          });

          // 流式完成后，内容已经通过 onStream 追加完毕
          if (result?.content) {
            // 检查消息内容是否为空（可能流式未推送，如 Agent 不存在直接返回错误）
            const currentMsgs = useChatStore.getState().messagesByConversation.get(conversationId) ?? [];
            const agentMsg = currentMsgs.find((m) => m.id === agentMsgId);
            if (agentMsg && !agentMsg.content) {
              // 内容为空说明流式没有推送，直接使用返回的 content
              let cleanContent = result.content;
              const prefixMatch = cleanContent.match(/^\[[\w-]+\]:\s*/);
              if (prefixMatch) {
                cleanContent = cleanContent.slice(prefixMatch[0].length);
              }
              updateMessage(agentMsgId, {
                content: cleanContent,
                status: 'sent',
              });
            } else if (agentMsg?.content) {
              // 流式已填充内容，清理开头的 [role]: 前缀
              let cleanContent = agentMsg.content;
              const prefixMatch = cleanContent.match(/^\[[\w-]+\]:\s*/);
              if (prefixMatch) {
                cleanContent = cleanContent.slice(prefixMatch[0].length);
              }
              updateMessage(agentMsgId, {
                content: cleanContent,
                status: 'sent',
              });
            } else {
              updateMessage(agentMsgId, { status: 'sent' });
            }
          } else {
            updateMessage(agentMsgId, {
              content: '抱歉，我暂时无法回应。',
              status: 'error',
            });
          }
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
            let cleanContent = result.content;
            const prefixMatch = cleanContent.match(/^\[(\w+)\]:\s*/);
            if (prefixMatch) {
              cleanContent = cleanContent.slice(prefixMatch[0].length);
            }
            
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
   * 从文本中提取 @mention 的 Agent ID
   * 支持 @agentId 和 @人名 两种格式
   * @param {string} text
   * @param {string[]} validAgentIds - 有效的 Agent ID 列表
   * @param {Map<string,string>} [nameToIdMap] - 人名→ID 映射（用于识别 @人名）
   * @returns {string[]}
   */
  const extractMentions = useCallback((text, validAgentIds, nameToIdMap) => {
    if (!text) return [];
    const mentioned = new Set();

    // 1. 检测 @agentId 格式
    for (const id of validAgentIds) {
      if (text.includes(`@${id}`)) {
        mentioned.add(id);
      }
    }

    // 2. 检测 @人名 格式（如果提供了映射）
    if (nameToIdMap) {
      for (const [name, id] of nameToIdMap.entries()) {
        if (text.includes(`@${name}`)) {
          mentioned.add(id);
        }
      }
    }

    return [...mentioned];
  }, []);

  /**
   * 处理群聊消息（支持 Agent 间 @ 连锁回复）
   * 最多允许 5 轮连锁，防止无限循环
   */
  const handleGroupChat = useCallback(
    async (conversationId, conversation, agentIds, userContent) => {
      const MAX_CHAIN_ROUNDS = 5; // 最大连锁轮数
      const agentsMap = useAgentStore.getState().agents;

      // 重置中断标记
      groupAbortRef.current = false;

      // ── 构建 ID ↔ 人名 映射 ────────────────────────
      const idToName = new Map();  // agentId → 人名
      const nameToId = new Map();  // 人名 → agentId
      for (const id of agentIds) {
        const agent = agentsMap.get(id);
        const name = agent?.name || id;
        idToName.set(id, name);
        nameToId.set(name, id);
      }

      // 构建参与者列表（人名格式）
      const participantsList = agentIds
        .map((id) => {
          const agent = agentsMap.get(id);
          const name = idToName.get(id);
          const title = agent?.title || '';
          return `  - ${name}${title ? `（${title}）` : ''}`;
        })
        .join('\n');

      // 通用群聊规则（不含身份信息，身份信息在每个 Agent 的消息中单独注入）
      const groupRules = `[群聊: ${conversation.name}]

【群内成员】
${participantsList}

【群聊规则 - 必须严格遵守】
0. 你已经被点名发言了（系统只会把消息发给被 @ 的人），请直接回复。
1. 禁止使用 send_to_agent 联系群内成员！群里所有人都能看到你的发言，直接说即可。需要其他成员回应时，用 @人名 的格式（如 @${idToName.get(agentIds[0]) || agentIds[0]}）。只有联系群外人员才可用 send_to_agent。
2. 提到其他群成员时，必须使用 @人名，不要使用 @ID 格式。绝对禁止 @你自己——你不能点名自己。
3. 发言前务必仔细阅读上方所有人的发言内容。如果别人已经提出了某个观点或方案，你不要重复提出类似的内容。
4. 你应该基于他人已有的发言进行补充、提出不同角度、指出潜在问题、或表示认同并补充细节。避免"各说各话"。
5. 只从你自己的专业领域角度发言。不要越界分析其他部门的专业问题。
6. 如果前面已有人充分阐述了与你观点一致的内容，简要表示认同并补充你的专业视角即可，不必重复长篇论述。
`;

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
        if (groupAbortRef.current) {
          console.log('群聊已被肃静，停止后续回复');
          break;
        }

        round++;

        // 按层级排序
        const sorted = pendingAgents
          .map((id) => ({ id, level: agentsMap.get(id)?.level ?? 99 }))
          .sort((a, b) => a.level - b.level);

        // 本轮新 @ 的 Agent（下一轮待处理）
        const nextPending = [];

        for (const { id: targetAgent } of sorted) {
          // 检查中断标记
          if (groupAbortRef.current) {
            console.log('群聊已被肃静，跳过剩余 Agent');
            break;
          }
          if (repliedAgents.has(targetAgent)) continue; // 已经回复过了
          repliedAgents.add(targetAgent);

          const agentName = idToName.get(targetAgent) || targetAgent;

          // 个性化身份提醒（注入到每个 Agent 的消息开头）
          const identityReminder = `【你的身份提醒】你是「${agentName}」。你在这个群聊中被点名了，请直接发言。记住：不要 @${agentName}（那是你自己）。\n\n`;

          // 获取最新 history（排除已删除的消息）
          const updatedMessages =
            useChatStore.getState().messagesByConversation.get(conversationId) ?? [];
          const updatedHistory = updatedMessages
            .filter((m) => !m.deleted)
            .slice(-20)
            .map((m) => ({
              role: m.senderType === 'user' ? 'user' : 'assistant',
              content:
                m.senderType === 'agent'
                  ? `[${idToName.get(m.senderId) || m.senderId}]: ${m.content}`
                  : m.content,
            }));

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
          const agentReply = [...latestMsgs]
            .reverse()
            .find((m) => m.senderId === targetAgent && m.senderType === 'agent');

          if (agentReply?.content) {
            const newMentions = extractMentions(agentReply.content, agentIds, nameToId).filter(
              (id) => !repliedAgents.has(id) && id !== targetAgent
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

      if (round >= MAX_CHAIN_ROUNDS && pendingAgents.length > 0) {
        console.warn('群聊连锁回复达到最大轮数限制:', MAX_CHAIN_ROUNDS);
      }
    },
    [sendToSingleAgent, extractMentions]
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
      const history = freshMessages
        .filter((m) => !m.deleted) // 被用户删除的消息不进入上下文
        .slice(-20) // 只保留最近 20 条，避免 context 过长
        .map((m) => ({
          role: m.senderType === 'user' ? 'user' : 'assistant',
          content: m.senderType === 'agent' ? `[${m.senderId}]: ${m.content}` : m.content,
        }));

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

  // 监听主进程推送的流式消息（如果有）
  const addToolCalls = useChatStore((s) => s.addToolCalls);
  const updateToolCall = useChatStore((s) => s.updateToolCall);

  useEffect(() => {
    if (!window.soloforge?.chat?.onStream) return;

    const unsubscribe = window.soloforge.chat.onStream((chunk) => {
      // 文本内容（包括 <!--tool-group:N--> 标记）
      if (chunk.messageId && chunk.content) {
        appendMessageContent(chunk.messageId, chunk.content);
      }
      // 工具事件（结构化数据）
      if (chunk.messageId && chunk.toolEvent) {
        const { toolEvent } = chunk;
        if (toolEvent.type === 'tool_start' && toolEvent.tools?.length) {
          addToolCalls(chunk.messageId, toolEvent.groupIndex, toolEvent.tools);
        } else if (toolEvent.type === 'tool_result' && toolEvent.id) {
          updateToolCall(chunk.messageId, toolEvent.id, {
            success: toolEvent.success,
            result: toolEvent.result,
            error: toolEvent.error,
            duration: toolEvent.duration,
          });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [appendMessageContent, addToolCalls, updateToolCall]);

  // 监听 Agent 主动推送消息（审批通知、工作汇报等）
  // 使用 ensurePrivateChat 而非 getOrCreatePrivateChat，避免自动切换对话打断用户
  const ensurePrivateChat = useChatStore((s) => s.ensurePrivateChat);

  useEffect(() => {
    if (!window.soloforge?.chat?.onProactiveMessage) return;

    const unsubscribe = window.soloforge.chat.onProactiveMessage((data) => {
      const { agentId, agentName, content } = data;
      if (!agentId || !content) return;

      console.log(`收到 Agent 主动推送: ${agentName} (${agentId})`);

      // 确保该 Agent 的私聊对话存在（不切换当前对话）
      const conversationId = ensurePrivateChat(agentId, agentName);

      // 添加消息到对话中（senderType: 'agent' 会自动增加 unreadCount）
      sendMessage({
        conversationId,
        senderId: agentId,
        senderType: 'agent',
        content,
        metadata: { proactive: true },
      });
    });

    return () => {
      unsubscribe?.();
    };
  }, [ensurePrivateChat, sendMessage]);

  // 监听后端创建群聊事件（Agent 拉群）
  const createGroupChat = useChatStore((s) => s.createGroupChat);

  useEffect(() => {
    if (!window.soloforge?.chat?.onCreateGroup) return;

    const unsubscribe = window.soloforge.chat.onCreateGroup((data) => {
      const { groupId, name, participants, creatorId, creatorName, initialMessage } = data;
      if (!groupId || !participants?.length) return;

      console.log(`收到后端创建群聊: ${name} (${groupId})，由 ${creatorName} 发起`);

      // 创建群聊（不自动切换当前对话，避免打断用户）
      createGroupChat({ id: groupId, name, participants, switchTo: false });

      // 如果有初始消息，添加到群里
      if (initialMessage && creatorId) {
        sendMessage({
          conversationId: groupId,
          senderId: creatorId,
          senderType: 'agent',
          content: initialMessage,
          metadata: { groupCreation: true },
        });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [createGroupChat, sendMessage]);

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
