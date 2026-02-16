/**
 * SoloForge - CFO 专属工具
 * 提供 token 统计和预算管理功能
 * @module tools/cfo-tools
 */

const { toolRegistry } = require('./tool-registry');
const { tokenTracker } = require('../budget/token-tracker');
const { budgetManager } = require('../budget/budget-manager');

/**
 * Token 统计工具
 */
const tokenStatsTool = {
  name: 'token_stats',
  description:
    '获取 Token 使用统计。可查看全局统计、特定 Agent 统计或时间范围统计。' +
    '【重要】如果需要查询特定员工的 Token 使用，必须先通过 list_colleagues 获取该员工的完整 agent_id（格式如 agent-1771250247826-q4ovxt），不要猜测或编造 ID！',
  category: 'cfo',
  parameters: {
    agent_id: {
      type: 'string',
      description:
        '要查询的 Agent ID（如 agent-1771250247826-q4ovxt），不指定则返回所有。【必须使用 list_colleagues 返回的真实 ID，不能猜测】',
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
    
    // 【重要】如果指定了 agent_id，先验证是否存在
    if (agent_id) {
      const { agentConfigStore } = require('../config/agent-config-store');
      const config = agentConfigStore.get(agent_id);
      
      if (!config) {
        // 尝试通过名字查找正确的 ID
        const allAgents = agentConfigStore.getAll();
        const matchByName = allAgents.find(
          (a) => a.name === agent_id || a.name.includes(agent_id) || agent_id.includes(a.name)
        );
        
        if (matchByName) {
          return {
            success: false,
            error: `找不到 Agent ID「${agent_id}」`,
            hint: `您是否在找「${matchByName.name}」？正确的 agent_id 是「${matchByName.id}」。请使用 list_colleagues 获取完整的员工列表和正确的 ID。`,
            suggestion: {
              name: matchByName.name,
              correctId: matchByName.id,
            },
          };
        }
        
        return {
          success: false,
          error: `找不到 Agent ID「${agent_id}」`,
          hint: '请使用 list_colleagues 工具获取完整的员工列表和正确的 agent_id（格式如 agent-1771250247826-q4ovxt）',
        };
      }
    }

    // 计算时间范围
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
      case 'all':
      default:
        sinceTimestamp = undefined;
    }

    // 获取统计
    const agentSummaries = tokenTracker.getSummary(agent_id, sinceTimestamp);
    const totalUsage = tokenTracker.getTotalUsage(sinceTimestamp);

    // 获取预算信息
    const globalBudget = budgetManager.getGlobalBudget();
    const agentBudgets = budgetManager.getAllAgentBudgets();

    // 合并统计和预算（工资）信息
    const agentStats = agentSummaries.map((summary) => {
      const budget = agentBudgets.find((b) => b.agentId === summary.agentId);
      const salaryInfo = budgetManager.getAgentSalaryInfo(summary.agentId);
      return {
        ...summary,
        budget: budget || null,
        // 工资系统信息
        salary: salaryInfo ? {
          balance: salaryInfo.balance,
          dailySalary: salaryInfo.dailySalary,
          lastPayday: salaryInfo.lastPayday,
          isOverdrawn: salaryInfo.isOverdrawn,
        } : null,
        // 兼容旧的百分比计算
        budgetUsagePercent: salaryInfo?.dailySalary
          ? Math.round(((salaryInfo.dailySalary - salaryInfo.balance) / salaryInfo.dailySalary) * 100)
          : (budget?.dailyLimit ? Math.round((summary.totalTokens / budget.dailyLimit) * 100) : null),
      };
    });

    // 格式化时间为本地时间
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
        dailyUsagePercent: Math.round(
          (totalUsage.totalTokens / globalBudget.globalDailyLimit) * 100
        ),
      },
      agents: agentStats,
    };
  },
};

/**
 * 设置 Token 预算工具
 */
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
      // 设置 Agent 预算
      const updates = {};
      if (daily_limit !== undefined) updates.dailyLimit = daily_limit;
      if (total_limit !== undefined) updates.totalLimit = total_limit;
      if (enabled !== undefined) updates.enabled = enabled;

      budgetManager.setAgentBudget(agent_id, updates);

      return {
        success: true,
        type: 'agent',
        agentId: agent_id,
        budget: budgetManager.getAgentBudget(agent_id),
      };
    } else {
      // 设置全局预算
      const updates = {};
      if (daily_limit !== undefined) updates.globalDailyLimit = daily_limit;
      if (total_limit !== undefined) updates.globalTotalLimit = total_limit;

      budgetManager.setGlobalBudget(updates);

      return {
        success: true,
        type: 'global',
        budget: budgetManager.getGlobalBudget(),
      };
    }
  },
};

/**
 * 调整员工日薪工具
 */
const adjustSalaryTool = {
  name: 'adjust_salary',
  description:
    '调整某个员工的日薪。' +
    '【重要】必须先通过 list_colleagues 获取该员工的完整 agent_id！',
  category: 'cfo',
  parameters: {
    agent_id: {
      type: 'string',
      description: '要调整日薪的 Agent ID（格式如 agent-1771250247826-q4ovxt）',
      required: true,
    },
    daily_salary: {
      type: 'number',
      description: '新的日薪金额（单位：tokens）',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, daily_salary } = args;

    // 验证 agent_id 存在
    const { agentConfigStore } = require('../config/agent-config-store');
    const config = agentConfigStore.get(agent_id);
    if (!config) {
      return {
        success: false,
        error: `找不到 Agent ID「${agent_id}」`,
        hint: '请使用 list_colleagues 工具获取完整的员工列表和正确的 agent_id',
      };
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

/**
 * 设置职级默认日薪工具
 */
const setLevelSalaryTool = {
  name: 'set_level_salary',
  description:
    '设置某个职级的默认日薪。此设置只影响新入职的员工，不会自动修改现有员工的日薪。',
  category: 'cfo',
  parameters: {
    level: {
      type: 'string',
      description: '职级 ID（c_level, vp, director, manager, senior, staff, intern, assistant）',
      required: true,
      enum: ['c_level', 'vp', 'director', 'manager', 'senior', 'staff', 'intern', 'assistant'],
    },
    daily_salary: {
      type: 'number',
      description: '新的默认日薪金额（单位：tokens）',
      required: true,
    },
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
        message: `已将职级「${level}」的默认日薪从 ${(result.oldValue || 0).toLocaleString()} 调整为 ${result.newValue.toLocaleString()} tokens`,
        note: '此设置只影响新入职员工，不会修改现有员工的日薪',
      };
    }
    return result;
  },
};

/**
 * 发放奖金工具
 */
const payBonusTool = {
  name: 'pay_bonus',
  description:
    '给员工发放奖金，直接加到其账户余额中。' +
    '【重要】必须先通过 list_colleagues 获取该员工的完整 agent_id！',
  category: 'cfo',
  parameters: {
    agent_id: {
      type: 'string',
      description: '要发放奖金的 Agent ID（格式如 agent-1771250247826-q4ovxt）',
      required: true,
    },
    amount: {
      type: 'number',
      description: '奖金金额（单位：tokens，必须为正数）',
      required: true,
    },
    reason: {
      type: 'string',
      description: '发放原因',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, amount, reason = '' } = args;

    // 验证 agent_id 存在
    const { agentConfigStore } = require('../config/agent-config-store');
    const config = agentConfigStore.get(agent_id);
    if (!config) {
      return {
        success: false,
        error: `找不到 Agent ID「${agent_id}」`,
        hint: '请使用 list_colleagues 工具获取完整的员工列表和正确的 agent_id',
      };
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
        message: `已向 ${config.name} 发放 ${amount.toLocaleString()} tokens 奖金，余额: ${result.oldBalance.toLocaleString()} -> ${result.newBalance.toLocaleString()}`,
      };
    }
    return result;
  },
};

/**
 * 查看工资配置工具
 */
const viewSalaryConfigTool = {
  name: 'view_salary_config',
  description: '查看当前的职级工资配置和所有员工的薪资状况',
  category: 'cfo',
  parameters: {},
  requiredPermissions: [],

  async execute() {
    const { agentConfigStore } = require('../config/agent-config-store');

    // 获取职级默认工资配置
    const levelDefaults = budgetManager.getLevelSalaryDefaults();

    // 获取所有员工的薪资信息
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

    // 统计透支员工
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

/**
 * 注册 CFO 工具
 * 注意：Agent 审批相关工具已移交给 CHRO（HR 工具）
 */
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
