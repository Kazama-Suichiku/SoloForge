/**
 * SoloForge - HR 专属工具（统一入口）
 *
 * 本文件现在是聚合入口：实际工具定义已按工具域拆分到：
 * - hr-org-tools.js        ：组织架构（hr_list_agents / hr_update_agent / hr_org_chart）
 * - hr-approval-tools.js   ：招聘审批（agent_requests / hr_question / agent_approve）
 * - hr-lifecycle-tools.js  ：生命周期（开除/停职/复职/试用期/入职引导）
 * - hr-performance-tools.js ：绩效与晋升降级（绩效分析/团队分析/晋升/降级）
 * - hr-department-tools.js ：部门与调岗（部门 CRUD / 调岗 / 多部门管理）
 * - hr-budget-tools.js     ：预算/批量/历史（预算查看 / 批量操作 / 人事历史）
 * - hr-shared.js           ：共享依赖（stores / queues / utils）
 *
 * 本文件对外保持与原单文件完全相同的导出接口：
 *   - 27 个工具对象（名称、category、parameters、requiredPermissions 不变）
 *   - registerHRTools 注册函数（注册顺序与原实现一致）
 *
 * 外部调用方（如 tools/setup.js）无需任何改动。
 *
 * @module tools/hr-tools
 */

const { toolRegistry } = require('./hr-shared');

const {
  hrListAgentsTool,
  hrUpdateAgentTool,
  hrOrgChartTool,
} = require('./hr-org-tools');

const {
  hrAgentRequestsTool,
  hrQuestionTool,
  hrAgentApproveTool,
} = require('./hr-approval-tools');

const {
  hrDismissRequestTool,
  dismissConfirmTool,
  hrSuspendAgentTool,
  hrReinstateAgentTool,
  hrEndProbationTool,
  hrOnboardingStatusTool,
} = require('./hr-lifecycle-tools');

const {
  hrPerformanceReviewTool,
  hrTeamAnalyticsTool,
  hrPromoteAgentTool,
  hrDemoteAgentTool,
} = require('./hr-performance-tools');

const {
  hrListDepartmentsTool,
  hrCreateDepartmentTool,
  hrUpdateDepartmentTool,
  hrDeleteDepartmentTool,
  hrTransferAgentTool,
  hrAddDepartmentTool,
  hrRemoveDepartmentTool,
  hrSetPrimaryDepartmentTool,
} = require('./hr-department-tools');

const {
  hrViewBudgetTool,
  hrBatchUpdateTool,
  hrPersonnelHistoryTool,
} = require('./hr-budget-tools');

// ═══════════════════════════════════════════════════════════════
// 工具注册
// ═══════════════════════════════════════════════════════════════

/**
 * 注册 HR 工具
 *
 * 注册顺序与原单文件 hr-tools.js 中的实现保持一致。
 */
function registerHRTools() {
  // 基础人事管理
  toolRegistry.register(hrListAgentsTool);
  toolRegistry.register(hrUpdateAgentTool);
  toolRegistry.register(hrOrgChartTool);

  // 招聘审批
  toolRegistry.register(hrAgentRequestsTool);
  toolRegistry.register(hrQuestionTool);
  toolRegistry.register(hrAgentApproveTool);

  // 开除流程
  toolRegistry.register(hrDismissRequestTool);
  toolRegistry.register(dismissConfirmTool);

  // 停职/复职
  toolRegistry.register(hrSuspendAgentTool);
  toolRegistry.register(hrReinstateAgentTool);

  // 绩效分析
  toolRegistry.register(hrPerformanceReviewTool);
  toolRegistry.register(hrTeamAnalyticsTool);

  // 晋升/降级
  toolRegistry.register(hrPromoteAgentTool);
  toolRegistry.register(hrDemoteAgentTool);

  // 试用期管理
  toolRegistry.register(hrEndProbationTool);

  // 入职引导
  toolRegistry.register(hrOnboardingStatusTool);

  // 部门管理
  toolRegistry.register(hrListDepartmentsTool);
  toolRegistry.register(hrCreateDepartmentTool);
  toolRegistry.register(hrUpdateDepartmentTool);
  toolRegistry.register(hrDeleteDepartmentTool);

  // 调岗
  toolRegistry.register(hrTransferAgentTool);

  // 多部门管理
  toolRegistry.register(hrAddDepartmentTool);
  toolRegistry.register(hrRemoveDepartmentTool);
  toolRegistry.register(hrSetPrimaryDepartmentTool);

  // 预算查看（只读，设置由 CFO 负责）
  toolRegistry.register(hrViewBudgetTool);

  // 批量操作
  toolRegistry.register(hrBatchUpdateTool);

  // 人事历史
  toolRegistry.register(hrPersonnelHistoryTool);
}

module.exports = {
  // 基础人事管理
  hrListAgentsTool,
  hrUpdateAgentTool,
  hrOrgChartTool,
  // 招聘审批
  hrAgentRequestsTool,
  hrQuestionTool,
  hrAgentApproveTool,
  // 开除流程
  hrDismissRequestTool,
  dismissConfirmTool,
  // 停职/复职
  hrSuspendAgentTool,
  hrReinstateAgentTool,
  // 绩效分析
  hrPerformanceReviewTool,
  hrTeamAnalyticsTool,
  // 晋升/降级
  hrPromoteAgentTool,
  hrDemoteAgentTool,
  // 试用期管理
  hrEndProbationTool,
  // 入职引导
  hrOnboardingStatusTool,
  // 部门管理
  hrListDepartmentsTool,
  hrCreateDepartmentTool,
  hrUpdateDepartmentTool,
  hrDeleteDepartmentTool,
  // 调岗
  hrTransferAgentTool,
  // 多部门管理
  hrAddDepartmentTool,
  hrRemoveDepartmentTool,
  hrSetPrimaryDepartmentTool,
  // 预算查看（只读）
  hrViewBudgetTool,
  // 批量操作
  hrBatchUpdateTool,
  // 人事历史
  hrPersonnelHistoryTool,
  // 注册函数
  registerHRTools,
};
