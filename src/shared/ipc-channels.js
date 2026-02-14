/**
 * SoloForge - IPC 频道常量定义
 * 主进程与渲染进程通信协议，统一管理所有 channel 名称
 * @module ipc-channels
 */

// ─────────────────────────────────────────────────────────────
// APP 相关
// ─────────────────────────────────────────────────────────────

/** @constant {string} 获取应用版本 (invoke) */
const APP_GET_VERSION = 'app:get-version';

/** @constant {string} 退出应用 (invoke) */
const APP_QUIT = 'app:quit';

// ─────────────────────────────────────────────────────────────
// AGENT 相关
// ─────────────────────────────────────────────────────────────

/** @constant {string} 执行任务 (invoke) */
const AGENT_EXECUTE_TASK = 'agent:execute-task';

/** @constant {string} 取消任务 (invoke) */
const AGENT_CANCEL_TASK = 'agent:cancel-task';

/** @constant {string} 获取 Agent 状态 (invoke) */
const AGENT_GET_STATUS = 'agent:get-status';

// ─────────────────────────────────────────────────────────────
// TASK 相关（主进程 -> 渲染进程，使用 send）
// ─────────────────────────────────────────────────────────────

/** @constant {string} 任务进度更新 (main -> renderer) */
const TASK_PROGRESS = 'task:progress';

/** @constant {string} 任务完成 (main -> renderer) */
const TASK_COMPLETE = 'task:complete';

/** @constant {string} 任务错误 (main -> renderer) */
const TASK_ERROR = 'task:error';

// ─────────────────────────────────────────────────────────────
// CHAT 相关（聊天式交互）
// ─────────────────────────────────────────────────────────────

/** @constant {string} 发送聊天消息 (invoke) */
const CHAT_SEND_MESSAGE = 'chat:send-message';

/** @constant {string} 发送聊天消息 - 流式 (invoke) */
const CHAT_SEND_MESSAGE_STREAM = 'chat:send-message-stream';

/** @constant {string} 聊天流式响应 (main -> renderer) */
const CHAT_STREAM = 'chat:stream';

/** @constant {string} 聊天响应完成 (main -> renderer) */
const CHAT_COMPLETE = 'chat:complete';

/** @constant {string} 从主进程创建群聊 (main -> renderer) */
const CHAT_CREATE_GROUP = 'chat:create-group';

// ─────────────────────────────────────────────────────────────
// AGENT TASK 相关（任务追踪与终止）
// ─────────────────────────────────────────────────────────────

/** @constant {string} 获取所有活跃任务 (invoke) */
const AGENT_TASK_GET_ALL = 'agent-task:get-all';

/** @constant {string} 终止指定 Agent 的任务 (invoke) */
const AGENT_TASK_ABORT = 'agent-task:abort';

// ─────────────────────────────────────────────────────────────
// AGENT CONFIG 相关（配置变更通知）
// ─────────────────────────────────────────────────────────────

/** @constant {string} Agent 配置变更 (main -> renderer) */
const AGENT_CONFIG_CHANGED = 'agent-config:changed';

// ─────────────────────────────────────────────────────────────
// MEMORY 相关（记忆系统）
// ─────────────────────────────────────────────────────────────

/** @constant {string} 获取记忆系统统计信息 (invoke) */
const MEMORY_GET_STATS = 'memory:get-stats';

/** @constant {string} 搜索记忆 (invoke) */
const MEMORY_SEARCH = 'memory:search';

/** @constant {string} 获取用户画像 (invoke) */
const MEMORY_GET_PROFILE = 'memory:get-profile';

/** @constant {string} 获取共享知识 (invoke) */
const MEMORY_GET_SHARED = 'memory:get-shared';

/** @constant {string} 获取最近记忆 (invoke) */
const MEMORY_GET_RECENT = 'memory:get-recent';

// ─────────────────────────────────────────────────────────────
// 审批相关（开除审批等）
// ─────────────────────────────────────────────────────────────

/** @constant {string} 获取待处理的开除申请 (invoke) */
const TERMINATION_GET_PENDING = 'termination:get-pending';

/** @constant {string} 确认/拒绝开除申请 (invoke) */
const TERMINATION_DECIDE = 'termination:decide';

// ─────────────────────────────────────────────────────────────
// ATTACHMENT 相关（图片附件）
// ─────────────────────────────────────────────────────────────

/** @constant {string} 保存附件到本地 (invoke) */
const ATTACHMENT_SAVE = 'attachment:save';

/** @constant {string} 从本地路径保存附件 (invoke) */
const ATTACHMENT_SAVE_FROM_PATH = 'attachment:save-from-path';

/** @constant {string} 获取附件 base64 (invoke) */
const ATTACHMENT_GET_BASE64 = 'attachment:get-base64';

/** @constant {string} 打开图片选择对话框 (invoke) */
const DIALOG_SELECT_IMAGES = 'dialog:select-images';

// ─────────────────────────────────────────────────────────────
// STT 相关（语音转文字）
// ─────────────────────────────────────────────────────────────

/** @constant {string} 语音转文字 (invoke) */
const STT_TRANSCRIBE = 'stt:transcribe';

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
  APP_GET_VERSION,
  APP_QUIT,
  AGENT_EXECUTE_TASK,
  AGENT_CANCEL_TASK,
  AGENT_GET_STATUS,
  TASK_PROGRESS,
  TASK_COMPLETE,
  TASK_ERROR,
  CHAT_SEND_MESSAGE,
  CHAT_SEND_MESSAGE_STREAM,
  CHAT_STREAM,
  CHAT_COMPLETE,
  CHAT_CREATE_GROUP,
  AGENT_TASK_GET_ALL,
  AGENT_TASK_ABORT,
  AGENT_CONFIG_CHANGED,
  MEMORY_GET_STATS,
  MEMORY_SEARCH,
  MEMORY_GET_PROFILE,
  MEMORY_GET_SHARED,
  MEMORY_GET_RECENT,
  TERMINATION_GET_PENDING,
  TERMINATION_DECIDE,
  ATTACHMENT_SAVE,
  ATTACHMENT_SAVE_FROM_PATH,
  ATTACHMENT_GET_BASE64,
  DIALOG_SELECT_IMAGES,
  STT_TRANSCRIBE,
};
