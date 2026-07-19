/**
 * SoloForge - 报告查看器
 * 在弹窗中显示 Agent 生成的 HTML 报告。Linear 风格：.panel 容器 + var(--font-mono)。
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

      {/* 报告窗口：.panel */}
      <div className="panel relative shadow-dialog w-[90vw] h-[90vh] max-w-6xl flex flex-col overflow-hidden animate-scale-in">
        {/* 工具栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-bg-panel">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <span className="font-ui text-sm text-text-primary">
              报告查看器
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleOpenInBrowser} className="btn-ghost">
              在浏览器中打开
            </button>
            <button
              onClick={onClose}
              className="btn-ghost p-1.5"
              aria-label="关闭"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full text-text-secondary">
              加载中...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-danger">
              {error}
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
      className="btn-ghost my-2"
    >
      <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
      <span className="text-accent">
        {title || '查看报告'}
      </span>
      <svg className="w-3.5 h-3.5 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </button>
  );
}
