/**
 * SoloForge - 工具结果格式化器（映射表驱动）
 *
 * 将原 ToolCallCard.jsx 中 formatToolResult 的 500 行硬编码 if-else 链拆成：
 *   - 精确匹配表 TOOL_FORMATTERS（toolName → formatter fn）
 *   - 前缀匹配表 PREFIX_FORMATTERS（按顺序求值，第一个非 null 结果生效）
 *   - 通用回退 formatFallback
 *
 * 新增工具只需在 TOOL_FORMATTERS / PREFIX_FORMATTERS 增加一项，无需改 if-else。
 * 输出与原实现逐分支等价。
 * @module components/chat/tool-result-formatters
 */

// ─────────────────────────────────────────────────────────
// 协作工具
// ─────────────────────────────────────────────────────────

// send_to_agent: 显示对方回复
function formatSendToAgent(toolName, parsed) {
  if (parsed.response) {
    const from = parsed.from || '对方';
    const response = String(parsed.response).trim();
    return {
      summary: `${from} 回复：${response.length > 120 ? response.slice(0, 120) + '...' : response}`,
      detail: response.length > 120 ? response : null,
    };
  }
  return null;
}

// delegate_task: 委派结果
function formatDelegateTask(toolName, parsed) {
  if (parsed.result) {
    const result = String(parsed.result).trim();
    return {
      summary: `任务结果：${result.length > 120 ? result.slice(0, 120) + '...' : result}`,
      detail: result.length > 120 ? result : null,
    };
  }
  if (parsed.message) return { summary: parsed.message, detail: null };
  return null;
}

// notify_boss: 通知结果
function formatNotifyBoss(toolName, parsed) {
  if (parsed.message) return { summary: parsed.message, detail: null };
  return null;
}

// create_group_chat: 群聊创建结果
function formatCreateGroupChat(toolName, parsed) {
  if (parsed.name) return { summary: `已创建群聊「${parsed.name}」`, detail: null };
  if (parsed.message) return { summary: parsed.message, detail: null };
  return null;
}

// list_colleagues: 同事列表
function formatListColleagues(toolName, parsed) {
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
  return null;
}

// ─────────────────────────────────────────────────────────
// HR 工具
// ─────────────────────────────────────────────────────────

// hr_list_agents: 员工列表
function formatHrListAgents(toolName, parsed) {
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
  return null;
}

// hr_org_chart: 组织架构
function formatHrOrgChart(toolName, parsed) {
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
  return null;
}

// 通用 HR 工具回退（hr_* 或 recruit_request / recruit_respond）
function formatHrPrefix(toolName, parsed) {
  if (parsed.message) return { summary: parsed.message, detail: null };
  return null;
}

// ─────────────────────────────────────────────────────────
// 网络工具
// ─────────────────────────────────────────────────────────

// web_search
function formatWebSearch(toolName, parsed) {
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

// web_fetch / fetch_webpage
function formatWebFetch(toolName, parsed) {
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
  return null;
}

// ─────────────────────────────────────────────────────────
// 文件工具
// ─────────────────────────────────────────────────────────

function formatReadFile(toolName, parsed) {
  if (typeof parsed === 'string') {
    return { summary: `文件内容（${parsed.length} 字符）`, detail: parsed };
  }
  return null;
}

function formatWriteFile(toolName, parsed) {
  if (parsed.message) {
    return { summary: parsed.message, detail: null };
  }
  return null;
}

function formatListFiles(toolName, parsed) {
  if (Array.isArray(parsed)) {
    return { summary: `${parsed.length} 个文件/目录`, detail: parsed.join('\n') };
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// Shell
// ─────────────────────────────────────────────────────────

function formatShell(toolName, parsed) {
  const output = parsed.stdout || parsed.output || '';
  const code = parsed.exitCode ?? parsed.code;
  const prefix = code === 0 ? '执行成功' : `退出码 ${code}`;
  if (output) {
    const trimmed = output.trim();
    return { summary: `${prefix}${trimmed ? ` — ${trimmed.slice(0, 100)}${trimmed.length > 100 ? '...' : ''}` : ''}`, detail: trimmed.length > 100 ? trimmed : null };
  }
  return { summary: prefix, detail: null };
}

// ─────────────────────────────────────────────────────────
// Git（前缀匹配）
// ─────────────────────────────────────────────────────────

function formatGitPrefix(toolName, parsed) {
  if (parsed.message) return { summary: parsed.message, detail: null };
  return null;
}

// ─────────────────────────────────────────────────────────
// TODO（前缀匹配）
// ─────────────────────────────────────────────────────────

function formatTodoPrefix(toolName, parsed) {
  if (parsed.message) return { summary: parsed.message, detail: null };
  if (parsed.formatted) return { summary: parsed.summary || '待办列表', detail: parsed.formatted };
  return null;
}

// ─────────────────────────────────────────────────────────
// 记忆（前缀匹配）
// ─────────────────────────────────────────────────────────

function formatMemoryPrefix(toolName, parsed) {
  if (parsed.message) return { summary: parsed.message, detail: null };
  if (parsed.memories && Array.isArray(parsed.memories)) {
    return {
      summary: `找到 ${parsed.memories.length} 条相关记忆`,
      detail: parsed.memories.map((m) => `• ${m.summary || m.content || ''}`).join('\n'),
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// CFO / Token
// ─────────────────────────────────────────────────────────

function formatTokenStats(toolName, parsed) {
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

function formatTokenSetBudget(toolName, parsed) {
  if (parsed.success) {
    const type = parsed.type === 'agent' ? `Agent ${parsed.agentId}` : '全局';
    const b = parsed.budget || {};
    const limit = b.globalDailyLimit || b.dailyLimit;
    return { summary: `${type}预算已更新${limit ? `（日限额 ${limit.toLocaleString()}）` : ''}`, detail: null };
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// 运营工具
// ─────────────────────────────────────────────────────────

function formatOpsDashboard(toolName, parsed) {
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

function formatOpsListTasks(toolName, parsed) {
  const tasks = parsed.tasks || [];
  if (tasks.length > 0) {
    const lines = tasks.map((t) => {
      const status = { todo: '⬜', in_progress: '🔄', done: '✅', blocked: '🚫' }[t.status] || '❓';
      return `${status} ${t.title || t.name || t.id}${t.assignee ? ` → ${t.assignee}` : ''}`;
    });
    return { summary: `${tasks.length} 个任务`, detail: lines.join('\n') };
  }
  return null;
}

function formatOpsListGoals(toolName, parsed) {
  const goals = parsed.goals || [];
  if (goals.length > 0) {
    const lines = goals.map((g) => `• ${g.title || g.name || g.id} — 进度 ${g.progress ?? 0}%`);
    return { summary: `${goals.length} 个目标`, detail: lines.join('\n') };
  }
  return null;
}

function formatOpsActivityLog(toolName, parsed) {
  const logs = parsed.logs || [];
  if (logs.length > 0) {
    const lines = logs.map((l) => `• ${l.actor || '?'}: ${l.action || '?'} (${l.time || '?'})`);
    return { summary: `${logs.length} 条活动记录`, detail: lines.join('\n') };
  }
  return null;
}

function formatOpsPrefix(toolName, parsed) {
  if (parsed.message) return { summary: parsed.message, detail: null };
  return null;
}

// ─────────────────────────────────────────────────────────
// 通用回退（与原实现等价）
// ─────────────────────────────────────────────────────────

function formatFallback(parsed) {
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

// ─────────────────────────────────────────────────────────
// 精确匹配表
// ─────────────────────────────────────────────────────────

const TOOL_FORMATTERS = {
  // 协作
  send_to_agent: formatSendToAgent,
  delegate_task: formatDelegateTask,
  notify_boss: formatNotifyBoss,
  create_group_chat: formatCreateGroupChat,
  list_colleagues: formatListColleagues,
  // HR
  hr_list_agents: formatHrListAgents,
  hr_org_chart: formatHrOrgChart,
  // 网络
  web_search: formatWebSearch,
  web_fetch: formatWebFetch,
  fetch_webpage: formatWebFetch,
  // 文件
  read_file: formatReadFile,
  write_file: formatWriteFile,
  list_files: formatListFiles,
  // Shell
  shell: formatShell,
  // CFO / Token
  token_stats: formatTokenStats,
  token_set_budget: formatTokenSetBudget,
  // 运营
  ops_dashboard: formatOpsDashboard,
  ops_list_tasks: formatOpsListTasks,
  ops_list_goals: formatOpsListGoals,
  ops_activity_log: formatOpsActivityLog,
};

// ─────────────────────────────────────────────────────────
// 前缀匹配表（按顺序求值，第一个非 null 结果生效）
// 注意：hr_ 前缀同时覆盖 recruit_request / recruit_respond，与原实现一致
// ─────────────────────────────────────────────────────────

const PREFIX_FORMATTERS = [
  {
    matches: (name) => name.startsWith('hr_') || name === 'recruit_request' || name === 'recruit_respond',
    fn: formatHrPrefix,
  },
  { matches: (name) => name.startsWith('git_'), fn: formatGitPrefix },
  { matches: (name) => name.startsWith('todo_'), fn: formatTodoPrefix },
  { matches: (name) => name.startsWith('memory_'), fn: formatMemoryPrefix },
  { matches: (name) => name.startsWith('ops_'), fn: formatOpsPrefix },
];

// ─────────────────────────────────────────────────────────
// 顶层格式化入口（与原 formatToolResult 输出等价）
// ─────────────────────────────────────────────────────────

/**
 * 智能格式化工具结果：针对不同工具类型返回人类友好的展示
 * @param {string} toolName - 工具名称
 * @param {string|object} rawResult - 原始结果（通常是 JSON 字符串，也可能是对象）
 * @returns {{ summary: string, detail: string|null }} summary 是简短摘要，detail 是完整内容
 */
export function formatToolResult(toolName, rawResult) {
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

  // 精确匹配（与原 if 链前段顺序一致：精确分支优先于前缀分支）
  const exactFn = TOOL_FORMATTERS[toolName];
  if (exactFn) {
    const r = exactFn(toolName, parsed, rawResult);
    if (r) return r;
  }

  // 前缀匹配（按数组顺序）
  for (const { matches, fn } of PREFIX_FORMATTERS) {
    if (matches(toolName)) {
      const r = fn(toolName, parsed, rawResult);
      if (r) return r;
    }
  }

  // 通用回退
  return formatFallback(parsed);
}

export { TOOL_FORMATTERS, PREFIX_FORMATTERS };
