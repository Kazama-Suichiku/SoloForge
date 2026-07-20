/**
 * SoloForge - 单条消息气泡组件（从 MessageList.jsx 拆分）
 *
 * Linear 风格（批次1-C）：
 *   - 用户消息：右对齐，var(--bg-surface) 半透明背景，6px 圆角，无头像
 *   - Agent 消息：左对齐，无背景（直接在 --bg-base 上），左侧 32px 圆形小头像
 *   - Agent 名：text-primary 15px weight 510，角色标签 pill badge（text-tertiary 12px）
 *   - 消息内容：16px 行高 1.6，markdown 渲染保留（react-markdown）
 *   - 代码块：JetBrains Mono，var(--bg-panel) 背景，细边框
 *   - 工具调用区域：保留 ToolCallCard 引用，容器用 var(--bg-surface) + 细边框
 *   - 时间戳：text-quaternary 12px
 *   - 选择模式：保留选中态（accent 边框）
 *   - 右键菜单：保留
 *
 * 性能：React.memo + 自定义比较函数保留，避免流式输出时全量重渲染。
 *
 * @module components/chat/MessageBubble
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import MermaidDiagram from './MermaidDiagram';
import { useAgentStore } from '../../store/agent-store';
import AgentAvatar from '../AgentAvatar';
import ToolCallCard from './ToolCallCard';

// ─────────────────────────────────────────────────────────
// 部门着色：Linear 风格半透明背景，无实色蓝/紫/绿等。
// 用 CSS 变量驱动；保留映射以便 getAgentAvatarClass 输出稳定 className。
// ─────────────────────────────────────────────────────────
const DEPT_AVATAR_TINT = {
  '管理层': 'rgba(245, 158, 11, 0.18)',
  '技术部': 'rgba(94, 106, 210, 0.20)',
  '财务部': 'rgba(34, 197, 94, 0.18)',
  '人事部': 'rgba(168, 85, 247, 0.18)',
  '内容部': 'rgba(244, 63, 94, 0.18)',
  '行政部': 'rgba(6, 182, 212, 0.18)',
};

const DEPT_AVATAR_BORDER = {
  '管理层': 'rgba(245, 158, 11, 0.45)',
  '技术部': 'rgba(94, 106, 210, 0.55)',
  '财务部': 'rgba(34, 197, 94, 0.45)',
  '人事部': 'rgba(168, 85, 247, 0.45)',
  '内容部': 'rgba(244, 63, 94, 0.45)',
  '行政部': 'rgba(6, 182, 212, 0.45)',
};

export function getAgentAvatarClass(_agent) {
  // 保留导出名（其他文件可能 import），但 Linear 风格下背景由 inline style 驱动。
  return '';
}

/**
 * 生成 Agent 头像的 inline style（半透明部门 tint + 细边框）。
 */
function getAgentAvatarStyle(agent) {
  if (!agent) {
    return {
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
    };
  }
  const dept = agent.department || '';
  const tint = DEPT_AVATAR_TINT[dept];
  const borderColor = DEPT_AVATAR_BORDER[dept];
  if (tint && borderColor) {
    return {
      background: tint,
      border: `1px solid ${borderColor}`,
    };
  }
  return {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
  };
}

// ─────────────────────────────────────────────────────────
// 模块级常量：避免每次渲染创建新对象，防止 ReactMarkdown 不必要的重渲染
// ─────────────────────────────────────────────────────────
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

// Linear 风格 markdown 渲染器：
// - 链接用 accent 色
// - 代码块用 JetBrains Mono + var(--bg-panel) + 细边框
// - 行内代码用 var(--bg-surface) 半透明背景
const MARKDOWN_COMPONENTS = {
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) window.electronAPI?.openExternal?.(href);
      }}
      className="underline cursor-pointer transition-opacity"
      style={{ color: 'var(--accent)' }}
      title={href}
      {...props}
    >
      {children}
    </a>
  ),
  pre: ({ children, ...props }) => (
    <pre
      className="overflow-x-auto my-2 emil-code-block"
      style={{
        fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '13px',
        lineHeight: '1.55',
      }}
      {...props}
    >
      {children}
    </pre>
  ),
  code: ({ inline, className, children, ...props }) => {
    const text = String(children);
    const lang = /language-(\w+)/.exec(className || '')?.[1];

    // Mermaid 图表检测
    if (!inline && lang === 'mermaid') {
      return <MermaidDiagram chart={text} />;
    }

    if (inline) {
      return (
        <code
          className="px-1.5 py-0.5"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.9em',
          }}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        style={{
          fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
        {...props}
      >
        {children}
      </code>
    );
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
// 语音消息播放器（Linear 风格：去除气泡大圆角/蓝色，改半透明背景 + 细边框）
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

  const accent = 'var(--accent)';

  return (
    <div className="flex flex-col gap-1">
      <audio ref={audioRef} src={`sf-local://${attachment.path}`} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        className="flex items-center gap-2.5 transition-colors emil-pressable"
        style={{
          width: `${bubbleWidth}px`,
          borderRadius: 'var(--radius-md)',
          padding: '10px 14px',
          background: isUser ? accent : 'rgba(25, 26, 27, 0.68)',
          backdropFilter: isUser ? 'none' : 'blur(20px) saturate(160%)',
          WebkitBackdropFilter: isUser ? 'none' : 'blur(20px) saturate(160%)',
          border: isUser ? '1px solid transparent' : '1px solid var(--border-default)',
          color: isUser ? '#ffffff' : 'var(--text-primary)',
        }}
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
            let barColor;
            if (isPlaying) {
              barColor = isUser ? 'rgba(255,255,255,0.9)' : accent;
            } else if (isActive) {
              barColor = isUser ? 'rgba(255,255,255,0.9)' : accent;
            } else {
              barColor = isUser ? 'rgba(255,255,255,0.3)' : 'var(--border-default)';
            }
            return (
              <div
                key={i}
                className="w-[3px] rounded-full transition-all duration-150"
                style={{
                  height: `${6 + Math.sin(i * 0.8) * 6 + Math.random() * 4}px`,
                  background: barColor,
                  animationDelay: isPlaying ? animDelay : undefined,
                }}
              />
            );
          })}
        </div>

        {/* 时长 */}
        <span
          className="shrink-0 text-xs font-medium"
          style={{ color: isUser ? 'rgba(255,255,255,0.85)' : 'var(--text-tertiary)' }}
        >
          {formatDuration(duration)}
        </span>
      </button>

      {/* 转写文本（可折叠） */}
      {attachment.transcription && (
        <div className={isUser ? 'text-right' : 'text-left'}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowTranscription(!showTranscription); }}
            className="text-[11px] transition-colors hover:opacity-80"
            style={{ color: 'var(--text-quaternary)' }}
          >
            {showTranscription ? '收起文字' : '查看文字'}
          </button>
          {showTranscription && (
            <p
              className="mt-1 text-xs leading-relaxed max-w-[260px]"
              style={{
                padding: '6px 10px',
                borderRadius: 'var(--radius-md)',
                marginLeft: isUser ? 'auto' : 0,
                background: isUser ? 'rgba(94, 106, 210, 0.10)' : 'rgba(25, 26, 27, 0.68)',
                backdropFilter: isUser ? 'none' : 'blur(20px) saturate(160%)',
                WebkitBackdropFilter: isUser ? 'none' : 'blur(20px) saturate(160%)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            >
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
// Linear 风格：Agent 文本不再套气泡，直接在 --bg-base 上显示；
// 工具调用组用 var(--bg-surface) 容器 + 细边框包裹。
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
 * - 无工具调用时正常渲染 Markdown（无气泡背景，直接在 --bg-base 上）
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

  // Markdown 正文样式：16px / 1.6 行高
  const bodyStyle = {
    fontSize: '16px',
    lineHeight: '1.6',
    color: 'var(--text-primary)',
  };

  if (!hasToolGroups) {
    // 无工具调用：直接在 --bg-base 上渲染（无气泡背景）
    return (
      <div className="max-w-none break-words" style={bodyStyle}>
        {content ? (
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
            {content}
          </ReactMarkdown>
        ) : (
          message.status === 'sending' ? <span style={{ color: 'var(--text-tertiary)' }}>…</span> : null
        )}
        {message.metadata?.thinking && (
          <details
            className="mt-2 text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <summary className="cursor-pointer hover:opacity-100">思考过程</summary>
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
    <div className="flex flex-col gap-2.5">
      {segments.map((segmentText, i) => {
        const trimmedText = segmentText.trim();
        const groupIndex = i - 1; // segments[0] 是第一个标记之前的文本

        return (
          <Fragment key={i}>
            {/* 文本段（直接在 --bg-base 上） */}
            {trimmedText && (
              <div className="max-w-none break-words" style={bodyStyle}>
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
                  {trimmedText}
                </ReactMarkdown>
              </div>
            )}

            {/* 工具卡片组：液态玻璃容器（rgba 0.68 + backdrop-filter）+ 细边框
                P1-11：加 .glass-enter（blur+scale 同步 materialize 入场） */}
            {toolGroups[i] && (
              <div
                className="space-y-1.5 glass-enter"
                style={{
                  padding: '10px 12px',
                  background: 'rgba(25, 26, 27, 0.68)',
                  backdropFilter: 'blur(20px) saturate(160%)',
                  WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
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
        <details className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <summary className="cursor-pointer hover:opacity-100">思考过程</summary>
          <p className="mt-1 whitespace-pre-wrap">{message.metadata.thinking}</p>
        </details>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 角色标签 pill badge（Linear 风格：text-tertiary 12px + 细边框 + 半透明背景）
// ─────────────────────────────────────────────────────────

function RoleBadge({ agent }) {
  if (!agent?.department) return null;
  return (
    <span
      className="inline-flex items-center font-medium emil-pill-enter"
      style={{
        fontSize: '12px',
        lineHeight: '1',
        padding: '3px 8px',
        borderRadius: 'var(--radius-full)',
        color: 'var(--text-tertiary)',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {agent.department}
    </span>
  );
}

// ─────────────────────────────────────────────────────────
// 单条消息气泡（支持选中、右键）
// ─────────────────────────────────────────────────────────

function MessageBubbleImpl({ message, isSelectMode, isSelected, isExiting, onToggleSelect, onContextMenu, onImageClick }) {
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

  // 用户消息气泡样式：液态玻璃（rgba 0.68 + backdrop-filter blur 20px saturate 160%）+ 6px 圆角
  const userBubbleStyle = {
    background: 'rgba(25, 26, 27, 0.68)',
    backdropFilter: 'blur(20px) saturate(160%)',
    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 12px',
    color: 'var(--text-primary)',
  };

  return (
    <div
      className={`flex gap-3 group relative emil-msg-enter ${isExiting ? 'emil-msg-exit' : ''} ${isUser ? 'flex-row-reverse' : 'flex-row'} ${
        isSelectMode ? 'cursor-pointer' : ''
      }`}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
    >
      {/* 多选复选框 */}
      {isSelectMode && (
        <div className="shrink-0 flex items-center">
          <div
            className="w-5 h-5 rounded flex items-center justify-center transition-colors"
            style={{
              border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border-default)'}`,
              background: isSelected ? 'var(--accent)' : 'transparent',
            }}
          >
            {isSelected && (
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* 头像：用户无头像（右对齐纯气泡）；Agent 左侧 32px 圆形小头像 */}
      {/* emil-avatar-hover：hover 时 scale 1.05（仅 hover+fine 指针生效） */}
      {!isUser && (
        <div className="shrink-0 emil-avatar-hover" style={{ width: '32px', height: '32px' }}>
          <AgentAvatar
            avatar={agent?.avatar}
            fallback=""
            size="sm"
            bgClass=""
            bgStyle={getAgentAvatarStyle(agent)}
            className="!w-8 !h-8 !rounded-full"
          />
        </div>
      )}

      {/* 消息内容 */}
      <div className={`flex flex-col ${isUser ? 'items-end max-w-[70%]' : 'items-start max-w-[85%]'}`}>
        {/* 头部行：名字 + 角色标签 + 时间戳 */}
        <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <span
            className="font-medium"
            style={{
              fontSize: '15px',
              fontWeight: 510,
              color: 'var(--text-primary)',
            }}
          >
            {isUser ? (bossConfig.name || '我') : agent?.name ?? message.senderId}
          </span>
          {!isUser && <RoleBadge agent={agent} />}
          <span style={{ fontSize: '12px', color: 'var(--text-quaternary)' }}>
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
                className="block overflow-hidden transition-all cursor-pointer"
                style={{
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(94, 106, 210, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'none';
                }}
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
              /* 用户消息：半透明 var(--bg-surface) 气泡，无头像，右对齐 */
              <div style={userBubbleStyle}>
                <p
                  className="whitespace-pre-wrap break-words"
                  style={{ fontSize: '16px', lineHeight: '1.6' }}
                >
                  {message.content || (message.status === 'sending' ? '…' : '')}
                </p>
              </div>
            ) : (
              /* Agent 消息：无气泡背景，支持工具卡片交错渲染 */
              <AgentMessageContent message={message} />
            )}
          </>
        )}

        {message.status === 'sending' && (
          <span className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>发送中…</span>
        )}
        {message.status === 'error' && (
          <span className="text-xs mt-1" style={{ color: 'var(--color-danger, #ef4444)' }}>发送失败</span>
        )}
      </div>

      {/* 选中态高亮：emil-selected-bg 用 opacity 过渡（data-active='true' 显示），保留细边框 */}
      {isSelected && (
        <div
          className="absolute inset-0 -mx-2 -my-1 pointer-events-none"
          style={{
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div
            className="absolute inset-0 rounded-[var(--radius-md)] emil-selected-bg"
            data-active="true"
            style={{ background: 'rgba(94, 106, 210, 0.06)' }}
          />
        </div>
      )}
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
    prev.isSelected === next.isSelected &&
    prev.isExiting === next.isExiting
  );
}

const MessageBubble = memo(MessageBubbleImpl, messageBubbleAreEqual);

export default MessageBubble;
