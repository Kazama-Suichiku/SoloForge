/**
 * SoloForge - 公司运营数据存储
 * 管理目标、KPI、任务、审批记录等运营数据
 * @module operations/operations-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getConfigDir() {
  return dataPath.getBasePath();
}

function getOperationsFile() {
  return path.join(dataPath.getBasePath(), 'operations.json');
}

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
 * @property {string} unit - 单位（如 "%" "次" "个"）
 * @property {number} target - 目标值
 * @property {number} current - 当前值
 * @property {'higher_better' | 'lower_better' | 'target_exact'} direction - 方向
 * @property {string} period - 周期（如 "2026-Q1" "2026-02"）
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
 * @property {'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'} status - 状态
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {string} [completedAt]
 * @property {string} [dueDate]
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

/**
 * 运营数据存储
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

  /**
   * 确保配置目录存在
   */
  ensureConfigDir() {
    const dir = getConfigDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 从磁盘加载数据
   */
  loadFromDisk() {
    try {
      const opsFile = getOperationsFile();
      if (fs.existsSync(opsFile)) {
        const content = fs.readFileSync(opsFile, 'utf-8');
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

  /**
   * 保存到磁盘
   */
  saveToDisk() {
    try {
      this.ensureConfigDir();
      const content = JSON.stringify(
        {
          version: 1,
          lastUpdated: new Date().toISOString(),
          ...this.data,
        },
        null,
        2
      );
      fs.writeFileSync(getOperationsFile(), content, 'utf-8');
    } catch (error) {
      logger.error('保存运营数据失败', error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 目标管理
  // ─────────────────────────────────────────────────────────────

  /**
   * 创建目标
   * @param {Partial<Goal>} params
   * @returns {Goal}
   */
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

  /**
   * 更新目标
   * @param {string} goalId
   * @param {Partial<Goal>} updates
   * @param {string} actorId
   * @param {string} actorName
   * @returns {Goal | null}
   */
  updateGoal(goalId, updates, actorId, actorName) {
    const goal = this.data.goals.find((g) => g.id === goalId);
    if (!goal) return null;

    const oldStatus = goal.status;
    const oldProgress = goal.progress;

    Object.assign(goal, updates, { updatedAt: new Date().toISOString() });

    // 记录状态变化
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

  /**
   * 获取所有目标
   * @param {Object} [filter]
   * @returns {Goal[]}
   */
  getGoals(filter = {}) {
    let result = [...this.data.goals];

    if (filter.status) {
      result = result.filter((g) => g.status === filter.status);
    }
    if (filter.department) {
      result = result.filter((g) => g.department === filter.department);
    }
    if (filter.ownerId) {
      result = result.filter((g) => g.ownerId === filter.ownerId);
    }
    if (filter.type) {
      result = result.filter((g) => g.type === filter.type);
    }

    return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // ─────────────────────────────────────────────────────────────
  // KPI 管理
  // ─────────────────────────────────────────────────────────────

  /**
   * 创建 KPI
   * @param {Partial<KPI>} params
   * @returns {KPI}
   */
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

  /**
   * 更新 KPI 值
   * @param {string} kpiId
   * @param {number} value
   * @param {string} actorId
   * @param {string} actorName
   * @returns {KPI | null}
   */
  updateKPIValue(kpiId, value, actorId, actorName) {
    const kpi = this.data.kpis.find((k) => k.id === kpiId);
    if (!kpi) return null;

    const oldValue = kpi.current;
    kpi.current = value;
    kpi.history.push({
      date: new Date().toISOString(),
      value,
    });

    this.logActivity('kpi', `KPI 更新: ${kpi.name} ${oldValue} → ${value} ${kpi.unit}`, actorId, actorName, { kpiId });
    this.saveToDisk();
    this.notify();
    return kpi;
  }

  /**
   * 获取所有 KPI
   * @param {Object} [filter]
   * @returns {KPI[]}
   */
  getKPIs(filter = {}) {
    let result = [...this.data.kpis];

    if (filter.department) {
      result = result.filter((k) => k.department === filter.department);
    }
    if (filter.ownerId) {
      result = result.filter((k) => k.ownerId === filter.ownerId);
    }
    if (filter.period) {
      result = result.filter((k) => k.period === filter.period);
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // 任务管理
  // ─────────────────────────────────────────────────────────────

  /**
   * 创建任务
   * @param {Partial<Task>} params
   * @returns {Task}
   */
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
      status: 'todo',
      createdAt: new Date().toISOString(),
      dueDate: params.dueDate,
    };

    this.data.tasks.push(task);
    this.logActivity('task', `创建任务: ${task.title} → ${task.assigneeName}`, params.requesterId, params.requesterName, { taskId: task.id });
    this.saveToDisk();
    this.notify();
    return task;
  }

  /**
   * 更新任务
   * @param {string} taskId
   * @param {Partial<Task>} updates
   * @param {string} actorId
   * @param {string} actorName
   * @returns {Task | null}
   */
  updateTask(taskId, updates, actorId, actorName) {
    const task = this.data.tasks.find((t) => t.id === taskId);
    if (!task) return null;

    const oldStatus = task.status;
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });

    if (updates.status === 'done' && oldStatus !== 'done') {
      task.completedAt = new Date().toISOString();
    }

    if (updates.status && updates.status !== oldStatus) {
      this.logActivity('task', `任务状态: ${task.title} → ${updates.status}`, actorId, actorName, { taskId });
    }

    this.saveToDisk();
    this.notify();
    return task;
  }

  /**
   * 获取单个任务
   * @param {string} taskId
   * @returns {Task | null}
   */
  getTask(taskId) {
    return this.data.tasks.find((t) => t.id === taskId) || null;
  }

  /**
   * 获取所有任务
   * @param {Object} [filter]
   * @returns {Task[]}
   */
  getTasks(filter = {}) {
    let result = [...this.data.tasks];

    if (filter.status) {
      result = result.filter((t) => t.status === filter.status);
    }
    if (filter.assigneeId) {
      result = result.filter((t) => t.assigneeId === filter.assigneeId);
    }
    if (filter.requesterId) {
      result = result.filter((t) => t.requesterId === filter.requesterId);
    }
    if (filter.goalId) {
      result = result.filter((t) => t.goalId === filter.goalId);
    }
    if (filter.priority) {
      result = result.filter((t) => t.priority === filter.priority);
    }

    return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // ─────────────────────────────────────────────────────────────
  // 活动日志
  // ─────────────────────────────────────────────────────────────

  /**
   * 记录活动
   * @param {string} category
   * @param {string} action
   * @param {string} actorId
   * @param {string} actorName
   * @param {Object} [data]
   */
  logActivity(category, action, actorId, actorName, data = {}) {
    const log = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category,
      action,
      actorId,
      actorName,
      data,
      createdAt: new Date().toISOString(),
    };

    this.data.activityLog.unshift(log);

    // 只保留最近 500 条
    if (this.data.activityLog.length > 500) {
      this.data.activityLog = this.data.activityLog.slice(0, 500);
    }
  }

  /**
   * 获取活动日志
   * @param {Object} [filter]
   * @param {number} [limit]
   * @returns {ActivityLog[]}
   */
  getActivityLog(filter = {}, limit = 50) {
    let result = [...this.data.activityLog];

    if (filter.category) {
      result = result.filter((l) => l.category === filter.category);
    }
    if (filter.actorId) {
      result = result.filter((l) => l.actorId === filter.actorId);
    }

    return result.slice(0, limit);
  }

  // ─────────────────────────────────────────────────────────────
  // 仪表板统计
  // ─────────────────────────────────────────────────────────────

  /**
   * 获取仪表板摘要数据
   * @returns {Object}
   */
  getDashboardSummary() {
    const goals = this.data.goals;
    const tasks = this.data.tasks;
    const kpis = this.data.kpis;

    // 目标统计
    const goalStats = {
      total: goals.length,
      pending: goals.filter((g) => g.status === 'pending').length,
      inProgress: goals.filter((g) => g.status === 'in_progress').length,
      completed: goals.filter((g) => g.status === 'completed').length,
      avgProgress: goals.length
        ? Math.round(goals.reduce((sum, g) => sum + (g.progress || 0), 0) / goals.length)
        : 0,
    };

    // 任务统计
    const taskStats = {
      total: tasks.length,
      todo: tasks.filter((t) => t.status === 'todo').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      review: tasks.filter((t) => t.status === 'review').length,
      done: tasks.filter((t) => t.status === 'done').length,
      highPriority: tasks.filter((t) => t.priority === 'high' && t.status !== 'done').length,
    };

    // KPI 统计
    const kpiStats = {
      total: kpis.length,
      onTrack: kpis.filter((k) => {
        const ratio = k.current / k.target;
        if (k.direction === 'higher_better') return ratio >= 0.8;
        if (k.direction === 'lower_better') return ratio <= 1.2;
        return ratio >= 0.9 && ratio <= 1.1;
      }).length,
      atRisk: kpis.filter((k) => {
        const ratio = k.current / k.target;
        if (k.direction === 'higher_better') return ratio < 0.5;
        if (k.direction === 'lower_better') return ratio > 1.5;
        return false;
      }).length,
    };

    return {
      goals: goalStats,
      tasks: taskStats,
      kpis: kpiStats,
      recentActivity: this.getActivityLog({}, 10),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 订阅
  // ─────────────────────────────────────────────────────────────

  /**
   * 订阅数据变更
   * @param {Function} callback
   * @returns {Function} 取消订阅
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * 重新初始化（切换公司后调用）
   * 清空内存状态并从新路径重新加载
   */
  reinitialize() {
    this.data = {
      goals: [],
      kpis: [],
      tasks: [],
      activityLog: [],
    };
    this.loadFromDisk();
  }

  /**
   * 通知订阅者
   */
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

// 单例
const operationsStore = new OperationsStore();

module.exports = { OperationsStore, operationsStore };
