/**
 * SoloForge - 工具执行器
 * 解析工具调用、检查权限、执行工具
 * @module tools/tool-executor
 */

const { toolRegistry } = require('./tool-registry');
const { PermissionChecker } = require('./permission-checker');
const { logger } = require('../utils/logger');
const { virtualFileStore, VIRTUALIZE_THRESHOLD, PREVIEW_LENGTH } = require('../context/virtual-file-store');

/**
 * 工具名别名映射表
 * LLM 经常使用错误的工具名，这里统一纠正
 */
const TOOL_NAME_ALIASES = {
  // 文件操作
  fs_write: 'write_file',
  fs_read: 'read_file',
  read_code: 'read_file',
  write_code: 'write_file',
  file_read: 'read_file',
  file_write: 'write_file',
  readFile: 'read_file',
  writeFile: 'write_file',
  // 目录操作
  list_dir: 'list_files',
  ls: 'list_files',
  list_directory: 'list_files',
  listDir: 'list_files',
  listFiles: 'list_files',
  // Shell
  execute_command: 'shell',
  run_command: 'shell',
  exec: 'shell',
  execute_shell: 'shell',
  run_shell: 'shell',
  terminal: 'shell',
  bash: 'shell',
  // 诊断
  get_diagnostics: 'list_files',
  getDiagnostics: 'list_files',
  // Git
  git_clone: 'git_init',
  gitStatus: 'git_status',
  gitCommit: 'git_commit',
  gitLog: 'git_log',
  gitBranch: 'git_branch',
};

/**
 * 解析 XML 格式的工具调用
 * 支持多种格式：
 * 1. 标准格式: <tool_call><name>xxx</name><arguments>...</arguments></tool_call>
 * 2. glm 错误格式: <tool_call>tool_name><param>value</param></tool_name>
 * 3. glm 错误格式2: <tool_call>tool_name<param>value</param></arguments></think>
 * @param {string} content - LLM 响应内容
 * @returns {Array<{name: string, arguments: Object}>}
 */
function parseToolCalls(content) {
  const toolCalls = [];
  
  // 策略1: 标准格式 <tool_call>...</tool_call>
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const toolCallXml = match[1];
    
    // 解析工具名称
    const nameMatch = toolCallXml.match(/<name>([\s\S]*?)<\/name>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();

    // 解析参数
    const argsMatch = toolCallXml.match(/<arguments>([\s\S]*?)<\/arguments>/);
    let args = {};
    
    if (argsMatch) {
      const argsContent = argsMatch[1].trim();

      // 策略1: 尝试 XML 格式参数 <param>value</param>
      const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(argsContent)) !== null) {
        const paramName = paramMatch[1];
        let paramValue = paramMatch[2].trim();
        
        // 尝试解析数字
        if (/^-?\d+(\.\d+)?$/.test(paramValue)) {
          paramValue = parseFloat(paramValue);
        }
        // 尝试解析布尔值
        else if (paramValue === 'true') {
          paramValue = true;
        } else if (paramValue === 'false') {
          paramValue = false;
        }
        
        args[paramName] = paramValue;
      }

      // 策略2: XML 解析结果为空时，尝试 JSON 格式
      if (Object.keys(args).length === 0 && argsContent) {
        try {
          // 直接解析 JSON 对象
          const jsonArgs = JSON.parse(argsContent);
          if (jsonArgs && typeof jsonArgs === 'object' && !Array.isArray(jsonArgs)) {
            args = jsonArgs;
          }
        } catch {
          // 策略3: 尝试提取内嵌的 JSON（LLM 可能在 JSON 前后加了说明文字）
          const jsonMatch = argsContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const jsonArgs = JSON.parse(jsonMatch[0]);
              if (jsonArgs && typeof jsonArgs === 'object' && !Array.isArray(jsonArgs)) {
                args = jsonArgs;
              }
            } catch {
              // 策略4: key=value 或 key: value 格式
              const kvRegex = /(\w+)\s*[:=]\s*"([^"]*)"/g;
              let kvMatch;
              while ((kvMatch = kvRegex.exec(argsContent)) !== null) {
                args[kvMatch[1]] = kvMatch[2];
              }
            }
          }
        }
      }

      if (Object.keys(args).length === 0 && argsContent) {
        logger.warn('工具参数解析失败，原始内容:', argsContent.slice(0, 200));
      }
    }

    toolCalls.push({ name, arguments: args });
  }

  // 策略2: 兼容 glm 错误格式 <tool_call>tool_name>...<param>value</param>...</tool_name>
  // 例如: <tool_call>read_file><path>/some/path</path></read_file>
  if (toolCalls.length === 0) {
    const glmRegex = /<tool_call>(\w+)>([\s\S]*?)<\/\1>/g;
    let glmMatch;
    
    while ((glmMatch = glmRegex.exec(content)) !== null) {
      const name = glmMatch[1].trim();
      const argsContent = glmMatch[2].trim();
      let args = {};
      
      // 解析参数 <param>value</param>
      const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(argsContent)) !== null) {
        const paramName = paramMatch[1];
        let paramValue = paramMatch[2].trim();
        
        // 尝试解析数字
        if (/^-?\d+(\.\d+)?$/.test(paramValue)) {
          paramValue = parseFloat(paramValue);
        }
        // 尝试解析布尔值
        else if (paramValue === 'true') {
          paramValue = true;
        } else if (paramValue === 'false') {
          paramValue = false;
        }
        
        args[paramName] = paramValue;
      }
      
      if (name) {
        logger.debug('解析 glm 格式工具调用:', { name, args });
        toolCalls.push({ name, arguments: args });
      }
    }
  }

  // 策略3: 兼容更宽松的 glm 格式 <tool_call>tool_name<param>value</param>...
  // 例如: <tool_call>hr_org_chart<tool_call>hr_list_agents
  if (toolCalls.length === 0) {
    // 匹配 <tool_call>tool_name 后面跟着参数或其他内容
    const looseRegex = /<tool_call>(\w+)(?:[>\s<]|$)/g;
    let looseMatch;
    const seenTools = new Set();
    
    while ((looseMatch = looseRegex.exec(content)) !== null) {
      const name = looseMatch[1].trim();
      if (name && !seenTools.has(name)) {
        seenTools.add(name);
        
        // 尝试在这个工具名之后找参数
        const afterMatch = content.slice(looseMatch.index + looseMatch[0].length);
        let args = {};
        
        // 提取可能的参数（在遇到下一个 <tool_call> 之前）
        const nextToolIndex = afterMatch.indexOf('<tool_call>');
        const argsSection = nextToolIndex > 0 ? afterMatch.slice(0, nextToolIndex) : afterMatch.slice(0, 500);
        
        // 解析参数 <param>value</param>
        const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
        let paramMatch;
        while ((paramMatch = paramRegex.exec(argsSection)) !== null) {
          const paramName = paramMatch[1];
          // 跳过不像参数名的标签（如 type, arguments, think 等元标签）
          if (['type', 'arguments', 'think', 'name', 'tool_call', 'tool_result'].includes(paramName)) {
            continue;
          }
          let paramValue = paramMatch[2].trim();
          
          // 尝试解析数字
          if (/^-?\d+(\.\d+)?$/.test(paramValue)) {
            paramValue = parseFloat(paramValue);
          }
          // 尝试解析布尔值
          else if (paramValue === 'true') {
            paramValue = true;
          } else if (paramValue === 'false') {
            paramValue = false;
          }
          
          args[paramName] = paramValue;
        }
        
        logger.debug('解析宽松 glm 格式工具调用:', { name, args });
        toolCalls.push({ name, arguments: args });
      }
    }
  }

  return toolCalls;
}

/**
 * 检查内容是否包含工具调用
 * @param {string} content
 * @returns {boolean}
 */
function hasToolCalls(content) {
  // 标准格式或 glm 错误格式都算有工具调用
  return /<tool_call>/.test(content);
}

/**
 * 尝试修复常见的 XML 格式错误
 * @param {string} content - 原始内容
 * @returns {string} 修复后的内容
 */
function tryFixMalformedToolCall(content) {
  let fixed = content;
  
  // 修复 <tool_call>tool_name>...</tool_name> 为标准格式
  // 例如: <tool_call>read_file><path>xxx</path></read_file>
  // 变成: <tool_call><name>read_file</name><arguments><path>xxx</path></arguments></tool_call>
  fixed = fixed.replace(
    /<tool_call>(\w+)>([\s\S]*?)<\/\1>/g,
    (match, name, params) => {
      return `<tool_call><name>${name}</name><arguments>${params}</arguments></tool_call>`;
    }
  );
  
  return fixed;
}

/**
 * 从内容中移除工具调用标签，获取纯文本
 * @param {string} content
 * @returns {string}
 */
function removeToolCalls(content) {
  return content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
}

/**
 * 工具执行器
 */
class ToolExecutor {
  /**
   * @param {Object} options
   * @param {Object} options.userPermissions - 用户权限配置
   * @param {Function} [options.onConfirmRequired] - 需要用户确认时的回调
   */
  constructor(options = {}) {
    this.permissionChecker = new PermissionChecker(options.userPermissions || {});
    this.onConfirmRequired = options.onConfirmRequired || null;
    this.pendingConfirmations = new Map();
  }

  /**
   * 更新用户权限
   * @param {Object} permissions
   */
  setPermissions(permissions) {
    this.permissionChecker.setPermissions(permissions);
  }

  /**
   * 设置确认回调
   * @param {Function} callback
   */
  setConfirmCallback(callback) {
    this.onConfirmRequired = callback;
  }

  /**
   * 请求用户确认
   * @param {Object} request
   * @param {string} request.type - 确认类型 (shell, write, git)
   * @param {string} request.toolName - 工具名称
   * @param {Object} request.args - 工具参数
   * @param {string} request.agentName - 请求的 Agent 名称
   * @returns {Promise<boolean>}
   */
  async requestConfirmation(request) {
    if (!this.onConfirmRequired) {
      // 没有确认回调时自动批准
      // 用户已在权限配置中启用了对应功能（writeEnabled/shell.enabled 等）
      // confirm 只是可选的二次确认机制，未实现时不应阻断操作
      logger.debug('需要用户确认但未设置确认回调，自动批准:', request.toolName);
      return true;
    }

    return await this.onConfirmRequired(request);
  }

  /**
   * 执行单个工具
   * @param {string} toolName - 工具名称
   * @param {Object} args - 工具参数
   * @param {Object} context - 执行上下文
   * @param {string} context.agentId - 调用的 Agent ID
   * @param {string} context.agentName - 调用的 Agent 名称
   * @returns {Promise<{success: boolean, result?: any, error?: string}>}
   */
  async executeTool(toolName, args, context = {}) {
    // 工具名别名映射：LLM 常用的错误名称 → 正确名称
    const resolvedName = TOOL_NAME_ALIASES[toolName] || toolName;
    if (resolvedName !== toolName) {
      logger.info(`工具名纠正: ${toolName} → ${resolvedName}`);
    }

    const tool = toolRegistry.get(resolvedName);
    
    if (!tool) {
      // 尝试模糊匹配：去掉下划线比较
      const allTools = toolRegistry.getAll();
      const normalized = toolName.toLowerCase().replace(/[_\-\s]/g, '');
      const fuzzyMatch = allTools.find(
        (t) => t.name.toLowerCase().replace(/[_\-\s]/g, '') === normalized
      );
      if (fuzzyMatch) {
        logger.info(`工具名模糊匹配: ${toolName} → ${fuzzyMatch.name}`);
        return this.executeTool(fuzzyMatch.name, args, context);
      }
      return { success: false, error: `未知工具: ${toolName}。请使用 <tool_call> 中列出的工具名称。` };
    }

    // 第 3 层防御：停职 Agent 的一切工具调用直接拦截
    if (context.agentId) {
      const { agentConfigStore } = require('../config/agent-config-store');
      const executorConfig = agentConfigStore.get(context.agentId);
      const executorStatus = executorConfig?.status || 'active';
      if (executorStatus === 'suspended' || executorStatus === 'terminated') {
        logger.warn(`停职 Agent 尝试使用工具被拦截: ${context.agentId} → ${resolvedName}`);
        return { success: false, error: '你已被停职，无法使用任何工具。如需申诉，请直接与老板对话。' };
      }
    }

    // 参数名归一化：LLM 可能用了别名或 camelCase，映射到工具定义的 snake_case 参数名
    // 注意：归一化必须在权限检查之前，否则权限检查会因参数名不匹配而读到 undefined
    const normalizedArgs = this._normalizeArgs(tool, args);

    // 必填参数校验：归一化后检查是否缺少必填参数，提前给出精确反馈
    const paramError = this._validateRequiredParams(tool, normalizedArgs, args);
    if (paramError) {
      logger.warn(`工具 ${resolvedName} 参数校验失败:`, paramError);
      return { success: false, error: paramError };
    }

    // 检查权限（使用解析后的工具名 + 归一化后的参数）
    const permCheck = this.permissionChecker.checkToolPermission(resolvedName, normalizedArgs);
    
    if (!permCheck.allowed) {
      logger.warn(`工具 ${resolvedName} 权限检查失败:`, permCheck.reason);
      return { success: false, error: permCheck.reason };
    }

    // 如果需要用户确认
    if (permCheck.needConfirm) {
      const confirmed = await this.requestConfirmation({
        type: tool.category,
        toolName: resolvedName,
        args: normalizedArgs,
        agentId: context.agentId,
        agentName: context.agentName || context.agentId,
      });

      if (!confirmed) {
        return { success: false, error: '用户拒绝执行该操作' };
      }
    }

    // 执行工具
    try {
      const argKeys = Object.keys(normalizedArgs);
      if (argKeys.length === 0) {
        logger.warn(`执行工具: ${resolvedName} — 参数为空`, { agent: context.agentId });
      } else {
        logger.info(`执行工具: ${resolvedName}`, { argKeys, agent: context.agentId });
      }
      const result = await tool.execute(normalizedArgs, context);
      logger.info(`工具执行完成: ${resolvedName}`, { resultLength: JSON.stringify(result).length });

      // 如果工具自身返回了错误，附加参数提示帮助 LLM 纠正
      if (result && (result.error || result.success === false)) {
        const hint = this._buildParamHint(tool);
        const originalError = result.error || '执行失败';
        return {
          success: false,
          error: `${originalError}\n\n${hint}`,
          displayError: originalError, // 仅面向 UI 的简洁错误
        };
      }

      return { success: true, result };
    } catch (error) {
      logger.error(`工具执行失败: ${toolName}`, error);
      const hint = this._buildParamHint(tool);
      const originalError = error.message || '工具执行失败';
      return {
        success: false,
        error: `${originalError}\n\n${hint}`,
        displayError: originalError, // 仅面向 UI 的简洁错误
      };
    }
  }

  /**
   * 构建参数说明提示，供 LLM 在出错时参考
   * @param {Object} tool - 工具定义
   * @returns {string}
   */
  _buildParamHint(tool) {
    if (!tool.parameters || Object.keys(tool.parameters).length === 0) {
      return `【工具 ${tool.name}】无需参数。`;
    }

    const lines = [`【工具 ${tool.name} 正确参数】`];
    for (const [name, def] of Object.entries(tool.parameters)) {
      const req = def.required ? '必填' : '可选';
      const type = def.type || 'string';
      const desc = def.description || '';
      lines.push(`  - ${name} (${type}, ${req}): ${desc}`);
    }
    lines.push('请使用上述参数名重新调用。');
    return lines.join('\n');
  }

  /**
   * 校验必填参数，返回错误信息字符串或 null
   * @param {Object} tool - 工具定义
   * @param {Object} normalizedArgs - 归一化后的参数
   * @param {Object} originalArgs - 原始参数（用于提示）
   * @returns {string|null}
   */
  _validateRequiredParams(tool, normalizedArgs, originalArgs) {
    if (!tool.parameters) return null;

    const missing = [];
    for (const [name, def] of Object.entries(tool.parameters)) {
      if (def.required && (normalizedArgs[name] === undefined || normalizedArgs[name] === null || normalizedArgs[name] === '')) {
        missing.push(name);
      }
    }

    if (missing.length === 0) return null;

    const receivedKeys = Object.keys(originalArgs);
    const hint = this._buildParamHint(tool);
    return `缺少必填参数: ${missing.join(', ')}。你传入的参数名是: ${receivedKeys.length > 0 ? receivedKeys.join(', ') : '(空)'}。\n\n${hint}`;
  }

  /**
   * 参数名归一化：将 LLM 可能生成的别名/camelCase 映射到工具定义的参数名
   * @param {Object} tool - 工具定义
   * @param {Object} args - 原始参数
   * @returns {Object} 归一化后的参数
   */
  _normalizeArgs(tool, args) {
    if (!tool.parameters || !args || Object.keys(args).length === 0) {
      return args;
    }

    const definedParams = Object.keys(tool.parameters);
    if (definedParams.length === 0) return args;

    // 构建快速查找集合
    const definedSet = new Set(definedParams);
    const normalized = {};
    const unmapped = {};

    // 常见别名映射表 (LLM 常犯的错误)
    const ALIASES = {
      owner: 'owner_id',
      ownerId: 'owner_id',
      assignee: 'assignee_id',
      assigneeId: 'assignee_id',
      recipient: 'target_agent',
      recipientId: 'target_agent',
      target: 'target_agent',
      targetAgent: 'target_agent',
      goalId: 'goal_id',
      projectId: 'project_id',
      taskId: 'task_id',
      milestoneId: 'milestone_id',
      startDate: 'start_date',
      endDate: 'end_date',
      targetDate: 'target_date',
      dueDate: 'due_date',
      fileName: 'file_name',
      filePath: 'path',
      file_path: 'path',
      branchName: 'branch_name',
      commitMessage: 'commit_message',
      sourceBranch: 'source_branch',
      targetBranch: 'target_branch',
      prId: 'pr_id',
      autoDelegate: 'auto_delegate',
      estimateHours: 'estimate_hours',
      standupIntervalMinutes: 'standup_interval_minutes',
      createBranch: 'create_branch',
    };

    for (const [key, value] of Object.entries(args)) {
      // 1. 参数名完全匹配
      if (definedSet.has(key)) {
        normalized[key] = value;
        continue;
      }

      // 2. 查别名表
      const aliasTarget = ALIASES[key];
      if (aliasTarget && definedSet.has(aliasTarget)) {
        normalized[aliasTarget] = value;
        continue;
      }

      // 3. camelCase → snake_case 转换
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (definedSet.has(snakeKey)) {
        normalized[snakeKey] = value;
        continue;
      }

      // 4. 模糊匹配：去掉 _id 后缀或加上 _id 后缀
      if (definedSet.has(key + '_id')) {
        normalized[key + '_id'] = value;
        continue;
      }
      if (key.endsWith('_id') && definedSet.has(key.slice(0, -3))) {
        normalized[key.slice(0, -3)] = value;
        continue;
      }

      // 未匹配的参数也保留（工具可能有动态参数）
      unmapped[key] = value;
    }

    // 未映射的参数直接传入（避免丢失有用数据）
    for (const [key, value] of Object.entries(unmapped)) {
      if (!(key in normalized)) {
        normalized[key] = value;
      }
    }

    // 日志记录映射差异
    const originalKeys = Object.keys(args).sort().join(',');
    const normalizedKeys = Object.keys(normalized).sort().join(',');
    if (originalKeys !== normalizedKeys) {
      logger.info(`参数名归一化: ${originalKeys} → ${normalizedKeys}`);
    }

    return normalized;
  }

  /**
   * 执行多个工具调用
   * @param {Array<{name: string, arguments: Object}>} toolCalls
   * @param {Object} context
   * @param {Function} [onProgress] - 进度回调，每个工具完成时调用
   *   回调签名: ({ type: 'tool_result', id: string, name: string, success: boolean, result?: any, error?: string, duration: number })
   * @returns {Promise<Array<{name: string, success: boolean, result?: any, error?: string, duration: number}>>}
   */
  async executeToolCalls(toolCalls, context = {}, onProgress = null) {
    const results = [];

    for (const call of toolCalls) {
      const startTime = Date.now();
      const result = await this.executeTool(call.name, call.arguments, context);
      const duration = Date.now() - startTime;
      const entry = {
        name: call.name,
        ...result,
        duration,
      };
      results.push(entry);

      if (onProgress) {
        // 前端预览结果：对象直接发送（Electron IPC 支持结构化克隆），字符串截断
        let previewResult = entry.result;
        if (typeof previewResult === 'string' && previewResult.length > 2000) {
          previewResult = previewResult.slice(0, 2000) + '\n...(已截断)';
        }
        // 对象类型直接发送，不做 JSON.stringify，前端 formatToolResult 直接处理
        onProgress({
          type: 'tool_result',
          id: call.id,
          name: call.name,
          success: entry.success,
          result: previewResult,
          error: entry.displayError || entry.error || null,
          duration,
        });
      }
    }

    return results;
  }

  /**
   * 格式化工具执行结果（用于返回给 LLM）
   * 大结果（>5KB）会被外部化到虚拟文件，上下文只保留预览
   * 
   * @param {Array} results
   * @param {Object} [options]
   * @param {string} [options.sessionId] - 会话 ID（用于虚拟文件管理）
   * @returns {string}
   */
  formatToolResults(results, options = {}) {
    return results
      .map((r) => {
        if (r.success) {
          const resultStr = typeof r.result === 'string' 
            ? r.result 
            : JSON.stringify(r.result, null, 2);
          
          // 大结果外部化到虚拟文件（参考 lethain.com 方案）
          if (virtualFileStore.shouldVirtualize(resultStr)) {
            const vf = virtualFileStore.store(resultStr, {
              toolName: r.name,
              type: 'tool_result',
              sessionId: options.sessionId,
            });
            
            return `<tool_result name="${r.name}" success="true" virtualized="true">
[内容已存储到虚拟文件: ${vf.fileId}]
大小: ${vf.size} 字符

预览 (前 ${PREVIEW_LENGTH} 字符):
${vf.preview}

如需完整内容，请使用 read_virtual_file 工具读取。
</tool_result>`;
          }
          
          // 普通结果：保留原有截断逻辑作为兜底
          const maxLen = 10000;
          const truncated = resultStr.length > maxLen
            ? resultStr.slice(0, maxLen) + '\n...(输出已截断)'
            : resultStr;

          return `<tool_result name="${r.name}" success="true">
${truncated}
</tool_result>`;
        } else {
          return `<tool_result name="${r.name}" success="false">
错误: ${r.error}
</tool_result>`;
        }
      })
      .join('\n\n');
  }
}

module.exports = {
  ToolExecutor,
  parseToolCalls,
  hasToolCalls,
  removeToolCalls,
};
