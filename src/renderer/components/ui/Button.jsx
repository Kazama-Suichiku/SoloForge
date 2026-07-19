/**
 * 通用按钮组件 — Emil Kowalski polish layer
 * @module components/ui/Button
 *
 * 设计原则（落实 docs/refactor/emil-design-eng.md）：
 *  1. 所有变体 :active 都 scale(0.97) —— 即时压迫反馈
 *     （由 globals.css 的 .btn-primary/.btn-ghost/.btn-danger 提供）
 *  2. transition 分开声明：transform 优先（GPU），background-color 次之
 *  3. 用自定义缓动 var(--ease-out)，而非默认 ease
 *  4. 时长 140ms（按钮区间 100-160ms）
 *  5. loading 态不阻塞：spinner 显示但按钮仍可点击（由调用方决定 disabled）
 *  6. focus-visible 用 accent 环，而非 hover 态放大
 *
 * @param {'primary'|'ghost'|'danger'} [props.variant='primary']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.loading=false]
 * @param {boolean} [props.disabled=false]
 * @param {boolean} [props.fullWidth=false]
 */

// 映射到 globals.css 的组件类（这些类已内建 :active scale(0.97) + transition）
const variantBaseClass = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const sizeClasses = {
  sm: 'px-2 py-1 text-xs gap-1.5',
  md: 'px-3 py-1.5 text-sm gap-2',
  lg: 'px-4 py-2 text-base gap-2',
};

const spinnerSize = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  className = '',
  children,
  ...rest
}) {
  // loading 不强制 disabled：spinner 提示进行中，但仍允许中断/重试
  // （Emil：loading 态不阻塞交互；由调用方按需传 disabled）
  const isDisabled = disabled;

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        // 基础变体类（来自 globals.css，内建 :active scale(0.97) + transition）
        variantBaseClass[variant] ?? variantBaseClass.primary,
        // 尺寸覆盖（globals.css 的 .btn-* 用的是 px-3 py-1.5，这里按 size 覆盖）
        sizeClasses[size] ?? sizeClasses.md,
        fullWidth ? 'w-full' : '',
        // focus-visible：accent 环（Emil：不用 hover 放大）
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')}
      {...rest}
    >
      {loading && (
        <svg
          className={['animate-spin shrink-0', spinnerSize[size] ?? spinnerSize.md].join(' ')}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      <span className="inline-flex items-center gap-2">{children}</span>
    </button>
  );
}
