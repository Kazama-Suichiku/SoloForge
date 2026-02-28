/**
 * SoloForge Mobile - 预算管理器
 * 管理各 Agent 的 token 预算（JSON 文件存储，无 Electron 依赖）
 * @module core/budget/budget-manager
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');

const DATA_DIR = path.join(__dirname, '../../../data');

function getBudgetsFile() {
  return path.join(DATA_DIR, 'budgets.json');
}

/**
 * @typedef {Object} AgentBudget
 * @property {string} agentId - Agent ID
 * @property {number} dailyLimit - 每日 token 限额
 * @property {number} totalLimit - 总 token 限额（0 表示无限制）
 * @property {boolean} enabled - 是否启用预算限制
 * @property {number} balance - 当前账户余额
 * @property {number} dailySalary - 每日工资
 * @property {string} lastPayday - 上次发薪日期 "YYYY-MM-DD"
 */

/**
 * @typedef {Object} BudgetConfig
 * @property {number} globalDailyLimit - 全局每日限额
 * @property {number} globalTotalLimit - 全局总限额
 * @property {Object.<string, AgentBudget>} agents - 各 Agent 预算
 * @property {Object.<string, number>} levelSalaryDefaults - 职级默认工资配置
 */

const DEFAULT_LEVEL_SALARIES = {
  c_level: 500000,
  vp: 300000,
  director: 200000,
  manager: 150000,
  senior: 100000,
  staff: 80000,
  intern: 50000,
  assistant: 30000,
};

const DOWNGRADE_MODEL = 'deepseek-chat';

function getDefaultBudgets() {
  return {
    globalDailyLimit: 1000000,
    globalTotalLimit: 0,
    agents: {},
    temporaryOverrides: {},
    blockedAgents: [],
    levelSalaryDefaults: { ...DEFAULT_LEVEL_SALARIES },
  };
}

function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

class BudgetManager {
  constructor() {
    this.budgets = this.loadFromDisk();
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  loadFromDisk() {
    try {
      const budgetsFile = getBudgetsFile();
      if (fs.existsSync(budgetsFile)) {
        const content = fs.readFileSync(budgetsFile, 'utf-8');
        const data = JSON.parse(content);
        return { ...getDefaultBudgets(), ...data };
      }
    } catch (error) {
      logger.error('加载预算配置失败:', error);
    }
    return getDefaultBudgets();
  }

  saveToDisk() {
    try {
      this._ensureDataDir();
      fs.writeFileSync(getBudgetsFile(), JSON.stringify(this.budgets, null, 2));
    } catch (error) {
      logger.error('保存预算配置失败:', error);
    }
  }

  getGlobalBudget() {
    return {
      globalDailyLimit: this.budgets.globalDailyLimit,
      globalTotalLimit: this.budgets.globalTotalLimit,
    };
  }

  setGlobalBudget(config) {
    if (config.globalDailyLimit !== undefined) this.budgets.globalDailyLimit = config.globalDailyLimit;
    if (config.globalTotalLimit !== undefined) this.budgets.globalTotalLimit = config.globalTotalLimit;
    this.saveToDisk();
  }

  getAgentBudget(agentId) {
    return this.budgets.agents[agentId] || null;
  }

  setAgentBudget(agentId, budget) {
    const existing = this.budgets.agents[agentId] || {
      agentId,
      dailyLimit: 100000,
      totalLimit: 0,
      enabled: true,
    };
    this.budgets.agents[agentId] = { ...existing, ...budget, agentId };
    this.saveToDisk();
  }

  getAllAgentBudgets() {
    return Object.values(this.budgets.agents);
  }

  removeAgentBudget(agentId) {
    delete this.budgets.agents[agentId];
    this.saveToDisk();
  }

  checkBudgetWithStrategy(agentId) {
    const agentBudget = this.getAgentBudget(agentId);
    if (!agentBudget || !agentBudget.enabled) {
      return { action: 'allow', usagePercent: 0, balance: 0 };
    }

    const balance = agentBudget.balance ?? 0;
    const dailySalary = agentBudget.dailySalary || this.getDefaultSalary('staff');

    if (this.hasActiveOverride(agentId)) {
      return {
        action: balance < 0 ? 'warn' : 'allow',
        reason: '临时放行有效',
        usagePercent: 0,
        balance,
      };
    }

    const overdraftLimit = -dailySalary * 2;
    const usedFromSalary = dailySalary - balance;
    const usagePercent = dailySalary > 0 ? Math.round((usedFromSalary / dailySalary) * 100) : 0;

    if (balance <= overdraftLimit) {
      this._recordBlockedAgent(agentId, Math.abs(balance), dailySalary, usagePercent);
      return {
        action: 'block',
        reason: `账户深度透支`,
        usagePercent,
        balance,
      };
    }

    if (balance < 0) {
      return {
        action: 'downgrade',
        reason: `账户透支中`,
        downgradeTo: DOWNGRADE_MODEL,
        usagePercent,
        balance,
      };
    }

    if (balance < dailySalary * 0.3) {
      return {
        action: 'warn',
        reason: `余额较低`,
        usagePercent,
        balance,
      };
    }

    return { action: 'allow', usagePercent, balance };
  }

  _recordBlockedAgent(agentId, usage, limit, percent) {
    if (!this.budgets.blockedAgents) this.budgets.blockedAgents = [];
    const existing = this.budgets.blockedAgents.find((b) => b.agentId === agentId);
    if (existing) {
      Object.assign(existing, { usage, limit, percent, blockedAt: Date.now() });
    } else {
      this.budgets.blockedAgents.push({ agentId, usage, limit, percent, blockedAt: Date.now() });
    }
    this.saveToDisk();
  }

  getBlockedAgents() {
    return (this.budgets.blockedAgents || []).filter(
      (b) => !this.hasActiveOverride(b.agentId)
    );
  }

  _removeFromBlocked(agentId) {
    if (!this.budgets.blockedAgents) return;
    this.budgets.blockedAgents = this.budgets.blockedAgents.filter((b) => b.agentId !== agentId);
    this.saveToDisk();
  }

  grantTemporaryOverride(agentId, hours = 24, reason = '') {
    if (!agentId) return { success: false, error: 'agentId 不能为空' };
    if (!this.budgets.temporaryOverrides) this.budgets.temporaryOverrides = {};
    const now = Date.now();
    const override = {
      agentId,
      grantedAt: now,
      expiresAt: now + hours * 60 * 60 * 1000,
      reason: reason || `老板授予 ${hours} 小时临时放行`,
    };
    this.budgets.temporaryOverrides[agentId] = override;
    this._removeFromBlocked(agentId);
    this.saveToDisk();
    return { success: true, override };
  }

  hasActiveOverride(agentId) {
    const override = this.budgets.temporaryOverrides?.[agentId];
    if (!override) return false;
    const now = Date.now();
    if (override.expiresAt <= now) {
      delete this.budgets.temporaryOverrides[agentId];
      this.saveToDisk();
      return false;
    }
    return true;
  }

  revokeOverride(agentId) {
    if (this.budgets.temporaryOverrides?.[agentId]) {
      delete this.budgets.temporaryOverrides[agentId];
      this.saveToDisk();
      return { success: true };
    }
    return { success: false, error: '未找到该 Agent 的临时放行' };
  }

  getLevelSalaryDefaults() {
    if (!this.budgets.levelSalaryDefaults) {
      this.budgets.levelSalaryDefaults = { ...DEFAULT_LEVEL_SALARIES };
      this.saveToDisk();
    }
    return { ...this.budgets.levelSalaryDefaults };
  }

  getDefaultSalary(level) {
    const defaults = this.getLevelSalaryDefaults();
    return defaults[level] || defaults.staff || 80000;
  }

  setDefaultSalary(level, amount) {
    if (!level) return { success: false, error: '职级不能为空' };
    if (typeof amount !== 'number' || amount < 0) return { success: false, error: '日薪必须是非负数' };
    if (!this.budgets.levelSalaryDefaults) this.budgets.levelSalaryDefaults = { ...DEFAULT_LEVEL_SALARIES };
    const oldValue = this.budgets.levelSalaryDefaults[level];
    this.budgets.levelSalaryDefaults[level] = amount;
    this.saveToDisk();
    return { success: true, level, oldValue, newValue: amount };
  }

  setAgentSalary(agentId, amount) {
    if (!agentId) return { success: false, error: 'agentId 不能为空' };
    if (typeof amount !== 'number' || amount < 0) return { success: false, error: '日薪必须是非负数' };

    const today = getTodayString();
    let existing = this.budgets.agents[agentId];

    if (!existing) {
      this.budgets.agents[agentId] = {
        agentId,
        dailySalary: amount,
        balance: amount,
        lastPayday: today,
        dailyLimit: amount,
        totalLimit: 0,
        enabled: true,
      };
      this.saveToDisk();
      return { success: true, agentId, oldSalary: 0, newSalary: amount };
    }

    const oldSalary = existing.dailySalary || 0;
    existing.dailySalary = amount;
    this.saveToDisk();
    return { success: true, agentId, oldSalary, newSalary: amount };
  }

  getBalance(agentId) {
    const budget = this.budgets.agents[agentId];
    return budget?.balance ?? 0;
  }

  deductTokens(agentId, amount) {
    if (!agentId || typeof amount !== 'number') return { success: false, newBalance: 0 };
    const budget = this.budgets.agents[agentId];
    if (!budget) return { success: false, newBalance: 0 };
    if (typeof budget.balance !== 'number') {
      budget.balance = budget.dailySalary || this.getDefaultSalary('staff');
    }
    budget.balance -= amount;
    this.saveToDisk();
    return { success: true, newBalance: budget.balance };
  }

  addBonus(agentId, amount, reason = '') {
    if (!agentId) return { success: false, error: 'agentId 不能为空' };
    if (typeof amount !== 'number' || amount <= 0) return { success: false, error: '奖金必须是正数' };
    const budget = this.budgets.agents[agentId];
    if (!budget) return { success: false, error: `找不到 Agent ${agentId} 的预算记录` };
    if (typeof budget.balance !== 'number') budget.balance = 0;
    const oldBalance = budget.balance;
    budget.balance += amount;
    this.saveToDisk();
    return { success: true, newBalance: budget.balance, oldBalance, amount };
  }

  initSalaryAccount(agentId, level, customSalary) {
    const dailySalary = customSalary || this.getDefaultSalary(level);
    const today = getTodayString();
    const existing = this.budgets.agents[agentId] || { agentId, enabled: true };
    this.budgets.agents[agentId] = {
      ...existing,
      agentId,
      dailySalary,
      balance: dailySalary,
      lastPayday: today,
      dailyLimit: dailySalary,
      totalLimit: 0,
      enabled: true,
    };
    this.saveToDisk();
  }

  getAgentSalaryInfo(agentId) {
    const budget = this.budgets.agents[agentId];
    if (!budget) {
      let agentConfigStore;
      try {
        agentConfigStore = require('../config/agent-config-store').agentConfigStore;
      } catch {
        return null;
      }
      const config = agentConfigStore.get(agentId);
      if (!config) return null;
      const defaultSalary = this.getDefaultSalary(config.level || 'staff');
      return {
        agentId,
        balance: 0,
        dailySalary: defaultSalary,
        lastPayday: null,
        isOverdrawn: false,
        enabled: true,
        needsInit: true,
      };
    }
    return {
      agentId,
      balance: budget.balance ?? 0,
      dailySalary: budget.dailySalary ?? 0,
      lastPayday: budget.lastPayday || null,
      isOverdrawn: (budget.balance ?? 0) < 0,
      enabled: budget.enabled !== false,
    };
  }

  /**
   * 从桌面版 budgets.json 导入数据（合并到现有数据）
   * @param {string} desktopBudgetsPath - 桌面版 budgets.json 路径
   */
  importFromDesktop(desktopBudgetsPath) {
    try {
      if (!fs.existsSync(desktopBudgetsPath)) return { imported: false };
      const content = fs.readFileSync(desktopBudgetsPath, 'utf-8');
      const desktop = JSON.parse(content);

      if (desktop.agents && Object.keys(desktop.agents).length > 0) {
        for (const [agentId, agentBudget] of Object.entries(desktop.agents)) {
          const existing = this.budgets.agents[agentId];
          this.budgets.agents[agentId] = {
            ...(existing || {}),
            ...agentBudget,
            agentId,
          };
        }
      }
      if (desktop.globalDailyLimit !== undefined) this.budgets.globalDailyLimit = desktop.globalDailyLimit;
      if (desktop.globalTotalLimit !== undefined) this.budgets.globalTotalLimit = desktop.globalTotalLimit;
      if (desktop.levelSalaryDefaults && Object.keys(desktop.levelSalaryDefaults).length > 0) {
        this.budgets.levelSalaryDefaults = { ...this.budgets.levelSalaryDefaults, ...desktop.levelSalaryDefaults };
      }
      this.saveToDisk();
      return { imported: true };
    } catch (error) {
      logger.error('导入 budgets.json 失败:', error);
      return { imported: false, error: error.message };
    }
  }
}

const budgetManager = new BudgetManager();

module.exports = {
  BudgetManager,
  budgetManager,
  DOWNGRADE_MODEL,
  DEFAULT_LEVEL_SALARIES,
};
