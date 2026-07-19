/**
 * SoloForge - 确认对话框组件
 * 用于工具执行前的用户确认。Linear 风格：.surface + 多层阴影 + .btn-primary/.btn-ghost。
 * @module components/ConfirmDialog
 */
import { useEffect, useCallback } from 'react';

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
  // ESC 键关闭
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onCancel?.();
      }
    },
    [onCancel]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  // 类型 → 标签色点颜色
  const dotColor =
    type === 'danger' ? 'var(--color-danger)' :
    type === 'info' ? 'var(--accent)' :
    'var(--color-warning)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-[rgba(0,0,0,0.5)] backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* 对话框：.surface + .glass-enter（materialize：blur+scale 同步入场）+ .modal-center（center origin）
          注意：不再叠加 animate-scale-in —— .glass-enter 已包含 scale(0.95)→1 + opacity 入场，
          叠加会触发双重 scale 动画冲突（审计报告 P0-5）。 */}
      <div className="relative surface glass-enter rounded-xl shadow-dialog modal-center max-w-md w-full mx-4 overflow-hidden">
        {/* 头部：色点 + 标题 */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border-default">
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
        <div className="px-6 py-4">
          <p className="text-sm text-text-secondary">{message}</p>

          {details && (
            <pre className="code-block mt-3 text-xs whitespace-pre-wrap break-words">
              {details}
            </pre>
          )}
        </div>

        {/* 按钮 */}
        <div className="px-6 py-4 flex justify-end gap-3">
          <button onClick={onCancel} className="btn-ghost">
            取消
          </button>
          <button
            onClick={onConfirm}
            className="btn-primary"
            style={type === 'danger' ? { backgroundColor: 'var(--color-danger)' } : undefined}
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
