/**
 * SoloForge - 工具注册表
 * 定义所有可用工具及其元数据
 * @module tools/tool-registry
 */

/**
 * @typedef {Object} ToolParameter
 * @property {string} type - 参数类型 (string, number, boolean, array)
 * @property {string} description - 参数描述
 * @property {boolean} [required] - 是否必需
 * @property {*} [default] - 默认值
 */

/**
 * @typedef {Object} ToolDefinition
 * @property {string} name - 工具名称
 * @property {string} description - 工具描述
 * @property {string} category - 工具分类 (file, shell, git, network, math, cfo)
 * @property {Object.<string, ToolParameter>} parameters - 参数定义
 * @property {Function} execute - 执行函数
 * @property {string[]} [requiredPermissions] - 需要的用户权限
 */

/**
 * 工具注册表
 */
class ToolRegistry {
  constructor() {
    /** @type {Map<string, ToolDefinition>} */
    this.tools = new Map();
  }

  /**
   * 注册工具
   * @param {ToolDefinition} tool
   */
  register(tool) {
    if (!tool.name) {
      throw new Error('工具必须有名称');
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已注册`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 获取工具
   * @param {string} name
   * @returns {ToolDefinition | null}
   */
  get(name) {
    return this.tools.get(name) ?? null;
  }

  /**
   * 获取所有工具
   * @returns {ToolDefinition[]}
   */
  getAll() {
    return Array.from(this.tools.values());
  }

  /**
   * 按分类获取工具
   * @param {string} category
   * @returns {ToolDefinition[]}
   */
  getByCategory(category) {
    return this.getAll().filter((t) => t.category === category);
  }

  /**
   * 获取工具的描述（用于 LLM prompt）
   * @param {ToolDefinition[]} [tools] - 可选，指定要描述的工具列表；不传则使用所有已注册工具
   * @returns {string}
   */
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

  /**
   * 生成工具调用的 XML Schema 提示
   * @param {ToolDefinition[]} [tools] - 可选，指定可用的工具列表；不传则使用所有已注册工具
   * @returns {string}
   */
  getToolCallSchema(tools) {
    return `当你需要使用工具时，请使用以下 XML 格式：

<tool_call>
  <name>工具名称</name>
  <arguments>
    <参数名>参数值</参数名>
  </arguments>
</tool_call>

你可以在一次回复中调用多个工具。工具执行结果会返回给你，你可以根据结果继续处理。

⚠️ 关键规则：
- 只有通过 <tool_call> 标签调用工具才能真正执行操作
- 仅在回复文字中描述"我联系了XX""我查看了XX"不会产生任何效果——你必须输出 <tool_call> 标签
- 如果老板让你联系某人、查看某些信息、执行某个操作，你必须在本次回复中包含对应的 <tool_call> 标签
- 如果你不输出 <tool_call>，就等于什么都没做

可用工具：
${this.getToolDescriptions(tools)}`;
  }
}

// 单例
const toolRegistry = new ToolRegistry();

module.exports = { ToolRegistry, toolRegistry };
