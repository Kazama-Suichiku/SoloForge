/**
 * SoloForge - 单条消息气泡组件（从 MessageList.jsx 拆分）
 *
 * 包含：
 *   - 模块级常量（REMARK_PLUGINS / MARKDOWN_COMPONENTS / DEPT_COLORS）
 *   - getAgentAvatarClass / formatFullTime 辅助
 *   - VoiceMessagePlayer 语音消息播放器
 *   - AgentMessageContent（支持工具卡片交错渲染）
 *   - MessageBubble（React.memo 包裹，避免流式输出时全量重渲染）
 *
 * 拆分目的：MessageList 流式 16ms 全量重渲染，把单条消息抽到 memo 组件后，
 * 只有 message prop 变化的气泡会重渲染，其他气泡跳过。
 * @module components/chat/MessageBubble
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

export function getAgentAvatarClass(agent) {
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
export function formatFullTime(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  let content = message.content || '';
  const toolCalls = message.toolCalls;
  const hasToolGroups = toolCalls?.length > 0 && /<!--tool-group:\d+-->/.test(content);

  // 内容为空、无工具调用、无思考过程时不渲染气泡（避免流式输出前出现空气泡）
  if (!content && !toolCalls?.length && !message.metadata?.thinking) {
    return null;
  }

  // 如果内容包含 tool-group 标记但没有对应的 toolCalls，清理这些标记
  // 这种情况可能发生在任务被终止时，toolCalls 数据丢失
  if (!hasToolGroups && /<!--tool-group:\d+-->/.test(content)) {
    content = content.replace(/<!--tool-group:\d+-->/g, '').trim();
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

function MessageBubbleImpl({ message, isSelectMode, isSelected, onToggleSelect, onContextMenu, onImageClick }) {
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

/**
 * 自定义 memo 比较函数：
 * - message：引用变化才重渲染（流式时最后一条 message 引用会变，其他不变 → 跳过重渲染）
 * - isSelectMode / isSelected：布尔值，浅比较即可
 * - onToggleSelect / onContextMenu / onImageClick：父组件用 useCallback 稳定引用，
 *   但即便父组件传入新函数引用，我们也忽略（仅按 message 内容 + 布尔状态决定是否重渲染），
 *   这样能保证 MessageList 在切换多选模式/选中态时不因回调重新创建而击穿所有气泡 memo。
 */
function messageBubbleAreEqual(prev, next) {
  return (
    prev.message === next.message &&
    prev.isSelectMode === next.isSelectMode &&
    prev.isSelected === next.isSelected
  );
}

const MessageBubble = memo(MessageBubbleImpl, messageBubbleAreEqual);

export default MessageBubble;
