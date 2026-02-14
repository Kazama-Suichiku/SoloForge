/**
 * SoloForge - 记忆系统类型定义
 * 定义所有记忆类型常量、MemoryEntry 工厂函数、默认配置
 * @module memory/memory-types
 */

// ═══════════════════════════════════════════════════════════
// 记忆类型枚举
// ═══════════════════════════════════════════════════════════

/**
 * 记忆类型
 */
const MEMORY_TYPES = {
  DECISION: 'decision',                       // 关键决策
  FACT: 'fact',                               // 事实信息
  PREFERENCE: 'preference',                   // 用户偏好
  PROJECT_CONTEXT: 'project_context',         // 项目背景
  LESSON: 'lesson',                           // 经验教训
  EXPERTISE: 'expertise',                     // Agent 专业知识积累
  CONVERSATION_SUMMARY: 'conversation_summary', // 对话总结
  TASK_RESULT: 'task_result',                 // 任务成果
  PROCEDURE: 'procedure',                     // 流程规范
  USER_PROFILE: 'user_profile',               // 用户画像
  COMPANY_FACT: 'company_fact',               // 公司知识
  CONSENSUS: 'consensus',                     // 跨 Agent 共识
};

/**
 * 记忆可见范围
 */
const MEMORY_SCOPE = {
  AGENT: 'agent',     // 仅归属 Agent 可见
  USER: 'user',       // 用户相关，特定 Agent 可访问
  SHARED: 'shared',   // 所有 Agent 可见
};

/**
 * 记忆来源类型
 */
const MEMORY_SOURCE = {
  CONVERSATION: 'conversation',   // 从用户对话中提取
  TASK: 'task',                   // 从任务执行中提取
  COMMUNICATION: 'communication', // 从 Agent 间通信中提取
  MANUAL: 'manual',               // Agent 主动存储
  SYSTEM: 'system',               // 系统自动生成
};

// ═══════════════════════════════════════════════════════════
// 各记忆类型的默认配置
// ═══════════════════════════════════════════════════════════

/**
 * 每种记忆类型的默认配置
 */
const MEMORY_TYPE_DEFAULTS = {
  [MEMORY_TYPES.DECISION]: {
    scope: MEMORY_SCOPE.SHARED,
    importance: 0.8,
    description: '关键决策',
  },
  [MEMORY_TYPES.FACT]: {
    scope: MEMORY_SCOPE.SHARED,
    importance: 0.6,
    description: '事实信息',
  },
  [MEMORY_TYPES.PREFERENCE]: {
    scope: MEMORY_SCOPE.USER,
    importance: 0.7,
    description: '用户偏好',
  },
  [MEMORY_TYPES.PROJECT_CONTEXT]: {
    scope: MEMORY_SCOPE.SHARED,
    importance: 0.7,
    description: '项目背景',
  },
  [MEMORY_TYPES.LESSON]: {
    scope: MEMORY_SCOPE.AGENT,
    importance: 0.8,
    description: '经验教训',
  },
  [MEMORY_TYPES.EXPERTISE]: {
    scope: MEMORY_SCOPE.AGENT,
    importance: 0.5,
    description: 'Agent 专业知识',
  },
  [MEMORY_TYPES.CONVERSATION_SUMMARY]: {
    scope: MEMORY_SCOPE.AGENT,
    importance: 0.4,
    description: '对话总结',
  },
  [MEMORY_TYPES.TASK_RESULT]: {
    scope: MEMORY_SCOPE.AGENT,
    importance: 0.6,
    description: '任务成果',
  },
  [MEMORY_TYPES.PROCEDURE]: {
    scope: MEMORY_SCOPE.SHARED,
    importance: 0.9,
    description: '流程规范',
  },
  [MEMORY_TYPES.USER_PROFILE]: {
    scope: MEMORY_SCOPE.USER,
    importance: 0.7,
    description: '用户画像',
  },
  [MEMORY_TYPES.COMPANY_FACT]: {
    scope: MEMORY_SCOPE.SHARED,
    importance: 0.8,
    description: '公司知识',
  },
  [MEMORY_TYPES.CONSENSUS]: {
    scope: MEMORY_SCOPE.SHARED,
    importance: 0.7,
    description: '跨 Agent 共识',
  },
};

// ═══════════════════════════════════════════════════════════
// 记忆类型到存储文件的映射
// ═══════════════════════════════════════════════════════════

/**
 * 短期记忆类型（存储在 short-term/ 目录）
 */
const SHORT_TERM_TYPES = [
  MEMORY_TYPES.CONVERSATION_SUMMARY,
  MEMORY_TYPES.TASK_RESULT,
];

/**
 * 长期记忆类型（存储在 long-term/ 目录）
 */
const LONG_TERM_TYPES = [
  MEMORY_TYPES.DECISION,
  MEMORY_TYPES.FACT,
  MEMORY_TYPES.PREFERENCE,
  MEMORY_TYPES.LESSON,
  MEMORY_TYPES.PROCEDURE,
];

/**
 * 共享知识类型（存储在 shared/ 目录）
 */
const SHARED_TYPES = [
  MEMORY_TYPES.COMPANY_FACT,
  MEMORY_TYPES.PROJECT_CONTEXT,
  MEMORY_TYPES.CONSENSUS,
];

/**
 * Agent 专属类型（存储在 agents/{agentId}.json）
 */
const AGENT_TYPES = [
  MEMORY_TYPES.EXPERTISE,
];

/**
 * 用户相关类型（存储在 user/ 目录）
 */
const USER_TYPES = [
  MEMORY_TYPES.USER_PROFILE,
];

/**
 * 记忆类型到存储文件路径的映射（相对于 memory 根目录）
 */
const TYPE_TO_FILE = {
  [MEMORY_TYPES.CONVERSATION_SUMMARY]: 'short-term/conversation-summaries.json',
  [MEMORY_TYPES.TASK_RESULT]: 'short-term/task-summaries.json',
  [MEMORY_TYPES.DECISION]: 'long-term/decisions.json',
  [MEMORY_TYPES.FACT]: 'long-term/facts.json',
  [MEMORY_TYPES.PREFERENCE]: 'long-term/preferences.json',
  [MEMORY_TYPES.LESSON]: 'long-term/lessons.json',
  [MEMORY_TYPES.PROCEDURE]: 'long-term/procedures.json',
  [MEMORY_TYPES.COMPANY_FACT]: 'shared/company.json',
  [MEMORY_TYPES.PROJECT_CONTEXT]: 'shared/projects.json',
  [MEMORY_TYPES.CONSENSUS]: 'shared/consensus.json',
  [MEMORY_TYPES.USER_PROFILE]: 'user/profile.json',
  // EXPERTISE -> agents/{agentId}.json (动态路径)
};

// ═══════════════════════════════════════════════════════════
// 全局配置
// ═══════════════════════════════════════════════════════════

const MEMORY_CONFIG = {
  /** 每个类型文件的最大记忆条数 */
  MAX_ENTRIES_PER_FILE: 500,

  /** 索引文件名 */
  INDEX_FILE: 'index.json',

  /** 防抖写入延迟 (毫秒) */
  DEBOUNCE_MS: 1000,

  /** 短期记忆归档天数（超过此天数的短期记忆会被归档到长期） */
  SHORT_TERM_ARCHIVE_DAYS: 7,

  /** 定时维护间隔 (毫秒, 6 小时) */
  MAINTENANCE_INTERVAL_MS: 6 * 60 * 60 * 1000,

  /** 记忆提取最小消息数 (少于此数不触发提取) */
  MIN_MESSAGES_FOR_EXTRACTION: 3,

  /** 记忆提取间隔消息数 (每 N 条消息触发一次) */
  EXTRACTION_INTERVAL_MESSAGES: 10,

  /** 同一对话最小提取间隔 (毫秒, 5 分钟) */
  MIN_EXTRACTION_INTERVAL_MS: 5 * 60 * 1000,

  /** 记忆检索默认返回数量 */
  DEFAULT_RECALL_LIMIT: 8,

  /** 记忆注入的最大 Token 预算 (估算, 1 中文字 ≈ 1.5 token) */
  MAX_INJECT_TOKENS: 800,

  /** 衰减系数 (越大衰减越快, 0.03 ≈ 23 天半衰期) */
  DECAY_LAMBDA: 0.03,

  /** 有效分数低于此值时标记为 archived */
  ARCHIVE_THRESHOLD: 0.05,

  /** 合并触发阈值：同类型记忆超过此数量 */
  MERGE_THRESHOLD: 50,

  /** 提取时使用的 LLM 模型 (低成本模型) */
  EXTRACTOR_MODEL: 'claude-haiku-4-5',
};

// ═══════════════════════════════════════════════════════════
// 中文停用词（用于关键词提取）
// ═══════════════════════════════════════════════════════════

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
  '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些', '什么', '哪',
  '怎么', '为什么', '吗', '呢', '吧', '啊', '嗯', '哦', '哈', '呀', '啦',
  '把', '被', '给', '让', '向', '从', '对', '以', '但', '而', '或', '如果',
  '因为', '所以', '虽然', '但是', '可以', '能', '会', '应该', '需要',
  '这个', '那个', '这些', '那些', '里', '中', '下', '后', '前', '时', '时候',
  '还', '再', '又', '已经', '正在', '将', '比较', '非常', '更', '最',
  '请', '老板', '使用', '工具', '调用', '执行', '帮', '帮我', '请问',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
  'not', 'no', 'nor', 'so', 'if', 'then', 'that', 'this', 'it', 'i',
  'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
]);

// ═══════════════════════════════════════════════════════════
// 记忆类型中文标签（用于展示）
// ═══════════════════════════════════════════════════════════

const MEMORY_TYPE_LABELS = {
  [MEMORY_TYPES.DECISION]: '决策',
  [MEMORY_TYPES.FACT]: '事实',
  [MEMORY_TYPES.PREFERENCE]: '偏好',
  [MEMORY_TYPES.PROJECT_CONTEXT]: '项目',
  [MEMORY_TYPES.LESSON]: '教训',
  [MEMORY_TYPES.EXPERTISE]: '专业',
  [MEMORY_TYPES.CONVERSATION_SUMMARY]: '对话',
  [MEMORY_TYPES.TASK_RESULT]: '任务',
  [MEMORY_TYPES.PROCEDURE]: '规范',
  [MEMORY_TYPES.USER_PROFILE]: '画像',
  [MEMORY_TYPES.COMPANY_FACT]: '公司',
  [MEMORY_TYPES.CONSENSUS]: '共识',
};

// ═══════════════════════════════════════════════════════════
// MemoryEntry 工厂函数
// ═══════════════════════════════════════════════════════════

/**
 * 生成唯一 ID
 * @returns {string}
 */
function generateMemoryId() {
  return `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 创建一个 MemoryEntry
 * @param {Object} params
 * @param {string} params.type - 记忆类型 (MEMORY_TYPES 中的值)
 * @param {string} params.content - 记忆内容
 * @param {string} params.summary - 简短摘要 (< 100 字)
 * @param {string} [params.scope] - 可见范围 (默认根据 type 推断)
 * @param {string|null} [params.agentId] - 归属 Agent ID
 * @param {Object} [params.source] - 来源信息
 * @param {string[]} [params.tags] - 标签
 * @param {string[]} [params.relatedAgents] - 相关 Agent
 * @param {string[]} [params.relatedMemoryIds] - 关联记忆 ID
 * @param {number} [params.importance] - 重要性 (0-1, 默认根据 type 推断)
 * @returns {Object} MemoryEntry
 */
function createMemoryEntry(params) {
  const {
    type,
    content,
    summary,
    scope,
    agentId = null,
    source = {},
    tags = [],
    relatedAgents = [],
    relatedMemoryIds = [],
    importance,
  } = params;

  if (!type || !content) {
    throw new Error('记忆条目必须包含 type 和 content');
  }

  const typeDefaults = MEMORY_TYPE_DEFAULTS[type];
  if (!typeDefaults) {
    throw new Error(`未知的记忆类型: ${type}`);
  }

  const now = Date.now();

  return {
    id: generateMemoryId(),
    type,
    content,
    summary: summary || content.slice(0, 100),

    // 归属
    scope: scope || typeDefaults.scope,
    agentId,

    // 来源追溯
    source: {
      type: source.type || MEMORY_SOURCE.SYSTEM,
      conversationId: source.conversationId || null,
      taskId: source.taskId || null,
    },

    // 关联
    tags: [...new Set(tags)], // 去重
    relatedAgents: [...new Set(relatedAgents)],
    relatedMemoryIds: [...new Set(relatedMemoryIds)],

    // 生命周期
    createdAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    importance: typeof importance === 'number'
      ? Math.max(0, Math.min(1, importance))
      : typeDefaults.importance,

    // 状态
    archived: false,
    supersededBy: null,
  };
}

/**
 * 创建索引条目（轻量级，用于内存中的快速检索）
 * @param {Object} memoryEntry - 完整的 MemoryEntry
 * @returns {Object} 索引条目
 */
function createIndexEntry(memoryEntry) {
  return {
    id: memoryEntry.id,
    type: memoryEntry.type,
    scope: memoryEntry.scope,
    agentId: memoryEntry.agentId,
    tags: memoryEntry.tags,
    importance: memoryEntry.importance,
    createdAt: memoryEntry.createdAt,
    lastAccessedAt: memoryEntry.lastAccessedAt,
    accessCount: memoryEntry.accessCount,
    archived: memoryEntry.archived,
    supersededBy: memoryEntry.supersededBy,
    // 用于快速检索的摘要
    summary: memoryEntry.summary,
  };
}

/**
 * 验证 MemoryEntry 的必需字段
 * @param {Object} entry
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateMemoryEntry(entry) {
  const errors = [];

  if (!entry.id) errors.push('缺少 id');
  if (!entry.type) errors.push('缺少 type');
  if (!MEMORY_TYPE_DEFAULTS[entry.type]) errors.push(`未知类型: ${entry.type}`);
  if (!entry.content) errors.push('缺少 content');
  if (!entry.scope) errors.push('缺少 scope');
  if (typeof entry.importance !== 'number' || entry.importance < 0 || entry.importance > 1) {
    errors.push('importance 必须是 0-1 之间的数字');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  MEMORY_TYPES,
  MEMORY_SCOPE,
  MEMORY_SOURCE,
  MEMORY_TYPE_DEFAULTS,
  MEMORY_TYPE_LABELS,
  MEMORY_CONFIG,
  SHORT_TERM_TYPES,
  LONG_TERM_TYPES,
  SHARED_TYPES,
  AGENT_TYPES,
  USER_TYPES,
  TYPE_TO_FILE,
  STOP_WORDS,
  generateMemoryId,
  createMemoryEntry,
  createIndexEntry,
  validateMemoryEntry,
};
