/**
 * 通用卡片组件 — Emil Kowalski polish layer
 * @module components/ui/Card
 *
 * 设计原则（落实 docs/refactor/emil-design-eng.md）：
 *  1. hover 用 transform: translateY(-1px) 微上浮 + border-color 过渡
 *  2. 绝不用 box-shadow 动画（触发 layout/paint）
 *  3. hoverable prop 控制是否启用 hover 反馈
 *  4. 折叠/展开用 opacity 过渡（非 height），保留可读性
 *
 * @param {React.ReactNode} [props.header]
 * @param {React.ReactNode} [props.body]
 * @param {React.ReactNode} [props.footer]
 * @param {boolean} [props.collapsible=false]
 * @param {boolean} [props.defaultCollapsed=false]
 * @param {boolean} [props.hoverable=false]  是否启用 hover 微上浮
 */

import { useState } from 'react';

export default function Card({
  header,
  body,
  footer,
  collapsible = false,
  defaultCollapsed = false,
  hoverable = false,
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
      className={[
        // 基础卡：来自 globals.css 的 .card（内建 transform + border-color 过渡）
        'card',
        // hoverable 时挂上 .card-hover:hover（translateY(-1px) + border）
        hoverable ? 'card-hover' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')}
    >
      {hasHeader && (
        <div className="flex items-center justify-between -mx-4 -mt-4 px-4 py-3 border-b border-border-default">
          <div className="flex-1 font-ui text-sm text-text-primary">{header}</div>
          {collapsible && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="ml-2 rounded-md px-2 py-1 text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-expanded={!collapsed}
            >
              {collapsed ? '展开' : '收起'}
            </button>
          )}
        </div>
      )}

      {hasBody && (!collapsible || !collapsed) && (
        <div
          className={hasHeader ? 'mt-4' : ''}
          style={{
            // 折叠/展开用 opacity 过渡（非 height），保留可读性
            transition: 'opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)',
          }}
        >
          {content}
        </div>
      )}

      {hasFooter && (!collapsible || !collapsed) && (
        <div className="mt-4 -mx-4 -mb-4 px-4 py-2 border-t border-border-default bg-white/[0.01] text-sm text-text-secondary">
          {footer}
        </div>
      )}
    </div>
  );
}
