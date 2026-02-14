/**
 * SoloForge - Agent TODO 面板
 * 显示当前对话中 Agent 的待办事项列表
 * 可折叠/展开，显示在消息列表右侧或顶部
 * @module components/chat/TodoPanel
 */

import { useState, useEffect, useMemo } from 'react';
import { useTodoStore } from '../../store/todo-store';
import { useChatStore } from '../../store/chat-store';
import { useAgentStore } from '../../store/agent-store';
import {
  CheckCircleIcon,
  ClockIcon,
  ListBulletIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

// ─────────────────────────────────────────────────────────
// 状态图标和样式
// ─────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending: {
    icon: '○',
    label: '待办',
    className: 'text-text-secondary',
    dotClass: 'bg-text-secondary/40',
  },
  in_progress: {
    icon: '◉',
    label: '进行中',
    className: 'text-[var(--color-primary)]',
    dotClass: 'bg-[var(--color-primary)]',
  },
  done: {
    icon: '✓',
    label: '已完成',
    className: 'text-green-500',
    dotClass: 'bg-green-500',
  },
};

// ─────────────────────────────────────────────────────────
// 单个 TODO 项
// ─────────────────────────────────────────────────────────

function TodoItem({ todo }) {
  const config = STATUS_CONFIG[todo.status] || STATUS_CONFIG.pending;

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 group">
      {/* 状态指示器 */}
      <span className={`shrink-0 mt-0.5 text-xs font-bold ${config.className}`}>
        {todo.status === 'done' ? (
          <CheckCircleIcon className="w-3.5 h-3.5 text-green-500" />
        ) : todo.status === 'in_progress' ? (
          <ClockIcon className="w-3.5 h-3.5 text-[var(--color-primary)]" />
        ) : (
          <span className="inline-block w-3.5 h-3.5 rounded-full border border-text-secondary/40" />
        )}
      </span>

      {/* 内容 */}
      <div className="min-w-0 flex-1">
        <span
          className={`text-[12px] leading-snug ${
            todo.status === 'done'
              ? 'text-text-secondary/60 line-through'
              : 'text-text-primary'
          }`}
        >
          {todo.title}
        </span>
        {todo.note && (
          <p className="text-[10px] text-text-secondary/70 mt-0.5 leading-tight">
            {todo.note}
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Agent TODO 分组
// ─────────────────────────────────────────────────────────

function AgentTodoGroup({ agentId, todos, agentName, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);

  const pending = todos.filter((t) => t.status === 'pending').length;
  const inProgress = todos.filter((t) => t.status === 'in_progress').length;
  const done = todos.filter((t) => t.status === 'done').length;
  const total = todos.length;

  // 进度条百分比（done + in_progress*0.5 / total）
  const progress = total > 0 ? Math.round(((done + inProgress * 0.5) / total) * 100) : 0;

  return (
    <div className="border-b border-[var(--border-color)] last:border-b-0">
      {/* Agent 标题栏 */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors"
      >
        {open ? (
          <ChevronDownIcon className="w-3.5 h-3.5 text-text-secondary shrink-0" />
        ) : (
          <ChevronRightIcon className="w-3.5 h-3.5 text-text-secondary shrink-0" />
        )}

        <span className="text-[12px] font-medium text-text-primary truncate">
          {agentName}
        </span>

        {/* 进度统计 */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {inProgress > 0 && (
            <span className="text-[10px] text-[var(--color-primary)] font-medium">
              {inProgress} 进行中
            </span>
          )}
          <span className="text-[10px] text-text-secondary">
            {done}/{total}
          </span>
        </div>
      </button>

      {/* 进度条 */}
      {open && total > 0 && (
        <div className="px-3 pb-1.5">
          <div className="h-1 bg-[var(--border-color)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* TODO 列表 */}
      {open && (
        <div className="pb-1.5">
          {/* 先显示 in_progress，再 pending，最后 done */}
          {todos
            .sort((a, b) => {
              const order = { in_progress: 0, pending: 1, done: 2 };
              return (order[a.status] ?? 1) - (order[b.status] ?? 1);
            })
            .map((todo) => (
              <TodoItem key={todo.id} todo={todo} />
            ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 主面板
// ─────────────────────────────────────────────────────────

export default function TodoPanel({ collapsed, onToggle }) {
  const todosByAgent = useTodoStore((s) => s.todosByAgent);
  const loadAll = useTodoStore((s) => s.loadAll);
  const handleUpdate = useTodoStore((s) => s.handleUpdate);
  const initialized = useTodoStore((s) => s.initialized);

  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const getAgent = useAgentStore((s) => s.getAgent);

  // 初始化：加载 TODO 数据 + 监听推送
  useEffect(() => {
    if (!initialized) {
      loadAll();
    }

    const unsub = window.electronAPI?.onTodoUpdated?.((data) => {
      if (data?.agentId) {
        handleUpdate(data.agentId, data.todos || []);
      }
    });

    return () => unsub?.();
  }, [initialized, loadAll, handleUpdate]);

  // 获取当前对话的 Agent 列表
  const currentAgentIds = useMemo(() => {
    if (!currentConversationId) return [];
    const conv = conversations.get(currentConversationId);
    if (!conv) return [];
    return conv.participants.filter((p) => p !== 'user');
  }, [currentConversationId, conversations]);

  // 筛选有 TODO 的 Agent
  const agentTodoGroups = useMemo(() => {
    return currentAgentIds
      .map((id) => ({
        agentId: id,
        todos: todosByAgent[id] || [],
        agentName: getAgent(id)?.name || id,
      }))
      .filter((g) => g.todos.length > 0);
  }, [currentAgentIds, todosByAgent, getAgent]);

  // 统计
  const totalTodos = agentTodoGroups.reduce((sum, g) => sum + g.todos.length, 0);
  const totalDone = agentTodoGroups.reduce(
    (sum, g) => sum + g.todos.filter((t) => t.status === 'done').length,
    0
  );
  const totalInProgress = agentTodoGroups.reduce(
    (sum, g) => sum + g.todos.filter((t) => t.status === 'in_progress').length,
    0
  );

  // 没有 TODO 时不显示
  if (totalTodos === 0) return null;

  // 折叠模式：只显示一个小指示器
  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--border-color)] bg-bg-elevated hover:bg-[var(--bg-hover)] transition-colors w-full"
        title="展开待办事项"
      >
        <ListBulletIcon className="w-4 h-4 text-[var(--color-primary)]" />
        <span className="text-[11px] font-medium text-text-primary">
          待办事项
        </span>
        <span className="text-[10px] text-text-secondary ml-1">
          {totalDone}/{totalTodos}
        </span>
        {totalInProgress > 0 && (
          <span className="text-[10px] text-[var(--color-primary)] ml-auto">
            {totalInProgress} 进行中
          </span>
        )}
        <ChevronDownIcon className="w-3 h-3 text-text-secondary ml-auto" />
      </button>
    );
  }

  // 展开模式
  return (
    <div className="border-b border-[var(--border-color)] bg-bg-elevated">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <ListBulletIcon className="w-4 h-4 text-[var(--color-primary)]" />
          <span className="text-[12px] font-semibold text-text-primary">待办事项</span>
          <span className="text-[10px] text-text-secondary">
            {totalDone}/{totalTodos} 完成
          </span>
        </div>
        <button
          onClick={onToggle}
          className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-text-secondary"
          title="收起"
        >
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Agent TODO 分组 */}
      <div className="max-h-[250px] overflow-y-auto">
        {agentTodoGroups.map((group) => (
          <AgentTodoGroup
            key={group.agentId}
            agentId={group.agentId}
            todos={group.todos}
            agentName={group.agentName}
            defaultOpen={agentTodoGroups.length <= 3}
          />
        ))}
      </div>
    </div>
  );
}
