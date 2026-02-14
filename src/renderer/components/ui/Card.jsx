/**
 * 通用卡片组件
 * @module components/ui/Card
 * @param {Object} props
 * @param {React.ReactNode} [props.header]
 * @param {React.ReactNode} [props.body]
 * @param {React.ReactNode} [props.footer]
 * @param {boolean} [props.collapsible=false]
 * @param {boolean} [props.defaultCollapsed=false]
 */

import { useState } from 'react';

export default function Card({
  header,
  body,
  footer,
  collapsible = false,
  defaultCollapsed = false,
  className = '',
  children,
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const hasHeader = header != null;
  const hasBody = body != null || children;
  const hasFooter = footer != null;

  const content = body ?? children;

  return (
    <div
      className={`
        rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)]
        overflow-hidden shadow-[var(--shadow-sm)]
        transition-theme
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {hasHeader && (
        <div
          className={`
            flex items-center justify-between px-4 py-3
            border-b border-[var(--border-color)]
            bg-[var(--bg-elevated)] text-[var(--text-primary)]
          `}
        >
          <div className="flex-1 font-medium text-sm">{header}</div>
          {collapsible && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="ml-2 rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              aria-expanded={!collapsed}
            >
              {collapsed ? '展开' : '收起'}
            </button>
          )}
        </div>
      )}

      {hasBody && (!collapsible || !collapsed) && (
        <div className="border-t border-[var(--border-color)] px-4 py-3">
          {content}
        </div>
      )}

      {hasFooter && (!collapsible || !collapsed) && (
        <div
          className="
            border-t border-[var(--border-color)]
            px-4 py-2 bg-[var(--bg-elevated)]
            text-sm text-[var(--text-secondary)]
          "
        >
          {footer}
        </div>
      )}
    </div>
  );
}
