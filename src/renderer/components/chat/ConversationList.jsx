/**
 * SoloForge - 联系人列表（Linear 风格重构）
 * 左侧边栏：显示所有 Agent 作为联系人，每个 Agent 一个对话
 * @module components/chat/ConversationList
 *
 * 设计:
 *  - 会话项紧凑（高度 ~40px），左侧小圆头像，右侧最后消息预览（text-tertiary 单行截断）
 *  - 选中态: accent 半透明背景 + 左侧 2px accent 竖线
 *  - hover: var(--bg-hover)
 *  - 部门群聊用 pill badge 小标签
 *  - 删除/操作按钮只在 hover 时显示
 *  - React.memo 优化（props 不变则跳过）
 * 全部使用新 Linear 设计 Token（CSS 变量）。
 */

import { useCallback, useMemo, useState, memo } from 'react';
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

// 共用样式常量（避免每个 item 重复）——48px 对齐 8px 网格
const ITEM_HEIGHT = '48px';

/**
 * 选中态 / hover 态共用背景层。
 * 用一个绝对定位的层来承载选中背景 + 左侧竖线，避免干扰内容布局。
 * emil-select-layer：背景透明度入场；emil-select-bar：左侧 accent 竖线 scaleX 入场。
 */
function SelectionLayer({ isActive }) {
  if (!isActive) return null;
  return (
    <span
      className="absolute inset-0 pointer-events-none emil-select-layer"
      style={{
        background: 'rgba(94,106,210,0.14)',
        borderRadius: 'var(--radius-md, 6px)',
      }}
    >
      <span
        className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r emil-select-bar"
        style={{ background: 'var(--accent, #5e6ad2)' }}
      />
    </span>
  );
}

const MemoSelectionLayer = memo(SelectionLayer);

/**
 * 未读 badge
 */
function UnreadBadge({ count }) {
  if (!count || count <= 0) return null;
  return (
    <span
      className="shrink-0 text-2xs font-medium rounded-full flex items-center justify-center"
      style={{
        minWidth: '16px',
        height: '16px',
        padding: '0 4px',
        background: 'var(--accent, #5e6ad2)',
        color: '#fff',
      }}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

const MemoUnreadBadge = memo(UnreadBadge);

/**
 * 隐藏按钮（hover 时显示）
 * emil-ghost-hover：hover 时背景/颜色过渡；emil-pressable：按压迫反馈。
 */
function HideButton({ onClick, title = '从列表中移除（保留记录）' }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label="隐藏会话"
      className="opacity-0 group-hover:opacity-100 p-1 rounded-md transition-[color,background-color,border-color,transform] shrink-0 emil-ghost-hover emil-pressable"
      style={{ color: 'var(--text-tertiary, #8a8f98)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(248,113,113,0.12)';
        e.currentTarget.style.color = 'var(--color-danger, #f87171)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-tertiary, #8a8f98)';
      }}
      title={title}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

const MemoHideButton = memo(HideButton);

/**
 * 联系人卡片（Agent）
 * 紧凑布局: 高度 ~40px，小圆头像 + 名字 + 预览
 * emil-conv-item：stagger 入场（由 --emil-i 控制）。
 */
const ContactItem = memo(function ContactItem({ agent, conversation, actualLastMsg, isActive, onClick, onHide, index }) {
  const lastMessage = actualLastMsg || conversation?.lastMessage;
  const rawContent = lastMessage?.content || '';
  const cleaned = cleanExcerpt(rawContent);
  const excerpt = cleaned
    ? cleaned.length > 28
      ? `${cleaned.slice(0, 28)}...`
      : cleaned
    : '';

  return (
    <div role="listitem" className="group relative flex items-center emil-conv-item" style={{ height: ITEM_HEIGHT, '--emil-i': index }}>
      <MemoSelectionLayer isActive={isActive} />
      <button
        type="button"
        onClick={onClick}
        className="relative w-full flex items-center gap-2.5 text-left transition-colors emil-pressable"
        style={{
          height: '100%',
          padding: '0 12px',
          borderRadius: 'var(--radius-md, 6px)',
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))';
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* 头像（小圆） */}
        <AgentAvatar avatar={agent.avatar} fallback="🤖" size="sm" />

        {/* 内容 */}
        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span
              className="block text-sm font-medium truncate"
              style={{ color: 'var(--text-primary, #f7f8f8)' }}
            >
              {agent.name}
            </span>
            {excerpt ? (
              <span
                className="block text-xs truncate"
                style={{ color: 'var(--text-tertiary, #8a8f98)' }}
              >
                {excerpt}
              </span>
            ) : (
              <span
                className="block text-xs truncate"
                style={{ color: 'var(--text-quaternary, #62666d)' }}
              >
                {agent.title || '暂无消息'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {lastMessage && (
              <span
                className="text-2xs"
                style={{ color: 'var(--text-quaternary, #62666d)' }}
              >
                {formatTime(lastMessage.timestamp)}
              </span>
            )}
            <MemoUnreadBadge count={conversation?.unreadCount} />
          </div>
        </div>
      </button>

      {/* 隐藏按钮（hover 时显示，移到 button 外避免 button 嵌套） */}
      {onHide && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <MemoHideButton onClick={() => onHide(agent.id)} />
        </span>
      )}
    </div>
  );
});

/**
 * 部门群聊卡片
 * 带 pill badge 标签
 * emil-conv-item：stagger 入场（由 --emil-i 控制）。
 */
const DepartmentItem = memo(function DepartmentItem({ conversation, actualLastMsg, isActive, onClick, index }) {
  const lastMessage = actualLastMsg || conversation.lastMessage;
  const rawContent = lastMessage?.content || '';
  const cleaned = cleanExcerpt(rawContent);
  const excerpt = cleaned
    ? cleaned.length > 28
      ? `${cleaned.slice(0, 28)}...`
      : cleaned
    : '';

  return (
    <div role="listitem" className="group relative flex items-center emil-conv-item" style={{ height: ITEM_HEIGHT, '--emil-i': index }}>
      <MemoSelectionLayer isActive={isActive} />
      <button
        type="button"
        onClick={onClick}
        className="relative w-full flex items-center gap-2.5 text-left transition-colors emil-pressable"
        style={{
          height: '100%',
          padding: '0 12px',
          borderRadius: 'var(--radius-md, 6px)',
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))';
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* 头像 + 部门 pill badge */}
        <div className="relative shrink-0">
          <AgentAvatar avatar={null} fallback="🏢" size="sm" />
          <span
            className="absolute -top-1 -right-1 text-2xs px-1 rounded-full leading-tight"
            style={{
              background: 'rgba(94,106,210,0.18)',
              color: 'var(--accent, #5e6ad2)',
              border: '1px solid rgba(94,106,210,0.25)',
            }}
            title="部门群聊"
          >
            部门
          </span>
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span
              className="block text-sm font-medium truncate"
              style={{ color: 'var(--text-primary, #f7f8f8)' }}
            >
              {conversation.name}
            </span>
            <span
              className="block text-xs truncate"
              style={{ color: excerpt ? 'var(--text-tertiary, #8a8f98)' : 'var(--text-quaternary, #62666d)' }}
            >
              {excerpt || '团队工作群'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {lastMessage && (
              <span
                className="text-2xs"
                style={{ color: 'var(--text-quaternary, #62666d)' }}
              >
                {formatTime(lastMessage.timestamp)}
              </span>
            )}
            <MemoUnreadBadge count={conversation.unreadCount} />
          </div>
        </div>
      </button>
    </div>
  );
});

/**
 * 普通群聊卡片
 * emil-conv-item：stagger 入场（由 --emil-i 控制）。
 */
const GroupItem = memo(function GroupItem({ conversation, actualLastMsg, isActive, onClick, onHide, index }) {
  const lastMessage = actualLastMsg || conversation.lastMessage;
  const rawContent = lastMessage?.content || '';
  const cleaned = cleanExcerpt(rawContent);
  const excerpt = cleaned
    ? cleaned.length > 28
      ? `${cleaned.slice(0, 28)}...`
      : cleaned
    : '';

  return (
    <div role="listitem" className="group relative flex items-center emil-conv-item" style={{ height: ITEM_HEIGHT, '--emil-i': index }}>
      <MemoSelectionLayer isActive={isActive} />
      <button
        type="button"
        onClick={onClick}
        className="relative w-full flex items-center gap-2.5 text-left transition-colors emil-pressable"
        style={{
          height: '100%',
          padding: '0 12px',
          borderRadius: 'var(--radius-md, 6px)',
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))';
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = 'transparent';
        }}
      >
        <AgentAvatar avatar={null} fallback="👥" size="sm" />
        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span
              className="block text-sm font-medium truncate"
              style={{ color: 'var(--text-primary, #f7f8f8)' }}
            >
              {conversation.name}
            </span>
            <span
              className="block text-xs truncate"
              style={{ color: excerpt ? 'var(--text-tertiary, #8a8f98)' : 'var(--text-quaternary, #62666d)' }}
            >
              {excerpt || '暂无消息'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {lastMessage && (
              <span
                className="text-2xs"
                style={{ color: 'var(--text-quaternary, #62666d)' }}
              >
                {formatTime(lastMessage.timestamp)}
              </span>
            )}
            <MemoUnreadBadge count={conversation.unreadCount} />
          </div>
        </div>
      </button>

      {/* 隐藏按钮（hover 时显示，移到 button 外避免 button 嵌套） */}
      {onHide && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <MemoHideButton onClick={() => onHide(conversation.id)} />
        </span>
      )}
    </div>
  );
});

/**
 * 分组分隔标题（紧凑）
 */
function SectionLabel({ label, isFirst = false }) {
  return (
    <div
      className="flex items-center gap-2 px-3"
      style={{ height: '24px', marginTop: isFirst ? '2px' : '6px' }}
    >
      <span
        className="text-2xs font-medium uppercase tracking-[0.02em]"
        style={{ color: 'var(--text-quaternary, #62666d)' }}
      >
        {label}
      </span>
      <div
        className="flex-1 h-px"
        style={{ background: 'var(--border-subtle, rgba(255,255,255,0.05))' }}
      />
    </div>
  );
}

const MemoSectionLabel = memo(SectionLabel);

/**
 * 联系人列表主组件
 * @param {Object} [props]
 * @param {() => void} [props.onNewChat] - 新建群聊回调
 * @param {React.RefObject<HTMLInputElement>} [props.searchInputRef] - 外部传入的搜索框 ref，
 *   供 ChatView 实现全局快捷键 Cmd/Ctrl+K 聚焦搜索框。可选。
 */
function ConversationList({ onNewChat, searchInputRef }) {
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

  // 部门群聊列表
  const allDepartmentChats = useMemo(() => {
    return Array.from(conversations.values())
      .filter((c) => c.type === 'department')
      .map((c) => {
        const actualLast = getActualLastMsg(c.id);
        return { ...c, _actualLastMsg: actualLast };
      })
      .sort((a, b) => {
        const aTime = a._actualLastMsg?.timestamp ?? a.lastMessage?.timestamp ?? a.createdAt;
        const bTime = b._actualLastMsg?.timestamp ?? b.lastMessage?.timestamp ?? b.createdAt;
        return bTime - aTime;
      });
  }, [conversations, messagesByConversation, getActualLastMsg]);

  // 普通群聊列表
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

  const visibleDepartmentChats = useMemo(() => {
    if (isSearching) {
      return allDepartmentChats.filter((c) =>
        c.name.toLowerCase().includes(query)
      );
    }
    return allDepartmentChats; // 部门群聊始终显示
  }, [allDepartmentChats, isSearching, query]);

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

  const handleClearSearch = useCallback(() => setSearchQuery(''), []);

  return (
    <div className="flex flex-col h-full">
      {/* 头部（紧凑） */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.05))',
        }}
      >
        <h2
          className="text-xs font-medium"
          style={{ color: 'var(--text-tertiary, #8a8f98)' }}
        >
          消息
        </h2>
        <button
          type="button"
          onClick={onNewChat}
          className="p-1 rounded-md transition-colors"
          style={{ color: 'var(--text-tertiary, #8a8f98)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(94,106,210,0.12)';
            e.currentTarget.style.color = 'var(--accent, #5e6ad2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-tertiary, #8a8f98)';
          }}
          title="创建群聊"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* 搜索框（.input 风格） */}
      <div className="shrink-0 px-2.5 py-2">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
            style={{ color: 'var(--text-quaternary, #62666d)' }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索联系人..."
            aria-label="搜索会话"
            ref={searchInputRef}
            className="w-full text-xs focus:outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 transition-colors"
            style={{
              borderRadius: 'var(--radius-md, 6px)',
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.05))',
              background: 'rgba(255,255,255,0.03)',
              padding: '6px 28px 6px 28px',
              color: 'var(--text-primary, #f7f8f8)',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent, #5e6ad2)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle, rgba(255,255,255,0.05))';
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 transition-colors"
              style={{ color: 'var(--text-quaternary, #62666d)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary, #f7f8f8)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-quaternary, #62666d)'; }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 列表区域 */}
      <div className="flex-1 overflow-auto px-1.5 pb-2">
        {visibleContacts.length === 0 && visibleDepartmentChats.length === 0 && visibleGroupChats.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center"
            style={{ height: '128px', color: 'var(--text-tertiary, #8a8f98)' }}
          >
            <p className="text-xs">{isSearching ? '没有匹配的联系人' : '暂无联系人'}</p>
            {isSearching && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-quaternary, #62666d)' }}>
                尝试搜索名字或 ID
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-px" role="list">
            {/* 搜索时的提示 */}
            {isSearching && (
              <div
                className="text-xs px-3 py-1.5"
                style={{ color: 'var(--text-quaternary, #62666d)' }}
              >
                搜索结果（点击可恢复到列表）
              </div>
            )}

            {/* 部门群聊（置顶显示） */}
            {visibleDepartmentChats.length > 0 && (
              <>
                <MemoSectionLabel label="部门" isFirst />
                {visibleDepartmentChats.map((conv, idx) => (
                  <DepartmentItem
                    key={conv.id}
                    conversation={conv}
                    actualLastMsg={conv._actualLastMsg}
                    isActive={conv.id === currentConversationId}
                    onClick={() => handleGroupClick(conv.id)}
                    index={idx}
                  />
                ))}
              </>
            )}

            {/* Agent 联系人 */}
            {visibleContacts.length > 0 && (
              <>
                <MemoSectionLabel
                  label="同事"
                  isFirst={visibleDepartmentChats.length === 0}
                />
                {visibleContacts.map(({ agent, conversation, actualLastMsg }, idx) => (
                  <ContactItem
                    key={agent.id}
                    agent={agent}
                    conversation={conversation}
                    actualLastMsg={actualLastMsg}
                    isActive={!!conversation && conversation.id === currentConversationId}
                    onClick={() => handleAgentClick(agent)}
                    onHide={isSearching ? null : handleHide}
                    index={idx}
                  />
                ))}
              </>
            )}

            {/* 普通群聊 */}
            {visibleGroupChats.length > 0 && (
              <>
                <MemoSectionLabel label="群聊" />
                {visibleGroupChats.map((conv, idx) => (
                  <GroupItem
                    key={conv.id}
                    conversation={conv}
                    actualLastMsg={conv._actualLastMsg}
                    isActive={conv.id === currentConversationId}
                    onClick={() => handleGroupClick(conv.id)}
                    onHide={isSearching ? null : handleHide}
                    index={idx}
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

export default memo(ConversationList);
