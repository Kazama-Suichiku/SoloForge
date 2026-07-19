/**
 * SoloForge - 任务输入组件
 * 多行文本输入 + 发送按钮，调用 soloforge.agent.executeTask
 * Linear 风格：.card 容器 + .input + .btn-primary。
 * @module components/TaskInput
 */

import { useState, useCallback } from 'react';
import { useTaskStore } from '../store/task-store';

const DEFAULT_AGENTS = ['writer', 'reviewer'];

/**
 * 生成唯一任务 ID
 * @returns {string}
 */
function generateTaskId() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function TaskInput() {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const addTask = useTaskStore((s) => s.addTask);

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || !window.soloforge?.agent?.executeTask) return;

    const taskId = generateTaskId();
    addTask({ id: taskId, prompt: trimmed });
    setPrompt('');
    setIsSubmitting(true);

    try {
      await window.soloforge.agent.executeTask({
        taskId,
        taskType: 'write-and-review',
        input: { prompt: trimmed },
        agents: DEFAULT_AGENTS,
      });
    } catch (err) {
      console.error('executeTask failed:', err);
      useTaskStore.getState().completeTask(taskId, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [prompt, addTask]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="card">
      <label htmlFor="task-prompt" className="sr-only">
        任务描述
      </label>
      <textarea
        id="task-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="描述你的任务，例如：写一封感谢客户合作的邮件..."
        rows={3}
        disabled={isSubmitting}
        className="input resize-none"
        style={{ lineHeight: '1.5' }}
        aria-label="任务描述"
      />
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || !prompt.trim()}
          className="btn-primary"
        >
          {isSubmitting ? (
            <>
              <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              执行中...
            </>
          ) : (
            '发送'
          )}
        </button>
      </div>
    </div>
  );
}
