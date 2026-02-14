/**
 * SoloForge - 报告查看器
 * 在弹窗中显示 Agent 生成的 HTML 报告
 */
import { useState, useEffect, useCallback } from 'react';

/**
 * 报告查看器
 * @param {Object} props
 * @param {boolean} props.isOpen - 是否显示
 * @param {string} props.reportId - 报告 ID
 * @param {() => void} props.onClose - 关闭回调
 */
export default function ReportViewer({ isOpen, reportId, onClose }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !reportId) return;

    const loadReport = async () => {
      setLoading(true);
      setError(null);
      try {
        const html = await window.electronAPI?.getReportContent?.(reportId);
        if (html) {
          setContent(html);
        } else {
          setError('报告不存在或已被删除');
        }
      } catch (err) {
        setError(err.message || '加载报告失败');
      } finally {
        setLoading(false);
      }
    };

    loadReport();
  }, [isOpen, reportId]);

  // ESC 键关闭
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // 在新窗口打开
  const handleOpenInBrowser = useCallback(() => {
    window.electronAPI?.openReportInBrowser?.(reportId);
  }, [reportId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 报告窗口 */}
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[90vw] h-[90vh] max-w-6xl flex flex-col overflow-hidden">
        {/* 工具栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">
              报告查看器
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenInBrowser}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 
                         hover:text-gray-900 dark:hover:text-gray-100
                         bg-gray-200 dark:bg-gray-700 rounded-lg"
            >
              在浏览器中打开
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500">加载中...</div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-500">{error}</div>
            </div>
          ) : (
            <iframe
              srcDoc={content}
              title="报告内容"
              className="w-full h-full border-0"
              sandbox="allow-same-origin"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 报告链接组件
 * 用于在消息中显示可点击的报告链接
 * @param {Object} props
 * @param {string} props.reportId - 报告 ID
 * @param {string} props.title - 报告标题
 * @param {(reportId: string) => void} props.onView - 查看回调
 */
export function ReportLink({ reportId, title, onView }) {
  return (
    <button
      onClick={() => onView?.(reportId)}
      className="inline-flex items-center gap-2 px-3 py-2 my-2 
                 bg-blue-50 dark:bg-blue-900/30 
                 border border-blue-200 dark:border-blue-800
                 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50
                 transition-colors"
    >
      <span className="text-lg">📊</span>
      <span className="text-blue-700 dark:text-blue-300 font-medium">
        {title || '查看报告'}
      </span>
      <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </button>
  );
}
