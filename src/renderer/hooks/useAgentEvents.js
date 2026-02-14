/**
 * SoloForge - Agent 事件订阅 Hook
 * 订阅 soloforge.agent.onProgress、onComplete、onError，自动更新 task-store
 * 组件卸载时取消订阅
 * @module hooks/useAgentEvents
 */

import { useEffect } from 'react';
import { useTaskStore } from '../store/task-store';

export function useAgentEvents() {
  const updateTaskProgress = useTaskStore((s) => s.updateTaskProgress);
  const completeTask = useTaskStore((s) => s.completeTask);

  useEffect(() => {
    const api = window.soloforge?.agent;
    if (!api) return;

    const unsubProgress = api.onProgress?.((progress) => {
      if (progress?.taskId) {
        updateTaskProgress(progress.taskId, {
          progress: progress.progress,
          currentAgent: progress.currentAgent,
          message: progress.message,
        });
      }
    });

    const unsubComplete = api.onComplete?.((result) => {
      if (result?.taskId) {
        completeTask(result.taskId, {
          success: result.success ?? true,
          result: result.success ? { output: result.output } : undefined,
          error: result.error,
        });
      }
    });

    const unsubError = api.onError?.((result) => {
      if (result?.taskId) {
        completeTask(result.taskId, {
          success: false,
          error: result.error ?? '执行失败',
        });
      }
    });

    return () => {
      unsubProgress?.();
      unsubComplete?.();
      unsubError?.();
    };
  }, [updateTaskProgress, completeTask]);
}
