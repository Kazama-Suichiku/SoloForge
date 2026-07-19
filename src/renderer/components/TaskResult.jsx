/**
 * SoloForge - 任务结果组件
 * 分区展示：原始内容、审阅后内容、建议列表；支持复制；错误状态展示
 * Linear 风格：.card 分区 + .code-block（var(--font-mono)）+ accent 列表点。
 * @module components/TaskResult
 */

import { useState } from 'react';
import CopyButton from './ui/CopyButton';

function ResultSection({ title, content, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const hasContent = content && String(content).trim().length > 0;

  if (!hasContent) return null;

  return (
    <div className="card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
        <span className="font-ui text-sm text-text-primary">{title}</span>
        <div className="flex items-center gap-2">
          <CopyButton text={String(content)} />
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="btn-ghost px-2 py-1 text-xs"
          >
            {collapsed ? '展开' : '收起'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="px-4 py-3">
          <pre className="code-block max-h-64 overflow-auto">
            {String(content)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function TaskResult({ task }) {
  if (!task) return null;

  const { status, result, error } = task;

  if (status === 'error') {
    return (
      <div
        className="card"
        style={{ borderColor: 'var(--color-danger)', backgroundColor: 'rgba(248,113,113,0.06)' }}
      >
        <div className="px-4 py-3 border-b border-border-default" style={{ borderColor: 'rgba(248,113,113,0.2)' }}>
          <span className="font-ui text-sm text-text-primary">执行失败</span>
        </div>
        <div className="px-4 py-3">
          <p className="text-sm text-text-secondary">{error ?? '未知错误'}</p>
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="card">
        <div className="px-4 py-3">
          <p className="text-sm text-text-secondary">任务已取消</p>
        </div>
      </div>
    );
  }

  if (status !== 'completed' || !result?.output) {
    return null;
  }

  const output = result.output;
  const hasReview = 'originalContent' in output || 'reviewedContent' in output;
  const originalContent = output.originalContent ?? output.content ?? '';
  const reviewedContent =
    output.reviewedContent ?? (hasReview ? '' : output.content ?? '');
  const suggestions = Array.isArray(output.suggestions) ? output.suggestions : [];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-ui text-text-primary">执行结果</h3>
      <div className="space-y-3">
        <ResultSection
          title={hasReview ? '原始内容' : '生成内容'}
          content={originalContent}
        />
        {hasReview && (
          <ResultSection title="审阅后内容" content={reviewedContent} />
        )}
        {suggestions.length > 0 && (
          <div className="card">
            <div className="px-4 py-3 border-b border-border-default">
              <span className="font-ui text-sm text-text-primary">建议列表</span>
            </div>
            <div className="px-4 py-3">
              <ul className="space-y-2">
                {suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: 'var(--accent)' }}
                    />
                    <span className="text-sm text-text-primary">
                      {String(s)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
