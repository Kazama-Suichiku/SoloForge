// ─────────────────────────────────────────────────────────────
// Dashboard 基础 UI 组件 —— Linear 风格
// 全部使用 CSS 变量（--bg-* / --text-* / --accent / --border-*），
// 不依赖任何 Tailwind 动态颜色类，无硬编码颜色。
// ─────────────────────────────────────────────────────────────
import { ChevronRightIcon, ChevronLeftIcon } from '@heroicons/react/24/outline';

/** 展开/收起箭头 —— 极细，text-tertiary */
export function ChevronIcon({ expanded }) {
  return (
    <ChevronRightIcon
      className={`w-3.5 h-3.5 text-text-tertiary transition-transform duration-fast ease-out-quart ${
        expanded ? 'rotate-90' : ''
      }`}
    />
  );
}

/** 详情字段：紧凑标签 + 值 */
export function DetailField({ label, value, className = '' }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={className}>
      <span className="text-xs text-text-quaternary leading-none">{label}</span>
      <p className="text-sm text-text-secondary mt-1 leading-snug">{value}</p>
    </div>
  );
}

/** 统一空状态：居中一句，无 emoji 装饰 */
export function EmptyState({ icon: Icon, message, hint }) {
  return (
    <div className="flex flex-col items-center justify-center py-10">
      {Icon && <Icon className="w-4 h-4 mb-2 text-text-quaternary" />}
      <p className="text-sm text-text-tertiary">{message}</p>
      {hint && <p className="text-xs mt-1 text-text-quaternary">{hint}</p>}
    </div>
  );
}

/** 统一分页控件 —— 紧凑、accent 选中态 */
export function Pagination({ current, total, onChange, itemCount }) {
  if (total <= 1) {
    if (itemCount > 0) {
      return (
        <div className="mt-3 pt-3 border-t border-border-subtle">
          <span className="text-xs text-text-quaternary">共 {itemCount} 条</span>
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
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-subtle">
      <span className="text-xs text-text-quaternary">
        共 {itemCount} 条 · 第 {current}/{total} 页
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, current - 1))}
          disabled={current <= 1}
          className="emil-pressable p-1 rounded-sm transition-colors-fast disabled:opacity-30 disabled:cursor-not-allowed text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
        </button>
        {pages.map((item, i) =>
          item === '...' ? (
            <span key={`e-${i}`} className="px-1 text-xs text-text-quaternary">…</span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onChange(item)}
              className={`emil-pressable min-w-[24px] h-6 px-1.5 text-xs rounded-sm transition-colors-fast ${
                item === current
                  ? 'bg-accent text-white font-ui'
                  : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
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
          className="emil-pressable p-1 rounded-sm transition-colors-fast disabled:opacity-30 disabled:cursor-not-allowed text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
        >
          <ChevronRightIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/** 进度条 —— 默认 accent 半透明，可语义色；用 transform: scaleX 走 GPU */
export function ProgressBar({ value, max = 100, size = 'md', tone = 'accent' }) {
  const percentage = Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  const sizeClasses = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' };
  const toneColor = {
    accent: 'var(--accent)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    danger: 'var(--color-danger)',
  };
  const color = toneColor[tone] || toneColor.accent;

  return (
    <div
      className={`w-full rounded-full overflow-hidden ${sizeClasses[size]}`}
      style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
    >
      <div
        className={`${sizeClasses[size]} rounded-full`}
        style={{
          // Emil: 只动 transform/opacity；scaleX 走 GPU，transform-origin 左对齐
          backgroundColor: color,
          width: '100%',
          transform: `scaleX(${percentage / 100})`,
          transformOrigin: 'left center',
          transition: 'transform 280ms cubic-bezier(0.23,1,0.32,1)',
          willChange: 'transform',
        }}
      />
    </div>
  );
}

/** 状态圆点 —— 极小，用于行内状态指示 */
export function StatusDot({ tone = 'neutral' }) {
  const toneClasses = {
    neutral: 'bg-text-quaternary',
    accent: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  };
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${toneClasses[tone] || toneClasses.neutral}`} />;
}

/** Pill badge —— 紧凑状态标签 */
export function Badge({ tone = 'neutral', children, className = '' }) {
  const toneClasses = {
    neutral: 'text-text-tertiary',
    accent: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-xs font-ui leading-none rounded-full whitespace-nowrap ${toneClasses[tone] || toneClasses.neutral} ${className}`}
      style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
    >
      {children}
    </span>
  );
}

/** 统计卡片 —— 紧凑，大数字 32px weight 590，负字距 -0.022em，无彩条 */
export function StatCard({ title, value, subtitle, tone = 'neutral' }) {
  const dotTone = ['accent', 'success', 'warning', 'danger'].includes(tone) ? tone : 'neutral';
  return (
    <div className="card card-hover flex flex-col gap-1.5 !p-4">
      <div className="flex items-center gap-1.5">
        <StatusDot tone={dotTone} />
        <p className="text-xs text-text-tertiary leading-none">{title}</p>
      </div>
      <p
        className="text-[32px] font-title leading-none text-text-primary"
        style={{ letterSpacing: '-0.022em', fontWeight: 590 }}
      >
        {value}
      </p>
      {subtitle && <p className="text-xs text-text-quaternary leading-snug">{subtitle}</p>}
    </div>
  );
}

/** 面板容器 —— 半透明背景 + 细边框，分区标题 15px weight 590 / -0.012em */
export function Panel({ title, trailing, children, className = '' }) {
  return (
    <div className={`panel ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
          <h3
            className="text-[15px] font-title tracking-tighter text-text-primary"
            style={{ fontWeight: 590, letterSpacing: '-0.012em' }}
          >
            {title}
          </h3>
          {trailing && <span className="text-xs text-text-quaternary font-ui">{trailing}</span>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}
