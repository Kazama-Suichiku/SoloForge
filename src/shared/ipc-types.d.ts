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
