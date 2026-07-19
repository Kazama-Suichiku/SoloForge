import { useState, useCallback } from 'react';
import {
  ArrowsRightLeftIcon,
  ChevronRightIcon,
  ChatBubbleLeftIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';
import { PAGE_SIZE } from './constants';
import { formatDateTime } from './utils';
import { ChevronIcon, DetailField, EmptyState, Pagination } from './ui';

/**
 * Agent 协作活动列表
 * props: { activities: Array, onRefresh: Function }
 */
export default function CollaborationActivity({ activities, onRefresh }) {
  const [expandedId, setExpandedId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isClearing, setIsClearing] = useState(false);

  // 统计
  const staleCount = activities?.filter(
    (a) => a.type === 'task' && (a.status === 'pending' || a.status === 'in_progress')
  ).length || 0;
  const completedCount = activities?.filter(
    (a) => a.type === 'task' && (a.status === 'completed' || a.status === 'cancelled')
  ).length || 0;

  const handleClearStale = useCallback(async () => {
    if (!window.confirm('确定要关闭所有超过 1 天的积压任务吗？（仅关闭超时任务，将状态改为已取消）')) return;
    setIsClearing(true);
    try {
      const result = await window.electronAPI.clearStaleTasks?.({ maxAgeDays: 1 });
      if (result?.success) {
        setCurrentPage(1);
        if (onRefresh) onRefresh();
        if (result.clearedCount > 0) {
          window.alert?.(`已关闭 ${result.clearedCount} 个积压任务`);
        } else {
          window.alert?.('没有超过 1 天的积压任务需要关闭');
        }
      } else {
        window.alert?.('操作失败: ' + (result?.error || '未知错误'));
      }
    } catch (error) {
      console.error('清理积压任务失败:', error);
      window.alert?.('清理积压任务失败: ' + error.message);
    } finally {
      setIsClearing(false);
    }
  }, [onRefresh]);

  const handleClearCompleted = useCallback(async () => {
    if (!window.confirm('确定要清空所有已完成/已取消的任务记录吗？')) return;
    setIsClearing(true);
    try {
      const result = await window.electronAPI.clearCompletedTasks?.();
      if (result?.success) {
        setCurrentPage(1);
        if (onRefresh) onRefresh();
        if (result.clearedCount > 0) {
          window.alert?.(`已清空 ${result.clearedCount} 条任务记录`);
        } else {
          window.alert?.('没有已完成/已取消的任务需要清空');
        }
      } else {
        window.alert?.('操作失败: ' + (result?.error || '未知错误'));
      }
    } catch (error) {
      console.error('清空任务记录失败:', error);
      window.alert?.('清空任务记录失败: ' + error.message);
    } finally {
      setIsClearing(false);
    }
  }, [onRefresh]);

  if (!activities || activities.length === 0) {
    return <EmptyState icon={ArrowsRightLeftIcon} message="暂无协作记录" />;
  }

  const totalPages = Math.ceil(activities.length / PAGE_SIZE);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const displayActivities = activities.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <div>
      {/* 清理按钮 */}
      {(staleCount > 0 || completedCount > 0) && (
        <div className="flex justify-end gap-2 mb-2">
          {staleCount > 0 && (
            <button
              onClick={handleClearStale}
              disabled={isClearing}
              className="px-2 py-1 text-xs text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded transition-colors disabled:opacity-50"
              title="关闭超过 1 天未完成的任务"
            >
              {isClearing ? '处理中...' : `关闭超时任务`}
            </button>
          )}
          {completedCount > 0 && (
            <button
              onClick={handleClearCompleted}
              disabled={isClearing}
              className="px-2 py-1 text-xs text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
            >
              {isClearing ? '处理中...' : `清空已完成 (${completedCount})`}
            </button>
          )}
        </div>
      )}
      <div className="space-y-1">
        {displayActivities.map((activity, idx) => {
          const key = activity.id || idx;
          const isExpanded = expandedId === key;
          const TypeIcon = activity.type === 'message' ? ChatBubbleLeftIcon : ClipboardDocumentCheckIcon;
          const typeColor = activity.type === 'message' ? 'text-blue-500' : 'text-purple-500';

          return (
            <div
              key={key}
              className={`rounded-lg transition-colors ${
                isExpanded
                  ? 'bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800'
                  : 'hover:bg-[var(--bg-hover)] border border-transparent'
              }`}
            >
              <button
                type="button"
                className="w-full flex items-start gap-2.5 p-2.5 text-left"
                onClick={() => setExpandedId(isExpanded ? null : key)}
              >
                <ChevronIcon expanded={isExpanded} />
                <div className="w-6 h-6 rounded-full bg-bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <TypeIcon className={`w-3.5 h-3.5 ${typeColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-xs text-text-secondary">
                    <span className="font-medium text-text-primary">{activity.from}</span>
                    <ChevronRightIcon className="w-3 h-3 text-text-muted" />
                    <span className="font-medium text-text-primary">{activity.to}</span>
                    <span className="text-text-muted mx-0.5">|</span>
                    <span className="text-text-muted">{formatDateTime(activity.timestamp)}</span>
                  </div>
                  <p className="text-sm text-text-secondary truncate mt-0.5">{activity.summary}</p>
                </div>
                <span
                  className={`px-1.5 py-0.5 text-xs rounded shrink-0 ${
                    activity.status === 'completed' || activity.status === 'responded'
                      ? 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300'
                      : activity.status === 'failed'
                        ? 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300'
                        : 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900 dark:text-yellow-300'
                  }`}
                >
                  {activity.status === 'responded' ? '已回复' :
                   activity.status === 'completed' ? '已完成' :
                   activity.status === 'failed' ? '失败' :
                   activity.status === 'in_progress' ? '进行中' : '待处理'}
                </span>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-9">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      activity.type === 'message'
                        ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300'
                        : 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300'
                    }`}>
                      {activity.type === 'message' ? '消息' : '委派任务'}
                    </span>
                    {activity.type === 'task' && activity.priority && (
                      <span className={`text-xs ${
                        activity.priority <= 2 ? 'text-red-500' :
                        activity.priority <= 3 ? 'text-yellow-500' : 'text-text-muted'
                      }`}>
                        优先级 {activity.priority}
                      </span>
                    )}
                  </div>

                  {activity.content && (
                    <div className="mb-3">
                      <span className="text-xs text-text-muted">
                        {activity.type === 'message' ? '发送内容' : '任务描述'}
                      </span>
                      <div className="mt-1 p-2 bg-bg-elevated rounded text-sm text-text-primary whitespace-pre-wrap max-h-32 overflow-auto">
                        {activity.content}
                      </div>
                    </div>
                  )}

                  {activity.type === 'message' && activity.response && (
                    <div className="mb-3">
                      <span className="text-xs text-text-muted">回复内容</span>
                      <div className="mt-1 p-2 bg-green-50 dark:bg-green-950/30 rounded text-sm text-text-primary whitespace-pre-wrap max-h-32 overflow-auto">
                        {activity.response}
                      </div>
                    </div>
                  )}

                  {activity.type === 'task' && activity.result && (
                    <div className="mb-3">
                      <span className="text-xs text-text-muted">执行结果</span>
                      <div className="mt-1 p-2 bg-green-50 dark:bg-green-950/30 rounded text-sm text-text-primary whitespace-pre-wrap max-h-32 overflow-auto">
                        {activity.result}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <DetailField label="发起时间" value={formatDateTime(activity.timestamp)} />
                    {activity.respondedAt && <DetailField label="回复时间" value={formatDateTime(activity.respondedAt)} />}
                    {activity.startedAt && <DetailField label="开始执行" value={formatDateTime(activity.startedAt)} />}
                    {activity.completedAt && <DetailField label="完成时间" value={formatDateTime(activity.completedAt)} />}
                  </div>

                  {activity.type === 'task' && activity.discussionCount > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
                      <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
                      <span>{activity.discussionCount} 条讨论记录</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pagination current={currentPage} total={totalPages} onChange={setCurrentPage} itemCount={activities.length} />
    </div>
  );
}
