/**
 * SoloForge Mobile - 运营数据存储
 * 管理目标、KPI、任务（简化版，无 Electron 依赖）
 * @module core/operations/operations-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');

const DATA_DIR = path.join(__dirname, '../../../data');
const OPS_FILE = path.join(DATA_DIR, 'operations.json');

/**
 * @typedef {Object} Goal
 * @property {string} id - 目标 ID
 * @property {string} title - 目标标题
 * @property {string} description - 详细描述
 * @property {'strategic' | 'quarterly' | 'monthly' | 'weekly'} type - 目标类型
 * @property {string} ownerId - 负责人 Agent ID
 * @property {string} ownerName - 负责人名称
 * @property {string} department - 所属部门
 * @property {number} progress - 进度 0-100
 * @property {'pending' | 'in_progress' | 'completed' | 'cancelled'} status - 状态
 * @property {string} [parentId] - 父目标 ID
 * @property {string[]} [keyResults] - 关键结果
 * @property {string} createdAt - 创建时间
 * @property {string} [updatedAt] - 更新时间
 * @property {string} [dueDate] - 截止日期
 */

/**
 * @typedef {Object} KPI
 * @property {string} id - KPI ID
 * @property {string} name - KPI 名称
 * @property {string} description - 描述
 * @property {string} ownerId - 负责人 Agent ID
 * @property {string} ownerName - 负责人名称
 * @property {string} department - 所属部门
 * @property {string} unit - 单位
 * @property {number} target - 目标值
 * @property {number} current - 当前值
 * @property {'higher_better' | 'lower_better' | 'target_exact'} direction - 方向
 * @property {string} period - 周期
 * @property {Array<{date: string, value: number}>} history - 历史记录
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Task
 * @property {string} id - 任务 ID
 * @property {string} title - 任务标题
 * @property {string} description - 描述
 * @property {'high' | 'medium' | 'low'} priority - 优先级
 * @property {string} assigneeId - 执行人 Agent ID
 * @property {string} assigneeName - 执行人名称
 * @property {string} requesterId - 发起人 Agent ID
 * @property {string} requesterName - 发起人名称
 * @property {string} [goalId] - 关联目标 ID
 * @property {string} [projectId] - 关联项目 ID
 * @property {string} [projectName] - 关联项目名称
 * @property {'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'} status - 状态
 * @property {string} [cancelReason] - 取消原因
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {string} [completedAt]
 * @property {string} [cancelledAt]
 * @property {string} [dueDate]
 * @property {Array} [progressLog] - 进度记录
 */

/**
 * @typedef {Object} ActivityLog
 * @property {string} id - 日志 ID
 * @property {'goal' | 'kpi' | 'task' | 'recruit' | 'approval' | 'system'} category - 类别
 * @property {string} action - 动作描述
 * @property {string} actorId - 执行者 Agent ID
 * @property {string} actorName - 执行者名称
 * @property {Object} [data] - 附加数据
 * @property {string} createdAt
 */

class OperationsStore {
  constructor() {
    this.data = {
      goals: [],
      kpis: [],
      tasks: [],
      activityLog: [],
    };
    this.subscribers = new Set();
    this.loadFromDisk();
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(OPS_FILE)) {
        const content = fs.readFileSync(OPS_FILE, 'utf-8');
        const saved = JSON.parse(content);
        this.data = {
          goals: saved.goals || [],
          kpis: saved.kpis || [],
          tasks: saved.tasks || [],
          activityLog: saved.activityLog || [],
        };
        logger.info('运营数据已加载', {
          goals: this.data.goals.length,
          kpis: this.data.kpis.length,
          tasks: this.data.tasks.length,
        });
      }
    } catch (error) {
      logger.error('加载运营数据失败', error);
    }
  }

  saveToDisk() {
    try {
      this._ensureDataDir();
      const content = JSON.stringify(
        {
          version: 1,
          lastUpdated: new Date().toISOString(),
          ...this.data,
        },
        null,
        2
      );
      fs.writeFileSync(OPS_FILE, content);
    } catch (error) {
      logger.error('保存运营数据失败', error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 目标管理
  // ─────────────────────────────────────────────────────────────

  createGoal(params) {
    const goal = {
      id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: params.title,
      description: params.description || '',
      type: params.type || 'quarterly',
      ownerId: params.ownerId,
      ownerName: params.ownerName,
      department: params.department || '',
      progress: 0,
      status: 'pending',
      parentId: params.parentId,
      keyResults: params.keyResults || [],
      createdAt: new Date().toISOString(),
      dueDate: params.dueDate,
    };
    this.data.goals.push(goal);
    this.logActivity('goal', `创建目标: ${goal.title}`, params.ownerId, params.ownerName, { goalId: goal.id });
    this.saveToDisk();
    this.notify();
    return goal;
  }

  updateGoal(goalId, updates, actorId, actorName) {
    const goal = this.data.goals.find((g) => g.id === goalId);
    if (!goal) return null;
    const oldStatus = goal.status;
    const oldProgress = goal.progress;
    Object.assign(goal, updates, { updatedAt: new Date().toISOString() });
    if (updates.status && updates.status !== oldStatus) {
      this.logActivity('goal', `目标状态变更: ${goal.title} → ${updates.status}`, actorId, actorName, { goalId });
    }
    if (updates.progress !== undefined && updates.progress !== oldProgress) {
      this.logActivity('goal', `目标进度更新: ${goal.title} ${oldProgress}% → ${updates.progress}%`, actorId, actorName, { goalId });
    }
    this.saveToDisk();
    this.notify();
    return goal;
  }

  deleteGoal(goalId, actorId, actorName) {
    const idx = this.data.goals.findIndex((g) => g.id === goalId);
    if (idx === -1) return { success: false, error: '目标不存在' };
    const goal = this.data.goals[idx];
    this.data.goals.splice(idx, 1);
    this.logActivity('goal', `删除目标: ${goal.title}`, actorId, actorName, { goalId, title: goal.title });
    this.saveToDisk();
    this.notify();
    return { success: true, deletedGoal: goal };
  }

  getGoals(filter = {}) {
    let result = [...this.data.goals];
    if (filter.status) result = result.filter((g) => g.status === filter.status);
    if (filter.department) result = result.filter((g) => g.department === filter.department);
    if (filter.ownerId) result = result.filter((g) => g.ownerId === filter.ownerId);
    if (filter.type) result = result.filter((g) => g.type === filter.type);
    return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // ─────────────────────────────────────────────────────────────
  // KPI 管理
  // ─────────────────────────────────────────────────────────────

  createKPI(params) {
    const kpi = {
      id: `kpi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: params.name,
      description: params.description || '',
      ownerId: params.ownerId,
      ownerName: params.ownerName,
      department: params.department || '',
      unit: params.unit || '',
      target: params.target || 0,
      current: params.current || 0,
      direction: params.direction || 'higher_better',
      period: params.period || '',
      history: [],
      createdAt: new Date().toISOString(),
    };
    this.data.kpis.push(kpi);
    this.logActivity('kpi', `创建 KPI: ${kpi.name}`, params.ownerId, params.ownerName, { kpiId: kpi.id });
    this.saveToDisk();
    this.notify();
    return kpi;
  }

  updateKPIValue(kpiId, value, actorId, actorName) {
    const kpi = this.data.kpis.find((k) => k.id === kpiId);
    if (!kpi) return null;
    const oldValue = kpi.current;
    kpi.current = value;
    kpi.history.push({ date: new Date().toISOString(), value });
    this.logActivity('kpi', `KPI 更新: ${kpi.name} ${oldValue} → ${value} ${kpi.unit}`, actorId, actorName, { kpiId });
    this.saveToDisk();
    this.notify();
    return kpi;
  }

  deleteKPI(kpiId, actorId, actorName) {
    const idx = this.data.kpis.findIndex((k) => k.id === kpiId);
    if (idx === -1) return { success: false, error: 'KPI 不存在' };
    const kpi = this.data.kpis[idx];
    this.data.kpis.splice(idx, 1);
    this.logActivity('kpi', `删除 KPI: ${kpi.name}`, actorId, actorName, { kpiId, name: kpi.name });
    this.saveToDisk();
    this.notify();
    return { success: true, deletedKPI: kpi };
  }

  getKPIs(filter = {}) {
    let result = [...this.data.kpis];
    if (filter.department) result = result.filter((k) => k.department === filter.department);
    if (filter.ownerId) result = result.filter((k) => k.ownerId === filter.ownerId);
    if (filter.period) result = result.filter((k) => k.period === filter.period);
    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // 任务管理
  // ─────────────────────────────────────────────────────────────

  createTask(params) {
    const task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: params.title,
      description: params.description || '',
      priority: params.priority || 'medium',
      assigneeId: params.assigneeId,
      assigneeName: params.assigneeName,
      requesterId: params.requesterId,
      requesterName: params.requesterName,
      goalId: params.goalId,
      projectId: params.projectId || null,
      projectName: params.projectName || null,
      status: 'todo',
      createdAt: new Date().toISOString(),
      dueDate: params.dueDate,
    };
    this.data.tasks.push(task);
    const projectInfo = task.projectId ? ` [项目: ${task.projectName || task.projectId}]` : '';
    this.logActivity('task', `创建任务: ${task.title} → ${task.assigneeName}${projectInfo}`, params.requesterId, params.requesterName, { taskId: task.id });
    this.saveToDisk();
    this.notify();
    return task;
  }

  updateTask(taskId, updates, actorId, actorName) {
    const task = this.data.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    const oldStatus = task.status;
    const now = new Date().toISOString();
    Object.assign(task, updates, { updatedAt: now });
    if (updates.status === 'done' && oldStatus !== 'done') task.completedAt = now;
    if (updates.status === 'cancelled' && oldStatus !== 'cancelled') {
      task.cancelledAt = now;
      if (!task.cancelReason) task.cancelReason = updates.cancelReason || `由 ${actorName} 取消`;
    }
    if (updates.status && updates.status !== oldStatus) {
      this.logActivity('task', `任务状态: ${task.title} → ${updates.status}`, actorId, actorName, { taskId });
    }
    this.saveToDisk();
    this.notify();
    return task;
  }

  deleteTask(taskId, actorId, actorName) {
    const idx = this.data.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return { success: false, error: '任务不存在' };
    const task = this.data.tasks[idx];
    this.data.tasks.splice(idx, 1);
    this.logActivity('task', `删除任务: ${task.title}`, actorId, actorName, { taskId, title: task.title });
    this.saveToDisk();
    this.notify();
    return { success: true, deletedTask: task };
  }

  getTask(taskId) {
    return this.data.tasks.find((t) => t.id === taskId) || null;
  }

  getTasks(filter = {}) {
    let result = [...this.data.tasks];
    if (filter.status) result = result.filter((t) => t.status === filter.status);
    if (filter.assigneeId) result = result.filter((t) => t.assigneeId === filter.assigneeId);
    if (filter.requesterId) result = result.filter((t) => t.requesterId === filter.requesterId);
    if (filter.goalId) result = result.filter((t) => t.goalId === filter.goalId);
    if (filter.projectId) result = result.filter((t) => t.projectId === filter.projectId);
    return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // ─────────────────────────────────────────────────────────────
  // 活动日志
  // ─────────────────────────────────────────────────────────────

  logActivity(category, action, actorId, actorName, data = {}) {
    this.data.activityLog.unshift({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category,
      action,
      actorId,
      actorName,
      data,
      createdAt: new Date().toISOString(),
    });
    if (this.data.activityLog.length > 500) {
      this.data.activityLog = this.data.activityLog.slice(0, 500);
    }
  }

  getActivityLog(filter = {}, limit = 50) {
    let result = [...this.data.activityLog];
    if (filter.category) result = result.filter((l) => l.category === filter.category);
    if (filter.actorId) result = result.filter((l) => l.actorId === filter.actorId);
    return result.slice(0, limit);
  }

  // ─────────────────────────────────────────────────────────────
  // 仪表板
  // ─────────────────────────────────────────────────────────────

  getDashboardSummary() {
    const goals = this.data.goals;
    const tasks = this.data.tasks;
    const kpis = this.data.kpis;
    return {
      goals: {
        total: goals.length,
        pending: goals.filter((g) => g.status === 'pending').length,
        inProgress: goals.filter((g) => g.status === 'in_progress').length,
        completed: goals.filter((g) => g.status === 'completed').length,
        avgProgress: goals.length ? Math.round(goals.reduce((sum, g) => sum + (g.progress || 0), 0) / goals.length) : 0,
      },
      tasks: {
        total: tasks.length,
        todo: tasks.filter((t) => t.status === 'todo').length,
        inProgress: tasks.filter((t) => t.status === 'in_progress').length,
        review: tasks.filter((t) => t.status === 'review').length,
        done: tasks.filter((t) => t.status === 'done').length,
        highPriority: tasks.filter((t) => t.priority === 'high' && t.status !== 'done').length,
      },
      kpis: {
        total: kpis.length,
        onTrack: kpis.filter((k) => {
          const ratio = k.target ? k.current / k.target : 0;
          if (k.direction === 'higher_better') return ratio >= 0.8;
          if (k.direction === 'lower_better') return ratio <= 1.2;
          return ratio >= 0.9 && ratio <= 1.1;
        }).length,
        atRisk: kpis.filter((k) => {
          const ratio = k.target ? k.current / k.target : 0;
          if (k.direction === 'higher_better') return ratio < 0.5;
          if (k.direction === 'lower_better') return ratio > 1.5;
          return false;
        }).length,
      },
      recentActivity: this.getActivityLog({}, 10),
    };
  }

  notify() {
    for (const callback of this.subscribers) {
      try {
        callback(this.data);
      } catch (error) {
        logger.error('通知订阅者失败', error);
      }
    }
  }
}

const operationsStore = new OperationsStore();

module.exports = { OperationsStore, operationsStore };
