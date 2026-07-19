/**
 * SoloForge - Agent IPC 事件订阅 Hook
 * 从 useChatAgent 抽出的 IPC 订阅逻辑，集中管理主进程 → 渲染进程的事件订阅。
 * 每个 IPC 事件一个 useEffect，依赖数组只包含该事件实际用到的回调，
 * cleanup 中取消订阅，保证 StrictMode 下双订阅安全（幂等）。
 * @module hooks/useAgentIpcEvents
 */

import { useEffect } from 'react';
import { useChatStore } from '../store/chat-store';

/**
 * 订阅主进程推送的 Agent 相关 IPC 事件。
 * 不返回任何值——所有副作用直接写回 chat-store / agent-store。
 *
 * @param {object} handlers - 由 useChatAgent 传入的事件处理回调
 * @param {(conversationId: string, conversation: object, agentIds: string[], triggerContent: string) => Promise<void>} [handlers.handleGroupChat] - 群聊连锁处理函数
 * @param {(conversationId: string, agentId: string) => boolean} [handlers.isAgentInDeptCooldown] - 冷却判断
 * @param {(conversationId: string, agentId: string) => void} [handlers.recordDeptTrigger] - 记录冷却触发
 * @param {(agentId: string) => void} [handlers.setAgentIdle] - 设置 Agent 空闲（来自 agent-store）
 */
export function useAgentIpcEvents({
  handleGroupChat,
  isAgentInDeptCooldown,
  recordDeptTrigger,
  setAgentIdle,
} = {}) {
  // ── 从 chat-store 读取本 hook 需要的 action ──────────────────────
  const appendMessageContent = useChatStore((s) => s.appendMessageContent);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const addToolCalls = useChatStore((s) => s.addToolCalls);
  const updateToolCall = useChatStore((s) => s.updateToolCall);
  const ensurePrivateChat = useChatStore((s) => s.ensurePrivateChat);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const createGroupChat = useChatStore((s) => s.createGroupChat);
  const createDepartmentChat = useChatStore((s) => s.createDepartmentChat);
  const updateDepartmentMembers = useChatStore((s) => s.updateDepartmentMembers);
  const renameDepartmentChat = useChatStore((s) => s.renameDepartmentChat);

  // ── 1. 监听主进程推送的流式消息 ─────────────────────────────────
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

  // ── 2. 监听流式完成事件（处理 Agent 状态和消息最终状态） ────────
  useEffect(() => {
    if (!window.soloforge?.chat?.onComplete) return;

    const unsubscribe = window.soloforge.chat.onComplete((result) => {
      const { messageId, success, content, error } = result;
      console.log('[onComplete] 收到完成事件:', { messageId, success, error: error?.slice?.(0, 100) });
      if (!messageId) return;

      // 查找消息所属的 Agent
      const allMsgs = useChatStore.getState().messagesByConversation;
      let agentId = null;
      let conversationId = null;
      for (const [convId, msgs] of allMsgs) {
        const msg = msgs.find((m) => m.id === messageId);
        if (msg) {
          agentId = msg.senderId;
          conversationId = convId;
          break;
        }
      }

      console.log('[onComplete] 找到消息:', { agentId, conversationId });

      if (agentId) {
        // 设置 Agent 为空闲
        setAgentIdle?.(agentId);
      }

      if (success) {
        // 检查消息内容，清理前缀并标记完成
        const msgs = useChatStore.getState().messagesByConversation.get(conversationId);
        const agentMsg = msgs?.find((m) => m.id === messageId);

        if (agentMsg) {
          if (!agentMsg.content && content) {
            // 流式未推送内容，使用返回的 content
            let cleanContent = content;
            const prefixMatch = cleanContent.match(/^\[[\w-]+\]:\s*/);
            if (prefixMatch) {
              cleanContent = cleanContent.slice(prefixMatch[0].length);
            }
            updateMessage(messageId, { content: cleanContent, status: 'sent' });
          } else if (agentMsg.content) {
            // 流式已填充内容，只需更新状态
            // 清理开头的 [role]: 前缀
            let cleanContent = agentMsg.content;
            const prefixMatch = cleanContent.match(/^\[[\w-]+\]:\s*/);
            if (prefixMatch) {
              cleanContent = cleanContent.slice(prefixMatch[0].length);
              updateMessage(messageId, { content: cleanContent, status: 'sent' });
            } else {
              updateMessage(messageId, { status: 'sent' });
            }
          } else {
            // 内容为空且没有返回 content，标记为已发送（可能是空响应）
            updateMessage(messageId, { status: 'sent' });
          }
        }
      } else {
        // 处理错误 - 但如果消息已有内容（流式已推送），不覆盖
        const msgs = useChatStore.getState().messagesByConversation.get(conversationId);
        const agentMsg = msgs?.find((m) => m.id === messageId);
        if (agentMsg?.content) {
          // 流式已填充内容，不覆盖，只更新状态
          console.log('[onComplete] 错误但已有内容，不覆盖:', agentMsg.content.slice(0, 100));
          updateMessage(messageId, { status: 'sent' });
        } else {
          // 没有内容，显示错误
          updateMessage(messageId, {
            content: error ? `抱歉，处理时遇到问题：${error}` : '抱歉，我暂时无法回应。',
            status: 'error',
          });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [setAgentIdle, updateMessage]);

  // ── 3. 监听 Agent 主动推送消息（审批通知、工作汇报等） ──────────
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

  // ── 4. 监听后端创建群聊事件（Agent 拉群） ───────────────────────
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

  // ── 5. 初始化时主动获取所有部门群聊（解决 IPC 时序问题） ──────────
  useEffect(() => {
    const fetchDepartmentGroups = async () => {
      if (!window.soloforge?.chat?.getAllDepartmentGroups) return;

      try {
        const groups = await window.soloforge.chat.getAllDepartmentGroups();
        console.log('获取部门群聊列表:', groups?.length || 0);

        if (groups && groups.length > 0) {
          for (const { groupId, departmentId, ownerId, name, participants } of groups) {
            createDepartmentChat({
              departmentId,
              ownerId,
              name,
              participants: participants || [ownerId],
              switchTo: false,
            });
          }
        }
      } catch (err) {
        console.error('获取部门群聊失败:', err);
      }
    };

    // 稍微延迟以确保 store 已初始化
    const timer = setTimeout(fetchDepartmentGroups, 500);
    return () => clearTimeout(timer);
  }, [createDepartmentChat]);

  // ── 6. 监听后端创建部门群聊事件 ──────────────────────────────────
  useEffect(() => {
    if (!window.soloforge?.chat?.onDeptGroupCreate) return;

    const unsubscribe = window.soloforge.chat.onDeptGroupCreate((data) => {
      const { groupId, departmentId, ownerId, name, participants } = data;
      if (!groupId || !departmentId) return;

      console.log(`收到后端创建部门群聊: ${name} (${groupId})`, { ownerId, members: participants?.length });

      // 创建部门群聊（不自动切换当前对话）
      createDepartmentChat({
        departmentId,
        ownerId,
        name,
        participants: participants || [ownerId],
        switchTo: false,
      });
    });

    return () => {
      unsubscribe?.();
    };
  }, [createDepartmentChat]);

  // ── 7. 监听部门群聊成员变更 ──────────────────────────────────────
  useEffect(() => {
    if (!window.soloforge?.chat?.onDeptGroupUpdate) return;

    const unsubscribe = window.soloforge.chat.onDeptGroupUpdate((data) => {
      const { action, departmentId, agentId, agentName } = data;
      if (!departmentId || !agentId) return;

      console.log(`部门群聊成员变更: ${action} ${agentName || agentId} -> dept-${departmentId}`);

      updateDepartmentMembers(departmentId, agentId, action);
    });

    return () => {
      unsubscribe?.();
    };
  }, [updateDepartmentMembers]);

  // ── 8. 监听部门群聊消息（支持 @ 触发回复） ──────────────────────
  useEffect(() => {
    if (!window.soloforge?.chat?.onDeptGroupMessage) return;

    const unsubscribe = window.soloforge.chat.onDeptGroupMessage(async (data) => {
      const { groupId, departmentId, senderId, senderName, content, mentions, timestamp } = data;
      if (!groupId || !content) return;

      console.log(`部门群聊消息: ${senderName} -> ${groupId}`, { mentions });

      // 1. 添加消息到部门群聊
      sendMessage({
        conversationId: groupId,
        senderId,
        senderType: 'agent',
        content,
        metadata: {
          departmentMessage: true,
          mentions: mentions || [],
        },
      });

      // 2. 如果有 @ 某人，触发他们回复
      if (mentions && mentions.length > 0) {
        // 获取对话信息
        const conversation = useChatStore.getState().conversations.get(groupId);
        if (!conversation) return;

        // 过滤出有效的被 @ 的 Agent（必须是群成员、不是发送者、不在冷却中）
        const validMentions = mentions.filter((id) => {
          if (id === senderId) return false;
          if (!conversation.participants.includes(id)) return false;
          // 检查前端冷却（双重保险，后端也有冷却）
          if (isAgentInDeptCooldown(groupId, id)) {
            console.log(`部门群聊冷却: ${id} 正在冷却中，跳过`);
            return false;
          }
          return true;
        });

        if (validMentions.length > 0) {
          console.log(`部门群聊触发回复: ${validMentions.join(', ')}`);

          // 记录冷却时间
          validMentions.forEach((id) => recordDeptTrigger(groupId, id));

          // 构造触发内容，确保包含 @ID 格式以便 extractMentions 能识别
          // 例如：[发送者]: 原始内容 @agent1 @agent2
          const mentionTags = validMentions.map((id) => `@${id}`).join(' ');
          const triggerContent = `[${senderName}]: ${content}\n\n（被点名的同事：${mentionTags}）`;

          // 使用现有的群聊处理逻辑
          const agentIds = conversation.participants.filter((p) => p !== 'user');

          // 直接调用 handleGroupChat，它会处理连锁回复
          try {
            await handleGroupChat(groupId, conversation, agentIds, triggerContent);
          } catch (err) {
            console.error('部门群聊回复处理失败:', err);
          }
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [sendMessage, handleGroupChat, isAgentInDeptCooldown, recordDeptTrigger]);

  // ── 9. 监听部门群聊重命名 ────────────────────────────────────────
  useEffect(() => {
    if (!window.soloforge?.chat?.onDeptGroupRename) return;

    const unsubscribe = window.soloforge.chat.onDeptGroupRename((data) => {
      const { departmentId, newName } = data;
      if (!departmentId || !newName) return;

      console.log(`部门群聊重命名: dept-${departmentId} -> ${newName}`);

      renameDepartmentChat(departmentId, newName);
    });

    return () => {
      unsubscribe?.();
    };
  }, [renameDepartmentChat]);
}

export default useAgentIpcEvents;
