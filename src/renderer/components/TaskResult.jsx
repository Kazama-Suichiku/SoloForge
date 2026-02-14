/**
 * SoloForge - 任务结果组件
 * 分区展示：原始内容、审阅后内容、建议列表；支持复制；错误状态展示
 * @module components/TaskResult
 */

import { useState } from 'react';
import Card from './ui/Card';
import CopyButton from './ui/CopyButton';

function ResultSection({ title, content, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const hasContent = content && String(content).trim().length > 0;

  if (!hasContent) return null;

  return (
    <Card
      header={
        <div className="flex items-center justify-between w-full pr-2">
          <span>{title}</span>
          <div className="flex items-center gap-2">
            <CopyButton text={String(content)} />
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
            >
              {collapsed ? '展开' : '收起'}
            </button>
          </div>
        </div>
      }
      body={
        !collapsed ? (
          <pre className="code-block max-h-64 overflow-auto">
            {String(content)}
          </pre>
        ) : null
      }
    />
  );
}

export default function TaskResult({ task }) {
  if (!task) return null;

  const { status, result, error } = task;

  if (status === 'error') {
    return (
      <Card
        header="执行失败"
        body={
          <p className="text-sm text-[var(--text-secondary)]">{error ?? '未知错误'}</p>
        }
        className="border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10"
      />
    );
  }

  if (status === 'cancelled') {
    return (
      <Card
        body={<p className="text-sm text-[var(--text-secondary)]">任务已取消</p>}
      />
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
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">执行结果</h3>
      <div className="space-y-3">
        <ResultSection
          title={hasReview ? '原始内容' : '生成内容'}
          content={originalContent}
        />
        {hasReview && (
          <ResultSection title="审阅后内容" content={reviewedContent} />
        )}
        {suggestions.length > 0 && (
          <Card
            header="建议列表"
            body={
              <ul className="space-y-2">
                {suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
                    <span className="text-sm text-[var(--text-primary)]">
                      {String(s)}
                    </span>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </div>
    </div>
  );
}
