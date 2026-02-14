/**
 * SoloForge - 任务输入组件
 * 多行文本输入 + 发送按钮，调用 soloforge.agent.executeTask
 * @module components/TaskInput
 */

import { useState, useCallback } from 'react';
import { useTaskStore } from '../store/task-store';
import Button from './ui/Button';

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
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 shadow-sm">
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
        className="w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-4 py-3 text-text-primary placeholder:text-text-secondary focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-60"
        aria-label="任务描述"
      />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          size="md"
          loading={isSubmitting}
          disabled={!prompt.trim()}
          onClick={handleSubmit}
        >
          {isSubmitting ? '执行中...' : '发送'}
        </Button>
      </div>
    </div>
  );
}
