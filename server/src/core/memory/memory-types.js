/**
 * SoloForge Mobile - 记忆系统类型定义
 * 简化版：常量、工厂函数、验证
 * @module memory/memory-types
 */

// ═══════════════════════════════════════════════════════════
// 记忆类型枚举
// ═══════════════════════════════════════════════════════════

const MEMORY_TYPES = {
  DECISION: 'decision',
  FACT: 'fact',
  PREFERENCE: 'preference',
  PROJECT_CONTEXT: 'project_context',
  LESSON: 'lesson',
  EXPERTISE: 'expertise',
  CONVERSATION_SUMMARY: 'conversation_summary',
  TASK_RESULT: 'task_result',
  PROCEDURE: 'procedure',
  USER_PROFILE: 'user_profile',
  COMPANY_FACT: 'company_fact',
  CONSENSUS: 'consensus',
};

const MEMORY_SCOPE = {
  AGENT: 'agent',
  USER: 'user',
  SHARED: 'shared',
};

const MEMORY_SOURCE = {
  CONVERSATION: 'conversation',
  TASK: 'task',
  COMMUNICATION: 'communication',
  MANUAL: 'manual',
  SYSTEM: 'system',
};

// ═══════════════════════════════════════════════════════════
// 默认配置
// ═══════════════════════════════════════════════════════════

const MEMORY_TYPE_DEFAULTS = {
  [MEMORY_TYPES.DECISION]: { scope: MEMORY_SCOPE.SHARED, importance: 0.8 },
  [MEMORY_TYPES.FACT]: { scope: MEMORY_SCOPE.SHARED, importance: 0.6 },
  [MEMORY_TYPES.PREFERENCE]: { scope: MEMORY_SCOPE.USER, importance: 0.7 },
  [MEMORY_TYPES.PROJECT_CONTEXT]: { scope: MEMORY_SCOPE.SHARED, importance: 0.7 },
  [MEMORY_TYPES.LESSON]: { scope: MEMORY_SCOPE.AGENT, importance: 0.8 },
  [MEMORY_TYPES.EXPERTISE]: { scope: MEMORY_SCOPE.AGENT, importance: 0.5 },
  [MEMORY_TYPES.CONVERSATION_SUMMARY]: { scope: MEMORY_SCOPE.AGENT, importance: 0.4 },
  [MEMORY_TYPES.TASK_RESULT]: { scope: MEMORY_SCOPE.AGENT, importance: 0.6 },
  [MEMORY_TYPES.PROCEDURE]: { scope: MEMORY_SCOPE.SHARED, importance: 0.9 },
  [MEMORY_TYPES.USER_PROFILE]: { scope: MEMORY_SCOPE.USER, importance: 0.7 },
  [MEMORY_TYPES.COMPANY_FACT]: { scope: MEMORY_SCOPE.SHARED, importance: 0.8 },
  [MEMORY_TYPES.CONSENSUS]: { scope: MEMORY_SCOPE.SHARED, importance: 0.7 },
};

const AGENT_TYPES = [MEMORY_TYPES.EXPERTISE];

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
};

const MEMORY_CONFIG = {
  MAX_ENTRIES_PER_FILE: 500,
  INDEX_FILE: 'index.json',
  DEBOUNCE_MS: 1000,
  DEFAULT_RECALL_LIMIT: 8,
  DECAY_LAMBDA: 0.03,
  ARCHIVE_THRESHOLD: 0.05,
  MAX_INJECT_TOKENS: 800,
};

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

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
]);

// ═══════════════════════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════════════════════

function generateMemoryId() {
  return `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function createMemoryEntry(params) {
  const {
    type,
    content,
    summary,
    scope,
    agentId = null,
    source = {},
    tags = [],
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
    scope: scope || typeDefaults.scope,
    agentId,
    source: {
      type: source.type || MEMORY_SOURCE.SYSTEM,
      conversationId: source.conversationId || null,
      taskId: source.taskId || null,
    },
    tags: [...new Set(tags)],
    relatedAgents: [],
    relatedMemoryIds: [],
    createdAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    importance: typeof importance === 'number'
      ? Math.max(0, Math.min(1, importance))
      : typeDefaults.importance,
    archived: false,
    supersededBy: null,
  };
}

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
    summary: memoryEntry.summary,
  };
}

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
  return { valid: errors.length === 0, errors };
}

module.exports = {
  MEMORY_TYPES,
  MEMORY_SCOPE,
  MEMORY_SOURCE,
  MEMORY_TYPE_DEFAULTS,
  MEMORY_CONFIG,
  MEMORY_TYPE_LABELS,
  AGENT_TYPES,
  TYPE_TO_FILE,
  STOP_WORDS,
  generateMemoryId,
  createMemoryEntry,
  createIndexEntry,
  validateMemoryEntry,
};
