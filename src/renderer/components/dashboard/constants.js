// ─────────────────────────────────────────────────────────────
// Dashboard 共享常量 & 映射 —— Linear 风格
// 所有颜色用语义 token：text-tertiary / text-accent / text-success / text-warning / text-danger
// badge 背景统一 rgba(255,255,255,0.04)，状态靠文字色区分，不再用实色 dark:/light 双写
// ─────────────────────────────────────────────────────────────

// Badge tone 映射（统一传给 ui.jsx 的 Badge 组件）
export const STATUS_TONES = {
  pending: 'neutral',
  in_progress: 'accent',
  completed: 'success',
  done: 'success',
  cancelled: 'danger',
  todo: 'neutral',
  review: 'warning',
  discussing: 'warning',
  approved: 'success',
  rejected: 'danger',
};

// 兼容旧接口名（部分子组件仍引用 STATUS_COLORS）—— 全部用 Badge tone
export const STATUS_COLORS = STATUS_TONES;

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

// 优先级圆点 tone（StatusDot）
export const PRIORITY_TONES = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};
export const PRIORITY_COLORS = PRIORITY_TONES;

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

// 目标类型用 Badge tone
export const GOAL_TYPE_TONES = {
  strategic: 'accent',
  quarterly: 'accent',
  monthly: 'warning',
  weekly: 'neutral',
};
export const GOAL_TYPE_COLORS = GOAL_TYPE_TONES;

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

// Agent 阶段用 Badge tone
export const STAGE_TONES = {
  thinking: 'accent',
  tools: 'warning',
  responding: 'success',
};
export const STAGE_COLORS = STAGE_TONES;

// StatCard tone 映射（StatusDot 内嵌）
export const STAT_TONES = {
  blue: 'accent',
  green: 'success',
  yellow: 'warning',
  purple: 'accent',
  red: 'danger',
  cyan: 'accent',
};
export const STAT_BAR_COLORS = STAT_TONES;

export const PAGE_SIZE = 8;

// TerminationApprovalPanel 专用
export const TERM_STATUS_TONES = {
  pending: 'warning',
  confirmed: 'danger',
  rejected: 'neutral',
  cancelled: 'neutral',
};
export const TERM_STATUS_COLORS = TERM_STATUS_TONES;

export const TERM_STATUS_LABELS = {
  pending: '待审批',
  confirmed: '已开除',
  rejected: '已拒绝',
  cancelled: '已撤回',
};

export const TERM_PAGE_SIZE = 5;

// ActivityTimeline 专用 —— 去掉分类图标彩色，统一 text-tertiary
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

// 统一中性色，不再用蓝色/紫色装饰
export const CATEGORY_COLORS = {
  goal: 'text-text-tertiary',
  kpi: 'text-text-tertiary',
  task: 'text-text-tertiary',
  recruit: 'text-text-tertiary',
  approval: 'text-text-tertiary',
  system: 'text-text-quaternary',
};
