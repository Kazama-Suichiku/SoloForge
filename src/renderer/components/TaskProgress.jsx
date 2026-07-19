/**
 * SoloForge - 任务进度组件
 * 显示 Writer → Reviewer 流程、当前 Agent、进度百分比，支持取消
 * Linear 风格：.card 容器 + accent 进度条 + ghost 取消按钮。
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
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-ui text-text-primary">执行中</span>
        <button
          type="button"
          onClick={handleCancel}
          className="btn-ghost px-2 py-1 text-xs"
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
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors"
                style={
                  isCompleted
                    ? { backgroundColor: 'var(--accent)', color: '#fff' }
                    : isActive
                      ? { border: '1.5px solid var(--accent)', backgroundColor: 'transparent', color: 'var(--accent)' }
                      : { border: '1px solid var(--border-default)', backgroundColor: 'transparent', color: 'var(--text-secondary)' }
                }
                aria-current={isActive ? 'step' : undefined}
              >
                {isCompleted ? '✓' : i + 1}
              </div>
              <span
                className={`text-sm ${isActive ? 'font-ui text-text-primary' : 'text-text-secondary'}`}
              >
                {step.label}
              </span>
              {i < PIPELINE_STEPS.length - 1 && (
                <div
                  className="h-px flex-1 rounded"
                  style={{ backgroundColor: i < activeIndex ? 'var(--accent)' : 'var(--border-default)' }}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 进度条：accent 色 */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: 'var(--border-default)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${task.progress}%`, backgroundColor: 'var(--accent)' }}
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
