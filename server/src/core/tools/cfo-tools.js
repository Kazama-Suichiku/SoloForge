/**
 * SoloForge Mobile - CFO 专属工具
 * Token 统计和预算管理
 * @module core/tools/cfo-tools
 */

const { toolRegistry } = require('./tool-registry');
const { tokenTracker } = require('../budget/token-tracker');
const { budgetManager } = require('../budget/budget-manager');

const tokenStatsTool = {
  name: 'token_stats',
  description:
    '获取 Token 使用统计。可查看全局统计、特定 Agent 统计或时间范围统计。' +
    '【重要】如需查询特定员工的 Token 使用，请先用 list_colleagues 获取正确的 agent_id。',
  category: 'cfo',
  parameters: {
    agent_id: {
      type: 'string',
      description: '要查询的 Agent ID，不指定则返回所有',
      required: false,
    },
    period: {
      type: 'string',
      description: '统计周期：today, week, month, all（默认 today）',
      required: false,
      default: 'today',
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, period = 'today' } = args;

    if (agent_id) {
      const { agentConfigStore } = require('../config/agent-config-store');
      const config = agentConfigStore.get(agent_id);
      if (!config) {
        const allAgents = agentConfigStore.getAll();
        const matchByName = allAgents.find(
          (a) => a.name === agent_id || a.name.includes(agent_id) || agent_id.includes(a.name)
        );
        if (matchByName) {
          return {
            success: false,
            error: `找不到 Agent ID「${agent_id}」`,
            hint: `正确的 agent_id 是「${matchByName.id}」。请用 list_colleagues 获取。`,
            suggestion: { name: matchByName.name, correctId: matchByName.id },
          };
        }
        return {
          success: false,
          error: `找不到 Agent ID「${agent_id}」`,
          hint: '请用 list_colleagues 获取正确的 agent_id',
        };
      }
    }

    let sinceTimestamp;
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    switch (period) {
      case 'today': {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        sinceTimestamp = today.getTime();
        break;
      }
      case 'week':
        sinceTimestamp = now - 7 * oneDay;
        break;
      case 'month':
        sinceTimestamp = now - 30 * oneDay;
        break;
      default:
        sinceTimestamp = undefined;
    }

    const agentSummaries = tokenTracker.getSummary(agent_id, sinceTimestamp);
    const totalUsage = tokenTracker.getTotalUsage(sinceTimestamp);
    const globalBudget = budgetManager.getGlobalBudget();
    const agentBudgets = budgetManager.getAllAgentBudgets();

    const agentStats = agentSummaries.map((summary) => {
      const budget = agentBudgets.find((b) => b.agentId === summary.agentId);
      const salaryInfo = budgetManager.getAgentSalaryInfo(summary.agentId);
      return {
        ...summary,
        budget: budget || null,
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

    const formatLocalTime = (ts) => {
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
    };

    return {
      period,
      periodStart: formatLocalTime(sinceTimestamp),
      global: {
        ...totalUsage,
        globalDailyLimit: globalBudget.globalDailyLimit,
        globalTotalLimit: globalBudget.globalTotalLimit,
        dailyUsagePercent: globalBudget.globalDailyLimit
          ? Math.round((totalUsage.totalTokens / globalBudget.globalDailyLimit) * 100)
          : 0,
      },
      agents: agentStats,
    };
  },
};

const tokenSetBudgetTool = {
  name: 'token_set_budget',
  description: '设置 Token 使用预算。可设置全局预算或特定 Agent 预算。',
  category: 'cfo',
  parameters: {
    agent_id: {
      type: 'string',
      description: '要设置预算的 Agent ID，不指定则设置全局预算',
      required: false,
    },
    daily_limit: {
      type: 'number',
      description: '每日 Token 限额（0 表示无限制）',
      required: false,
    },
    total_limit: {
      type: 'number',
      description: '总 Token 限额（0 表示无限制）',
      required: false,
    },
    enabled: {
      type: 'boolean',
      description: '是否启用预算限制（仅对 Agent 预算有效）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, daily_limit, total_limit, enabled } = args;

    if (agent_id) {
      const updates = {};
      if (daily_limit !== undefined) updates.dailyLimit = daily_limit;
      if (total_limit !== undefined) updates.totalLimit = total_limit;
      if (enabled !== undefined) updates.enabled = enabled;
      budgetManager.setAgentBudget(agent_id, updates);
      return { success: true, type: 'agent', agentId: agent_id, budget: budgetManager.getAgentBudget(agent_id) };
    }
    const updates = {};
    if (daily_limit !== undefined) updates.globalDailyLimit = daily_limit;
    if (total_limit !== undefined) updates.globalTotalLimit = total_limit;
    budgetManager.setGlobalBudget(updates);
    return { success: true, type: 'global', budget: budgetManager.getGlobalBudget() };
  },
};

const adjustSalaryTool = {
  name: 'adjust_salary',
  description: '调整某个员工的日薪。必须先通过 list_colleagues 获取正确的 agent_id。',
  category: 'cfo',
  parameters: {
    agent_id: { type: 'string', description: '要调整日薪的 Agent ID', required: true },
    daily_salary: { type: 'number', description: '新的日薪金额（单位：tokens）', required: true },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, daily_salary } = args;
    const { agentConfigStore } = require('../config/agent-config-store');
    const config = agentConfigStore.get(agent_id);
    if (!config) {
      return { success: false, error: `找不到 Agent ID「${agent_id}」`, hint: '请用 list_colleagues 获取' };
    }
    const result = budgetManager.setAgentSalary(agent_id, daily_salary);
    if (result.success) {
      return {
        success: true,
        agentId: agent_id,
        agentName: config.name,
        oldSalary: result.oldSalary,
        newSalary: result.newSalary,
        message: `已将 ${config.name} 的日薪从 ${result.oldSalary.toLocaleString()} 调整为 ${result.newSalary.toLocaleString()} tokens`,
      };
    }
    return result;
  },
};

const setLevelSalaryTool = {
  name: 'set_level_salary',
  description: '设置某职级的默认日薪。只影响新入职员工。',
  category: 'cfo',
  parameters: {
    level: {
      type: 'string',
      description: '职级 ID',
      required: true,
      enum: ['c_level', 'vp', 'director', 'manager', 'senior', 'staff', 'intern', 'assistant'],
    },
    daily_salary: { type: 'number', description: '新的默认日薪（单位：tokens）', required: true },
  },
  requiredPermissions: [],

  async execute(args) {
    const { level, daily_salary } = args;
    const result = budgetManager.setDefaultSalary(level, daily_salary);
    if (result.success) {
      return {
        success: true,
        level,
        oldSalary: result.oldValue,
        newSalary: result.newValue,
        message: `已将职级「${level}」的默认日薪调整为 ${result.newValue.toLocaleString()} tokens`,
        note: '此设置只影响新入职员工',
      };
    }
    return result;
  },
};

const payBonusTool = {
  name: 'pay_bonus',
  description: '给员工发放奖金，直接加到账户余额。必须先通过 list_colleagues 获取 agent_id。',
  category: 'cfo',
  parameters: {
    agent_id: { type: 'string', description: '要发放奖金的 Agent ID', required: true },
    amount: { type: 'number', description: '奖金金额（单位：tokens）', required: true },
    reason: { type: 'string', description: '发放原因', required: false },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, amount, reason = '' } = args;
    const { agentConfigStore } = require('../config/agent-config-store');
    const config = agentConfigStore.get(agent_id);
    if (!config) {
      return { success: false, error: `找不到 Agent ID「${agent_id}」`, hint: '请用 list_colleagues 获取' };
    }
    const result = budgetManager.addBonus(agent_id, amount, reason);
    if (result.success) {
      return {
        success: true,
        agentId: agent_id,
        agentName: config.name,
        amount,
        reason: reason || '无',
        oldBalance: result.oldBalance,
        newBalance: result.newBalance,
        message: `已向 ${config.name} 发放 ${amount.toLocaleString()} tokens 奖金`,
      };
    }
    return result;
  },
};

const viewSalaryConfigTool = {
  name: 'view_salary_config',
  description: '查看职级工资配置和所有员工的薪资状况',
  category: 'cfo',
  parameters: {},
  requiredPermissions: [],

  async execute() {
    const { agentConfigStore } = require('../config/agent-config-store');
    const levelDefaults = budgetManager.getLevelSalaryDefaults();
    const allConfigs = agentConfigStore.getAll();
    const employeeSalaries = allConfigs
      .filter((c) => c.status !== 'terminated')
      .map((config) => {
        const salaryInfo = budgetManager.getAgentSalaryInfo(config.id);
        return {
          agentId: config.id,
          name: config.name,
          level: config.level,
          dailySalary: salaryInfo?.dailySalary || 0,
          balance: salaryInfo?.balance || 0,
          lastPayday: salaryInfo?.lastPayday || null,
          isOverdrawn: salaryInfo?.isOverdrawn || false,
        };
      })
      .sort((a, b) => b.dailySalary - a.dailySalary);

    const overdrawnEmployees = employeeSalaries.filter((e) => e.isOverdrawn);

    return {
      success: true,
      levelSalaryDefaults: levelDefaults,
      employeeCount: employeeSalaries.length,
      overdrawnCount: overdrawnEmployees.length,
      employees: employeeSalaries,
      overdrawnEmployees: overdrawnEmployees.map((e) => ({
        name: e.name,
        balance: e.balance,
        dailySalary: e.dailySalary,
      })),
      totalDailySalaryBudget: employeeSalaries.reduce((sum, e) => sum + e.dailySalary, 0),
    };
  },
};

function registerCFOTools() {
  toolRegistry.register(tokenStatsTool);
  toolRegistry.register(tokenSetBudgetTool);
  toolRegistry.register(adjustSalaryTool);
  toolRegistry.register(setLevelSalaryTool);
  toolRegistry.register(payBonusTool);
  toolRegistry.register(viewSalaryConfigTool);
}

module.exports = {
  tokenStatsTool,
  tokenSetBudgetTool,
  adjustSalaryTool,
  setLevelSalaryTool,
  payBonusTool,
  viewSalaryConfigTool,
  registerCFOTools,
};
