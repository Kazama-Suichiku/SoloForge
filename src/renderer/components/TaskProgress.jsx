/**
 * SoloForge - 任务进度组件
 * 显示 Writer → Reviewer 流程、当前 Agent、进度百分比，支持取消
 * @module components/TaskProgress
 */

import { useCallback } from 'react';
import { useTaskStore, getAgentDisplayName } from '../store/task-store';

const PIPELINE_STEPS = [
  { id: 'writer', label: 'Writer' },
  { id: 'reviewer', label: 'Reviewer' },
];

export default function TaskProgress({ taskId }) {
  const task = useTaskStore((s) => s.tasks.get(taskId));
  const cancelTaskStore = useTaskStore((s) => s.cancelTask);

  const handleCancel = useCallback(() => {
    if (!taskId || !window.soloforge?.agent?.cancelTask) return;
    window.soloforge.agent.cancelTask(taskId);
    cancelTaskStore(taskId);
  }, [taskId, cancelTaskStore]);

  if (!task || task.status !== 'running') return null;

  const currentIndex = PIPELINE_STEPS.findIndex((s) => s.id === task.currentAgent);
  const activeIndex = currentIndex >= 0 ? currentIndex : 0;

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-text-primary">执行中</span>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-[var(--border-color)] hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        >
          取消
        </button>
      </div>

      {/* 步骤指示器 */}
      <div className="mb-3 flex items-center gap-2">
        {PIPELINE_STEPS.map((step, i) => {
          const isCompleted = i < activeIndex || (i === activeIndex && task.progress >= 100);
          const isActive = i === activeIndex;
          return (
            <div key={step.id} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                  isCompleted
                    ? 'bg-[var(--color-primary)] text-white'
                    : isActive
                      ? 'border-2 border-[var(--color-primary)] bg-[var(--bg-base)] text-[var(--color-primary)]'
                      : 'border border-[var(--border-color)] bg-[var(--bg-base)] text-text-secondary'
                }`}
                aria-current={isActive ? 'step' : undefined}
              >
                {isCompleted ? '✓' : i + 1}
              </div>
              <span
                className={`text-sm ${isActive ? 'font-medium text-text-primary' : 'text-text-secondary'}`}
              >
                {step.label}
              </span>
              {i < PIPELINE_STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 rounded ${i < activeIndex ? 'bg-[var(--color-primary)]' : 'bg-[var(--border-color)]'}`}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 进度条 */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border-color)]">
        <div
          className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-300"
          style={{ width: `${task.progress}%` }}
          role="progressbar"
          aria-valuenow={task.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className="mt-2 text-xs text-text-secondary">
        {task.currentAgent ? getAgentDisplayName(task.currentAgent) : ''}
        {task.message ? ` · ${task.message}` : ''}
      </p>
    </div>
  );
}
