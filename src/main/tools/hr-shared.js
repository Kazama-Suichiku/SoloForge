/**
 * SoloForge - HR 工具共享依赖
 *
 * 本文件集中存放各 hr-* 子模块共享的 require 和辅助依赖，避免重复。
 * 各 hr-<domain>-tools.js 子文件统一从这里引入共享依赖。
 *
 * @module tools/hr-shared
 */

const { toolRegistry } = require('./tool-registry');
const {
  agentConfigStore,
  LEVELS,
  DEPARTMENTS,
  departmentStore,
  CORE_AGENT_IDS,
  AGENT_STATUS,
  createDefaultOnboardingChecklist,
  getAgentDepartments,
} = require('../config/agent-config-store');
const { approvalQueue } = require('../agent-factory/approval-queue');
const { terminationQueue } = require('../agent-factory/termination-queue');
const { formatProfileForReview, validateProfile } = require('../agent-factory/agent-request');
const { tokenTracker } = require('../budget/token-tracker');
const { budgetManager } = require('../budget/budget-manager');
const { logger } = require('../utils/logger');

module.exports = {
  toolRegistry,
  agentConfigStore,
  LEVELS,
  DEPARTMENTS,
  departmentStore,
  CORE_AGENT_IDS,
  AGENT_STATUS,
  createDefaultOnboardingChecklist,
  getAgentDepartments,
  approvalQueue,
  terminationQueue,
  formatProfileForReview,
  validateProfile,
  tokenTracker,
  budgetManager,
  logger,
};
