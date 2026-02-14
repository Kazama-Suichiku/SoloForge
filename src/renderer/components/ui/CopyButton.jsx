/**
 * 点击复制到剪贴板，复制成功后显示反馈
 * @module components/ui/CopyButton
 * @param {Object} props
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
      className={`
        inline-flex items-center gap-1.5 rounded-md px-2 py-1.5
        text-xs font-medium
        bg-[var(--bg-elevated)] text-[var(--text-secondary)]
        hover:bg-[var(--border-color)] hover:text-[var(--text-primary)]
        focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-colors duration-150
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {copied ? (
        <>
          <svg
            className="h-3.5 w-3.5 text-[var(--color-primary)] shrink-0"
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
          <span className="text-[var(--color-primary)]">{successLabel}</span>
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
    </button>
  );
}
