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
  // 拖拽边界：低于此值 snap 回 200，高于此值 snap 到 500
  const MIN_WIDTH = 200;
  const MAX_WIDTH = 500;

  // aside 引用（用于释放时设临时 transition）—— 提前声明避免 TDZ
  const asideRef = useRef(null);

  // P1-10：橡皮筋渐进阻力函数。
  // 在 [min,max] 区间内 1:1 跟随；超出区间后阻力按 1/d 增长，越拉越难（非硬停）。
  // dim 为阻力系数，Apple §9 推荐约 0.55。
  const rubberband = useCallback((value, min, max, dim = 0.55) => {
    if (value < min) {
      const overflow = min - value;
      return min - (overflow * dim) / (overflow * 0.001 + 1);
    }
    if (value > max) {
      const overflow = value - max;
      return max + (overflow * dim) / (overflow * 0.001 + 1);
    }
    return value;
  }, []);

  // P0-7：指针速度历史（最近几次 pointermove），用于释放时计算初速度
  const moveHistoryRef = useRef([]);
  // 释放时的过渡控制：transition 期间用 ref 避免重复触发
  const animFrameRef = useRef(null);

  const handleDragStart = useCallback((e) => {
    if (sidebarCollapsed) return;
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    moveHistoryRef.current = [{ x: e.clientX, t: performance.now() }];
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleDragMove = (moveE) => {
      if (!isDragging.current) return;
      const delta = moveE.clientX - startX.current;
      // P1-10：用橡皮筋替代硬 clamp —— 区间内 1:1，越界渐进阻力
      const target = rubberband(startWidth.current + delta, MIN_WIDTH, MAX_WIDTH);
      setSidebarWidth(target);
      // 记录速度历史（保留最近 5 个采样，用于平滑速度估计）
      const now = performance.now();
      moveHistoryRef.current.push({ x: moveE.clientX, t: now });
      if (moveHistoryRef.current.length > 5) moveHistoryRef.current.shift();
    };

    // P0-7：释放时计算速度，用速度投影选 snap 目标，再用弹性曲线动画过去。
    const handleDragEnd = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);

      // 取最近 ~100ms 的速度采样，计算 px/ms 速度
      const hist = moveHistoryRef.current;
      let velocity = 0; // px/ms
      if (hist.length >= 2) {
        const first = hist[0];
        const last = hist[hist.length - 1];
        const dt = last.t - first.t;
        if (dt > 0) velocity = (last.x - first.x) / dt;
      }
      moveHistoryRef.current = [];

      // 当前显示宽度（含橡皮筋 overshoot 的值）
      const current = startWidth.current + 0; // 注：此处用 state 会有闭包旧值，改用 latest 估计
      // 用一个近似的动量投影：project(v) = current + (v/1000) * d / (1-d), d≈0.998
      // 这里 current 用最后一次 setSidebarWidth 后的值无法直接读，改用 velocity 推方向 + current 落点
      // 简化：按速度方向决定 snap 目标
      // 计算 current：从 hist 推最后一次 delta
      let lastWidth = startWidth.current;
      if (hist.length >= 2) {
        const f = hist[0];
        const l = hist[hist.length - 1];
        const totalDelta = l.x - f.x;
        lastWidth = rubberband(startWidth.current + totalDelta, MIN_WIDTH, MAX_WIDTH);
      } else {
        lastWidth = current;
      }

      // 速度阈值（px/ms）：>0.3 视为快速 flick
      const FLICK_THRESHOLD = 0.3;
      let targetWidth;
      if (Math.abs(velocity) > FLICK_THRESHOLD) {
        // 快速 flick：向速度方向 snap 到极值
        targetWidth = velocity > 0 ? MAX_WIDTH : MIN_WIDTH;
      } else {
        // 慢速释放：snap 到最近的边界（200 或 500），若离默认 288 很近则 snap 到默认
        const distToMin = Math.abs(lastWidth - MIN_WIDTH);
        const distToMax = Math.abs(lastWidth - MAX_WIDTH);
        const distToDefault = Math.abs(lastWidth - DEFAULT_SIDEBAR_WIDTH);
        // 若离默认宽度很近（<30px），优先 snap 到默认
        if (distToDefault < 30 && distToDefault < distToMin && distToDefault < distToMax) {
          targetWidth = DEFAULT_SIDEBAR_WIDTH;
        } else {
          targetWidth = distToMin < distToMax ? MIN_WIDTH : MAX_WIDTH;
        }
      }

      // 用弹性曲线动画到目标宽度（iOS drawer curve，damping 感）
      // 用 requestAnimationFrame + 指数缓动模拟 spring 近似；或直接用 CSS transition。
      // 这里用 CSS transition（react 状态驱动 width，由 .emil-sidebar-collapse 的 width transition 承担）。
      // 但 .emil-sidebar-collapse 的曲线是 drawer 静态曲线，为释放加一个临时的弹性 transition：
      const asideEl = asideRef.current;
      if (asideEl) {
        // 释放弹簧：cubic-bezier(0.34, 1.56, 0.64, 1) 带 overshoot（damping~0.8 动量感）
        asideEl.style.transition = 'width 320ms cubic-bezier(0.34, 1.56, 0.64, 1)';
      }
      setSidebarWidth(targetWidth);
      // 动画结束后清除临时 transition，恢复 .emil-sidebar-collapse 默认
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      const cleanup = () => {
        if (asideEl) asideEl.style.transition = '';
        animFrameRef.current = null;
      };
      animFrameRef.current = requestAnimationFrame(() => {
        // 一帧后已开始 transition，~340ms 后清理
        setTimeout(cleanup, 340);
      });
    };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }, [sidebarWidth, sidebarCollapsed, rubberband]);

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
        ref={asideRef}
        className="shrink-0 flex flex-col overflow-hidden emil-sidebar-collapse glass-heavy"
        style={{
          width: sidebarCollapsed ? COLLAPSED_WIDTH : sidebarWidth,
          borderRight: '1px solid var(--border-subtle, rgba(255,255,255,0.05))',
          // P2-12：拖拽时提示合成层
          willChange: isDragging.current ? 'width' : 'auto',
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
            className="relative inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full emil-pressable emil-toggle-track focus:outline-none"
            style={{
              background: patrolEnabled
                ? 'var(--accent, #5e6ad2)'
                : 'rgba(255,255,255,0.08)',
            }}
          >
            <span
              className="pointer-events-none inline-block h-[27px] w-[27px] rounded-full bg-white emil-toggle-thumb"
              style={{
                transform: patrolEnabled ? 'translateX(20px)' : 'translateX(2px)',
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
            // P1-1：硬边框→底部内阴影渐隐（替代 borderBottom 硬线）。
            // 保留 glass-medium 的顶部高光（rgba 0.18），叠加底部极淡内阴影作分隔。
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(255,255,255,0.04)',
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
