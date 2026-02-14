/**
 * SoloForge - 联系人列表
 * 左侧边栏：显示所有 Agent 作为联系人，每个 Agent 一个对话
 * @module components/chat/ConversationList
 */

import { useCallback, useMemo, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useAgentStore } from '../../store/agent-store';
import AgentAvatar from '../AgentAvatar';

/**
 * 清理消息内容用于摘要显示
 * - 去除 LLM 输出的 [role]: 前缀
 * - 去除工具调用标记 _正在查询: ..._
 * - 去除 markdown 斜体/粗体标记
 * - 取最后一段有意义的内容（多轮工具调用时，最新内容在末尾）
 */
function cleanExcerpt(content) {
  if (!content) return '';

  // 去掉 [role]: 前缀
  let cleaned = content.replace(/^\[[\w-]+\]:\s*/g, '');

  // 去掉工具分组标记 <!--tool-group:N-->
  cleaned = cleaned.replace(/<!--tool-group:\d+-->/g, '');

  // 如果有多段（工具调用会产生换行分段），取最后一段非空内容
  const paragraphs = cleaned.split(/\n{2,}/).filter((p) => p.trim());
  if (paragraphs.length > 1) {
    // 从后往前找第一段非工具标记的内容
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const p = paragraphs[i].trim();
      // 跳过工具调用标记
      if (p.startsWith('_正在查询') || p.startsWith('正在查询')) continue;
      // 跳过系统标记
      if (p.startsWith('（已达到') || p.startsWith('---')) continue;
      // 跳过系统指令
      if (p.startsWith('【系统指令】')) continue;
      cleaned = p;
      break;
    }
  }

  // 去掉 markdown 标记
  cleaned = cleaned.replace(/[_*`]/g, '').trim();

  return cleaned;
}

/**
 * 格式化时间戳为简短显示
 */
function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return '昨天';
  }

  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/**
 * 联系人卡片（Agent）
 */
function ContactItem({ agent, conversation, actualLastMsg, isActive, onClick, onHide }) {
  const lastMessage = actualLastMsg || conversation?.lastMessage;
  const rawContent = lastMessage?.content || '';
  const cleaned = cleanExcerpt(rawContent);
  const excerpt = cleaned
    ? cleaned.length > 25
      ? `${cleaned.slice(0, 25)}...`
      : cleaned
    : '';

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] ${
          isActive
            ? 'bg-[var(--color-primary)]/15'
            : 'hover:bg-[var(--border-color)]/50'
        }`}
      >
        {/* 头像 */}
        <AgentAvatar avatar={agent.avatar} fallback="🤖" size="sm" />

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span
              className={`font-medium truncate ${
                isActive ? 'text-[var(--color-primary)]' : 'text-text-primary'
              }`}
            >
              {agent.name}
            </span>
            {lastMessage && (
              <span className="text-xs text-text-secondary shrink-0 ml-2">
                {formatTime(lastMessage.timestamp)}
              </span>
            )}
          </div>
          <p className="text-sm text-text-secondary truncate mt-0.5">
            {excerpt || agent.title || '暂无消息'}
          </p>
        </div>

        {/* 未读标记 */}
        {conversation?.unreadCount > 0 && (
          <span className="shrink-0 bg-[var(--color-primary)] text-white text-xs font-medium rounded-full w-5 h-5 flex items-center justify-center">
            {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
          </span>
        )}
      </button>

      {/* 隐藏按钮（hover 时显示） */}
      {onHide && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onHide(agent.id); }}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-500/15 text-text-secondary hover:text-red-400 transition-all"
          title="从列表中移除（保留记录）"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * 群聊卡片
 */
function GroupItem({ conversation, actualLastMsg, isActive, onClick, onHide }) {
  const lastMessage = actualLastMsg || conversation.lastMessage;
  const rawContent = lastMessage?.content || '';
  const cleaned = cleanExcerpt(rawContent);
  const excerpt = cleaned
    ? cleaned.length > 25
      ? `${cleaned.slice(0, 25)}...`
      : cleaned
    : '';

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] ${
          isActive
            ? 'bg-[var(--color-primary)]/15'
            : 'hover:bg-[var(--border-color)]/50'
        }`}
      >
        <AgentAvatar avatar={null} fallback="👥" size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span
              className={`font-medium truncate ${
                isActive ? 'text-[var(--color-primary)]' : 'text-text-primary'
              }`}
            >
              {conversation.name}
            </span>
            {lastMessage && (
              <span className="text-xs text-text-secondary shrink-0 ml-2">
                {formatTime(lastMessage.timestamp)}
              </span>
            )}
          </div>
          <p className="text-sm text-text-secondary truncate mt-0.5">
            {excerpt || '暂无消息'}
          </p>
        </div>
        {conversation.unreadCount > 0 && (
          <span className="shrink-0 bg-[var(--color-primary)] text-white text-xs font-medium rounded-full w-5 h-5 flex items-center justify-center">
            {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
          </span>
        )}
      </button>

      {/* 隐藏按钮 */}
      {onHide && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onHide(conversation.id); }}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-500/15 text-text-secondary hover:text-red-400 transition-all"
          title="从列表中移除（保留记录）"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * 联系人列表主组件
 */
export default function ConversationList({ onNewChat }) {
  const agentsMap = useAgentStore((s) => s.agents);
  const conversations = useChatStore((s) => s.conversations);
  const messagesByConversation = useChatStore((s) => s.messagesByConversation);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const getOrCreatePrivateChat = useChatStore((s) => s.getOrCreatePrivateChat);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const findPrivateChatByAgent = useChatStore((s) => s.findPrivateChatByAgent);
  const hiddenConversations = useChatStore((s) => s.hiddenConversations);
  const hideConversation = useChatStore((s) => s.hideConversation);
  const unhideConversation = useChatStore((s) => s.unhideConversation);

  const [searchQuery, setSearchQuery] = useState('');

  // 从 messagesByConversation 中取真实的最后一条可见消息（跳过已删除的）
  const getActualLastMsg = useCallback(
    (convId) => {
      if (!convId) return null;
      const msgs = messagesByConversation.get(convId);
      if (!msgs || msgs.length === 0) return null;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (!msgs[i].deleted) return msgs[i];
      }
      return null;
    },
    [messagesByConversation]
  );

  // 所有 Agent 联系人（排除已开除的，含隐藏状态标记）
  const allContacts = useMemo(() => {
    const agents = Array.from(agentsMap.values())
      .filter((agent) => agent.agentStatus !== 'terminated'); // 已开除的彻底不显示
    return agents
      .map((agent) => {
        const conv = findPrivateChatByAgent(agent.id);
        const actualLast = conv ? getActualLastMsg(conv.id) : null;
        const lastTime = actualLast?.timestamp ?? conv?.lastMessage?.timestamp ?? conv?.createdAt ?? 0;
        const isHidden = hiddenConversations.has(agent.id);
        return { agent, conversation: conv, actualLastMsg: actualLast, lastTime, isHidden };
      })
      .sort((a, b) => b.lastTime - a.lastTime);
  }, [agentsMap, conversations, messagesByConversation, findPrivateChatByAgent, getActualLastMsg, hiddenConversations]);

  // 群聊列表
  const allGroupChats = useMemo(() => {
    return Array.from(conversations.values())
      .filter((c) => c.type === 'group')
      .map((c) => {
        const actualLast = getActualLastMsg(c.id);
        const isHidden = hiddenConversations.has(c.id);
        return { ...c, _actualLastMsg: actualLast, isHidden };
      })
      .sort((a, b) => {
        const aTime = a._actualLastMsg?.timestamp ?? a.lastMessage?.timestamp ?? a.createdAt;
        const bTime = b._actualLastMsg?.timestamp ?? b.lastMessage?.timestamp ?? b.createdAt;
        return bTime - aTime;
      });
  }, [conversations, messagesByConversation, getActualLastMsg, hiddenConversations]);

  // 搜索过滤
  const isSearching = searchQuery.trim().length > 0;
  const query = searchQuery.trim().toLowerCase();

  // 搜索时：展示所有匹配（包括隐藏的），不搜索时：只展示未隐藏的
  const visibleContacts = useMemo(() => {
    if (isSearching) {
      return allContacts.filter(({ agent }) =>
        agent.name.toLowerCase().includes(query) ||
        agent.id.toLowerCase().includes(query) ||
        (agent.title || '').toLowerCase().includes(query)
      );
    }
    return allContacts.filter(({ isHidden }) => !isHidden);
  }, [allContacts, isSearching, query]);

  const visibleGroupChats = useMemo(() => {
    if (isSearching) {
      return allGroupChats.filter((c) =>
        c.name.toLowerCase().includes(query)
      );
    }
    return allGroupChats.filter(({ isHidden }) => !isHidden);
  }, [allGroupChats, isSearching, query]);

  const handleAgentClick = useCallback(
    (agent) => {
      // 点击搜索结果时，自动恢复显示
      if (hiddenConversations.has(agent.id)) {
        unhideConversation(agent.id);
      }
      getOrCreatePrivateChat(agent.id, agent.name);
      setSearchQuery('');
    },
    [getOrCreatePrivateChat, hiddenConversations, unhideConversation]
  );

  const handleGroupClick = useCallback(
    (convId) => {
      if (hiddenConversations.has(convId)) {
        unhideConversation(convId);
      }
      selectConversation(convId);
      setSearchQuery('');
    },
    [selectConversation, hiddenConversations, unhideConversation]
  );

  const handleHide = useCallback(
    (id) => {
      hideConversation(id);
    },
    [hideConversation]
  );

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
        <h2 className="text-lg font-semibold text-text-primary">消息</h2>
        <button
          type="button"
          onClick={onNewChat}
          className="text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 rounded-lg p-1.5 transition-colors"
          title="创建群聊"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* 搜索框 */}
      <div className="px-3 py-2">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索联系人..."
            className="w-full pl-8 pr-8 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-bg-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/50"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 联系人列表 */}
      <div className="flex-1 overflow-auto px-2 py-1">
        {visibleContacts.length === 0 && visibleGroupChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-secondary">
            <p className="text-sm">{isSearching ? '没有匹配的联系人' : '暂无联系人'}</p>
            {isSearching && (
              <p className="text-xs mt-1 text-text-secondary/60">尝试搜索名字或 ID</p>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            {/* 搜索时的提示 */}
            {isSearching && (
              <div className="px-3 py-1.5 text-xs text-text-secondary">
                搜索结果（点击可恢复到列表）
              </div>
            )}

            {/* Agent 联系人 */}
            {visibleContacts.map(({ agent, conversation, actualLastMsg, isHidden }) => (
              <ContactItem
                key={agent.id}
                agent={agent}
                conversation={conversation}
                actualLastMsg={actualLastMsg}
                isActive={!!conversation && conversation.id === currentConversationId}
                onClick={() => handleAgentClick(agent)}
                onHide={isSearching ? null : handleHide}
              />
            ))}

            {/* 群聊分隔 */}
            {visibleGroupChats.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3 py-2 mt-2">
                  <div className="flex-1 h-px bg-[var(--border-color)]" />
                  <span className="text-xs text-text-secondary">群聊</span>
                  <div className="flex-1 h-px bg-[var(--border-color)]" />
                </div>
                {visibleGroupChats.map((conv) => (
                  <GroupItem
                    key={conv.id}
                    conversation={conv}
                    actualLastMsg={conv._actualLastMsg}
                    isActive={conv.id === currentConversationId}
                    onClick={() => handleGroupClick(conv.id)}
                    onHide={isSearching ? null : handleHide}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
