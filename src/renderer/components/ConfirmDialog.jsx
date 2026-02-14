/**
 * SoloForge - 确认对话框组件
 * 用于工具执行前的用户确认
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

  const typeStyles = {
    info: {
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      icon: '💡',
      iconBg: 'bg-blue-100 dark:bg-blue-900',
      confirmBtn: 'bg-blue-600 hover:bg-blue-700',
    },
    warning: {
      bg: 'bg-yellow-50 dark:bg-yellow-900/20',
      icon: '⚠️',
      iconBg: 'bg-yellow-100 dark:bg-yellow-900',
      confirmBtn: 'bg-yellow-600 hover:bg-yellow-700',
    },
    danger: {
      bg: 'bg-red-50 dark:bg-red-900/20',
      icon: '🚨',
      iconBg: 'bg-red-100 dark:bg-red-900',
      confirmBtn: 'bg-red-600 hover:bg-red-700',
    },
  };

  const styles = typeStyles[type] || typeStyles.warning;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* 对话框 */}
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* 头部 */}
        <div className={`px-6 py-4 ${styles.bg}`}>
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full ${styles.iconBg} flex items-center justify-center text-xl`}
            >
              {styles.icon}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {title}
            </h3>
          </div>
        </div>

        {/* 内容 */}
        <div className="px-6 py-4">
          <p className="text-gray-700 dark:text-gray-300">{message}</p>

          {details && (
            <div className="mt-3 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <pre className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words font-mono">
                {details}
              </pre>
            </div>
          )}
        </div>

        {/* 按钮 */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700
                       rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-white rounded-lg transition-colors ${styles.confirmBtn}`}
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
