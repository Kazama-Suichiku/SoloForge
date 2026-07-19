import { useState } from 'react';
import { ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { STATUS_COLORS, STATUS_LABELS } from './constants';
import { Panel } from './ui';

/**
 * 项目管理面板
 * props: { projects: Array }
 */
export default function ProjectsPanel({ projects }) {
  const [expanded, setExpanded] = useState({});

  if (!projects || projects.length === 0) return null;

  return (
    <Panel title="项目管理" trailing={`${projects.length} 个项目`} className="mb-6">
      <div className="space-y-3">
        {projects.map((proj) => (
          <div
            key={proj.id}
            className="border border-[var(--border-color)] rounded-lg overflow-hidden"
          >
            <button
              onClick={() => setExpanded((prev) => ({ ...prev, [proj.id]: !prev[proj.id] }))}
              className="w-full flex items-center justify-between p-3 hover:bg-[var(--bg-hover)] transition-colors text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[proj.status] || STATUS_COLORS.pending}`}>
                  {STATUS_LABELS[proj.status] || proj.status}
                </span>
                <span className="font-medium text-sm text-text-primary truncate">{proj.name}</span>
                <span className="text-xs text-text-secondary shrink-0">负责人: {proj.owner}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-2 w-40">
                  <div className="flex-1 h-1.5 bg-bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        proj.progress >= 100 ? 'bg-green-500' : proj.progress >= 50 ? 'bg-blue-500' : 'bg-yellow-500'
                      }`}
                      style={{ width: `${Math.min(proj.progress, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-text-secondary w-10 text-right">{proj.progress}%</span>
                </div>
                {expanded[proj.id] ? (
                  <ChevronUpIcon className="w-4 h-4 text-text-muted" />
                ) : (
                  <ChevronDownIcon className="w-4 h-4 text-text-muted" />
                )}
              </div>
            </button>

            {expanded[proj.id] && (
              <div className="border-t border-[var(--border-color)] p-3 bg-bg-muted">
                <div className="flex items-center gap-4 text-xs text-text-secondary mb-3">
                  <span>共 {proj.taskCount} 任务</span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    {proj.tasksDone} 完成
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    {proj.tasksInProgress} 进行中
                  </span>
                  {proj.tasksBlocked > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      {proj.tasksBlocked} 阻塞
                    </span>
                  )}
                  <span>{proj.milestoneCount} 里程碑</span>
                </div>

                {proj.taskCount > 0 && (
                  <div className="flex h-2 bg-bg-muted rounded-full overflow-hidden">
                    {proj.tasksDone > 0 && (
                      <div
                        className="bg-green-500 transition-all"
                        style={{ width: `${(proj.tasksDone / proj.taskCount) * 100}%` }}
                      />
                    )}
                    {proj.tasksInProgress > 0 && (
                      <div
                        className="bg-blue-500 transition-all"
                        style={{ width: `${(proj.tasksInProgress / proj.taskCount) * 100}%` }}
                      />
                    )}
                    {proj.tasksBlocked > 0 && (
                      <div
                        className="bg-red-500 transition-all"
                        style={{ width: `${(proj.tasksBlocked / proj.taskCount) * 100}%` }}
                      />
                    )}
                  </div>
                )}

                {proj.taskCount === 0 && (
                  <p className="text-xs text-text-muted italic">暂无任务，等待 PM 分解</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
