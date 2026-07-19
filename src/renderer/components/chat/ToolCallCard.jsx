/**
 * SoloForge - 工具调用可视化卡片组件
 * 显示 Agent 执行工具的状态、参数和结果，支持折叠展开
 * @module components/chat/ToolCallCard
 */

import { memo, useMemo, useState } from 'react';
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
// 工具结果格式化逻辑已拆分到独立模块（映射表驱动，便于新增工具）
import { formatToolResult } from './tool-result-formatters';

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
function ToolCallCard({ toolCall }) {
  const [expanded, setExpanded] = useState(false);
  const { label, Icon } = useMemo(() => getToolMeta(toolCall.name), [toolCall.name]);
  const argsSummary = useMemo(() => getArgsSummary(toolCall.name, toolCall.args), [toolCall.name, toolCall.args]);
  const isRunning = toolCall.status === 'running';
  const isSuccess = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const hasResult = isSuccess && toolCall.result;
  const hasError = isError && toolCall.error;
  // 仅在 result 实际变化时重新格式化（避免父组件流式重渲染导致重复格式化）
  const formattedResult = useMemo(() => {
    if (!hasResult) return null;
    return formatToolResult(toolCall.name, toolCall.result);
  }, [hasResult, toolCall.name, toolCall.result]);

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
      {hasResult && formattedResult && (() => {
        const { summary, detail } = formattedResult;
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

// memo 包裹：当 toolCall prop 引用稳定时跳过重渲染（流式输出时只有最后一条消息变化，
// 其他工具卡片可避免重渲染）。toolCall 通常由 store 维护，引用在 status/result 变化时才更新。
export default memo(ToolCallCard);
