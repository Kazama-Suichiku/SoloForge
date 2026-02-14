/**
 * SoloForge - 聊天主视图
 * 组合对话列表、消息流、输入框
 * @module components/chat/ChatView
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import ConversationList from './ConversationList';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import NewChatDialog from './NewChatDialog';
import TodoPanel from './TodoPanel';
import ThemeToggle from '../ThemeToggle';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store/auth-store';

/**
 * 聊天主视图
 * @param {Object} props
 * @param {(conversationId: string, content: string, attachments?: Array) => void} props.onSendMessage - 发送消息回调
 * @param {() => void} [props.onOpenSettings] - 打开设置回调
 * @param {() => void} [props.onOpenDashboard] - 打开仪表板回调
 */
export default function ChatView({ onSendMessage, onSilenceGroup, onOpenSettings, onOpenDashboard }) {
  const [showNewChat, setShowNewChat] = useState(false);
  const [todoCollapsed, setTodoCollapsed] = useState(false);
  const [patrolEnabled, setPatrolEnabled] = useState(true);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const currentCompany = useAuthStore((s) => s.currentCompany);
  const switchCompany = useAuthStore((s) => s.switchCompany);

  // 获取巡查状态
  useEffect(() => {
    try {
      const p = window.electronAPI?.getPatrolStatus?.();
      if (p && typeof p.then === 'function') {
        p.then((res) => {
          if (res) setPatrolEnabled(res.running);
        }).catch(() => {});
      }
    } catch { /* ignore */ }
  }, []);

  const handlePatrolToggle = useCallback(() => {
    const next = !patrolEnabled;
    setPatrolEnabled(next);
    try {
      const p = window.electronAPI?.togglePatrol?.(next);
      if (p && typeof p.then === 'function') {
        p.catch(() => setPatrolEnabled(!next)); // 回滚
      }
    } catch { /* ignore */ }
  }, [patrolEnabled]);

  // 可拖拽侧栏宽度
  const [sidebarWidth, setSidebarWidth] = useState(288); // 默认 w-72 = 288px
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(288);

  const DEFAULT_SIDEBAR_WIDTH = 288;

  const handleDragStart = useCallback((e) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleDragMove = (moveE) => {
      if (!isDragging.current) return;
      const delta = moveE.clientX - startX.current;
      const newWidth = Math.max(200, Math.min(500, startWidth.current + delta));
      setSidebarWidth(newWidth);
    };

    const handleDragEnd = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
    };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }, [sidebarWidth]);

  // 双击恢复默认宽度
  const handleDragDoubleClick = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }, []);

  const handleSend = useCallback(
    (content, attachments) => {
      if (!currentConversationId) return;

      // 添加用户消息到 store（含附件）
      const userMsgId = sendMessage({
        conversationId: currentConversationId,
        senderId: 'user',
        senderType: 'user',
        content,
        attachments,
      });

      // 用户消息发送成功后立即更新状态（因为是本地操作，立即成功）
      updateMessage(userMsgId, { status: 'sent' });

      // 调用外部处理（发送给 Agent）
      onSendMessage?.(currentConversationId, content, attachments);
    },
    [currentConversationId, sendMessage, updateMessage, onSendMessage]
  );

  return (
    <div className="flex h-screen bg-bg-base text-text-primary">
      {/* 左侧边栏 - 对话列表（可拖拽调整宽度） */}
      <aside
        className="shrink-0 border-r border-[var(--border-color)] bg-bg-elevated flex flex-col"
        style={{ width: sidebarWidth }}
      >
        {/* macOS 标题栏占位（可拖拽区域） */}
        <div className="shrink-0 h-8 drag-region" />

        {/* 头部带主题切换和设置 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-text-primary">SoloForge</h1>
            {currentCompany && (
              <button
                onClick={switchCompany}
                className="text-xs text-text-secondary hover:text-[var(--color-primary)] transition-colors truncate max-w-full text-left"
                title="点击切换公司"
              >
                🏢 {currentCompany.name}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onOpenDashboard && (
              <button
                onClick={onOpenDashboard}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-text-secondary"
                title="运营仪表板"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </button>
            )}
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-text-secondary"
                title="设置"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>

        {/* 任务巡查开关 */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)]/50">
          <span className="text-xs text-text-secondary select-none">任务巡查</span>
          <button
            type="button"
            role="switch"
            aria-checked={patrolEnabled}
            onClick={handlePatrolToggle}
            className={`
              relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full
              transition-colors duration-200 ease-in-out focus:outline-none
              ${patrolEnabled
                ? 'bg-[var(--color-primary)]'
                : 'bg-gray-300 dark:bg-gray-600'
              }
            `}
          >
            <span
              className={`
                pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm
                transform transition-transform duration-200 ease-in-out mt-0.5
                ${patrolEnabled ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'}
              `}
            />
          </button>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-hidden">
          <ConversationList onNewChat={() => setShowNewChat(true)} />
        </div>
      </aside>

      {/* 拖拽手柄（双击恢复默认宽度） */}
      <div
        className="shrink-0 w-1 cursor-col-resize hover:bg-[var(--color-primary)]/30 active:bg-[var(--color-primary)]/50 transition-colors"
        onMouseDown={handleDragStart}
        onDoubleClick={handleDragDoubleClick}
      />

      {/* 右侧主区域 - TODO + 消息流 + 输入框 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <TodoPanel
          collapsed={todoCollapsed}
          onToggle={() => setTodoCollapsed((v) => !v)}
        />
        <MessageList />
        <ChatInput onSend={handleSend} onSilenceGroup={onSilenceGroup} />
      </main>

      {/* 新建对话弹窗 */}
      <NewChatDialog
        isOpen={showNewChat}
        onClose={() => setShowNewChat(false)}
      />
    </div>
  );
}
