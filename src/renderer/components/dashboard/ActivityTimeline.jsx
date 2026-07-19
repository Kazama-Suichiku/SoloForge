import { useState, useCallback } from 'react';
import { InboxIcon, BookmarkIcon } from '@heroicons/react/24/outline';
import { CATEGORY_ICONS, CATEGORY_COLORS, PAGE_SIZE } from './constants';
import { EmptyState, Pagination } from './ui';

/**
 * 最近活动时间线
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
            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 rounded transition-colors disabled:opacity-50"
          >
            {isClearing ? '清空中...' : `清空日志 (${activities.length})`}
          </button>
        </div>
      )}
      <div className="space-y-3">
        {display.map((activity, idx) => {
          const Icon = CATEGORY_ICONS[activity.category] || BookmarkIcon;
          const colorClass = CATEGORY_COLORS[activity.category] || 'text-text-muted';
          return (
            <div key={idx} className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-bg-muted flex items-center justify-center shrink-0">
                <Icon className={`w-3.5 h-3.5 ${colorClass}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary leading-snug">{activity.action}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {activity.actor} · {new Date(activity.time).toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <Pagination current={page} total={totalPages} onChange={setPage} itemCount={activities.length} />
    </div>
  );
}
