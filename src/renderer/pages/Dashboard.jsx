import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FlagIcon,
  CheckCircleIcon,
  ChartBarIcon,
  UserPlusIcon,
  ArrowsRightLeftIcon,
  ChatBubbleLeftIcon,
  ClipboardDocumentCheckIcon,
  CogIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  MapPinIcon,
  CalendarDaysIcon,
  UserIcon,
  ClipboardDocumentListIcon,
  StopCircleIcon,
  InboxIcon,
  ExclamationTriangleIcon,
  BookmarkIcon,
} from '@heroicons/react/24/outline';
import {
  FlagIcon as FlagSolidIcon,
  CheckCircleIcon as CheckCircleSolidIcon,
} from '@heroicons/react/24/solid';

// ─────────────────────────────────────────────────────────────
// 常量 & 映射
// ─────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  pending: 'bg-bg-muted text-text-secondary',
  in_progress: 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300',
  completed: 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300',
  done: 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300',
  todo: 'bg-bg-muted text-text-secondary',
  review: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900 dark:text-yellow-300',
  discussing: 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300',
  approved: 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300',
  rejected: 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300',
};

const STATUS_LABELS = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  done: '已完成',
  cancelled: '已取消',
  todo: '待办',
  review: '审核中',
  discussing: '讨论中',
  approved: '已批准',
  rejected: '已拒绝',
};

const PRIORITY_COLORS = {
  high: 'bg-red-500',
  medium: 'bg-yellow-400',
  low: 'bg-gray-300 dark:bg-gray-500',
};

const PRIORITY_LABELS = {
  high: '高',
  medium: '中',
  low: '低',
};

const GOAL_TYPE_LABELS = {
  strategic: '战略目标',
  quarterly: '季度目标',
  monthly: '月度目标',
  weekly: '周目标',
};

const GOAL_TYPE_COLORS = {
  strategic: 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300',
  quarterly: 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300',
  monthly: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900 dark:text-cyan-300',
  weekly: 'bg-bg-muted text-text-secondary',
};

const KPI_DIRECTION_LABELS = {
  higher_better: '越高越好',
  lower_better: '越低越好',
  target_exact: '精确达标',
};

const STAGE_LABELS = {
  thinking: '思考中',
  tools: '执行工具',
  responding: '回复中',
};

const STAGE_COLORS = {
  thinking: 'bg-blue-500',
  tools: 'bg-yellow-500',
  responding: 'bg-green-500',
};

const STAT_BAR_COLORS = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  purple: 'bg-purple-500',
  red: 'bg-red-500',
  cyan: 'bg-cyan-500',
};

const PAGE_SIZE = 8;

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms) {
  if (ms < 1000) return '刚刚开始';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}分${remainSec > 0 ? remainSec + '秒' : ''}`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}小时${remainMin > 0 ? remainMin + '分' : ''}`;
}

// ─────────────────────────────────────────────────────────────
// 基础 UI 组件
// ─────────────────────────────────────────────────────────────

/** 展开/收起箭头 */
function ChevronIcon({ expanded }) {
  return (
    <ChevronRightIcon
      className={`w-4 h-4 text-text-muted transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
    />
  );
}

/** 详情字段 */
function DetailField({ label, value, className = '' }) {
  if (!value) return null;
  return (
    <div className={className}>
      <span className="text-xs text-text-muted">{label}</span>
      <p className="text-sm text-text-primary mt-0.5">{value}</p>
    </div>
  );
}

/** 统一空状态 */
function EmptyState({ icon: Icon, message, hint }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-text-muted">
      {Icon && <Icon className="w-8 h-8 mb-2 opacity-40" />}
      <p className="text-sm">{message}</p>
      {hint && <p className="text-xs mt-1 opacity-70">{hint}</p>}
    </div>
  );
}

/** 统一分页控件 */
function Pagination({ current, total, onChange, itemCount }) {
  if (total <= 1) {
    if (itemCount > 0) {
      return (
        <div className="mt-3 text-center">
          <span className="text-xs text-text-muted">共 {itemCount} 条</span>
        </div>
      );
    }
    return null;
  }

  const pages = Array.from({ length: total }, (_, i) => i + 1)
    .filter((p) => {
      if (total <= 5) return true;
      if (p === 1 || p === total) return true;
      return Math.abs(p - current) <= 1;
    })
    .reduce((acc, p, i, arr) => {
      if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
      acc.push(p);
      return acc;
    }, []);

  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border-color)]/50">
      <span className="text-xs text-text-muted">
        共 {itemCount} 条，第 {current}/{total} 页
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, current - 1))}
          disabled={current <= 1}
          className="p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:bg-[var(--bg-hover)]"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        {pages.map((item, i) =>
          item === '...' ? (
            <span key={`e-${i}`} className="px-1 text-xs text-text-muted">...</span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onChange(item)}
              className={`w-6 h-6 text-xs rounded transition-colors ${
                item === current
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium'
                  : 'text-text-secondary hover:bg-[var(--bg-hover)]'
              }`}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onChange(Math.min(total, current + 1))}
          disabled={current >= total}
          className="p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:bg-[var(--bg-hover)]"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** 进度条 */
function ProgressBar({ value, max = 100, size = 'md', color = 'blue' }) {
  const percentage = Math.min(100, Math.round((value / max) * 100));
  const sizeClasses = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' };
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
  };

  return (
    <div className={`w-full bg-bg-muted rounded-full ${sizeClasses[size]}`}>
      <div
        className={`${colorClasses[color]} ${sizeClasses[size]} rounded-full transition-all duration-300`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

/** 统计卡片 -- 左侧彩条 + 纯数字，无图标方块 */
function StatCard({ title, value, subtitle, color = 'blue' }) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-[var(--border-color)] p-4 flex gap-3 overflow-hidden relative">
      {/* 左侧彩条 */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${STAT_BAR_COLORS[color]}`} />
      <div className="pl-2">
        <p className="text-xs text-text-secondary leading-none">{title}</p>
        <p className="text-2xl font-semibold text-text-primary mt-1.5 leading-none">{value}</p>
        {subtitle && (
          <p className="text-xs text-text-muted mt-1.5 leading-snug">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

/** 面板容器 -- 统一卡片外观 */
function Panel({ title, trailing, children, className = '' }) {
  return (
    <div className={`bg-bg-elevated rounded-xl border border-[var(--border-color)] ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]/60">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {trailing && <span className="text-xs text-text-muted">{trailing}</span>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 目标列表
// ─────────────────────────────────────────────────────────────

function GoalsList({ goals }) {
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);

  if (!goals.length) {
    return <EmptyState icon={FlagIcon} message="暂无目标" hint="CXO 可以通过对话创建目标" />;
  }

  const totalPages = Math.ceil(goals.length / PAGE_SIZE);
  const display = goals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="space-y-2">
        {display.map((goal) => {
          const isExpanded = expandedId === goal.id;
          return (
            <div
              key={goal.id}
              className={`rounded-lg border transition-colors ${
                isExpanded
                  ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
                  : 'bg-bg-muted border-[var(--border-color)] hover:border-[var(--border-color)]'
              }`}
            >
              <button
                type="button"
                className="w-full p-3 text-left"
                onClick={() => setExpandedId(isExpanded ? null : goal.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <ChevronIcon expanded={isExpanded} />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-text-primary truncate">{goal.title}</h4>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {goal.owner} · {goal.department || '未分配部门'}
                      </p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${STATUS_COLORS[goal.status] || STATUS_COLORS.pending}`}>
                    {STATUS_LABELS[goal.status] || goal.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 pl-6">
                  <ProgressBar value={goal.progress} size="sm" color={goal.progress >= 80 ? 'green' : 'blue'} />
                  <span className="text-xs text-text-secondary whitespace-nowrap">{goal.progress}%</span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-6 mr-3">
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    {goal.type && (
                      <div>
                        <span className="text-xs text-text-muted">类型</span>
                        <div className="mt-0.5">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${GOAL_TYPE_COLORS[goal.type] || ''}`}>
                            {GOAL_TYPE_LABELS[goal.type] || goal.type}
                          </span>
                        </div>
                      </div>
                    )}
                    <DetailField label="截止日期" value={formatDate(goal.dueDate)} />
                    <DetailField label="创建时间" value={formatDate(goal.createdAt)} />
                    <DetailField label="更新时间" value={formatDate(goal.updatedAt)} />
                  </div>

                  {goal.description && (
                    <div className="mt-3">
                      <span className="text-xs text-text-muted">描述</span>
                      <p className="text-sm text-text-primary mt-0.5 whitespace-pre-wrap">
                        {goal.description}
                      </p>
                    </div>
                  )}

                  {Array.isArray(goal.keyResults) && goal.keyResults.length > 0 && (
                    <div className="mt-3">
                      <span className="text-xs text-text-muted">关键结果（KR）</span>
                      <ul className="mt-1 space-y-1">
                        {goal.keyResults.map((kr, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-text-primary">
                            <span className="text-text-muted shrink-0">-</span>
                            <span>{typeof kr === 'string' ? kr : JSON.stringify(kr)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pagination current={page} total={totalPages} onChange={setPage} itemCount={goals.length} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 任务列表
// ─────────────────────────────────────────────────────────────

function TasksList({ tasks, goals }) {
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);

  if (!tasks.length) {
    return <EmptyState icon={CheckCircleIcon} message="暂无任务" hint="CXO 可以通过对话分配任务" />;
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
      <div className="space-y-1">
        {display.map((task) => {
          const isExpanded = expandedId === task.id;
          const linkedGoal = task.goalId ? goalMap[task.goalId] : null;

          return (
            <div
              key={task.id}
              className={`rounded-lg transition-colors ${
                isExpanded
                  ? 'bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800'
                  : 'hover:bg-[var(--bg-hover)] border border-transparent'
              }`}
            >
              <button
                type="button"
                className="w-full flex items-center gap-3 p-2.5 text-left"
                onClick={() => setExpandedId(isExpanded ? null : task.id)}
              >
                <ChevronIcon expanded={isExpanded} />
                {/* 优先级小圆点 */}
                <span className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.low}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{task.title}</p>
                  <p className="text-xs text-text-secondary">
                    {task.assignee} · {new Date(task.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${STATUS_COLORS[task.status] || STATUS_COLORS.todo}`}>
                  {STATUS_LABELS[task.status] || task.status}
                </span>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-9">
                  {task.description && (
                    <div className="mb-3">
                      <span className="text-xs text-text-muted">描述</span>
                      <p className="text-sm text-text-primary mt-0.5 whitespace-pre-wrap">
                        {task.description}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs text-text-muted">优先级</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[task.priority]}`} />
                        <span className="text-sm text-text-primary">
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

                  {linkedGoal && (
                    <div className="mt-3 p-2 bg-bg-muted rounded-lg flex items-center gap-2">
                      <FlagSolidIcon className="w-4 h-4 text-blue-500 shrink-0" />
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-text-primary truncate">{linkedGoal.title}</span>
                        <span className="text-xs text-text-muted shrink-0">{linkedGoal.progress}%</span>
                      </div>
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

// ─────────────────────────────────────────────────────────────
// KPI 列表
// ─────────────────────────────────────────────────────────────

function KPIsList({ kpis }) {
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);

  if (!kpis.length) {
    return <EmptyState icon={ChartBarIcon} message="暂无 KPI" hint="CXO 可以通过对话创建 KPI" />;
  }

  const totalPages = Math.ceil(kpis.length / PAGE_SIZE);
  const display = kpis.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="space-y-2">
        {display.map((kpi) => {
          const isExpanded = expandedId === kpi.id;
          const progressNum = parseInt(kpi.progress) || 0;
          const isOnTrack = progressNum >= 80;
          const isAtRisk = progressNum < 50;

          return (
            <div
              key={kpi.id}
              className={`rounded-lg border transition-colors ${
                isExpanded
                  ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
                  : 'bg-bg-muted border-[var(--border-color)] hover:border-[var(--border-color)]'
              }`}
            >
              <button
                type="button"
                className="w-full p-3 text-left"
                onClick={() => setExpandedId(isExpanded ? null : kpi.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ChevronIcon expanded={isExpanded} />
                    <div>
                      <h4 className="font-medium text-sm text-text-primary">{kpi.name}</h4>
                      <p className="text-xs text-text-secondary">{kpi.owner}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-text-primary">{kpi.current}</p>
                    <p className="text-xs text-text-secondary">目标: {kpi.target}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 pl-6">
                  <ProgressBar
                    value={progressNum}
                    size="sm"
                    color={isOnTrack ? 'green' : isAtRisk ? 'red' : 'yellow'}
                  />
                  <span className={`text-xs whitespace-nowrap ${isOnTrack ? 'text-green-500' : isAtRisk ? 'text-red-500' : 'text-yellow-500'}`}>
                    {kpi.progress}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-6 mr-3">
                  {kpi.description && (
                    <div className="mb-3">
                      <span className="text-xs text-text-muted">描述</span>
                      <p className="text-sm text-text-primary mt-0.5 whitespace-pre-wrap">
                        {kpi.description}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <DetailField label="部门" value={kpi.department} />
                    <DetailField label="周期" value={kpi.period} />
                    {kpi.direction && (
                      <div>
                        <span className="text-xs text-text-muted">方向</span>
                        <p className="text-sm text-text-primary mt-0.5">
                          {KPI_DIRECTION_LABELS[kpi.direction] || kpi.direction}
                        </p>
                      </div>
                    )}
                  </div>

                  {kpi.history && kpi.history.length > 0 && (
                    <div className="mt-3">
                      <span className="text-xs text-text-muted">
                        变更历史（最近 {Math.min(kpi.history.length, 5)} 条）
                      </span>
                      <div className="mt-1 space-y-1">
                        {kpi.history.slice(-5).reverse().map((entry, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs p-1.5 bg-bg-elevated rounded"
                          >
                            <span className="text-text-secondary">{formatDateTime(entry.date)}</span>
                            <span className="font-medium text-text-primary">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pagination current={page} total={totalPages} onChange={setPage} itemCount={kpis.length} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 活动时间线
// ─────────────────────────────────────────────────────────────

const CATEGORY_ICONS = {
  goal: FlagIcon,
  kpi: ChartBarIcon,
  task: CheckCircleIcon,
  recruit: UserPlusIcon,
  approval: CheckCircleSolidIcon,
  system: CogIcon,
};

const CATEGORY_COLORS = {
  goal: 'text-blue-500',
  kpi: 'text-purple-500',
  task: 'text-green-500',
  recruit: 'text-yellow-500',
  approval: 'text-emerald-500',
  system: 'text-text-muted',
};

function ActivityTimeline({ activities }) {
  const [page, setPage] = useState(1);

  if (!activities.length) {
    return <EmptyState icon={InboxIcon} message="暂无活动记录" />;
  }

  const totalPages = Math.ceil(activities.length / PAGE_SIZE);
  const display = activities.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="space-y-3">
        {display.map((activity, idx) => {
          const Icon = CATEGORY_ICONS[activity.category] || BookmarkIcon;
          const colorClass = CATEGORY_COLORS[activity.category] || 'text-text-muted';
          return (
            <div key={idx} className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-bg-muted flex items-center justify-center shrink-0">
                <Icon className={`w-3.5 h-3.5 ${colorClass}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary leading-snug">{activity.action}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {activity.actor} · {new Date(activity.time).toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <Pagination current={page} total={totalPages} onChange={setPage} itemCount={activities.length} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 招聘审批列表
// ─────────────────────────────────────────────────────────────

function RecruitmentList({ requests }) {
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);

  if (!requests.length) {
    return <EmptyState icon={UserPlusIcon} message="暂无招聘申请" />;
  }

  const totalPages = Math.ceil(requests.length / PAGE_SIZE);
  const display = requests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="space-y-1">
        {display.map((req) => {
          const isExpanded = expandedId === req.id;
          return (
            <div
              key={req.id}
              className={`rounded-lg transition-colors ${
                isExpanded
                  ? 'bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800'
                  : 'hover:bg-[var(--bg-hover)] border border-transparent'
              }`}
            >
              <button
                type="button"
                className="w-full flex items-center gap-3 p-2.5 text-left"
                onClick={() => setExpandedId(isExpanded ? null : req.id)}
              >
                <ChevronIcon expanded={isExpanded} />
                <div className="w-7 h-7 rounded-full bg-bg-muted flex items-center justify-center shrink-0">
                  <UserIcon className="w-3.5 h-3.5 text-text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">
                    {req.candidateName || '(未命名)'}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {req.candidateTitle} · 申请人: {req.requester}
                  </p>
                </div>
                <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${STATUS_COLORS[req.status] || STATUS_COLORS.pending}`}>
                  {STATUS_LABELS[req.status] || req.status}
                </span>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-9">
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <DetailField label="部门" value={req.department} />
                    <DetailField label="申请人" value={req.requester} />
                    <DetailField label="申请时间" value={formatDate(req.createdAt)} />
                    {req.reviewedAt && <DetailField label="审批时间" value={formatDate(req.reviewedAt)} />}
                    {req.reviewedBy && <DetailField label="审批人" value={req.reviewedBy} />}
                    {req.revisionCount > 0 && (
                      <div>
                        <span className="text-xs text-text-muted">简历修订</span>
                        <p className="text-sm text-text-primary mt-0.5">{req.revisionCount} 次</p>
                      </div>
                    )}
                  </div>

                  {req.discussionCount > 0 && (
                    <div className="mt-3 p-2 bg-bg-muted rounded-lg flex items-center gap-2">
                      <ChatBubbleLeftIcon className="w-4 h-4 text-text-muted shrink-0" />
                      <span className="text-xs text-text-secondary">
                        {req.discussionCount} 轮面试讨论
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pagination current={page} total={totalPages} onChange={setPage} itemCount={requests.length} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 开除审批面板
// ─────────────────────────────────────────────────────────────

const TERM_STATUS_COLORS = {
  pending: 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300',
  confirmed: 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300',
  rejected: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  cancelled: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
};

const TERM_STATUS_LABELS = {
  pending: '待审批',
  confirmed: '已开除',
  rejected: '已拒绝',
  cancelled: '已撤回',
};

function TerminationApprovalPanel({ requests, onRefresh }) {
  const [expandedId, setExpandedId] = useState(null);
  const [decidingId, setDecidingId] = useState(null);
  const [comment, setComment] = useState('');

  const handleDecide = useCallback(async (requestId, approved) => {
    setDecidingId(requestId);
    try {
      const result = await window.electronAPI.terminationDecide({
        requestId,
        approved,
        comment: comment.trim() || (approved ? '批准开除' : '不予开除'),
      });
      if (result.success) {
        setComment('');
        setExpandedId(null);
        if (onRefresh) onRefresh();
      } else {
        console.error('审批失败:', result.error);
      }
    } catch (error) {
      console.error('审批操作异常:', error);
    } finally {
      setDecidingId(null);
    }
  }, [comment, onRefresh]);

  if (!requests || requests.length === 0) {
    return <EmptyState icon={ExclamationTriangleIcon} message="暂无开除申请" />;
  }

  // 待处理的排在前面
  const sorted = [...requests].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return (
    <div className="space-y-1">
      {sorted.map((req) => {
        const isExpanded = expandedId === req.id;
        const isPending = req.status === 'pending';
        const isDeciding = decidingId === req.id;

        return (
          <div
            key={req.id}
            className={`rounded-lg transition-colors ${
              isExpanded
                ? isPending
                  ? 'bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800'
                  : 'bg-[var(--bg-hover)] border border-[var(--border-color)]'
                : isPending
                  ? 'hover:bg-orange-50/30 dark:hover:bg-orange-950/10 border border-transparent'
                  : 'hover:bg-[var(--bg-hover)] border border-transparent'
            }`}
          >
            <button
              type="button"
              className="w-full flex items-center gap-3 p-2.5 text-left"
              onClick={() => {
                setExpandedId(isExpanded ? null : req.id);
                setComment('');
              }}
            >
              <ChevronIcon expanded={isExpanded} />
              <div className="w-7 h-7 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0">
                <ExclamationTriangleIcon className="w-3.5 h-3.5 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">
                  {req.agentName || req.agentId}
                  {req.agentTitle && <span className="text-text-muted ml-1">({req.agentTitle})</span>}
                </p>
                <p className="text-xs text-text-secondary truncate">
                  {req.proposedByName || req.proposedBy} 提出 · {formatDateTime(req.createdAt)}
                </p>
              </div>
              <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${TERM_STATUS_COLORS[req.status] || TERM_STATUS_COLORS.pending}`}>
                {TERM_STATUS_LABELS[req.status] || req.status}
              </span>
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-9">
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <DetailField label="员工" value={`${req.agentName} (${req.agentTitle || '未知职位'})`} />
                  <DetailField label="部门" value={req.department || '未知'} />
                  <DetailField label="提出人" value={req.proposedByName || req.proposedBy} />
                  <DetailField label="严重程度" value={req.severity === 'urgent' ? '紧急' : '一般'} />
                  <DetailField label="申请时间" value={formatDateTime(req.createdAt)} className="col-span-2" />
                </div>

                {/* 开除原因 */}
                <div className="mt-3 p-2.5 bg-bg-muted rounded-lg">
                  <span className="text-xs text-text-muted">开除原因</span>
                  <p className="text-sm text-text-primary mt-1">{req.reason || '未说明'}</p>
                </div>

                {/* 影响分析 */}
                {req.impactAnalysis && (
                  <div className="mt-2 p-2.5 bg-bg-muted rounded-lg">
                    <span className="text-xs text-text-muted">影响分析</span>
                    <p className="text-sm text-text-primary mt-1">{req.impactAnalysis}</p>
                  </div>
                )}

                {/* 已处理的显示结果 */}
                {req.status !== 'pending' && req.bossComment && (
                  <div className="mt-2 p-2.5 bg-bg-muted rounded-lg">
                    <span className="text-xs text-text-muted">老板批示</span>
                    <p className="text-sm text-text-primary mt-1">{req.bossComment}</p>
                  </div>
                )}
                {req.confirmedAt && (
                  <p className="text-xs text-text-muted mt-2">处理时间: {formatDateTime(req.confirmedAt)}</p>
                )}

                {/* 待处理的审批操作区 */}
                {isPending && (
                  <div className="mt-4 pt-3 border-t border-[var(--border-color)]/50">
                    {/* 批示输入 */}
                    <div className="mb-3">
                      <label className="text-xs text-text-muted mb-1 block">批示意见（可选）</label>
                      <input
                        type="text"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="输入批示意见..."
                        className="w-full px-3 py-1.5 text-sm bg-bg-base border border-[var(--border-color)] rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-text-primary placeholder-text-muted"
                        disabled={isDeciding}
                      />
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDecide(req.id, true); }}
                        disabled={isDeciding}
                        className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                      >
                        {isDeciding ? '处理中...' : '批准开除'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDecide(req.id, false); }}
                        disabled={isDeciding}
                        className="flex-1 px-3 py-2 text-sm font-medium text-text-primary bg-bg-muted hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors border border-[var(--border-color)]"
                      >
                        {isDeciding ? '处理中...' : '拒绝开除'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Agent 协作活动
// ─────────────────────────────────────────────────────────────

function CollaborationActivity({ activities }) {
  const [expandedId, setExpandedId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  if (!activities || activities.length === 0) {
    return <EmptyState icon={ArrowsRightLeftIcon} message="暂无协作记录" />;
  }

  const totalPages = Math.ceil(activities.length / PAGE_SIZE);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const displayActivities = activities.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <div>
      <div className="space-y-1">
        {displayActivities.map((activity, idx) => {
          const key = activity.id || idx;
          const isExpanded = expandedId === key;
          const TypeIcon = activity.type === 'message' ? ChatBubbleLeftIcon : ClipboardDocumentCheckIcon;
          const typeColor = activity.type === 'message' ? 'text-blue-500' : 'text-purple-500';

          return (
            <div
              key={key}
              className={`rounded-lg transition-colors ${
                isExpanded
                  ? 'bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800'
                  : 'hover:bg-[var(--bg-hover)] border border-transparent'
              }`}
            >
              <button
                type="button"
                className="w-full flex items-start gap-2.5 p-2.5 text-left"
                onClick={() => setExpandedId(isExpanded ? null : key)}
              >
                <ChevronIcon expanded={isExpanded} />
                <div className="w-6 h-6 rounded-full bg-bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <TypeIcon className={`w-3.5 h-3.5 ${typeColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-xs text-text-secondary">
                    <span className="font-medium text-text-primary">{activity.from}</span>
                    <ChevronRightIcon className="w-3 h-3 text-text-muted" />
                    <span className="font-medium text-text-primary">{activity.to}</span>
                    <span className="text-text-muted mx-0.5">|</span>
                    <span className="text-text-muted">{formatDateTime(activity.timestamp)}</span>
                  </div>
                  <p className="text-sm text-text-secondary truncate mt-0.5">{activity.summary}</p>
                </div>
                <span
                  className={`px-1.5 py-0.5 text-xs rounded shrink-0 ${
                    activity.status === 'completed' || activity.status === 'responded'
                      ? 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300'
                      : activity.status === 'failed'
                        ? 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300'
                        : 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900 dark:text-yellow-300'
                  }`}
                >
                  {activity.status === 'responded' ? '已回复' :
                   activity.status === 'completed' ? '已完成' :
                   activity.status === 'failed' ? '失败' :
                   activity.status === 'in_progress' ? '进行中' : '待处理'}
                </span>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-9">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      activity.type === 'message'
                        ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300'
                        : 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300'
                    }`}>
                      {activity.type === 'message' ? '消息' : '委派任务'}
                    </span>
                    {activity.type === 'task' && activity.priority && (
                      <span className={`text-xs ${
                        activity.priority <= 2 ? 'text-red-500' :
                        activity.priority <= 3 ? 'text-yellow-500' : 'text-text-muted'
                      }`}>
                        优先级 {activity.priority}
                      </span>
                    )}
                  </div>

                  {activity.content && (
                    <div className="mb-3">
                      <span className="text-xs text-text-muted">
                        {activity.type === 'message' ? '发送内容' : '任务描述'}
                      </span>
                      <div className="mt-1 p-2 bg-bg-elevated rounded text-sm text-text-primary whitespace-pre-wrap max-h-32 overflow-auto">
                        {activity.content}
                      </div>
                    </div>
                  )}

                  {activity.type === 'message' && activity.response && (
                    <div className="mb-3">
                      <span className="text-xs text-text-muted">回复内容</span>
                      <div className="mt-1 p-2 bg-green-50 dark:bg-green-950/30 rounded text-sm text-text-primary whitespace-pre-wrap max-h-32 overflow-auto">
                        {activity.response}
                      </div>
                    </div>
                  )}

                  {activity.type === 'task' && activity.result && (
                    <div className="mb-3">
                      <span className="text-xs text-text-muted">执行结果</span>
                      <div className="mt-1 p-2 bg-green-50 dark:bg-green-950/30 rounded text-sm text-text-primary whitespace-pre-wrap max-h-32 overflow-auto">
                        {activity.result}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <DetailField label="发起时间" value={formatDateTime(activity.timestamp)} />
                    {activity.respondedAt && <DetailField label="回复时间" value={formatDateTime(activity.respondedAt)} />}
                    {activity.startedAt && <DetailField label="开始执行" value={formatDateTime(activity.startedAt)} />}
                    {activity.completedAt && <DetailField label="完成时间" value={formatDateTime(activity.completedAt)} />}
                  </div>

                  {activity.type === 'task' && activity.discussionCount > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
                      <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
                      <span>{activity.discussionCount} 条讨论记录</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pagination current={currentPage} total={totalPages} onChange={setCurrentPage} itemCount={activities.length} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 项目管理面板
// ─────────────────────────────────────────────────────────────

function ProjectsPanel({ projects }) {
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

// ─────────────────────────────────────────────────────────────
// Agent 工作状态面板
// ─────────────────────────────────────────────────────────────

function AgentTaskPanel() {
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

// ─────────────────────────────────────────────────────────────
// 运营仪表板主组件
// ─────────────────────────────────────────────────────────────

export default function Dashboard({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    summary: null,
    goals: [],
    tasks: [],
    kpis: [],
    recruitRequests: [],
    terminationRequests: [],
    activityLog: [],
    collaboration: null,
    projects: [],
  });

  const loadData = useCallback(async () => {
    try {
      const [summary, goals, tasks, kpis, recruitRequests, terminationRequests, collaboration, projects] = await Promise.all([
        window.electronAPI.getOperationsSummary(),
        window.electronAPI.getOperationsGoals(),
        window.electronAPI.getOperationsTasks(),
        window.electronAPI.getOperationsKPIs(),
        window.electronAPI.getRecruitRequests(),
        window.electronAPI.getTerminationRequests?.() || Promise.resolve([]),
        window.electronAPI.getCollaborationSummary?.() || Promise.resolve(null),
        window.electronAPI.getProjectsSummary?.() || Promise.resolve([]),
      ]);

      setData({
        summary,
        goals: goals || [],
        tasks: tasks || [],
        kpis: kpis || [],
        recruitRequests: recruitRequests || [],
        terminationRequests: terminationRequests || [],
        activityLog: summary?.recentActivity || [],
        collaboration,
        projects: projects || [],
      });
    } catch (error) {
      console.error('加载仪表板数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-bg-base">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-gray-300 dark:border-gray-600 border-t-gray-900 dark:border-t-white rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-sm text-text-secondary">加载仪表板...</p>
        </div>
      </div>
    );
  }

  const { summary, goals: rawGoals = [], tasks: rawTasks = [], kpis, recruitRequests, terminationRequests, activityLog, collaboration, projects } = data;
  // 过滤掉已取消的目标和任务
  const goals = (rawGoals || []).filter((g) => g.status !== 'cancelled');
  const tasks = (rawTasks || []).filter((t) => t.status !== 'cancelled');
  const goalStats = summary?.goals || {};
  const taskStats = summary?.tasks || {};
  const kpiStats = summary?.kpis || {};
  const collabStats = collaboration || {};

  return (
    <div className="h-full bg-bg-base overflow-auto">
      {/* macOS 标题栏占位 */}
      <div className="shrink-0 h-8 drag-region" />

      <div className="max-w-7xl mx-auto py-6 px-6">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="p-1.5 hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
              >
                <ChevronLeftIcon className="w-5 h-5 text-text-secondary" />
              </button>
            )}
            <div>
              <h1 className="text-xl font-semibold text-text-primary">运营仪表板</h1>
              <p className="text-xs text-text-muted mt-0.5">公司运营状况概览</p>
            </div>
          </div>
          {/* H: 刷新按钮降权 -- ghost 样式 */}
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
          >
            <ArrowPathIcon className="w-4 h-4" />
            <span className="text-xs">刷新</span>
          </button>
        </div>

        {/* B: 统计卡片 -- 左侧彩条，无 emoji 图标 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <StatCard
            title="目标总数"
            value={goalStats.total || 0}
            subtitle={`进行中 ${goalStats.inProgress || 0} · 平均 ${goalStats.avgProgress || 0}%`}
            color="blue"
          />
          <StatCard
            title="任务总数"
            value={taskStats.total || 0}
            subtitle={`待办 ${taskStats.todo || 0} · 高优 ${taskStats.highPriority || 0}`}
            color="green"
          />
          <StatCard
            title="KPI 指标"
            value={kpiStats.total || 0}
            subtitle={`达标 ${kpiStats.onTrack || 0} · 风险 ${kpiStats.atRisk || 0}`}
            color="purple"
          />
          <StatCard
            title="招聘审批"
            value={recruitRequests.filter((r) => r.status === 'pending' || r.status === 'discussing').length}
            subtitle={`总计 ${recruitRequests.length} 个申请`}
            color="yellow"
          />
          <StatCard
            title="开除审批"
            value={(terminationRequests || []).filter((r) => r.status === 'pending').length}
            subtitle={`总计 ${(terminationRequests || []).length} 个申请`}
            color="red"
          />
          <StatCard
            title="团队协作"
            value={(collabStats.messageCount || 0) + (collabStats.taskCount || 0)}
            subtitle={`消息 ${collabStats.messageCount || 0} · 委派 ${collabStats.taskCount || 0}`}
            color="cyan"
          />
        </div>

        {/* 项目管理面板 */}
        {projects.length > 0 && <ProjectsPanel projects={projects} />}

        {/* Agent 工作状态面板 */}
        <AgentTaskPanel />

        {/* A: 两栏布局 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左栏 */}
          <div className="space-y-6">
            {/* E: 任务看板提到更显眼的位置 */}
            <Panel title="任务看板" trailing={`${tasks.length} 个任务`}>
              <TasksList tasks={tasks} goals={goals} />
              {tasks.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[var(--border-color)]/50">
                  <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-500" />
                      待办 {taskStats.todo || 0}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      进行中 {taskStats.inProgress || 0}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-yellow-500" />
                      审核 {taskStats.review || 0}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      完成 {taskStats.done || 0}
                    </span>
                  </div>
                </div>
              )}
            </Panel>

            {/* 目标 */}
            <Panel title="业务目标" trailing={`${goals.length} 个目标`}>
              <GoalsList goals={goals} />
            </Panel>

            {/* KPI */}
            <Panel title="KPI 指标" trailing={`${kpis.length} 个指标`}>
              <KPIsList kpis={kpis} />
            </Panel>
          </div>

          {/* 右栏 */}
          <div className="space-y-6">
            {/* Agent 协作 */}
            <Panel title="Agent 协作" trailing={`${collabStats.pendingTasks || 0} 待处理`}>
              <CollaborationActivity activities={collabStats.recentActivity} />
              {(collabStats.messageCount > 0 || collabStats.taskCount > 0) && (
                <div className="mt-3 pt-3 border-t border-[var(--border-color)] flex gap-4 text-xs text-text-muted">
                  <span>消息: {collabStats.messageCount || 0}</span>
                  <span>委派: {collabStats.taskCount || 0}</span>
                  <span>完成: {collabStats.completedTasks || 0}</span>
                </div>
              )}
            </Panel>

            {/* 开除审批 */}
            <Panel
              title="开除审批"
              trailing={`${(terminationRequests || []).filter((r) => r.status === 'pending').length} 待审批`}
            >
              <TerminationApprovalPanel requests={terminationRequests || []} onRefresh={loadData} />
            </Panel>

            {/* 招聘审批 */}
            <Panel
              title="招聘审批"
              trailing={`${recruitRequests.filter((r) => r.status === 'pending' || r.status === 'discussing').length} 待处理`}
            >
              <RecruitmentList requests={recruitRequests} />
            </Panel>

            {/* 最近活动 */}
            <Panel title="最近活动">
              <ActivityTimeline activities={activityLog} />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
