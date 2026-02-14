/**
 * SoloForge - 预算预警系统
 * 监控 token 使用并在超出阈值时发送预警
 * @module budget/alert-system
 */

const { tokenTracker } = require('./token-tracker');
const { budgetManager } = require('./budget-manager');
const { logger } = require('../utils/logger');

/**
 * @typedef {Object} Alert
 * @property {string} id - 预警 ID
 * @property {'warning' | 'critical' | 'exceeded'} level - 预警级别
 * @property {'agent' | 'global'} scope - 预警范围
 * @property {string} [agentId] - Agent ID（scope 为 agent 时）
 * @property {string} message - 预警消息
 * @property {number} currentUsage - 当前使用量
 * @property {number} limit - 限额
 * @property {number} percentage - 使用百分比
 * @property {string} timestamp - 时间戳
 * @property {boolean} acknowledged - 是否已确认
 */

/**
 * 预警阈值配置
 */
const ALERT_THRESHOLDS = {
  warning: 70, // 70% 时警告
  critical: 90, // 90% 时严重警告
  exceeded: 100, // 100% 时超额
};

/**
 * 预警系统
 */
class AlertSystem {
  constructor() {
    /** @type {Alert[]} */
    this.alerts = [];
    this.listeners = new Set();
    this.checkInterval = null;
    this.lastChecked = new Map(); // 防止重复预警
  }

  /**
   * 启动预警监控
   * @param {number} [intervalMs=60000] - 检查间隔（毫秒）
   */
  start(intervalMs = 60000) {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.checkAndAlert();
    }, intervalMs);

    // 立即检查一次
    this.checkAndAlert();

    logger.info('预警系统已启动', { intervalMs });
  }

  /**
   * 停止预警监控
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('预警系统已停止');
  }

  /**
   * 检查并生成预警
   */
  checkAndAlert() {
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    // 获取今日使用量
    const totalUsage = tokenTracker.getTotalUsage(todayTimestamp);
    const globalBudget = budgetManager.getGlobalBudget();

    // 检查全局预算
    if (globalBudget.globalDailyLimit > 0) {
      const percentage = (totalUsage.totalTokens / globalBudget.globalDailyLimit) * 100;
      this.checkThreshold('global', null, totalUsage.totalTokens, globalBudget.globalDailyLimit, percentage);
    }

    // 检查各 Agent 预算
    const agentSummaries = tokenTracker.getSummary(undefined, todayTimestamp);
    const agentBudgets = budgetManager.getAllAgentBudgets();

    for (const summary of agentSummaries) {
      const budget = agentBudgets.find((b) => b.agentId === summary.agentId);
      if (budget?.enabled && budget.dailyLimit > 0) {
        const percentage = (summary.totalTokens / budget.dailyLimit) * 100;
        this.checkThreshold('agent', summary.agentId, summary.totalTokens, budget.dailyLimit, percentage);
      }
    }
  }

  /**
   * 检查阈值并生成预警
   * @param {'agent' | 'global'} scope
   * @param {string | null} agentId
   * @param {number} usage
   * @param {number} limit
   * @param {number} percentage
   */
  checkThreshold(scope, agentId, usage, limit, percentage) {
    const key = scope === 'agent' ? `agent:${agentId}` : 'global';
    const lastAlert = this.lastChecked.get(key);

    // 确定预警级别
    let level = null;
    if (percentage >= ALERT_THRESHOLDS.exceeded) {
      level = 'exceeded';
    } else if (percentage >= ALERT_THRESHOLDS.critical) {
      level = 'critical';
    } else if (percentage >= ALERT_THRESHOLDS.warning) {
      level = 'warning';
    }

    if (!level) {
      // 低于警戒线，清除历史记录
      this.lastChecked.delete(key);
      return;
    }

    // 防止同一级别重复预警（1小时内）
    const oneHour = 60 * 60 * 1000;
    if (lastAlert && lastAlert.level === level && Date.now() - lastAlert.timestamp < oneHour) {
      return;
    }

    // 生成预警
    const alert = this.createAlert(scope, agentId, level, usage, limit, percentage);
    this.alerts.push(alert);
    this.lastChecked.set(key, { level, timestamp: Date.now() });

    // 保留最近 100 条预警
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    // 通知监听器
    this.notifyListeners(alert);

    logger.warn('预算预警:', alert);
  }

  /**
   * 创建预警对象
   * @param {'agent' | 'global'} scope
   * @param {string | null} agentId
   * @param {'warning' | 'critical' | 'exceeded'} level
   * @param {number} usage
   * @param {number} limit
   * @param {number} percentage
   * @returns {Alert}
   */
  createAlert(scope, agentId, level, usage, limit, percentage) {
    const levelMessages = {
      warning: '接近预算上限',
      critical: '即将超出预算',
      exceeded: '已超出预算限额',
    };

    const scopeText = scope === 'agent' ? `Agent "${agentId}"` : '全局';

    return {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      level,
      scope,
      agentId: scope === 'agent' ? agentId : undefined,
      message: `${scopeText} ${levelMessages[level]}`,
      currentUsage: usage,
      limit,
      percentage: Math.round(percentage),
      timestamp: new Date().toISOString(),
      acknowledged: false,
    };
  }

  /**
   * 获取未确认的预警
   * @returns {Alert[]}
   */
  getUnacknowledged() {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  /**
   * 获取所有预警
   * @param {Object} [filter]
   * @param {'warning' | 'critical' | 'exceeded'} [filter.level]
   * @param {string} [filter.agentId]
   * @returns {Alert[]}
   */
  getAlerts(filter = {}) {
    let result = [...this.alerts];

    if (filter.level) {
      result = result.filter((a) => a.level === filter.level);
    }
    if (filter.agentId) {
      result = result.filter((a) => a.agentId === filter.agentId);
    }

    return result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * 确认预警
   * @param {string} alertId
   * @returns {boolean}
   */
  acknowledge(alertId) {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * 确认所有预警
   */
  acknowledgeAll() {
    for (const alert of this.alerts) {
      alert.acknowledged = true;
    }
  }

  /**
   * 添加监听器
   * @param {(alert: Alert) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知监听器
   * @param {Alert} alert
   */
  notifyListeners(alert) {
    for (const listener of this.listeners) {
      try {
        listener(alert);
      } catch (error) {
        logger.error('预警监听器执行失败:', error);
      }
    }
  }
}

// 单例
const alertSystem = new AlertSystem();

module.exports = { AlertSystem, alertSystem, ALERT_THRESHOLDS };
