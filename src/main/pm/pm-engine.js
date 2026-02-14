/**
 * SoloForge - PM 引擎
 * 机械式项目管理引擎，定时驱动项目推进
 *
 * 核心职责（纯代码，不依赖 LLM 提示词）：
 * 1. 同步委派任务状态 → 项目任务状态
 * 2. 自动计算里程碑和项目进度
 * 3. 同步进度到运营 Dashboard
 * 4. 检测逾期/阻塞任务 → 上报
 * 5. 定时触发站会 → 催促负责人跟进
 * 6. 向老板推送项目状态变更
 *
 * @module pm/pm-engine
 */

const { logger } = require('../utils/logger');

// 检查间隔
const DEFAULT_CHECK_INTERVAL = 3 * 60 * 1000; // 3 分钟检查一次
const DEFAULT_STANDUP_INTERVAL = 30 * 60 * 1000; // 30 分钟站会

class PMEngine {
  /**
   * @param {Object} deps
   * @param {import('./project-store').ProjectStore} deps.projectStore
   * @param {import('../operations/operations-store').OperationsStore} deps.operationsStore
   * @param {import('../collaboration/agent-communication').AgentCommunication} deps.agentCommunication
   * @param {import('../chat').ChatManager} deps.chatManager
   */
  constructor({ projectStore, operationsStore, agentCommunication, chatManager }) {
    this.projectStore = projectStore;
    this.opsStore = operationsStore;
    this.agentComm = agentCommunication;
    this.chatManager = chatManager;
    this.checkInterval = null;
    this._lastProgressSnapshot = new Map(); // projectId → progress
    this._running = false;
  }

  // ─────────────────────────────────────────────────────────────
  // 生命周期
  // ─────────────────────────────────────────────────────────────

  /**
   * 启动 PM 引擎
   * @param {number} [intervalMs]
   */
  start(intervalMs = DEFAULT_CHECK_INTERVAL) {
    if (this._running) return;
    this._running = true;

    logger.info('PM 引擎启动', { intervalMs });

    // 首次延迟检查（等系统完全初始化）
    setTimeout(() => this._runCheck(), 15000);

    this.checkInterval = setInterval(() => this._runCheck(), intervalMs);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this._running = false;
    logger.info('PM 引擎已停止');
  }

  // ─────────────────────────────────────────────────────────────
  // 主循环
  // ─────────────────────────────────────────────────────────────

  async _runCheck() {
    try {
      const projects = this.projectStore.getProjects({ status: 'active' });
      if (projects.length === 0) return;

      for (const project of projects) {
        await this._checkProject(project);
      }
    } catch (error) {
      logger.error('PM 引擎检查失败', error);
    }
  }

  /**
   * 检查单个项目
   * @param {import('./project-store').Project} project
   */
  async _checkProject(project) {
    const prevProgress = this._lastProgressSnapshot.get(project.id) ?? project.progress;

    // 1. 同步委派任务状态
    this._syncDelegatedTaskStatuses(project);

    // 2. 检查依赖关系，自动解锁任务
    this._checkDependencies(project);

    // 3. 重新计算进度
    const newProgress = this.projectStore.recalculateProgress(project.id);

    // 4. 同步到运营 Dashboard
    this._syncToDashboard(project);

    // 5. 检测逾期/阻塞
    const overdueResult = this._detectIssues(project);

    // 6. 检查是否需要站会
    if (Date.now() >= project.nextStandupAt) {
      await this._performStandup(project, overdueResult);
    }

    // 7. 进度变更通知老板
    if (newProgress !== prevProgress) {
      this._notifyProgressChange(project, prevProgress, newProgress);
    }

    this._lastProgressSnapshot.set(project.id, newProgress);
  }

  // ─────────────────────────────────────────────────────────────
  // 1. 同步委派任务状态（机械式，不需要 LLM）
  // ─────────────────────────────────────────────────────────────

  _syncDelegatedTaskStatuses(project) {
    if (!this.agentComm) return;

    let changed = false;

    for (const task of project.tasks) {
      if (!task.delegatedTaskId) continue;

      const delegated = this.agentComm.delegatedTasks.find(
        (t) => t.id === task.delegatedTaskId
      );
      if (!delegated) continue;

      let newStatus = null;

      if (delegated.status === 'completed' && task.status !== 'done' && task.status !== 'review') {
        newStatus = 'review'; // 完成 → 先进入 review
      } else if (delegated.status === 'in_progress' && task.status === 'todo') {
        newStatus = 'in_progress';
      } else if (delegated.status === 'failed' && task.status !== 'blocked') {
        newStatus = 'blocked';
        task.blockerNote = `委派任务执行失败: ${delegated.result || '未知原因'}`;
      }

      if (newStatus && newStatus !== task.status) {
        task.status = newStatus;
        if (newStatus === 'done') task.completedAt = Date.now();
        changed = true;

        logger.debug(`PM 同步任务状态: ${task.title} → ${newStatus}`, {
          projectId: project.id,
          taskId: task.id,
          delegatedTaskId: task.delegatedTaskId,
        });
      }
    }

    if (changed) {
      this.projectStore.saveToDisk();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. 检查依赖关系
  // ─────────────────────────────────────────────────────────────

  _checkDependencies(project) {
    for (const task of project.tasks) {
      if (task.status !== 'todo') continue;
      if (task.dependencies.length === 0) continue;

      const allDepsComplete = task.dependencies.every((depId) => {
        const dep = project.tasks.find((t) => t.id === depId);
        return dep && dep.status === 'done';
      });

      if (!allDepsComplete) continue;

      // 依赖满足，如果有指定执行人但还没开始，记录一条提示
      if (task.assigneeId) {
        this.projectStore.addProgressNote(project.id, task.id, {
          content: '前置依赖已完成，任务可以开始执行',
          updatedBy: 'pm-engine',
          updatedByName: 'PM系统',
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. 同步到运营 Dashboard
  // ─────────────────────────────────────────────────────────────

  _syncToDashboard(project) {
    if (!this.opsStore || !project.goalId) return;

    const goal = this.opsStore.getGoals().find((g) => g.id === project.goalId);
    if (!goal) return;

    const goalUpdates = {};

    // 同步进度
    if (goal.progress !== project.progress) {
      goalUpdates.progress = project.progress;
    }

    // 同步状态
    const statusMap = {
      active: 'in_progress',
      completed: 'completed',
      cancelled: 'cancelled',
      on_hold: 'pending',
      planning: 'pending',
    };
    const mappedStatus = statusMap[project.status] || 'pending';
    if (goal.status !== mappedStatus) {
      goalUpdates.status = mappedStatus;
    }

    if (Object.keys(goalUpdates).length > 0) {
      this.opsStore.updateGoal(project.goalId, goalUpdates, 'pm-engine', 'PM系统');
      logger.debug(`PM 同步到 Dashboard: goal=${project.goalId} progress=${project.progress}%`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. 检测逾期/阻塞
  // ─────────────────────────────────────────────────────────────

  _detectIssues(project) {
    const overdue = this.projectStore.getOverdueTasks(project.id);
    const blocked = this.projectStore.getBlockedTasks(project.id);

    // 检查里程碑逾期
    const now = new Date().toISOString().split('T')[0];
    const overdueMilestones = project.milestones.filter(
      (ms) => ms.dueDate && ms.dueDate < now && ms.status !== 'completed'
    );

    return { overdue, blocked, overdueMilestones };
  }

  // ─────────────────────────────────────────────────────────────
  // 6. 站会 - 向项目负责人发送状态检查
  // ─────────────────────────────────────────────────────────────

  async _performStandup(project, issues) {
    if (!this.chatManager || !this.agentComm) return;

    logger.info(`PM 站会: ${project.name}`, {
      projectId: project.id,
      owner: project.ownerId,
    });

    // 构建站会报告
    const report = this._buildStandupReport(project, issues);

    // 发送给项目负责人（通过内部通信）
    try {
      await this.agentComm.sendMessage({
        fromAgent: 'system',
        toAgent: project.ownerId,
        message: report,
        allowTools: true, // 允许负责人使用工具（如 delegate_task）来响应
      });
    } catch (error) {
      logger.error(`PM 站会消息发送失败: ${project.ownerId}`, error);
    }

    // 更新下次站会时间
    this.projectStore.updateProject(project.id, {
      nextStandupAt: Date.now() + (project.standupIntervalMs || DEFAULT_STANDUP_INTERVAL),
    });
  }

  /**
   * 构建站会报告
   */
  _buildStandupReport(project, issues) {
    const totalTasks = project.tasks.length;
    const doneTasks = project.tasks.filter((t) => t.status === 'done').length;
    const inProgressTasks = project.tasks.filter((t) => t.status === 'in_progress').length;
    const todoTasks = project.tasks.filter((t) => t.status === 'todo').length;
    const reviewTasks = project.tasks.filter((t) => t.status === 'review').length;
    const blockedTasks = project.tasks.filter((t) => t.status === 'blocked').length;

    let report = `【PM 站会通知 - ${project.name}】

📊 项目进度: ${project.progress}%
📋 任务统计: 共 ${totalTasks} 项 | ✅完成 ${doneTasks} | ⏳进行中 ${inProgressTasks} | 📝待审 ${reviewTasks} | 📌待办 ${todoTasks} | 🚫阻塞 ${blockedTasks}

`;

    // 里程碑状态
    if (project.milestones.length > 0) {
      report += '📌 里程碑状态:\n';
      for (const ms of project.milestones) {
        const icon = ms.status === 'completed' ? '✅' : ms.status === 'in_progress' ? '🔄' : '⏳';
        report += `  ${icon} ${ms.name}: ${ms.progress}%${ms.dueDate ? ` (截止: ${ms.dueDate})` : ''}\n`;
      }
      report += '\n';
    }

    // 逾期任务
    if (issues.overdue.length > 0) {
      report += '⚠️ 逾期任务（需立即处理）:\n';
      for (const t of issues.overdue) {
        report += `  - [${t.priority}] ${t.title} (${t.assigneeName || '未分配'}, 截止: ${t.dueDate})\n`;
      }
      report += '\n';
    }

    // 阻塞任务
    if (issues.blocked.length > 0) {
      report += '🚫 阻塞任务（需解决）:\n';
      for (const t of issues.blocked) {
        report += `  - ${t.title}: ${t.blockerNote || '未知原因'}\n`;
      }
      report += '\n';
    }

    // 待分配的任务
    const unassigned = project.tasks.filter((t) => !t.assigneeId && t.status === 'todo');
    if (unassigned.length > 0) {
      report += '📋 待分配任务:\n';
      for (const t of unassigned) {
        report += `  - [${t.priority}] ${t.title}\n`;
      }
      report += '\n';
    }

    // 行动要求
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
作为项目负责人，你需要：
1. 查看上述进度，处理逾期和阻塞任务
2. 为未分配的任务安排执行人（使用 delegate_task）
3. 如果需要更多人手，使用 recruit_request 申请招聘
4. 重要进展使用 notify_boss 向老板汇报

⚠️ 必须调用工具来执行操作！文字描述不算数。`;

    return report;
  }

  // ─────────────────────────────────────────────────────────────
  // 7. 进度变更通知
  // ─────────────────────────────────────────────────────────────

  _notifyProgressChange(project, prevProgress, newProgress) {
    if (!this.chatManager) return;

    // 只在有显著变化时通知（>= 5% 变化或完成）
    const significantChange = Math.abs(newProgress - prevProgress) >= 5;
    const justCompleted = newProgress >= 100 && prevProgress < 100;
    const milestoneCompleted = project.milestones.some(
      (ms) => ms.status === 'completed' && ms.progress === 100
    );

    if (!significantChange && !justCompleted && !milestoneCompleted) return;

    let message;
    if (justCompleted) {
      message = `🎉 项目「${project.name}」已完成！所有任务已执行完毕。`;
    } else {
      const direction = newProgress > prevProgress ? '📈' : '📉';
      message = `${direction} 项目「${project.name}」进度更新: ${prevProgress}% → ${newProgress}%`;

      // 附加新完成的里程碑
      const justCompletedMs = project.milestones.filter(
        (ms) => ms.status === 'completed' && ms.progress === 100
      );
      if (justCompletedMs.length > 0) {
        message += `\n🏁 里程碑完成: ${justCompletedMs.map((m) => m.name).join(', ')}`;
      }
    }

    // 推送给项目负责人（通过其聊天频道显示给老板）
    this.chatManager.pushProactiveMessage(project.ownerId, message);

    logger.info(`PM 进度通知: ${project.name} ${prevProgress}% → ${newProgress}%`);
  }

  // ─────────────────────────────────────────────────────────────
  // 外部触发（供 hooks 调用）
  // ─────────────────────────────────────────────────────────────

  /**
   * 当委派任务状态变更时调用（hook）
   * @param {string} delegatedTaskId
   * @param {string} newStatus - 'completed' | 'in_progress' | 'failed'
   */
  onDelegatedTaskStatusChange(delegatedTaskId, newStatus) {
    const found = this.projectStore.findByDelegatedTaskId(delegatedTaskId);
    if (!found) return;

    const { project, task } = found;

    let mappedStatus = null;
    if (newStatus === 'completed') mappedStatus = 'review';
    if (newStatus === 'in_progress' && task.status === 'todo') mappedStatus = 'in_progress';
    if (newStatus === 'failed') mappedStatus = 'blocked';

    if (mappedStatus && mappedStatus !== task.status) {
      this.projectStore.updateTask(project.id, task.id, { status: mappedStatus });
      this.projectStore.recalculateProgress(project.id);
      this._syncToDashboard(project);

      logger.info(`PM hook: 任务状态同步 ${task.title} → ${mappedStatus}`, {
        projectId: project.id,
        delegatedTaskId,
      });
    }
  }

  /**
   * 当审阅通过时，将 review → done
   * @param {string} delegatedTaskId
   */
  onTaskReviewApproved(delegatedTaskId) {
    const found = this.projectStore.findByDelegatedTaskId(delegatedTaskId);
    if (!found) return;

    const { project, task } = found;
    if (task.status === 'review') {
      this.projectStore.updateTask(project.id, task.id, { status: 'done' });
      const newProgress = this.projectStore.recalculateProgress(project.id);
      this._syncToDashboard(project);

      logger.info(`PM hook: 审阅通过 ${task.title} → done`, {
        projectId: project.id,
        progress: newProgress,
      });
    }
  }

  /**
   * 当审阅退回时，将 review → in_progress
   * @param {string} delegatedTaskId
   */
  onTaskReviewRejected(delegatedTaskId) {
    const found = this.projectStore.findByDelegatedTaskId(delegatedTaskId);
    if (!found) return;

    const { project, task } = found;
    if (task.status === 'review') {
      this.projectStore.updateTask(project.id, task.id, { status: 'in_progress' });
      this.projectStore.recalculateProgress(project.id);

      logger.info(`PM hook: 审阅退回 ${task.title} → in_progress`, {
        projectId: project.id,
      });
    }
  }
}

module.exports = { PMEngine };
