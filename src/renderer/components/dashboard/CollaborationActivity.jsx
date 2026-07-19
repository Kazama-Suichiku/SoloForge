import { useState, useCallback } from 'react';
import {
  ChevronRightIcon,
  ChatBubbleLeftIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';
import { PAGE_SIZE } from './constants';
import { formatDateTime } from './utils';
import { ChevronIcon, DetailField, EmptyState, Pagination, Badge } from './ui';

/**
 * Agent 协作活动列表 —— 消息预览 text-secondary，pill badge
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
    return <EmptyState icon={ChatBubbleLeftIcon} message="暂无协作记录" />;
  }

  const totalPages = Math.ceil(activities.length / PAGE_SIZE);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const displayActivities = activities.slice(startIdx, startIdx + PAGE_SIZE);

  // 状态 → badge tone 映射
  const statusTone = (status) => {
    if (status === 'completed' || status === 'responded') return 'success';
    if (status === 'failed') return 'danger';
    if (status === 'in_progress') return 'accent';
    return 'warning'; // pending
  };
  const statusLabel = (status) => {
    if (status === 'responded') return '已回复';
    if (status === 'completed') return '已完成';
    if (status === 'failed') return '失败';
    if (status === 'in_progress') return '进行中';
    return '待处理';
  };

  return (
    <div>
      {/* 清理按钮 */}
      {(staleCount > 0 || completedCount > 0) && (
        <div className="flex justify-end gap-2 mb-2">
          {staleCount > 0 && (
            <button
              onClick={handleClearStale}
              disabled={isClearing}
              className="px-2 py-1 text-xs text-warning hover:text-warning rounded-sm transition-colors-fast disabled:opacity-50"
              title="关闭超过 1 天未完成的任务"
            >
              {isClearing ? '处理中…' : `关闭超时任务`}
            </button>
          )}
          {completedCount > 0 && (
            <button
              onClick={handleClearCompleted}
              disabled={isClearing}
              className="px-2 py-1 text-xs text-text-tertiary hover:text-text-secondary rounded-sm transition-colors-fast disabled:opacity-50"
            >
              {isClearing ? '处理中…' : `清空已完成 (${completedCount})`}
            </button>
          )}
        </div>
      )}
      <div className="space-y-1">
        {displayActivities.map((activity, idx) => {
          const key = activity.id || idx;
          const isExpanded = expandedId === key;
          const TypeIcon = activity.type === 'message' ? ChatBubbleLeftIcon : ClipboardDocumentCheckIcon;

          return (
            <div
              key={key}
              className={`group relative rounded-md border ${
                isExpanded
                  ? 'border-border-default'
                  : 'border-transparent hover:border-border-default'
              }`}
            >
              {/* Emil: hover opacity 背景层（不触发 background-color 重绘） */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ backgroundColor: 'var(--bg-hover)' }}
              />
              {isExpanded && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-md"
                  style={{ backgroundColor: 'var(--bg-hover)', opacity: 1 }}
                />
              )}
              <button
                type="button"
                className="w-full flex items-start gap-2.5 p-2.5 text-left"
                onClick={() => setExpandedId(isExpanded ? null : key)}
              >
                <ChevronIcon expanded={isExpanded} />
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                  <TypeIcon className="w-3 h-3 text-text-quaternary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-xs text-text-tertiary">
                    <span className="font-ui text-text-secondary">{activity.from}</span>
                    <ChevronRightIcon className="w-3 h-3 text-text-quaternary" />
                    <span className="font-ui text-text-secondary">{activity.to}</span>
                    <span className="text-text-quaternary mx-0.5">·</span>
                    <span className="text-text-quaternary">{formatDateTime(activity.timestamp)}</span>
                  </div>
                  <p className="text-sm text-text-secondary truncate mt-0.5">{activity.summary}</p>
                </div>
                <Badge tone={statusTone(activity.status)} className="shrink-0">
                  {statusLabel(activity.status)}
                </Badge>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-2 ml-9 mr-3 border-t border-border-subtle">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge tone={activity.type === 'message' ? 'accent' : 'warning'}>
                      {activity.type === 'message' ? '消息' : '委派任务'}
                    </Badge>
                    {activity.type === 'task' && activity.priority && (
                      <span className={`text-xs ${activity.priority <= 2 ? 'text-danger' : activity.priority <= 3 ? 'text-warning' : 'text-text-quaternary'}`}>
                        优先级 {activity.priority}
                      </span>
                    )}
                  </div>

                  {activity.content && (
                    <div className="mb-3">
                      <span className="text-xs text-text-quaternary">
                        {activity.type === 'message' ? '发送内容' : '任务描述'}
                      </span>
                      <div className="mt-1 p-2 rounded-md border border-border-subtle text-sm text-text-secondary whitespace-pre-wrap max-h-32 overflow-auto leading-snug">
                        {activity.content}
                      </div>
                    </div>
                  )}

                  {activity.type === 'message' && activity.response && (
                    <div className="mb-3">
                      <span className="text-xs text-text-quaternary">回复内容</span>
                      <div className="mt-1 p-2 rounded-md border border-border-subtle text-sm text-text-secondary whitespace-pre-wrap max-h-32 overflow-auto leading-snug">
                        {activity.response}
                      </div>
                    </div>
                  )}

                  {activity.type === 'task' && activity.result && (
                    <div className="mb-3">
                      <span className="text-xs text-text-quaternary">执行结果</span>
                      <div className="mt-1 p-2 rounded-md border border-border-subtle text-sm text-text-secondary whitespace-pre-wrap max-h-32 overflow-auto leading-snug">
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
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-text-tertiary">
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
