/**
 * SoloForge - 同步进度条
 *
 * 由于主进程 cloud-sync 未发布 sync:progress 事件（已确认 preload 无对应通道），
 * 本组件表现为「同步中」的不确定进度条（indeterminate），而非精确百分比。
 *
 * 使用方式：
 *   <SyncProgressBar active={syncing} label="正在同步..." />
 *
 * @module components/sync/SyncProgressBar
 */

import React from 'react';

/**
 * @param {Object} props
 * @param {boolean} props.active - 是否正在同步
 * @param {string} [props.label] - 同步中显示的文字
 * @param {string} [props.className] - 额外 className
 */
export default function SyncProgressBar({ active, label = '正在同步...', className = '' }) {
  if (!active) return null;
  return (
    <div className={`w-full ${className}`} role="status" aria-live="polite">
      <div className="flex items-center gap-2 mb-1 text-xs text-[var(--text-secondary)]">
        <svg
          className="w-3.5 h-3.5 animate-spin text-[var(--color-primary)]"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12" cy="12" r="10"
            stroke="currentColor" strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <span>{label}</span>
      </div>
      <div className="w-full h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--color-primary)] rounded-full"
          style={{
            width: '40%',
            animation: 'sync-progress-slide 1.2s ease-in-out infinite',
          }}
        />
      </div>
      <style>{`
        @keyframes sync-progress-slide {
          0%   { transform: translateX(-100%); width: 40%; }
          50%  { transform: translateX(150%); width: 60%; }
          100% { transform: translateX(250%); width: 40%; }
        }
      `}</style>
    </div>
  );
}
