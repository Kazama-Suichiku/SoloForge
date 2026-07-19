import { useState } from 'react';
import { FlagIcon } from '@heroicons/react/24/outline';
import {
  STATUS_TONES,
  STATUS_LABELS,
  GOAL_TYPE_LABELS,
  GOAL_TYPE_TONES,
  PAGE_SIZE,
} from './constants';
import { formatDate } from './utils';
import { ChevronIcon, DetailField, EmptyState, Pagination, ProgressBar, Badge } from './ui';

/**
 * 业务目标列表 —— Linear 风格紧凑行
 * props: { goals: Array }
 */
export default function GoalsList({ goals }) {
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);

  if (!goals.length) {
    return <EmptyState icon={FlagIcon} message="暂无目标" hint="CXO 可以通过对话创建目标" />;
  }

  const totalPages = Math.ceil(goals.length / PAGE_SIZE);
  const display = goals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="space-y-1.5">
        {display.map((goal) => {
          const isExpanded = expandedId === goal.id;
          return (
            <div
              key={goal.id}
              className={`group relative rounded-md border transition-colors-fast ${
                isExpanded
                  ? 'bg-bg-hover border-border-default'
                  : 'border-border-subtle hover:border-border-default'
              }`}
            >
              {/* Emil: hover 用 opacity 背景层（不触发 background-color 重绘） */}
              {!isExpanded && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: 'var(--bg-hover)' }}
                />
              )}
              <button
                type="button"
                className="relative w-full p-3 text-left"
                onClick={() => setExpandedId(isExpanded ? null : goal.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <ChevronIcon expanded={isExpanded} />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-ui text-text-primary truncate">{goal.title}</h4>
                      <p className="text-xs text-text-tertiary mt-0.5 truncate">
                        {goal.owner} · {goal.department || '未分配部门'}
                      </p>
                    </div>
                  </div>
                  <Badge tone={STATUS_TONES[goal.status] || 'neutral'}>
                    {STATUS_LABELS[goal.status] || goal.status}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center gap-2 pl-6">
                  <ProgressBar
                    value={goal.progress}
                    size="sm"
                    tone={goal.progress >= 80 ? 'success' : 'accent'}
                  />
                  <span className="text-xs text-text-tertiary whitespace-nowrap font-mono">{goal.progress}%</span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-2 ml-6 mr-3 border-t border-border-subtle">
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    {goal.type && (
                      <div>
                        <span className="text-xs text-text-quaternary">类型</span>
                        <div className="mt-1">
                          <Badge tone={GOAL_TYPE_TONES[goal.type] || 'neutral'}>
                            {GOAL_TYPE_LABELS[goal.type] || goal.type}
                          </Badge>
                        </div>
                      </div>
                    )}
                    <DetailField label="截止日期" value={formatDate(goal.dueDate)} />
                    <DetailField label="创建时间" value={formatDate(goal.createdAt)} />
                    <DetailField label="更新时间" value={formatDate(goal.updatedAt)} />
                  </div>

                  {goal.description && (
                    <div className="mt-3">
                      <span className="text-xs text-text-quaternary">描述</span>
                      <p className="text-sm text-text-secondary mt-1 whitespace-pre-wrap leading-snug">
                        {goal.description}
                      </p>
                    </div>
                  )}

                  {Array.isArray(goal.keyResults) && goal.keyResults.length > 0 && (
                    <div className="mt-3">
                      <span className="text-xs text-text-quaternary">关键结果（KR）</span>
                      <ul className="mt-1 space-y-1">
                        {goal.keyResults.map((kr, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-text-secondary">
                            <span className="text-text-quaternary shrink-0">·</span>
                            <span>{typeof kr === 'string' ? kr : JSON.stringify(kr)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pagination current={page} total={totalPages} onChange={setPage} itemCount={goals.length} />
    </div>
  );
}
