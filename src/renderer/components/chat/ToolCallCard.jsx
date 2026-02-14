/**
 * SoloForge - 工具调用可视化卡片组件
 * 显示 Agent 执行工具的状态、参数和结果，支持折叠展开
 * @module components/chat/ToolCallCard
 */

import { useState } from 'react';
import {
  DocumentTextIcon,
  CommandLineIcon,
  CodeBracketIcon,
  GlobeAltIcon,
  ChatBubbleLeftRightIcon,
  UserGroupIcon,
  ChartBarIcon,
  ClipboardDocumentListIcon,
  CircleStackIcon,
  CurrencyDollarIcon,
  CalculatorIcon,
  WrenchScrewdriverIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

// ─────────────────────────────────────────────────────────
// 工具元数据映射
// ─────────────────────────────────────────────────────────

/** 工具分类 → 图标 映射 */
const CATEGORY_ICON_MAP = {
  file: DocumentTextIcon,
  shell: CommandLineIcon,
  git: CodeBracketIcon,
  network: GlobeAltIcon,
  collaboration: ChatBubbleLeftRightIcon,
  hr: UserGroupIcon,
  operations: ChartBarIcon,
  pm: ClipboardDocumentListIcon,
  memory: CircleStackIcon,
  cfo: CurrencyDollarIcon,
  math: CalculatorIcon,
};

/** 工具名 → 中文友好名 + 分类 */
const TOOL_META = {
  // 文件
  read_file:    { label: '读取文件', category: 'file' },
  write_file:   { label: '写入文件', category: 'file' },
  list_files:   { label: '列出文件', category: 'file' },
  // Shell
  shell:        { label: '执行命令', category: 'shell' },
  // Git
  git_status:   { label: 'Git 状态', category: 'git' },
  git_commit:   { label: 'Git 提交', category: 'git' },
  git_create_pr: { label: '创建 PR', category: 'git' },
  git_review_pr: { label: '审核 PR', category: 'git' },
  git_merge:    { label: '合并分支', category: 'git' },
  git_branch:   { label: '切换分支', category: 'git' },
  git_list_branches: { label: '分支列表', category: 'git' },
  git_log:      { label: 'Git 日志', category: 'git' },
  git_init:     { label: '初始化仓库', category: 'git' },
  git_list_prs: { label: 'PR 列表', category: 'git' },
  git_pr_diff:  { label: 'PR 差异', category: 'git' },
  git_close_pr: { label: '关闭 PR', category: 'git' },
  // 网络
  web_search:   { label: '网络搜索', category: 'network' },
  fetch_webpage: { label: '抓取网页', category: 'network' },
  // 协作
  send_to_agent: { label: '发送消息', category: 'collaboration' },
  delegate_task: { label: '委派任务', category: 'collaboration' },
  my_tasks:     { label: '我的任务', category: 'collaboration' },
  communication_history: { label: '沟通记录', category: 'collaboration' },
  browse_communication_history: { label: '浏览沟通记录', category: 'collaboration' },
  communication_info: { label: '沟通详情', category: 'collaboration' },
  list_colleagues: { label: '同事列表', category: 'collaboration' },
  collaboration_stats: { label: '协作统计', category: 'collaboration' },
  notify_boss:  { label: '通知老板', category: 'collaboration' },
  submit_dev_plan: { label: '提交开发计划', category: 'collaboration' },
  approve_dev_plan: { label: '批准开发计划', category: 'collaboration' },
  reject_dev_plan: { label: '驳回开发计划', category: 'collaboration' },
  create_group_chat: { label: '创建群聊', category: 'collaboration' },
  suspend_subordinate: { label: '停职下属', category: 'collaboration' },
  reinstate_subordinate: { label: '复职下属', category: 'collaboration' },
  cancel_delegated_task: { label: '取消委派', category: 'collaboration' },
  // HR
  hr_list_agents: { label: '员工列表', category: 'hr' },
  hr_update_agent: { label: '更新员工', category: 'hr' },
  agent_requests: { label: '员工申请', category: 'hr' },
  hr_question:  { label: 'HR 咨询', category: 'hr' },
  agent_approve: { label: '审批通过', category: 'hr' },
  hr_org_chart: { label: '组织架构', category: 'hr' },
  hr_dismiss_request: { label: '解雇申请', category: 'hr' },
  dismiss_confirm: { label: '确认解雇', category: 'hr' },
  hr_suspend_agent: { label: '停职员工', category: 'hr' },
  hr_reinstate_agent: { label: '复职员工', category: 'hr' },
  hr_performance_review: { label: '绩效评估', category: 'hr' },
  hr_team_analytics: { label: '团队分析', category: 'hr' },
  hr_promote_agent: { label: '晋升员工', category: 'hr' },
  hr_demote_agent: { label: '降级员工', category: 'hr' },
  hr_end_probation: { label: '结束试用期', category: 'hr' },
  hr_onboarding_status: { label: '入职状态', category: 'hr' },
  // 招聘
  recruit_request: { label: '招聘申请', category: 'hr' },
  recruit_respond: { label: '招聘回复', category: 'hr' },
  recruit_my_requests: { label: '我的招聘', category: 'hr' },
  // 运营
  ops_create_goal: { label: '创建目标', category: 'operations' },
  ops_update_goal: { label: '更新目标', category: 'operations' },
  ops_list_goals: { label: '目标列表', category: 'operations' },
  ops_create_kpi: { label: '创建 KPI', category: 'operations' },
  ops_update_kpi: { label: '更新 KPI', category: 'operations' },
  ops_list_kpis: { label: 'KPI 列表', category: 'operations' },
  ops_create_task: { label: '创建任务', category: 'operations' },
  ops_update_task: { label: '更新任务', category: 'operations' },
  ops_list_tasks: { label: '任务列表', category: 'operations' },
  ops_dashboard: { label: '运营仪表盘', category: 'operations' },
  ops_activity_log: { label: '活动日志', category: 'operations' },
  ops_claim_task: { label: '认领任务', category: 'operations' },
  ops_report_progress: { label: '汇报进度', category: 'operations' },
  ops_my_tasks:  { label: '我的任务', category: 'operations' },
  // 项目管理
  pm_create_project: { label: '创建项目', category: 'pm' },
  pm_add_milestone: { label: '添加里程碑', category: 'pm' },
  pm_add_tasks: { label: '添加任务', category: 'pm' },
  pm_start_project: { label: '启动项目', category: 'pm' },
  pm_assign_task: { label: '分配任务', category: 'pm' },
  pm_list_projects: { label: '项目列表', category: 'pm' },
  pm_project_detail: { label: '项目详情', category: 'pm' },
  pm_update_task: { label: '更新任务', category: 'pm' },
  pm_status_report: { label: '状态报告', category: 'pm' },
  pm_delete_project: { label: '删除项目', category: 'pm' },
  // 记忆
  memory_recall: { label: '回忆', category: 'memory' },
  memory_store:  { label: '存储记忆', category: 'memory' },
  memory_search: { label: '搜索记忆', category: 'memory' },
  memory_list_recent: { label: '最近记忆', category: 'memory' },
  memory_company_facts: { label: '公司信息', category: 'memory' },
  memory_user_profile: { label: '用户档案', category: 'memory' },
  memory_project_context: { label: '项目上下文', category: 'memory' },
  // 财务
  token_stats:   { label: 'Token 统计', category: 'cfo' },
  token_set_budget: { label: '设置预算', category: 'cfo' },
  // 计算
  calculator:    { label: '计算', category: 'math' },
  // 报告
  create_report: { label: '创建报告', category: 'pm' },
  list_reports:  { label: '报告列表', category: 'pm' },
  // 历史
  load_history:  { label: '加载历史', category: 'memory' },
  history_info:  { label: '历史信息', category: 'memory' },
};

/**
 * 获取工具的元信息（中文名、图标）
 */
function getToolMeta(toolName) {
  const meta = TOOL_META[toolName];
  if (meta) {
    return {
      label: meta.label,
      Icon: CATEGORY_ICON_MAP[meta.category] || WrenchScrewdriverIcon,
      category: meta.category,
    };
  }
  // 未知工具的回退处理
  return {
    label: toolName,
    Icon: WrenchScrewdriverIcon,
    category: 'unknown',
  };
}

/**
 * 提取关键参数用于简要展示
 */
function getArgsSummary(toolName, args) {
  if (!args || Object.keys(args).length === 0) return null;

  // 优先展示的关键参数
  const KEY_PARAMS = ['path', 'command', 'query', 'search_query', 'url', 'message', 'content', 'target_agent', 'branch_name', 'commit_message', 'name', 'title', 'expression'];

  for (const key of KEY_PARAMS) {
    if (args[key]) {
      let val = String(args[key]);
      if (val.length > 80) val = val.slice(0, 77) + '...';
      return val;
    }
  }

  // 如果没有关键参数，取第一个参数
  const firstKey = Object.keys(args)[0];
  if (firstKey) {
    let val = String(args[firstKey]);
    if (val.length > 80) val = val.slice(0, 77) + '...';
    return `${firstKey}: ${val}`;
  }

  return null;
}

/**
 * 智能格式化工具结果：针对不同工具类型返回人类友好的展示
 * @param {string} toolName - 工具名称
 * @param {string} rawResult - 原始结果字符串（通常是 JSON）
 * @returns {{ summary: string, detail: string|null }} summary 是简短摘要，detail 是完整内容
 */
function formatToolResult(toolName, rawResult) {
  if (!rawResult) return { summary: '', detail: null };

  // 支持对象和字符串两种输入
  let parsed = null;
  if (typeof rawResult === 'object' && rawResult !== null) {
    // 从后端直接传来的对象
    parsed = rawResult;
  } else {
    // 尝试解析 JSON 字符串
    try {
      parsed = JSON.parse(rawResult);
    } catch {
      // 非 JSON（可能是截断的 JSON 或纯文本）
      const str = String(rawResult);
      return { summary: str.length > 200 ? str.slice(0, 200) + '...' : str, detail: str.length > 200 ? str : null };
    }
  }

  // 如果解析后仍是字符串（比如双重 JSON.stringify），再尝试一次
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { /* keep as is */ }
  }

  // ── 协作工具 ──────────────────────────────────────

  // send_to_agent: 显示对方回复
  if (toolName === 'send_to_agent' && parsed.response) {
    const from = parsed.from || '对方';
    const response = String(parsed.response).trim();
    return {
      summary: `${from} 回复：${response.length > 120 ? response.slice(0, 120) + '...' : response}`,
      detail: response.length > 120 ? response : null,
    };
  }

  // delegate_task: 委派结果
  if (toolName === 'delegate_task') {
    if (parsed.result) {
      const result = String(parsed.result).trim();
      return {
        summary: `任务结果：${result.length > 120 ? result.slice(0, 120) + '...' : result}`,
        detail: result.length > 120 ? result : null,
      };
    }
    if (parsed.message) return { summary: parsed.message, detail: null };
  }

  // notify_boss: 通知结果
  if (toolName === 'notify_boss' && parsed.message) {
    return { summary: parsed.message, detail: null };
  }

  // create_group_chat: 群聊创建结果
  if (toolName === 'create_group_chat') {
    if (parsed.name) return { summary: `已创建群聊「${parsed.name}」`, detail: null };
    if (parsed.message) return { summary: parsed.message, detail: null };
  }

  // list_colleagues: 同事列表
  if (toolName === 'list_colleagues') {
    const colleagues = Array.isArray(parsed) ? parsed : (parsed.colleagues || parsed.agents || []);
    if (colleagues.length > 0) {
      const lines = colleagues.map((a) => {
        const name = a.name || a.id;
        const title = a.title || a.role || '';
        const dept = a.department || '';
        const status = a.status === '停职' ? ' [停职]' : a.status === '离职' ? ' [离职]' : '';
        return `• ${name}${title ? ` — ${title}` : ''}${dept ? `（${dept}）` : ''}${status}`;
      });
      const total = parsed.total || colleagues.length;
      const active = parsed.activeCount || colleagues.filter((c) => c.status === '在职').length;
      return { summary: `共 ${total} 位同事（${active} 人在职）`, detail: lines.join('\n') };
    }
    if (parsed.tip) return { summary: parsed.tip, detail: null };
    if (parsed.message) return { summary: parsed.message, detail: null };
  }

  // ── HR 工具 ──────────────────────────────────────

  // hr_list_agents: 员工列表
  if (toolName === 'hr_list_agents') {
    const agents = parsed.agents || [];
    if (agents.length > 0) {
      const lines = agents.map((a) => {
        const name = a.name || a.id;
        const title = a.title || '';
        const dept = a.department || '';
        const level = a.level || '';
        const status = a.status === 'suspended' ? ' [停职]' : a.status === 'terminated' ? ' [离职]' : '';
        return `• ${name}${title ? ` — ${title}` : ''}${dept ? `（${dept}）` : ''}${level ? ` ${level}` : ''}${status}`;
      });
      const counts = parsed.statusCounts || {};
      const summary = `共 ${parsed.totalCount || agents.length} 人（${counts.active || 0} 在职${counts.suspended ? `、${counts.suspended} 停职` : ''}${counts.terminated ? `、${counts.terminated} 离职` : ''}）`;
      return { summary, detail: lines.join('\n') };
    }
    if (parsed.message) return { summary: parsed.message, detail: null };
  }

  // hr_org_chart: 组织架构
  if (toolName === 'hr_org_chart') {
    const depts = parsed.departments || [];
    if (depts.length > 0) {
      const stats = parsed.stats || {};
      const lines = depts.map((d) => {
        const members = (d.members || [])
          .map((m) => `  ${m.name || m.id}${m.title ? `（${m.title}）` : ''}`)
          .join('\n');
        return `📁 ${d.name || d.id}${d.head ? ` — 负责人: ${d.head}` : ''}\n${members || '  （无成员）'}`;
      });
      return {
        summary: `组织架构：${stats.departmentCount || depts.length} 个部门，${stats.totalMembers || '?'} 人`,
        detail: lines.join('\n\n'),
      };
    }
    if (parsed.message) return { summary: parsed.message, detail: null };
  }

  // 通用 HR 工具回退
  if (toolName.startsWith('hr_') || toolName === 'recruit_request' || toolName === 'recruit_respond') {
    if (parsed.message) return { summary: parsed.message, detail: null };
  }

  // ── 网络搜索 ──────────────────────────────────────

  if (toolName === 'web_search') {
    // 搜索失败
    if (parsed.error && (!parsed.results || parsed.results.length === 0)) {
      return {
        summary: `搜索「${parsed.query || ''}」失败，所有搜索引擎暂时不可用`,
        detail: null,
      };
    }
    // 搜索成功
    if (parsed.results && parsed.results.length > 0) {
      const lines = parsed.results.map((r, i) => {
        const title = r.title || '(无标题)';
        const snippet = r.snippet ? `\n   ${r.snippet.slice(0, 120)}${r.snippet.length > 120 ? '...' : ''}` : '';
        const url = r.url ? `\n   🔗 ${r.url}` : '';
        return `${i + 1}. ${title}${snippet}${url}`;
      });
      const summary = `找到 ${parsed.results.length} 条结果（${parsed.provider || '搜索引擎'}）`;
      return {
        summary,
        detail: lines.join('\n\n'),
      };
    }
    return { summary: `搜索「${parsed.query || ''}」无结果`, detail: null };
  }

  // ── 网页抓取 ──────────────────────────────────────

  if (toolName === 'web_fetch' || toolName === 'fetch_webpage') {
    if (parsed.error) {
      return { summary: `网页抓取失败: ${parsed.error.slice(0, 80)}`, detail: null };
    }
    if (parsed.content) {
      const content = String(parsed.content);
      const range = parsed.currentRange
        ? `（第 ${parsed.currentRange.start}-${parsed.currentRange.end} 行，共 ${parsed.totalLines} 行）`
        : '';
      return {
        summary: `已获取网页内容${range}`,
        detail: content.length > 200 ? content : null,
      };
    }
    if (parsed.message) return { summary: parsed.message, detail: null };
  }

  // ── 文件工具 ──────────────────────────────────────

  if (toolName === 'read_file' && typeof parsed === 'string') {
    return { summary: `文件内容（${parsed.length} 字符）`, detail: parsed };
  }
  if (toolName === 'write_file' && parsed.message) {
    return { summary: parsed.message, detail: null };
  }
  if (toolName === 'list_files' && Array.isArray(parsed)) {
    return { summary: `${parsed.length} 个文件/目录`, detail: parsed.join('\n') };
  }

  // ── Shell ──────────────────────────────────────

  if (toolName === 'shell') {
    const output = parsed.stdout || parsed.output || '';
    const code = parsed.exitCode ?? parsed.code;
    const prefix = code === 0 ? '执行成功' : `退出码 ${code}`;
    if (output) {
      const trimmed = output.trim();
      return { summary: `${prefix}${trimmed ? ` — ${trimmed.slice(0, 100)}${trimmed.length > 100 ? '...' : ''}` : ''}`, detail: trimmed.length > 100 ? trimmed : null };
    }
    return { summary: prefix, detail: null };
  }

  // ── Git ──────────────────────────────────────

  if (toolName.startsWith('git_') && parsed.message) {
    return { summary: parsed.message, detail: null };
  }

  // ── TODO 工具 ──────────────────────────────────────

  if (toolName.startsWith('todo_')) {
    if (parsed.message) return { summary: parsed.message, detail: null };
    if (parsed.formatted) return { summary: parsed.summary || '待办列表', detail: parsed.formatted };
  }

  // ── 记忆工具 ──────────────────────────────────────

  if (toolName.startsWith('memory_')) {
    if (parsed.message) return { summary: parsed.message, detail: null };
    if (parsed.memories && Array.isArray(parsed.memories)) {
      return {
        summary: `找到 ${parsed.memories.length} 条相关记忆`,
        detail: parsed.memories.map((m) => `• ${m.summary || m.content || ''}`).join('\n'),
      };
    }
  }

  // ── CFO / Token 工具 ──────────────────────────────────

  if (toolName === 'token_stats') {
    const period = parsed.period || 'today';
    const periodLabel = { today: '今日', week: '本周', month: '本月', all: '全部' }[period] || period;
    const g = parsed.global || {};
    const agents = parsed.agents || [];
    const tokens = g.totalTokens ?? 0;
    const requests = g.totalRequests ?? 0;
    const dailyLimit = g.globalDailyLimit;
    const usagePct = g.dailyUsagePercent ?? 0;

    const lines = [];
    lines.push(`📊 ${periodLabel}统计`);
    lines.push(`  Token 用量: ${tokens.toLocaleString()}${dailyLimit ? ` / ${dailyLimit.toLocaleString()}` : ''}`);
    lines.push(`  API 调用: ${requests} 次`);
    if (dailyLimit) lines.push(`  使用率: ${usagePct}%`);
    if (agents.length > 0) {
      lines.push('');
      lines.push('各 Agent 用量:');
      agents.forEach((a) => {
        const name = a.agentName || a.agentId || '?';
        const t = (a.totalTokens ?? 0).toLocaleString();
        const r = a.totalRequests ?? 0;
        const pct = a.budgetUsagePercent != null ? ` (${a.budgetUsagePercent}%)` : '';
        lines.push(`  • ${name}: ${t} tokens / ${r} 次${pct}`);
      });
    }
    return {
      summary: `${periodLabel}: ${tokens.toLocaleString()} tokens / ${requests} 次调用${dailyLimit ? ` (${usagePct}%)` : ''}`,
      detail: lines.join('\n'),
    };
  }

  if (toolName === 'token_set_budget') {
    if (parsed.success) {
      const type = parsed.type === 'agent' ? `Agent ${parsed.agentId}` : '全局';
      const b = parsed.budget || {};
      const limit = b.globalDailyLimit || b.dailyLimit;
      return { summary: `${type}预算已更新${limit ? `（日限额 ${limit.toLocaleString()}）` : ''}`, detail: null };
    }
  }

  // ── 运营工具 ──────────────────────────────────────

  if (toolName === 'ops_dashboard') {
    const s = parsed.summary || {};
    const goals = s.goals || {};
    const tasks = s.tasks || {};
    const kpis = s.kpis || {};
    const lines = [];
    if (goals.total != null) lines.push(`📊 目标: ${goals.total} 个（进度 ${goals.avgProgress ?? 0}%）${goals.progressBar ? ` ${goals.progressBar}` : ''}`);
    if (tasks.total != null) {
      const parts = [];
      if (tasks.todo) parts.push(`${tasks.todo} 待办`);
      if (tasks.in_progress) parts.push(`${tasks.in_progress} 进行中`);
      if (tasks.done) parts.push(`${tasks.done} 已完成`);
      lines.push(`📋 任务: ${tasks.total} 个${parts.length ? `（${parts.join('、')}）` : ''}`);
    }
    if (kpis.total != null) lines.push(`📈 KPI: ${kpis.total} 个`);
    const activity = parsed.recentActivity || [];
    if (activity.length > 0) {
      lines.push('');
      lines.push('最近动态:');
      activity.slice(0, 5).forEach((a) => {
        lines.push(`  • ${a.actor || '?'}: ${a.action || '?'}${a.time ? ` (${a.time})` : ''}`);
      });
    }
    return {
      summary: `目标 ${goals.total || 0} | 任务 ${tasks.total || 0} | KPI ${kpis.total || 0}`,
      detail: lines.length > 0 ? lines.join('\n') : null,
    };
  }

  if (toolName === 'ops_list_tasks') {
    const tasks = parsed.tasks || [];
    if (tasks.length > 0) {
      const lines = tasks.map((t) => {
        const status = { todo: '⬜', in_progress: '🔄', done: '✅', blocked: '🚫' }[t.status] || '❓';
        return `${status} ${t.title || t.name || t.id}${t.assignee ? ` → ${t.assignee}` : ''}`;
      });
      return { summary: `${tasks.length} 个任务`, detail: lines.join('\n') };
    }
  }

  if (toolName === 'ops_list_goals') {
    const goals = parsed.goals || [];
    if (goals.length > 0) {
      const lines = goals.map((g) => `• ${g.title || g.name || g.id} — 进度 ${g.progress ?? 0}%`);
      return { summary: `${goals.length} 个目标`, detail: lines.join('\n') };
    }
  }

  if (toolName === 'ops_activity_log') {
    const logs = parsed.logs || [];
    if (logs.length > 0) {
      const lines = logs.map((l) => `• ${l.actor || '?'}: ${l.action || '?'} (${l.time || '?'})`);
      return { summary: `${logs.length} 条活动记录`, detail: lines.join('\n') };
    }
  }

  if (toolName.startsWith('ops_')) {
    if (parsed.message) return { summary: parsed.message, detail: null };
  }

  // ── 通用回退 ──────────────────────────────────

  // 有 message 字段的结果
  if (parsed.message) {
    return { summary: parsed.message, detail: null };
  }

  // 有 success 字段的结果
  if (typeof parsed.success === 'boolean') {
    const msg = parsed.success ? '操作成功' : '操作失败';
    // 尝试找到有意义的文本字段
    const textField = parsed.response || parsed.result || parsed.content || parsed.data;
    if (textField && typeof textField === 'string') {
      const trimmed = textField.trim();
      return { summary: `${msg} — ${trimmed.slice(0, 120)}${trimmed.length > 120 ? '...' : ''}`, detail: trimmed.length > 120 ? trimmed : null };
    }
    // 有 success 但无文本字段 - 尝试提取关键数字信息
    const keys = Object.keys(parsed).filter((k) => k !== 'success');
    if (keys.length <= 3) {
      const parts = keys.map((k) => {
        const v = parsed[k];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
        return null;
      }).filter(Boolean);
      if (parts.length > 0) return { summary: `${msg}（${parts.join('，')}）`, detail: null };
    }
    return { summary: msg, detail: null };
  }

  // 完全回退：简要描述而非完整 JSON
  if (parsed.message || parsed.text || parsed.description) {
    return { summary: parsed.message || parsed.text || parsed.description, detail: null };
  }
  const keys = Object.keys(parsed);
  if (keys.length <= 5) {
    const parts = keys.map((k) => {
      const v = parsed[k];
      if (v == null) return null;
      if (typeof v === 'string') return `${k}: ${v.length > 50 ? v.slice(0, 50) + '...' : v}`;
      if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
      if (Array.isArray(v)) return `${k}: ${v.length} 项`;
      return `${k}: [对象]`;
    }).filter(Boolean);
    return { summary: parts.join(' | '), detail: null };
  }
  return { summary: `返回 ${keys.length} 个字段`, detail: null };
}

/**
 * 格式化耗时
 */
function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// ─────────────────────────────────────────────────────────
// ToolCallCard 组件
// ─────────────────────────────────────────────────────────

/**
 * 工具调用可视化卡片
 *
 * @param {Object} props
 * @param {Object} props.toolCall - 工具调用数据
 * @param {string} props.toolCall.id
 * @param {string} props.toolCall.name
 * @param {Object} props.toolCall.args
 * @param {'running'|'success'|'error'} props.toolCall.status
 * @param {string|null} props.toolCall.result
 * @param {string|null} props.toolCall.error
 * @param {number|null} props.toolCall.duration
 */
export default function ToolCallCard({ toolCall }) {
  const [expanded, setExpanded] = useState(false);
  const { label, Icon } = getToolMeta(toolCall.name);
  const argsSummary = getArgsSummary(toolCall.name, toolCall.args);
  const isRunning = toolCall.status === 'running';
  const isSuccess = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const hasResult = isSuccess && toolCall.result;
  const hasError = isError && toolCall.error;

  return (
    <div
      className={`
        relative rounded-lg border text-xs overflow-hidden transition-all duration-300
        ${isRunning
          ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5'
          : isError
            ? 'border-red-400/30 bg-red-500/5'
            : 'border-[var(--border-color)] bg-black/[0.03] dark:bg-white/[0.03]'
        }
      `}
    >
      {/* 头部：图标 + 工具名 + 状态 */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* 工具图标 */}
        <div className={`shrink-0 ${isRunning ? 'animate-pulse' : ''}`}>
          <Icon className={`w-4 h-4 ${
            isRunning
              ? 'text-[var(--color-primary)]'
              : isError
                ? 'text-red-500'
                : 'text-text-secondary'
          }`} />
        </div>

        {/* 工具名 */}
        <span className={`font-medium ${
          isRunning ? 'text-[var(--color-primary)]' : 'text-text-primary'
        }`}>
          {label}
        </span>

        {/* 弹性占位 */}
        <div className="flex-1" />

        {/* 状态指示 */}
        {isRunning && (
          <span className="flex items-center gap-1 text-[var(--color-primary)]">
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            <span className="ml-0.5">执行中</span>
          </span>
        )}
        {isSuccess && (
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <CheckCircleIcon className="w-3.5 h-3.5" />
            {toolCall.duration != null && (
              <span className="text-text-secondary">{formatDuration(toolCall.duration)}</span>
            )}
          </span>
        )}
        {isError && (
          <span className="flex items-center gap-1 text-red-500">
            <XCircleIcon className="w-3.5 h-3.5" />
            {toolCall.duration != null && (
              <span className="text-text-secondary">{formatDuration(toolCall.duration)}</span>
            )}
          </span>
        )}
      </div>

      {/* 参数摘要 */}
      {argsSummary && (
        <div className="px-3 pb-2 -mt-0.5">
          <span className="text-text-secondary font-mono text-[11px] break-all line-clamp-1">
            {argsSummary}
          </span>
        </div>
      )}

      {/* 成功结果：智能格式化展示 */}
      {hasResult && (() => {
        const { summary, detail } = formatToolResult(toolCall.name, toolCall.result);
        return (
          <>
            {/* 结果摘要（始终显示） */}
            <div className="border-t border-[var(--border-color)]">
              <div className="px-3 py-2 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words select-text">
                {summary}
              </div>
            </div>

            {/* 完整内容（可折叠，仅当 detail 存在时） */}
            {detail && (
              <>
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="w-full flex items-center gap-1.5 px-3 py-1 text-text-secondary/70 hover:text-text-primary hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors border-t border-[var(--border-color)]"
                >
                  {expanded ? (
                    <ChevronDownIcon className="w-3 h-3" />
                  ) : (
                    <ChevronRightIcon className="w-3 h-3" />
                  )}
                  <span className="text-[10px]">{expanded ? '收起详情' : '展开详情'}</span>
                </button>

                {expanded && (
                  <div className="border-t border-[var(--border-color)]">
                    <div className="max-h-[200px] overflow-auto">
                      <pre className="px-3 py-2 text-[11px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-all select-text">
                        {detail}
                      </pre>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        );
      })()}

      {/* 错误信息：过滤掉内部参数提示，仅显示面向用户的部分 */}
      {hasError && (() => {
        // 去掉追加的参数提示（【工具 xxx 正确参数】... 请使用上述参数名重新调用。）
        const cleanError = toolCall.error
          .replace(/\n?\n?【工具\s+\S+\s+正确参数】[\s\S]*$/, '')
          .replace(/\n?\n?【工具\s+\S+】无需参数。[\s\S]*$/, '')
          .trim();
        return (
          <>
            <div className="border-t border-red-400/20" />
            <div className="px-3 py-1.5 text-red-600 dark:text-red-400 text-[11px] break-all line-clamp-3">
              {cleanError || '执行失败'}
            </div>
          </>
        );
      })()}

      {/* 运行中的流光动画效果 */}
      {isRunning && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-transparent via-[var(--color-primary)] to-transparent animate-shimmer" />
        </div>
      )}
    </div>
  );
}
