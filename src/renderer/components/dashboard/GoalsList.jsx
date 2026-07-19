import { useState } from 'react';
import { FlagIcon } from '@heroicons/react/24/outline';
import {
  STATUS_COLORS,
  STATUS_LABELS,
  GOAL_TYPE_LABELS,
  GOAL_TYPE_COLORS,
  PAGE_SIZE,
} from './constants';
import { formatDate } from './utils';
import { ChevronIcon, DetailField, EmptyState, Pagination, ProgressBar } from './ui';

/**
 * 业务目标列表
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
      <div className="space-y-2">
        {display.map((goal) => {
          const isExpanded = expandedId === goal.id;
          return (
            <div
              key={goal.id}
              className={`rounded-lg border transition-colors ${
                isExpanded
                  ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
                  : 'bg-bg-muted border-[var(--border-color)] hover:border-[var(--border-color)]'
              }`}
            >
              <button
                type="button"
                className="w-full p-3 text-left"
                onClick={() => setExpandedId(isExpanded ? null : goal.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <ChevronIcon expanded={isExpanded} />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-text-primary truncate">{goal.title}</h4>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {goal.owner} · {goal.department || '未分配部门'}
                      </p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${STATUS_COLORS[goal.status] || STATUS_COLORS.pending}`}>
                    {STATUS_LABELS[goal.status] || goal.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 pl-6">
                  <ProgressBar value={goal.progress} size="sm" color={goal.progress >= 80 ? 'green' : 'blue'} />
                  <span className="text-xs text-text-secondary whitespace-nowrap">{goal.progress}%</span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-6 mr-3">
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    {goal.type && (
                      <div>
                        <span className="text-xs text-text-muted">类型</span>
                        <div className="mt-0.5">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${GOAL_TYPE_COLORS[goal.type] || ''}`}>
                            {GOAL_TYPE_LABELS[goal.type] || goal.type}
                          </span>
                        </div>
                      </div>
                    )}
                    <DetailField label="截止日期" value={formatDate(goal.dueDate)} />
                    <DetailField label="创建时间" value={formatDate(goal.createdAt)} />
                    <DetailField label="更新时间" value={formatDate(goal.updatedAt)} />
                  </div>

                  {goal.description && (
                    <div className="mt-3">
                      <span className="text-xs text-text-muted">描述</span>
                      <p className="text-sm text-text-primary mt-0.5 whitespace-pre-wrap">
                        {goal.description}
                      </p>
                    </div>
                  )}

                  {Array.isArray(goal.keyResults) && goal.keyResults.length > 0 && (
                    <div className="mt-3">
                      <span className="text-xs text-text-muted">关键结果（KR）</span>
                      <ul className="mt-1 space-y-1">
                        {goal.keyResults.map((kr, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-text-primary">
                            <span className="text-text-muted shrink-0">-</span>
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
