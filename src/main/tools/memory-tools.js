/**
 * SoloForge - Agent 记忆工具
 * 提供 7 个记忆相关工具供 Agent 使用
 * @module tools/memory-tools
 */

const { toolRegistry } = require('./tool-registry');

// 延迟加载避免循环依赖
let _memoryManager = null;
function getMemoryManager() {
  if (!_memoryManager) {
    const { memoryManager } = require('../memory');
    _memoryManager = memoryManager;
  }
  return _memoryManager;
}

// ═══════════════════════════════════════════════════════════
// 工具定义
// ═══════════════════════════════════════════════════════════

/**
 * memory_recall - 按语义检索相关记忆
 */
const memoryRecallTool = {
  name: 'memory_recall',
  description: '按语义检索相关记忆。输入一段查询文本，返回最相关的记忆条目。用于回顾过往的决策、事实、偏好等。',
  category: 'memory',
  parameters: {
    query: {
      type: 'string',
      description: '检索查询文本（关键词或自然语言描述），如 "React 技术选型" 或 "用户的沟通风格偏好"',
      required: true,
    },
    limit: {
      type: 'number',
      description: '返回的最大条目数（默认 8，最大 20）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { query, limit = 8 } = args;

    if (!query || typeof query !== 'string') {
      throw new Error('请提供有效的查询文本');
    }

    const mm = getMemoryManager();
    const safeLimit = Math.min(Math.max(1, limit), 20);

    const results = mm.recall(query, {
      agentId: context?.agentId,
      limit: safeLimit,
    });

    if (results.length === 0) {
      return { message: '未找到相关记忆', results: [] };
    }

    // 格式化结果
    const formatted = results.map((r) => ({
      id: r.id,
      type: r.type,
      summary: r.summary,
      tags: r.tags,
      importance: r.importance,
      score: r.score?.toFixed(3),
      createdAt: new Date(r.createdAt).toLocaleString('zh-CN'),
    }));

    return {
      message: `找到 ${formatted.length} 条相关记忆`,
      results: formatted,
    };
  },
};

/**
 * memory_store - 主动存储一条记忆
 */
const memoryStoreTool = {
  name: 'memory_store',
  description: '主动存储一条记忆。用于记录重要的决策、事实、经验教训、流程规范等。',
  category: 'memory',
  parameters: {
    type: {
      type: 'string',
      description: '记忆类型: decision(决策), fact(事实), preference(偏好), project_context(项目背景), lesson(教训), procedure(规范), company_fact(公司知识), user_profile(用户画像)',
      required: true,
    },
    content: {
      type: 'string',
      description: '记忆的详细内容描述（50-300字）',
      required: true,
    },
    summary: {
      type: 'string',
      description: '一句话摘要（不超过 50 字）',
      required: true,
    },
    tags: {
      type: 'string',
      description: '关键词标签，用逗号分隔，如 "React,前端,架构"',
      required: false,
    },
    importance: {
      type: 'number',
      description: '重要性评分（0.0-1.0，默认根据类型自动设置）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { type, content, summary, tags, importance } = args;

    if (!type || !content || !summary) {
      throw new Error('type, content, summary 为必填参数');
    }

    const validTypes = [
      'decision', 'fact', 'preference', 'project_context',
      'lesson', 'procedure', 'company_fact', 'user_profile',
      'expertise', 'consensus',
    ];
    if (!validTypes.includes(type)) {
      throw new Error(`无效的记忆类型: ${type}，可选: ${validTypes.join(', ')}`);
    }

    const mm = getMemoryManager();
    const tagArray = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

    const result = mm.store({
      type,
      content,
      summary,
      tags: tagArray,
      importance: typeof importance === 'number' ? importance : undefined,
      agentId: context?.agentId || null,
      source: {
        type: 'manual',
        conversationId: context?.conversationId || null,
      },
    });

    if (result.success) {
      return { message: `记忆已存储（ID: ${result.id}）`, id: result.id };
    } else {
      throw new Error(`存储失败: ${result.error}`);
    }
  },
};

/**
 * memory_search - 按标签/类型搜索记忆
 */
const memorySearchTool = {
  name: 'memory_search',
  description: '按标签、类型或 Agent 搜索记忆。适合浏览某一类别的记忆。',
  category: 'memory',
  parameters: {
    tags: {
      type: 'string',
      description: '按标签搜索，逗号分隔，如 "React,前端"',
      required: false,
    },
    type: {
      type: 'string',
      description: '按类型筛选: decision, fact, preference, project_context, lesson, procedure, company_fact, user_profile, expertise, consensus',
      required: false,
    },
    agent: {
      type: 'string',
      description: '按 Agent ID 筛选',
      required: false,
    },
    limit: {
      type: 'number',
      description: '返回数量（默认 20）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { tags, type, agent, limit = 20 } = args;

    const mm = getMemoryManager();
    const tagArray = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

    const results = mm.search({
      tags: tagArray,
      type: type || undefined,
      agentId: agent || undefined,
      limit: Math.min(limit, 50),
    });

    if (results.length === 0) {
      return { message: '未找到匹配的记忆', results: [] };
    }

    const formatted = results.map((r) => ({
      id: r.id,
      type: r.type,
      summary: r.summary,
      tags: r.tags,
      importance: r.importance,
      createdAt: new Date(r.createdAt).toLocaleString('zh-CN'),
    }));

    return {
      message: `找到 ${formatted.length} 条记忆`,
      results: formatted,
    };
  },
};

/**
 * memory_list_recent - 查看最近的记忆
 */
const memoryListRecentTool = {
  name: 'memory_list_recent',
  description: '查看最近存储的记忆，按时间倒序排列。',
  category: 'memory',
  parameters: {
    limit: {
      type: 'number',
      description: '返回数量（默认 10，最大 30）',
      required: false,
    },
    type: {
      type: 'string',
      description: '可选，按类型筛选',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { limit = 10, type } = args;

    const mm = getMemoryManager();
    const results = mm.getRecent(Math.min(limit, 30), type || undefined);

    if (results.length === 0) {
      return { message: '暂无记忆', results: [] };
    }

    const formatted = results.map((r) => ({
      id: r.id,
      type: r.type,
      summary: r.summary,
      tags: r.tags,
      importance: r.importance,
      createdAt: new Date(r.createdAt).toLocaleString('zh-CN'),
    }));

    return {
      message: `最近 ${formatted.length} 条记忆`,
      results: formatted,
    };
  },
};

/**
 * memory_company_facts - 查看公司级知识
 */
const memoryCompanyFactsTool = {
  name: 'memory_company_facts',
  description: '查看公司级共享知识，包括公司信息、规范、共识等。',
  category: 'memory',
  parameters: {},
  requiredPermissions: [],

  async execute() {
    const mm = getMemoryManager();
    const results = mm.getSharedKnowledge();

    if (results.length === 0) {
      return { message: '暂无公司级知识记录', results: [] };
    }

    const formatted = results.map((r) => ({
      id: r.id,
      type: r.type,
      summary: r.summary,
      tags: r.tags,
      importance: r.importance,
      createdAt: new Date(r.createdAt).toLocaleString('zh-CN'),
    }));

    return {
      message: `共 ${formatted.length} 条公司级知识`,
      results: formatted,
    };
  },
};

/**
 * memory_user_profile - 查看用户画像
 */
const memoryUserProfileTool = {
  name: 'memory_user_profile',
  description: '查看已积累的用户画像信息，包括用户的偏好、风格、背景等。',
  category: 'memory',
  parameters: {},
  requiredPermissions: [],

  async execute() {
    const mm = getMemoryManager();

    // 获取用户画像 + 用户偏好
    const profile = mm.getUserProfile();
    const preferences = mm.search({ type: 'preference', limit: 20 });

    const allResults = [...profile, ...preferences];

    if (allResults.length === 0) {
      return { message: '暂无用户画像数据', results: [] };
    }

    const formatted = allResults.map((r) => ({
      id: r.id,
      type: r.type,
      summary: r.summary,
      tags: r.tags,
      importance: r.importance,
    }));

    return {
      message: `用户画像: ${formatted.length} 条记录`,
      results: formatted,
    };
  },
};

/**
 * memory_project_context - 查看项目背景
 */
const memoryProjectContextTool = {
  name: 'memory_project_context',
  description: '查看项目相关的背景信息，包括技术栈、目标、进展等。',
  category: 'memory',
  parameters: {
    project: {
      type: 'string',
      description: '可选，项目名称或关键词，用于筛选特定项目',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { project } = args;
    const mm = getMemoryManager();

    let results;
    if (project) {
      results = mm.search({ type: 'project_context', tags: [project], limit: 20 });
      // 如果标签没有匹配到，尝试关键词检索
      if (results.length === 0) {
        results = mm.recall(project, { type: 'project_context', limit: 10 });
      }
    } else {
      results = mm.search({ type: 'project_context', limit: 20 });
    }

    if (results.length === 0) {
      return { message: '暂无项目背景记录', results: [] };
    }

    const formatted = results.map((r) => ({
      id: r.id,
      type: r.type,
      summary: r.summary,
      tags: r.tags,
      importance: r.importance,
      createdAt: new Date(r.createdAt).toLocaleString('zh-CN'),
    }));

    return {
      message: `项目背景: ${formatted.length} 条记录`,
      results: formatted,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 注册函数
// ═══════════════════════════════════════════════════════════

/**
 * 注册所有记忆工具
 */
function registerMemoryTools() {
  toolRegistry.register(memoryRecallTool);
  toolRegistry.register(memoryStoreTool);
  toolRegistry.register(memorySearchTool);
  toolRegistry.register(memoryListRecentTool);
  toolRegistry.register(memoryCompanyFactsTool);
  toolRegistry.register(memoryUserProfileTool);
  toolRegistry.register(memoryProjectContextTool);
}

module.exports = {
  registerMemoryTools,
  memoryRecallTool,
  memoryStoreTool,
  memorySearchTool,
  memoryListRecentTool,
  memoryCompanyFactsTool,
  memoryUserProfileTool,
  memoryProjectContextTool,
};
