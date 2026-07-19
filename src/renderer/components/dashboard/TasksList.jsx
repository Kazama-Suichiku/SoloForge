import { useState, useCallback, useMemo } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { FolderIcon } from '@heroicons/react/24/outline';
import {
  STATUS_TONES,
  STATUS_LABELS,
  PRIORITY_TONES,
  PRIORITY_LABELS,
  PAGE_SIZE,
} from './constants';
import { formatDate } from './utils';
import { ChevronIcon, DetailField, EmptyState, Pagination, Badge, StatusDot } from './ui';

/**
 * 任务看板列表 —— Linear 风格紧凑行 + pill badge
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
              className="px-2 py-1 text-xs text-danger hover:text-danger-hover rounded-sm transition-colors-fast disabled:opacity-50"
            >
              {isClearing ? '清空中…' : `清空已取消 (${cancelledCount})`}
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
            className="px-2 py-1 text-xs text-danger hover:text-danger-hover rounded-sm transition-colors-fast disabled:opacity-50"
          >
            {isClearing ? '清空中…' : `清空已取消 (${cancelledCount})`}
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
              className={`group relative rounded-md ${
                isExpanded
                  ? 'border border-border-default'
                  : 'border border-transparent hover:border-border-default'
              }`}
            >
              {/* Emil: hover 用 opacity 背景层（固定半透明 + opacity 过渡，不触发 background-color 重绘） */}
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
                className="w-full flex items-center gap-3 p-2.5 text-left"
                onClick={() => setExpandedId(isExpanded ? null : task.id)}
              >
                <ChevronIcon expanded={isExpanded} />
                {/* 优先级小圆点 */}
                <StatusDot tone={PRIORITY_TONES[task.priority] || 'neutral'} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{task.title}</p>
                  <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                    <span>{task.assignee}</span>
                    <span className="text-text-quaternary">·</span>
                    <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                    {task.projectName && (
                      <>
                        <span className="text-text-quaternary">·</span>
                        <span className="text-text-tertiary truncate max-w-[100px]" title={task.projectName}>
                          {task.projectName}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <Badge tone={STATUS_TONES[task.status] || 'neutral'}>
                  {STATUS_LABELS[task.status] || task.status}
                </Badge>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-2 ml-9 mr-3 border-t border-border-subtle">
                  {task.description && (
                    <div className="mb-3 mt-2">
                      <span className="text-xs text-text-quaternary">描述</span>
                      <p className="text-sm text-text-secondary mt-1 whitespace-pre-wrap leading-snug">
                        {task.description}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs text-text-quaternary">优先级</span>
                      <div className="flex items-center gap-1.5 mt-1">
                        <StatusDot tone={PRIORITY_TONES[task.priority] || 'neutral'} />
                        <span className="text-sm text-text-secondary">
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

                  {/* 关联项目 —— 中性边框行，无紫色 */}
                  {task.projectId && (
                    <div className="mt-3 p-2 rounded-md border border-border-subtle flex items-center gap-2">
                      <FolderIcon className="w-3.5 h-3.5 text-text-quaternary shrink-0" />
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-text-quaternary">项目</span>
                        <span className="text-sm text-text-secondary truncate">{task.projectName || task.projectId}</span>
                      </div>
                    </div>
                  )}

                  {/* 关联目标 —— 中性边框行，无蓝色 */}
                  {linkedGoal && (
                    <div className="mt-2 p-2 rounded-md border border-border-subtle flex items-center gap-2">
                      <span className="text-xs text-text-quaternary shrink-0">目标</span>
                      <span className="text-sm text-text-secondary truncate">{linkedGoal.title}</span>
                      <span className="text-xs text-text-quaternary shrink-0 ml-auto font-mono">{linkedGoal.progress}%</span>
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
