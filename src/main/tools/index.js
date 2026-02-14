/**
 * SoloForge - 工具模块入口
 * @module tools
 */

const { ToolRegistry, toolRegistry } = require('./tool-registry');
const { PermissionChecker } = require('./permission-checker');
const {
  ToolExecutor,
  parseToolCalls,
  hasToolCalls,
  removeToolCalls,
} = require('./tool-executor');

module.exports = {
  ToolRegistry,
  toolRegistry,
  PermissionChecker,
  ToolExecutor,
  parseToolCalls,
  hasToolCalls,
  removeToolCalls,
};
