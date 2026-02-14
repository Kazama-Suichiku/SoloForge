/**
 * SoloForge - 消息流组件
 * 显示当前对话的消息列表，支持 Markdown、清屏、右键删除、多选批量删除
 * @module components/chat/MessageList
 */

import { useEffect, useRef, useMemo, useCallback, useState, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatStore } from '../../store/chat-store';
import { useAgentStore } from '../../store/agent-store';
import AgentAvatar from '../AgentAvatar';
import ToolCallCard from './ToolCallCard';

// Agent 头像按部门着色
const DEPT_COLORS = {
  '管理层': 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700',
  '技术部': 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700',
  '财务部': 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700',
  '人事部': 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700',
  '内容部': 'bg-rose-100 dark:bg-rose-900/30 border-rose-300 dark:border-rose-700',
  '行政部': 'bg-cyan-100 dark:bg-cyan-900/30 border-cyan-300 dark:border-cyan-700',
};

function getAgentAvatarClass(agent) {
  if (!agent) return 'bg-bg-elevated border border-[var(--border-color)]';
  const dept = agent.department || '';
  const deptColor = DEPT_COLORS[dept];
  if (deptColor) return `${deptColor} border`;
  return 'bg-bg-elevated border border-[var(--border-color)]';
}

// 模块级常量：避免每次渲染创建新对象，防止 ReactMarkdown 不必要的重渲染
const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_COMPONENTS = {
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) window.electronAPI?.openExternal?.(href);
      }}
      className="text-[var(--color-primary)] hover:opacity-80 underline cursor-pointer"
      title={href}
      {...props}
    >
      {children}
    </a>
  ),
  pre: ({ children, ...props }) => (
    <pre className="bg-black/5 dark:bg-white/5 rounded-lg p-3 overflow-x-auto text-sm" {...props}>
      {children}
    </pre>
  ),
  code: ({ inline, children, ...props }) => {
    if (inline) {
      return (
        <code className="px-1.5 py-0.5 bg-black/10 dark:bg-white/10 rounded text-sm" {...props}>
          {children}
        </code>
      );
    }
    return <code {...props}>{children}</code>;
  },
};

/**
 * 格式化完整时间
 */
function formatFullTime(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─────────────────────────────────────────────────────────
// 右键菜单组件
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
      className="bg-bg-elevated border border-[var(--border-color)] rounded-lg shadow-xl py-1 min-w-[140px] animate-scale-in"
    >
      <button
        type="button"
        onClick={onDelete}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
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
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-[var(--bg-hover)] transition-colors"
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
// 语音消息播放器
// ─────────────────────────────────────────────────────────

function VoiceMessagePlayer({ attachment, isUser }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showTranscription, setShowTranscription] = useState(false);
  const audioRef = useRef(null);
  const animFrameRef = useRef(null);

  const duration = attachment.duration || 0;

  const togglePlay = useCallback((e) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    } else {
      audio.play().then(() => {
        setIsPlaying(true);
        const updateProgress = () => {
          if (audio.duration) {
            setProgress(audio.currentTime / audio.duration);
          }
          if (!audio.paused) {
            animFrameRef.current = requestAnimationFrame(updateProgress);
          }
        };
        updateProgress();
      }).catch((err) => console.warn('播放失败:', err));
    }
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };

    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('ended', handleEnded);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const formatDuration = (sec) => {
    if (!sec || sec <= 0) return "0''";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m > 0) return `${m}'${s}''`;
    return `${s}''`;
  };

  // 气泡宽度随时长增长（模仿微信），最小 120px，最大 260px
  const bubbleWidth = Math.min(260, Math.max(120, 120 + duration * 8));

  return (
    <div className="flex flex-col gap-1">
      <audio ref={audioRef} src={`sf-local://${attachment.path}`} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        className={`flex items-center gap-2.5 rounded-2xl px-4 py-2.5 transition-colors ${
          isUser
            ? 'bg-[var(--color-primary)] text-white rounded-tr-sm hover:bg-[var(--color-primary)]/85'
            : 'bg-bg-elevated border border-[var(--border-color)] text-text-primary rounded-tl-sm hover:bg-[var(--bg-hover)]'
        }`}
        style={{ width: `${bubbleWidth}px` }}
      >
        {/* 播放/暂停图标 */}
        <span className="shrink-0">
          {isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </span>

        {/* 声波动画 / 进度条 */}
        <div className="flex-1 flex items-center gap-[3px] h-5">
          {Array.from({ length: 16 }).map((_, i) => {
            const barProgress = (i + 1) / 16;
            const isActive = progress >= barProgress;
            const animDelay = `${(i * 0.08).toFixed(2)}s`;
            return (
              <div
                key={i}
                className={`w-[3px] rounded-full transition-all duration-150 ${
                  isPlaying
                    ? (isUser ? 'bg-white/90 animate-pulse' : 'bg-[var(--color-primary)] animate-pulse')
                    : isActive
                    ? (isUser ? 'bg-white/90' : 'bg-[var(--color-primary)]')
                    : (isUser ? 'bg-white/30' : 'bg-[var(--border-color)]')
                }`}
                style={{
                  height: `${6 + Math.sin(i * 0.8) * 6 + Math.random() * 4}px`,
                  animationDelay: isPlaying ? animDelay : undefined,
                }}
              />
            );
          })}
        </div>

        {/* 时长 */}
        <span className={`shrink-0 text-xs font-medium ${
          isUser ? 'text-white/80' : 'text-text-secondary'
        }`}>
          {formatDuration(duration)}
        </span>
      </button>

      {/* 转写文本（可折叠） */}
      {attachment.transcription && (
        <div className={`${isUser ? 'text-right' : 'text-left'}`}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowTranscription(!showTranscription); }}
            className="text-[11px] text-text-secondary/70 hover:text-text-secondary transition-colors"
          >
            {showTranscription ? '收起文字' : '查看文字'}
          </button>
          {showTranscription && (
            <p className={`mt-1 text-xs leading-relaxed px-3 py-1.5 rounded-lg max-w-[260px] ${
              isUser
                ? 'bg-[var(--color-primary)]/10 text-text-primary ml-auto'
                : 'bg-bg-elevated border border-[var(--border-color)] text-text-primary'
            }`}>
              {attachment.transcription}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Agent 消息内容渲染（支持工具卡片交错排列）
// ─────────────────────────────────────────────────────────

/**
 * 将 toolCalls 按 groupIndex 分组
 */
function groupToolCallsByIndex(toolCalls) {
  if (!toolCalls?.length) return {};
  const groups = {};
  for (const tc of toolCalls) {
    const gi = tc.groupIndex ?? 0;
    if (!groups[gi]) groups[gi] = [];
    groups[gi].push(tc);
  }
  return groups;
}

/**
 * Agent 消息内容组件：
 * - 无工具调用时正常渲染 Markdown
 * - 有工具调用时按 <!--tool-group:N--> 标记分割，交错插入工具卡片
 */
function AgentMessageContent({ message }) {
  const content = message.content || '';
  const toolCalls = message.toolCalls;
  const hasToolGroups = toolCalls?.length > 0 && /<!--tool-group:\d+-->/.test(content);

  // 内容为空、无工具调用、无思考过程时不渲染气泡（避免流式输出前出现空气泡）
  if (!content && !toolCalls?.length && !message.metadata?.thinking) {
    return null;
  }

  if (!hasToolGroups) {
    // 无工具调用：保持原有渲染方式
    return (
      <div className="rounded-2xl px-4 py-2.5 bg-bg-elevated border border-[var(--border-color)] text-text-primary rounded-tl-sm">
        <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:px-1 prose-code:py-0.5 prose-code:bg-black/10 dark:prose-code:bg-white/10 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
          {content ? (
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
              {content}
            </ReactMarkdown>
          ) : (
            message.status === 'sending' ? '...' : ''
          )}
        </div>
        {message.metadata?.thinking && (
          <details className="mt-2 text-xs opacity-70">
            <summary className="cursor-pointer hover:opacity-100">💭 思考过程</summary>
            <p className="mt-1 whitespace-pre-wrap">{message.metadata.thinking}</p>
          </details>
        )}
      </div>
    );
  }

  // 有工具调用：分割内容 + 交错渲染
  const toolGroups = groupToolCallsByIndex(toolCalls);
  const segments = content.split(/<!--tool-group:\d+-->/);

  return (
    <div className="flex flex-col gap-2">
      {segments.map((segmentText, i) => {
        const trimmedText = segmentText.trim();
        const groupIndex = i - 1; // segments[0] 是第一个标记之前的文本，标记对应 segments[1]+ 之前的间隙

        return (
          <Fragment key={i}>
            {/* 文本段 */}
            {trimmedText && (
              <div className="rounded-2xl px-4 py-2.5 bg-bg-elevated border border-[var(--border-color)] text-text-primary rounded-tl-sm">
                <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:px-1 prose-code:py-0.5 prose-code:bg-black/10 dark:prose-code:bg-white/10 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                  <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
                    {trimmedText}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* 工具卡片组：<!--tool-group:N--> 出现在 segments[N] 和 segments[N+1] 之间，
                所以 segments[i] 渲染完后插入 toolGroups[i] */}
            {toolGroups[i] && (
              <div className="space-y-1.5 pl-1">
                {toolGroups[i].map((tc) => (
                  <ToolCallCard key={tc.id} toolCall={tc} />
                ))}
              </div>
            )}
          </Fragment>
        );
      })}

      {/* 思考过程 */}
      {message.metadata?.thinking && (
        <div className="rounded-2xl px-4 py-2.5 bg-bg-elevated border border-[var(--border-color)] text-text-primary rounded-tl-sm">
          <details className="text-xs opacity-70">
            <summary className="cursor-pointer hover:opacity-100">💭 思考过程</summary>
            <p className="mt-1 whitespace-pre-wrap">{message.metadata.thinking}</p>
          </details>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 单条消息气泡（支持选中、右键）
// ─────────────────────────────────────────────────────────

function MessageBubble({ message, isSelectMode, isSelected, onToggleSelect, onContextMenu, onImageClick }) {
  const getAgent = useAgentStore((s) => s.getAgent);
  const bossConfig = useAgentStore((s) => s.bossConfig);
  const isUser = message.senderType === 'user';
  const agent = !isUser ? getAgent(message.senderId) : null;
  const hasAttachments = message.attachments?.length > 0;
  const isVoiceMessage = hasAttachments && message.attachments.some((a) => a.type === 'audio');

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    onContextMenu(e, message.id);
  }, [message.id, onContextMenu]);

  const handleClick = useCallback(() => {
    if (isSelectMode) {
      onToggleSelect(message.id);
    }
  }, [isSelectMode, message.id, onToggleSelect]);

  // Agent 消息占位（流式输出前）：内容为空且无附件/工具/思考，不渲染整个气泡
  if (!isUser && !message.content && !hasAttachments && !message.toolCalls?.length && !message.metadata?.thinking) {
    return null;
  }

  return (
    <div
      className={`flex gap-3 group relative ${isUser ? 'flex-row-reverse' : 'flex-row'} ${
        isSelectMode ? 'cursor-pointer' : ''
      } ${isSelected ? 'bg-blue-50/50 dark:bg-blue-950/20 rounded-xl -mx-2 px-2 py-1' : ''}`}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
    >
      {/* 多选复选框 */}
      {isSelectMode && (
        <div className="shrink-0 flex items-center">
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-blue-500 border-blue-500'
                : 'border-gray-300 dark:border-gray-600 hover:border-blue-400'
            }`}
          >
            {isSelected && (
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* 头像 */}
      <div className="shrink-0">
        {isUser ? (
          <AgentAvatar
            avatar={bossConfig.avatar}
            fallback="👤"
            size="sm"
            bgClass="bg-[var(--color-primary)] text-white"
          />
        ) : (
          <AgentAvatar
            avatar={agent?.avatar}
            fallback="🤖"
            size="sm"
            bgClass={getAgentAvatarClass(agent)}
          />
        )}
      </div>

      {/* 消息内容 */}
      <div className={`flex flex-col ${isUser ? 'items-end max-w-[70%]' : 'items-start max-w-[85%]'}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-text-secondary">
            {isUser ? (bossConfig.name || '我') : agent?.name ?? message.senderId}
          </span>
          <span className="text-xs text-text-secondary/60">
            {formatFullTime(message.timestamp)}
          </span>
        </div>

        {/* 语音消息 */}
        {isVoiceMessage && (
          <div className={`mb-1 ${isUser ? 'flex justify-end' : ''}`}>
            {message.attachments
              .filter((a) => a.type === 'audio')
              .map((att) => (
                <VoiceMessagePlayer key={att.id} attachment={att} isUser={isUser} />
              ))}
          </div>
        )}

        {/* 图片附件（排除音频） */}
        {hasAttachments && !isVoiceMessage && (
          <div className={`flex flex-wrap gap-1.5 mb-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {message.attachments.filter((a) => a.type === 'image').map((att) => (
              <button
                key={att.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onImageClick?.(`sf-local://${att.path}`);
                }}
                className="block rounded-xl overflow-hidden border border-[var(--border-color)] hover:ring-2 hover:ring-[var(--color-primary)]/50 transition-all cursor-pointer"
              >
                <img
                  src={`sf-local://${att.path}`}
                  alt={att.filename}
                  className="max-w-[280px] max-h-[200px] object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}

        {/* 文本消息气泡（语音消息不显示文本气泡，因为转写已嵌入语音播放器） */}
        {!isVoiceMessage && (message.content || !hasAttachments) && (
          <>
            {isUser ? (
              /* 用户消息：纯文本气泡 */
              <div className="rounded-2xl px-4 py-2.5 bg-[var(--color-primary)] text-white rounded-tr-sm">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {message.content || (message.status === 'sending' ? '...' : '')}
                </p>
              </div>
            ) : (
              /* Agent 消息：支持工具卡片交错渲染 */
              <AgentMessageContent message={message} />
            )}
          </>
        )}

        {message.status === 'sending' && (
          <span className="text-xs text-text-secondary mt-1">发送中...</span>
        )}
        {message.status === 'error' && (
          <span className="text-xs text-red-500 mt-1">发送失败</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 图片灯箱（点击放大预览）
// ─────────────────────────────────────────────────────────

function ImageLightbox({ src, onClose }) {
  const lightboxRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={lightboxRef}
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <img
        src={src}
        alt="放大预览"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 批量操作栏
// ─────────────────────────────────────────────────────────

function SelectionBar({ selectedCount, onDeleteSelected, onSelectAll, onCancelSelect }) {
  return (
    <div className="shrink-0 px-4 py-2.5 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancelSelect}
          className="text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          取消
        </button>
        <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
          已选中 {selectedCount} 条消息
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSelectAll}
          className="px-3 py-1 text-xs rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-text-primary hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          全选
        </button>
        <button
          type="button"
          onClick={onDeleteSelected}
          disabled={selectedCount === 0}
          className="px-3 py-1 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

  // 追踪滚动位置：仅在用户接近底部时自动滚动
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 120; // px
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // 多选模式
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

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

  // 右键 → 删除此消息
  const handleDeleteFromContext = useCallback(() => {
    if (!contextMenu || !currentConversationId) return;
    deleteMessages(currentConversationId, [contextMenu.messageId]);
    setContextMenu(null);
  }, [contextMenu, currentConversationId, deleteMessages]);

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
    deleteMessages(currentConversationId, Array.from(selectedIds));
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, [currentConversationId, selectedIds, deleteMessages]);

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
      <div className="shrink-0 h-8 drag-region bg-bg-elevated" />

      {/* 对话头部 */}
      <div className="shrink-0 px-6 py-4 border-b border-[var(--border-color)] bg-bg-elevated flex items-center justify-between">
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-[var(--border-color)]/50 transition-colors"
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
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto px-6 py-4 min-h-0">
        {visibleMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-bg-muted flex items-center justify-center text-3xl mb-4">
              {conversation?.type === 'group' ? '👥' : '💬'}
            </div>
            <p className="text-base font-medium text-text-primary mb-1">
              {conversation?.type === 'group' ? '群组对话' : '开始新对话'}
            </p>
            <p className="text-sm text-text-muted">
              {conversation?.type === 'group'
                ? '在下方输入消息，所有成员都能看到'
                : '发送消息开始与 Agent 对话'}
            </p>
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            {visibleMessages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isSelectMode={isSelectMode}
                isSelected={selectedIds.has(msg.id)}
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
                    <div className="rounded-2xl rounded-tl-sm bg-bg-elevated border border-[var(--border-color)] px-4 py-3">
                      <div className="flex gap-1.5 items-center">
                        <span className="w-2 h-2 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div ref={messagesEndRef} />
          </div>
        )}
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
    </div>
  );
}
