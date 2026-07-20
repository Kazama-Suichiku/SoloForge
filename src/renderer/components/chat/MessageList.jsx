/**
 * SoloForge - 消息流组件
 * 显示当前对话的消息列表，支持 Markdown、清屏、右键删除、多选批量删除
 * @module components/chat/MessageList
 */

import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useAgentStore } from '../../store/agent-store';
import { useStreamingContent } from '../../store/useStreamBuffer';
import AgentAvatar from '../AgentAvatar';
// MessageBubble（含 VoiceMessagePlayer / AgentMessageContent）已拆分到独立文件，用 memo 包裹
import MessageBubble from './MessageBubble';

/** 退场动画时长（ms）—— 与 .emil-msg-exit transition 一致 */
const MSG_EXIT_DURATION = 180;

/** 退场动画类：透明度 + 轻微 scale + 下沉；与 .emil-msg-enter 对称逆向路径。
    prefers-reduced-motion 已由 globals.css 全局降级（transform:none，保留 opacity）。 */
const MSG_EXIT_STYLE = `
.emil-msg-exit {
  opacity: 0 !important;
  transform: scale(0.97) translateY(2px) !important;
  transition: opacity ${MSG_EXIT_DURATION}ms cubic-bezier(0.23, 1, 0.32, 1),
              transform ${MSG_EXIT_DURATION}ms cubic-bezier(0.23, 1, 0.32, 1) !important;
}
`;

/**
 * P2-7：流式消息包装层。
 * 订阅外部 streamBuffer（按 messageId），流式期间只有正在流式的那条消息重渲染，
 * 其他消息的 MessageBubble 因 memo + buffer 为 '' 而跳过重渲染。
 * 流式完成时 chat-store 的 updateMessage 会 consume buffer 写入最终 content，
 * 之后 buffer 为 ''，此包装层退化为透传。
 */
function StreamingBubble({ message, isSelectMode, isSelected, onToggleSelect, onContextMenu, onImageClick, isExiting }) {
  const buf = useStreamingContent(message.id);
  // 有 buffer 时把 buffer 拼到 content 后面（模拟原流式累积效果）
  const mergedMessage = useMemo(
    () => (buf ? { ...message, content: (message.content || '') + buf } : message),
    [message, buf],
  );
  return (
    <MessageBubble
      message={mergedMessage}
      isSelectMode={isSelectMode}
      isSelected={isSelected}
      isExiting={isExiting}
      onToggleSelect={onToggleSelect}
      onContextMenu={onContextMenu}
      onImageClick={onImageClick}
    />
  );
}

// ─────────────────────────────────────────────────────────
function ContextMenu({ x, y, onDelete, onToggleSelect, onClose, isSelectMode }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // 确保菜单不超出视窗
  const style = useMemo(() => {
    const menuW = 160;
    const menuH = 80;
    const adjustedX = x + menuW > window.innerWidth ? x - menuW : x;
    const adjustedY = y + menuH > window.innerHeight ? y - menuH : y;
    return { position: 'fixed', left: adjustedX, top: adjustedY, zIndex: 9999 };
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      style={style}
      className="glass-medium rounded-lg shadow-xl py-1 min-w-[140px] animate-scale-in"
    >
      <button
        type="button"
        onClick={onDelete}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        删除此消息
      </button>
      <button
        type="button"
        onClick={onToggleSelect}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-hover transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
        {isSelectMode ? '退出多选' : '多选模式'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 图片灯箱（点击放大预览）
// ─────────────────────────────────────────────────────────

function ImageLightbox({ src, onClose }) {
  const lightboxRef = useRef(null);
  const [isExiting, setIsExiting] = useState(false);

  // 真正关闭（退场动画结束后调用）
  const startClose = useCallback(() => {
    setIsExiting(true);
    // 200ms 后真正卸载，与 .lightbox-exit transition 一致
    setTimeout(() => {
      setIsExiting(false);
      onClose();
    }, 200);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') startClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [startClose]);

  return (
    <div
      ref={lightboxRef}
      className={`fixed inset-0 z-[9999] bg-[rgba(0,0,0,0.8)] flex items-center justify-center animate-fade-in${isExiting ? ' lightbox-exit' : ''}`}
      onClick={startClose}
    >
      <button
        type="button"
        onClick={startClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-[var(--text-primary)]/10 hover:bg-[var(--text-primary)]/20 text-[var(--text-primary)] flex items-center justify-center transition-colors"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <img
        src={src}
        alt="放大预览"
        className={`max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl${isExiting ? ' lightbox-img-exit' : ''}`}
        onClick={(e) => e.stopPropagation()}
      />
      {/* 灯箱退场动画：遮罩 opacity 1→0 + 图片 scale 1→0.97（对称逆向路径）
          prefers-reduced-motion 已由 globals.css 全局降级 */}
      <style>{`
        .lightbox-exit {
          opacity: 0 !important;
          transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1) !important;
        }
        .lightbox-img-exit {
          opacity: 0 !important;
          transform: scale(0.97) !important;
          transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1),
                      transform 200ms cubic-bezier(0.23, 1, 0.32, 1) !important;
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 批量操作栏
// ─────────────────────────────────────────────────────────

function SelectionBar({ selectedCount, onDeleteSelected, onSelectAll, onCancelSelect }) {
  return (
    <div className="shrink-0 px-4 py-2.5 bg-accent-subtle border-b border-accent/30 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancelSelect}
          className="text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          取消
        </button>
        <span className="text-sm text-accent font-medium">
          已选中 {selectedCount} 条消息
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSelectAll}
          className="btn-ghost px-3 py-1 text-xs"
        >
          全选
        </button>
        <button
          type="button"
          onClick={onDeleteSelected}
          disabled={selectedCount === 0}
          className="btn-danger px-3 py-1 text-xs"
        >
          删除选中 ({selectedCount})
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 消息列表主组件
// ─────────────────────────────────────────────────────────

export default function MessageList() {
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const messagesByConversation = useChatStore((s) => s.messagesByConversation);
  const conversations = useChatStore((s) => s.conversations);
  const clearConversationDisplay = useChatStore((s) => s.clearConversationDisplay);
  const deleteMessages = useChatStore((s) => s.deleteMessages);
  const getAgent = useAgentStore((s) => s.getAgent);

  const scrollRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isNearBottomRef = useRef(true);
  // 控制"滚动到底部"按钮显示（基于 isNearBottomRef 同步状态，绑定 emil-scroll-btn 的 data-show）
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // 追踪滚动位置：仅在用户接近底部时自动滚动
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 120; // px
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isNearBottomRef.current = near;
    setShowScrollBtn(!near);
  }, []);

  // 点击"滚动到底部"按钮：滚到底 + 隐藏按钮
  const handleScrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isNearBottomRef.current = true;
    setShowScrollBtn(false);
  }, []);

  // 多选模式
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // 退场动画：正在播放退场动画的消息 id 集合。
  // 删除消息时先加入 removingIds（触发 MessageBubble 的 emil-msg-exit 类），
  // 动画结束后才真正调用 store.deleteMessages。
  const [removingIds, setRemovingIds] = useState(new Set());
  const removingTimersRef = useRef({});

  // 图片灯箱
  const [lightboxSrc, setLightboxSrc] = useState(null);

  // 右键菜单
  const [contextMenu, setContextMenu] = useState(null); // { x, y, messageId }

  // 切换对话时退出多选
  useEffect(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
    setContextMenu(null);
  }, [currentConversationId]);

  // 当前对话
  const conversation = useMemo(() => {
    return currentConversationId ? conversations.get(currentConversationId) ?? null : null;
  }, [currentConversationId, conversations]);

  // 可见消息（过滤已删除的 + displayClearedAt 之前的）
  const visibleMessages = useMemo(() => {
    if (!currentConversationId) return [];
    const allMsgs = messagesByConversation.get(currentConversationId) ?? [];
    const clearedAt = conversation?.displayClearedAt;
    return allMsgs.filter((m) => {
      if (m.deleted) return false;
      if (clearedAt && m.timestamp <= clearedAt) return false;
      return true;
    });
  }, [currentConversationId, messagesByConversation, conversation?.displayClearedAt]);

  // 自动滚动到底部（仅当用户在底部附近时）
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [visibleMessages.length]);

  // 新消息到达时（流式追加），仅在底部时用 scrollTop 平滑跟随
  const lastMsg = visibleMessages[visibleMessages.length - 1];
  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lastMsg?.content]);

  // 清屏
  const handleClear = useCallback(() => {
    if (currentConversationId) {
      clearConversationDisplay(currentConversationId);
    }
  }, [currentConversationId, clearConversationDisplay]);

  // ─── 右键菜单处理 ──────────────────────────────────────

  const handleContextMenu = useCallback((e, messageId) => {
    setContextMenu({ x: e.clientX, y: e.clientY, messageId });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // 触发单条消息的退场动画，动画结束后真正删除（store.deleteMessages）。
  const animateThenDelete = useCallback(
    (ids) => {
      if (!currentConversationId || !ids?.length) return;
      // 已经在退场中的 id 跳过，防止重复触发
      setRemovingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      removingTimersRef.current = removingTimersRef.current || {};
      ids.forEach((id) => {
        if (removingTimersRef.current[id]) return;
        removingTimersRef.current[id] = setTimeout(() => {
          delete removingTimersRef.current[id];
          setRemovingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          deleteMessages(currentConversationId, [id]);
        }, MSG_EXIT_DURATION);
      });
    },
    [currentConversationId, deleteMessages]
  );

  // 右键 → 删除此消息（先播退场动画再删）
  const handleDeleteFromContext = useCallback(() => {
    if (!contextMenu || !currentConversationId) return;
    const mid = contextMenu.messageId;
    setContextMenu(null);
    animateThenDelete([mid]);
  }, [contextMenu, currentConversationId, animateThenDelete]);

  // 右键 → 进入/退出多选模式
  const handleToggleSelectFromContext = useCallback(() => {
    if (isSelectMode) {
      // 退出多选
      setIsSelectMode(false);
      setSelectedIds(new Set());
    } else {
      // 进入多选，预选当前右键的消息
      setIsSelectMode(true);
      setSelectedIds(new Set(contextMenu ? [contextMenu.messageId] : []));
    }
    setContextMenu(null);
  }, [isSelectMode, contextMenu]);

  // ─── 多选操作 ──────────────────────────────────────

  const toggleSelectMessage = useCallback((messageId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(visibleMessages.map((m) => m.id)));
  }, [visibleMessages]);

  const handleCancelSelect = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (!currentConversationId || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setIsSelectMode(false);
    setSelectedIds(new Set());
    animateThenDelete(ids);
  }, [currentConversationId, selectedIds, deleteMessages, animateThenDelete]);

  // 卸载时清理所有退场定时器，避免 store.deleteMessages 在组件卸载后触发
  useEffect(() => {
    return () => {
      const timers = removingTimersRef.current || {};
      Object.values(timers).forEach((t) => clearTimeout(t));
      removingTimersRef.current = {};
    };
  }, []);

  // ─── 渲染 ──────────────────────────────────────

  // 无选中对话
  if (!currentConversationId) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="shrink-0 h-8 drag-region" />
        <div className="flex flex-col items-center justify-center flex-1 text-text-secondary">
          <span className="text-6xl mb-4">💬</span>
          <p className="text-lg font-medium">选择一位同事开始聊天</p>
          <p className="text-sm mt-1">在左侧联系人列表中选择</p>
        </div>
      </div>
    );
  }

  // 对话标题
  const getTitle = () => {
    if (!conversation) return '';
    if (conversation.type === 'group') return conversation.name;
    const agentId = conversation.participants.find((p) => p !== 'user');
    const agent = agentId ? getAgent(agentId) : null;
    return agent?.name ?? conversation.name;
  };

  // 对话中全部消息数（含已清屏的）
  const totalMessages = (messagesByConversation.get(currentConversationId) ?? []).length;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* macOS 标题栏占位（可拖拽区域） */}
      <div className="shrink-0 h-8 drag-region glass-medium" />

      {/* 对话头部 */}
      {/* P1-1：硬边框 border-b → 底部内阴影渐隐，保留 glass-medium 顶部高光 */}
      <div
        className="shrink-0 px-6 py-4 glass-medium flex items-center justify-between"
        style={{
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{getTitle()}</h2>
          {conversation?.type === 'group' && (
            <p className="text-sm text-text-secondary mt-0.5">
              {conversation.participants.length} 位参与者
            </p>
          )}
        </div>

        {/* 清屏按钮 */}
        {totalMessages > 0 && !isSelectMode && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="清空聊天视窗（历史记录保留）"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            清屏
          </button>
        )}
      </div>

      {/* 多选操作栏 */}
      {isSelectMode && (
        <SelectionBar
          selectedCount={selectedIds.size}
          onDeleteSelected={handleDeleteSelected}
          onSelectAll={handleSelectAll}
          onCancelSelect={handleCancelSelect}
        />
      )}

      {/* 消息区域 */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto px-6 py-4 min-h-0 relative scroll-fade-top scroll-fade-bottom">
        {visibleMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-bg-surface flex items-center justify-center text-3xl mb-4">
              {conversation?.type === 'group' ? '👥' : '💬'}
            </div>
            <p className="text-base font-medium text-text-primary mb-1">
              {conversation?.type === 'group' ? '群组对话' : '开始新对话'}
            </p>
            <p className="text-sm text-text-tertiary">
              {conversation?.type === 'group'
                ? '在下方输入消息，所有成员都能看到'
                : '发送消息开始与 Agent 对话'}
            </p>
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            {visibleMessages.map((msg) => (
              <StreamingBubble
                key={msg.id}
                message={msg}
                isSelectMode={isSelectMode}
                isSelected={selectedIds.has(msg.id)}
                isExiting={removingIds.has(msg.id)}
                onToggleSelect={toggleSelectMessage}
                onContextMenu={handleContextMenu}
                onImageClick={setLightboxSrc}
              />
            ))}
            {/* Typing 指示器：Agent 正在工作且尚未开始流式输出时显示 */}
            {(() => {
              // 仅在私聊中显示
              if (conversation?.type !== 'private') return null;
              const agentId = conversation.participants.find((p) => p !== 'user');
              const typingAgent = agentId ? getAgent(agentId) : null;
              // Agent 必须处于 working 状态
              if (!typingAgent || typingAgent.status !== 'working') return null;
              // 如果 Agent 最近一条消息已有内容（已开始流式输出），不再显示指示器
              const lastAgentMsg = [...visibleMessages].reverse().find(
                (m) => m.senderId === agentId && m.senderType === 'agent'
              );
              if (lastAgentMsg && lastAgentMsg.content) return null;
              return (
                <div className="flex gap-3 items-start animate-fade-in">
                  <AgentAvatar
                    avatar={typingAgent?.avatar}
                    fallback="🤖"
                    size="sm"
                  />
                  <div className="flex flex-col items-start">
                    <span className="text-xs text-text-secondary mb-1">
                      {typingAgent?.name ?? 'Agent'} 正在输入
                    </span>
                    <div className="rounded-2xl rounded-tl-sm glass-medium border border-border-default px-4 py-3">
                      <div className="flex gap-1.5 items-center">
                        <span className="w-2 h-2 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* 滚动到底部按钮：emil-scroll-btn（translateY+opacity 入场，data-show 控制） */}
        <button
          type="button"
          onClick={handleScrollToBottom}
          data-show={showScrollBtn ? 'true' : 'false'}
          className="emil-scroll-btn sticky bottom-3 ml-auto flex items-center justify-center w-9 h-9 rounded-full emil-pressable"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            // P1-8：单层阴影→双层 ambient(柔和扩散) + directional(偏移聚焦)
            boxShadow:
              '0 2px 8px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.25)',
            color: 'var(--text-secondary)',
          }}
          title="滚动到底部"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onDelete={handleDeleteFromContext}
          onToggleSelect={handleToggleSelectFromContext}
          onClose={closeContextMenu}
          isSelectMode={isSelectMode}
        />
      )}

      {/* 图片灯箱 */}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {/* 消息退场动画样式（局部，不污染全局 CSS） */}
      <style>{MSG_EXIT_STYLE}</style>
    </div>
  );
}
