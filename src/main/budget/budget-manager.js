/**
 * SoloForge - 预算管理器
 * 管理各 Agent 的 token 预算
 * @module budget/budget-manager
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

// 延迟加载 tokenTracker 避免循环依赖
let _tokenTracker = null;
function getTokenTracker() {
  if (!_tokenTracker) {
    _tokenTracker = require('./token-tracker').tokenTracker;
  }
  return _tokenTracker;
}

function getConfigDir() {
  return dataPath.getBasePath();
}

function getBudgetsFile() {
  return path.join(dataPath.getBasePath(), 'budgets.json');
}

/**
 * @typedef {Object} AgentBudget
 * @property {string} agentId - Agent ID
 * @property {number} dailyLimit - 每日 token 限额（旧版兼容）
 * @property {number} totalLimit - 总 token 限额（0 表示无限制）
 * @property {boolean} enabled - 是否启用预算限制
 * @property {number} balance - 当前账户余额（新增：工资系统）
 * @property {number} dailySalary - 每日工资（新增：工资系统）
 * @property {string} lastPayday - 上次发薪日期 "YYYY-MM-DD"（新增）
 */

/**
 * @typedef {Object} BudgetConfig
 * @property {number} globalDailyLimit - 全局每日限额
 * @property {number} globalTotalLimit - 全局总限额
 * @property {Object.<string, AgentBudget>} agents - 各 Agent 预算
 * @property {Object.<string, number>} levelSalaryDefaults - 职级默认工资配置
 */

/**
 * 职级默认工资配置
 * 可由 CFO 通过工具调整
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

/**
 * 预算策略阈值配置
 */
const BUDGET_THRESHOLDS = {
  warning: 70,    // 70% 开始警告
  downgrade: 90,  // 90% 降级到便宜模型
  block: 100,     // 100% 阻止调用
};

/**
 * 降级目标模型（便宜模型）
 */
const DOWNGRADE_MODEL = 'glm-4.7';

/**
 * 预算策略动作类型
 * @typedef {'allow' | 'warn' | 'downgrade' | 'block'} BudgetAction
 */

/**
 * @typedef {Object} BudgetStrategyResult
 * @property {BudgetAction} action - 执行动作
 * @property {string} [reason] - 原因说明
 * @property {string} [downgradeTo] - 降级目标模型
 * @property {number} usagePercent - 使用百分比
 */

/**
 * @typedef {Object} TemporaryOverride
 * @property {string} agentId - Agent ID
 * @property {number} grantedAt - 授予时间戳
 * @property {number} expiresAt - 过期时间戳
 * @property {string} [reason] - 放行原因
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
    temporaryOverrides: {}, // 临时放行记录
    blockedAgents: [], // 被阻止的 Agent 列表
    levelSalaryDefaults: { ...DEFAULT_LEVEL_SALARIES }, // 职级默认工资
  };
}

/**
 * 获取今天的日期字符串 YYYY-MM-DD
 * @returns {string}
 */
function getTodayString() {
  const today = new Date();
  return today.toISOString().split('T')[0];
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

  // ─── 预算策略相关方法 ───────────────────────────────────────

  /**
   * 获取今日 0 点时间戳
   * @returns {number}
   */
  _getTodayTimestamp() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.getTime();
  }

  /**
   * 带策略的预算检查（使用工资余额系统）
   * @param {string} agentId
   * @returns {BudgetStrategyResult}
   */
  checkBudgetWithStrategy(agentId) {
    // 获取 Agent 预算配置
    const agentBudget = this.getAgentBudget(agentId);

    // 如果没有预算记录或未启用，允许
    if (!agentBudget || !agentBudget.enabled) {
      return { action: 'allow', usagePercent: 0, balance: 0 };
    }

    // 使用工资余额系统
    const balance = agentBudget.balance ?? 0;
    const dailySalary = agentBudget.dailySalary || this.getDefaultSalary('staff');

    // 检查是否有临时放行
    if (this.hasActiveOverride(agentId)) {
      logger.debug(`Agent ${agentId} 有临时放行，允许调用（余额: ${balance}）`);
      return {
        action: balance < 0 ? 'warn' : 'allow',
        reason: '临时放行有效',
        usagePercent: 0,
        balance,
      };
    }

    // 透支警戒线：允许透支到 -2 倍日薪
    const overdraftLimit = -dailySalary * 2;

    // 计算使用百分比（基于日薪）
    const usedFromSalary = dailySalary - balance;
    const usagePercent = dailySalary > 0 ? Math.round((usedFromSalary / dailySalary) * 100) : 0;

    // 深度透支：超过警戒线则阻止
    if (balance <= overdraftLimit) {
      this._recordBlockedAgent(agentId, Math.abs(balance), dailySalary, usagePercent);
      return {
        action: 'block',
        reason: `账户深度透支 (余额: ${balance.toLocaleString()}，已超过警戒线 ${overdraftLimit.toLocaleString()})，需要老板审批`,
        usagePercent,
        balance,
      };
    }

    // 透支状态（余额为负但未超过警戒线）：降级到便宜模型
    if (balance < 0) {
      return {
        action: 'downgrade',
        reason: `账户透支中 (余额: ${balance.toLocaleString()})，自动降级到便宜模型`,
        downgradeTo: DOWNGRADE_MODEL,
        usagePercent,
        balance,
      };
    }

    // 余额较低（不足 30% 日薪）：警告
    if (balance < dailySalary * 0.3) {
      return {
        action: 'warn',
        reason: `余额较低 (${balance.toLocaleString()}，不足日薪 30%)`,
        usagePercent,
        balance,
      };
    }

    return { action: 'allow', usagePercent, balance };
  }

  /**
   * 记录被阻止的 Agent
   * @param {string} agentId
   * @param {number} usage
   * @param {number} limit
   * @param {number} percent
   */
  _recordBlockedAgent(agentId, usage, limit, percent) {
    if (!this.budgets.blockedAgents) {
      this.budgets.blockedAgents = [];
    }

    // 检查是否已存在
    const existing = this.budgets.blockedAgents.find((b) => b.agentId === agentId);
    if (existing) {
      existing.usage = usage;
      existing.limit = limit;
      existing.percent = percent;
      existing.blockedAt = Date.now();
    } else {
      this.budgets.blockedAgents.push({
        agentId,
        usage,
        limit,
        percent,
        blockedAt: Date.now(),
      });
    }

    this.saveToDisk();
    logger.warn(`Agent ${agentId} 因预算超限被阻止 (${usage}/${limit}, ${percent}%)`);
  }

  /**
   * 获取被阻止的 Agent 列表
   * @returns {Array}
   */
  getBlockedAgents() {
    // 过滤掉已有临时放行的
    const blocked = (this.budgets.blockedAgents || []).filter(
      (b) => !this.hasActiveOverride(b.agentId)
    );
    return blocked;
  }

  /**
   * 从被阻止列表移除
   * @param {string} agentId
   */
  _removeFromBlocked(agentId) {
    if (!this.budgets.blockedAgents) return;
    this.budgets.blockedAgents = this.budgets.blockedAgents.filter(
      (b) => b.agentId !== agentId
    );
    this.saveToDisk();
  }

  // ─── 临时放行相关方法 ───────────────────────────────────────

  /**
   * 授予临时预算放行
   * @param {string} agentId
   * @param {number} hours - 放行时长（小时），默认 24 小时
   * @param {string} [reason] - 放行原因
   * @returns {{ success: boolean, override?: TemporaryOverride, error?: string }}
   */
  grantTemporaryOverride(agentId, hours = 24, reason = '') {
    if (!agentId) {
      return { success: false, error: 'agentId 不能为空' };
    }

    if (!this.budgets.temporaryOverrides) {
      this.budgets.temporaryOverrides = {};
    }

    const now = Date.now();
    const override = {
      agentId,
      grantedAt: now,
      expiresAt: now + hours * 60 * 60 * 1000,
      reason: reason || `老板授予 ${hours} 小时临时放行`,
    };

    this.budgets.temporaryOverrides[agentId] = override;

    // 从被阻止列表移除
    this._removeFromBlocked(agentId);

    this.saveToDisk();
    logger.info(`授予 Agent ${agentId} 临时预算放行，有效期 ${hours} 小时`);

    return { success: true, override };
  }

  /**
   * 检查是否有有效的临时放行
   * @param {string} agentId
   * @returns {boolean}
   */
  hasActiveOverride(agentId) {
    const override = this.budgets.temporaryOverrides?.[agentId];
    if (!override) return false;

    const now = Date.now();
    if (override.expiresAt <= now) {
      // 已过期，清理
      delete this.budgets.temporaryOverrides[agentId];
      this.saveToDisk();
      return false;
    }

    return true;
  }

  /**
   * 获取所有有效的临时放行
   * @returns {TemporaryOverride[]}
   */
  getActiveOverrides() {
    const overrides = this.budgets.temporaryOverrides || {};
    const now = Date.now();
    const active = [];

    for (const [agentId, override] of Object.entries(overrides)) {
      if (override.expiresAt > now) {
        active.push({
          ...override,
          remainingHours: Math.round((override.expiresAt - now) / (60 * 60 * 1000) * 10) / 10,
        });
      }
    }

    return active;
  }

  /**
   * 撤销临时放行
   * @param {string} agentId
   * @returns {{ success: boolean }}
   */
  revokeOverride(agentId) {
    if (this.budgets.temporaryOverrides?.[agentId]) {
      delete this.budgets.temporaryOverrides[agentId];
      this.saveToDisk();
      logger.info(`撤销 Agent ${agentId} 的临时预算放行`);
      return { success: true };
    }
    return { success: false, error: '未找到该 Agent 的临时放行' };
  }

  /**
   * 清理过期的临时放行
   */
  cleanupExpiredOverrides() {
    const overrides = this.budgets.temporaryOverrides || {};
    const now = Date.now();
    let cleaned = 0;

    for (const agentId of Object.keys(overrides)) {
      if (overrides[agentId].expiresAt <= now) {
        delete overrides[agentId];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.saveToDisk();
      logger.debug(`清理了 ${cleaned} 个过期的临时放行`);
    }
  }

  // ─── 工资系统相关方法 ───────────────────────────────────────

  /**
   * 获取职级默认工资配置
   * @returns {Object.<string, number>}
   */
  getLevelSalaryDefaults() {
    // 确保有默认值
    if (!this.budgets.levelSalaryDefaults) {
      this.budgets.levelSalaryDefaults = { ...DEFAULT_LEVEL_SALARIES };
      this.saveToDisk();
    }
    return { ...this.budgets.levelSalaryDefaults };
  }

  /**
   * 获取指定职级的默认日薪
   * @param {string} level - 职级 ID（如 'staff', 'manager'）
   * @returns {number} 日薪金额
   */
  getDefaultSalary(level) {
    const defaults = this.getLevelSalaryDefaults();
    return defaults[level] || defaults.staff || 80000;
  }

  /**
   * 设置职级默认日薪（影响新入职员工）
   * @param {string} level - 职级 ID
   * @param {number} amount - 日薪金额
   * @returns {{ success: boolean, error?: string }}
   */
  setDefaultSalary(level, amount) {
    if (!level) {
      return { success: false, error: '职级不能为空' };
    }
    if (typeof amount !== 'number' || amount < 0) {
      return { success: false, error: '日薪必须是非负数' };
    }

    if (!this.budgets.levelSalaryDefaults) {
      this.budgets.levelSalaryDefaults = { ...DEFAULT_LEVEL_SALARIES };
    }

    const oldValue = this.budgets.levelSalaryDefaults[level];
    this.budgets.levelSalaryDefaults[level] = amount;
    this.saveToDisk();

    logger.info(`修改职级 ${level} 默认日薪: ${oldValue} -> ${amount}`);
    return { success: true, level, oldValue, newValue: amount };
  }

  /**
   * 设置单个 Agent 的日薪
   * @param {string} agentId
   * @param {number} amount
   * @returns {{ success: boolean, error?: string }}
   */
  setAgentSalary(agentId, amount) {
    if (!agentId) {
      return { success: false, error: 'agentId 不能为空' };
    }
    if (typeof amount !== 'number' || amount < 0) {
      return { success: false, error: '日薪必须是非负数' };
    }

    let existing = this.budgets.agents[agentId];
    
    // 如果不存在，自动初始化工资账户
    if (!existing) {
      const today = getTodayString();
      this.budgets.agents[agentId] = {
        agentId,
        dailySalary: amount,
        balance: amount, // 第一次设置，给一天的工资作为初始余额
        lastPayday: today,
        dailyLimit: amount,
        totalLimit: 0,
        enabled: true,
      };
      this.saveToDisk();
      logger.info(`初始化并设置 Agent ${agentId} 日薪: ${amount}`);
      return { success: true, agentId, oldSalary: 0, newSalary: amount };
    }

    const oldSalary = existing.dailySalary || 0;
    existing.dailySalary = amount;
    this.saveToDisk();

    logger.info(`调整 Agent ${agentId} 日薪: ${oldSalary} -> ${amount}`);
    return { success: true, agentId, oldSalary, newSalary: amount };
  }

  /**
   * 获取 Agent 当前余额
   * @param {string} agentId
   * @returns {number}
   */
  getBalance(agentId) {
    const budget = this.budgets.agents[agentId];
    return budget?.balance ?? 0;
  }

  /**
   * 扣除 Token（聊天时调用）
   * 允许余额变为负数（透支）
   * @param {string} agentId
   * @param {number} amount - 要扣除的 token 数量
   * @returns {{ success: boolean, newBalance: number }}
   */
  deductTokens(agentId, amount) {
    if (!agentId || typeof amount !== 'number') {
      return { success: false, newBalance: 0 };
    }

    const budget = this.budgets.agents[agentId];
    if (!budget) {
      // 没有预算记录，不扣款
      return { success: false, newBalance: 0 };
    }

    // 初始化 balance（兼容旧数据）
    if (typeof budget.balance !== 'number') {
      budget.balance = budget.dailySalary || this.getDefaultSalary('staff');
    }

    budget.balance -= amount;
    this.saveToDisk();

    logger.debug(`Agent ${agentId} 扣除 ${amount} tokens，余额: ${budget.balance}`);
    return { success: true, newBalance: budget.balance };
  }

  /**
   * 发放奖金（直接加到余额）
   * @param {string} agentId
   * @param {number} amount - 奖金金额
   * @param {string} [reason] - 发放原因
   * @returns {{ success: boolean, newBalance?: number, error?: string }}
   */
  addBonus(agentId, amount, reason = '') {
    if (!agentId) {
      return { success: false, error: 'agentId 不能为空' };
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return { success: false, error: '奖金必须是正数' };
    }

    const budget = this.budgets.agents[agentId];
    if (!budget) {
      return { success: false, error: `找不到 Agent ${agentId} 的预算记录` };
    }

    // 初始化 balance（兼容旧数据）
    if (typeof budget.balance !== 'number') {
      budget.balance = 0;
    }

    const oldBalance = budget.balance;
    budget.balance += amount;
    this.saveToDisk();

    logger.info(`Agent ${agentId} 获得奖金 ${amount}，原因: ${reason || '无'}，余额: ${oldBalance} -> ${budget.balance}`);
    return { success: true, newBalance: budget.balance, oldBalance, amount };
  }

  /**
   * 初始化 Agent 的工资账户（入职时调用）
   * @param {string} agentId
   * @param {string} level - 职级
   * @param {number} [customSalary] - 自定义日薪（可选）
   */
  initSalaryAccount(agentId, level, customSalary) {
    const dailySalary = customSalary || this.getDefaultSalary(level);
    const today = getTodayString();

    const existing = this.budgets.agents[agentId] || {
      agentId,
      enabled: true,
    };

    this.budgets.agents[agentId] = {
      ...existing,
      agentId,
      dailySalary,
      balance: dailySalary, // 入职当天发第一笔工资
      lastPayday: today,
      dailyLimit: dailySalary, // 兼容旧逻辑
      totalLimit: 0,
      enabled: true,
    };

    this.saveToDisk();
    logger.info(`初始化 Agent ${agentId} 工资账户: 日薪=${dailySalary}, 余额=${dailySalary}`);
  }

  /**
   * 处理每日发薪
   * 应在每日 00:00 调用
   * @returns {{ processedCount: number, results: Array }}
   */
  processPayday() {
    const today = getTodayString();
    const results = [];
    let processedCount = 0;

    // 延迟加载避免循环依赖
    let agentConfigStore;
    try {
      agentConfigStore = require('../config/agent-config-store').agentConfigStore;
    } catch (e) {
      logger.warn('无法加载 agentConfigStore，跳过发薪');
      return { processedCount: 0, results: [] };
    }

    for (const [agentId, budget] of Object.entries(this.budgets.agents)) {
      // 检查是否已经发过今天的工资
      if (budget.lastPayday === today) {
        continue;
      }

      // 检查 Agent 是否还在职
      const config = agentConfigStore.get(agentId);
      if (!config || config.status === 'terminated') {
        continue;
      }

      // 获取日薪
      const dailySalary = budget.dailySalary || this.getDefaultSalary(config.level || 'staff');

      // 计算新余额：当前余额 + 日薪
      // 如果是负数（透支），日薪会先填补欠款
      const oldBalance = budget.balance ?? 0;
      const newBalance = oldBalance + dailySalary;

      budget.balance = newBalance;
      budget.lastPayday = today;
      budget.dailySalary = dailySalary;

      results.push({
        agentId,
        agentName: config.name,
        oldBalance,
        dailySalary,
        newBalance,
        wasOverdrawn: oldBalance < 0,
      });

      processedCount++;
      logger.debug(`发薪: ${config.name}(${agentId}) 余额 ${oldBalance} + ${dailySalary} = ${newBalance}`);
    }

    if (processedCount > 0) {
      this.saveToDisk();
      logger.info(`每日发薪完成: 处理 ${processedCount} 位员工`);
    }

    return { processedCount, results };
  }

  /**
   * 补发缺失的工资（应用启动时调用）
   * 检查每个 Agent 的 lastPayday，补发缺失天数的工资
   * @returns {{ processedCount: number, missedDays: number }}
   */
  catchUpPaydays() {
    const today = getTodayString();
    const todayDate = new Date(today);
    let processedCount = 0;
    let totalMissedDays = 0;

    // 延迟加载
    let agentConfigStore;
    try {
      agentConfigStore = require('../config/agent-config-store').agentConfigStore;
    } catch (e) {
      logger.warn('无法加载 agentConfigStore，跳过补发');
      return { processedCount: 0, missedDays: 0 };
    }

    for (const [agentId, budget] of Object.entries(this.budgets.agents)) {
      // 检查 Agent 是否还在职
      const config = agentConfigStore.get(agentId);
      if (!config || config.status === 'terminated') {
        continue;
      }

      const lastPayday = budget.lastPayday;
      if (!lastPayday) {
        // 没有发薪记录，初始化
        budget.lastPayday = today;
        budget.balance = budget.dailySalary || this.getDefaultSalary(config.level || 'staff');
        processedCount++;
        continue;
      }

      // 计算缺失天数
      const lastPaydayDate = new Date(lastPayday);
      const diffTime = todayDate.getTime() - lastPaydayDate.getTime();
      const missedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (missedDays > 0) {
        const dailySalary = budget.dailySalary || this.getDefaultSalary(config.level || 'staff');
        const compensation = dailySalary * missedDays;

        const oldBalance = budget.balance ?? 0;
        budget.balance = oldBalance + compensation;
        budget.lastPayday = today;

        totalMissedDays += missedDays;
        processedCount++;

        logger.info(`补发工资: ${config.name} 缺失 ${missedDays} 天，补发 ${compensation} tokens`);
      }
    }

    if (processedCount > 0) {
      this.saveToDisk();
      logger.info(`补发工资完成: ${processedCount} 位员工，共 ${totalMissedDays} 天`);
    }

    return { processedCount, missedDays: totalMissedDays };
  }

  /**
   * 迁移现有 Agent 数据到工资系统
   * 为没有 balance/dailySalary 的 Agent 初始化
   * 包括 CXO 等原本没有预算记录的 Agent
   * @returns {{ migratedCount: number }}
   */
  migrateToSalarySystem() {
    const today = getTodayString();
    let migratedCount = 0;

    // 延迟加载
    let agentConfigStore;
    try {
      agentConfigStore = require('../config/agent-config-store').agentConfigStore;
    } catch (e) {
      logger.warn('无法加载 agentConfigStore，跳过迁移');
      return { migratedCount: 0 };
    }

    // 获取所有在职 Agent（包括 CXO）
    const allAgents = agentConfigStore.getAll().filter(
      (c) => c.status !== 'terminated'
    );

    // 为所有 Agent 创建或更新工资记录
    for (const config of allAgents) {
      const agentId = config.id;
      const budget = this.budgets.agents[agentId];

      // 检查是否已有完整的工资记录
      if (budget && typeof budget.balance === 'number' && typeof budget.dailySalary === 'number') {
        continue;
      }

      const level = config.level || 'staff';
      const dailySalary = this.getDefaultSalary(level);

      // 创建或更新工资记录
      this.budgets.agents[agentId] = {
        ...(budget || {}),
        agentId,
        dailySalary: budget?.dailyLimit || dailySalary,
        balance: budget?.dailyLimit || dailySalary,
        lastPayday: today,
        dailyLimit: budget?.dailyLimit || dailySalary,
        totalLimit: budget?.totalLimit || 0,
        enabled: true,
      };

      migratedCount++;
      logger.debug(`迁移 Agent ${config.name}(${agentId}) 到工资系统: dailySalary=${this.budgets.agents[agentId].dailySalary}`);
    }

    // 同时处理 budgets.agents 中可能存在但 agentConfigStore 中没有的记录（兼容）
    for (const [agentId, budget] of Object.entries(this.budgets.agents)) {
      // 检查是否需要迁移
      if (typeof budget.balance === 'number' && typeof budget.dailySalary === 'number') {
        continue;
      }

      const config = agentConfigStore.get(agentId);
      if (!config) {
        // Agent 不存在，跳过
        continue;
      }

      const level = config?.level || 'staff';
      const dailySalary = this.getDefaultSalary(level);

      // 使用旧的 dailyLimit 作为参考，或者使用职级默认值
      budget.dailySalary = budget.dailyLimit || dailySalary;
      budget.balance = budget.dailySalary; // 初始余额等于一天工资
      budget.lastPayday = today;

      migratedCount++;
      logger.debug(`迁移 Agent ${agentId} 到工资系统: dailySalary=${budget.dailySalary}`);
    }

    if (migratedCount > 0) {
      this.saveToDisk();
      logger.info(`工资系统迁移完成: ${migratedCount} 位员工`);
    }

    return { migratedCount };
  }

  /**
   * 获取 Agent 的完整薪资信息
   * @param {string} agentId
   * @returns {Object|null}
   */
  getAgentSalaryInfo(agentId) {
    const budget = this.budgets.agents[agentId];
    
    // 如果没有工资记录，尝试从 agentConfigStore 获取信息并返回默认值
    if (!budget) {
      // 延迟加载避免循环依赖
      let agentConfigStore;
      try {
        agentConfigStore = require('../config/agent-config-store').agentConfigStore;
      } catch (e) {
        return null;
      }

      const config = agentConfigStore.get(agentId);
      if (!config) {
        return null;
      }

      // 返回基于职级的默认信息（但不自动创建记录）
      const defaultSalary = this.getDefaultSalary(config.level || 'staff');
      return {
        agentId,
        balance: 0,
        dailySalary: defaultSalary,
        lastPayday: null,
        isOverdrawn: false,
        enabled: true,
        needsInit: true, // 标记需要初始化
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
}

// 单例
const budgetManager = new BudgetManager();

module.exports = {
  BudgetManager,
  budgetManager,
  BUDGET_THRESHOLDS,
  DOWNGRADE_MODEL,
  DEFAULT_LEVEL_SALARIES,
};
