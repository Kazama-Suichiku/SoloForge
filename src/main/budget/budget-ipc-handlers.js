/**
 * SoloForge - 预算系统 IPC 处理器
 * 处理 CFO Dashboard 和预算审批相关的 IPC 通信
 * @module budget/budget-ipc-handlers
 */

const { ipcMain } = require('electron');
const { tokenTracker } = require('./token-tracker');
const { budgetManager } = require('./budget-manager');
const { alertSystem } = require('./alert-system');
const { logger } = require('../utils/logger');

/**
 * 计算时间范围的起始时间戳
 * @param {string} period - 统计周期：today, week, month, all
 * @returns {number | undefined}
 */
function getPeriodTimestamp(period) {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  switch (period) {
    case 'today': {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return today.getTime();
    }
    case 'week':
      return now - 7 * oneDay;
    case 'month':
      return now - 30 * oneDay;
    case 'all':
    default:
      return undefined;
  }
}

/**
 * 格式化时间为本地时间
 * @param {number | undefined} ts
 * @returns {string}
 */
function formatLocalTime(ts) {
  if (!ts) return '所有时间';
  return new Date(ts).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * 设置预算系统 IPC 处理器
 */
function setupBudgetIpcHandlers() {
  // 获取 Token 统计（复用 cfo-tools.js 的逻辑）
  ipcMain.handle('budget:get-token-stats', async (_event, params = {}) => {
    const period = params?.period || 'today';
    logger.debug('IPC: budget:get-token-stats', { period });

    try {
      const sinceTimestamp = getPeriodTimestamp(period);

      // 获取统计
      const agentSummaries = tokenTracker.getSummary(undefined, sinceTimestamp);
      const totalUsage = tokenTracker.getTotalUsage(sinceTimestamp);

      // 获取预算信息
      const globalBudget = budgetManager.getGlobalBudget();
      const agentBudgets = budgetManager.getAllAgentBudgets();

      // 延迟加载 agentConfigStore
      const { agentConfigStore } = require('../config/agent-config-store');

      // 获取所有活跃员工（包括 CXO）
      const allAgents = agentConfigStore.getAll().filter((c) => c.status !== 'terminated');

      // 创建 token 统计的映射，方便查找
      const summaryMap = new Map();
      for (const summary of agentSummaries) {
        summaryMap.set(summary.agentId, summary);
      }

      // 合并所有员工信息（包括没有 token 使用记录的）
      const agentStats = allAgents.map((config) => {
        const agentId = config.id;
        const summary = summaryMap.get(agentId) || {
          agentId,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          callCount: 0,
        };
        const budget = agentBudgets.find((b) => b.agentId === agentId);
        const salaryInfo = budgetManager.getAgentSalaryInfo(agentId);

        return {
          ...summary,
          // 添加员工名称和职位信息
          agentName: config.name || agentId,
          agentTitle: config.title || '',
          agentLevel: config.level || '',
          budget: budget || null,
          // 工资系统信息
          salary: salaryInfo ? {
            balance: salaryInfo.balance,
            dailySalary: salaryInfo.dailySalary,
            lastPayday: salaryInfo.lastPayday,
            isOverdrawn: salaryInfo.isOverdrawn,
          } : null,
          budgetUsagePercent: salaryInfo?.dailySalary
            ? Math.round(((salaryInfo.dailySalary - salaryInfo.balance) / salaryInfo.dailySalary) * 100)
            : (budget?.dailyLimit ? Math.round((summary.totalTokens / budget.dailyLimit) * 100) : null),
        };
      });

      // 按日薪从高到低排序
      agentStats.sort((a, b) => (b.salary?.dailySalary || 0) - (a.salary?.dailySalary || 0));

      return {
        period,
        periodStart: formatLocalTime(sinceTimestamp),
        global: {
          ...totalUsage,
          globalDailyLimit: globalBudget.globalDailyLimit,
          globalTotalLimit: globalBudget.globalTotalLimit,
          dailyUsagePercent: globalBudget.globalDailyLimit > 0
            ? Math.round((totalUsage.totalTokens / globalBudget.globalDailyLimit) * 100)
            : 0,
        },
        agents: agentStats,
      };
    } catch (error) {
      logger.error('获取 Token 统计失败:', error);
      return null;
    }
  });

  // 获取预算预警列表
  ipcMain.handle('budget:get-alerts', async () => {
    logger.debug('IPC: budget:get-alerts');
    try {
      return alertSystem.getAlerts();
    } catch (error) {
      logger.error('获取预算预警失败:', error);
      return [];
    }
  });

  // 确认预警
  ipcMain.handle('budget:acknowledge-alert', async (_event, alertId) => {
    logger.debug('IPC: budget:acknowledge-alert', { alertId });
    try {
      const success = alertSystem.acknowledge(alertId);
      return { success };
    } catch (error) {
      logger.error('确认预警失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 授予临时预算放行
  ipcMain.handle('budget:grant-override', async (_event, agentId, hours = 24) => {
    logger.info('IPC: budget:grant-override', { agentId, hours });
    try {
      const result = budgetManager.grantTemporaryOverride(agentId, hours);
      return result;
    } catch (error) {
      logger.error('授予预算放行失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取所有临时放行
  ipcMain.handle('budget:get-overrides', async () => {
    logger.debug('IPC: budget:get-overrides');
    try {
      return budgetManager.getActiveOverrides();
    } catch (error) {
      logger.error('获取预算放行列表失败:', error);
      return [];
    }
  });

  // 撤销临时放行
  ipcMain.handle('budget:revoke-override', async (_event, agentId) => {
    logger.info('IPC: budget:revoke-override', { agentId });
    try {
      const result = budgetManager.revokeOverride(agentId);
      return result;
    } catch (error) {
      logger.error('撤销预算放行失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取被阻止的 Agent 列表
  ipcMain.handle('budget:get-blocked-agents', async () => {
    logger.debug('IPC: budget:get-blocked-agents');
    try {
      return budgetManager.getBlockedAgents();
    } catch (error) {
      logger.error('获取被阻止的 Agent 列表失败:', error);
      return [];
    }
  });

  // ─── 工资系统相关 IPC ───────────────────────────────────────

  // 获取职级工资配置
  ipcMain.handle('salary:get-config', async () => {
    logger.debug('IPC: salary:get-config');
    try {
      const levelDefaults = budgetManager.getLevelSalaryDefaults();
      const allBudgets = budgetManager.getAllAgentBudgets();
      
      // 获取所有员工的薪资摘要
      const employeeSalaries = allBudgets.map((b) => {
        const salaryInfo = budgetManager.getAgentSalaryInfo(b.agentId);
        return {
          agentId: b.agentId,
          dailySalary: salaryInfo?.dailySalary || 0,
          balance: salaryInfo?.balance || 0,
          lastPayday: salaryInfo?.lastPayday || null,
          isOverdrawn: salaryInfo?.isOverdrawn || false,
        };
      });

      return {
        levelDefaults,
        employeeSalaries,
        totalDailySalaryBudget: employeeSalaries.reduce((sum, e) => sum + e.dailySalary, 0),
        overdrawnCount: employeeSalaries.filter((e) => e.isOverdrawn).length,
      };
    } catch (error) {
      logger.error('获取工资配置失败:', error);
      return null;
    }
  });

  // 设置职级默认日薪
  ipcMain.handle('salary:set-level-salary', async (_event, level, amount) => {
    logger.info('IPC: salary:set-level-salary', { level, amount });
    try {
      const result = budgetManager.setDefaultSalary(level, amount);
      return result;
    } catch (error) {
      logger.error('设置职级日薪失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 设置员工个人日薪
  ipcMain.handle('salary:set-agent-salary', async (_event, agentId, amount) => {
    logger.info('IPC: salary:set-agent-salary', { agentId, amount });
    try {
      const result = budgetManager.setAgentSalary(agentId, amount);
      return result;
    } catch (error) {
      logger.error('设置员工日薪失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 发放奖金
  ipcMain.handle('salary:pay-bonus', async (_event, agentId, amount, reason = '') => {
    logger.info('IPC: salary:pay-bonus', { agentId, amount, reason });
    try {
      const result = budgetManager.addBonus(agentId, amount, reason);
      return result;
    } catch (error) {
      logger.error('发放奖金失败:', error);
      return { success: false, error: error.message };
    }
  });

  // 获取员工余额信息
  ipcMain.handle('salary:get-agent-balance', async (_event, agentId) => {
    logger.debug('IPC: salary:get-agent-balance', { agentId });
    try {
      const salaryInfo = budgetManager.getAgentSalaryInfo(agentId);
      return salaryInfo;
    } catch (error) {
      logger.error('获取员工余额失败:', error);
      return null;
    }
  });

  logger.info('预算系统 IPC 处理器已设置');
}

module.exports = { setupBudgetIpcHandlers };
