/**
 * SoloForge - HR 绩效与晋升降级相关工具
 *
 * 包含：绩效分析、团队分析、正式晋升、正式降级。
 * @module tools/hr-performance-tools
 */

const {
  agentConfigStore,
  LEVELS,
  DEPARTMENTS,
  CORE_AGENT_IDS,
  tokenTracker,
  budgetManager,
  logger,
} = require('./hr-shared');

// ═══════════════════════════════════════════════════════════════
// 绩效分析工具
// ═══════════════════════════════════════════════════════════════

/**
 * 绩效分析工具
 */
const hrPerformanceReviewTool = {
  name: 'hr_performance_review',
  description: `查看 Agent 的绩效数据，包括 Token 使用量、调用次数、活跃度等。

可查看单个 Agent 或全部 Agent 的绩效数据，支持按时间段筛选。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: '指定 Agent ID。不填则查看全部 Agent。',
      required: false,
    },
    period: {
      type: 'string',
      description: '统计时间段：7d（7天）, 30d（30天）, 90d（90天）, all（全部）。默认 30d。',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, period } = args;

    // 计算时间范围
    const now = Date.now();
    const periodMap = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      'all': 0,
    };
    const periodMs = periodMap[period] || periodMap['30d'];
    const sinceTimestamp = periodMs > 0 ? now - periodMs : undefined;
    const periodLabel = period || '30d';

    // 获取 Token 使用统计
    const tokenSummaries = tokenTracker.getSummary(agent_id || undefined, sinceTimestamp);

    // 获取 Agent 配置信息
    const agentConfigs = agent_id
      ? [agentConfigStore.get(agent_id)].filter(Boolean)
      : agentConfigStore.getActive();

    // 获取预算信息
    let budgetInfo = {};
    try {
      if (agent_id) {
        budgetInfo[agent_id] = budgetManager.getAgentBudget(agent_id);
      } else {
        for (const config of agentConfigs) {
          budgetInfo[config.id] = budgetManager.getAgentBudget(config.id);
        }
      }
    } catch {
      // budgetManager 可能没有某些 Agent 的预算数据
    }

    // 构建绩效报告
    const reviews = agentConfigs.map((config) => {
      const tokenData = tokenSummaries.find((s) => s.agentId === config.id) || {
        totalTokens: 0,
        callCount: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        lastUsed: '无记录',
      };
      const budget = budgetInfo[config.id];

      return {
        agentId: config.id,
        name: config.name,
        title: config.title,
        department: config.department,
        status: config.status || 'active',
        metrics: {
          totalTokens: tokenData.totalTokens,
          promptTokens: tokenData.totalPromptTokens,
          completionTokens: tokenData.totalCompletionTokens,
          callCount: tokenData.callCount,
          avgTokensPerCall: tokenData.callCount > 0
            ? Math.round(tokenData.totalTokens / tokenData.callCount)
            : 0,
          lastUsed: tokenData.lastUsed,
        },
        budget: budget ? {
          dailyLimit: budget.dailyLimit,
          totalLimit: budget.totalLimit,
          todayUsed: budget.todayUsed || 0,
          totalUsed: budget.totalUsed || 0,
          utilization: budget.totalLimit > 0
            ? `${Math.round(((budget.totalUsed || 0) / budget.totalLimit) * 100)}%`
            : 'N/A',
        } : null,
        hireDate: config.hireDate || null,
        probationEnd: config.probationEnd || null,
      };
    });

    // 排名
    const byTokens = [...reviews].sort((a, b) => b.metrics.totalTokens - a.metrics.totalTokens);
    const byActivity = [...reviews].sort((a, b) => b.metrics.callCount - a.metrics.callCount);

    return {
      success: true,
      period: periodLabel,
      totalAgents: reviews.length,
      reviews,
      rankings: {
        byTokenUsage: byTokens.slice(0, 10).map((r, i) => ({
          rank: i + 1,
          name: r.name,
          agentId: r.agentId,
          totalTokens: r.metrics.totalTokens,
        })),
        byActivity: byActivity.slice(0, 10).map((r, i) => ({
          rank: i + 1,
          name: r.name,
          agentId: r.agentId,
          callCount: r.metrics.callCount,
        })),
      },
    };
  },
};

/**
 * 团队分析工具
 */
const hrTeamAnalyticsTool = {
  name: 'hr_team_analytics',
  description: `获取团队分析数据，包括人员统计、Token 花费分布、活跃度等。

可生成完整的 HR 仪表板数据。`,
  category: 'hr',
  parameters: {
    metric: {
      type: 'string',
      description: '分析维度：headcount（人员统计）, token_spend（Token花费）, activity（活跃度）, budget_utilization（预算使用率）, all（全部）。默认 all。',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const metric = args.metric || 'all';
    const allAgents = agentConfigStore.getAll();
    const activeAgents = allAgents.filter((a) => (a.status || 'active') === 'active');
    const result = { success: true, metric };

    // 人员统计
    if (metric === 'headcount' || metric === 'all') {
      const byDepartment = {};
      const byLevel = {};

      for (const agent of activeAgents) {
        const deptId = agent.department || 'other';
        const dept = DEPARTMENTS[deptId.toUpperCase()] || { name: deptId };
        byDepartment[deptId] = byDepartment[deptId] || { name: dept.name, count: 0 };
        byDepartment[deptId].count++;

        const levelId = agent.level || 'other';
        const level = LEVELS[levelId.toUpperCase()] || { name: levelId };
        byLevel[levelId] = byLevel[levelId] || { name: level.name, count: 0 };
        byLevel[levelId].count++;
      }

      // 试用期人员
      const onProbation = activeAgents.filter((a) => a.probationEnd && new Date(a.probationEnd) > new Date());

      result.headcount = {
        total: allAgents.length,
        active: activeAgents.length,
        suspended: allAgents.filter((a) => a.status === 'suspended').length,
        terminated: allAgents.filter((a) => a.status === 'terminated').length,
        coreMembers: CORE_AGENT_IDS.length,
        dynamicMembers: activeAgents.length - activeAgents.filter((a) => CORE_AGENT_IDS.includes(a.id)).length,
        onProbation: onProbation.length,
        byDepartment: Object.values(byDepartment).sort((a, b) => b.count - a.count),
        byLevel: Object.values(byLevel).sort((a, b) => b.count - a.count),
      };
    }

    // Token 花费分布
    if (metric === 'token_spend' || metric === 'all') {
      const last30Days = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const summaries = tokenTracker.getSummary(undefined, last30Days);

      const byAgent = summaries.map((s) => {
        const config = agentConfigStore.get(s.agentId);
        return {
          agentId: s.agentId,
          name: config?.name || s.agentId,
          department: config?.department || 'unknown',
          totalTokens: s.totalTokens,
          callCount: s.callCount,
        };
      }).sort((a, b) => b.totalTokens - a.totalTokens);

      // 按部门汇总
      const byDept = {};
      for (const item of byAgent) {
        const dept = item.department;
        byDept[dept] = byDept[dept] || { department: dept, totalTokens: 0, callCount: 0 };
        byDept[dept].totalTokens += item.totalTokens;
        byDept[dept].callCount += item.callCount;
      }

      const totalUsage = tokenTracker.getTotalUsage(last30Days);

      result.tokenSpend = {
        period: '近30天',
        total: totalUsage,
        byAgent: byAgent.slice(0, 20),
        byDepartment: Object.values(byDept).sort((a, b) => b.totalTokens - a.totalTokens),
      };
    }

    // 活跃度
    if (metric === 'activity' || metric === 'all') {
      const last7Days = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentSummaries = tokenTracker.getSummary(undefined, last7Days);

      const activeIds = new Set(recentSummaries.map((s) => s.agentId));
      const inactiveAgents = activeAgents
        .filter((a) => !activeIds.has(a.id))
        .map((a) => ({ id: a.id, name: a.name, title: a.title }));

      result.activity = {
        period: '近7天',
        activeCount: activeIds.size,
        inactiveCount: inactiveAgents.length,
        inactiveAgents,
        mostActive: recentSummaries
          .sort((a, b) => b.callCount - a.callCount)
          .slice(0, 5)
          .map((s) => {
            const config = agentConfigStore.get(s.agentId);
            return { agentId: s.agentId, name: config?.name || s.agentId, callCount: s.callCount };
          }),
      };
    }

    // 预算使用率
    if (metric === 'budget_utilization' || metric === 'all') {
      const budgetData = [];
      for (const agent of activeAgents) {
        try {
          const budget = budgetManager.getAgentBudget(agent.id);
          if (budget && budget.totalLimit > 0) {
            budgetData.push({
              agentId: agent.id,
              name: agent.name,
              totalLimit: budget.totalLimit,
              totalUsed: budget.totalUsed || 0,
              utilization: Math.round(((budget.totalUsed || 0) / budget.totalLimit) * 100),
            });
          }
        } catch {
          // 忽略没有预算的 Agent
        }
      }

      budgetData.sort((a, b) => b.utilization - a.utilization);

      result.budgetUtilization = {
        agentsWithBudget: budgetData.length,
        overBudget: budgetData.filter((b) => b.utilization > 100),
        highUsage: budgetData.filter((b) => b.utilization >= 80 && b.utilization <= 100),
        normalUsage: budgetData.filter((b) => b.utilization < 80),
        details: budgetData,
      };
    }

    return result;
  },
};

// ═══════════════════════════════════════════════════════════════
// 晋升/降级工具
// ═══════════════════════════════════════════════════════════════

/**
 * 正式晋升 Agent
 */
const hrPromoteAgentTool = {
  name: 'hr_promote_agent',
  description: `正式晋升一个 Agent 的职级。

与 hr_update_agent 不同，晋升会：
1. 记录晋升历史（可追溯）
2. 自动通知当事人和相关 Agent
3. 向老板汇报

可用职级（从低到高）：intern, assistant, staff, senior, manager, director, vp, c_level`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID',
      required: true,
    },
    new_level: {
      type: 'string',
      description: '新职级 ID（必须高于当前职级）',
      required: true,
    },
    new_title: {
      type: 'string',
      description: '新的职位头衔（可选，不填则保持原头衔）',
      required: false,
    },
    reason: {
      type: 'string',
      description: '晋升原因（表现优异的具体体现）',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, new_level, new_title, reason } = args;

    if (!agent_id) return { success: false, error: '必须指定 agent_id' };
    if (!new_level) return { success: false, error: '必须指定 new_level' };
    if (!reason) return { success: false, error: '必须提供晋升原因' };

    const config = agentConfigStore.get(agent_id);
    if (!config) return { success: false, error: `找不到 Agent: ${agent_id}` };

    // 验证新职级
    const newLevelObj = Object.values(LEVELS).find((l) => l.id === new_level.toLowerCase());
    if (!newLevelObj) {
      return {
        success: false,
        error: `无效的职级: ${new_level}`,
        validLevels: Object.values(LEVELS).map((l) => ({ id: l.id, name: l.name })),
      };
    }

    const currentLevelObj = LEVELS[config.level?.toUpperCase()] || { rank: 0 };
    if (newLevelObj.rank <= currentLevelObj.rank) {
      return {
        success: false,
        error: `新职级（${newLevelObj.name}）不高于当前职级（${currentLevelObj.name}）。如需降级请使用 hr_demote_agent`,
      };
    }

    // 记录并执行晋升
    const result = agentConfigStore.addPromotionRecord(agent_id, {
      fromLevel: config.level,
      toLevel: new_level.toLowerCase(),
      fromTitle: config.title,
      toTitle: new_title || config.title,
      reason,
    });

    if (!result.success) return result;

    logger.info('Agent 晋升', { agent_id, from: currentLevelObj.name, to: newLevelObj.name, reason });

    return {
      success: true,
      message: `已将「${config.name}」从 ${currentLevelObj.name} 晋升为 ${newLevelObj.name}`,
      agent: {
        id: agent_id,
        name: config.name,
        previousLevel: currentLevelObj.name,
        newLevel: newLevelObj.name,
        previousTitle: config.title,
        newTitle: new_title || config.title,
      },
      note: '建议使用 notify_boss 向老板汇报此晋升决定。',
    };
  },
};

/**
 * 正式降级 Agent
 */
const hrDemoteAgentTool = {
  name: 'hr_demote_agent',
  description: `正式降级一个 Agent 的职级。

降级会记录到晋升历史中，并通知相关人员。需要提供充分的降级原因。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID',
      required: true,
    },
    new_level: {
      type: 'string',
      description: '新职级 ID（必须低于当前职级）',
      required: true,
    },
    new_title: {
      type: 'string',
      description: '新的职位头衔（可选）',
      required: false,
    },
    reason: {
      type: 'string',
      description: '降级原因（必须详细说明）',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, new_level, new_title, reason } = args;

    if (!agent_id) return { success: false, error: '必须指定 agent_id' };
    if (!new_level) return { success: false, error: '必须指定 new_level' };
    if (!reason) return { success: false, error: '必须提供降级原因' };

    const config = agentConfigStore.get(agent_id);
    if (!config) return { success: false, error: `找不到 Agent: ${agent_id}` };

    const newLevelObj = Object.values(LEVELS).find((l) => l.id === new_level.toLowerCase());
    if (!newLevelObj) {
      return {
        success: false,
        error: `无效的职级: ${new_level}`,
        validLevels: Object.values(LEVELS).map((l) => ({ id: l.id, name: l.name })),
      };
    }

    const currentLevelObj = LEVELS[config.level?.toUpperCase()] || { rank: 0 };
    if (newLevelObj.rank >= currentLevelObj.rank) {
      return {
        success: false,
        error: `新职级（${newLevelObj.name}）不低于当前职级（${currentLevelObj.name}）。如需晋升请使用 hr_promote_agent`,
      };
    }

    const result = agentConfigStore.addPromotionRecord(agent_id, {
      fromLevel: config.level,
      toLevel: new_level.toLowerCase(),
      fromTitle: config.title,
      toTitle: new_title || config.title,
      reason: `【降级】${reason}`,
    });

    if (!result.success) return result;

    logger.info('Agent 降级', { agent_id, from: currentLevelObj.name, to: newLevelObj.name, reason });

    return {
      success: true,
      message: `已将「${config.name}」从 ${currentLevelObj.name} 降级为 ${newLevelObj.name}`,
      agent: {
        id: agent_id,
        name: config.name,
        previousLevel: currentLevelObj.name,
        newLevel: newLevelObj.name,
        previousTitle: config.title,
        newTitle: new_title || config.title,
      },
      note: '建议使用 notify_boss 向老板汇报此决定。',
    };
  },
};

module.exports = {
  hrPerformanceReviewTool,
  hrTeamAnalyticsTool,
  hrPromoteAgentTool,
  hrDemoteAgentTool,
};
