/**
 * SoloForge - 预算管理器
 * 管理各 Agent 的 token 预算
 * @module budget/budget-manager
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getConfigDir() {
  return dataPath.getBasePath();
}

function getBudgetsFile() {
  return path.join(dataPath.getBasePath(), 'budgets.json');
}

/**
 * @typedef {Object} AgentBudget
 * @property {string} agentId - Agent ID
 * @property {number} dailyLimit - 每日 token 限额
 * @property {number} totalLimit - 总 token 限额（0 表示无限制）
 * @property {boolean} enabled - 是否启用预算限制
 */

/**
 * @typedef {Object} BudgetConfig
 * @property {number} globalDailyLimit - 全局每日限额
 * @property {number} globalTotalLimit - 全局总限额
 * @property {Object.<string, AgentBudget>} agents - 各 Agent 预算
 */

/**
 * 默认预算配置
 * @returns {BudgetConfig}
 */
function getDefaultBudgets() {
  return {
    globalDailyLimit: 1000000, // 100 万 token/天
    globalTotalLimit: 0, // 无总限制
    agents: {},
  };
}

/**
 * 预算管理器
 */
class BudgetManager {
  constructor() {
    this.budgets = this.loadFromDisk();
  }

  /**
   * 确保配置目录存在
   */
  ensureConfigDir() {
    const dir = getConfigDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 从磁盘加载预算配置
   * @returns {BudgetConfig}
   */
  loadFromDisk() {
    try {
      const budgetsFile = getBudgetsFile();
      if (fs.existsSync(budgetsFile)) {
        const content = fs.readFileSync(budgetsFile, 'utf-8');
        const data = JSON.parse(content);
        logger.debug('加载预算配置成功');
        return { ...getDefaultBudgets(), ...data };
      }
    } catch (error) {
      logger.error('加载预算配置失败:', error);
    }
    return getDefaultBudgets();
  }

  /**
   * 保存到磁盘
   */
  saveToDisk() {
    try {
      this.ensureConfigDir();
      fs.writeFileSync(getBudgetsFile(), JSON.stringify(this.budgets, null, 2));
      logger.debug('保存预算配置成功');
    } catch (error) {
      logger.error('保存预算配置失败:', error);
    }
  }

  /**
   * 获取全局预算配置
   * @returns {{ globalDailyLimit: number, globalTotalLimit: number }}
   */
  getGlobalBudget() {
    return {
      globalDailyLimit: this.budgets.globalDailyLimit,
      globalTotalLimit: this.budgets.globalTotalLimit,
    };
  }

  /**
   * 设置全局预算
   * @param {Object} config
   * @param {number} [config.globalDailyLimit]
   * @param {number} [config.globalTotalLimit]
   */
  setGlobalBudget(config) {
    if (config.globalDailyLimit !== undefined) {
      this.budgets.globalDailyLimit = config.globalDailyLimit;
    }
    if (config.globalTotalLimit !== undefined) {
      this.budgets.globalTotalLimit = config.globalTotalLimit;
    }
    this.saveToDisk();
  }

  /**
   * 获取 Agent 预算
   * @param {string} agentId
   * @returns {AgentBudget | null}
   */
  getAgentBudget(agentId) {
    return this.budgets.agents[agentId] || null;
  }

  /**
   * 设置 Agent 预算
   * @param {string} agentId
   * @param {Partial<AgentBudget>} budget
   */
  setAgentBudget(agentId, budget) {
    const existing = this.budgets.agents[agentId] || {
      agentId,
      dailyLimit: 100000,
      totalLimit: 0,
      enabled: true,
    };

    this.budgets.agents[agentId] = {
      ...existing,
      ...budget,
      agentId,
    };

    this.saveToDisk();
    logger.info(`设置 Agent ${agentId} 预算:`, this.budgets.agents[agentId]);
  }

  /**
   * 获取所有 Agent 预算
   * @returns {AgentBudget[]}
   */
  getAllAgentBudgets() {
    return Object.values(this.budgets.agents);
  }

  /**
   * 检查是否超出预算
   * @param {string} agentId
   * @param {number} usedTokens - 已使用的 token 数
   * @param {number} [dailyUsed] - 今日已使用
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkBudget(agentId, usedTokens, dailyUsed = 0) {
    const agentBudget = this.getAgentBudget(agentId);

    // 检查 Agent 级别预算
    if (agentBudget?.enabled) {
      if (agentBudget.dailyLimit > 0 && dailyUsed >= agentBudget.dailyLimit) {
        return {
          allowed: false,
          reason: `Agent ${agentId} 已超出每日预算限额 (${dailyUsed}/${agentBudget.dailyLimit})`,
        };
      }
      if (agentBudget.totalLimit > 0 && usedTokens >= agentBudget.totalLimit) {
        return {
          allowed: false,
          reason: `Agent ${agentId} 已超出总预算限额 (${usedTokens}/${agentBudget.totalLimit})`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 删除 Agent 预算
   * @param {string} agentId
   */
  removeAgentBudget(agentId) {
    delete this.budgets.agents[agentId];
    this.saveToDisk();
  }

  /**
   * 重新初始化（切换公司后调用）
   * 从新路径重新加载预算配置
   */
  reinitialize() {
    this.budgets = this.loadFromDisk();
  }

  /**
   * 重置所有预算
   */
  reset() {
    this.budgets = getDefaultBudgets();
    this.saveToDisk();
    logger.info('已重置所有预算配置');
  }
}

// 单例
const budgetManager = new BudgetManager();

module.exports = { BudgetManager, budgetManager };
