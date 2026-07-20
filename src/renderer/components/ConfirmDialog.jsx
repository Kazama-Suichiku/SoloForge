/**
 * SoloForge - 确认对话框组件
 * 用于工具执行前的用户确认。Linear 风格：.surface + 多层阴影 + .btn-primary/.btn-ghost。
 * @module components/ConfirmDialog
 */
import { useEffect, useCallback, useState, useRef } from 'react';

/** 退场动画时长（ms）—— 与 .glass-exit transition 一致 */
const EXIT_DURATION = 200;

/**
 * 确认对话框
 * @param {Object} props
 * @param {boolean} props.isOpen - 是否显示
 * @param {string} props.title - 标题
 * @param {string} props.message - 消息内容
 * @param {string} [props.details] - 详细信息
 * @param {'info' | 'warning' | 'danger'} [props.type] - 类型
 * @param {() => void} props.onConfirm - 确认回调
 * @param {() => void} props.onCancel - 取消回调
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  details,
  type = 'warning',
  onConfirm,
  onCancel,
}) {
  // isExiting：退场动画期间为 true，动画结束后才真正卸载/回调
  const [isExiting, setIsExiting] = useState(false);
  const exitTimerRef = useRef(null);

  // 真正执行回调（退场动画结束后调用）
  const fireCancel = useCallback(() => {
    setIsExiting(false);
    onCancel?.();
  }, [onCancel]);

  const fireConfirm = useCallback(() => {
    setIsExiting(false);
    onConfirm?.();
  }, [onConfirm]);

  // 触发退场动画：先设 isExiting=true，EXIT_DURATION 后真正执行回调
  const startExit = useCallback(
    (confirm) => {
      if (exitTimerRef.current) return; // 防止重复触发
      setIsExiting(true);
      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = null;
        if (confirm) fireConfirm();
        else fireCancel();
      }, EXIT_DURATION);
    },
    [fireConfirm, fireCancel]
  );

  // ESC 键关闭（触发退场）
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        startExit(false);
      }
    },
    [startExit]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // 卸载时清理定时器，避免回调在组件已卸载后触发
  useEffect(() => {
    return () => {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, []);

  // isOpen 从 true→false 时（外部直接关闭），直接回调，不播退场
  useEffect(() => {
    if (!isOpen && isExiting) {
      setIsExiting(false);
    }
  }, [isOpen, isExiting]);

  if (!isOpen) return null;

  // 类型 → 标签色点颜色
  const dotColor =
    type === 'danger' ? 'var(--color-danger)' :
    type === 'info' ? 'var(--accent)' :
    'var(--color-warning)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩：退场时 opacity 同步淡出 */}
      <div
        className={`absolute inset-0 bg-[rgba(0,0,0,0.5)] backdrop-blur-sm${isExiting ? ' glass-scrim-exit' : ''}`}
        onClick={() => startExit(false)}
      />

      {/* 对话框：.surface + .glass-enter（materialize：blur+scale 同步入场）+ .modal-center（center origin）
          退场：isExiting 时叠加 .glass-exit（scale 0.97 + opacity 0，200ms，对称逆向路径） */}
      <div
        className={`relative surface glass-enter rounded-xl shadow-dialog modal-center max-w-md w-full mx-4 overflow-hidden${isExiting ? ' glass-exit' : ''}`}
      >
        {/* 头部：色点 + 标题 */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-border-default">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
            aria-hidden="true"
          />
          <h3 className="text-base font-ui text-text-primary">
            {title}
          </h3>
        </div>

        {/* 内容 */}
        <div className="px-6 py-5">
          <p className="text-sm text-text-secondary">{message}</p>

          {details && (
            <pre className="code-block mt-3 text-xs whitespace-pre-wrap break-words">
              {details}
            </pre>
          )}
        </div>

        {/* 按钮 */}
        <div className="px-6 py-5 flex justify-end gap-3">
          <button onClick={() => startExit(false)} className="btn-ghost">
            取消
          </button>
          <button
            onClick={() => startExit(true)}
            className="btn-primary"
            style={type === 'danger' ? { backgroundColor: 'var(--color-danger)' } : undefined}
          >
            确认执行
          </button>
        </div>
      </div>

      {/* 局部退场动画样式（不污染全局 CSS）：
          .glass-exit：与 .glass-enter 的 scale(0.95)→1 对称的逆向 1→0.97 + opacity 1→0；
          .glass-scrim-exit：遮罩同步淡出。
          prefers-reduced-motion 已由 globals.css 全局降级（transform:none，保留 opacity）。 */}
      <style>{`
        .glass-exit {
          transform: scale(0.97);
          opacity: 0;
          transition: opacity ${EXIT_DURATION}ms cubic-bezier(0.23, 1, 0.32, 1),
                      transform ${EXIT_DURATION}ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .glass-scrim-exit {
          opacity: 0;
          transition: opacity ${EXIT_DURATION}ms cubic-bezier(0.23, 1, 0.32, 1);
        }
      `}</style>
    </div>
  );
}
