/**
 * SoloForge - 调度器/定时器重启（P1-2 拆分产物 + P1-10 重构）
 *
 * 从 initializeForCompany 抽出第 5-8 步：
 * - 5. 重启 PM 引擎
 * - 6. 重启预算预警（alertSystem）
 * - 7. 重启任务巡查（TaskPatrol，尊重用户手动关闭的偏好）
 * - 8. 启动工资调度器（salaryScheduler）
 *
 * 同时提供 stopSchedulers()，供 cleanupCurrentCompany 调用，停止 PM / patrol /
 * alert / memory 维护，避免 cleanup 和 initialize 的职责重叠。
 *
 * 状态通过 app-context 读写 pmEngine / taskPatrol，避免本模块与 company-switch 之间
 * 传递变量，也避免直接访问私有字段。
 */

const { logger } = require('./utils/logger');
const { appContext } = require('./app-context');
const { alertSystem } = require('./budget/alert-system');
const { salaryScheduler } = require('./budget/salary-scheduler');
const { TaskPatrol } = require('./patrol/task-patrol');

// 单例 store（scheduler 依赖这些）
const { operationsStore } = require('./operations/operations-store');
const { todoStore } = require('./tools/todo-store');
const { agentCommunication } = require('./collaboration/agent-communication');
const { chatManager } = require('./chat');
const { projectStore } = require('./pm/project-store');
const { approvalQueue } = require('./agent-factory/approval-queue');
const { memoryManager } = require('./memory');
const { tokenTracker } = require('./budget/token-tracker');
const { budgetManager } = require('./budget/budget-manager');

/**
 * 停止所有调度器/定时器（cleanup 阶段调用）。
 * 注意：不调用 store.reinitialize() —— 那是 initialize 阶段的职责。
 * 只停 PM / patrol / alert / memory 维护。
 */
function stopSchedulers() {
  memoryManager.stopMaintenanceSchedule();
  alertSystem.stop?.();

  const pmEngine = appContext.getPMEngine();
  if (pmEngine) {
    pmEngine.stop();
    appContext.setPMEngine(null);
  }

  const taskPatrol = appContext.getTaskPatrol();
  if (taskPatrol) {
    taskPatrol.stop();
    appContext.setTaskPatrol(null);
  }
}

/**
 * 重启所有调度器/定时器（initialize 阶段第 5-8 步）。
 * 必须在 dataPath.setCurrentContext + store.reinitialize 之后调用。
 * @param {{ llmManager: any }} opts
 */
function restartSchedulers({ llmManager } = {}) {
  // 5. 重启 PM 引擎
  const existingPM = appContext.getPMEngine();
  if (existingPM) {
    existingPM.stop();
    appContext.setPMEngine(null);
  }
  const { initPMEngine } = require('./pm');
  const pmEngine = initPMEngine({
    operationsStore,
    agentCommunication,
    chatManager,
  }, 3 * 60 * 1000);
  appContext.setPMEngine(pmEngine);
  logger.info('PM 引擎已启动');

  // 6. 重启预算预警
  alertSystem.stop?.();
  alertSystem.start(60000);

  // 7. 重启任务巡查（尊重用户手动关闭的偏好）
  const existingPatrol = appContext.getTaskPatrol();
  if (existingPatrol) {
    existingPatrol.stop();
    appContext.setTaskPatrol(null);
  }
  const taskPatrol = new TaskPatrol({
    operationsStore,
    todoStore,
    agentCommunication,
    chatManager,
    projectStore,
    approvalQueue,
    memoryManager,
    llmManager,
    tokenTracker,
    budgetManager,
  });
  appContext.setTaskPatrol(taskPatrol);
  if (!appContext.isPatrolUserDisabled()) {
    taskPatrol.start(5 * 60 * 1000); // 每 5 分钟巡查一次
    logger.info('任务巡查系统已启动');
  } else {
    logger.info('任务巡查系统已创建但未启动（用户此前手动关闭）');
  }

  // 8. 启动工资调度器（每日 00:00 自动发薪）
  salaryScheduler.start();
}

module.exports = {
  stopSchedulers,
  restartSchedulers,
};
