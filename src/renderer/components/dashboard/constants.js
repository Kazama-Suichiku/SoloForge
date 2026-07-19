// ─────────────────────────────────────────────────────────────
// Dashboard 共享常量 & 映射
// ─────────────────────────────────────────────────────────────

export const STATUS_COLORS = {
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

export const STATUS_LABELS = {
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

export const PRIORITY_COLORS = {
  high: 'bg-red-500',
  medium: 'bg-yellow-400',
  low: 'bg-gray-300 dark:bg-gray-500',
};

export const PRIORITY_LABELS = {
  high: '高',
  medium: '中',
  low: '低',
};

export const GOAL_TYPE_LABELS = {
  strategic: '战略目标',
  quarterly: '季度目标',
  monthly: '月度目标',
  weekly: '周目标',
};

export const GOAL_TYPE_COLORS = {
  strategic: 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300',
  quarterly: 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300',
  monthly: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900 dark:text-cyan-300',
  weekly: 'bg-bg-muted text-text-secondary',
};

export const KPI_DIRECTION_LABELS = {
  higher_better: '越高越好',
  lower_better: '越低越好',
  target_exact: '精确达标',
};

export const STAGE_LABELS = {
  thinking: '思考中',
  tools: '执行工具',
  responding: '回复中',
};

export const STAGE_COLORS = {
  thinking: 'bg-blue-500',
  tools: 'bg-yellow-500',
  responding: 'bg-green-500',
};

export const STAT_BAR_COLORS = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  purple: 'bg-purple-500',
  red: 'bg-red-500',
  cyan: 'bg-cyan-500',
};

export const PAGE_SIZE = 8;

// TerminationApprovalPanel 专用
export const TERM_STATUS_COLORS = {
  pending: 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300',
  confirmed: 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300',
  rejected: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  cancelled: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
};

export const TERM_STATUS_LABELS = {
  pending: '待审批',
  confirmed: '已开除',
  rejected: '已拒绝',
  cancelled: '已撤回',
};

export const TERM_PAGE_SIZE = 5;

// ActivityTimeline 专用
import {
  FlagIcon,
  ChartBarIcon,
  CheckCircleIcon,
  UserPlusIcon,
  CogIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';

export const CATEGORY_ICONS = {
  goal: FlagIcon,
  kpi: ChartBarIcon,
  task: CheckCircleIcon,
  recruit: UserPlusIcon,
  approval: CheckCircleSolidIcon,
  system: CogIcon,
};

export const CATEGORY_COLORS = {
  goal: 'text-blue-500',
  kpi: 'text-purple-500',
  task: 'text-green-500',
  recruit: 'text-yellow-500',
  approval: 'text-emerald-500',
  system: 'text-text-muted',
};
