import { useState, useEffect, useCallback } from 'react';
import { ChevronLeftIcon, ChartBarIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

// ─────────────────────────────────────────────────────────────
// Dashboard 子组件（拆分自本文件，按职责独立维护）
// ─────────────────────────────────────────────────────────────
import { StatCard, Panel, Badge, StatusDot } from '../components/dashboard/ui.jsx';
import GoalsList from '../components/dashboard/GoalsList.jsx';
import TasksList from '../components/dashboard/TasksList.jsx';
import KPIsList from '../components/dashboard/KPIsList.jsx';
import BudgetApprovalPanel from '../components/dashboard/BudgetApprovalPanel.jsx';
import TerminationApprovalPanel from '../components/dashboard/TerminationApprovalPanel.jsx';
import RecruitmentList from '../components/dashboard/RecruitmentList.jsx';
import ActivityTimeline from '../components/dashboard/ActivityTimeline.jsx';
import CollaborationActivity from '../components/dashboard/CollaborationActivity.jsx';
import ProjectsPanel from '../components/dashboard/ProjectsPanel.jsx';
import AgentTaskPanel from '../components/dashboard/AgentTaskPanel.jsx';

// ─────────────────────────────────────────────────────────────
// 运营仪表板主组件 —— Linear 风格 Monitor 面
// ─────────────────────────────────────────────────────────────
//
// 职责（拆分后仅保留）：
//   1. 数据获取：通过 window.electronAPI 拉取 summary/goals/tasks/kpis/... 并 setData
//   2. 状态管理：loading / data；isActive 时启动 30s 轮询
//   3. 组合子组件：将数据通过 props 分发给拆分后的子组件
//
// 定时器清单（全部在 useEffect cleanup 中 clearInterval，切页/卸载不泄漏）：
//   [本组件]  30s 轮询 loadData —— 受 isActive 限制
//   [BudgetApprovalPanel] 10s 轮询预算数据 —— 自管理清理
//   [AgentTaskPanel] 2s 轮询 Agent 任务 + 1s tick 刷新已用时 —— 自管理清理
export default function Dashboard({ onBack, onOpenCFO, isActive = true }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState({
    summary: null,
    goals: [],
    tasks: [],
    kpis: [],
    recruitRequests: [],
    terminationRequests: [],
    activityLog: [],
    collaboration: null,
    projects: [],
  });

  const loadData = useCallback(async () => {
    // 触发 opacity 闪现；首次加载时主内容不可见（显示 spinner），闪现无副作用
    setRefreshing(true);
    try {
      const [summary, goals, tasks, kpis, recruitRequests, terminationRequests, collaboration, projects] = await Promise.all([
        window.electronAPI.getOperationsSummary(),
        window.electronAPI.getOperationsGoals(),
        window.electronAPI.getOperationsTasks(),
        window.electronAPI.getOperationsKPIs(),
        window.electronAPI.getRecruitRequests(),
        window.electronAPI.getTerminationRequests?.() || Promise.resolve([]),
        window.electronAPI.getCollaborationSummary?.() || Promise.resolve(null),
        window.electronAPI.getProjectsSummary?.() || Promise.resolve([]),
      ]);

      setData({
        summary,
        goals: goals || [],
        tasks: tasks || [],
        kpis: kpis || [],
        recruitRequests: recruitRequests || [],
        terminationRequests: terminationRequests || [],
        activityLog: summary?.recentActivity || [],
        collaboration,
        projects: projects || [],
      });
    } catch (error) {
      console.error('加载仪表板数据失败:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // 只在页面可见时加载数据和轮询
    if (!isActive) return;

    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData, isActive]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-bg-base">
        <div className="text-center">
          {/* Emil: 入场 scale(0.95)+opacity:0 → 1 */}
          <div
            className="w-8 h-8 rounded-full animate-spin mx-auto"
            style={{
              border: '2px solid rgba(255,255,255,0.08)',
              borderTopColor: 'var(--accent)',
              animation: 'dashLoaderEnter 280ms cubic-bezier(0.23,1,0.32,1) both, spin 700ms linear infinite',
            }}
          />
          <p
            className="mt-3 text-sm text-text-tertiary"
            style={{ animation: 'dashLoaderEnter 280ms 60ms cubic-bezier(0.23,1,0.32,1) both' }}
          >
            加载仪表板…
          </p>
        </div>
        <style>{`
          @keyframes dashLoaderEnter {
            from { opacity: 0; transform: scale(0.95); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    );
  }

  const { summary, goals: rawGoals = [], tasks: rawTasks = [], kpis, recruitRequests, terminationRequests, activityLog, collaboration, projects } = data;
  // 过滤掉已取消的目标和任务
  const goals = (rawGoals || []).filter((g) => g.status !== 'cancelled');
  const tasks = (rawTasks || []).filter((t) => t.status !== 'cancelled');
  const goalStats = summary?.goals || {};
  const taskStats = summary?.tasks || {};
  const kpiStats = summary?.kpis || {};
  const collabStats = collaboration || {};

  return (
    <div className="h-full bg-bg-base overflow-auto">
      {/* macOS 标题栏占位 */}
      <div className="shrink-0 h-8 drag-region" />

      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* 头部：极简标题 + ghost 返回 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} className="btn-ghost !p-1.5" aria-label="返回">
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
            )}
            <div>
              <h1 className="text-[15px] font-title tracking-tighter text-text-primary leading-tight">
                运营仪表板
              </h1>
              <p className="text-xs text-text-quaternary mt-0.5 leading-tight">公司运营状况概览</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* CFO 控制台入口 —— ghost 风格，无绿色装饰 */}
            {onOpenCFO && (
              <button onClick={onOpenCFO} className="btn-ghost">
                <ChartBarIcon className="w-3.5 h-3.5" />
                <span>CFO 控制台</span>
              </button>
            )}
            <button
              onClick={loadData}
              className="btn-ghost"
              style={{ opacity: refreshing ? 0.5 : 1, transition: 'opacity 200ms cubic-bezier(0.23,1,0.32,1)' }}
            >
              <ArrowPathIcon className="w-3.5 h-3.5" />
              <span>刷新</span>
            </button>
          </div>
        </div>

        {/* KPI 统计行 —— 6 列密度，紧凑 StatCard；Emil: stagger 入场 40ms + 刷新时 opacity 闪现 */}
        <div
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 stagger"
          style={{
            opacity: refreshing ? 0.5 : 1,
            transition: 'opacity 200ms cubic-bezier(0.23,1,0.32,1)',
          }}
        >
          <StatCard
            title="目标总数"
            value={goalStats.total || 0}
            subtitle={`进行中 ${goalStats.inProgress || 0} · 平均 ${goalStats.avgProgress || 0}%`}
            tone="accent"
          />
          <StatCard
            title="任务总数"
            value={taskStats.total || 0}
            subtitle={`待办 ${taskStats.todo || 0} · 高优 ${taskStats.highPriority || 0}`}
            tone="success"
          />
          <StatCard
            title="KPI 指标"
            value={kpiStats.total || 0}
            subtitle={`达标 ${kpiStats.onTrack || 0} · 风险 ${kpiStats.atRisk || 0}`}
            tone="accent"
          />
          <StatCard
            title="招聘审批"
            value={recruitRequests.filter((r) => r.status === 'pending' || r.status === 'discussing').length}
            subtitle={`总计 ${recruitRequests.length} 个申请`}
            tone="warning"
          />
          <StatCard
            title="开除审批"
            value={(terminationRequests || []).filter((r) => r.status === 'pending').length}
            subtitle={`总计 ${(terminationRequests || []).length} 个申请`}
            tone="danger"
          />
          <StatCard
            title="团队协作"
            value={(collabStats.messageCount || 0) + (collabStats.taskCount || 0)}
            subtitle={`消息 ${collabStats.messageCount || 0} · 委派 ${collabStats.taskCount || 0}`}
            tone="accent"
          />
        </div>

        {/* 项目管理面板 */}
        {projects.length > 0 && <ProjectsPanel projects={projects} />}

        {/* Agent 工作状态面板 */}
        <AgentTaskPanel />

        {/* 主体两栏布局 —— Monitor 面密度优先；Emil: 面板 stagger 入场 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 dashPanels">
          {/* 左栏 */}
          <div className="space-y-4">
            {/* 任务看板 */}
            <Panel title="任务看板" trailing={`${tasks.length} 个任务`}>
              <TasksList tasks={tasks} goals={goals} allTasks={rawTasks} onRefresh={loadData} />
              {tasks.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border-subtle">
                  <div className="flex flex-wrap gap-3 text-xs text-text-tertiary">
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone="neutral" />
                      待办 {taskStats.todo || 0}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone="accent" />
                      进行中 {taskStats.inProgress || 0}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone="warning" />
                      审核 {taskStats.review || 0}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone="success" />
                      完成 {taskStats.done || 0}
                    </span>
                  </div>
                </div>
              )}
            </Panel>

            {/* 目标 */}
            <Panel title="业务目标" trailing={`${goals.length} 个目标`}>
              <GoalsList goals={goals} />
            </Panel>

            {/* KPI */}
            <Panel title="KPI 指标" trailing={`${kpis.length} 个指标`}>
              <KPIsList kpis={kpis} />
            </Panel>
          </div>

          {/* 右栏 */}
          <div className="space-y-4">
            {/* 预算审批 */}
            <Panel title="预算审批" trailing="Agent 预算管理">
              <BudgetApprovalPanel onRefresh={loadData} />
            </Panel>

            {/* Agent 协作 */}
            <Panel title="Agent 协作" trailing={`${collabStats.pendingTasks || 0} 待处理`}>
              <CollaborationActivity activities={collabStats.recentActivity} onRefresh={loadData} />
              {(collabStats.messageCount > 0 || collabStats.taskCount > 0) && (
                <div className="mt-3 pt-3 border-t border-border-subtle flex gap-4 text-xs text-text-quaternary">
                  <span>消息: {collabStats.messageCount || 0}</span>
                  <span>委派: {collabStats.taskCount || 0}</span>
                  <span>完成: {collabStats.completedTasks || 0}</span>
                </div>
              )}
            </Panel>

            {/* 开除审批 */}
            <Panel
              title="开除审批"
              trailing={`${(terminationRequests || []).filter((r) => r.status === 'pending').length} 待审批`}
            >
              <TerminationApprovalPanel requests={terminationRequests || []} onRefresh={loadData} />
            </Panel>

            {/* 招聘审批 */}
            <Panel
              title="招聘审批"
              trailing={`${recruitRequests.filter((r) => r.status === 'pending' || r.status === 'discussing').length} 待处理`}
            >
              <RecruitmentList requests={recruitRequests} onRefresh={loadData} />
            </Panel>

            {/* 最近活动 */}
            <Panel title="最近活动">
              <ActivityTimeline activities={activityLog} onRefresh={loadData} />
            </Panel>
          </div>
        </div>

        {/* 面板 stagger 入场：每项 40ms 延迟，仅本页局部 keyframes */}
        <style>{`
          @keyframes dashPanelEnter {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .dashPanels > div > .panel {
            opacity: 0;
            animation: dashPanelEnter 280ms cubic-bezier(0.23,1,0.32,1) both;
          }
          .dashPanels > div:nth-child(1) > .panel:nth-child(1) { animation-delay: 0ms; }
          .dashPanels > div:nth-child(1) > .panel:nth-child(2) { animation-delay: 40ms; }
          .dashPanels > div:nth-child(1) > .panel:nth-child(3) { animation-delay: 80ms; }
          .dashPanels > div:nth-child(2) > .panel:nth-child(1) { animation-delay: 40ms; }
          .dashPanels > div:nth-child(2) > .panel:nth-child(2) { animation-delay: 80ms; }
          .dashPanels > div:nth-child(2) > .panel:nth-child(3) { animation-delay: 120ms; }
          .dashPanels > div:nth-child(2) > .panel:nth-child(4) { animation-delay: 160ms; }
          .dashPanels > div:nth-child(2) > .panel:nth-child(5) { animation-delay: 200ms; }
        `}</style>
      </div>
    </div>
  );
}
