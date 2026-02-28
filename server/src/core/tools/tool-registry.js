/**
 * 工具注册表 - 移动端版
 */

const { logger } = require('../../utils/logger');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool.name) {
      throw new Error('Tool must have a name');
    }
    if (this.tools.has(tool.name)) {
      logger.warn(`Tool "${tool.name}" already registered, skipping`);
      return;
    }
    this.tools.set(tool.name, tool);
  }

  get(name) {
    return this.tools.get(name) ?? null;
  }

  getAll() {
    return Array.from(this.tools.values());
  }

  getByCategory(category) {
    return this.getAll().filter((t) => t.category === category);
  }

  getToolDescriptions(tools) {
    const toolList = tools || this.getAll();
    if (toolList.length === 0) {
      return '当前没有可用工具。';
    }

    return toolList
      .map((tool) => {
        const params = Object.entries(tool.parameters || {})
          .map(([name, param]) => {
            const required = param.required ? '(必需)' : '(可选)';
            return `    - ${name}: ${param.type} ${required} - ${param.description}`;
          })
          .join('\n');

        return `工具: ${tool.name}
描述: ${tool.description}
参数:
${params || '    无参数'}`;
      })
      .join('\n\n');
  }

  getToolCallSchema(tools) {
    return `当你需要使用工具时，请使用以下 XML 格式：

<tool_call>
  <name>工具名称</name>
  <arguments>
    <参数名>参数值</参数名>
  </arguments>
</tool_call>

你可以在一次回复中调用多个工具。工具执行结果会返回给你，你可以根据结果继续处理。

可用工具：
${this.getToolDescriptions(tools)}`;
  }
}

const toolRegistry = new ToolRegistry();

module.exports = { ToolRegistry, toolRegistry };
