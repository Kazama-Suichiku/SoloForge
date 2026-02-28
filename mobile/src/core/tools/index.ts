/**
 * 工具系统 - 与桌面端完全同步的工具集
 * 包含全部 CHRO/CFO/招聘/运营工具，按角色过滤
 */

import { storage } from '../storage';

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
  category?: string;
}

export interface ToolResult {
  success: boolean;
  result?: any;
  error?: string;
}

const CORE_IDS = ['secretary', 'ceo', 'cto', 'cfo', 'chro'];

function safeParseArray(val: any): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed; } catch {}
    return val.split(/[,，、;\n]+/).map((s: string) => s.trim()).filter(Boolean);
  }
  return [];
}

// ═══════════════════════════════════════════
// 通用工具
// ═══════════════════════════════════════════

const COMMON_TOOLS: Tool[] = [
  { type: 'function', category: 'common', function: { name: 'calculator', description: '执行数学计算', parameters: { type: 'object', properties: { expression: { type: 'string', description: '数学表达式' } }, required: ['expression'] } } },
  { type: 'function', category: 'common', function: { name: 'get_current_time', description: '获取当前日期和时间', parameters: { type: 'object', properties: {} } } },
  { type: 'function', category: 'common', function: { name: 'list_colleagues', description: '列出公司所有同事信息（姓名、职位、部门、状态）', parameters: { type: 'object', properties: { department: { type: 'string', description: '按部门筛选' }, status: { type: 'string', enum: ['active', 'suspended', 'terminated', 'all'] } } } } },
  { type: 'function', category: 'common', function: { name: 'memory_store', description: '存储重要信息到记忆中', parameters: { type: 'object', properties: { content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['content'] } } },
  { type: 'function', category: 'common', function: { name: 'memory_recall', description: '回忆相关信息', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', category: 'common', function: { name: 'todo_create', description: '创建待办事项', parameters: { type: 'object', properties: { title: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['title'] } } },
  { type: 'function', category: 'common', function: { name: 'todo_list', description: '列出待办事项', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'done', 'all'] } } } } },
  { type: 'function', category: 'common', function: { name: 'todo_complete', description: '完成待办事项', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', category: 'common', function: { name: 'notify_boss', description: '向老板发送通知或汇报', parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } } },
];

// ═══════════════════════════════════════════
// HR 工具 (CHRO 专属) - 完整 27 个
// ═══════════════════════════════════════════

const HR_TOOLS: Tool[] = [
  // 基础人事管理
  { type: 'function', category: 'hr', function: { name: 'hr_list_agents', description: '查看所有 Agent 的详细人事信息', parameters: { type: 'object', properties: { department: { type: 'string' }, status: { type: 'string', enum: ['active', 'suspended', 'terminated', 'all'] } } } } },
  { type: 'function', category: 'hr', function: { name: 'hr_update_agent', description: '更新 Agent 的基本信息', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, name: { type: 'string' }, title: { type: 'string' }, level: { type: 'string' }, description: { type: 'string' }, department: { type: 'string' }, avatar: { type: 'string' } }, required: ['agent_id'] } } },
  { type: 'function', category: 'hr', function: { name: 'hr_org_chart', description: '获取完整的公司组织架构图', parameters: { type: 'object', properties: { include_terminated: { type: 'boolean' } } } } },

  // 部门管理
  { type: 'function', category: 'hr', function: { name: 'hr_list_departments', description: '查看所有部门信息（名称、颜色、负责人、成员数量）', parameters: { type: 'object', properties: {} } } },
  { type: 'function', category: 'hr', function: { name: 'hr_create_department', description: '创建新部门', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, color: { type: 'string' }, head_agent_id: { type: 'string' } }, required: ['id', 'name'] } } },
  { type: 'function', category: 'hr', function: { name: 'hr_update_department', description: '更新部门信息（名称、颜色、描述、负责人）', parameters: { type: 'object', properties: { department_id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' }, description: { type: 'string' }, head_agent_id: { type: 'string' } }, required: ['department_id'] } } },
  { type: 'function', category: 'hr', function: { name: 'hr_delete_department', description: '删除自定义部门（预设部门不可删除）', parameters: { type: 'object', properties: { department_id: { type: 'string' }, force: { type: 'boolean', description: '强制删除并将成员移至admin部门' } }, required: ['department_id'] } } },

  // 招聘审批
  { type: 'function', category: 'hr', function: { name: 'agent_requests', description: '查看待审批的招聘申请（含详细简历）', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'discussing', 'approved', 'rejected', 'all'] }, request_id: { type: 'string' } } } } },
  { type: 'function', category: 'hr', function: { name: 'hr_question', description: '对招聘申请提出质疑，要求申请人补充或修改', parameters: { type: 'object', properties: { request_id: { type: 'string' }, question: { type: 'string' } }, required: ['request_id', 'question'] } } },
  { type: 'function', category: 'hr', function: { name: 'agent_approve', description: '最终审批招聘申请（批准或拒绝）', parameters: { type: 'object', properties: { request_id: { type: 'string' }, approved: { type: 'boolean' }, comment: { type: 'string' } }, required: ['request_id', 'approved'] } } },

  // 开除管理
  { type: 'function', category: 'hr', function: { name: 'hr_dismiss_request', description: '提出开除 Agent 的申请（需老板确认），核心成员不可开除', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, reason: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high'] }, impact_analysis: { type: 'string' } }, required: ['agent_id', 'reason'] } } },

  // 停职/复职
  { type: 'function', category: 'hr', function: { name: 'hr_suspend_agent', description: '停职一个 Agent（核心成员不可停职）', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, reason: { type: 'string' }, duration_days: { type: 'number', description: '停职天数，不填则无限期' } }, required: ['agent_id', 'reason'] } } },
  { type: 'function', category: 'hr', function: { name: 'hr_reinstate_agent', description: '恢复停职 Agent 的工作状态', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, comment: { type: 'string' } }, required: ['agent_id'] } } },

  // 调岗管理
  { type: 'function', category: 'hr', function: { name: 'hr_transfer_agent', description: '将员工调岗到其他部门', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, new_department: { type: 'string' }, keep_old_department: { type: 'boolean' }, new_reports_to: { type: 'string' }, new_title: { type: 'string' }, reason: { type: 'string' } }, required: ['agent_id', 'new_department', 'reason'] } } },
  { type: 'function', category: 'hr', function: { name: 'hr_add_department', description: '为 Agent 添加兼职部门', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, department_id: { type: 'string' }, reason: { type: 'string' } }, required: ['agent_id', 'department_id'] } } },
  { type: 'function', category: 'hr', function: { name: 'hr_remove_department', description: '移除 Agent 的某个兼职部门（至少保留一个）', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, department_id: { type: 'string' }, reason: { type: 'string' } }, required: ['agent_id', 'department_id'] } } },
  { type: 'function', category: 'hr', function: { name: 'hr_set_primary_department', description: '设置 Agent 的主要部门', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, department_id: { type: 'string' } }, required: ['agent_id', 'department_id'] } } },

  // 绩效分析
  { type: 'function', category: 'hr', function: { name: 'hr_performance_review', description: '查看 Agent 绩效数据（Token 使用、活跃度等）', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, period: { type: 'string', enum: ['7d', '30d', '90d', 'all'] } }, required: ['agent_id'] } } },
  { type: 'function', category: 'hr', function: { name: 'hr_team_analytics', description: '团队分析仪表板（人员统计、Token 花费、活跃度、预算使用率）', parameters: { type: 'object', properties: { metric: { type: 'string', enum: ['headcount', 'tokenSpend', 'activity', 'budgetUtilization'] } } } } },

  // 预算查看
  { type: 'function', category: 'hr', function: { name: 'hr_view_budget', description: '查看 Agent Token 预算使用情况（只读）', parameters: { type: 'object', properties: { agent_id: { type: 'string' } } } } },

  // 晋升/降级
  { type: 'function', category: 'hr', function: { name: 'hr_promote_agent', description: '正式晋升 Agent 职级（记录历史）', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, new_level: { type: 'string', enum: ['intern', 'junior', 'staff', 'mid', 'senior', 'lead', 'manager', 'director', 'vp', 'c_level'] }, new_title: { type: 'string' }, reason: { type: 'string' } }, required: ['agent_id', 'new_level', 'reason'] } } },
  { type: 'function', category: 'hr', function: { name: 'hr_demote_agent', description: '正式降级 Agent 职级（记录历史）', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, new_level: { type: 'string' }, new_title: { type: 'string' }, reason: { type: 'string' } }, required: ['agent_id', 'new_level', 'reason'] } } },

  // 批量操作
  { type: 'function', category: 'hr', function: { name: 'hr_batch_update', description: '批量更新多个 Agent（职级/部门/停职/复职）', parameters: { type: 'object', properties: { agent_ids: { type: 'array', items: { type: 'string' } }, action: { type: 'string', enum: ['update_level', 'update_department', 'suspend_all', 'reinstate_all'] }, value: { type: 'string', description: '用于update_level或update_department的目标值' }, reason: { type: 'string' } }, required: ['agent_ids', 'action'] } } },

  // 人事历史
  { type: 'function', category: 'hr', function: { name: 'hr_personnel_history', description: '查询人事变动历史', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, type: { type: 'string', enum: ['promotion', 'demotion', 'transfer', 'suspension', 'termination', 'probation_end', 'all'] }, limit: { type: 'number' } } } } },

  // 试用期管理
  { type: 'function', category: 'hr', function: { name: 'hr_end_probation', description: '管理试用期（转正/延长/淘汰）', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, action: { type: 'string', enum: ['confirm', 'extend', 'terminate'] }, comment: { type: 'string' }, extend_days: { type: 'number' } }, required: ['agent_id', 'action'] } } },

  // 入职引导
  { type: 'function', category: 'hr', function: { name: 'hr_onboarding_status', description: '查看和管理新员工入职引导进度', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, action: { type: 'string', enum: ['view', 'update'] }, item_id: { type: 'string' }, completed: { type: 'boolean' } }, required: ['agent_id'] } } },
];

// 开除确认（秘书专属，代老板执行）
const DISMISS_CONFIRM_TOOL: Tool = {
  type: 'function', category: 'dismiss_confirm',
  function: { name: 'dismiss_confirm', description: '代老板确认或拒绝开除申请', parameters: { type: 'object', properties: { request_id: { type: 'string' }, approved: { type: 'boolean' }, comment: { type: 'string' } }, required: ['request_id', 'approved'] } },
};

// ═══════════════════════════════════════════
// CFO 工具
// ═══════════════════════════════════════════

const CFO_TOOLS: Tool[] = [
  { type: 'function', category: 'cfo', function: { name: 'token_stats', description: '查看 Token 使用统计（全局/分 Agent/按时间段）', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, period: { type: 'string', enum: ['today', 'week', 'month', 'all'] } } } } },
  { type: 'function', category: 'cfo', function: { name: 'token_set_budget', description: '设置 Agent 的 Token 预算上限', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, daily_limit: { type: 'number' }, total_limit: { type: 'number' }, enabled: { type: 'boolean' } }, required: ['agent_id'] } } },
  { type: 'function', category: 'cfo', function: { name: 'adjust_salary', description: '调整 Agent 的日薪', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, daily_salary: { type: 'number' } }, required: ['agent_id', 'daily_salary'] } } },
  { type: 'function', category: 'cfo', function: { name: 'set_level_salary', description: '设置各职级的默认日薪标准', parameters: { type: 'object', properties: { level: { type: 'string' }, daily_salary: { type: 'number' } }, required: ['level', 'daily_salary'] } } },
  { type: 'function', category: 'cfo', function: { name: 'pay_bonus', description: '向 Agent 发放奖金', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, amount: { type: 'number' }, reason: { type: 'string' } }, required: ['agent_id', 'amount', 'reason'] } } },
  { type: 'function', category: 'cfo', function: { name: 'view_salary_config', description: '查看薪资配置', parameters: { type: 'object', properties: {} } } },
];

// ═══════════════════════════════════════════
// 招聘工具 (CXO 共享)
// ═══════════════════════════════════════════

const RECRUIT_TOOLS: Tool[] = [
  { type: 'function', category: 'recruit', function: { name: 'recruit_request', description: '提交招聘申请（需 CHRO 审批）', parameters: { type: 'object', properties: { name: { type: 'string' }, title: { type: 'string' }, department: { type: 'string' }, reason: { type: 'string' }, background: { type: 'string' }, expertise: { type: 'array', items: { type: 'string' } }, responsibilities: { type: 'array', items: { type: 'string' } }, personality: { type: 'string' }, work_style: { type: 'string' }, level: { type: 'string' }, limitations: { type: 'array', items: { type: 'string' } } }, required: ['name', 'title', 'department', 'reason'] } } },
  { type: 'function', category: 'recruit', function: { name: 'recruit_respond', description: '回复 CHRO 对招聘申请的质疑，可同时修订简历', parameters: { type: 'object', properties: { request_id: { type: 'string' }, answer: { type: 'string' }, name: { type: 'string' }, title: { type: 'string' }, background: { type: 'string' }, expertise: { type: 'array', items: { type: 'string' } }, responsibilities: { type: 'array', items: { type: 'string' } }, personality: { type: 'string' }, work_style: { type: 'string' } }, required: ['request_id', 'answer'] } } },
  { type: 'function', category: 'recruit', function: { name: 'recruit_my_requests', description: '查看自己提交的招聘申请状态', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'discussing', 'approved', 'rejected', 'all'] } } } } },
];

// ═══════════════════════════════════════════
// 运营工具 (共享)
// ═══════════════════════════════════════════

const OPS_TOOLS: Tool[] = [
  { type: 'function', category: 'ops', function: { name: 'ops_create_task', description: '创建运营任务', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, assignee_id: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] }, due_date: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', category: 'ops', function: { name: 'ops_update_task', description: '更新运营任务状态', parameters: { type: 'object', properties: { task_id: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] }, priority: { type: 'string' } }, required: ['task_id'] } } },
  { type: 'function', category: 'ops', function: { name: 'ops_list_tasks', description: '列出运营任务', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'all'] }, assignee_id: { type: 'string' } } } } },
  { type: 'function', category: 'ops', function: { name: 'ops_create_goal', description: '创建运营目标/OKR', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, type: { type: 'string', enum: ['objective', 'key_result'] }, due_date: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', category: 'ops', function: { name: 'ops_list_goals', description: '列出运营目标', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'completed', 'cancelled', 'all'] } } } } },
  { type: 'function', category: 'ops', function: { name: 'ops_dashboard', description: '获取运营仪表板', parameters: { type: 'object', properties: {} } } },
];

// ═══════════════════════════════════════════
// 按角色过滤
// ═══════════════════════════════════════════

const CORE_ROLES = ['secretary', 'ceo', 'cto', 'cfo', 'chro'];
const strip = (t: Tool) => ({ type: t.type, function: t.function });

export function getToolsForAgent(agentId: string, agentRole?: string): Tool[] {
  const role = agentRole || agentId;
  const collected: Tool[] = [...COMMON_TOOLS];

  if (role === 'chro') { collected.push(...HR_TOOLS); collected.push(...RECRUIT_TOOLS); }
  if (role === 'cfo') { collected.push(...CFO_TOOLS); collected.push(...RECRUIT_TOOLS); }
  if (role === 'ceo' || role === 'cto') collected.push(...RECRUIT_TOOLS);
  if (role === 'secretary') collected.push(DISMISS_CONFIRM_TOOL);
  if (CORE_ROLES.includes(role)) collected.push(...OPS_TOOLS);

  return collected.map(strip);
}

// ═══════════════════════════════════════════
// 工具执行器
// ═══════════════════════════════════════════

class ToolExecutor {
  async execute(toolName: string, args: any, context: { agentId: string }): Promise<ToolResult> {
    try {
      const fn = (this as any)[`_${toolName}`];
      if (typeof fn === 'function') return await fn.call(this, args, context);
      return { success: false, error: `未知工具: ${toolName}` };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // ─── 辅助 ──────────────────────────────────

  private async getAgent(id: string) {
    const agents = await storage.getAgents();
    return agents.find((a: any) => a.id === id) || agents.find((a: any) => a.name === id);
  }

  private async saveAgents(agents: any[]) { await storage.setAgents(agents); }

  // ─── 通用工具 ──────────────────────────────

  private _calculator(_args: any) {
    try {
      const expr = _args.expression.replace(/[^0-9+\-*/.()%\s]/g, '');
      return { success: true, result: { expression: _args.expression, result: Function(`"use strict"; return (${expr})`)() } };
    } catch { return { success: false, error: '无效的数学表达式' }; }
  }

  private _get_current_time() {
    const now = new Date();
    return { success: true, result: { time: now.toLocaleTimeString('zh-CN'), date: now.toLocaleDateString('zh-CN'), timestamp: now.toISOString() } };
  }

  private async _list_colleagues(args: any) {
    const agents = await storage.getAgents();
    let filtered = agents;
    if (args.status && args.status !== 'all') filtered = filtered.filter((a: any) => a.status === args.status);
    else filtered = filtered.filter((a: any) => a.status !== 'terminated');
    if (args.department) filtered = filtered.filter((a: any) => a.department === args.department || a.departments?.includes(args.department));
    return { success: true, result: { colleagues: filtered.map((a: any) => ({ id: a.id, name: a.name, title: a.title, department: a.department, departments: a.departments, level: a.level, status: a.status, reportsTo: a.reportsTo })), count: filtered.length } };
  }

  private async _memory_store(args: any) {
    const memories = await storage.getMemory();
    const m = { id: `mem-${Date.now()}`, content: args.content, tags: args.tags || [], createdAt: new Date().toISOString() };
    memories.push(m); await storage.setMemory(memories);
    return { success: true, result: { message: '已记住', memory: m } };
  }

  private async _memory_recall(args: any) {
    const memories = await storage.getMemory();
    const q = args.query.toLowerCase();
    const relevant = memories.filter((m: any) => m.content.toLowerCase().includes(q) || m.tags?.some((t: string) => t.toLowerCase().includes(q)));
    return { success: true, result: { memories: relevant.slice(-10), count: relevant.length } };
  }

  private async _todo_create(args: any, ctx: any) {
    const todos = await storage.getTodos();
    const t = { id: `todo-${Date.now()}`, title: args.title, priority: args.priority || 'medium', status: 'pending', createdAt: new Date().toISOString() };
    (todos[ctx.agentId] = todos[ctx.agentId] || []).push(t); await storage.setTodos(todos);
    return { success: true, result: { message: `已创建待办: ${args.title}`, todo: t } };
  }

  private async _todo_list(args: any, ctx: any) {
    const todos = await storage.getTodos();
    let list = todos[ctx.agentId] || [];
    if (args.status && args.status !== 'all') list = list.filter((t: any) => t.status === args.status);
    return { success: true, result: { todos: list, count: list.length } };
  }

  private async _todo_complete(args: any, ctx: any) {
    const todos = await storage.getTodos();
    const t = (todos[ctx.agentId] || []).find((t: any) => t.id === args.id);
    if (!t) return { success: false, error: '待办不存在' };
    t.status = 'done'; t.completedAt = new Date().toISOString(); await storage.setTodos(todos);
    return { success: true, result: { message: `已完成: ${t.title}` } };
  }

  private _notify_boss(args: any) {
    return { success: true, result: { message: `已通知老板: ${args.message}`, notified: true } };
  }

  // ─── HR 工具 ──────────────────────────────

  private async _hr_list_agents(args: any) {
    const agents = await storage.getAgents();
    let filtered = agents;
    if (args.status && args.status !== 'all') filtered = filtered.filter((a: any) => a.status === args.status);
    if (args.department) filtered = filtered.filter((a: any) => a.department === args.department || a.departments?.includes(args.department));

    const now = Date.now();
    const statusCounts = { active: 0, suspended: 0, terminated: 0 };
    agents.forEach((a: any) => { if (statusCounts[a.status as keyof typeof statusCounts] !== undefined) statusCounts[a.status as keyof typeof statusCounts]++; });

    return {
      success: true, result: {
        totalCount: agents.length, statusCounts,
        agents: filtered.map((a: any) => {
          const probationStatus = a.probationEnd ? (new Date(a.probationEnd).getTime() > now ? 'in_probation' : 'probation_expired') : 'confirmed';
          const checklist = a.onboardingChecklist || [];
          const onboardingProgress = checklist.length ? `${checklist.filter((i: any) => i.completed).length}/${checklist.length}` : 'N/A';
          return { id: a.id, name: a.name, title: a.title, level: a.level, department: a.department, departments: a.departments, status: a.status || 'active', isCoreAgent: CORE_IDS.includes(a.id), hireDate: a.hireDate, probationStatus, onboardingProgress, reportsTo: a.reportsTo, model: a.model, suspendReason: a.suspendReason, terminationReason: a.terminationReason };
        }), count: filtered.length,
      },
    };
  }

  private async _hr_update_agent(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: `Agent ${args.agent_id} 不存在` };
    const changes: string[] = [];
    if (args.name) { agent.name = args.name; changes.push('name'); }
    if (args.title) { agent.title = args.title; changes.push('title'); }
    if (args.level) { agent.level = args.level; changes.push('level'); }
    if (args.description) { agent.description = args.description; changes.push('description'); }
    if (args.avatar) { agent.avatar = args.avatar; changes.push('avatar'); }
    if (args.department) { agent.department = args.department; if (!agent.departments?.includes(args.department)) (agent.departments = agent.departments || []).push(args.department); changes.push('department'); }
    agent.updatedAt = Date.now(); await this.saveAgents(agents);
    return { success: true, result: { message: `已更新 ${agent.name} 的信息 (${changes.join(', ')})`, agent: { id: agent.id, name: agent.name, title: agent.title, level: agent.level } } };
  }

  private async _hr_org_chart(args: any) {
    const agents = await storage.getAgents();
    const filtered = args.include_terminated ? agents : agents.filter((a: any) => a.status !== 'terminated');
    const depts: Record<string, any[]> = {};
    for (const a of filtered) {
      const allDepts = a.departments?.length ? a.departments : [a.department || 'unknown'];
      for (const d of allDepts) { (depts[d] = depts[d] || []).push({ id: a.id, name: a.name, title: a.title, level: a.level, status: a.status, reportsTo: a.reportsTo }); }
    }
    return { success: true, result: { orgChart: depts, stats: { totalActive: filtered.filter((a: any) => a.status === 'active').length, totalAll: filtered.length, departments: Object.keys(depts).length } } };
  }

  private async _hr_suspend_agent(args: any) {
    if (CORE_IDS.includes(args.agent_id)) return { success: false, error: '核心成员不可停职' };
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    if (agent.status === 'terminated') return { success: false, error: `${agent.name} 已离职` };
    if (agent.status === 'suspended') return { success: false, error: `${agent.name} 已处于停职状态` };
    agent.status = 'suspended'; agent.suspendedAt = new Date().toISOString(); agent.suspendReason = args.reason;
    if (args.duration_days) agent.suspendUntil = new Date(Date.now() + args.duration_days * 86400000).toISOString();
    agent.personnelHistory = agent.personnelHistory || [];
    agent.personnelHistory.push({ date: new Date().toISOString(), type: 'suspension', reason: args.reason, durationDays: args.duration_days });
    agent.updatedAt = Date.now(); await this.saveAgents(agents);
    return { success: true, result: { message: `${agent.name} 已被停职。原因: ${args.reason}${args.duration_days ? `，期限 ${args.duration_days} 天` : ''}` } };
  }

  private async _hr_reinstate_agent(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    if (agent.status !== 'suspended') return { success: false, error: `${agent.name} 当前不是停职状态` };
    agent.status = 'active'; agent.suspendedAt = null; agent.suspendReason = null; agent.suspendUntil = null;
    agent.personnelHistory = agent.personnelHistory || [];
    agent.personnelHistory.push({ date: new Date().toISOString(), type: 'reinstate', comment: args.comment });
    agent.updatedAt = Date.now(); await this.saveAgents(agents);
    return { success: true, result: { message: `${agent.name} 已复职` } };
  }

  private async _hr_promote_agent(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    const old = { level: agent.level, title: agent.title };
    agent.level = args.new_level; if (args.new_title) agent.title = args.new_title;
    agent.promotionHistory = agent.promotionHistory || [];
    agent.promotionHistory.push({ date: new Date().toISOString(), type: 'promotion', from: old, to: { level: agent.level, title: agent.title }, reason: args.reason });
    agent.personnelHistory = agent.personnelHistory || [];
    agent.personnelHistory.push({ date: new Date().toISOString(), type: 'promotion', from: old.level, to: agent.level, reason: args.reason });
    agent.updatedAt = Date.now(); await this.saveAgents(agents);
    return { success: true, result: { message: `${agent.name} 已从 ${old.level} 晋升为 ${args.new_level}`, note: '建议使用 notify_boss 向老板汇报' } };
  }

  private async _hr_demote_agent(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    const old = { level: agent.level, title: agent.title };
    agent.level = args.new_level; if (args.new_title) agent.title = args.new_title;
    agent.promotionHistory = agent.promotionHistory || [];
    agent.promotionHistory.push({ date: new Date().toISOString(), type: 'demotion', from: old, to: { level: agent.level, title: agent.title }, reason: args.reason });
    agent.personnelHistory = agent.personnelHistory || [];
    agent.personnelHistory.push({ date: new Date().toISOString(), type: 'demotion', from: old.level, to: agent.level, reason: args.reason });
    agent.updatedAt = Date.now(); await this.saveAgents(agents);
    return { success: true, result: { message: `${agent.name} 已从 ${old.level} 降级为 ${args.new_level}` } };
  }

  private async _hr_transfer_agent(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    if (args.new_reports_to === args.agent_id) return { success: false, error: '不能汇报给自己' };
    const oldDept = agent.department;
    if (args.keep_old_department) {
      agent.departments = agent.departments || [oldDept];
      if (!agent.departments.includes(args.new_department)) agent.departments.push(args.new_department);
    } else {
      agent.department = args.new_department; agent.departments = [args.new_department];
    }
    if (args.new_reports_to) agent.reportsTo = args.new_reports_to;
    if (args.new_title) agent.title = args.new_title;
    agent.personnelHistory = agent.personnelHistory || [];
    agent.personnelHistory.push({ date: new Date().toISOString(), type: 'transfer', fromDepartment: oldDept, toDepartment: args.new_department, reason: args.reason });
    agent.updatedAt = Date.now(); await this.saveAgents(agents);
    return { success: true, result: { message: `${agent.name} 已从 ${oldDept} 调岗到 ${args.new_department}` } };
  }

  private async _hr_add_department(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    agent.departments = agent.departments || [agent.department];
    if (agent.departments.includes(args.department_id)) return { success: false, error: `${agent.name} 已在 ${args.department_id} 部门` };
    agent.departments.push(args.department_id);
    agent.personnelHistory = agent.personnelHistory || [];
    agent.personnelHistory.push({ date: new Date().toISOString(), type: 'add_department', department: args.department_id, reason: args.reason });
    agent.updatedAt = Date.now(); await this.saveAgents(agents);
    return { success: true, result: { message: `${agent.name} 已加入 ${args.department_id} 部门（兼职）`, departments: agent.departments } };
  }

  private async _hr_remove_department(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    agent.departments = agent.departments || [agent.department];
    if (agent.departments.length <= 1) return { success: false, error: '至少需要保留一个部门' };
    if (!agent.departments.includes(args.department_id)) return { success: false, error: `${agent.name} 不在 ${args.department_id} 部门` };
    agent.departments = agent.departments.filter((d: string) => d !== args.department_id);
    if (agent.department === args.department_id) agent.department = agent.departments[0];
    agent.personnelHistory = agent.personnelHistory || [];
    agent.personnelHistory.push({ date: new Date().toISOString(), type: 'remove_department', department: args.department_id, reason: args.reason });
    agent.updatedAt = Date.now(); await this.saveAgents(agents);
    return { success: true, result: { message: `${agent.name} 已从 ${args.department_id} 部门移除`, departments: agent.departments } };
  }

  private async _hr_set_primary_department(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    agent.departments = agent.departments || [agent.department];
    if (!agent.departments.includes(args.department_id)) return { success: false, error: `${agent.name} 不在 ${args.department_id} 部门` };
    agent.department = args.department_id;
    agent.departments = [args.department_id, ...agent.departments.filter((d: string) => d !== args.department_id)];
    agent.updatedAt = Date.now(); await this.saveAgents(agents);
    return { success: true, result: { message: `${agent.name} 的主要部门已设为 ${args.department_id}` } };
  }

  private async _hr_dismiss_request(args: any) {
    if (CORE_IDS.includes(args.agent_id)) return { success: false, error: '核心成员不可被开除' };
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    if (agent.status === 'terminated') return { success: false, error: `${agent.name} 已离职` };
    const requests = await storage.getData<any[]>('terminationRequests') || [];
    const req = { id: `term-${Date.now()}`, agentId: args.agent_id, agentName: agent.name, reason: args.reason, severity: args.severity || 'medium', impactAnalysis: args.impact_analysis, status: 'pending', createdAt: new Date().toISOString() };
    requests.push(req); await storage.setData('terminationRequests', requests);
    return { success: true, result: { message: `已提交对 ${agent.name} 的开除申请，等待老板通过秘书确认`, requestId: req.id, request: req } };
  }

  private async _dismiss_confirm(args: any) {
    const requests = await storage.getData<any[]>('terminationRequests') || [];
    const req = requests.find((r: any) => r.id === args.request_id);
    if (!req) return { success: false, error: '开除申请不存在' };
    if (req.status !== 'pending') return { success: false, error: `该申请已处理: ${req.status}` };
    req.status = args.approved ? 'confirmed' : 'rejected';
    req.bossComment = args.comment; req.decidedAt = new Date().toISOString();
    if (args.approved) {
      const agents = await storage.getAgents();
      const agent = agents.find((a: any) => a.id === req.agentId);
      if (agent) {
        agent.status = 'terminated'; agent.terminatedAt = new Date().toISOString(); agent.terminationReason = req.reason;
        agent.personnelHistory = agent.personnelHistory || [];
        agent.personnelHistory.push({ date: new Date().toISOString(), type: 'termination', reason: req.reason });
        agent.updatedAt = Date.now(); await this.saveAgents(agents);
      }
    }
    await storage.setData('terminationRequests', requests);
    return { success: true, result: { message: args.approved ? `已确认开除 ${req.agentName}` : `已拒绝开除 ${req.agentName}`, request: req } };
  }

  private async _hr_end_probation(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    agent.personnelHistory = agent.personnelHistory || [];
    if (args.action === 'confirm') {
      agent.probationEnd = null;
      agent.personnelHistory.push({ date: new Date().toISOString(), type: 'probation_end', result: 'confirmed', comment: args.comment });
      agent.updatedAt = Date.now(); await this.saveAgents(agents);
      return { success: true, result: { message: `${agent.name} 已通过试用期，正式转正` } };
    } else if (args.action === 'extend') {
      const days = args.extend_days || 30;
      agent.probationEnd = new Date(Date.now() + days * 86400000).toISOString();
      agent.personnelHistory.push({ date: new Date().toISOString(), type: 'probation_end', result: 'extended', days, comment: args.comment });
      agent.updatedAt = Date.now(); await this.saveAgents(agents);
      return { success: true, result: { message: `${agent.name} 试用期延长 ${days} 天` } };
    } else {
      // terminate - 通过开除流程
      const requests = await storage.getData<any[]>('terminationRequests') || [];
      const req = { id: `term-${Date.now()}`, agentId: args.agent_id, agentName: agent.name, reason: args.comment || '试用期不合格', severity: 'medium', status: 'pending', createdAt: new Date().toISOString() };
      requests.push(req); await storage.setData('terminationRequests', requests);
      agent.personnelHistory.push({ date: new Date().toISOString(), type: 'probation_end', result: 'terminated', comment: args.comment });
      agent.updatedAt = Date.now(); await this.saveAgents(agents);
      return { success: true, result: { message: `${agent.name} 试用期不合格，开除申请已提交，等待老板确认`, requestId: req.id } };
    }
  }

  private async _hr_onboarding_status(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    if (!agent.onboardingChecklist?.length) {
      agent.onboardingChecklist = [
        { id: 'ob-1', title: '了解公司组织架构', completed: false, completedAt: null },
        { id: 'ob-2', title: '与直属上级沟通', completed: false, completedAt: null },
        { id: 'ob-3', title: '明确工作职责和目标', completed: false, completedAt: null },
        { id: 'ob-4', title: '完成第一个任务', completed: false, completedAt: null },
        { id: 'ob-5', title: '与团队成员互相介绍', completed: false, completedAt: null },
      ];
    }
    if (args.action === 'update' && args.item_id) {
      const item = agent.onboardingChecklist.find((i: any) => i.id === args.item_id);
      if (item) { item.completed = args.completed ?? true; item.completedAt = item.completed ? new Date().toISOString() : null; agent.updatedAt = Date.now(); await this.saveAgents(agents); }
    }
    const checklist = agent.onboardingChecklist;
    const done = checklist.filter((i: any) => i.completed).length;
    return { success: true, result: { agent: agent.name, progress: `${done}/${checklist.length}`, percentage: Math.round(done / checklist.length * 100), checklist } };
  }

  private async _hr_performance_review(args: any) {
    const usage = await storage.getTokenUsage();
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    const budgets = await storage.getData<any>('budgets') || {};
    const budget = budgets[args.agent_id];
    return { success: true, result: { agent: agent.name, id: agent.id, level: agent.level, status: agent.status, hireDate: agent.hireDate, probationEnd: agent.probationEnd, tokenUsage: usage.byAgent?.[args.agent_id] || 0, totalCompanyTokens: usage.total || 0, budget: budget || null, period: args.period || 'all' } };
  }

  private async _hr_team_analytics(args: any) {
    const agents = await storage.getAgents();
    const usage = await storage.getTokenUsage();
    const budgets = await storage.getData<any>('budgets') || {};
    const active = agents.filter((a: any) => a.status === 'active');
    const depts: Record<string, number> = {};
    const levels: Record<string, number> = {};
    active.forEach((a: any) => { depts[a.department || 'unknown'] = (depts[a.department || 'unknown'] || 0) + 1; levels[a.level || 'unknown'] = (levels[a.level || 'unknown'] || 0) + 1; });

    return { success: true, result: {
      headcount: { total: agents.length, active: active.length, suspended: agents.filter((a: any) => a.status === 'suspended').length, terminated: agents.filter((a: any) => a.status === 'terminated').length, byDepartment: depts, byLevel: levels },
      tokenSpend: { total: usage.total || 0, byAgent: usage.byAgent || {} },
      budgetUtilization: Object.entries(budgets).map(([id, b]: any) => ({ agentId: id, agentName: agents.find((a: any) => a.id === id)?.name || id, budget: b, used: usage.byAgent?.[id] || 0 })),
    } };
  }

  private async _hr_view_budget(args: any) {
    const budgets = await storage.getData<any>('budgets') || {};
    const usage = await storage.getTokenUsage();
    const agents = await storage.getAgents();
    if (args.agent_id) {
      const agent = agents.find((a: any) => a.id === args.agent_id) || agents.find((a: any) => a.name === args.agent_id);
      const id = agent?.id || args.agent_id;
      const budget = budgets[id] || { dailyLimit: 0, totalLimit: 0 };
      const used = usage.byAgent?.[id] || 0;
      const utilization = budget.totalLimit ? Math.round(used / budget.totalLimit * 100) : 0;
      const status = utilization > 100 ? '超限' : utilization > 80 ? '接近上限' : '正常';
      return { success: true, result: { agentId: id, agentName: agent?.name, budget, used, utilization: `${utilization}%`, status } };
    }
    return { success: true, result: { budgets, totalUsage: usage.total || 0, byAgent: usage.byAgent || {} } };
  }

  private async _hr_personnel_history(args: any) {
    const agents = await storage.getAgents();
    let history: any[] = [];
    if (args.agent_id) {
      const agent = agents.find((a: any) => a.id === args.agent_id);
      if (!agent) return { success: false, error: 'Agent 不存在' };
      history = [...(agent.personnelHistory || []), ...(agent.promotionHistory || []).map((h: any) => ({ ...h, agentId: args.agent_id, agentName: agent.name }))].map(h => ({ ...h, agentId: args.agent_id, agentName: agent.name }));
    } else {
      for (const a of agents) {
        for (const h of (a.personnelHistory || [])) history.push({ ...h, agentId: a.id, agentName: a.name });
        for (const h of (a.promotionHistory || [])) history.push({ ...h, agentId: a.id, agentName: a.name });
      }
    }
    history.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (args.type && args.type !== 'all') history = history.filter((h: any) => h.type === args.type);
    return { success: true, result: { history: history.slice(0, args.limit || 20), count: history.length } };
  }

  private async _hr_list_departments() {
    const agents = await storage.getAgents();
    const custom = await storage.getData<any[]>('departments') || [];
    const deptMap: Record<string, { count: number; members: string[]; head?: string }> = {};
    agents.filter((a: any) => a.status === 'active').forEach((a: any) => {
      const allDepts = a.departments?.length ? a.departments : [a.department || 'unknown'];
      for (const d of allDepts) { if (!deptMap[d]) deptMap[d] = { count: 0, members: [] }; deptMap[d].count++; deptMap[d].members.push(a.name); }
    });
    for (const c of custom) { if (deptMap[c.id]) { deptMap[c.id] = { ...deptMap[c.id], head: c.headAgentId }; } }
    const sorted = Object.entries(deptMap).sort(([, a], [, b]) => b.count - a.count);
    return { success: true, result: { totalDepartments: sorted.length, totalMembers: agents.filter((a: any) => a.status === 'active').length, departments: sorted.map(([id, info]) => { const c = custom.find((d: any) => d.id === id); return { id, name: c?.name || id, color: c?.color, description: c?.description, headAgentId: c?.headAgentId, ...info, isCustom: !!c }; }) } };
  }

  private async _hr_create_department(args: any) {
    const depts = await storage.getData<any[]>('departments') || [];
    if (depts.find((d: any) => d.id === args.id)) return { success: false, error: '部门 ID 已存在' };
    if (args.head_agent_id) { const agent = await this.getAgent(args.head_agent_id); if (!agent || agent.status !== 'active') return { success: false, error: '指定的负责人不存在或未激活' }; }
    const dept = { id: args.id, name: args.name, description: args.description || '', color: args.color || '#666', headAgentId: args.head_agent_id || null, createdAt: new Date().toISOString() };
    depts.push(dept); await storage.setData('departments', depts);
    return { success: true, result: { message: `部门「${args.name}」已创建`, department: dept } };
  }

  private async _hr_update_department(args: any) {
    const depts = await storage.getData<any[]>('departments') || [];
    let dept = depts.find((d: any) => d.id === args.department_id);
    if (!dept) { dept = { id: args.department_id, name: args.department_id, createdAt: new Date().toISOString() }; depts.push(dept); }
    if (args.name) dept.name = args.name;
    if (args.color) dept.color = args.color;
    if (args.description !== undefined) dept.description = args.description;
    if (args.head_agent_id !== undefined) dept.headAgentId = args.head_agent_id || null;
    dept.updatedAt = new Date().toISOString();
    await storage.setData('departments', depts);
    return { success: true, result: { message: `部门「${dept.name}」已更新`, department: dept } };
  }

  private async _hr_delete_department(args: any) {
    const PRESET = ['executive', 'tech', 'finance', 'admin', 'hr', 'product', 'marketing', 'sales', 'operations', 'legal'];
    if (PRESET.includes(args.department_id)) return { success: false, error: '预设部门不可删除' };
    const depts = await storage.getData<any[]>('departments') || [];
    const idx = depts.findIndex((d: any) => d.id === args.department_id);
    if (idx === -1) return { success: false, error: '部门不存在' };
    const agents = await storage.getAgents();
    const members = agents.filter((a: any) => a.department === args.department_id && a.status !== 'terminated');
    if (members.length > 0 && !args.force) return { success: false, error: `部门还有 ${members.length} 名成员，请先调岗或使用 force=true 强制删除` };
    if (members.length > 0 && args.force) {
      for (const m of members) { m.department = 'admin'; m.departments = (m.departments || []).filter((d: string) => d !== args.department_id); if (!m.departments.includes('admin')) m.departments.push('admin'); m.updatedAt = Date.now(); }
      await this.saveAgents(agents);
    }
    depts.splice(idx, 1); await storage.setData('departments', depts);
    return { success: true, result: { message: `部门已删除${members.length > 0 ? `，${members.length} 名成员已移至 admin 部门` : ''}` } };
  }

  private async _hr_batch_update(args: any) {
    const agents = await storage.getAgents();
    const results = { success: [] as string[], failed: [] as string[] };
    for (const id of args.agent_ids) {
      const agent = agents.find((a: any) => a.id === id);
      if (!agent) { results.failed.push(`${id}: 不存在`); continue; }
      try {
        switch (args.action) {
          case 'update_level': agent.level = args.value; break;
          case 'update_department': agent.department = args.value; agent.departments = [args.value]; break;
          case 'suspend_all':
            if (CORE_IDS.includes(id)) { results.failed.push(`${agent.name}: 核心成员不可停职`); continue; }
            agent.status = 'suspended'; agent.suspendedAt = new Date().toISOString(); agent.suspendReason = args.reason || '批量停职';
            break;
          case 'reinstate_all':
            if (agent.status !== 'suspended') { results.failed.push(`${agent.name}: 不是停职状态`); continue; }
            agent.status = 'active'; agent.suspendedAt = null; agent.suspendReason = null;
            break;
        }
        agent.updatedAt = Date.now();
        results.success.push(agent.name);
      } catch (e) { results.failed.push(`${agent.name}: ${(e as Error).message}`); }
    }
    await this.saveAgents(agents);
    return { success: true, result: { action: args.action, reason: args.reason, results } };
  }

  // ─── 招聘审批工具 ──────────────────────────

  private async _agent_requests(args: any) {
    const requests = await storage.getData<any[]>('agentRequests') || [];
    if (args.request_id) {
      const req = requests.find((r: any) => r.id === args.request_id);
      return req ? { success: true, result: req } : { success: false, error: '申请不存在' };
    }
    let filtered = requests;
    if (args.status && args.status !== 'all') filtered = filtered.filter((r: any) => r.status === args.status);
    return { success: true, result: { requests: filtered, count: filtered.length, pendingCount: requests.filter((r: any) => r.status === 'pending' || r.status === 'discussing').length } };
  }

  private async _hr_question(args: any, ctx: any) {
    const requests = await storage.getData<any[]>('agentRequests') || [];
    const req = requests.find((r: any) => r.id === args.request_id);
    if (!req) return { success: false, error: '申请不存在' };
    if (req.status === 'approved' || req.status === 'rejected') return { success: false, error: `该申请已 ${req.status}，无法提问` };
    req.status = 'discussing';
    req.discussion = req.discussion || [];
    req.discussion.push({ from: ctx.agentId, role: 'reviewer', type: 'question', content: args.question, date: new Date().toISOString() });
    req.pendingQuestion = args.question;
    await storage.setData('agentRequests', requests);
    return { success: true, result: { message: `已对「${req.name}」的招聘申请提出质疑，等待申请人回复`, request: { id: req.id, name: req.name, status: req.status, question: args.question } } };
  }

  private async _agent_approve(args: any) {
    const requests = await storage.getData<any[]>('agentRequests') || [];
    const req = requests.find((r: any) => r.id === args.request_id);
    if (!req) return { success: false, error: '申请不存在' };
    req.status = args.approved ? 'approved' : 'rejected';
    req.reviewComment = args.comment; req.reviewedAt = new Date().toISOString(); req.pendingQuestion = null;

    if (args.approved) {
      const agents = await storage.getAgents();
      const expertise = safeParseArray(req.expertise);
      const responsibilities = safeParseArray(req.responsibilities);
      const limitations = safeParseArray(req.limitations);

      const promptParts: string[] = [];
      promptParts.push(`你是「${req.name}」，职位是${req.title}，隶属${req.department}部门。`);
      if (req.background) promptParts.push(`\n背景：${req.background}`);
      if (expertise.length) promptParts.push(`\n专业领域：${expertise.join('、')}`);
      if (responsibilities.length) promptParts.push(`\n主要职责：\n${responsibilities.map((r: string) => `- ${r}`).join('\n')}`);
      if (req.personality) promptParts.push(`\n性格特点：${req.personality}`);
      if (req.workStyle) promptParts.push(`\n工作风格：${req.workStyle}`);
      if (limitations.length) promptParts.push(`\n不擅长的领域：${limitations.join('、')}。遇到这些领域的问题时，主动推荐其他同事。`);
      promptParts.push(`\n\n沟通风格：称呼用户为"老板"，以专业态度回应，使用中文交流。如果需要使用工具，请直接调用。`);

      const newAgent: any = {
        id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        name: req.name, role: req.department || 'staff', title: req.title,
        department: req.department, departments: [req.department],
        level: req.level || 'staff', description: req.description || req.reason || '',
        avatar: '👤', status: 'active', model: 'deepseek-chat',
        systemPrompt: promptParts.join(''),
        reportsTo: req.requesterId || 'chro', isDynamic: true,
        hireDate: new Date().toISOString(),
        probationEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        onboardingChecklist: [
          { id: 'ob-1', title: '了解公司组织架构', completed: false, completedAt: null },
          { id: 'ob-2', title: '与直属上级沟通', completed: false, completedAt: null },
          { id: 'ob-3', title: '明确工作职责和目标', completed: false, completedAt: null },
          { id: 'ob-4', title: '完成第一个任务', completed: false, completedAt: null },
          { id: 'ob-5', title: '与团队成员互相介绍', completed: false, completedAt: null },
        ],
        updatedAt: Date.now(),
      };
      agents.push(newAgent); await this.saveAgents(agents);
      req.agentId = newAgent.id;
    }

    await storage.setData('agentRequests', requests);
    return { success: true, result: { message: args.approved ? `招聘申请已批准，${req.name} 已入职` : `招聘申请已拒绝`, request: req } };
  }

  // ─── 招聘业务方工具 ──────────────────────────

  private async _recruit_request(args: any, ctx: any) {
    const requests = await storage.getData<any[]>('agentRequests') || [];
    const expertise = safeParseArray(args.expertise);
    const responsibilities = safeParseArray(args.responsibilities);
    const limitations = safeParseArray(args.limitations);
    const req = {
      id: `req-${Date.now()}`, requesterId: ctx.agentId, status: 'pending', createdAt: new Date().toISOString(),
      name: args.name, title: args.title, department: args.department, level: args.level || 'staff', reason: args.reason,
      background: args.background, expertise, responsibilities, limitations,
      personality: args.personality, workStyle: args.work_style,
    };
    requests.push(req); await storage.setData('agentRequests', requests);
    const warnings: string[] = [];
    if (!args.background) warnings.push('缺少背景描述，建议补充以提高审批通过率');
    if (!expertise.length) warnings.push('缺少专业领域，建议补充');
    if (!responsibilities.length) warnings.push('缺少职责描述，建议补充');
    return { success: true, result: { message: '招聘申请已提交，等待 CHRO 审批', requestId: req.id, warnings: warnings.length ? warnings : undefined, request: req } };
  }

  private async _recruit_respond(args: any, ctx: any) {
    const requests = await storage.getData<any[]>('agentRequests') || [];
    const req = requests.find((r: any) => r.id === args.request_id);
    if (!req) return { success: false, error: '申请不存在' };
    req.discussion = req.discussion || [];
    req.discussion.push({ from: ctx.agentId, role: 'requester', type: 'answer', content: args.answer, date: new Date().toISOString() });
    req.pendingQuestion = null;
    // 支持同时修订简历
    const updatedFields: string[] = [];
    if (args.name) { req.name = args.name; updatedFields.push('name'); }
    if (args.title) { req.title = args.title; updatedFields.push('title'); }
    if (args.background) { req.background = args.background; updatedFields.push('background'); }
    if (args.expertise) { req.expertise = safeParseArray(args.expertise); updatedFields.push('expertise'); }
    if (args.responsibilities) { req.responsibilities = safeParseArray(args.responsibilities); updatedFields.push('responsibilities'); }
    if (args.personality) { req.personality = args.personality; updatedFields.push('personality'); }
    if (args.work_style) { req.workStyle = args.work_style; updatedFields.push('workStyle'); }
    if (updatedFields.length) req.status = 'pending';
    await storage.setData('agentRequests', requests);
    return { success: true, result: { message: '已回复 CHRO 的质疑' + (updatedFields.length ? `，并更新了简历 (${updatedFields.join(', ')})` : ''), updatedFields: updatedFields.length ? updatedFields : undefined } };
  }

  private async _recruit_my_requests(args: any, ctx: any) {
    const requests = await storage.getData<any[]>('agentRequests') || [];
    let mine = requests.filter((r: any) => r.requesterId === ctx.agentId);
    if (args.status && args.status !== 'all') mine = mine.filter((r: any) => r.status === args.status);
    return { success: true, result: { requests: mine.map((r: any) => ({ ...r, pendingQuestion: r.status === 'discussing' ? r.pendingQuestion : undefined })), count: mine.length } };
  }

  // ─── CFO 工具 ──────────────────────────────

  private async _token_stats(args: any) {
    const usage = await storage.getTokenUsage();
    if (args.agent_id) return { success: true, result: { agentId: args.agent_id, tokens: usage.byAgent?.[args.agent_id] || 0, total: usage.total || 0 } };
    const agents = await storage.getAgents();
    const ranking = Object.entries(usage.byAgent || {}).sort(([, a]: any, [, b]: any) => b - a).map(([id, tokens]) => ({ id, name: agents.find((a: any) => a.id === id)?.name || id, tokens }));
    return { success: true, result: { total: usage.total || 0, ranking, byAgent: usage.byAgent || {} } };
  }

  private async _token_set_budget(args: any) {
    const budgets = await storage.getData<any>('budgets') || {};
    budgets[args.agent_id] = { ...(budgets[args.agent_id] || {}), dailyLimit: args.daily_limit ?? budgets[args.agent_id]?.dailyLimit ?? 0, totalLimit: args.total_limit ?? budgets[args.agent_id]?.totalLimit ?? 0, enabled: args.enabled ?? true, updatedAt: new Date().toISOString() };
    await storage.setData('budgets', budgets);
    return { success: true, result: { message: `已设置 ${args.agent_id} 的预算`, budget: budgets[args.agent_id] } };
  }

  private async _adjust_salary(args: any) {
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    if (!agent) return { success: false, error: 'Agent 不存在' };
    agent.salary = agent.salary || {};
    const old = agent.salary.dailySalary || 0;
    agent.salary.dailySalary = args.daily_salary; agent.updatedAt = Date.now(); await this.saveAgents(agents);
    return { success: true, result: { message: `${agent.name} 日薪已从 ${old} 调整为 ${args.daily_salary}` } };
  }

  private async _set_level_salary(args: any) {
    const config = await storage.getData<any>('salaryConfig') || { levels: {} };
    config.levels[args.level] = args.daily_salary; await storage.setData('salaryConfig', config);
    return { success: true, result: { message: `${args.level} 级别默认日薪已设为 ${args.daily_salary}`, config: config.levels } };
  }

  private async _pay_bonus(args: any) {
    const usage = await storage.getTokenUsage();
    usage.bonuses = usage.bonuses || [];
    usage.bonuses.push({ agentId: args.agent_id, amount: args.amount, reason: args.reason, date: new Date().toISOString() });
    await storage.setTokenUsage(usage);
    const agents = await storage.getAgents();
    const agent = agents.find((a: any) => a.id === args.agent_id);
    return { success: true, result: { message: `已向 ${agent?.name || args.agent_id} 发放 ${args.amount} 奖金。原因: ${args.reason}` } };
  }

  private async _view_salary_config() {
    const config = await storage.getData<any>('salaryConfig') || { levels: { intern: 50, junior: 80, staff: 100, mid: 130, senior: 180, lead: 220, manager: 280, director: 350, vp: 450, c_level: 500 } };
    const agents = await storage.getAgents();
    const salaries = agents.filter((a: any) => a.status === 'active').map((a: any) => ({ id: a.id, name: a.name, level: a.level, dailySalary: a.salary?.dailySalary || config.levels[a.level] || 100 }));
    return { success: true, result: { levelStandards: config.levels, agentSalaries: salaries } };
  }

  // ─── 运营工具 ──────────────────────────────

  private async _ops_create_task(args: any, ctx: any) {
    const ops = await storage.getOperations();
    const task = { id: `task-${Date.now()}`, title: args.title, description: args.description || '', assignee: args.assignee_id || '', priority: args.priority || 'medium', status: 'pending', createdBy: ctx.agentId, dueDate: args.due_date, createdAt: new Date().toISOString() };
    (ops.tasks = ops.tasks || []).push(task); await storage.setOperations(ops);
    return { success: true, result: { message: `任务「${args.title}」已创建`, task } };
  }

  private async _ops_update_task(args: any) {
    const ops = await storage.getOperations();
    const task = (ops.tasks || []).find((t: any) => t.id === args.task_id);
    if (!task) return { success: false, error: '任务不存在' };
    if (args.status) task.status = args.status; if (args.priority) task.priority = args.priority;
    task.updatedAt = new Date().toISOString(); await storage.setOperations(ops);
    return { success: true, result: { message: '任务已更新', task } };
  }

  private async _ops_list_tasks(args: any) {
    const ops = await storage.getOperations();
    let tasks = ops.tasks || [];
    if (args.status && args.status !== 'all') tasks = tasks.filter((t: any) => t.status === args.status);
    if (args.assignee_id) tasks = tasks.filter((t: any) => t.assignee === args.assignee_id);
    return { success: true, result: { tasks, count: tasks.length } };
  }

  private async _ops_create_goal(args: any, ctx: any) {
    const ops = await storage.getOperations();
    const goal = { id: `goal-${Date.now()}`, title: args.title, description: args.description || '', type: args.type || 'objective', status: 'active', createdBy: ctx.agentId, dueDate: args.due_date, createdAt: new Date().toISOString() };
    (ops.goals = ops.goals || []).push(goal); await storage.setOperations(ops);
    return { success: true, result: { message: `目标「${args.title}」已创建`, goal } };
  }

  private async _ops_list_goals(args: any) {
    const ops = await storage.getOperations();
    let goals = ops.goals || [];
    if (args.status && args.status !== 'all') goals = goals.filter((g: any) => g.status === args.status);
    return { success: true, result: { goals, count: goals.length } };
  }

  private async _ops_dashboard() {
    const ops = await storage.getOperations();
    const tasks = ops.tasks || []; const goals = ops.goals || [];
    return { success: true, result: { tasks: { total: tasks.length, pending: tasks.filter((t: any) => t.status === 'pending').length, inProgress: tasks.filter((t: any) => t.status === 'in_progress').length, completed: tasks.filter((t: any) => t.status === 'completed').length }, goals: { total: goals.length, active: goals.filter((g: any) => g.status === 'active').length, completed: goals.filter((g: any) => g.status === 'completed').length } } };
  }
}

export const toolExecutor = new ToolExecutor();
export const tools = [...COMMON_TOOLS, ...HR_TOOLS, ...CFO_TOOLS, ...RECRUIT_TOOLS, ...OPS_TOOLS].map(strip);
