/**
 * 聊天状态管理（Zustand）
 */

import { create } from 'zustand';
import { Message, Conversation } from '../types';

interface ChatStore {
  // 状态
  messages: Message[];
  isLoading: boolean;
  currentAgentId: string | null;
  conversationId: string | null;
  streamingContent: string;
  conversations: Conversation[];

  // 操作
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setIsLoading: (loading: boolean) => void;
  setCurrentAgent: (agentId: string) => void;
  setConversationId: (id: string | null) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (token: string) => void;
  clearChat: () => void;
  setConversations: (conversations: Conversation[]) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  // 初始状态
  messages: [],
  isLoading: false,
  currentAgentId: null,
  conversationId: null,
  streamingContent: '',
  conversations: [],

  // 操作实现
  setMessages: (messages) => set({ messages }),
  
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  
  setIsLoading: (isLoading) => set({ isLoading }),
  
  setCurrentAgent: (agentId) =>
    set({ currentAgentId: agentId, messages: [], conversationId: null }),
  
  setConversationId: (conversationId) => set({ conversationId }),
  
  setStreamingContent: (streamingContent) => set({ streamingContent }),
  
  appendStreamingContent: (token) =>
    set((state) => ({ streamingContent: state.streamingContent + token })),
  
  clearChat: () =>
    set({
      messages: [],
      streamingContent: '',
      conversationId: null,
    }),

  setConversations: (conversations) => set({ conversations }),
}));
