/**
 * SoloForge - 主动回忆工具（阶段三 C）
 *
 * 三个面向 Agent 的主动回忆工具：
 *   - light_memory  : 轻量快速回忆（按 query 向量+BM25+tag 混合检索，返回 top-5 摘要）
 *   - deep_memory   : 按 conversationId / 时间范围精确回查原始通信记录
 *   - topic_memory  : 按 tag 话题回查（拿该话题下所有记忆）
 *
 * 与 memory-tools.js 的区别：
 *   memory-tools 提供 memory_recall / memory_search / memory_store 等通用 CRUD + 检索；
 *   本文件提供更"场景化"的回忆入口，供 Agent 在不同回查场景下选择：
 *     · 快速扫一眼最近相关 → light_memory
 *     · 拉某段对话/某时间窗的原始通信 → deep_memory
 *     · 围绕某个话题标签把所有记忆拉全 → topic_memory
 *
 * 依赖前置：
 *   - 阶段一 memoryManager.recall（混合检索，async）
 *   - 阶段二 commEventStore.getEventsForAgent（SQLite 后端）
 *   - memoryStore.searchByTags（tag JOIN 查询）
 *
 * 严格文件范围：
 *   - 本文件为新建
 *   - setup.js 加一行 registerMemoryAdvancedTools()
 *
 * @module tools/memory-advanced-tools
 */

'use strict';

const { toolRegistry } = require('./tool-registry');

// ─── 延迟加载，避免循环依赖 ─────────────────────────────────
let _memoryManager = null;
function getMemoryManager() {
  if (!_memoryManager) {
    const { memoryManager } = require('../memory');
    _memoryManager = memoryManager;
  }
  return _memoryManager;
}

let _memoryStore = null;
function getMemoryStore() {
  if (!_memoryStore) {
    const { memoryStore } = require('../memory');
    _memoryStore = memoryStore;
  }
  return _memoryStore;
}

let _commEventStore = null;
function getCommEventStore() {
  if (!_commEventStore) {
    const { commEventStore } = require('../collaboration/comm-event-store');
    _commEventStore = commEventStore;
  }
  return _commEventStore;
}

// ═══════════════════════════════════════════════════════════
// 工具定义
// ═══════════════════════════════════════════════════════════

/**
 * light_memory - 轻量快速回忆
 *
 * 按关键词快速检索相关记忆，返回 top-5 摘要。
 * 内部走 memoryManager.recall（阶段一C 混合检索：向量 + BM25 + tag → RRF）。
 * 只返回精简字段（summary / type / importance / score），不给完整 content，
 * 用于 Agent "快速扫一眼相关记忆"的场景。
 */
const lightMemoryTool = {
  name: 'light_memory',
  description:
    '轻量快速回忆。按关键词快速检索相关记忆，返回 top5 摘要。' +
    '用于快速回顾与某话题/问题相关的记忆要点（只给摘要，不给完整内容）。' +
    '如需完整内容请用 deep_memory 或 topic_memory。',
  category: 'memory',
  parameters: {
    query: {
      type: 'string',
      description: '检索查询文本（关键词或自然语言描述），如 "React 技术选型" 或 "用户偏好简洁回复"',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { query } = args;

    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new Error('请提供有效的查询文本（query）');
    }

    const mm = getMemoryManager();
    // 复用阶段一C 的混合检索，limit 固定 5（轻量）
    const results = await mm.recall(query, {
      agentId: context?.agentId,
      limit: 5,
    });

    if (!Array.isArray(results) || results.length === 0) {
      return { success: true, memories: [], message: '未找到相关记忆' };
    }

    // 精简返回：只给摘要 + 元信息，不带完整 content，省 token
    const memories = results.map((r) => ({
      summary: r.summary,
      type: r.type,
      importance: r.importance,
      score: typeof r.score === 'number' ? Number(r.score.toFixed(3)) : undefined,
    }));

    return { success: true, memories };
  },
};

/**
 * deep_memory - 深度回查原始通信记录
 *
 * 按时间范围（since / until）或对话 ID（conversation_id）查询原始通信事件，
 * 获取完整内容（不经过摘要压缩）。用于精确回查"某次对话说了什么"。
 *
 * 参数优先级：
 *   1. conversation_id 非空 → 按会话 ID 过滤（先拉 agent 的事件，再 JS 过滤 conversationId）
 *      （comm-event-store 当前未提供按 conversation_id 的 SELECT 方法，且阶段三C
 *        严格禁止改 collaboration/，故用 getEventsForAgent + JS 过滤实现）
 *   2. since / until 非空 → 按时间窗过滤
 *   3. 两者都为空 → 返回该 agent 最近的通信记录（默认 20 条）
 *
 * 注意：comm-event-store 的 getEventsForAgent(agentId, {limit, since}) 已内置
 *   since 过滤（timestamp > since）和 limit；until 在此 JS 层补过滤（collaboration 不改）。
 */
const deepMemoryTool = {
  name: 'deep_memory',
  description:
    '深度回查。按时间范围或对话 ID 查询原始通信记录，获取完整内容。' +
    '用于精确回查某次对话 / 某个时间窗内 Agent 之间的通信原文。' +
    '参数：conversation_id（会话 ID）或 since/until（时间戳，毫秒）或两者组合；' +
    '不传任何过滤参数则返回最近 20 条通信记录。',
  category: 'memory',
  parameters: {
    conversation_id: {
      type: 'string',
      description: '会话 ID（conversationId）。非空时按会话精确回查该 agent 参与的原始通信',
      required: false,
    },
    since: {
      type: 'number',
      description: '起始时间戳（毫秒，Date.now() 格式）。只返回 timestamp > since 的事件',
      required: false,
    },
    until: {
      type: 'number',
      description: '结束时间戳（毫秒，Date.now() 格式）。只返回 timestamp <= until 的事件',
      required: false,
    },
    limit: {
      type: 'number',
      description: '返回数量上限（默认 20，最大 100）。注意：指定 conversation_id 时此参数仅限制会话内条数',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { conversation_id, since, until, limit } = args || {};

    const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

    const store = getCommEventStore();
    const agentId = context?.agentId;

    if (!agentId) {
      throw new Error('deep_memory 需要执行上下文中的 agentId');
    }

    // getEventsForAgent 支持 { limit, since }，返回按时间升序的事件数组
    // （最近的在最后，与 agentCommunication.messages 的顺序一致）
    let events = store.getEventsForAgent(agentId, {
      limit: safeLimit,
      since: typeof since === 'number' && since > 0 ? since : 0,
    });

    if (!Array.isArray(events)) events = [];

    // JS 层补 until 过滤（collaboration 不改）
    if (typeof until === 'number' && until > 0) {
      events = events.filter((e) => e.timestamp <= until);
    }

    // JS 层补 conversation_id 过滤（collaboration 未提供按 conversation_id 的查询方法，
    // 且阶段三C 严格禁止改 collaboration/，故用 JS 过滤实现）
    if (conversation_id) {
      events = events.filter((e) => e.conversationId === conversation_id);
    }

    if (events.length === 0) {
      return {
        success: true,
        events: [],
        message: '未找到匹配的通信记录',
      };
    }

    // 返回完整原始事件（含 content / response / from / to / timestamp 等）
    // 与 comm-event-store._rowToEvent 的字段对齐
    return { success: true, events };
  },
};

/**
 * topic_memory - 按话题标签回查
 *
 * 按标签查找相关记忆，获取该话题下所有记忆。
 * 与 memory_search（按 tags 搜索）的区别：
 *   - memory_search 返回精简的索引条目（无 content），且支持 type/agent 多维过滤
 *   - topic_memory 专注"把一个话题拉全"：返回 content 前 200 字 + summary + type + tags，
 *     便于 Agent 通读某话题下的全部记忆要点。
 */
const topicMemoryTool = {
  name: 'topic_memory',
  description:
    '按话题回忆。按标签查找相关记忆，获取该话题下所有记忆。' +
    '用于围绕某个话题（如 "React"、"部署流程"、"用户偏好"）把相关记忆一次性拉全，' +
    '返回 summary + content 前 200 字 + type + tags。',
  category: 'memory',
  parameters: {
    tag: {
      type: 'string',
      description: '话题标签，如 "React"、"部署"、"用户偏好"（单个标签，不需要逗号分隔）',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { tag } = args;

    if (!tag || typeof tag !== 'string' || !tag.trim()) {
      throw new Error('请提供有效的话题标签（tag）');
    }

    const ms = getMemoryStore();
    // searchByTags 内部走 sqlite-store 的 JOIN memory_tags 查询（大小写不敏感）
    // 传单个 tag；limit 20（与 memory_search 默认一致）
    const results = ms.searchByTags([tag.trim()], {
      includeArchived: false,
      // 不限制 scope/agentId：话题本身是跨 scope 的，让 Agent 能看到 shared/user 下同话题记忆
      // 若需严格按 agent 隔离，可解开下一行
      // agentId: context?.agentId,
    });

    if (!Array.isArray(results) || results.length === 0) {
      return { success: true, memories: [], message: `未找到标签 "${tag}" 下的记忆` };
    }

    // 按创建时间倒序（searchByTags 已在 SQL 层 ORDER BY created_at DESC，这里保持）
    const memories = results.slice(0, 20).map((r) => ({
      summary: r.summary,
      content: typeof r.content === 'string' ? r.content.slice(0, 200) : r.content,
      type: r.type,
      tags: r.tags,
      importance: r.importance,
      createdAt: r.createdAt,
    }));

    return { success: true, memories };
  },
};

// ═══════════════════════════════════════════════════════════
// 注册函数
// ═══════════════════════════════════════════════════════════

/**
 * 注册主动回忆工具（阶段三 C）
 */
function registerMemoryAdvancedTools() {
  toolRegistry.register(lightMemoryTool);
  toolRegistry.register(deepMemoryTool);
  toolRegistry.register(topicMemoryTool);
}

module.exports = {
  registerMemoryAdvancedTools,
  lightMemoryTool,
  deepMemoryTool,
  topicMemoryTool,
};
