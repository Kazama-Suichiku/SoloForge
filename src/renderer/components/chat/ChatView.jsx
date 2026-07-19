/**
 * SoloForge - 聊天主视图（Linear 风格重构）
 * 组合对话列表、消息流、输入框
 * @module components/chat/ChatView
 *
 * 布局:
 *   ┌───────────────┬──────────────────────────┐
 *   │ 左侧栏(可折叠) │ 右主区                    │
 *   │  - 极简标题栏  │  - 顶部细栏(Agent+状态)    │
 *   │  - 导航ghost  │  - 消息流                  │
 *   │  - 巡查开关   │  - 输入区                  │
 *   │  - 会话列表   │                            │
 *   └───────────────┴──────────────────────────┘
 * 全部使用新 Linear 设计 Token（CSS 变量），不依赖 Tailwind 颜色类名。
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import './emil-styles.css';
import ConversationList from './ConversationList';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import NewChatDialog from './NewChatDialog';
import TodoPanel from './TodoPanel';
import ThemeToggle from '../ThemeToggle';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store/auth-store';
import { useAgentStore } from '../../store/agent-store';

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

  // 只提取当前对话的 type 和 participants，避免订阅整个 conversations Map
  const currentConv = useChatStore((s) => s.conversations.get(s.currentConversationId));
  const currentConvType = currentConv?.type;
  const currentConvParticipants = currentConv?.participants;

  // 只提取当前私聊对话中 Agent 的 status
  const targetAgentId = useMemo(() => {
    if (currentConvType !== 'private') return null;
    return currentConvParticipants?.find((p) => p !== 'user') || null;
  }, [currentConvType, currentConvParticipants]);

  const targetAgent = useAgentStore((s) =>
    targetAgentId ? s.agents.get(targetAgentId) : null
  );
  const targetAgentStatus = targetAgent?.status ?? null;
  const targetAgentName = targetAgent?.name ?? null;

  // 检查当前对话的 Agent 是否正在工作
  const isAgentWorking = targetAgentStatus === 'working';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(288);

  const DEFAULT_SIDEBAR_WIDTH = 288;
  const COLLAPSED_WIDTH = 0;

  const handleDragStart = useCallback((e) => {
    if (sidebarCollapsed) return;
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
  }, [sidebarWidth, sidebarCollapsed]);

  // 双击恢复默认宽度
  const handleDragDoubleClick = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    setSidebarCollapsed(false);
  }, []);

  // 折叠/展开侧边栏
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => !v);
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

  // Agent 状态圆点颜色
  const agentDotColor = isAgentWorking
    ? 'var(--accent)'
    : targetAgentStatus === 'error'
      ? 'var(--color-danger, #f87171)'
      : targetAgentStatus === 'idle'
        ? 'var(--text-tertiary, #8a8f98)'
        : 'var(--text-quaternary, #62666d)';
  const agentStatusLabel = isAgentWorking
    ? '工作中'
    : targetAgentStatus === 'error'
      ? '异常'
      : targetAgentStatus === 'idle'
        ? '在线'
        : '离线';

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        background: 'var(--bg-base, #08090a)',
        color: 'var(--text-primary, #f7f8f8)',
      }}
    >
      {/* ========== 左侧栏 - 对话列表（可拖拽调整宽度 / 可折叠） ========== */}
      <aside
        className="shrink-0 flex flex-col overflow-hidden emil-sidebar-collapse glass-heavy"
        style={{
          width: sidebarCollapsed ? COLLAPSED_WIDTH : sidebarWidth,
          borderRight: '1px solid var(--border-subtle, rgba(255,255,255,0.05))',
        }}
      >
        {/* macOS 标题栏占位（可拖拽区域） */}
        <div className="shrink-0 h-8 drag-region" />

        {/* 极简标题栏 */}
        <div
          className="shrink-0 flex items-center justify-between px-3 h-11"
          style={{ borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.05))' }}
        >
          <div className="min-w-0 flex items-center gap-2">
            {/* 折叠按钮 */}
            <button
              type="button"
              onClick={toggleSidebar}
              className="shrink-0 p-1 rounded-md emil-pressable emil-ghost-hover"
              style={{
                color: 'var(--text-tertiary, #8a8f98)',
                background: 'transparent',
              }}
              title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1
                className="text-[13px] truncate"
                style={{
                  color: 'var(--text-primary, #f7f8f8)',
                  fontWeight: 590,
                  letterSpacing: '-0.012em',
                }}
              >
                SoloForge
              </h1>
              {currentCompany && (
                <button
                  type="button"
                  onClick={switchCompany}
                  className="block text-[11px] truncate max-w-full text-left emil-ghost-hover"
                  style={{ color: 'var(--text-tertiary, #8a8f98)' }}
                  title="点击切换公司"
                >
                  🏢 {currentCompany.name}
                </button>
              )}
            </div>
          </div>

          {/* ghost 风格导航按钮 */}
          <div className="flex items-center gap-1 shrink-0">
            {onOpenDashboard && (
              <button
                type="button"
                onClick={onOpenDashboard}
                className="p-1.5 rounded-md emil-pressable emil-ghost-hover"
                style={{
                  color: 'var(--text-tertiary, #8a8f98)',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.05))',
                }}
                title="运营仪表板"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </button>
            )}
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="p-1.5 rounded-md emil-pressable emil-ghost-hover"
                style={{
                  color: 'var(--text-tertiary, #8a8f98)',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.05))',
                }}
                title="设置"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>

        {/* 任务巡查开关（极简行） */}
        <div
          className="shrink-0 flex items-center justify-between px-3 h-9"
          style={{ borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.05))' }}
        >
          <span
            className="text-[12px] select-none"
            style={{ color: 'var(--text-tertiary, #8a8f98)' }}
          >
            任务巡查
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={patrolEnabled}
            onClick={handlePatrolToggle}
            className="relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full emil-pressable emil-toggle-track focus:outline-none"
            style={{
              background: patrolEnabled
                ? 'var(--accent, #5e6ad2)'
                : 'rgba(255,255,255,0.08)',
            }}
          >
            <span
              className="pointer-events-none inline-block h-3 w-3 rounded-full bg-white emil-toggle-thumb"
              style={{
                transform: patrolEnabled ? 'translateX(14px)' : 'translateX(2px)',
                marginTop: '2px',
              }}
            />
          </button>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-hidden">
          <ConversationList onNewChat={() => setShowNewChat(true)} />
        </div>
      </aside>

      {/* 拖拽手柄（双击恢复默认宽度；折叠时隐藏） */}
      {!sidebarCollapsed && (
        <div
          className="shrink-0 w-1 cursor-col-resize emil-drag-handle"
          onMouseDown={handleDragStart}
          onDoubleClick={handleDragDoubleClick}
        />
      )}

      {/* ========== 右侧主区域 ========== */}
      <main
        className="flex-1 flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-base, #08090a)',
        }}
      >
        {/* 顶部细栏：当前 Agent 名 + 状态圆点 —— 液态玻璃 */}
        <div
          className="shrink-0 flex items-center justify-between px-4 h-11 drag-region glass-medium"
          style={{
            borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.05))',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {targetAgentName ? (
              <>
                <span
                  key={targetAgentStatus || 'offline'}
                  className="emil-dot-enter inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: agentDotColor }}
                  title={agentStatusLabel}
                />
                <span
                  className="text-[13px] truncate"
                  style={{
                    color: 'var(--text-primary, #f7f8f8)',
                    fontWeight: 510,
                    letterSpacing: '-0.012em',
                  }}
                >
                  {targetAgentName}
                </span>
                <span
                  className="text-[12px] shrink-0"
                  style={{ color: 'var(--text-tertiary, #8a8f98)' }}
                >
                  · {agentStatusLabel}
                </span>
              </>
            ) : currentConvType === 'department' || currentConvType === 'group' ? (
              <>
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded shrink-0"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text-tertiary, #8a8f98)',
                    fontSize: '10px',
                  }}
                >
                  #
                </span>
                <span
                  className="text-[13px] truncate"
                  style={{
                    color: 'var(--text-primary, #f7f8f8)',
                    fontWeight: 510,
                    letterSpacing: '-0.012em',
                  }}
                >
                  {currentConv?.name || '群聊'}
                </span>
              </>
            ) : (
              <span
                className="text-[13px]"
                style={{ color: 'var(--text-tertiary, #8a8f98)' }}
              >
                选择一个对话开始
              </span>
            )}
          </div>
        </div>

        <TodoPanel
          collapsed={todoCollapsed}
          onToggle={() => setTodoCollapsed((v) => !v)}
        />
        <MessageList />
        <ChatInput
          onSend={handleSend}
          onSilenceGroup={onSilenceGroup}
          disabled={isAgentWorking}
          placeholder={isAgentWorking ? '等待 Agent 响应中...' : '输入消息...'}
        />
      </main>

      {/* 新建对话弹窗 */}
      <NewChatDialog
        isOpen={showNewChat}
        onClose={() => setShowNewChat(false)}
      />
    </div>
  );
}
