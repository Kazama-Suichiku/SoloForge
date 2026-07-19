import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowPathIcon, StopCircleIcon } from '@heroicons/react/24/outline';
import { STAGE_LABELS, STAGE_COLORS } from './constants';
import { formatDuration } from './utils';

/**
 * Agent 工作状态面板
 * props: 无（自管理数据）
 *
 * 内部定时器：
 *  - 每 2 秒轮询 Agent 任务（timerRef），useEffect cleanup 中 clearInterval
 *  - 每 1 秒触发一次 tick（仅当 tasks.length > 0）以刷新已用时长显示，useEffect cleanup 中 clearInterval
 * 切页/卸载时所有定时器都会被清理。
 */
export default function AgentTaskPanel() {
  const [tasks, setTasks] = useState([]);
  const [aborting, setAborting] = useState(new Set());
  const timerRef = useRef(null);

  const loadTasks = useCallback(async () => {
    try {
      const result = await window.electronAPI?.getAgentTasks?.();
      if (result && Array.isArray(result)) setTasks(result);
    } catch (error) {
      console.error('加载 Agent 任务失败:', error);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    timerRef.current = setInterval(loadTasks, 2000);
    return () => clearInterval(timerRef.current);
  }, [loadTasks]);

  const handleAbort = useCallback(async (agentId) => {
    setAborting((prev) => new Set(prev).add(agentId));
    try {
      const result = await window.electronAPI?.abortAgentTask?.(agentId);
      if (result?.success) await loadTasks();
    } catch (error) {
      console.error('终止任务失败:', error);
    } finally {
      setAborting((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
    }
  }, [loadTasks]);

  // 1 秒 tick：仅在有任务时启动，用于刷新"已用时"显示（formatDuration 精确到秒）。
  // 用 useEffect cleanup 保证卸载时清理，不会泄漏。
  const [, setTick] = useState(0);
  useEffect(() => {
    if (tasks.length === 0) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [tasks.length]);

  const indicator = tasks.length > 0
    ? <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
    : <div className="w-2 h-2 rounded-full bg-green-500" />;

  const trailingText = tasks.length > 0 ? `${tasks.length} 个任务进行中` : '';

  return (
    <div className="bg-bg-elevated rounded-xl border border-[var(--border-color)] mb-6">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border-color)]/60">
        {indicator}
        <h3 className="text-sm font-semibold text-text-primary">Agent 工作状态</h3>
        {trailingText && <span className="text-xs text-text-muted ml-auto">{trailingText}</span>}
      </div>
      <div className="px-5 py-4">
        {tasks.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-2">
            所有 Agent 当前空闲
          </p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const elapsed = Date.now() - task.startTime;
              const isAborting = aborting.has(task.agentId);
              return (
                <div
                  key={task.agentId}
                  className="flex items-center gap-3 p-3 bg-bg-muted rounded-lg border border-[var(--border-color)]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary text-sm">{task.agentName}</span>
                      <span className={`px-1.5 py-0.5 text-xs rounded-full text-white ${STAGE_COLORS[task.stage] || 'bg-gray-500'}`}>
                        {STAGE_LABELS[task.stage] || task.stage}
                      </span>
                      <span className="text-xs text-text-muted">{formatDuration(elapsed)}</span>
                    </div>
                    <p className="text-xs text-text-secondary mt-1 truncate">{task.task || '处理中...'}</p>
                  </div>
                  <button
                    type="button"
                    disabled={isAborting}
                    onClick={() => handleAbort(task.agentId)}
                    className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isAborting
                        ? 'bg-bg-muted text-text-muted cursor-not-allowed'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40'
                    }`}
                    title="终止此 Agent 的当前任务"
                  >
                    {isAborting ? (
                      <>
                        <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                        终止中
                      </>
                    ) : (
                      <>
                        <StopCircleIcon className="w-3.5 h-3.5" />
                        终止
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
