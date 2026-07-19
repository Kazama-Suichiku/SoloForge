import { useState } from 'react';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import { KPI_DIRECTION_LABELS, PAGE_SIZE } from './constants';
import { formatDateTime } from './utils';
import { ChevronIcon, DetailField, EmptyState, Pagination, ProgressBar } from './ui';

/**
 * KPI 指标列表
 * props: { kpis: Array }
 */
export default function KPIsList({ kpis }) {
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);

  if (!kpis.length) {
    return <EmptyState icon={ChartBarIcon} message="暂无 KPI" hint="CXO 可以通过对话创建 KPI" />;
  }

  const totalPages = Math.ceil(kpis.length / PAGE_SIZE);
  const display = kpis.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="space-y-2">
        {display.map((kpi) => {
          const isExpanded = expandedId === kpi.id;
          const progressNum = parseInt(kpi.progress) || 0;
          const isOnTrack = progressNum >= 80;
          const isAtRisk = progressNum < 50;

          return (
            <div
              key={kpi.id}
              className={`rounded-lg border transition-colors ${
                isExpanded
                  ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
                  : 'bg-bg-muted border-[var(--border-color)] hover:border-[var(--border-color)]'
              }`}
            >
              <button
                type="button"
                className="w-full p-3 text-left"
                onClick={() => setExpandedId(isExpanded ? null : kpi.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ChevronIcon expanded={isExpanded} />
                    <div>
                      <h4 className="font-medium text-sm text-text-primary">{kpi.name}</h4>
                      <p className="text-xs text-text-secondary">{kpi.owner}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-text-primary">{kpi.current}</p>
                    <p className="text-xs text-text-secondary">目标: {kpi.target}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 pl-6">
                  <ProgressBar
                    value={progressNum}
                    size="sm"
                    color={isOnTrack ? 'green' : isAtRisk ? 'red' : 'yellow'}
                  />
                  <span className={`text-xs whitespace-nowrap ${isOnTrack ? 'text-green-500' : isAtRisk ? 'text-red-500' : 'text-yellow-500'}`}>
                    {kpi.progress}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-6 mr-3">
                  {kpi.description && (
                    <div className="mb-3">
                      <span className="text-xs text-text-muted">描述</span>
                      <p className="text-sm text-text-primary mt-0.5 whitespace-pre-wrap">
                        {kpi.description}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <DetailField label="部门" value={kpi.department} />
                    <DetailField label="周期" value={kpi.period} />
                    {kpi.direction && (
                      <div>
                        <span className="text-xs text-text-muted">方向</span>
                        <p className="text-sm text-text-primary mt-0.5">
                          {KPI_DIRECTION_LABELS[kpi.direction] || kpi.direction}
                        </p>
                      </div>
                    )}
                  </div>

                  {kpi.history && kpi.history.length > 0 && (
                    <div className="mt-3">
                      <span className="text-xs text-text-muted">
                        变更历史（最近 {Math.min(kpi.history.length, 5)} 条）
                      </span>
                      <div className="mt-1 space-y-1">
                        {kpi.history.slice(-5).reverse().map((entry, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs p-1.5 bg-bg-elevated rounded"
                          >
                            <span className="text-text-secondary">{formatDateTime(entry.date)}</span>
                            <span className="font-medium text-text-primary">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pagination current={page} total={totalPages} onChange={setPage} itemCount={kpis.length} />
    </div>
  );
}
