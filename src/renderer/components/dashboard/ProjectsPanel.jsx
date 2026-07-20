import { useState } from 'react';
import { ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { STATUS_TONES, STATUS_LABELS } from './constants';
import { Panel, Badge, StatusDot, ProgressBar } from './ui';

/**
 * 项目管理面板 —— 进度条用 accent，状态用 pill badge
 * props: { projects: Array }
 */
export default function ProjectsPanel({ projects }) {
  const [expanded, setExpanded] = useState({});

  if (!projects || projects.length === 0) return null;

  return (
    <Panel title="项目管理" trailing={`${projects.length} 个项目`} className="mb-4">
      <div className="space-y-2">
        {projects.map((proj) => (
          <div
            key={proj.id}
            className="rounded-md border border-border-subtle overflow-hidden"
          >
            <button
              onClick={() => setExpanded((prev) => ({ ...prev, [proj.id]: !prev[proj.id] }))}
              className="w-full flex items-center justify-between p-3 hover:bg-bg-hover transition-colors-fast text-left"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Badge tone={STATUS_TONES[proj.status] || 'neutral'}>
                  {STATUS_LABELS[proj.status] || proj.status}
                </Badge>
                <span className="text-sm font-ui text-text-primary truncate">{proj.name}</span>
                <span className="text-xs text-text-tertiary shrink-0">负责人 {proj.owner}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-2 w-40">
                  <ProgressBar
                    value={proj.progress}
                    size="sm"
                    tone={proj.progress >= 100 ? 'success' : 'accent'}
                  />
                  <span className="text-xs font-mono text-text-tertiary w-10 text-right">{proj.progress}%</span>
                </div>
                {expanded[proj.id] ? (
                  <ChevronUpIcon className="w-3.5 h-3.5 text-text-quaternary" />
                ) : (
                  <ChevronDownIcon className="w-3.5 h-3.5 text-text-quaternary" />
                )}
              </div>
            </button>

            {expanded[proj.id] && (
              <div className="border-t border-border-subtle p-3" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                <div className="flex items-center gap-4 text-xs text-text-tertiary mb-3">
                  <span>共 {proj.taskCount} 任务</span>
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone="success" />
                    {proj.tasksDone} 完成
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone="accent" />
                    {proj.tasksInProgress} 进行中
                  </span>
                  {proj.tasksBlocked > 0 && (
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone="danger" />
                      {proj.tasksBlocked} 阻塞
                    </span>
                  )}
                  <span>{proj.milestoneCount} 里程碑</span>
                </div>

                {proj.taskCount > 0 && (
                  // 堆叠进度条：success / accent / danger，半透明
                  <div className="flex h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                    {proj.tasksDone > 0 && (
                      <div
                        className="transition-[width] duration-normal ease-out-quart"
                        style={{
                          width: `${(proj.tasksDone / proj.taskCount) * 100}%`,
                          backgroundColor: 'var(--color-success)',
                        }}
                      />
                    )}
                    {proj.tasksInProgress > 0 && (
                      <div
                        className="transition-[width] duration-normal ease-out-quart"
                        style={{
                          width: `${(proj.tasksInProgress / proj.taskCount) * 100}%`,
                          backgroundColor: 'var(--accent)',
                        }}
                      />
                    )}
                    {proj.tasksBlocked > 0 && (
                      <div
                        className="transition-[width] duration-normal ease-out-quart"
                        style={{
                          width: `${(proj.tasksBlocked / proj.taskCount) * 100}%`,
                          backgroundColor: 'var(--color-danger)',
                        }}
                      />
                    )}
                  </div>
                )}

                {proj.taskCount === 0 && (
                  <p className="text-xs text-text-quaternary">暂无任务，等待 PM 分解</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
