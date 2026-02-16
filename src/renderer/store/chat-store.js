/**
 * SoloForge - 聊天状态管理 (Zustand)
 * 
 * 设计原则：
 * - 每个 Agent 只有一个对话窗口（1:1 映射，conversationId = agentId）
 * - 群聊仍可通过弹窗创建（ID 前缀 group-）
 * - Clear 只清空视窗显示，不删除实际历史记录
 * - 历史记录持久化到 localStorage，供 Agent 分页查找
 * 
 * @module store/chat-store
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * @typedef {'private' | 'group' | 'department'} ConversationType
 * @typedef {'sending' | 'sent' | 'error'} MessageStatus
 *
 * @typedef {Object} Attachment
 * @property {string} id - 附件唯一 ID (uuid)
 * @property {'image' | 'audio'} type - 附件类型
 * @property {string} path - 本地文件路径 (~/.soloforge/attachments/xxx.png)
 * @property {string} mimeType - MIME 类型 (image/png, audio/webm 等)
 * @property {string} filename - 原始文件名
 * @property {number} size - 文件大小 (bytes)
 * @property {number} [duration] - 音频时长 (秒，仅 audio 类型)
 * @property {string} [transcription] - 语音转写文本 (仅 audio 类型)
 *
 * @typedef {Object} Message
 * @property {string} id
 * @property {string} conversationId
 * @property {string} senderId
 * @property {'user' | 'agent'} senderType
 * @property {string} content
 * @property {Attachment[]} [attachments] - 附件列表（图片等）
 * @property {number} timestamp
 * @property {MessageStatus} status
 * @property {Object} [metadata]
 *
 * @typedef {Object} Conversation
 * @property {string} id
 * @property {ConversationType} type
 * @property {string} name
 * @property {string[]} participants
 * @property {number} createdAt
 * @property {Message} [lastMessage]
 * @property {number} unreadCount
 * @property {number} [displayClearedAt] - 清屏时间戳，早于此时间的消息不显示
 * @property {string} [departmentId] - 部门 ID（仅 department 类型）
 * @property {string} [ownerId] - 群主 Agent ID（仅 department 类型）
 */

function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 基于 IPC + 文件的持久化存储适配器（带防抖）
 *
 * 不使用 localStorage（Chromium LevelDB），因为：
 * - Electron 进程被强杀时 LevelDB 来不及刷盘，数据丢失
 * - 开发模式频繁重启容易触发此问题
 *
 * 改为通过 IPC 调用主进程写入 ~/.soloforge/chat-history.json，
 * 主进程使用 fs.writeFileSync 确保每次写入立即落盘。
 *
 * 防抖：流式输出时每个 chunk 都会触发 setItem，用 debounce 合并为一次写入。
 */
let _saveTimer = null;
let _pendingValue = null;
const SAVE_DEBOUNCE_MS = 2000; // 2 秒防抖

function _flushSave() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (_pendingValue) {
    const value = _pendingValue;
    _pendingValue = null;
    _doSetItem(value).catch((e) => console.error('chat-store: flush setItem 失败', e));
  }
}

async function _doSetItem(value) {
  const state = value.state || {};
  const serializedState = {};
  for (const [key, val] of Object.entries(state)) {
    if (val instanceof Map) {
      serializedState[key] = Object.fromEntries(val);
    } else if (val instanceof Set) {
      serializedState[key] = Array.from(val);
    } else {
      serializedState[key] = val;
    }
  }
  await window.electronAPI.setChatHistory({ ...value, state: serializedState });
}

// 窗口关闭前确保数据落盘
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', _flushSave);
}

const ipcFileStorage = {
  getItem: async () => {
    try {
      const data = await window.electronAPI.getChatHistory();
      if (!data) return null;

      // 将普通对象转换回 Map / Set
      if (data.state) {
        if (data.state.conversations && !(data.state.conversations instanceof Map)) {
          data.state.conversations = new Map(Object.entries(data.state.conversations));
        }
        if (data.state.messagesByConversation && !(data.state.messagesByConversation instanceof Map)) {
          data.state.messagesByConversation = new Map(Object.entries(data.state.messagesByConversation));
        }
        if (data.state.hiddenConversations && !(data.state.hiddenConversations instanceof Set)) {
          data.state.hiddenConversations = new Set(
            Array.isArray(data.state.hiddenConversations) ? data.state.hiddenConversations : []
          );
        }
      }
      return data;
    } catch (e) {
      console.error('chat-store: getItem (IPC) 失败', e);
      return null;
    }
  },
  setItem: async (_name, value) => {
    try {
      // 防抖：短时间内的多次写入合并为一次
      _pendingValue = value;
      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => {
        _saveTimer = null;
        const v = _pendingValue;
        _pendingValue = null;
        if (v) _doSetItem(v).catch((e) => console.error('chat-store: debounced setItem 失败', e));
      }, SAVE_DEBOUNCE_MS);
    } catch (e) {
      console.error('chat-store: setItem (IPC) 失败', e);
    }
  },
  removeItem: async () => {
    try {
      await window.electronAPI.removeChatHistory();
    } catch (e) {
      console.error('chat-store: removeItem (IPC) 失败', e);
    }
  },
};

/**
 * 聊天状态 Store
 */
export const useChatStore = create(
  persist(
    (set, get) => ({
      /** @type {Map<string, Conversation>} */
      conversations: new Map(),

      /** @type {Map<string, Message[]>} conversationId -> 全部消息（含已清空的） */
      messagesByConversation: new Map(),

      /** @type {string | null} */
      currentConversationId: null,

      /** @type {Set<string>} 隐藏的对话 ID（Agent ID），不显示在侧栏但保留记录 */
      hiddenConversations: new Set(),

      /** @type {boolean} */
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),

      // ─────────────────────────────────────────────────────────
      // 对话操作
      // ─────────────────────────────────────────────────────────

      /**
       * 获取或创建私聊对话（每个 Agent 只有一个）
       * 用户点击联系人时调用，会切换到该对话
       * @param {string} agentId
       * @param {string} agentName
       * @returns {string} conversationId
       */
      getOrCreatePrivateChat: (agentId, agentName) => {
        const { conversations } = get();

        // 查找已存在的私聊
        for (const [id, conv] of conversations) {
          if (conv.type === 'private' && conv.participants.includes(agentId)) {
            // 已存在 → 选中并清零未读
            set((state) => {
              const next = new Map(state.conversations);
              const existing = next.get(id);
              if (existing && existing.unreadCount > 0) {
                next.set(id, { ...existing, unreadCount: 0 });
              }
              return { currentConversationId: id, conversations: next };
            });
            return id;
          }
        }

        // 不存在 → 创建
        const id = `private-${agentId}`;
        const conversation = {
          id,
          type: 'private',
          name: agentName,
          participants: ['user', agentId],
          createdAt: Date.now(),
          lastMessage: null,
          unreadCount: 0,
          displayClearedAt: null,
        };

        set((state) => {
          const next = new Map(state.conversations);
          next.set(id, conversation);
          return {
            conversations: next,
            messagesByConversation: new Map(state.messagesByConversation).set(id, []),
            currentConversationId: id,
          };
        });

        return id;
      },

      /**
       * 确保私聊对话存在（不切换当前对话）
       * 用于后台推送消息时，只创建/查找对话，不改变用户正在看的对话
       * @param {string} agentId
       * @param {string} agentName
       * @returns {string} conversationId
       */
      ensurePrivateChat: (agentId, agentName) => {
        const { conversations } = get();

        // 查找已存在的私聊
        for (const [id, conv] of conversations) {
          if (conv.type === 'private' && conv.participants.includes(agentId)) {
            return id;
          }
        }

        // 不存在 → 创建（不切换 currentConversationId）
        const id = `private-${agentId}`;
        const conversation = {
          id,
          type: 'private',
          name: agentName,
          participants: ['user', agentId],
          createdAt: Date.now(),
          lastMessage: null,
          unreadCount: 0,
          displayClearedAt: null,
        };

        set((state) => {
          const next = new Map(state.conversations);
          next.set(id, conversation);
          return {
            conversations: next,
            messagesByConversation: new Map(state.messagesByConversation).set(id, []),
          };
        });

        return id;
      },

      /**
       * 创建群聊（仍允许多个）
       */
      createGroupChat: ({ name, participants, id: externalId, switchTo = true }) => {
        const id = externalId || generateId('group');

        // 如果已经存在，直接返回
        const existing = get().conversations.get(id);
        if (existing) return id;

        const conversation = {
          id,
          type: 'group',
          name,
          participants: ['user', ...participants],
          createdAt: Date.now(),
          lastMessage: null,
          unreadCount: 0,
          displayClearedAt: null,
        };

        set((state) => {
          const next = new Map(state.conversations);
          next.set(id, conversation);
          return {
            conversations: next,
            messagesByConversation: new Map(state.messagesByConversation).set(id, []),
            ...(switchTo ? { currentConversationId: id } : {}),
          };
        });

        return id;
      },

      /**
       * 创建部门群聊（CXO 团队专属）
       * @param {Object} params
       * @param {string} params.departmentId - 部门 ID
       * @param {string} params.ownerId - 群主（CXO）Agent ID
       * @param {string} params.name - 群名（CXO 可自定义）
       * @param {string[]} params.participants - 成员列表（不含 user，会自动添加）
       * @param {boolean} [params.switchTo=false] - 是否切换到该对话
       * @returns {string} conversationId
       */
      createDepartmentChat: ({ departmentId, ownerId, name, participants, switchTo = false }) => {
        const id = `dept-${departmentId}`;
        const newParticipants = ['user', ...participants];

        // 如果已经存在，同步成员列表（可能有新成员加入或旧成员移除）
        const existing = get().conversations.get(id);
        if (existing) {
          // 检查成员列表是否有变化
          const oldSet = new Set(existing.participants);
          const newSet = new Set(newParticipants);
          const hasChanges = oldSet.size !== newSet.size || 
            [...oldSet].some(p => !newSet.has(p)) ||
            [...newSet].some(p => !oldSet.has(p));
          
          if (hasChanges) {
            // 更新现有群聊的成员列表
            set((state) => {
              const next = new Map(state.conversations);
              next.set(id, {
                ...existing,
                participants: newParticipants,
                ownerId: ownerId || existing.ownerId,
                name: name || existing.name,
              });
              return { conversations: next };
            });
            console.log(`部门群聊成员同步: ${id}`, {
              old: existing.participants.length,
              new: newParticipants.length,
            });
          }
          return id;
        }

        const conversation = {
          id,
          type: 'department',
          name,
          departmentId,
          ownerId,
          participants: newParticipants,
          createdAt: Date.now(),
          lastMessage: null,
          unreadCount: 0,
          displayClearedAt: null,
        };

        set((state) => {
          const next = new Map(state.conversations);
          next.set(id, conversation);
          return {
            conversations: next,
            messagesByConversation: new Map(state.messagesByConversation).set(id, []),
            ...(switchTo ? { currentConversationId: id } : {}),
          };
        });

        return id;
      },

      /**
       * 更新部门群聊成员（添加或移除）
       * @param {string} departmentId - 部门 ID
       * @param {string} agentId - Agent ID
       * @param {'add' | 'remove'} action - 操作类型
       */
      updateDepartmentMembers: (departmentId, agentId, action) => {
        const id = `dept-${departmentId}`;
        set((state) => {
          const conv = state.conversations.get(id);
          if (!conv || conv.type !== 'department') return state;

          const next = new Map(state.conversations);
          let participants = [...conv.participants];

          if (action === 'add' && !participants.includes(agentId)) {
            participants.push(agentId);
          } else if (action === 'remove') {
            participants = participants.filter((p) => p !== agentId);
          }

          next.set(id, { ...conv, participants });
          return { conversations: next };
        });
      },

      /**
       * 重命名部门群聊
       * @param {string} departmentId - 部门 ID
       * @param {string} newName - 新群名
       */
      renameDepartmentChat: (departmentId, newName) => {
        const id = `dept-${departmentId}`;
        set((state) => {
          const conv = state.conversations.get(id);
          if (!conv || conv.type !== 'department') return state;

          const next = new Map(state.conversations);
          next.set(id, { ...conv, name: newName });
          return { conversations: next };
        });
      },

      /**
       * 根据部门 ID 查找部门群聊
       * @param {string} departmentId
       * @returns {Conversation | null}
       */
      findDepartmentChat: (departmentId) => {
        const id = `dept-${departmentId}`;
        return get().conversations.get(id) || null;
      },

      /**
       * 选择对话
       */
      selectConversation: (conversationId) => {
        set((state) => {
          if (conversationId) {
            const next = new Map(state.conversations);
            const conv = next.get(conversationId);
            if (conv) {
              next.set(conversationId, { ...conv, unreadCount: 0 });
            }
            return { currentConversationId: conversationId, conversations: next };
          }
          return { currentConversationId: conversationId };
        });
      },

      /**
       * 清空对话视窗（只隐藏显示，不删除历史记录）
       */
      clearConversationDisplay: (conversationId) => {
        set((state) => {
          const next = new Map(state.conversations);
          const conv = next.get(conversationId);
          if (conv) {
            next.set(conversationId, { ...conv, displayClearedAt: Date.now() });
          }
          return { conversations: next };
        });
      },

      /**
       * 删除对话（仅普通群聊可删除，私聊和部门群聊不可删除）
       */
      deleteConversation: (conversationId) => {
        set((state) => {
          const conv = state.conversations.get(conversationId);
          // 私聊和部门群聊不允许删除
          if (!conv || conv.type === 'private' || conv.type === 'department') return state;

          const nextConvs = new Map(state.conversations);
          const nextMsgs = new Map(state.messagesByConversation);
          nextConvs.delete(conversationId);
          nextMsgs.delete(conversationId);

          return {
            conversations: nextConvs,
            messagesByConversation: nextMsgs,
            currentConversationId:
              state.currentConversationId === conversationId ? null : state.currentConversationId,
          };
        });
      },

      // ─────────────────────────────────────────────────────────
      // 消息操作
      // ─────────────────────────────────────────────────────────

      /**
       * 发送消息
       * @returns {string} 消息 ID
       */
      sendMessage: ({ conversationId, senderId, senderType, content, metadata, attachments }) => {
        const id = generateId('msg');
        const message = {
          id,
          conversationId,
          senderId,
          senderType,
          content,
          timestamp: Date.now(),
          status: senderType === 'user' ? 'sending' : 'sent',
          metadata,
          ...(attachments?.length ? { attachments } : {}),
        };

        set((state) => {
          const nextMsgs = new Map(state.messagesByConversation);
          const msgs = nextMsgs.get(conversationId) ?? [];
          nextMsgs.set(conversationId, [...msgs, message]);

          const nextConvs = new Map(state.conversations);
          const conv = nextConvs.get(conversationId);
          if (conv) {
            const isCurrentConv = state.currentConversationId === conversationId;
            nextConvs.set(conversationId, {
              ...conv,
              lastMessage: message,
              unreadCount: isCurrentConv ? 0 : conv.unreadCount + (senderType === 'agent' ? 1 : 0),
            });
          }

          return { messagesByConversation: nextMsgs, conversations: nextConvs };
        });

        return id;
      },

      /**
       * 更新消息（同时同步更新 lastMessage 快照）
       */
      updateMessage: (messageId, updates) => {
        set((state) => {
          const nextMsgs = new Map(state.messagesByConversation);
          for (const [convId, msgs] of nextMsgs) {
            const idx = msgs.findIndex((m) => m.id === messageId);
            if (idx !== -1) {
              const updatedMsgs = [...msgs];
              updatedMsgs[idx] = { ...updatedMsgs[idx], ...updates };
              nextMsgs.set(convId, updatedMsgs);

              // 同步更新 lastMessage 快照，避免左侧摘要与右侧内容不一致
              const nextConvs = new Map(state.conversations);
              const conv = nextConvs.get(convId);
              if (conv && conv.lastMessage?.id === messageId) {
                nextConvs.set(convId, { ...conv, lastMessage: updatedMsgs[idx] });
                return { messagesByConversation: nextMsgs, conversations: nextConvs };
              }
              return { messagesByConversation: nextMsgs };
            }
          }
          return { messagesByConversation: nextMsgs };
        });
      },

      /**
       * 软删除消息（标记 deleted=true，不从列表中移除）
       * 被删除的消息不会显示在 UI 中，也不会进入 Agent 上下文
       * @param {string} conversationId - 对话 ID
       * @param {string[]} messageIds - 要删除的消息 ID 列表（支持批量）
       */
      deleteMessages: (conversationId, messageIds) => {
        if (!conversationId || !messageIds?.length) return;
        const idSet = new Set(messageIds);

        set((state) => {
          const nextMsgs = new Map(state.messagesByConversation);
          const msgs = nextMsgs.get(conversationId);
          if (!msgs) return state;

          const updatedMsgs = msgs.map((m) =>
            idSet.has(m.id) ? { ...m, deleted: true } : m
          );
          nextMsgs.set(conversationId, updatedMsgs);

          // 更新 lastMessage（取最后一条未删除的消息）
          const nextConvs = new Map(state.conversations);
          const conv = nextConvs.get(conversationId);
          if (conv) {
            const lastVisible = updatedMsgs.filter((m) => !m.deleted).pop() || null;
            nextConvs.set(conversationId, { ...conv, lastMessage: lastVisible });
            return { messagesByConversation: nextMsgs, conversations: nextConvs };
          }
          return { messagesByConversation: nextMsgs };
        });
      },

      /**
       * 追加消息内容（流式输出）
       */
      appendMessageContent: (messageId, chunk) => {
        set((state) => {
          const nextMsgs = new Map(state.messagesByConversation);
          for (const [convId, msgs] of nextMsgs) {
            const idx = msgs.findIndex((m) => m.id === messageId);
            if (idx !== -1) {
              const updatedMsgs = [...msgs];
              const msg = updatedMsgs[idx];
              updatedMsgs[idx] = { ...msg, content: msg.content + chunk };
              nextMsgs.set(convId, updatedMsgs);

              const nextConvs = new Map(state.conversations);
              const conv = nextConvs.get(convId);
              if (conv && conv.lastMessage?.id === messageId) {
                nextConvs.set(convId, { ...conv, lastMessage: updatedMsgs[idx] });
                return { messagesByConversation: nextMsgs, conversations: nextConvs };
              }
              return { messagesByConversation: nextMsgs };
            }
          }
          return state;
        });
      },

      /**
       * 添加一批工具调用到消息（工具开始执行时调用）
       * @param {string} messageId - 消息 ID
       * @param {number} groupIndex - 本消息内第几批工具调用
       * @param {Array<{id: string, name: string, args: Object}>} tools - 工具列表
       */
      addToolCalls: (messageId, groupIndex, tools) => {
        set((state) => {
          const nextMsgs = new Map(state.messagesByConversation);
          for (const [convId, msgs] of nextMsgs) {
            const idx = msgs.findIndex((m) => m.id === messageId);
            if (idx !== -1) {
              const updatedMsgs = [...msgs];
              const msg = updatedMsgs[idx];
              const existingToolCalls = msg.toolCalls || [];
              const newToolCalls = tools.map((t) => ({
                id: t.id,
                name: t.name,
                args: t.args || {},
                groupIndex,
                status: 'running',
                result: null,
                error: null,
                duration: null,
                timestamp: Date.now(),
              }));
              updatedMsgs[idx] = {
                ...msg,
                toolCalls: [...existingToolCalls, ...newToolCalls],
              };
              nextMsgs.set(convId, updatedMsgs);
              return { messagesByConversation: nextMsgs };
            }
          }
          return state;
        });
      },

      /**
       * 更新单个工具调用的结果
       * @param {string} messageId - 消息 ID
       * @param {string} toolCallId - 工具调用 ID
       * @param {Object} updates - 更新内容 { success, result, error, duration }
       */
      updateToolCall: (messageId, toolCallId, updates) => {
        set((state) => {
          const nextMsgs = new Map(state.messagesByConversation);
          for (const [convId, msgs] of nextMsgs) {
            const idx = msgs.findIndex((m) => m.id === messageId);
            if (idx !== -1) {
              const msg = msgs[idx];
              if (!msg.toolCalls?.length) return state;
              const tcIdx = msg.toolCalls.findIndex((tc) => tc.id === toolCallId);
              if (tcIdx === -1) return state;
              const updatedMsgs = [...msgs];
              const updatedToolCalls = [...msg.toolCalls];
              updatedToolCalls[tcIdx] = {
                ...updatedToolCalls[tcIdx],
                status: updates.success ? 'success' : 'error',
                result: updates.result ?? null,
                error: updates.error ?? null,
                duration: updates.duration ?? null,
              };
              updatedMsgs[idx] = { ...msg, toolCalls: updatedToolCalls };
              nextMsgs.set(convId, updatedMsgs);
              return { messagesByConversation: nextMsgs };
            }
          }
          return state;
        });
      },

      // ─────────────────────────────────────────────────────────
      // 查询方法
      // ─────────────────────────────────────────────────────────

      /**
       * 获取对话的全部消息（含已清空的，供后端 Agent 查找用）
       */
      getMessages: (conversationId) => {
        return get().messagesByConversation.get(conversationId) ?? [];
      },

      /**
       * 获取对话的可见消息（过滤 displayClearedAt 之前的）
       */
      getVisibleMessages: (conversationId) => {
        const { conversations, messagesByConversation } = get();
        const conv = conversations.get(conversationId);
        const msgs = messagesByConversation.get(conversationId) ?? [];
        if (!conv?.displayClearedAt) return msgs;
        return msgs.filter((m) => m.timestamp > conv.displayClearedAt);
      },

      getCurrentConversation: () => {
        const { currentConversationId, conversations } = get();
        return currentConversationId ? conversations.get(currentConversationId) ?? null : null;
      },

      getCurrentMessages: () => {
        const { currentConversationId } = get();
        return currentConversationId ? get().getVisibleMessages(currentConversationId) : [];
      },

      /**
       * 根据 agentId 查找已有的私聊对话
       */
      findPrivateChatByAgent: (agentId) => {
        const { conversations } = get();
        for (const [, conv] of conversations) {
          if (conv.type === 'private' && conv.participants.includes(agentId)) {
            return conv;
          }
        }
        return null;
      },

      /**
       * 隐藏对话（从侧栏移除，但保留记录）
       * @param {string} agentId - Agent ID（私聊用 agentId，群聊用 conversationId）
       */
      hideConversation: (agentId) => {
        set((state) => {
          const next = new Set(state.hiddenConversations);
          next.add(agentId);
          // 如果当前正在看这个对话，切到空
          const shouldClearCurrent =
            state.currentConversationId === agentId ||
            (() => {
              const conv = state.conversations.get(state.currentConversationId);
              return conv?.type === 'private' && conv?.participants?.includes(agentId);
            })();
          return {
            hiddenConversations: next,
            ...(shouldClearCurrent ? { currentConversationId: null } : {}),
          };
        });
      },

      /**
       * 恢复隐藏的对话（重新显示在侧栏）
       * @param {string} agentId
       */
      unhideConversation: (agentId) => {
        set((state) => {
          const next = new Set(state.hiddenConversations);
          next.delete(agentId);
          return { hiddenConversations: next };
        });
      },

      /**
       * 清空所有对话历史（危险操作）
       */
      clearAllConversations: () => {
        set({
          conversations: new Map(),
          messagesByConversation: new Map(),
          currentConversationId: null,
          hiddenConversations: new Set(),
        });
      },
    }),
    {
      name: 'soloforge-chat-history',
      storage: ipcFileStorage,
      partialize: (state) => ({
        conversations: state.conversations,
        messagesByConversation: state.messagesByConversation,
        hiddenConversations: state.hiddenConversations,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

export default useChatStore;
