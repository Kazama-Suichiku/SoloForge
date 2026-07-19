/**
 * SoloForge - IPC 通信类型定义
 * 主进程与渲染进程之间的数据结构契约
 */

// ─────────────────────────────────────────────────────────────
// 任务相关
// ─────────────────────────────────────────────────────────────

/** 任务执行请求 */
export interface TaskRequest {
  /** 任务唯一标识 */
  taskId: string;
  /** 任务类型 */
  taskType: string;
  /** 输入数据 */
  input: Record<string, unknown>;
  /** 参与执行的 Agent 列表 */
  agents: string[];
}

/** 任务进度更新 */
export interface TaskProgress {
  /** 任务唯一标识 */
  taskId: string;
  /** 当前执行的 Agent ID */
  currentAgent: string;
  /** 进度百分比 0-100 */
  progress: number;
  /** 状态描述信息 */
  message: string;
}

/** 任务执行结果 */
export interface TaskResult {
  /** 任务唯一标识 */
  taskId: string;
  /** 是否成功完成（含部分成功） */
  success: boolean;
  /** 输出数据 */
  output?: Record<string, unknown>;
  /** 错误信息（失败时） */
  error?: string;
  /** 部分成功时，记录失败的 Agent 及原因 */
  partialSuccess?: {
    failedAgent: string;
    error: string;
    completedAgents: string[];
  };
}

// ─────────────────────────────────────────────────────────────
// Agent 相关
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// 核心业务实体（P2-8 类型安全补全）
// ─────────────────────────────────────────────────────────────

/** Agent 职级 */
export type AgentLevel = 'C_LEVEL' | 'VP' | 'DIRECTOR' | 'MANAGER' | 'SENIOR' | 'STAFF' | 'INTERN' | 'ASSISTANT';

/** Agent 生命周期状态（持久身份态） */
export type LifecycleStatus = 'active' | 'suspended' | 'terminated';

/** Agent 运行时状态（瞬时执行态） */
export type RuntimeStatus = 'idle' | 'running' | 'completed' | 'error';

/** Agent 配置 */
export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  title: string;
  level: AgentLevel;
  departments: string[];
  /** 兼容字段：主部门 ID（已废弃，用 departments） */
  department?: string;
  description?: string;
  avatar?: string;
  model: string;
  status: LifecycleStatus;
  hireDate: number | null;
  probationEnd?: number | null;
  promotionHistory?: Array<{ from: AgentLevel; to: AgentLevel; date: number; reason?: string }>;
  onboardingChecklist?: Array<{ id: string; title: string; done: boolean }>;
}

/** 对话类型 */
export type ConversationType = 'private' | 'group' | 'department';

/** 对话 */
export interface Conversation {
  id: string;
  type: ConversationType;
  name?: string;
  participants: string[];
  createdAt: number;
  lastMessage?: Message;
  /** 清屏时间戳（仅影响显示，不删除历史） */
  displayClearedAt?: number;
  departmentId?: string;
  ownerId?: string;
}

/** 附件 */
export interface Attachment {
  id: string;
  type: 'image' | 'audio';
  path: string;
  mimeType?: string;
  size?: number;
}

/** 工具调用 */
export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  success?: boolean;
  durationMs?: number;
  error?: string;
}

/** 消息状态 */
export type MessageStatus = 'sending' | 'sent' | 'error';

/** 消息 */
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: 'user' | 'agent' | 'system';
  content: string;
  attachments?: Attachment[];
  status?: MessageStatus;
  toolCalls?: ToolCall[];
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/** 工具定义 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category?: string;
  timeoutMs?: number;
  maxResultTokens?: number;
  execute: (args: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────
// 运营管理（OKR/KPI/Task）
// ─────────────────────────────────────────────────────────────

export type GoalType = 'strategic' | 'quarterly' | 'monthly' | 'weekly';

export interface Goal {
  id: string;
  title: string;
  type: GoalType;
  ownerId: string;
  department?: string;
  progress: number;
  status: 'active' | 'completed' | 'cancelled';
  keyResults?: Array<{ id: string; title: string; current: number; target: number }>;
  dueDate?: number;
  parentId?: string;
}

export type KpiDirection = 'higher_better' | 'lower_better' | 'target_exact';

export interface KPI {
  id: string;
  name: string;
  unit: string;
  target: number;
  current: number;
  direction: KpiDirection;
  period?: string;
  history?: Array<{ timestamp: number; value: number }>;
}

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';

export interface Task {
  id: string;
  title: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assigneeId?: string;
  requesterId?: string;
  goalId?: string;
  projectId?: string;
  status: TaskStatus;
  cancelReason?: string;
  createdAt?: number;
  completedAt?: number;
}

// ─────────────────────────────────────────────────────────────
// 项目管理
// ─────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  ownerId: string;
  goalId?: string;
  name: string;
  description?: string;
  milestones: Milestone[];
  tasks: ProjectTask[];
  status: 'active' | 'completed' | 'cancelled';
  standupIntervalMs?: number;
  nextStandupAt?: number;
}

export interface Milestone {
  id: string;
  title: string;
  dueDate?: number;
  progress: number;
}

export interface ProjectTask {
  id: string;
  milestoneId?: string;
  assigneeId?: string;
  title: string;
  status: TaskStatus;
  dependencies?: string[];
  /** 关联的委派任务 ID（三向联动） */
  delegatedTaskId?: string;
  /** 关联的运营任务 ID（三向联动） */
  opsTaskId?: string;
  blockerNote?: string;
  progressNotes?: ProgressNote[];
}

export interface ProgressNote {
  id: string;
  timestamp: number;
  note: string;
  authorId?: string;
}

// ─────────────────────────────────────────────────────────────
// 财务/预算
// ─────────────────────────────────────────────────────────────

export type BudgetAction = 'allow' | 'warn' | 'downgrade' | 'block';

export interface AgentBudget {
  agentId: string;
  dailyLimit: number;
  totalLimit?: number;
  balance: number;
  dailySalary: number;
  lastPayday: number;
  enabled: boolean;
}

export interface BudgetConfig {
  defaultDailyLimit: number;
  warnThreshold: number;
  downgradeThreshold: number;
  blockThreshold: number;
}

export interface BudgetAlert {
  id: string;
  level: 'info' | 'warn' | 'critical';
  scope: 'agent' | 'global';
  agentId?: string;
  message: string;
  currentUsage: number;
  limit: number;
  percentage: number;
  timestamp: string;
  acknowledged: boolean;
}

export interface TokenUsageRecord {
  agentId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  conversationId?: string;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────
// 记忆系统
// ─────────────────────────────────────────────────────────────

export type MemoryType =
  | 'decision' | 'fact' | 'preference' | 'project_context' | 'lesson'
  | 'expertise' | 'conversation_summary' | 'task_result' | 'procedure'
  | 'user_profile' | 'company_fact' | 'consensus';

export type MemoryScope = 'agent' | 'user' | 'shared';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  agentId?: string;
  content: string;
  tags?: string[];
  importance: number;
  archived: boolean;
  supersededBy?: string;
  decayScore?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  byScope: Record<MemoryScope, number>;
  archived: number;
}

// ─────────────────────────────────────────────────────────────
// 协作通信
// ─────────────────────────────────────────────────────────────

export interface DelegatedTask {
  id: string;
  fromAgent: string;
  toAgent: string;
  taskDescription: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 1 | 2 | 3 | 4 | 5;
  discussion?: AgentMessage[];
  createdAt: number;
}

export interface AgentMessage {
  id: string;
  fromAgent: string;
  toAgent: string;
  content: string;
  type: 'message' | 'delegation' | 'discussion' | 'mention';
  timestamp: number;
}

export interface DevPlan {
  id: string;
  agentId: string;
  plan: string;
  status: 'pending' | 'approved' | 'rejected' | 'revising';
  reviewerId?: string;
  createdAt: number;
}

export interface AgentRequest {
  id: string;
  requesterId: string;
  requestType: 'recruit' | 'promote' | 'demote' | 'suspend' | 'terminate';
  targetId?: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  discussion?: Array<{ agentId: string; message: string; timestamp: number }>;
}

export interface TerminationRequest {
  id: string;
  agentId: string;
  requesterId: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

export interface Department {
  id: string;
  name: string;
  color?: string;
  headId?: string;
  description?: string;
}

// ─────────────────────────────────────────────────────────────
// 云同步
// ─────────────────────────────────────────────────────────────

export interface SyncStatus {
  configured: boolean;
  needsReauth?: boolean;
  lastSyncAt?: Record<string, number>;
  stats?: {
    conversations: number;
    messages: number;
    agents: number;
  };
}

export interface SyncResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  needsReauth?: boolean;
  syncedAt?: number;
  stats?: Record<string, number>;
  errors?: string[];
}

// ─────────────────────────────────────────────────────────────
// IPC 通道类型映射（部分关键通道）
// ─────────────────────────────────────────────────────────────

export interface IpcChannels {
  'agent:execute-task': { request: TaskRequest; response: TaskResult };
  'agent:cancel-task': { request: { taskId: string }; response: { success: boolean } };
  'chat:send-message': { request: { conversationId: string; content: string; attachments?: Attachment[] }; response: { success: boolean } };
  'chat:send-message-stream': { request: { conversationId: string; content: string; attachments?: Attachment[] }; response: { success: boolean } };
  'chat:stream': { event: { conversationId: string; messageId: string; chunk: string } };
  'chat:complete': { event: { conversationId: string; messageId: string; content: string } };
  'sync:manual-sync': { request: void; response: SyncResult };
  'sync:get-status': { request: void; response: { success: boolean; data?: SyncStatus } };
  'sync:pull': { request: void; response: SyncResult };
  'sync:push': { request: void; response: SyncResult };
  'account:login': { request: { username: string; password: string }; response: { success: boolean; account?: { id: string; username: string } } };
  'company:select': { request: { companyId: string }; response: { success: boolean; company?: { id: string; name: string } } };
}


/** Agent 状态 */
export interface AgentStatus {
  /** Agent 唯一标识 */
  agentId: string;
  /** Agent 显示名称 */
  name: string;
  /** 状态：idle | running | completed | error */
  status: 'idle' | 'running' | 'completed' | 'error';
  /** 当前执行的任务 ID（running 时） */
  currentTask?: string;
}
