/**
 * SoloForge - 项目管理数据存储
 * 企业级项目管理数据模型：项目 → 里程碑 → 任务
 * @module pm/project-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getConfigDir() {
  return dataPath.getBasePath();
}

function getProjectsFile() {
  return path.join(dataPath.getBasePath(), 'projects.json');
}

// ─────────────────────────────────────────────────────────────
// 数据模型
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name - 项目名称
 * @property {string} description - 项目描述
 * @property {'planning'|'active'|'on_hold'|'completed'|'cancelled'} status
 * @property {string} ownerId - 项目负责人 Agent ID（如 cto）
 * @property {string} ownerName
 * @property {string} [goalId] - 关联的运营目标 ID
 * @property {number} progress - 0-100 自动计算
 * @property {Milestone[]} milestones
 * @property {ProjectTask[]} tasks
 * @property {number} standupIntervalMs - 站会间隔（毫秒）
 * @property {number} nextStandupAt - 下次站会时间戳
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} Milestone
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {number} order - 排序序号
 * @property {'pending'|'in_progress'|'completed'|'cancelled'} status
 * @property {number} progress - 0-100 自动计算
 * @property {string} [dueDate] - YYYY-MM-DD
 */

/**
 * @typedef {Object} ProjectTask
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} milestoneId - 所属里程碑
 * @property {string} [assigneeId] - 执行人 Agent ID
 * @property {string} [assigneeName]
 * @property {'todo'|'in_progress'|'review'|'done'|'blocked'|'cancelled'|'paused'} status
 * @property {'high'|'medium'|'low'} priority
 * @property {string[]} dependencies - 依赖的任务 ID 列表
 * @property {string} [delegatedTaskId] - 关联的委派任务 ID
 * @property {string} [opsTaskId] - 关联的运营 task ID
 * @property {string} [dueDate]
 * @property {number} [estimateHours]
 * @property {string} [blockerNote] - 阻塞原因
 * @property {string} [cancelReason] - 取消原因（项目取消时自动设置）
 * @property {ProgressNote[]} progressNotes
 * @property {number} [completedAt]
 * @property {number} [cancelledAt] - 取消时间
 * @property {number} [pausedAt] - 暂停时间
 * @property {number} createdAt
 */

/**
 * @typedef {Object} ProgressNote
 * @property {string} content
 * @property {string} updatedBy - Agent ID
 * @property {string} updatedByName
 * @property {number} timestamp
 */

class ProjectStore {
  constructor() {
    this.data = {
      version: 1,
      projects: [],
    };
    this.subscribers = new Set();
    this.loadFromDisk();
  }

  // ─────────────────────────────────────────────────────────────
  // 持久化
  // ─────────────────────────────────────────────────────────────

  loadFromDisk() {
    try {
      const projectsFile = getProjectsFile();
      if (fs.existsSync(projectsFile)) {
        const content = fs.readFileSync(projectsFile, 'utf-8');
        const saved = JSON.parse(content);
        this.data = {
          version: saved.version || 1,
          projects: saved.projects || [],
        };
        logger.info('项目数据已加载', { count: this.data.projects.length });
      }
    } catch (error) {
      logger.error('加载项目数据失败', error);
    }
  }

  saveToDisk() {
    try {
      const configDir = getConfigDir();
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(
        getProjectsFile(),
        JSON.stringify({ ...this.data, lastUpdated: new Date().toISOString() }, null, 2),
        'utf-8'
      );
    } catch (error) {
      logger.error('保存项目数据失败', error);
    }
  }

  notify() {
    for (const cb of this.subscribers) {
      try { cb(this.data); } catch (e) { logger.error('项目订阅通知失败', e); }
    }
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * 重新初始化（切换公司后调用）
   * 清空内存状态并从新路径重新加载
   */
  reinitialize() {
    this.data = { version: 1, projects: [] };
    this.loadFromDisk();
  }

  _genId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // ─────────────────────────────────────────────────────────────
  // 项目 CRUD
  // ─────────────────────────────────────────────────────────────

  /**
   * 创建项目
   * @param {Object} params
   * @returns {Project}
   */
  createProject(params) {
    const project = {
      id: this._genId('proj'),
      name: params.name,
      description: params.description || '',
      status: 'planning',
      ownerId: params.ownerId,
      ownerName: params.ownerName || '',
      goalId: params.goalId || null,
      progress: 0,
      milestones: [],
      tasks: [],
      standupIntervalMs: params.standupIntervalMs || 30 * 60 * 1000, // 默认 30 分钟
      nextStandupAt: Date.now() + (params.standupIntervalMs || 30 * 60 * 1000),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.data.projects.push(project);
    this.saveToDisk();
    this.notify();
    logger.info('项目已创建', { id: project.id, name: project.name });
    return project;
  }

  /**
   * 获取项目
   * @param {string} projectId
   * @returns {Project|null}
   */
  getProject(projectId) {
    return this.data.projects.find((p) => p.id === projectId) || null;
  }

  /**
   * 获取项目列表
   * @param {Object} [filter]
   * @returns {Project[]}
   */
  getProjects(filter = {}) {
    let result = [...this.data.projects];
    if (filter.status) result = result.filter((p) => p.status === filter.status);
    if (filter.ownerId) result = result.filter((p) => p.ownerId === filter.ownerId);
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 更新项目
   * @param {string} projectId
   * @param {Object} updates
   * @returns {Project|null}
   */
  updateProject(projectId, updates) {
    const project = this.getProject(projectId);
    if (!project) return null;

    const oldStatus = project.status;

    Object.assign(project, updates, { updatedAt: Date.now() });
    this.saveToDisk();
    this.notify();

    // 状态变更为取消/暂停时，级联处理任务
    if (updates.status && updates.status !== oldStatus) {
      if (updates.status === 'cancelled') {
        this._cascadeCancelTasks(project);
      } else if (updates.status === 'on_hold') {
        this._cascadePauseTasks(project);
      }
    }

    return project;
  }

  /**
   * 级联取消项目内所有未完成的任务
   * @param {Project} project
   * @private
   */
  _cascadeCancelTasks(project) {
    const cancelledTaskIds = [];

    for (const task of project.tasks) {
      // 只取消未完成的任务
      if (task.status !== 'done' && task.status !== 'cancelled') {
        task.status = 'cancelled';
        task.cancelledAt = Date.now();
        task.cancelReason = '项目已取消';
        cancelledTaskIds.push({ id: task.id, delegatedTaskId: task.delegatedTaskId });
      }
    }

    // 同步更新里程碑状态
    for (const ms of project.milestones) {
      if (ms.status !== 'completed') {
        ms.status = 'cancelled';
      }
    }

    if (cancelledTaskIds.length > 0) {
      this.saveToDisk();
      logger.info(`项目取消，级联取消 ${cancelledTaskIds.length} 个 PM 任务`, {
        projectId: project.id,
        projectName: project.name,
      });

      // 异步取消委派任务（避免循环依赖，延迟加载）
      setImmediate(() => {
        this._cancelDelegatedTasks(cancelledTaskIds);
      });
    }

    // 同时取消 Operations Store 中关联此项目的任务
    setImmediate(() => {
      this._cancelOperationsTasks(project.id, project.name);
    });
  }

  /**
   * 取消 Operations Store 中关联此项目的任务
   * @param {string} projectId
   * @param {string} projectName
   * @private
   */
  _cancelOperationsTasks(projectId, projectName) {
    try {
      const { operationsStore } = require('../operations/operations-store');
      const result = operationsStore.cancelTasksByProject(projectId, `项目「${projectName}」已取消`);
      if (result.cancelledCount > 0) {
        logger.info(`项目取消，级联取消 ${result.cancelledCount} 个 Operations 任务`, { projectId });
      }
    } catch (error) {
      logger.error('取消 Operations 任务失败', error);
    }
  }

  /**
   * 取消关联的委派任务
   * @param {Array<{id: string, delegatedTaskId: string|null}>} taskInfos
   * @private
   */
  _cancelDelegatedTasks(taskInfos) {
    try {
      const { agentCommunication } = require('../collaboration/agent-communication');
      
      for (const taskInfo of taskInfos) {
        if (taskInfo.delegatedTaskId) {
          const delegated = agentCommunication.delegatedTasks.find(
            (t) => t.id === taskInfo.delegatedTaskId
          );
          if (delegated && delegated.status !== 'completed' && delegated.status !== 'cancelled') {
            delegated.status = 'cancelled';
            delegated.result = '关联项目已取消';
            delegated.completedAt = Date.now();
            logger.debug(`委派任务已取消: ${delegated.id}`);
          }
        }
      }

      agentCommunication._saveToDisk();
    } catch (error) {
      logger.error('取消委派任务失败', error);
    }
  }

  /**
   * 级联暂停项目内所有进行中的任务
   * @param {Project} project
   * @private
   */
  _cascadePauseTasks(project) {
    let pausedCount = 0;

    for (const task of project.tasks) {
      // 只暂停进行中的任务
      if (task.status === 'in_progress') {
        task.status = 'paused';
        task.pausedAt = Date.now();
        pausedCount++;
      }
    }

    if (pausedCount > 0) {
      this.saveToDisk();
      logger.info(`项目暂停，级联暂停 ${pausedCount} 个任务`, {
        projectId: project.id,
        projectName: project.name,
      });
    }
  }

  /**
   * 删除项目
   * @param {string} projectId
   * @returns {{ success: boolean, error?: string }}
   */
  deleteProject(projectId) {
    const idx = this.data.projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return { success: false, error: '项目不存在' };

    const project = this.data.projects[idx];
    this.data.projects.splice(idx, 1);
    this.saveToDisk();
    this.notify();
    logger.info('项目已删除', { id: projectId, name: project.name });
    return { success: true, deletedProject: { id: project.id, name: project.name } };
  }

  // ─────────────────────────────────────────────────────────────
  // 里程碑管理
  // ─────────────────────────────────────────────────────────────

  /**
   * 添加里程碑
   * @param {string} projectId
   * @param {Object} params
   * @returns {Milestone|null}
   */
  addMilestone(projectId, params) {
    const project = this.getProject(projectId);
    if (!project) return null;

    const milestone = {
      id: this._genId('ms'),
      name: params.name,
      description: params.description || '',
      order: params.order ?? project.milestones.length,
      status: 'pending',
      progress: 0,
      dueDate: params.dueDate || null,
    };

    project.milestones.push(milestone);
    project.milestones.sort((a, b) => a.order - b.order);
    project.updatedAt = Date.now();
    this.saveToDisk();
    this.notify();
    return milestone;
  }

  /**
   * 更新里程碑
   */
  updateMilestone(projectId, milestoneId, updates) {
    const project = this.getProject(projectId);
    if (!project) return null;
    const ms = project.milestones.find((m) => m.id === milestoneId);
    if (!ms) return null;

    Object.assign(ms, updates);
    project.updatedAt = Date.now();
    this.saveToDisk();
    this.notify();
    return ms;
  }

  // ─────────────────────────────────────────────────────────────
  // 任务管理
  // ─────────────────────────────────────────────────────────────

  /**
   * 添加任务到项目
   * @param {string} projectId
   * @param {Object} params
   * @returns {ProjectTask|null}
   */
  addTask(projectId, params) {
    const project = this.getProject(projectId);
    if (!project) return null;

    const task = {
      id: this._genId('ptask'),
      title: params.title,
      description: params.description || '',
      milestoneId: params.milestoneId,
      assigneeId: params.assigneeId || null,
      assigneeName: params.assigneeName || '',
      status: 'todo',
      priority: params.priority || 'medium',
      dependencies: params.dependencies || [],
      delegatedTaskId: null,
      opsTaskId: null,
      dueDate: params.dueDate || null,
      estimateHours: params.estimateHours || null,
      blockerNote: null,
      progressNotes: [],
      completedAt: null,
      createdAt: Date.now(),
    };

    project.tasks.push(task);
    project.updatedAt = Date.now();
    this.saveToDisk();
    this.notify();
    return task;
  }

  /**
   * 更新项目任务
   * @param {string} projectId
   * @param {string} taskId
   * @param {Object} updates
   * @returns {ProjectTask|null}
   */
  updateTask(projectId, taskId, updates) {
    const project = this.getProject(projectId);
    if (!project) return null;
    const task = project.tasks.find((t) => t.id === taskId);
    if (!task) return null;

    const oldStatus = task.status;
    Object.assign(task, updates);

    if (updates.status === 'done' && oldStatus !== 'done') {
      task.completedAt = Date.now();
    }

    project.updatedAt = Date.now();
    this.saveToDisk();
    this.notify();
    return task;
  }

  /**
   * 通过委派任务 ID 查找项目任务
   * @param {string} delegatedTaskId
   * @returns {{project: Project, task: ProjectTask}|null}
   */
  findByDelegatedTaskId(delegatedTaskId) {
    for (const project of this.data.projects) {
      const task = project.tasks.find((t) => t.delegatedTaskId === delegatedTaskId);
      if (task) return { project, task };
    }
    return null;
  }

  /**
   * 通过运营任务 ID 查找项目任务
   * @param {string} opsTaskId
   * @returns {{project: Project, task: ProjectTask}|null}
   */
  findByOpsTaskId(opsTaskId) {
    for (const project of this.data.projects) {
      const task = project.tasks.find((t) => t.opsTaskId === opsTaskId);
      if (task) return { project, task };
    }
    return null;
  }

  /**
   * 添加进度备注
   */
  addProgressNote(projectId, taskId, note) {
    const project = this.getProject(projectId);
    if (!project) return;
    const task = project.tasks.find((t) => t.id === taskId);
    if (!task) return;

    task.progressNotes.push({
      content: note.content,
      updatedBy: note.updatedBy,
      updatedByName: note.updatedByName || '',
      timestamp: Date.now(),
    });
    project.updatedAt = Date.now();
    this.saveToDisk();
  }

  // ─────────────────────────────────────────────────────────────
  // 进度计算（纯机械，不依赖 LLM）
  // ─────────────────────────────────────────────────────────────

  /**
   * 重新计算里程碑和项目进度
   * 注意：已取消（cancelled）的任务不计入进度统计
   * @param {string} projectId
   * @returns {number} 项目总进度
   */
  recalculateProgress(projectId) {
    const project = this.getProject(projectId);
    if (!project) return 0;

    // 计算每个里程碑的进度（排除已取消的任务）
    for (const ms of project.milestones) {
      // 如果里程碑本身已取消，跳过
      if (ms.status === 'cancelled') continue;

      const msTasks = project.tasks.filter(
        (t) => t.milestoneId === ms.id && t.status !== 'cancelled'
      );
      if (msTasks.length === 0) {
        ms.progress = 0;
        ms.status = 'pending';
        continue;
      }

      const doneTasks = msTasks.filter((t) => t.status === 'done').length;
      ms.progress = Math.round((doneTasks / msTasks.length) * 100);

      if (ms.progress >= 100) {
        ms.status = 'completed';
      } else if (msTasks.some((t) => t.status !== 'todo' && t.status !== 'paused')) {
        ms.status = 'in_progress';
      } else {
        ms.status = 'pending';
      }
    }

    // 计算项目总进度（排除已取消的任务）
    const activeTasks = project.tasks.filter((t) => t.status !== 'cancelled');
    if (activeTasks.length === 0) {
      project.progress = 0;
    } else {
      const doneTasks = activeTasks.filter((t) => t.status === 'done').length;
      project.progress = Math.round((doneTasks / activeTasks.length) * 100);
    }

    // 更新项目状态
    if (project.progress >= 100 && project.status === 'active') {
      project.status = 'completed';
    }

    project.updatedAt = Date.now();
    this.saveToDisk();
    this.notify();
    return project.progress;
  }

  // ─────────────────────────────────────────────────────────────
  // 查询辅助
  // ─────────────────────────────────────────────────────────────

  /**
   * 获取项目摘要（供 Dashboard 使用）
   * 注意：已取消的任务单独统计
   */
  getProjectsSummary() {
    return this.data.projects.map((p) => {
      const activeTasks = p.tasks.filter((t) => t.status !== 'cancelled');
      const cancelledTasks = p.tasks.filter((t) => t.status === 'cancelled');
      
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        owner: p.ownerName,
        progress: p.progress,
        milestoneCount: p.milestones.filter((m) => m.status !== 'cancelled').length,
        taskCount: activeTasks.length,
        tasksDone: activeTasks.filter((t) => t.status === 'done').length,
        tasksBlocked: activeTasks.filter((t) => t.status === 'blocked').length,
        tasksInProgress: activeTasks.filter((t) => t.status === 'in_progress').length,
        tasksCancelled: cancelledTasks.length,
        updatedAt: p.updatedAt,
      };
    });
  }

  /**
   * 获取逾期任务
   */
  getOverdueTasks(projectId) {
    const project = this.getProject(projectId);
    if (!project) return [];
    const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return project.tasks.filter(
      (t) => t.dueDate && t.dueDate < now && t.status !== 'done' && t.status !== 'blocked'
    );
  }

  /**
   * 获取被阻塞的任务
   */
  getBlockedTasks(projectId) {
    const project = this.getProject(projectId);
    if (!project) return [];
    return project.tasks.filter((t) => t.status === 'blocked');
  }

  /**
   * 检查任务依赖是否满足
   * @param {string} projectId
   * @param {string} taskId
   * @returns {boolean}
   */
  areDependenciesMet(projectId, taskId) {
    const project = this.getProject(projectId);
    if (!project) return true;
    const task = project.tasks.find((t) => t.id === taskId);
    if (!task || task.dependencies.length === 0) return true;

    return task.dependencies.every((depId) => {
      const dep = project.tasks.find((t) => t.id === depId);
      return dep && dep.status === 'done';
    });
  }
}

// 单例
const projectStore = new ProjectStore();

module.exports = { ProjectStore, projectStore };
