// ─────────────────────────────────────────────────────────────
// Dashboard 基础 UI 组件
// ─────────────────────────────────────────────────────────────
import { ChevronRightIcon, ChevronLeftIcon } from '@heroicons/react/24/outline';
import { STAT_BAR_COLORS } from './constants';

/** 展开/收起箭头 */
export function ChevronIcon({ expanded }) {
  return (
    <ChevronRightIcon
      className={`w-4 h-4 text-text-muted transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
    />
  );
}

/** 详情字段 */
export function DetailField({ label, value, className = '' }) {
  if (!value) return null;
  return (
    <div className={className}>
      <span className="text-xs text-text-muted">{label}</span>
      <p className="text-sm text-text-primary mt-0.5">{value}</p>
    </div>
  );
}

/** 统一空状态 */
export function EmptyState({ icon: Icon, message, hint }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-text-muted">
      {Icon && <Icon className="w-8 h-8 mb-2 opacity-40" />}
      <p className="text-sm">{message}</p>
      {hint && <p className="text-xs mt-1 opacity-70">{hint}</p>}
    </div>
  );
}

/** 统一分页控件 */
export function Pagination({ current, total, onChange, itemCount }) {
  if (total <= 1) {
    if (itemCount > 0) {
      return (
        <div className="mt-3 text-center">
          <span className="text-xs text-text-muted">共 {itemCount} 条</span>
        </div>
      );
    }
    return null;
  }

  const pages = Array.from({ length: total }, (_, i) => i + 1)
    .filter((p) => {
      if (total <= 5) return true;
      if (p === 1 || p === total) return true;
      return Math.abs(p - current) <= 1;
    })
    .reduce((acc, p, i, arr) => {
      if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
      acc.push(p);
      return acc;
    }, []);

  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border-color)]/50">
      <span className="text-xs text-text-muted">
        共 {itemCount} 条，第 {current}/{total} 页
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, current - 1))}
          disabled={current <= 1}
          className="p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:bg-[var(--bg-hover)]"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        {pages.map((item, i) =>
          item === '...' ? (
            <span key={`e-${i}`} className="px-1 text-xs text-text-muted">...</span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onChange(item)}
              className={`w-6 h-6 text-xs rounded transition-colors ${
                item === current
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium'
                  : 'text-text-secondary hover:bg-[var(--bg-hover)]'
              }`}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onChange(Math.min(total, current + 1))}
          disabled={current >= total}
          className="p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:bg-[var(--bg-hover)]"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** 进度条 */
export function ProgressBar({ value, max = 100, size = 'md', color = 'blue' }) {
  const percentage = Math.min(100, Math.round((value / max) * 100));
  const sizeClasses = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' };
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
  };

  return (
    <div className={`w-full bg-bg-muted rounded-full ${sizeClasses[size]}`}>
      <div
        className={`${colorClasses[color]} ${sizeClasses[size]} rounded-full transition-all duration-300`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

/** 统计卡片 -- 左侧彩条 + 纯数字，无图标方块 */
export function StatCard({ title, value, subtitle, color = 'blue' }) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-[var(--border-color)] p-4 flex gap-3 overflow-hidden relative">
      {/* 左侧彩条 */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${STAT_BAR_COLORS[color]}`} />
      <div className="pl-2">
        <p className="text-xs text-text-secondary leading-none">{title}</p>
        <p className="text-2xl font-semibold text-text-primary mt-1.5 leading-none">{value}</p>
        {subtitle && (
          <p className="text-xs text-text-muted mt-1.5 leading-snug">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

/** 面板容器 -- 统一卡片外观 */
export function Panel({ title, trailing, children, className = '' }) {
  return (
    <div className={`bg-bg-elevated rounded-xl border border-[var(--border-color)] ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]/60">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {trailing && <span className="text-xs text-text-muted">{trailing}</span>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}
