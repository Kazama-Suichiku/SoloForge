import { useState, useCallback, useMemo } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { FlagIcon as FlagSolidIcon } from '@heroicons/react/24/solid';
import {
  STATUS_COLORS,
  STATUS_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  PAGE_SIZE,
} from './constants';
import { formatDate } from './utils';
import { ChevronIcon, DetailField, EmptyState, Pagination } from './ui';
import { FolderIcon } from '@heroicons/react/24/outline';

/**
 * 任务看板列表
 * props: { tasks, goals, allTasks, onRefresh }
 */
export default function TasksList({ tasks, goals, allTasks, onRefresh }) {
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);
  const [isClearing, setIsClearing] = useState(false);

  // 统计已取消的任务数量（从原始任务列表中统计）
  const cancelledCount = (allTasks || []).filter((t) => t.status === 'cancelled').length;

  const handleClearCancelled = useCallback(async () => {
    if (!window.confirm('确定要清空所有已取消的任务吗？此操作不可恢复。')) return;
    setIsClearing(true);
    try {
      const result = await window.electronAPI.clearCancelledTasks?.();
      if (result?.success) {
        setPage(1);
        if (onRefresh) onRefresh();
        if (result.clearedCount > 0) {
          window.alert?.(`已清空 ${result.clearedCount} 个已取消的任务`);
        }
      } else {
        window.alert?.('清空失败: ' + (result?.error || '未知错误'));
      }
    } catch (error) {
      console.error('清空已取消任务失败:', error);
      window.alert?.('清空已取消任务失败: ' + error.message);
    } finally {
      setIsClearing(false);
    }
  }, [onRefresh]);

  if (!tasks.length) {
    return (
      <div>
        {cancelledCount > 0 && (
          <div className="flex justify-end mb-2">
            <button
              onClick={handleClearCancelled}
              disabled={isClearing}
              className="px-2 py-1 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
            >
              {isClearing ? '清空中...' : `清空已取消 (${cancelledCount})`}
            </button>
          </div>
        )}
        <EmptyState icon={CheckCircleIcon} message="暂无任务" hint="CXO 可以通过对话分配任务" />
      </div>
    );
  }

  const totalPages = Math.ceil(tasks.length / PAGE_SIZE);
  const display = tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const goalMap = useMemo(() => {
    const map = {};
    if (goals) {
      for (const g of goals) map[g.id] = g;
    }
    return map;
  }, [goals]);

  return (
    <div>
      {/* 清空已取消任务按钮 */}
      {cancelledCount > 0 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={handleClearCancelled}
            disabled={isClearing}
            className="px-2 py-1 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
          >
            {isClearing ? '清空中...' : `清空已取消 (${cancelledCount})`}
          </button>
        </div>
      )}
      <div className="space-y-1">
        {display.map((task) => {
          const isExpanded = expandedId === task.id;
          const linkedGoal = task.goalId ? goalMap[task.goalId] : null;

          return (
            <div
              key={task.id}
              className={`rounded-lg transition-colors ${
                isExpanded
                  ? 'bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800'
                  : 'hover:bg-[var(--bg-hover)] border border-transparent'
              }`}
            >
              <button
                type="button"
                className="w-full flex items-center gap-3 p-2.5 text-left"
                onClick={() => setExpandedId(isExpanded ? null : task.id)}
              >
                <ChevronIcon expanded={isExpanded} />
                {/* 优先级小圆点 */}
                <span className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.low}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{task.title}</p>
                  <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <span>{task.assignee}</span>
                    <span>·</span>
                    <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                    {task.projectName && (
                      <>
                        <span>·</span>
                        <span className="text-purple-500 dark:text-purple-400 truncate max-w-[100px]" title={task.projectName}>
                          {task.projectName}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${STATUS_COLORS[task.status] || STATUS_COLORS.todo}`}>
                  {STATUS_LABELS[task.status] || task.status}
                </span>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-9">
                  {task.description && (
                    <div className="mb-3">
                      <span className="text-xs text-text-muted">描述</span>
                      <p className="text-sm text-text-primary mt-0.5 whitespace-pre-wrap">
                        {task.description}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs text-text-muted">优先级</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[task.priority]}`} />
                        <span className="text-sm text-text-primary">
                          {PRIORITY_LABELS[task.priority] || task.priority}
                        </span>
                      </div>
                    </div>
                    <DetailField label="发起人" value={task.requester} />
                    <DetailField label="执行人" value={task.assignee} />
                    <DetailField label="截止日期" value={formatDate(task.dueDate)} />
                    <DetailField label="创建时间" value={formatDate(task.createdAt)} />
                    {task.status === 'done' && (
                      <DetailField label="完成时间" value={formatDate(task.completedAt)} />
                    )}
                  </div>

                  {/* 关联项目 */}
                  {task.projectId && (
                    <div className="mt-3 p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg flex items-center gap-2">
                      <FolderIcon className="w-4 h-4 text-purple-500 shrink-0" />
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">项目</span>
                        <span className="text-sm text-text-primary truncate">{task.projectName || task.projectId}</span>
                      </div>
                    </div>
                  )}

                  {/* 关联目标 */}
                  {linkedGoal && (
                    <div className="mt-2 p-2 bg-bg-muted rounded-lg flex items-center gap-2">
                      <FlagSolidIcon className="w-4 h-4 text-blue-500 shrink-0" />
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">目标</span>
                        <span className="text-sm text-text-primary truncate">{linkedGoal.title}</span>
                        <span className="text-xs text-text-muted shrink-0">{linkedGoal.progress}%</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pagination current={page} total={totalPages} onChange={setPage} itemCount={tasks.length} />
    </div>
  );
}
