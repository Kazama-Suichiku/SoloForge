/**
 * SoloForge - 上下文管理工具
 * 提供虚拟文件读取、暂存区管理等工具
 * 
 * @module tools/context-tools
 */

const { virtualFileStore } = require('../context/virtual-file-store');
const { scratchpadManager } = require('../context/agent-scratchpad');
const { logger } = require('../utils/logger');

// ═══════════════════════════════════════════════════════════
// 虚拟文件工具
// ═══════════════════════════════════════════════════════════

/**
 * 读取虚拟文件内容
 */
const readVirtualFileTool = {
  name: 'read_virtual_file',
  description: `读取虚拟文件的完整内容或指定范围。

当工具结果太大（>5KB）时，系统会将其存储为虚拟文件，只在上下文中保留预览。
使用此工具可以读取完整内容或搜索特定内容。

使用场景：
- 工具结果显示"内容已存储到虚拟文件: vf-xxx"时
- 需要查看被截断的完整输出
- 搜索大文件中的特定内容`,
  category: 'context',
  parameters: {
    file_id: {
      type: 'string',
      description: '虚拟文件 ID（格式: vf-xxx-xxx）',
      required: true,
    },
    offset: {
      type: 'number',
      description: '起始字符位置（从 0 开始，默认 0）',
      required: false,
    },
    limit: {
      type: 'number',
      description: '读取字符数（不指定则读取全部，建议分批读取大文件）',
      required: false,
    },
    grep: {
      type: 'string',
      description: '搜索模式（正则表达式），返回匹配内容及上下文',
      required: false,
    },
  },
  requiredPermissions: [],
  execute(args) {
    const { file_id, offset, limit, grep } = args;

    if (!file_id) {
      return { success: false, error: '缺少必要参数: file_id' };
    }

    // 安全校验：file_id 格式
    if (!/^vf-\d+-[\w]+$/.test(file_id)) {
      return { success: false, error: '无效的虚拟文件 ID 格式' };
    }

    // 安全校验：正则表达式长度限制（防止 ReDoS）
    if (grep && grep.length > 100) {
      return { success: false, error: '搜索模式过长（最大 100 字符）' };
    }

    // 安全校验：offset 和 limit
    if (offset !== undefined && (typeof offset !== 'number' || offset < 0)) {
      return { success: false, error: 'offset 必须是非负整数' };
    }
    if (limit !== undefined && (typeof limit !== 'number' || limit <= 0 || limit > 100000)) {
      return { success: false, error: 'limit 必须是 1-100000 之间的整数' };
    }

    const result = virtualFileStore.read(file_id, { offset, limit, grep });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // 搜索模式返回匹配结果
    if (grep && result.matches) {
      return {
        success: true,
        fileId: file_id,
        searchPattern: grep,
        totalMatches: result.totalMatches,
        matches: result.matches.map((m, i) => ({
          index: i + 1,
          match: m.match,
          position: m.index,
          context: m.context,
        })),
      };
    }

    // 范围读取返回内容
    return {
      success: true,
      fileId: file_id,
      content: result.content,
      totalSize: result.totalSize,
      offset: result.offset,
      returnedSize: result.returnedSize,
      hasMore: result.offset + result.returnedSize < result.totalSize,
    };
  },
};

/**
 * 列出虚拟文件
 */
const listVirtualFilesTool = {
  name: 'list_virtual_files',
  description: `列出当前会话的所有虚拟文件。

用于查看哪些大型工具结果被外部化存储了。`,
  category: 'context',
  parameters: {
    type: {
      type: 'string',
      description: '按类型过滤: tool_result, compressed_history',
      required: false,
    },
  },
  requiredPermissions: [],
  execute(args, context) {
    const files = virtualFileStore.list({
      sessionId: context?.sessionId,
      type: args.type,
    });

    if (files.length === 0) {
      return {
        success: true,
        message: '当前没有虚拟文件',
        files: [],
      };
    }

    return {
      success: true,
      totalFiles: files.length,
      files: files.map((f) => ({
        fileId: f.fileId,
        toolName: f.toolName || '未知',
        type: f.type || 'tool_result',
        size: f.size,
        sizeFormatted: (f.size / 1024).toFixed(1) + ' KB',
        createdAt: new Date(f.createdAt).toLocaleString('zh-CN'),
        readCount: f.readCount || 0,
      })),
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 暂存区工具
// ═══════════════════════════════════════════════════════════

/**
 * 更新暂存区
 */
const updateScratchpadTool = {
  name: 'update_scratchpad',
  description: `更新你的工作暂存区，记录重要发现或进度。

暂存区是你的持久化工作记忆，会在每次对话开始时自动恢复。
用于跨会话保持工作状态，确保重要信息不会因上下文压缩而丢失。

使用场景：
- 开始新任务时，设置当前任务
- 完成重要步骤后，记录进度
- 发现关键信息时（架构决策、代码模式、配置信息），添加关键发现
- 需要清空重新开始时，清空暂存区`,
  category: 'context',
  parameters: {
    action: {
      type: 'string',
      description: '操作类型: set_task(设置当前任务), record_step(记录步骤), add_finding(添加关键发现), add_file(添加处理文件), add_pending(添加待办), clear(清空)',
      required: true,
      enum: ['set_task', 'record_step', 'add_finding', 'add_file', 'add_pending', 'clear'],
    },
    content: {
      type: 'string',
      description: '内容（任务描述/步骤描述/发现内容/文件路径/待办操作）',
      required: false,
    },
    category: {
      type: 'string',
      description: '发现分类（仅 add_finding 时有效）: architecture/code_pattern/config/bug/decision/other',
      required: false,
    },
    priority: {
      type: 'number',
      description: '优先级 1-5（仅 add_pending 时有效，1 最高）',
      required: false,
    },
  },
  requiredPermissions: [],
  execute(args, context) {
    const { action, content, category, priority } = args;
    const agentId = context?.agentId;

    if (!agentId) {
      return { success: false, error: '无法确定调用者身份' };
    }

    const scratchpad = scratchpadManager.get(agentId);

    switch (action) {
      case 'set_task':
        if (!content) {
          return { success: false, error: '设置任务需要提供 content（任务描述）' };
        }
        scratchpad.setCurrentTask(content);
        return {
          success: true,
          message: `已设置当前任务: ${content.slice(0, 50)}...`,
        };

      case 'record_step':
        if (!content) {
          return { success: false, error: '记录步骤需要提供 content（步骤描述）' };
        }
        scratchpad.recordStep(content);
        return {
          success: true,
          message: `已记录步骤: ${content.slice(0, 50)}...`,
          totalSteps: scratchpad.data.taskHistory.length,
        };

      case 'add_finding':
        if (!content) {
          return { success: false, error: '添加发现需要提供 content（发现内容）' };
        }
        scratchpad.addKeyFinding(content, category || 'general');
        return {
          success: true,
          message: `已添加关键发现 [${category || 'general'}]: ${content.slice(0, 50)}...`,
          totalFindings: scratchpad.data.keyFindings.length,
        };

      case 'add_file':
        if (!content) {
          return { success: false, error: '添加文件需要提供 content（文件路径）' };
        }
        scratchpad.addWorkingFile(content, category || 'editing');
        return {
          success: true,
          message: `已添加处理文件: ${content}`,
          workingFiles: scratchpad.data.workingFiles.map((f) => f.path),
        };

      case 'add_pending':
        if (!content) {
          return { success: false, error: '添加待办需要提供 content（操作描述）' };
        }
        scratchpad.addPendingAction(content, priority || 3);
        return {
          success: true,
          message: `已添加待执行操作: ${content}`,
          pendingActions: scratchpad.data.pendingActions.map((a) => a.action),
        };

      case 'clear':
        scratchpad.clear();
        return {
          success: true,
          message: '暂存区已清空',
        };

      default:
        return {
          success: false,
          error: `未知操作: ${action}。支持: set_task, record_step, add_finding, add_file, add_pending, clear`,
        };
    }
  },
};

/**
 * 查看暂存区
 */
const viewScratchpadTool = {
  name: 'view_scratchpad',
  description: `查看你的工作暂存区内容。

用于检查当前保存的工作状态、已完成步骤、关键发现等。`,
  category: 'context',
  parameters: {},
  requiredPermissions: [],
  execute(args, context) {
    const agentId = context?.agentId;

    if (!agentId) {
      return { success: false, error: '无法确定调用者身份' };
    }

    const scratchpad = scratchpadManager.get(agentId);
    const data = scratchpad.getData();

    return {
      success: true,
      agentId,
      currentTask: data.currentTask,
      taskStartedAt: data.currentTaskMeta?.startedAt
        ? new Date(data.currentTaskMeta.startedAt).toLocaleString('zh-CN')
        : null,
      recentSteps: data.taskHistory.slice(-5).map((s) => ({
        description: s.description,
        time: new Date(s.timestamp).toLocaleString('zh-CN'),
      })),
      keyFindings: data.keyFindings.slice(-10).map((f) => ({
        content: f.content,
        category: f.category,
      })),
      workingFiles: data.workingFiles.map((f) => f.path),
      pendingActions: data.pendingActions.map((a) => ({
        action: a.action,
        priority: a.priority,
      })),
      lastUpdated: data.lastUpdated
        ? new Date(data.lastUpdated).toLocaleString('zh-CN')
        : null,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 历史回溯工具
// ═══════════════════════════════════════════════════════════

/**
 * 回溯被压缩的历史记录
 */
const recallCompressedHistoryTool = {
  name: 'recall_compressed_history',
  description: `回溯被压缩的工具调用历史记录。

当上下文压缩后显示"完整内容见虚拟文件 vf-xxx"时，使用此工具查找之前的工具调用结果。

使用场景：
- 需要查看之前某个工具的完整返回结果
- 想知道之前是否执行过某个操作
- 搜索之前的代码/文件内容`,
  category: 'context',
  parameters: {
    virtual_file_id: {
      type: 'string',
      description: '压缩历史的虚拟文件 ID（格式: vf-xxx-xxx）',
      required: true,
    },
    search_query: {
      type: 'string',
      description: '搜索关键词（支持正则表达式）',
      required: false,
    },
    tool_name: {
      type: 'string',
      description: '按工具名过滤（如 read_file, shell, git_status）',
      required: false,
    },
  },
  requiredPermissions: [],
  execute(args) {
    const { virtual_file_id, search_query, tool_name } = args;

    if (!virtual_file_id) {
      return { success: false, error: '缺少必要参数: virtual_file_id' };
    }

    // 安全校验：file_id 格式
    if (!/^vf-\d+-[\w]+$/.test(virtual_file_id)) {
      return { success: false, error: '无效的虚拟文件 ID 格式' };
    }

    // 安全校验：搜索关键词长度限制（防止 ReDoS）
    if (search_query && search_query.length > 100) {
      return { success: false, error: '搜索关键词过长（最大 100 字符）' };
    }

    // 读取虚拟文件
    const readResult = virtualFileStore.read(virtual_file_id);
    if (!readResult.success) {
      return { success: false, error: readResult.error };
    }

    // 解析 JSON 历史
    let history;
    try {
      history = JSON.parse(readResult.content);
    } catch (err) {
      return { success: false, error: '历史记录格式错误，无法解析' };
    }

    if (!Array.isArray(history)) {
      return { success: false, error: '历史记录格式不正确' };
    }

    // 过滤和搜索
    let results = history;

    // 按工具名过滤
    if (tool_name) {
      results = results.filter((msg) => {
        if (!msg.content) return false;
        return msg.content.includes(`<name>${tool_name}</name>`) ||
               msg.content.includes(`name="${tool_name}"`) ||
               msg.content.includes(`工具: ${tool_name}`);
      });
    }

    // 按关键词搜索
    if (search_query) {
      try {
        const regex = new RegExp(search_query, 'gi');
        results = results.filter((msg) => {
          if (!msg.content) return false;
          return regex.test(msg.content);
        });
      } catch (err) {
        // 如果正则无效，退化为普通字符串搜索
        const query = search_query.toLowerCase();
        results = results.filter((msg) => {
          if (!msg.content) return false;
          return msg.content.toLowerCase().includes(query);
        });
      }
    }

    if (results.length === 0) {
      return {
        success: true,
        message: '未找到匹配的历史记录',
        searchCriteria: { tool_name, search_query },
        totalRecords: history.length,
      };
    }

    // 格式化结果（限制返回数量避免上下文爆炸）
    const maxResults = 5;
    const formatted = results.slice(0, maxResults).map((msg, idx) => {
      const content = msg.content || '';
      // 提取工具名
      const toolMatch = content.match(/<name>([^<]+)<\/name>/);
      const toolName = toolMatch ? toolMatch[1] : 'unknown';

      // 截断过长内容
      const preview = content.length > 1000
        ? content.slice(0, 1000) + '\n...(已截断)'
        : content;

      return {
        index: idx + 1,
        role: msg.role,
        toolName,
        preview,
      };
    });

    return {
      success: true,
      totalMatches: results.length,
      showing: Math.min(maxResults, results.length),
      results: formatted,
      tip: results.length > maxResults
        ? `还有 ${results.length - maxResults} 条匹配结果未显示，请使用更精确的搜索条件`
        : null,
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 注册
// ═══════════════════════════════════════════════════════════

const { toolRegistry } = require('./tool-registry');

const contextTools = [
  readVirtualFileTool,
  listVirtualFilesTool,
  updateScratchpadTool,
  viewScratchpadTool,
  recallCompressedHistoryTool,
];

/**
 * 注册上下文工具
 */
function registerContextTools() {
  for (const tool of contextTools) {
    toolRegistry.register(tool);
  }
  logger.info('上下文工具已注册', { count: contextTools.length });
}

module.exports = {
  readVirtualFileTool,
  listVirtualFilesTool,
  updateScratchpadTool,
  viewScratchpadTool,
  recallCompressedHistoryTool,
  contextTools,
  registerContextTools,
};
