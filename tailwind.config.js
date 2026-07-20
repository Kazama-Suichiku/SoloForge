/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,jsx,ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ===== 背景层级（暗色默认，由 globals.css :root 定义） =====
        'bg-base': 'var(--bg-base)',
        'bg-panel': 'var(--bg-panel)',
        'bg-surface': 'var(--bg-surface)',
        'bg-hover': 'var(--bg-hover)',
        'bg-active': 'var(--bg-active)',

        // ===== 文字四档 =====
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'text-quaternary': 'var(--text-quaternary)',

        // ===== 品牌 accent（靛紫） =====
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-active': 'var(--accent-active)',
        'accent-subtle': 'var(--accent-subtle)',

        // ===== 语义色 =====
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
        'danger-hover': 'var(--color-danger-hover)',

        // ===== 边框 =====
        'border-subtle': 'var(--border-subtle)',
        'border-default': 'var(--border-default)',
        'border-strong': 'var(--border-strong)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        // Apple 连续圆角梯度 20px 档（大容器/模态）。
        // 注意：'2xl' 以数字开头，对象字面量中必须加引号（sucrase 解析器要求），
        // 否则会被当作非法标识符；sm/md/lg/xl 是纯字母故无需引号。
        '2xl': 'var(--radius-2xl)',
      },
      fontFamily: {
        // 系统字体优先（Apple §15：-apple-system = SF Pro on macOS）
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'PingFang SC',
          'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Monaco',
          'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
      },
      // Type Scale：对齐 globals.css --text-* token，替代任意 text-[Npx]。
      // 覆盖 Tailwind 默认 xs=12 / sm=14 / base=16 / lg=18，收紧密度对齐 Linear/Apple HIG。
      // 2xs=10px 仅供非文本徽章/计数器（最低可读，不用于正文）。
      fontSize: {
        '2xs': ['var(--text-2xs)', { lineHeight: '1.2', letterSpacing: '0.01em' }],
        xs: ['var(--text-xs)', { lineHeight: '1.25', letterSpacing: '0.01em' }],
        sm: ['var(--text-sm)', { lineHeight: '1.4' }],
        base: ['var(--text-base)', { lineHeight: '1.5' }],
        lg: ['var(--text-lg)', { lineHeight: '1.5' }],
      },
      fontWeight: {
        // 三档：400 阅读 / 510 UI 强调 / 590 标题
        normal: 400,
        ui: 510,
        title: 590,
      },
      letterSpacing: {
        tightest: '-0.022em', // 48-32px 大标题
        tighter: '-0.012em',   // 24px 中标题
      },
      boxShadow: {
        elevated: 'var(--shadow-elevated)',
        // Apple §12 R3：阴影分 ambient（柔和扩散）+ directional（聚焦偏移）
        ambient: 'var(--shadow-ambient)',
        directional: 'var(--shadow-directional)',
        dialog: 'var(--shadow-dialog)',
      },
      transitionTimingFunction: {
        // 对齐 globals.css 的 --ease-* token，Tailwind class 直接拿到正确曲线
        'ease-out': 'cubic-bezier(0.23, 1, 0.32, 1)',    // = --ease-out（UI 入场）
        'ease-in-out': 'cubic-bezier(0.77, 0, 0.175, 1)', // = --ease-in-out（屏内移动）
        'ease-drawer': 'cubic-bezier(0.32, 0.72, 0, 1)',  // = --ease-drawer（iOS drawer）
        // 保留：四次方 ease-out（与 emil-styles.css 历史用法兼容）
        'ease-out-quart': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      transitionDuration: {
        // 对齐 globals.css 的 --duration-* 分级（Emil 规范）
        fast: '140ms',     // = --duration-press（按钮 :active）
        normal: '200ms',   // = --duration-dropdown（下拉/卡片）
        slow: '280ms',     // = --duration-modal（弹窗）
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.5s ease-out infinite',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
