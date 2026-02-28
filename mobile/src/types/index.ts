/**
 * 类型定义
 */

export interface Agent {
  id: string;
  name: string;
  role: string;
  title: string;
  level: string;
  department: string;
  description: string;
  avatar: string;
  model: string;
  status?: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  agentId?: string;
  agentName?: string;
}

export interface Conversation {
  id: string;
  agentId: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  currentAgentId: string | null;
  conversationId: string | null;
  streamingContent: string;
}
