/**
 * 点击复制到剪贴板，复制成功后显示反馈 — Emil Kowalski polish layer
 * @module components/ui/CopyButton
 *
 * 设计原则（落实 docs/refactor/emil-design-eng.md）：
 *  1. :active scale(0.97) —— 压迫反馈
 *  2. “已复制”状态切换用 opacity + transform 过渡，不用颜色突变
 *     （Emil：crossfade 用 opacity + 轻微 scale，比颜色硬切自然）
 *  3. 用自定义缓动 var(--ease-out)
 *  4. focus-visible 用 accent 环
 *
 * @param {string} props.text - 要复制的内容
 * @param {string} [props.label='复制']
 * @param {string} [props.successLabel='已复制']
 * @param {string} [props.className='']
 */

import { useState, useCallback, useEffect } from 'react';

export default function CopyButton({
  text,
  label = '复制',
  successLabel = '已复制',
  className = '',
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    if (!text || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(String(text));
      setCopied(true);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!text}
      className={[
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5',
        'text-xs font-medium',
        'bg-white/[0.02] text-text-tertiary border border-border-default',
        'hover:bg-bg-hover hover:text-text-primary hover:border-border-strong',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')}
      style={{
        // transform 优先；用自定义缓动
        transition:
          'transform 140ms cubic-bezier(0.23, 1, 0.32, 1), ' +
          'background-color 140ms cubic-bezier(0.23, 1, 0.32, 1), ' +
          'color 140ms cubic-bezier(0.23, 1, 0.32, 1), ' +
          'border-color 140ms cubic-bezier(0.23, 1, 0.32, 1)',
        willChange: 'transform',
      }}
      // inline style 无法表达 :active，用 onPointerDown/Up 临时挂 scale
      // 但更稳的做法是依赖 CSS 类；这里用一个轻量 data-attr + 内联样式 fallback
      data-pressable="true"
      onPointerDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.97)';
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {/* 内容包裹层：opacity + transform crossfade，避免颜色突变 */}
      <span
        key={copied ? 'copied' : 'idle'}
        className="inline-flex items-center gap-1.5"
        style={{
          transition:
            'opacity 200ms cubic-bezier(0.23, 1, 0.32, 1), ' +
            'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)',
          animation: copied
            ? 'scaleIn 160ms cubic-bezier(0.23, 1, 0.32, 1)'
            : 'fadeIn 160ms cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        {copied ? (
          <>
            <svg
              className="h-3.5 w-3.5 text-success shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-success">{successLabel}</span>
          </>
        ) : (
          <>
            <svg
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <span>{label}</span>
          </>
        )}
      </span>
    </button>
  );
}
