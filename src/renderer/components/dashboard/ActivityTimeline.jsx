import { useState, useCallback } from 'react';
import { InboxIcon, BookmarkIcon } from '@heroicons/react/24/outline';
import { CATEGORY_ICONS, CATEGORY_COLORS, PAGE_SIZE } from './constants';
import { EmptyState, Pagination } from './ui';

/**
 * 最近活动时间线 —— 左侧细竖线 + 圆点，时间 text-quaternary
 * props: { activities: Array, onRefresh: Function }
 */
export default function ActivityTimeline({ activities, onRefresh }) {
  const [page, setPage] = useState(1);
  const [isClearing, setIsClearing] = useState(false);

  const handleClearLog = useCallback(async () => {
    if (!window.confirm('确定要清空所有活动日志吗？')) return;
    setIsClearing(true);
    try {
      const result = await window.electronAPI.clearActivityLog?.();
      if (result?.success) {
        setPage(1);
        if (onRefresh) onRefresh();
      }
    } catch (error) {
      console.error('清空活动日志失败:', error);
    } finally {
      setIsClearing(false);
    }
  }, [onRefresh]);

  if (!activities.length) {
    return <EmptyState icon={InboxIcon} message="暂无活动记录" />;
  }

  const totalPages = Math.ceil(activities.length / PAGE_SIZE);
  const display = activities.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      {/* 清空按钮 */}
      {activities.length > 0 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={handleClearLog}
            disabled={isClearing}
            className="px-2 py-1 text-xs text-text-quaternary hover:text-text-tertiary rounded-sm transition-colors-fast disabled:opacity-50"
          >
            {isClearing ? '清空中…' : `清空日志 (${activities.length})`}
          </button>
        </div>
      )}
      {/* 时间线：左侧细竖线 + 圆点 */}
      <div className="relative pl-5">
        {/* 竖线 */}
        <div
          className="absolute left-1 top-1 bottom-1 w-px"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
        />
        <div className="space-y-3">
          {display.map((activity, idx) => {
            const Icon = CATEGORY_ICONS[activity.category] || BookmarkIcon;
            const colorClass = CATEGORY_COLORS[activity.category] || 'text-text-quaternary';
            return (
              <div
                key={idx}
                className="relative"
                style={{
                  // Emil: 时间线 stagger 入场，每项 40ms 延迟
                  animation: `timelineItemEnter 260ms cubic-bezier(0.23,1,0.32,1) ${idx * 40}ms both`,
                }}
              >
                {/* 圆点 */}
                <span
                  className="absolute -left-[14px] top-1 w-2 h-2 rounded-full border-2 border-bg-base"
                  style={{ backgroundColor: 'var(--accent)' }}
                />
                <div className="flex items-start gap-2">
                  <Icon className={`w-3.5 h-3.5 ${colorClass} mt-0.5 shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-secondary leading-snug">{activity.action}</p>
                    <p className="text-xs text-text-quaternary mt-0.5">
                      {activity.actor} · {new Date(activity.time).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* 时间线 stagger 入场 keyframes（仅本组件局部） */}
      <style>{`
        @keyframes timelineItemEnter {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <Pagination current={page} total={totalPages} onChange={setPage} itemCount={activities.length} />
    </div>
  );
}
