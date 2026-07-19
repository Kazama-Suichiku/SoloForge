import { useState } from 'react';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import { KPI_DIRECTION_LABELS, PAGE_SIZE } from './constants';
import { formatDateTime } from './utils';
import { ChevronIcon, DetailField, EmptyState, Pagination, ProgressBar } from './ui';

/**
 * KPI 指标列表 —— 大数值 32px weight 590，进度条用 accent 半透明
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
      {/* P2-9: KPI 列表 stagger 入场，40ms 递增 */}
      <div className="space-y-1.5 stagger">
        {display.map((kpi) => {
          const isExpanded = expandedId === kpi.id;
          const progressNum = parseInt(kpi.progress) || 0;
          const isOnTrack = progressNum >= 80;
          const isAtRisk = progressNum < 50;

          return (
            <div
              key={kpi.id}
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
                onClick={() => setExpandedId(isExpanded ? null : kpi.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ChevronIcon expanded={isExpanded} />
                    <div>
                      <h4 className="text-sm font-ui text-text-primary">{kpi.name}</h4>
                      <p className="text-xs text-text-tertiary mt-0.5">{kpi.owner}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {/* Emil: 大数值 32px weight 590 / -0.022em（与 StatCard 统一） */}
                    <p
                      className="text-[32px] font-title text-text-primary leading-none tracking-tightest"
                      style={{ fontWeight: 590, letterSpacing: '-0.022em' }}
                    >
                      {kpi.current}
                    </p>
                    <p className="text-xs text-text-quaternary mt-1">目标 {kpi.target}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 pl-6">
                  <ProgressBar
                    value={progressNum}
                    size="sm"
                    tone={isOnTrack ? 'success' : isAtRisk ? 'danger' : 'warning'}
                  />
                  <span
                    className={`text-xs whitespace-nowrap font-mono ${
                      isOnTrack ? 'text-success' : isAtRisk ? 'text-danger' : 'text-warning'
                    }`}
                  >
                    {kpi.progress}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-2 ml-6 mr-3 border-t border-border-subtle">
                  {kpi.description && (
                    <div className="mb-3 mt-2">
                      <span className="text-xs text-text-quaternary">描述</span>
                      <p className="text-sm text-text-secondary mt-1 whitespace-pre-wrap leading-snug">
                        {kpi.description}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <DetailField label="部门" value={kpi.department} />
                    <DetailField label="周期" value={kpi.period} />
                    {kpi.direction && (
                      <div>
                        <span className="text-xs text-text-quaternary">方向</span>
                        <p className="text-sm text-text-secondary mt-1">
                          {KPI_DIRECTION_LABELS[kpi.direction] || kpi.direction}
                        </p>
                      </div>
                    )}
                  </div>

                  {kpi.history && kpi.history.length > 0 && (
                    <div className="mt-3">
                      <span className="text-xs text-text-quaternary">
                        变更历史（最近 {Math.min(kpi.history.length, 5)} 条）
                      </span>
                      <div className="mt-1 space-y-1">
                        {kpi.history.slice(-5).reverse().map((entry, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs p-1.5 rounded-sm"
                            style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
                          >
                            <span className="text-text-tertiary">{formatDateTime(entry.date)}</span>
                            <span className="font-ui text-text-secondary font-mono">{entry.value}</span>
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
