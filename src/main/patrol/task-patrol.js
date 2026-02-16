/**
 * SoloForge - 任务巡查系统（全能版）
 * 定期轮询全公司运营数据，自动催促、同步、预警、维护
 *
 * 巡查项目（每轮依次执行）：
 *  1. 运营任务催促（待办 + 滞留）
 *  2. 运营任务 → 项目管理自动同步
 *  3. 逾期预警（提前 24h）
 *  4. KPI 自动更新
 *  5. 通信积压检查
 *  6. 招聘审批催促
 *  7. Agent 活跃度监控
 *  8. 记忆系统维护
 *  9. LLM Provider 健康探测
 * 10. 数据完整性校验
 * 11. Token 消耗趋势预测
 * 12. Agent TODO 滞留提醒
 * 13. 日报自动生成（每日一次）
 *
 * @module patrol/task-patrol
 */

const { logger } = require('../utils/logger');
const { agentConfigStore } = require('../config/agent-config-store');

/** 默认巡查间隔：5 分钟 */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** 催促冷却期：同一任务 60 分钟内不重复催促 */
const NUDGE_COOLDOWN_MS = 60 * 60 * 1000;

/** 滞留判定：in_progress 超过 30 分钟未更新 */
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

/** 逾期预警阈值：24 小时内即将到期 */
const DEADLINE_WARNING_MS = 24 * 60 * 60 * 1000;

/** 通信积压阈值：委派任务 pending 超过 2 小时 */
const DELEGATION_STALE_MS = 2 * 60 * 60 * 1000;

/** 招聘审批催促阈值：30 分钟未处理 */
const APPROVAL_STALE_MS = 30 * 60 * 1000;

/** Agent 不活跃阈值：2 小时 */
const AGENT_INACTIVE_MS = 2 * 60 * 60 * 1000;

/** 日报生成时间：每天的小时数（24h 制） — 设为 18 点 */
const DAILY_REPORT_HOUR = 18;

class TaskPatrol {
  /**
   * @param {Object} deps - 依赖注入
   * @param {Object} deps.operationsStore - 运营数据 store
   * @param {Object} deps.todoStore - Agent TODO store
   * @param {Object} deps.agentCommunication - Agent 间通信
   * @param {Object} deps.chatManager - 聊天管理器
   * @param {Object} [deps.projectStore] - 项目管理 store
   * @param {Object} [deps.approvalQueue] - 招聘审批队列
   * @param {Object} [deps.memoryManager] - 记忆系统管理器
   * @param {Object} [deps.llmManager] - LLM 管理器
   * @param {Object} [deps.tokenTracker] - Token 追踪器
   * @param {Object} [deps.budgetManager] - 预算管理器
   */
  constructor(deps) {
    this.operationsStore = deps.operationsStore;
    this.todoStore = deps.todoStore;
    this.agentCommunication = deps.agentCommunication;
    this.chatManager = deps.chatManager;
    this.projectStore = deps.projectStore || null;
    this.approvalQueue = deps.approvalQueue || null;
    this.memoryManager = deps.memoryManager || null;
    this.llmManager = deps.llmManager || null;
    this.tokenTracker = deps.tokenTracker || null;
    this.budgetManager = deps.budgetManager || null;

    /** @type {ReturnType<typeof setInterval>|null} */
    this._interval = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._startTimeout = null;
    this._running = false;
    this._checking = false;

    /** @type {Map<string, number>} key → 上次催促时间戳 */
    this._nudgedAt = new Map();

    /** 上次日报生成日期（YYYY-MM-DD） */
    this._lastDailyReportDate = null;

    /** 上次 LLM 健康检查结果 */
    this._lastLLMStatus = new Map();

    /** 上次记忆维护时间戳 */
    this._lastMemoryMaintenanceAt = 0;

    /** 记忆维护间隔：30 分钟 */
    this._memoryMaintenanceInterval = 30 * 60 * 1000;
  }

  // ═══════════════════════════════════════════════════════════════
  // 生命周期
  // ═══════════════════════════════════════════════════════════════

  start(intervalMs = DEFAULT_INTERVAL_MS) {
    if (this._running) return;
    this._running = true;
    logger.info('任务巡查系统已启动（全能版）', { intervalMs });

    this._startTimeout = setTimeout(() => {
      this._startTimeout = null;
      if (this._running) this._runCheck();
    }, 30000);

    this._interval = setInterval(() => {
      if (this._running) this._runCheck();
    }, intervalMs);
  }

  stop() {
    this._running = false;
    this._checking = false;
    if (this._startTimeout) {
      clearTimeout(this._startTimeout);
      this._startTimeout = null;
    }
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    logger.info('任务巡查系统已停止');
  }

  reinitialize() {
    this.stop();
    this._nudgedAt.clear();
    this._lastDailyReportDate = null;
    this._lastLLMStatus.clear();
    this._lastMemoryMaintenanceAt = 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // 主循环
  // ═══════════════════════════════════════════════════════════════

  async _runCheck() {
    if (this._checking || !this._running) return;
    this._checking = true;

    /** 收集本轮所有通知消息 */
    const notifications = [];

    try {
      const now = Date.now();

      // 1. 运营任务催促
      await this._checkOpsTasks(now);
      if (!this._running) return; // 已被关闭，立即退出

      // 2. 运营→项目管理同步
      const pmChanges = await this._syncOpsToProjects(now);
      if (pmChanges.length > 0) {
        notifications.push(this._formatPMChanges(pmChanges));
      }
      if (!this._running) return;

      // 3. 逾期预警
      const deadlineWarnings = this._checkDeadlines(now);
      if (deadlineWarnings.length > 0) {
        notifications.push(this._formatDeadlineWarnings(deadlineWarnings));
      }

      // 4. KPI 自动更新
      const kpiUpdates = this._autoUpdateKPIs(now);
      if (kpiUpdates.length > 0) {
        notifications.push(this._formatKPIUpdates(kpiUpdates));
      }

      // 5. 通信积压检查
      const backlog = this._checkCommunicationBacklog(now);
      if (backlog.length > 0) {
        notifications.push(this._formatBacklog(backlog));
      }

      // 6. 招聘审批催促
      const approvalAlerts = this._checkApprovalQueue(now);
      if (approvalAlerts.length > 0) {
        notifications.push(this._formatApprovalAlerts(approvalAlerts));
      }
      if (!this._running) return;

      // 7. Agent 活跃度监控
      const inactiveAgents = this._checkAgentActivity(now);
      if (inactiveAgents.length > 0) {
        notifications.push(this._formatInactiveAgents(inactiveAgents));
      }

      // 8. 记忆系统维护
      await this._runMemoryMaintenance(now);
      if (!this._running) return;

      // 9. LLM Provider 健康探测
      const llmIssues = await this._checkLLMHealth(now);
      if (llmIssues.length > 0) {
        notifications.push(this._formatLLMIssues(llmIssues));
      }
      if (!this._running) return;

      // 10. 数据完整性校验
      const integrityIssues = this._checkDataIntegrity(now);
      if (integrityIssues.length > 0) {
        notifications.push(this._formatIntegrityIssues(integrityIssues));
      }

      // 11. Token 消耗趋势预测
      const budgetWarning = this._predictTokenBudget(now);
      if (budgetWarning) {
        notifications.push(budgetWarning);
      }

      // 12. Agent TODO 滞留
      await this._checkAgentTodos(now);
      if (!this._running) return;

      // 13. 日报（每日一次）
      await this._checkDailyReport(now);
      if (!this._running) return;

      // 推送汇总通知
      if (notifications.length > 0) {
        this._pushNotifications(notifications);
      }

      // 清理过期催促记录
      this._cleanupNudgeRecords(now);

    } catch (error) {
      logger.error('任务巡查执行出错', error);
    } finally {
      this._checking = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. 运营任务催促
  // ═══════════════════════════════════════════════════════════════

  async _checkOpsTasks(now) {
    if (!this.operationsStore) return;

    // 辅助函数：检查负责人是否有效（在职且活跃）
    const isAssigneeValid = (assigneeId) => {
      if (!assigneeId) return false;
      const config = agentConfigStore.get(assigneeId);
      if (!config) return false;
      // 跳过已停职或已离职的员工
      if (['suspended', 'terminated'].includes(config.status)) return false;
      return true;
    };

    const todoTasks = this.operationsStore.getTasks({ status: 'todo' })
      .filter((t) => isAssigneeValid(t.assigneeId));

    const staleTasks = this.operationsStore.getTasks({ status: 'in_progress' })
      .filter((t) => {
        if (!isAssigneeValid(t.assigneeId)) return false;
        const lastUpdate = t.updatedAt || t.createdAt;
        const ts = typeof lastUpdate === 'string' ? new Date(lastUpdate).getTime() : lastUpdate;
        return (now - ts) > STALE_THRESHOLD_MS;
      });

    for (const task of todoTasks) {
      if (!this._running) return;
      if (this._isInCooldown(task.id, now)) continue;
      await this._nudgeOpsTask(task, 'todo');
      this._nudgedAt.set(task.id, now);
      await this._sleep(3000);
    }

    for (const task of staleTasks) {
      if (!this._running) return;
      if (this._isInCooldown(task.id, now)) continue;
      await this._nudgeOpsTask(task, 'stale');
      this._nudgedAt.set(task.id, now);
      await this._sleep(3000);
    }
  }

  async _nudgeOpsTask(task, reason) {
    const assigneeName = task.assigneeName || task.assigneeId;
    const requesterName = task.requesterName || task.requesterId || '系统';
    const assigneeConfig = agentConfigStore.get(task.assigneeId);

    if (assigneeConfig && ['suspended', 'terminated'].includes(assigneeConfig.status)) return;

    const taskInfo = `「${task.title}」（优先级: ${task.priority || '普通'}${task.dueDate ? `，截止: ${new Date(task.dueDate).toLocaleDateString('zh-CN')}` : ''}）`;

    if (reason === 'todo') {
      if (this.chatManager) {
        this.chatManager.pushProactiveMessage('secretary',
          `任务巡查提醒：${assigneeName} 有一个待办任务 ${taskInfo} 尚未开始，已自动催促。`);
      }
      if (this.agentCommunication) {
        try {
          await this.agentCommunication.sendMessage({
            fromAgent: 'system',
            toAgent: task.assigneeId,
            message: `【任务提醒】\n任务: ${task.title}\n${task.description ? `描述: ${task.description}\n` : ''}优先级: ${task.priority || '普通'}\n分配人: ${requesterName}\n任务 ID: ${task.id}\n${task.dueDate ? `截止: ${new Date(task.dueDate).toLocaleDateString('zh-CN')}\n` : ''}\n请立即执行：\n1. ops_update_task(task_id="${task.id}", status="in_progress") 标记开始\n2. 按计划完成后 ops_update_task(task_id="${task.id}", status="done")\n3. notify_boss 向老板汇报`,
            allowTools: true,
            includeUserContext: false,
          });
        } catch (error) {
          logger.error(`任务巡查: 催促 ${assigneeName} 失败`, error);
        }
      }
    } else if (reason === 'stale') {
      const lastUpdate = task.updatedAt || task.createdAt;
      const ts = typeof lastUpdate === 'string' ? new Date(lastUpdate).getTime() : lastUpdate;
      const staleMinutes = Math.round((Date.now() - ts) / 60000);

      if (this.chatManager) {
        this.chatManager.pushProactiveMessage('secretary',
          `任务巡查提醒：${assigneeName} 的任务 ${taskInfo} 已 ${staleMinutes} 分钟未更新，已催促。`);
      }
      if (this.agentCommunication) {
        try {
          await this.agentCommunication.sendMessage({
            fromAgent: 'system',
            toAgent: task.assigneeId,
            message: `【任务跟进】\n你的任务「${task.title}」（ID: ${task.id}）已 ${staleMinutes} 分钟未更新。\n请继续推进或使用 notify_boss 说明阻塞原因。`,
            allowTools: true,
            includeUserContext: false,
          });
        } catch (error) {
          logger.error(`任务巡查: 提醒 ${assigneeName} 失败`, error);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. 运营 → 项目管理同步
  // ═══════════════════════════════════════════════════════════════

  async _syncOpsToProjects(_now) {
    if (!this.operationsStore || !this.projectStore) return [];

    const changes = [];
    const statusMapping = { done: 'done', in_progress: 'in_progress', cancelled: 'blocked', review: 'review' };

    const allOpsTasks = this.operationsStore.getTasks();
    for (const opsTask of allOpsTasks) {
      const found = this.projectStore.findByOpsTaskId(opsTask.id);
      if (!found) continue;

      const { project, task: pt } = found;
      if (project.status !== 'active' && project.status !== 'planning') continue;

      const targetStatus = statusMapping[opsTask.status];
      if (!targetStatus || pt.status === targetStatus) continue;
      if (pt.status === 'done') continue;

      const oldStatus = pt.status;
      this.projectStore.updateTask(project.id, pt.id, { status: targetStatus });
      this.projectStore.addProgressNote(project.id, pt.id, {
        content: `运营同步: ${oldStatus} → ${targetStatus}`,
        updatedBy: 'task-patrol',
        updatedByName: '巡查系统',
      });
      const newProgress = this.projectStore.recalculateProgress(project.id);

      changes.push({
        type: targetStatus === 'done' ? 'task_completed' : 'status_changed',
        projectName: project.name,
        taskTitle: pt.title,
        oldStatus,
        newStatus: targetStatus,
        progress: newProgress,
      });
    }

    // 委派任务同步
    if (this.agentCommunication) {
      const delegatedTasks = this.agentCommunication.delegatedTasks || [];
      for (const dt of delegatedTasks) {
        if (dt.status !== 'completed' && dt.status !== 'failed') continue;
        const found = this.projectStore.findByDelegatedTaskId(dt.id);
        if (!found) continue;
        const { project, task: pt } = found;
        if (project.status !== 'active') continue;

        let targetStatus = null;
        if (dt.status === 'completed' && pt.status !== 'done' && pt.status !== 'review') targetStatus = 'done';
        else if (dt.status === 'failed' && pt.status !== 'blocked') targetStatus = 'blocked';
        if (!targetStatus) continue;

        const oldStatus = pt.status;
        this.projectStore.updateTask(project.id, pt.id, { status: targetStatus });
        if (targetStatus === 'blocked') {
          this.projectStore.updateTask(project.id, pt.id, { blockerNote: `委派失败: ${dt.result || '未知'}` });
        }
        const newProgress = this.projectStore.recalculateProgress(project.id);

        changes.push({
          type: targetStatus === 'done' ? 'task_completed' : 'task_blocked',
          projectName: project.name,
          taskTitle: pt.title,
          oldStatus,
          newStatus: targetStatus,
          progress: newProgress,
        });
      }
    }

    return changes;
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. 逾期预警（提前 24h）
  // ═══════════════════════════════════════════════════════════════

  _checkDeadlines(now) {
    const warnings = [];
    const warningCutoff = now + DEADLINE_WARNING_MS;

    // 运营任务截止预警
    if (this.operationsStore) {
      const activeTasks = [
        ...this.operationsStore.getTasks({ status: 'todo' }),
        ...this.operationsStore.getTasks({ status: 'in_progress' }),
      ];

      for (const task of activeTasks) {
        if (!task.dueDate) continue;
        const dueTs = new Date(task.dueDate).getTime();
        if (isNaN(dueTs)) continue;

        const cooldownKey = `deadline:${task.id}`;
        if (this._isInCooldown(cooldownKey, now)) continue;

        if (dueTs < now) {
          // 已逾期
          warnings.push({ type: 'overdue', category: 'ops_task', title: task.title, assignee: task.assigneeName || task.assigneeId, dueDate: task.dueDate, hoursOverdue: Math.round((now - dueTs) / 3600000) });
          this._nudgedAt.set(cooldownKey, now);
        } else if (dueTs < warningCutoff) {
          // 即将到期
          const hoursLeft = Math.round((dueTs - now) / 3600000);
          warnings.push({ type: 'approaching', category: 'ops_task', title: task.title, assignee: task.assigneeName || task.assigneeId, dueDate: task.dueDate, hoursLeft });
          this._nudgedAt.set(cooldownKey, now);
        }
      }
    }

    // 项目里程碑截止预警
    if (this.projectStore) {
      const activeProjects = this.projectStore.getProjects({ status: 'active' });
      for (const project of activeProjects) {
        for (const ms of project.milestones) {
          if (ms.status === 'completed' || !ms.dueDate) continue;
          const dueTs = new Date(ms.dueDate).getTime();
          if (isNaN(dueTs)) continue;

          const cooldownKey = `deadline:ms:${ms.id}`;
          if (this._isInCooldown(cooldownKey, now)) continue;

          if (dueTs < now) {
            warnings.push({ type: 'overdue', category: 'milestone', title: `${project.name} → ${ms.name}`, progress: ms.progress, dueDate: ms.dueDate, hoursOverdue: Math.round((now - dueTs) / 3600000) });
            this._nudgedAt.set(cooldownKey, now);
          } else if (dueTs < warningCutoff) {
            warnings.push({ type: 'approaching', category: 'milestone', title: `${project.name} → ${ms.name}`, progress: ms.progress, dueDate: ms.dueDate, hoursLeft: Math.round((dueTs - now) / 3600000) });
            this._nudgedAt.set(cooldownKey, now);
          }
        }

        // 项目任务截止预警
        for (const task of project.tasks) {
          if (task.status === 'done' || !task.dueDate) continue;
          const dueTs = new Date(task.dueDate).getTime();
          if (isNaN(dueTs)) continue;

          const cooldownKey = `deadline:pt:${task.id}`;
          if (this._isInCooldown(cooldownKey, now)) continue;

          if (dueTs < now) {
            warnings.push({ type: 'overdue', category: 'project_task', title: `${project.name} → ${task.title}`, assignee: task.assigneeName || task.assigneeId, dueDate: task.dueDate });
            this._nudgedAt.set(cooldownKey, now);
          } else if (dueTs < warningCutoff) {
            warnings.push({ type: 'approaching', category: 'project_task', title: `${project.name} → ${task.title}`, assignee: task.assigneeName || task.assigneeId, dueDate: task.dueDate, hoursLeft: Math.round((dueTs - now) / 3600000) });
            this._nudgedAt.set(cooldownKey, now);
          }
        }
      }
    }

    if (warnings.length > 0) {
      logger.info('任务巡查: 逾期预警', { count: warnings.length });
    }
    return warnings;
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. KPI 自动更新
  // ═══════════════════════════════════════════════════════════════

  _autoUpdateKPIs(_now) {
    if (!this.operationsStore) return [];

    const kpiUpdates = [];
    const kpis = this.operationsStore.getKPIs();

    for (const kpi of kpis) {
      const kpiName = (kpi.name || '').toLowerCase();
      let newValue = null;

      // 任务完成数类型 KPI
      if (kpiName.includes('任务') && (kpiName.includes('完成') || kpiName.includes('done'))) {
        const doneTasks = this.operationsStore.getTasks({ status: 'done' });
        // 按 KPI 负责人过滤（如果有）
        const filtered = kpi.ownerId
          ? doneTasks.filter((t) => t.assigneeId === kpi.ownerId)
          : doneTasks;
        newValue = filtered.length;
      }

      // 目标达成率类型 KPI
      if (kpiName.includes('目标') && (kpiName.includes('达成') || kpiName.includes('完成率'))) {
        const goals = this.operationsStore.getGoals();
        const total = goals.length;
        const completed = goals.filter((g) => g.status === 'completed').length;
        newValue = total > 0 ? Math.round((completed / total) * 100) : 0;
      }

      // 项目进度类型 KPI
      if (this.projectStore && kpiName.includes('项目') && kpiName.includes('进度')) {
        const projects = this.projectStore.getProjects({ status: 'active' });
        if (projects.length > 0) {
          const avgProgress = Math.round(projects.reduce((sum, p) => sum + p.progress, 0) / projects.length);
          newValue = avgProgress;
        }
      }

      // API 调用数类型 KPI
      if (this.tokenTracker && kpiName.includes('api') && kpiName.includes('调用')) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const usage = this.tokenTracker.getTotalUsage(today.getTime());
        newValue = usage.callCount;
      }

      // 更新 KPI（仅当值变化时）
      if (newValue !== null && newValue !== kpi.current) {
        const oldValue = kpi.current;
        this.operationsStore.updateKPIValue(kpi.id, newValue, 'task-patrol', '巡查系统');
        kpiUpdates.push({ name: kpi.name, oldValue, newValue, unit: kpi.unit || '' });
        logger.debug(`任务巡查: KPI 自动更新 ${kpi.name}: ${oldValue} → ${newValue}`);
      }
    }

    return kpiUpdates;
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. 通信积压检查
  // ═══════════════════════════════════════════════════════════════

  _checkCommunicationBacklog(now) {
    if (!this.agentCommunication) return [];

    const backlog = [];

    // 检查长时间 pending 的委派任务
    const delegatedTasks = this.agentCommunication.delegatedTasks || [];
    for (const dt of delegatedTasks) {
      if (dt.status !== 'pending') continue;
      const age = now - dt.createdAt;
      if (age < DELEGATION_STALE_MS) continue;

      const cooldownKey = `backlog:dt:${dt.id}`;
      if (this._isInCooldown(cooldownKey, now)) continue;

      backlog.push({
        type: 'delegated_task',
        id: dt.id,
        description: dt.taskDescription?.slice(0, 80),
        fromAgent: dt.fromAgent,
        toAgent: dt.toAgent,
        ageHours: Math.round(age / 3600000),
      });
      this._nudgedAt.set(cooldownKey, now);
    }

    // 检查长时间未响应的消息
    const messages = this.agentCommunication.messages || [];
    const pendingMsgs = messages.filter((m) => m.status === 'pending' && (now - m.createdAt) > STALE_THRESHOLD_MS);
    if (pendingMsgs.length > 0) {
      backlog.push({
        type: 'pending_messages',
        count: pendingMsgs.length,
        oldestAge: Math.round((now - Math.min(...pendingMsgs.map((m) => m.createdAt))) / 60000),
      });
    }

    if (backlog.length > 0) {
      logger.info('任务巡查: 通信积压', { items: backlog.length });
    }
    return backlog;
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. 招聘审批催促
  // ═══════════════════════════════════════════════════════════════

  _checkApprovalQueue(now) {
    if (!this.approvalQueue) return [];

    const alerts = [];
    const pending = this.approvalQueue.getPending();

    for (const req of pending) {
      const createdAt = typeof req.createdAt === 'string' ? new Date(req.createdAt).getTime() : req.createdAt;
      const age = now - createdAt;
      if (age < APPROVAL_STALE_MS) continue;

      const cooldownKey = `approval:${req.id}`;
      if (this._isInCooldown(cooldownKey, now)) continue;

      alerts.push({
        id: req.id,
        roleName: req.roleName || req.role,
        requester: req.requesterName || req.requesterId,
        ageMinutes: Math.round(age / 60000),
        status: req.status,
      });
      this._nudgedAt.set(cooldownKey, now);
    }

    if (alerts.length > 0) {
      logger.info('任务巡查: 招聘审批积压', { count: alerts.length });
    }
    return alerts;
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. Agent 活跃度监控
  // ═══════════════════════════════════════════════════════════════

  _checkAgentActivity(now) {
    const inactive = [];
    const allAgents = agentConfigStore.getAll();

    for (const agent of allAgents) {
      if (agent.status !== 'active') continue;
      if (['secretary'].includes(agent.id)) continue; // 秘书是被动角色

      // 检查该 Agent 是否有分配的运营任务
      const hasTasks = this.operationsStore
        ? this.operationsStore.getTasks({ assigneeId: agent.id })
            .some((t) => t.status === 'todo' || t.status === 'in_progress')
        : false;

      if (!hasTasks) continue; // 没有任务的 Agent 不检查活跃度

      // 检查最后活动时间（通过 token 记录）
      let lastActive = 0;
      if (this.tokenTracker) {
        const summary = this.tokenTracker.getSummary(agent.id);
        if (summary.length > 0) {
          const lastUsedStr = summary[0].lastUsed;
          // lastUsed 已被格式化为字符串，尝试解析
          const parsed = new Date(lastUsedStr);
          if (!isNaN(parsed.getTime())) lastActive = parsed.getTime();
        }
      }

      // 如果有委派任务，检查最新活动
      if (this.agentCommunication) {
        const delegated = this.agentCommunication.delegatedTasks || [];
        for (const dt of delegated) {
          if (dt.toAgent === agent.id && dt.startedAt) {
            lastActive = Math.max(lastActive, dt.startedAt);
          }
        }
      }

      if (lastActive > 0 && (now - lastActive) > AGENT_INACTIVE_MS) {
        const cooldownKey = `inactive:${agent.id}`;
        if (this._isInCooldown(cooldownKey, now)) continue;

        inactive.push({
          id: agent.id,
          name: agent.name,
          title: agent.title || '',
          inactiveMinutes: Math.round((now - lastActive) / 60000),
          pendingTaskCount: hasTasks ? 1 : 0,
        });
        this._nudgedAt.set(cooldownKey, now);
      }
    }

    return inactive;
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. 记忆系统维护
  // ═══════════════════════════════════════════════════════════════

  async _runMemoryMaintenance(now) {
    if (!this.memoryManager) return;
    if (now - this._lastMemoryMaintenanceAt < this._memoryMaintenanceInterval) return;

    try {
      logger.debug('任务巡查: 触发记忆系统维护');
      await this.memoryManager.runMaintenance();
      this._lastMemoryMaintenanceAt = now;
      logger.info('任务巡查: 记忆系统维护完成');
    } catch (error) {
      logger.error('任务巡查: 记忆系统维护失败', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. LLM Provider 健康探测
  // ═══════════════════════════════════════════════════════════════

  async _checkLLMHealth(_now) {
    if (!this.llmManager) return [];

    const issues = [];
    const providerNames = this.llmManager.getProviderNames();

    for (const name of providerNames) {
      if (name === 'mock') continue; // mock 始终可用

      try {
        const result = await this.llmManager.checkConnection(name);
        const prevStatus = this._lastLLMStatus.get(name);

        if (!result.available) {
          // 当前不可用
          if (prevStatus !== false) {
            // 状态从可用变为不可用 → 报警
            issues.push({ provider: name, available: false, error: result.error || '连接失败' });
            logger.warn(`任务巡查: LLM Provider "${name}" 不可用`, { error: result.error });
          }
        } else if (prevStatus === false) {
          // 从不可用恢复 → 通知
          issues.push({ provider: name, available: true, recovered: true });
          logger.info(`任务巡查: LLM Provider "${name}" 已恢复`);
        }

        this._lastLLMStatus.set(name, result.available);
      } catch (error) {
        logger.error(`任务巡查: LLM 健康检查 "${name}" 异常`, error);
      }
    }

    return issues;
  }

  // ═══════════════════════════════════════════════════════════════
  // 10. 数据完整性校验
  // ═══════════════════════════════════════════════════════════════

  _checkDataIntegrity(_now) {
    const issues = [];

    // 检查运营任务与项目任务状态不一致
    if (this.operationsStore && this.projectStore) {
      const doneTasks = this.operationsStore.getTasks({ status: 'done' });
      for (const opsTask of doneTasks) {
        const found = this.projectStore.findByOpsTaskId(opsTask.id);
        if (!found) continue;
        if (found.task.status !== 'done') {
          issues.push({
            type: 'status_mismatch',
            description: `运营任务「${opsTask.title}」已完成，但项目任务「${found.task.title}」状态为 ${found.task.status}`,
            opsTaskId: opsTask.id,
            projectTaskId: found.task.id,
          });
        }
      }
    }

    // 检查分配给不存在/停职/离职 Agent 的任务，并自动清理离职员工的任务
    if (this.operationsStore) {
      const activeTasks = [
        ...this.operationsStore.getTasks({ status: 'todo' }),
        ...this.operationsStore.getTasks({ status: 'in_progress' }),
      ];
      for (const task of activeTasks) {
        if (!task.assigneeId) continue;
        const config = agentConfigStore.get(task.assigneeId);
        if (!config) {
          issues.push({ type: 'orphan_task', description: `任务「${task.title}」分配给不存在的 Agent: ${task.assigneeId}` });
          // 自动取消孤儿任务
          this.operationsStore.updateTask(task.id, {
            status: 'cancelled',
            cancelReason: '负责人不存在',
          }, 'system', '巡查系统');
        } else if (config.status === 'terminated') {
          // 自动取消已离职员工的任务
          this.operationsStore.updateTask(task.id, {
            status: 'cancelled',
            cancelReason: `负责人 ${config.name} 已离职`,
          }, 'system', '巡查系统');
          issues.push({
            type: 'terminated_assignee_fixed',
            description: `已自动取消任务「${task.title}」（原负责人 ${config.name} 已离职）`,
          });
        }
      }
    }

    // 检查项目进度与实际任务完成率不一致
    if (this.projectStore) {
      const activeProjects = this.projectStore.getProjects({ status: 'active' });
      for (const project of activeProjects) {
        if (project.tasks.length === 0) continue;
        const actualDone = project.tasks.filter((t) => t.status === 'done').length;
        const expectedProgress = Math.round((actualDone / project.tasks.length) * 100);
        if (Math.abs(project.progress - expectedProgress) > 5) {
          issues.push({
            type: 'progress_mismatch',
            description: `项目「${project.name}」进度 ${project.progress}% 但实际完成率 ${expectedProgress}%`,
          });
          // 自动修复
          this.projectStore.recalculateProgress(project.id);
        }
      }
    }

    if (issues.length > 0) {
      logger.info('任务巡查: 数据完整性问题', { count: issues.length });
    }
    return issues;
  }

  // ═══════════════════════════════════════════════════════════════
  // 11. Token 消耗趋势预测
  // ═══════════════════════════════════════════════════════════════

  _predictTokenBudget(now) {
    if (!this.tokenTracker || !this.budgetManager) return null;

    const budget = this.budgetManager.getGlobalBudget();
    if (!budget.globalDailyLimit || budget.globalDailyLimit <= 0) return null;

    // 今日已消耗
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayUsage = this.tokenTracker.getTotalUsage(today.getTime());

    // 当前使用率
    const usagePercent = Math.round((todayUsage.totalTokens / budget.globalDailyLimit) * 100);

    // 按当前速率预测日末消耗
    const hoursElapsed = (now - today.getTime()) / 3600000;
    if (hoursElapsed < 1) return null; // 不到 1 小时数据不够准

    const hourlyRate = todayUsage.totalTokens / hoursElapsed;
    const hoursRemaining = 24 - hoursElapsed;
    const projectedTotal = todayUsage.totalTokens + (hourlyRate * hoursRemaining);
    const projectedPercent = Math.round((projectedTotal / budget.globalDailyLimit) * 100);

    // 超过 80% 预警
    if (usagePercent >= 80 || projectedPercent >= 100) {
      const cooldownKey = 'budget:daily';
      if (this._isInCooldown(cooldownKey, now)) return null;
      this._nudgedAt.set(cooldownKey, now);

      const warning = `💰 **Token 预算预警**\n` +
        `当前已消耗: ${todayUsage.totalTokens.toLocaleString()} / ${budget.globalDailyLimit.toLocaleString()} (${usagePercent}%)\n` +
        `按当前速率预测: 日末将达到 ${Math.round(projectedTotal).toLocaleString()} tokens (${projectedPercent}%)\n` +
        `今日 API 调用: ${todayUsage.callCount} 次\n` +
        (projectedPercent >= 100 ? `⚠️ 预计今日将超出每日预算限额！` : `⚠️ 使用率较高，请关注。`);

      logger.info('任务巡查: Token 预算预警', { usagePercent, projectedPercent });
      return warning;
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // 12. Agent TODO 滞留
  // ═══════════════════════════════════════════════════════════════

  async _checkAgentTodos(now) {
    if (!this.todoStore) return;

    const allTodos = this.todoStore.getAll();

    for (const [agentId, todos] of Object.entries(allTodos)) {
      if (!this._running) return;

      const pendingTodos = todos.filter((t) => t.status === 'pending' || t.status === 'in_progress');
      if (pendingTodos.length === 0) continue;

      const staleTodos = pendingTodos.filter((t) => (now - (t.updatedAt || t.createdAt)) > STALE_THRESHOLD_MS);
      if (staleTodos.length === 0) continue;

      const cooldownKey = `todo:${agentId}`;
      if (this._isInCooldown(cooldownKey, now)) continue;

      const agentConfig = agentConfigStore.get(agentId);
      if (agentConfig && ['suspended', 'terminated'].includes(agentConfig.status)) continue;

      const agentName = agentConfig?.name || agentId;
      const todoSummary = staleTodos.map((t) => `• ${t.title}`).join('\n');

      if (this.agentCommunication) {
        try {
          await this.agentCommunication.sendMessage({
            fromAgent: 'system',
            toAgent: agentId,
            message: `【待办提醒】你有 ${staleTodos.length} 个待办较长时间未更新：\n${todoSummary}\n\n请继续处理。`,
            allowTools: true,
            includeUserContext: false,
          });
        } catch (error) {
          logger.error(`任务巡查: 提醒 ${agentName} TODO 失败`, error);
        }
      }

      this._nudgedAt.set(cooldownKey, now);
      await this._sleep(3000);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 13. 日报自动生成（每日一次）
  // ═══════════════════════════════════════════════════════════════

  async _checkDailyReport(now) {
    if (!this.chatManager) return;

    const todayStr = new Date(now).toISOString().split('T')[0]; // YYYY-MM-DD
    const currentHour = new Date(now).getHours();

    // 已经生成过今天的日报 → 跳过
    if (this._lastDailyReportDate === todayStr) return;
    // 未到生成时间 → 跳过
    if (currentHour < DAILY_REPORT_HOUR) return;

    this._lastDailyReportDate = todayStr;

    try {
      const report = this._buildDailyReport(now);
      if (report) {
        this.chatManager.pushProactiveMessage('secretary', report);
        logger.info('任务巡查: 日报已生成');
      }
    } catch (error) {
      logger.error('任务巡查: 日报生成失败', error);
    }
  }

  _buildDailyReport(now) {
    const lines = [`📰 **SoloForge 每日工作简报** (${new Date(now).toLocaleDateString('zh-CN')})\n`];

    // Token 消耗
    if (this.tokenTracker) {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const usage = this.tokenTracker.getTotalUsage(today.getTime());
      const agentSummaries = this.tokenTracker.getSummary(undefined, today.getTime());

      lines.push(`**💬 API 调用**: ${usage.callCount} 次，消耗 ${usage.totalTokens.toLocaleString()} tokens`);

      if (agentSummaries.length > 0) {
        const topAgents = agentSummaries
          .sort((a, b) => b.totalTokens - a.totalTokens)
          .slice(0, 3)
          .map((s) => {
            const config = agentConfigStore.get(s.agentId);
            return `${config?.name || s.agentId}(${s.callCount}次/${s.totalTokens.toLocaleString()}t)`;
          });
        lines.push(`  活跃 Agent: ${topAgents.join('、')}`);
      }
    }

    // 运营任务
    if (this.operationsStore) {
      const allTasks = this.operationsStore.getTasks();
      const doneTodayTasks = allTasks.filter((t) => {
        if (t.status !== 'done' || !t.completedAt) return false;
        const completed = new Date(t.completedAt);
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        return completed >= todayStart;
      });

      const todo = allTasks.filter((t) => t.status === 'todo').length;
      const inProgress = allTasks.filter((t) => t.status === 'in_progress').length;
      const done = allTasks.filter((t) => t.status === 'done').length;

      lines.push(`\n**📋 运营任务**: 今日完成 ${doneTodayTasks.length} 个 | 总计: 待办 ${todo} / 进行中 ${inProgress} / 已完成 ${done}`);

      if (doneTodayTasks.length > 0) {
        const names = doneTodayTasks.slice(0, 5).map((t) => t.title).join('、');
        lines.push(`  今日完成: ${names}${doneTodayTasks.length > 5 ? ' ...' : ''}`);
      }
    }

    // 项目进度
    if (this.projectStore) {
      const activeProjects = this.projectStore.getProjects({ status: 'active' });
      if (activeProjects.length > 0) {
        lines.push(`\n**📊 活跃项目**: ${activeProjects.length} 个`);
        for (const p of activeProjects.slice(0, 5)) {
          const done = p.tasks.filter((t) => t.status === 'done').length;
          lines.push(`  • ${p.name}: ${p.progress}% (${done}/${p.tasks.length} 任务完成)`);
        }
      }
    }

    // 人事
    const allAgents = agentConfigStore.getAll();
    const active = allAgents.filter((a) => a.status === 'active').length;
    const suspended = allAgents.filter((a) => a.status === 'suspended').length;
    lines.push(`\n**👥 团队**: ${active} 人在岗${suspended > 0 ? `，${suspended} 人停职` : ''}`);

    // 招聘
    if (this.approvalQueue) {
      const pending = this.approvalQueue.getPending();
      if (pending.length > 0) {
        lines.push(`**📝 待审批招聘**: ${pending.length} 个`);
      }
    }

    lines.push(`\n---\n_本报告由任务巡查系统自动生成_`);

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // 通知格式化
  // ═══════════════════════════════════════════════════════════════

  _formatPMChanges(changes) {
    const byProject = new Map();
    for (const c of changes) {
      if (!byProject.has(c.projectName)) byProject.set(c.projectName, { completed: [], other: [], progress: 0 });
      const g = byProject.get(c.projectName);
      if (c.type === 'task_completed') g.completed.push(c.taskTitle);
      else g.other.push(`${c.taskTitle}: ${c.oldStatus}→${c.newStatus}`);
      g.progress = c.progress;
    }

    const lines = ['📊 **项目管理自动更新**'];
    for (const [name, info] of byProject) {
      lines.push(`  ${name} (${info.progress}%):`);
      if (info.completed.length) lines.push(`    ✅ 完成: ${info.completed.join('、')}`);
      if (info.other.length) lines.push(`    🔄 ${info.other.join('；')}`);
    }
    return lines.join('\n');
  }

  _formatDeadlineWarnings(warnings) {
    const lines = ['⏰ **逾期预警**'];
    const overdue = warnings.filter((w) => w.type === 'overdue');
    const approaching = warnings.filter((w) => w.type === 'approaching');

    if (overdue.length > 0) {
      lines.push(`  🚨 已逾期 ${overdue.length} 项:`);
      for (const w of overdue) lines.push(`    • ${w.title}${w.assignee ? ` (${w.assignee})` : ''}`);
    }
    if (approaching.length > 0) {
      lines.push(`  ⚠️ 即将到期 ${approaching.length} 项:`);
      for (const w of approaching) lines.push(`    • ${w.title} — ${w.hoursLeft}h 后到期`);
    }
    return lines.join('\n');
  }

  _formatKPIUpdates(updates) {
    const lines = ['📈 **KPI 自动更新**'];
    for (const u of updates) lines.push(`  • ${u.name}: ${u.oldValue} → ${u.newValue} ${u.unit}`);
    return lines.join('\n');
  }

  _formatBacklog(backlog) {
    const lines = ['📬 **通信积压提醒**'];
    for (const item of backlog) {
      if (item.type === 'delegated_task') {
        lines.push(`  • 委派任务待 ${item.ageHours}h 未处理: ${item.description || item.id}`);
      } else if (item.type === 'pending_messages') {
        lines.push(`  • ${item.count} 条消息未处理（最早 ${item.oldestAge} 分钟前）`);
      }
    }
    return lines.join('\n');
  }

  _formatApprovalAlerts(alerts) {
    const lines = ['📝 **招聘审批待处理**'];
    for (const a of alerts) {
      lines.push(`  • 「${a.roleName}」由 ${a.requester} 申请，已等待 ${a.ageMinutes} 分钟`);
    }
    return lines.join('\n');
  }

  _formatInactiveAgents(agents) {
    const lines = ['💤 **Agent 活跃度提醒**'];
    for (const a of agents) {
      lines.push(`  • ${a.name}${a.title ? ` (${a.title})` : ''} 已 ${a.inactiveMinutes} 分钟无活动，仍有待办任务`);
    }
    return lines.join('\n');
  }

  _formatLLMIssues(issues) {
    const lines = ['🔌 **LLM Provider 状态**'];
    for (const i of issues) {
      if (i.recovered) {
        lines.push(`  ✅ ${i.provider} 已恢复`);
      } else {
        lines.push(`  ❌ ${i.provider} 不可用: ${i.error}`);
      }
    }
    return lines.join('\n');
  }

  _formatIntegrityIssues(issues) {
    const lines = [`🔍 **数据完整性** (${issues.length} 个问题)`];
    for (const i of issues.slice(0, 5)) {
      lines.push(`  • ${i.description}`);
    }
    if (issues.length > 5) lines.push(`  ... 及其他 ${issues.length - 5} 个问题`);
    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // 推送汇总通知
  // ═══════════════════════════════════════════════════════════════

  _pushNotifications(notifications) {
    if (!this.chatManager || notifications.length === 0) return;

    const message = `🔄 **任务巡查报告**\n\n${notifications.join('\n\n')}`;
    this.chatManager.pushProactiveMessage('secretary', message);

    logger.info('任务巡查: 汇总通知已推送', { sections: notifications.length });
  }

  // ═══════════════════════════════════════════════════════════════
  // 工具方法
  // ═══════════════════════════════════════════════════════════════

  _isInCooldown(key, now) {
    const lastNudge = this._nudgedAt.get(key);
    return lastNudge && (now - lastNudge) < NUDGE_COOLDOWN_MS;
  }

  _cleanupNudgeRecords(now) {
    for (const [key, timestamp] of this._nudgedAt.entries()) {
      if (now - timestamp > NUDGE_COOLDOWN_MS * 2) {
        this._nudgedAt.delete(key);
      }
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { TaskPatrol };
