/**
 * 工具执行器 - 移动端版
 */

const { toolRegistry } = require('./tool-registry');
const { logger } = require('../../utils/logger');

/**
 * 解析 XML 格式的工具调用
 */
function parseToolCalls(content) {
  const toolCalls = [];
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const toolCallXml = match[1];
    
    const nameMatch = toolCallXml.match(/<name>([\s\S]*?)<\/name>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();

    const argsMatch = toolCallXml.match(/<arguments>([\s\S]*?)<\/arguments>/);
    let args = {};
    
    if (argsMatch) {
      const argsContent = argsMatch[1].trim();
      const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(argsContent)) !== null) {
        const paramName = paramMatch[1];
        let paramValue = paramMatch[2].trim();
        
        if (/^-?\d+(\.\d+)?$/.test(paramValue)) {
          paramValue = parseFloat(paramValue);
        } else if (paramValue === 'true') {
          paramValue = true;
        } else if (paramValue === 'false') {
          paramValue = false;
        }
        
        args[paramName] = paramValue;
      }
    }

    toolCalls.push({ name, arguments: args });
  }

  return toolCalls;
}

function hasToolCalls(content) {
  return /<tool_call>/.test(content);
}

function removeToolCalls(content) {
  return content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
}

class ToolExecutor {
  constructor(options = {}) {
    this.options = options;
  }

  async executeTool(toolName, args, context = {}) {
    const tool = toolRegistry.get(toolName);
    
    if (!tool) {
      return { success: false, error: `未知工具: ${toolName}` };
    }

    try {
      logger.info(`执行工具: ${toolName}`, { args, agent: context.agentId });
      const result = await tool.execute(args, context);
      logger.info(`工具执行完成: ${toolName}`);

      if (result && (result.error || result.success === false)) {
        return { success: false, error: result.error || '执行失败' };
      }

      return { success: true, result };
    } catch (error) {
      logger.error(`工具执行失败: ${toolName}`, error);
      return { success: false, error: error.message || '工具执行失败' };
    }
  }

  async executeToolCalls(toolCalls, context = {}, onProgress = null) {
    const results = [];

    for (const call of toolCalls) {
      const startTime = Date.now();
      const result = await this.executeTool(call.name, call.arguments, context);
      const duration = Date.now() - startTime;
      const entry = { name: call.name, ...result, duration };
      results.push(entry);

      if (onProgress) {
        onProgress({
          type: 'tool_result',
          name: call.name,
          success: entry.success,
          result: entry.result,
          error: entry.error,
          duration,
        });
      }
    }

    return results;
  }

  formatToolResults(results) {
    return results
      .map((r) => {
        if (r.success) {
          const resultStr = typeof r.result === 'string' 
            ? r.result 
            : JSON.stringify(r.result, null, 2);
          
          const maxLen = 5000;
          const truncated = resultStr.length > maxLen
            ? resultStr.slice(0, maxLen) + '\n...(已截断)'
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
