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
  description: '获取 Token 使用统计。可查看全局统计、特定 Agent 统计或时间范围统计。',
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

    // 合并统计和预算信息
    const agentStats = agentSummaries.map((summary) => {
      const budget = agentBudgets.find((b) => b.agentId === summary.agentId);
      return {
        ...summary,
        budget: budget || null,
        budgetUsagePercent: budget?.dailyLimit
          ? Math.round((summary.totalTokens / budget.dailyLimit) * 100)
          : null,
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
 * 注册 CFO 工具
 * 注意：Agent 审批相关工具已移交给 CHRO（HR 工具）
 */
function registerCFOTools() {
  toolRegistry.register(tokenStatsTool);
  toolRegistry.register(tokenSetBudgetTool);
}

module.exports = {
  tokenStatsTool,
  tokenSetBudgetTool,
  registerCFOTools,
};
