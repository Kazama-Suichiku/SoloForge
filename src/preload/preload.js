/**
 * SoloForge - Preload Script
 * 通过 contextBridge 安全暴露 API 给渲染进程
 * 遵循安全最佳实践：仅暴露必要的 IPC 接口
 */

const { contextBridge, ipcRenderer } = require('electron');

  // IPC 频道常量（内联定义，避免 sandbox 模式下的模块解析问题）
const CHANNELS = {
  APP_GET_VERSION: 'app:get-version',
  APP_QUIT: 'app:quit',
  AGENT_EXECUTE_TASK: 'agent:execute-task',
  AGENT_CANCEL_TASK: 'agent:cancel-task',
  AGENT_GET_STATUS: 'agent:get-status',
  TASK_PROGRESS: 'task:progress',
  TASK_COMPLETE: 'task:complete',
  TASK_ERROR: 'task:error',
  CHAT_SEND_MESSAGE: 'chat:send-message',
  CHAT_SEND_MESSAGE_STREAM: 'chat:send-message-stream',
  CHAT_STREAM: 'chat:stream',
  CHAT_COMPLETE: 'chat:complete',
  CHAT_CREATE_GROUP: 'chat:create-group',
  // Agent 任务追踪
  AGENT_TASK_GET_ALL: 'agent-task:get-all',
  AGENT_TASK_ABORT: 'agent-task:abort',
  // 权限相关
  PERMISSIONS_GET: 'permissions:get',
  PERMISSIONS_UPDATE: 'permissions:update',
  PERMISSIONS_RESET: 'permissions:reset',
  // 工具确认
  TOOL_CONFIRM_REQUEST: 'tool:confirm-request',
  TOOL_CONFIRM_RESPONSE: 'tool:confirm-response',
  // 报告
  REPORT_GET_CONTENT: 'report:get-content',
  REPORT_OPEN_IN_BROWSER: 'report:open-in-browser',
  REPORT_LIST: 'report:list',
  // 对话框
  DIALOG_SELECT_FOLDER: 'dialog:select-folder',
  // Agent 配置
  AGENT_CONFIG_GET_ALL: 'agent-config:get-all',
  AGENT_CONFIG_GET: 'agent-config:get',
  AGENT_CONFIG_UPDATE: 'agent-config:update',
  AGENT_CONFIG_RESET: 'agent-config:reset',
  AGENT_CONFIG_GET_LEVELS: 'agent-config:get-levels',
  AGENT_CONFIG_GET_DEPARTMENTS: 'agent-config:get-departments',
  AGENT_CONFIG_GET_MODELS: 'agent-config:get-models',
  AGENT_CONFIG_UPLOAD_AVATAR: 'agent-config:upload-avatar',
  BOSS_CONFIG_GET: 'boss-config:get',
  BOSS_CONFIG_UPDATE: 'boss-config:update',
  BOSS_CONFIG_CHANGED: 'boss-config:changed',
  // 运营数据
  OPS_GET_SUMMARY: 'operations:get-summary',
  OPS_GET_GOALS: 'operations:get-goals',
  OPS_GET_TASKS: 'operations:get-tasks',
  OPS_GET_KPIS: 'operations:get-kpis',
  OPS_GET_RECRUIT_REQUESTS: 'operations:get-recruit-requests',
  OPS_GET_ACTIVITY_LOG: 'operations:get-activity-log',
  // Agent 协作
  COLLAB_GET_ACTIVITY: 'collaboration:get-activity',
  COLLAB_GET_MESSAGES: 'collaboration:get-messages',
  COLLAB_GET_TASKS: 'collaboration:get-tasks',
  COLLAB_GET_STATS: 'collaboration:get-stats',
  COLLAB_GET_SUMMARY: 'collaboration:get-summary',
  // 项目管理
  PM_GET_PROJECTS: 'pm:get-projects',
  PM_GET_PROJECT: 'pm:get-project',
  PM_GET_SUMMARY: 'pm:get-summary',
  // 外部链接
  OPEN_EXTERNAL: 'app:open-external',
  // 聊天历史持久化
  CHAT_HISTORY_GET: 'chat-history:get',
  CHAT_HISTORY_SET: 'chat-history:set',
  CHAT_HISTORY_REMOVE: 'chat-history:remove',
  // Agent TODO
  TODO_GET_ALL: 'todo:get-all',
  TODO_GET_AGENT: 'todo:get-agent',
  TODO_UPDATED: 'todo:updated',
  // 任务巡查
  PATROL_GET_STATUS: 'patrol:get-status',
  PATROL_TOGGLE: 'patrol:toggle',
  // 记忆系统
  MEMORY_GET_STATS: 'memory:get-stats',
  MEMORY_SEARCH: 'memory:search',
  MEMORY_GET_PROFILE: 'memory:get-profile',
  MEMORY_GET_SHARED: 'memory:get-shared',
  MEMORY_GET_RECENT: 'memory:get-recent',
  // 附件
  ATTACHMENT_SAVE: 'attachment:save',
  ATTACHMENT_SAVE_FROM_PATH: 'attachment:save-from-path',
  ATTACHMENT_GET_BASE64: 'attachment:get-base64',
  DIALOG_SELECT_IMAGES: 'dialog:select-images',
  // 语音转文字
  STT_TRANSCRIBE: 'stt:transcribe',
  // 账号系统
  ACCOUNT_REGISTER: 'account:register',
  ACCOUNT_LOGIN: 'account:login',
  ACCOUNT_LOGOUT: 'account:logout',
  ACCOUNT_GET_SESSION: 'account:get-session',
  // 公司管理
  COMPANY_CREATE: 'company:create',
  COMPANY_LIST: 'company:list',
  COMPANY_DELETE: 'company:delete',
  COMPANY_UPDATE: 'company:update',
  COMPANY_SELECT: 'company:select',
  COMPANY_GET_CURRENT: 'company:get-current',
};

contextBridge.exposeInMainWorld('soloforge', {
  // App 相关
  getVersion: () => ipcRenderer.invoke(CHANNELS.APP_GET_VERSION),
  quit: () => ipcRenderer.invoke(CHANNELS.APP_QUIT),

  // Agent 相关
  agent: {
    /** 执行任务 @param {import('../shared/ipc-types').TaskRequest} request */
    executeTask: (request) => ipcRenderer.invoke(CHANNELS.AGENT_EXECUTE_TASK, request),

    /** 取消任务 @param {string} taskId */
    cancelTask: (taskId) => ipcRenderer.invoke(CHANNELS.AGENT_CANCEL_TASK, taskId),

    /**
     * 订阅任务进度更新
     * @param {(progress: import('../shared/ipc-types').TaskProgress) => void} callback
     * @returns {() => void} 取消订阅函数
     */
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      ipcRenderer.on(CHANNELS.TASK_PROGRESS, handler);
      return () => ipcRenderer.removeListener(CHANNELS.TASK_PROGRESS, handler);
    },

    /**
     * 订阅任务完成事件
     * @param {(result: import('../shared/ipc-types').TaskResult) => void} callback
     * @returns {() => void} 取消订阅函数
     */
    onComplete: (callback) => {
      const handler = (_event, result) => callback(result);
      ipcRenderer.on(CHANNELS.TASK_COMPLETE, handler);
      return () => ipcRenderer.removeListener(CHANNELS.TASK_COMPLETE, handler);
    },

    /**
     * 订阅任务错误事件
     * @param {(result: import('../shared/ipc-types').TaskResult) => void} callback
     * @returns {() => void} 取消订阅函数
     */
    onError: (callback) => {
      const handler = (_event, result) => callback(result);
      ipcRenderer.on(CHANNELS.TASK_ERROR, handler);
      return () => ipcRenderer.removeListener(CHANNELS.TASK_ERROR, handler);
    },
  },

  // Chat 相关（聊天式交互）
  chat: {
    /**
     * 发送聊天消息（非流式）
     * @param {Object} request
     * @param {string} request.conversationId - 对话 ID
     * @param {string} request.agentId - Agent ID
     * @param {string} request.message - 用户消息
     * @param {Array} request.history - 对话历史
     * @returns {Promise<{ content: string }>}
     */
    sendMessage: (request) => ipcRenderer.invoke(CHANNELS.CHAT_SEND_MESSAGE, request),

    /**
     * 发送聊天消息（流式）
     * 通过 onStream 订阅流式响应
     * @param {Object} request
     * @param {string} request.conversationId - 对话 ID
     * @param {string} request.agentId - Agent ID
     * @param {string} request.message - 用户消息
     * @param {string} request.messageId - 消息 ID（用于关联流式数据）
     * @param {Array} request.history - 对话历史
     * @returns {Promise<{ content: string }>}
     */
    sendMessageStream: (request) => ipcRenderer.invoke(CHANNELS.CHAT_SEND_MESSAGE_STREAM, request),

    /**
     * 订阅流式响应
     * @param {(chunk: { messageId: string; content: string }) => void} callback
     * @returns {() => void} 取消订阅函数
     */
    onStream: (callback) => {
      const handler = (_event, chunk) => callback(chunk);
      ipcRenderer.on(CHANNELS.CHAT_STREAM, handler);
      return () => ipcRenderer.removeListener(CHANNELS.CHAT_STREAM, handler);
    },

    /**
     * 订阅响应完成事件
     * @param {(result: { messageId: string; content: string }) => void} callback
     * @returns {() => void} 取消订阅函数
     */
    onComplete: (callback) => {
      const handler = (_event, result) => callback(result);
      ipcRenderer.on(CHANNELS.CHAT_COMPLETE, handler);
      return () => ipcRenderer.removeListener(CHANNELS.CHAT_COMPLETE, handler);
    },

    /**
     * 订阅 Agent 主动推送消息（审批通知、工作汇报等）
     * @param {(data: { agentId: string; agentName: string; content: string; timestamp: number }) => void} callback
     * @returns {() => void} 取消订阅函数
     */
    onProactiveMessage: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('agent:proactive-message', handler);
      return () => ipcRenderer.removeListener('agent:proactive-message', handler);
    },

    /**
     * 订阅后端创建群聊事件
     * @param {(data: { groupId: string; name: string; participants: string[]; creatorId: string; creatorName: string; initialMessage?: string }) => void} callback
     * @returns {() => void} 取消订阅函数
     */
    onCreateGroup: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on(CHANNELS.CHAT_CREATE_GROUP, handler);
      return () => ipcRenderer.removeListener(CHANNELS.CHAT_CREATE_GROUP, handler);
    },
  },

  // 附件相关（图片上传）
  attachment: {
    /**
     * 保存附件（从 buffer）
     * @param {{ buffer: ArrayBuffer, mimeType: string, filename: string }} data
     * @returns {Promise<{ success: boolean, attachment?: Object, error?: string }>}
     */
    save: (data) => ipcRenderer.invoke(CHANNELS.ATTACHMENT_SAVE, data),

    /**
     * 从本地路径保存附件
     * @param {string} sourcePath
     * @returns {Promise<{ success: boolean, attachment?: Object, error?: string }>}
     */
    saveFromPath: (sourcePath) => ipcRenderer.invoke(CHANNELS.ATTACHMENT_SAVE_FROM_PATH, sourcePath),

    /**
     * 获取附件 base64
     * @param {string} filePath
     * @returns {Promise<{ success: boolean, base64?: string, mimeType?: string, error?: string }>}
     */
    getBase64: (filePath) => ipcRenderer.invoke(CHANNELS.ATTACHMENT_GET_BASE64, filePath),

    /**
     * 打开图片选择对话框
     * @returns {Promise<{ canceled: boolean, attachments: Object[], error?: string }>}
     */
    selectImages: () => ipcRenderer.invoke(CHANNELS.DIALOG_SELECT_IMAGES),
  },

  // 语音转文字
  stt: {
    /**
     * 将音频数据转为文字
     * @param {ArrayBuffer} audioBuffer - 音频数据
     * @returns {Promise<{ success: boolean, text?: string, error?: string }>}
     */
    transcribe: (audioBuffer) => ipcRenderer.invoke(CHANNELS.STT_TRANSCRIBE, audioBuffer),
  },
});

// 独立的 electronAPI 用于系统级功能
contextBridge.exposeInMainWorld('electronAPI', {
  // ─── 账号系统 ──────────────────────────────────────────────
  account: {
    register: (params) => ipcRenderer.invoke(CHANNELS.ACCOUNT_REGISTER, params),
    login: (params) => ipcRenderer.invoke(CHANNELS.ACCOUNT_LOGIN, params),
    logout: () => ipcRenderer.invoke(CHANNELS.ACCOUNT_LOGOUT),
    getSession: () => ipcRenderer.invoke(CHANNELS.ACCOUNT_GET_SESSION),
  },

  // ─── 公司管理 ──────────────────────────────────────────────
  company: {
    create: (params) => ipcRenderer.invoke(CHANNELS.COMPANY_CREATE, params),
    list: () => ipcRenderer.invoke(CHANNELS.COMPANY_LIST),
    delete: (params) => ipcRenderer.invoke(CHANNELS.COMPANY_DELETE, params),
    update: (params) => ipcRenderer.invoke(CHANNELS.COMPANY_UPDATE, params),
    select: (params) => ipcRenderer.invoke(CHANNELS.COMPANY_SELECT, params),
    getCurrent: () => ipcRenderer.invoke(CHANNELS.COMPANY_GET_CURRENT),
  },

  // 权限管理
  getPermissions: () => ipcRenderer.invoke(CHANNELS.PERMISSIONS_GET),
  updatePermissions: (permissions) =>
    ipcRenderer.invoke(CHANNELS.PERMISSIONS_UPDATE, permissions),
  resetPermissions: () => ipcRenderer.invoke(CHANNELS.PERMISSIONS_RESET),

  // 工具确认对话框
  onToolConfirmRequest: (callback) => {
    const handler = (_event, request) => callback(request);
    ipcRenderer.on(CHANNELS.TOOL_CONFIRM_REQUEST, handler);
    return () => ipcRenderer.removeListener(CHANNELS.TOOL_CONFIRM_REQUEST, handler);
  },
  respondToolConfirm: (requestId, confirmed) => {
    ipcRenderer.send(CHANNELS.TOOL_CONFIRM_RESPONSE, { requestId, confirmed });
  },

  // 报告功能
  getReportContent: (reportId) => ipcRenderer.invoke(CHANNELS.REPORT_GET_CONTENT, reportId),
  openReportInBrowser: (reportId) => ipcRenderer.invoke(CHANNELS.REPORT_OPEN_IN_BROWSER, reportId),
  listReports: (limit) => ipcRenderer.invoke(CHANNELS.REPORT_LIST, limit),

  // 对话框
  selectFolder: (options) => ipcRenderer.invoke(CHANNELS.DIALOG_SELECT_FOLDER, options),

  // Agent 配置管理
  getAgentConfigs: () => ipcRenderer.invoke(CHANNELS.AGENT_CONFIG_GET_ALL),
  getAgentConfig: (agentId) => ipcRenderer.invoke(CHANNELS.AGENT_CONFIG_GET, agentId),
  updateAgentConfig: (agentId, updates) =>
    ipcRenderer.invoke(CHANNELS.AGENT_CONFIG_UPDATE, { agentId, updates }),
  resetAgentConfig: (agentId) => ipcRenderer.invoke(CHANNELS.AGENT_CONFIG_RESET, agentId),
  getAgentLevels: () => ipcRenderer.invoke(CHANNELS.AGENT_CONFIG_GET_LEVELS),
  getAgentDepartments: () => ipcRenderer.invoke(CHANNELS.AGENT_CONFIG_GET_DEPARTMENTS),
  getAvailableModels: () => ipcRenderer.invoke(CHANNELS.AGENT_CONFIG_GET_MODELS),
  uploadAgentAvatar: (agentId) => ipcRenderer.invoke(CHANNELS.AGENT_CONFIG_UPLOAD_AVATAR, agentId),
  // 老板配置
  getBossConfig: () => ipcRenderer.invoke(CHANNELS.BOSS_CONFIG_GET),
  updateBossConfig: (updates) => ipcRenderer.invoke(CHANNELS.BOSS_CONFIG_UPDATE, updates),
  onBossConfigChanged: (callback) => {
    const handler = (_event, config) => callback(config);
    ipcRenderer.on(CHANNELS.BOSS_CONFIG_CHANGED, handler);
    return () => ipcRenderer.removeListener(CHANNELS.BOSS_CONFIG_CHANGED, handler);
  },
  // 订阅 Agent 配置变更
  onAgentConfigChanged: (callback) => {
    const handler = (_event, configs) => callback(configs);
    ipcRenderer.on('agent-config:changed', handler);
    return () => ipcRenderer.removeListener('agent-config:changed', handler);
  },

  // 运营仪表板
  getOperationsSummary: () => ipcRenderer.invoke(CHANNELS.OPS_GET_SUMMARY),
  getOperationsGoals: (filter) => ipcRenderer.invoke(CHANNELS.OPS_GET_GOALS, filter),
  getOperationsTasks: (filter) => ipcRenderer.invoke(CHANNELS.OPS_GET_TASKS, filter),
  getOperationsKPIs: (filter) => ipcRenderer.invoke(CHANNELS.OPS_GET_KPIS, filter),
  getRecruitRequests: () => ipcRenderer.invoke(CHANNELS.OPS_GET_RECRUIT_REQUESTS),
  getActivityLog: (options) => ipcRenderer.invoke(CHANNELS.OPS_GET_ACTIVITY_LOG, options),

  // Agent 协作
  getCollaborationActivity: (limit) => ipcRenderer.invoke(CHANNELS.COLLAB_GET_ACTIVITY, limit),
  getCollaborationMessages: (agentId, options) =>
    ipcRenderer.invoke(CHANNELS.COLLAB_GET_MESSAGES, agentId, options),
  getCollaborationTasks: (agentId, options) =>
    ipcRenderer.invoke(CHANNELS.COLLAB_GET_TASKS, agentId, options),
  getCollaborationStats: (agentId) => ipcRenderer.invoke(CHANNELS.COLLAB_GET_STATS, agentId),
  getCollaborationSummary: () => ipcRenderer.invoke(CHANNELS.COLLAB_GET_SUMMARY),

  // 外部链接
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.OPEN_EXTERNAL, url),

  // 项目管理
  getProjects: (filter) => ipcRenderer.invoke(CHANNELS.PM_GET_PROJECTS, filter),
  getProject: (projectId) => ipcRenderer.invoke(CHANNELS.PM_GET_PROJECT, projectId),
  getProjectsSummary: () => ipcRenderer.invoke(CHANNELS.PM_GET_SUMMARY),

  // 聊天历史持久化（通过主进程文件存储，不依赖 localStorage）
  getChatHistory: () => ipcRenderer.invoke(CHANNELS.CHAT_HISTORY_GET),
  setChatHistory: (value) => ipcRenderer.invoke(CHANNELS.CHAT_HISTORY_SET, value),
  removeChatHistory: () => ipcRenderer.invoke(CHANNELS.CHAT_HISTORY_REMOVE),

  // Agent TODO
  getTodoAll: () => ipcRenderer.invoke(CHANNELS.TODO_GET_ALL),
  getTodoByAgent: (agentId) => ipcRenderer.invoke(CHANNELS.TODO_GET_AGENT, agentId),
  onTodoUpdated: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(CHANNELS.TODO_UPDATED, handler);
    return () => ipcRenderer.removeListener(CHANNELS.TODO_UPDATED, handler);
  },

  // Agent 任务追踪与终止
  getAgentTasks: () => ipcRenderer.invoke(CHANNELS.AGENT_TASK_GET_ALL),
  abortAgentTask: (agentId) => ipcRenderer.invoke(CHANNELS.AGENT_TASK_ABORT, agentId),

  // 任务巡查控制
  getPatrolStatus: () => ipcRenderer.invoke(CHANNELS.PATROL_GET_STATUS),
  togglePatrol: (enabled) => ipcRenderer.invoke(CHANNELS.PATROL_TOGGLE, enabled),

  // 记忆系统
  getMemoryStats: () => ipcRenderer.invoke(CHANNELS.MEMORY_GET_STATS),
  searchMemory: (params) => ipcRenderer.invoke(CHANNELS.MEMORY_SEARCH, params),
  getMemoryProfile: () => ipcRenderer.invoke(CHANNELS.MEMORY_GET_PROFILE),
  getMemoryShared: (params) => ipcRenderer.invoke(CHANNELS.MEMORY_GET_SHARED, params),
  getMemoryRecent: (params) => ipcRenderer.invoke(CHANNELS.MEMORY_GET_RECENT, params),

  // 开除审批（Dashboard 老板操作）
  getTerminationRequests: () => ipcRenderer.invoke('termination:get-pending'),
  terminationDecide: (params) => ipcRenderer.invoke('termination:decide', params),

  // CFO 预算仪表板
  getTokenStats: (params) => ipcRenderer.invoke('budget:get-token-stats', params),
  getAlerts: () => ipcRenderer.invoke('budget:get-alerts'),
  acknowledgeAlert: (alertId) => ipcRenderer.invoke('budget:acknowledge-alert', alertId),

  // 云同步 API
  sync: {
    init: (config) => ipcRenderer.invoke('sync:init', config),
    register: (credentials) => ipcRenderer.invoke('sync:register', credentials),
    login: (credentials) => ipcRenderer.invoke('sync:login', credentials),
    logout: () => ipcRenderer.invoke('sync:logout'),
    restoreSession: () => ipcRenderer.invoke('sync:restore-session'),
    getUser: () => ipcRenderer.invoke('sync:get-user'),
    manualSync: () => ipcRenderer.invoke('sync:manual-sync'),
    pull: () => ipcRenderer.invoke('sync:pull'),
    push: () => ipcRenderer.invoke('sync:push'),
    getStatus: () => ipcRenderer.invoke('sync:get-status'),
    setAutoSync: (enabled) => ipcRenderer.invoke('sync:set-auto-sync', enabled),
  },
});
