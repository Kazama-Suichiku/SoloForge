/**
 * SoloForge - HR 预算、批量操作与历史查询工具
 *
 * 包含：查看 Token 预算（只读）、批量更新 Agent、查询人事变动历史。
 * @module tools/hr-budget-tools
 */

const {
  agentConfigStore,
  LEVELS,
  departmentStore,
  CORE_AGENT_IDS,
  tokenTracker,
  budgetManager,
  logger,
} = require('./hr-shared');

// ═══════════════════════════════════════════════════════════════
// 预算管理工具
// ═══════════════════════════════════════════════════════════════

/**
 * 查看 Agent Token 预算（只读）
 * 
 * 职责划分：
 * - CFO：预算决策者，负责设置和调整预算额度（使用 token_set_budget）
 * - CHRO：预算查看者，辅助人事决策时参考预算使用情况
 */
const hrViewBudgetTool = {
  name: 'hr_view_budget',
  description: `查看 Agent 的 Token 预算使用情况。

这是一个只读工具，用于在人事决策时参考预算数据。
如需调整预算，请联系 CFO 使用 token_set_budget 工具。

【重要】如果需要查询特定员工的 Token 使用，必须先通过 list_colleagues 获取该员工的完整 agent_id（格式如 agent-1771250247826-q4ovxt），不要猜测或编造 ID！

使用场景：
- 招聘审批时评估 Token 成本
- 绩效分析时参考预算使用率
- 组织调整时了解各部门预算消耗`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description:
        'Agent ID（如 agent-1771250247826-q4ovxt），不填则显示全部。【必须使用 list_colleagues 返回的真实 ID，不能猜测】',
      required: false,
    },
    sort_by: {
      type: 'string',
      description: '排序方式：utilization（使用率）, usage（使用量）, name（名称）。默认 utilization',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, sort_by } = args;
    const sortField = sort_by || 'utilization';

    // 计算今日起始时间戳
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    // 辅助函数：从 tokenTracker 获取实际使用量
    const getActualUsage = (agentId) => {
      // 获取该 Agent 的总使用量
      const totalSummaries = tokenTracker.getSummary(agentId);
      const totalUsed = totalSummaries.length > 0 ? totalSummaries[0].totalTokens : 0;
      
      // 获取今日使用量
      const todaySummaries = tokenTracker.getSummary(agentId, todayTimestamp);
      const todayUsed = todaySummaries.length > 0 ? todaySummaries[0].totalTokens : 0;
      
      return { totalUsed, todayUsed };
    };

    if (agent_id) {
      // 查看单个 Agent
      const config = agentConfigStore.get(agent_id);
      
      // 【重要】验证 agent_id 是否存在
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
      
      const budget = budgetManager.getAgentBudget(agent_id);
      const salaryInfo = budgetManager.getAgentSalaryInfo(agent_id);
      
      // 从 tokenTracker 获取实际使用量
      const { totalUsed, todayUsed } = getActualUsage(agent_id);
      
      // 工资系统信息
      const dailySalary = salaryInfo?.dailySalary || budget?.dailyLimit || 100000;
      const balance = salaryInfo?.balance ?? 0;
      const isOverdrawn = salaryInfo?.isOverdrawn || false;
      const lastPayday = salaryInfo?.lastPayday || null;
      
      // 计算使用率（基于日薪）
      const salaryUsed = dailySalary - balance;
      const salaryUtil = dailySalary > 0 ? Math.round((salaryUsed / dailySalary) * 100) : 0;
      
      return {
        success: true,
        agent: { 
          id: agent_id, 
          name: config?.name || agent_id,
          department: config?.department,
          title: config?.title,
          level: config?.level,
        },
        salary: {
          dailySalary,
          balance,
          lastPayday,
          isOverdrawn,
          status: isOverdrawn ? '透支' : (balance < dailySalary * 0.3 ? '余额较低' : '正常'),
        },
        usage: {
          todayUsed,
          totalUsed,
          salaryUtilization: `${salaryUtil}%`,
        },
        hint: '如需调整薪资，请联系 CFO 使用 adjust_salary 工具',
      };
    } else {
      // 显示全部员工的薪资情况
      const activeAgents = agentConfigStore.getActive();
      const employees = activeAgents.map((a) => {
        const salaryInfo = budgetManager.getAgentSalaryInfo(a.id);
        const { totalUsed, todayUsed } = getActualUsage(a.id);
        
        const dailySalary = salaryInfo?.dailySalary || 80000;
        const balance = salaryInfo?.balance ?? 0;
        const isOverdrawn = salaryInfo?.isOverdrawn || false;
        
        return {
          agentId: a.id,
          name: a.name,
          department: a.department,
          level: a.level,
          dailySalary,
          balance,
          todayUsed,
          isOverdrawn,
          status: isOverdrawn ? '透支' : (balance < dailySalary * 0.3 ? '余额较低' : '正常'),
        };
      });

      // 排序
      switch (sortField) {
        case 'usage':
          employees.sort((a, b) => b.todayUsed - a.todayUsed);
          break;
        case 'name':
          employees.sort((a, b) => a.name.localeCompare(b.name));
          break;
        default:
          // 默认按余额排序（透支的排前面）
          employees.sort((a, b) => a.balance - b.balance);
      }

      const overdrawn = employees.filter((e) => e.isOverdrawn);
      const lowBalance = employees.filter((e) => !e.isOverdrawn && e.balance < e.dailySalary * 0.3);

      return {
        success: true,
        summary: {
          totalEmployees: employees.length,
          overdrawn: overdrawn.length,
          lowBalance: lowBalance.length,
          normal: employees.length - overdrawn.length - lowBalance.length,
          totalDailySalary: employees.reduce((sum, e) => sum + e.dailySalary, 0),
        },
        alerts: overdrawn.length > 0 ? {
          message: `${overdrawn.length} 位员工处于透支状态`,
          employees: overdrawn.map((e) => ({ name: e.name, balance: e.balance })),
        } : null,
        employees: employees.slice(0, 20),
        hint: '如需调整薪资，请联系 CFO 使用 adjust_salary 或 pay_bonus 工具',
      };
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// 批量操作工具
// ═══════════════════════════════════════════════════════════════

/**
 * 批量更新 Agent
 */
const hrBatchUpdateTool = {
  name: 'hr_batch_update',
  description: `批量更新多个 Agent 的信息。

支持的操作：
- update_level: 批量调整职级
- update_department: 批量调整部门
- suspend_all: 批量停职
- reinstate_all: 批量复职

适用于组织架构调整、部门重组等场景。`,
  category: 'hr',
  parameters: {
    agent_ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'Agent ID 列表',
      required: true,
    },
    action: {
      type: 'string',
      description: '批量操作类型：update_level, update_department, suspend_all, reinstate_all',
      required: true,
    },
    value: {
      type: 'string',
      description: '新的值（职级 ID 或部门 ID，根据 action 而定）',
      required: false,
    },
    reason: {
      type: 'string',
      description: '操作原因',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_ids, action, value, reason } = args;

    if (!agent_ids || !Array.isArray(agent_ids) || agent_ids.length === 0) {
      return { success: false, error: '必须提供 agent_ids 数组' };
    }
    if (!action) {
      return { success: false, error: '必须指定 action' };
    }
    if (!reason) {
      return { success: false, error: '必须提供操作原因' };
    }

    const results = { success: [], failed: [] };

    for (const agentId of agent_ids) {
      const config = agentConfigStore.get(agentId);
      if (!config) {
        results.failed.push({ agentId, error: '找不到 Agent' });
        continue;
      }

      try {
        switch (action) {
          case 'update_level': {
            if (!value) {
              results.failed.push({ agentId, error: '未指定 value（新职级）' });
              continue;
            }
            const levelExists = Object.values(LEVELS).some((l) => l.id === value.toLowerCase());
            if (!levelExists) {
              results.failed.push({ agentId, error: `无效的职级: ${value}` });
              continue;
            }
            agentConfigStore.update(agentId, { level: value.toLowerCase() });
            results.success.push({ agentId, name: config.name, change: `职级 → ${value}` });
            break;
          }

          case 'update_department': {
            if (!value) {
              results.failed.push({ agentId, error: '未指定 value（新部门）' });
              continue;
            }
            if (!departmentStore.exists(value)) {
              results.failed.push({ agentId, error: `无效的部门: ${value}` });
              continue;
            }
            agentConfigStore.update(agentId, { department: value.toLowerCase() });
            results.success.push({ agentId, name: config.name, change: `部门 → ${value}` });
            break;
          }

          case 'suspend_all': {
            if (CORE_AGENT_IDS.includes(agentId)) {
              results.failed.push({ agentId, error: '核心成员不可停职' });
              continue;
            }
            if ((config.status || 'active') === 'suspended') {
              results.failed.push({ agentId, error: '已经是停职状态' });
              continue;
            }
            agentConfigStore.suspend(agentId, reason);
            results.success.push({ agentId, name: config.name, change: '已停职' });
            break;
          }

          case 'reinstate_all': {
            if ((config.status || 'active') !== 'suspended') {
              results.failed.push({ agentId, error: '未处于停职状态' });
              continue;
            }
            agentConfigStore.reinstate(agentId, reason);
            results.success.push({ agentId, name: config.name, change: '已复职' });
            break;
          }

          default:
            results.failed.push({ agentId, error: `未知操作: ${action}` });
        }
      } catch (e) {
        results.failed.push({ agentId, error: e.message });
      }
    }

    logger.info('HR 批量操作', { action, totalRequested: agent_ids.length, success: results.success.length, failed: results.failed.length });

    return {
      success: true,
      message: `批量操作完成：${results.success.length} 成功，${results.failed.length} 失败`,
      action,
      reason,
      results,
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// 人事变动历史查询工具
// ═══════════════════════════════════════════════════════════════

/**
 * 查询人事变动历史
 */
const hrPersonnelHistoryTool = {
  name: 'hr_personnel_history',
  description: `查询 Agent 的人事变动历史，包括晋升、降级、调岗、停职等记录。

可查看单个 Agent 的完整履历，或查看最近的全公司人事变动。`,
  category: 'hr',
  parameters: {
    agent_id: {
      type: 'string',
      description: 'Agent ID（不填则显示全公司最近变动）',
      required: false,
    },
    type: {
      type: 'string',
      description: '筛选类型：all（全部）, promotion（晋升降级）, transfer（调岗）, probation（试用期）, suspension（停复职）',
      required: false,
    },
    limit: {
      type: 'number',
      description: '返回记录数量限制（默认 20）',
      required: false,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { agent_id, type, limit } = args;
    const recordLimit = limit || 20;
    const filterType = type || 'all';

    if (agent_id) {
      // 单个 Agent 的历史
      const config = agentConfigStore.get(agent_id);
      if (!config) {
        return { success: false, error: `找不到 Agent: ${agent_id}` };
      }

      const records = [];

      // 收集晋升历史
      if (config.promotionHistory && config.promotionHistory.length > 0) {
        for (const p of config.promotionHistory) {
          const isPromotion = LEVELS[p.toLevel?.toUpperCase()]?.rank > LEVELS[p.fromLevel?.toUpperCase()]?.rank;
          records.push({
            date: p.date,
            type: isPromotion ? 'promotion' : 'demotion',
            description: `${isPromotion ? '晋升' : '降级'}: ${LEVELS[p.fromLevel?.toUpperCase()]?.name || p.fromLevel} → ${LEVELS[p.toLevel?.toUpperCase()]?.name || p.toLevel}`,
            details: p,
          });
        }
      }

      // 收集调岗历史
      if (config.personnelHistory && config.personnelHistory.length > 0) {
        for (const h of config.personnelHistory) {
          records.push({
            date: h.date,
            type: h.type || 'transfer',
            description: `调岗: ${departmentStore.get(h.fromDepartment)?.name || h.fromDepartment} → ${departmentStore.get(h.toDepartment)?.name || h.toDepartment}`,
            details: h,
          });
        }
      }

      // 入职日期
      if (config.hireDate) {
        records.push({
          date: config.hireDate,
          type: 'hire',
          description: '入职',
          details: { title: config.title, department: config.department },
        });
      }

      // 停职记录
      if (config.suspendedAt) {
        records.push({
          date: config.suspendedAt,
          type: 'suspension',
          description: `停职: ${config.suspendReason || '无原因记录'}`,
          details: { reason: config.suspendReason },
        });
      }

      // 开除记录
      if (config.terminatedAt) {
        records.push({
          date: config.terminatedAt,
          type: 'termination',
          description: `离职: ${config.terminationReason || '无原因记录'}`,
          details: { reason: config.terminationReason },
        });
      }

      // 按时间排序
      records.sort((a, b) => new Date(b.date) - new Date(a.date));

      // 按类型过滤
      let filtered = records;
      if (filterType !== 'all') {
        const typeMap = {
          promotion: ['promotion', 'demotion'],
          transfer: ['transfer'],
          probation: ['hire', 'probation_end'],
          suspension: ['suspension', 'reinstatement'],
        };
        const allowedTypes = typeMap[filterType] || [];
        filtered = records.filter((r) => allowedTypes.includes(r.type));
      }

      return {
        success: true,
        agent: {
          id: agent_id,
          name: config.name,
          title: config.title,
          department: config.department,
          status: config.status || 'active',
          hireDate: config.hireDate,
        },
        recordCount: filtered.length,
        records: filtered.slice(0, recordLimit),
      };
    } else {
      // 全公司最近变动
      const allAgents = agentConfigStore.getAll();
      const allRecords = [];

      for (const config of allAgents) {
        // 晋升记录
        if (config.promotionHistory) {
          for (const p of config.promotionHistory) {
            const isPromotion = LEVELS[p.toLevel?.toUpperCase()]?.rank > LEVELS[p.fromLevel?.toUpperCase()]?.rank;
            allRecords.push({
              date: p.date,
              agentId: config.id,
              agentName: config.name,
              type: isPromotion ? 'promotion' : 'demotion',
              description: `${isPromotion ? '晋升' : '降级'}: ${LEVELS[p.toLevel?.toUpperCase()]?.name || p.toLevel}`,
            });
          }
        }

        // 调岗记录
        if (config.personnelHistory) {
          for (const h of config.personnelHistory) {
            allRecords.push({
              date: h.date,
              agentId: config.id,
              agentName: config.name,
              type: h.type || 'transfer',
              description: `调岗至 ${departmentStore.get(h.toDepartment)?.name || h.toDepartment}`,
            });
          }
        }

        // 入职记录
        if (config.hireDate) {
          allRecords.push({
            date: config.hireDate,
            agentId: config.id,
            agentName: config.name,
            type: 'hire',
            description: `入职 - ${config.title}`,
          });
        }
      }

      // 按时间排序
      allRecords.sort((a, b) => new Date(b.date) - new Date(a.date));

      // 按类型过滤
      let filtered = allRecords;
      if (filterType !== 'all') {
        const typeMap = {
          promotion: ['promotion', 'demotion'],
          transfer: ['transfer'],
          probation: ['hire', 'probation_end'],
          suspension: ['suspension', 'reinstatement'],
        };
        const allowedTypes = typeMap[filterType] || [];
        filtered = allRecords.filter((r) => allowedTypes.includes(r.type));
      }

      return {
        success: true,
        totalRecords: filtered.length,
        records: filtered.slice(0, recordLimit),
        hint: '使用 agent_id 参数查看特定员工的完整履历',
      };
    }
  },
};

module.exports = {
  hrViewBudgetTool,
  hrBatchUpdateTool,
  hrPersonnelHistoryTool,
};
