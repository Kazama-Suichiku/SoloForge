/**
 * SoloForge - 任务管理器
 * 统一管理中断任务的查看、重试和取消
 * @module collaboration/task-manager
 */

const { logger } = require('../utils/logger');
const { agentConfigStore } = require('../config/agent-config-store');

// 任务状态阈值（毫秒）
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 分钟未更新视为停滞

/**
 * 任务管理器
 * 提供统一的任务重试、取消和查询接口
 */
class TaskManager {
  constructor() {
    this.agentCommunication = null;
    this.operationsStore = null;
    this.projectStore = null;
    this.chatManager = null;
  }

  /**
   * 初始化（注入依赖）
   * @param {Object} deps
   */
  initialize(deps) {
    this.agentCommunication = deps.agentCommunication;
    this.operationsStore = deps.operationsStore;
    this.projectStore = deps.projectStore;
    this.chatManager = deps.chatManager;
    logger.info('TaskManager 已初始化');
  }

  // ═══════════════════════════════════════════════════════════════
  // 查询中断任务
  // ═══════════════════════════════════════════════════════════════

  /**
   * 获取所有中断/停滞的任务
   * 包括所有未完成且当前没有在活跃处理的任务
   * @returns {{delegatedTasks: Array, opsTasks: Array, projectTasks: Array, summary: Object}}
   */
  getInterruptedTasks() {
    const now = Date.now();
    const result = {
      delegatedTasks: [],
      opsTasks: [],
      projectTasks: [],
      summary: {
        total: 0,
        delegated: 0,
        ops: 0,
        project: 0,
      },
    };

    // 获取当前活跃任务的 Agent ID 列表（正在被 chatManager 处理的）
    const activeAgentIds = new Set();
    if (this.chatManager && this.chatManager.activeTasks) {
      for (const agentId of this.chatManager.activeTasks.keys()) {
        activeAgentIds.add(agentId);
      }
    }

    // 1. 委派任务：所有未完成的（pending, in_progress, failed）
    if (this.agentCommunication) {
      const tasks = this.agentCommunication.delegatedTasks || [];
      for (const task of tasks) {
        // 排除已完成和已取消的任务
        if (['completed', 'cancelled'].includes(task.status)) continue;
        
        // 检查执行者是否正在活跃处理中
        const isActivelyProcessing = activeAgentIds.has(task.toAgent);
        
        const fromConfig = agentConfigStore.get(task.fromAgent);
        const toConfig = agentConfigStore.get(task.toAgent);
        
        result.delegatedTasks.push({
          id: task.id,
          type: 'delegated',
          title: this._truncate(task.task, 80),
          fullTask: task.task,
          fromAgent: task.fromAgent,
          fromAgentName: fromConfig?.name || task.fromAgent,
          toAgent: task.toAgent,
          toAgentName: toConfig?.name || task.toAgent,
          status: task.status,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt || task.createdAt,
          result: task.result,
          isStale: this._isStale(task.updatedAt || task.createdAt, now),
          isActivelyProcessing,
          executorStatus: toConfig?.status || 'unknown',
          canRetry: !isActivelyProcessing && this._canRetryDelegatedTask(task, toConfig),
        });
      }
    }

    // 2. 运营任务：所有未完成的（todo, in_progress, review）
    if (this.operationsStore) {
      const tasks = this.operationsStore.getTasks() || [];
      for (const task of tasks) {
        // 排除已完成和已取消的任务
        if (['done', 'cancelled'].includes(task.status)) continue;
        
        const isStale = this._isStale(task.updatedAt || task.createdAt, now);
        const assigneeConfig = agentConfigStore.get(task.assigneeId);
        
        result.opsTasks.push({
          id: task.id,
          type: 'ops',
          title: task.title,
          description: task.description,
          assigneeId: task.assigneeId,
          assigneeName: task.assigneeName,
          requesterId: task.requesterId,
          requesterName: task.requesterName,
          status: task.status,
          priority: task.priority,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt || task.createdAt,
          dueDate: task.dueDate,
          isStale,
          assigneeStatus: assigneeConfig?.status || 'unknown',
          canRetry: assigneeConfig?.status === 'active',
        });
      }
    }

    // 3. 项目任务：所有未完成的（todo, in_progress, review, blocked, paused）
    if (this.projectStore) {
      const projects = this.projectStore.getProjects() || [];
      for (const project of projects) {
        // 排除已取消的项目
        if (project.status === 'cancelled') continue;
        
        for (const task of project.tasks || []) {
          // 排除已完成和已取消的任务
          if (['done', 'cancelled'].includes(task.status)) continue;
          
          const isStale = this._isStale(task.createdAt, now);
          const assigneeConfig = task.assigneeId ? agentConfigStore.get(task.assigneeId) : null;
          
          result.projectTasks.push({
            id: task.id,
            type: 'project',
            title: task.title,
            description: task.description,
            projectId: project.id,
            projectName: project.name,
            milestoneId: task.milestoneId,
            assigneeId: task.assigneeId,
            assigneeName: task.assigneeName,
            status: task.status,
            priority: task.priority,
            createdAt: task.createdAt,
            dueDate: task.dueDate,
            blockerNote: task.blockerNote,
            isStale,
            assigneeStatus: assigneeConfig?.status || 'unknown',
            canRetry: task.status !== 'blocked' && (!assigneeConfig || assigneeConfig.status === 'active'),
          });
        }
      }
    }

    // 汇总
    result.summary.delegated = result.delegatedTasks.length;
    result.summary.ops = result.opsTasks.length;
    result.summary.project = result.projectTasks.length;
    result.summary.total = result.summary.delegated + result.summary.ops + result.summary.project;

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // 重试任务
  // ═══════════════════════════════════════════════════════════════

  /**
   * 重试任务
   * @param {'delegated'|'ops'|'project'} taskType
   * @param {string} taskId
   * @returns {Promise<{success: boolean, message?: string, error?: string}>}
   */
  async retry(taskType, taskId) {
    switch (taskType) {
      case 'delegated':
        return this._retryDelegatedTask(taskId);
      case 'ops':
        return this._retryOpsTask(taskId);
      case 'project':
        return this._retryProjectTask(taskId);
      default:
        return { success: false, error: `未知任务类型: ${taskType}` };
    }
  }

  /**
   * 重试委派任务
   * @param {string} taskId
   */
  async _retryDelegatedTask(taskId) {
    if (!this.agentCommunication) {
      return { success: false, error: '通信系统未初始化' };
    }

    const task = this.agentCommunication.delegatedTasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `任务不存在: ${taskId}` };
    }

    // 检查执行者状态
    const toConfig = agentConfigStore.get(task.toAgent);
    if (!toConfig) {
      return { success: false, error: `执行者不存在: ${task.toAgent}` };
    }
    if (toConfig.status === 'terminated') {
      return { success: false, error: `执行者「${toConfig.name}」已离职，无法重试` };
    }
    if (toConfig.status === 'suspended') {
      return { success: false, error: `执行者「${toConfig.name}」处于停职状态，无法重试` };
    }

    // 如果任务正在执行，先尝试中止
    if (task.status === 'in_progress' && this.chatManager) {
      this.chatManager._abortTask(task.toAgent, '任务重试');
    }

    // 重置状态并记录重试
    const retryCount = (task.retryCount || 0) + 1;
    this.agentCommunication.updateTask(taskId, {
      status: 'pending',
      result: null,
      retryCount,
      lastRetryAt: new Date().toISOString(),
      previousStatus: task.status,
    });

    logger.info('委派任务重试', { taskId, retryCount, executor: task.toAgent });

    // 异步执行任务
    setImmediate(async () => {
      try {
        await this.agentCommunication.executeTask(taskId);
      } catch (error) {
        logger.error('重试任务执行失败', { taskId, error: error.message });
      }
    });

    return {
      success: true,
      message: `任务已重新提交给「${toConfig.name}」执行（第 ${retryCount} 次重试）`,
    };
  }

  /**
   * 重试运营任务
   * @param {string} taskId
   */
  async _retryOpsTask(taskId) {
    if (!this.operationsStore) {
      return { success: false, error: '运营系统未初始化' };
    }

    const tasks = this.operationsStore.getTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `任务不存在: ${taskId}` };
    }

    // 检查负责人状态
    const assigneeConfig = agentConfigStore.get(task.assigneeId);
    if (!assigneeConfig) {
      return { success: false, error: `负责人不存在: ${task.assigneeId}` };
    }
    if (assigneeConfig.status !== 'active') {
      return { success: false, error: `负责人「${assigneeConfig.name}」状态异常（${assigneeConfig.status}）` };
    }

    // 重置为 in_progress 状态（表示正在处理）
    this.operationsStore.updateTask(taskId, {
      status: 'in_progress',
      updatedAt: new Date().toISOString(),
    });

    logger.info('运营任务重试', { taskId, assignee: task.assigneeName });

    // 通知 Agent 处理任务
    if (this.agentCommunication && task.assigneeId) {
      setImmediate(async () => {
        try {
          const notifyMessage = `【任务提醒】老板要求你立即处理以下运营任务：\n\n` +
            `**任务标题**：${task.title}\n` +
            `**任务描述**：${task.description || '无'}\n` +
            `**优先级**：${task.priority || '普通'}\n` +
            `**截止日期**：${task.dueDate || '无'}\n\n` +
            `请使用 ops_report_progress 工具汇报进度，完成后使用 ops_update_task 更新任务状态为 done。`;
          
          await this.agentCommunication.sendMessage({
            fromAgent: 'boss',
            toAgent: task.assigneeId,
            message: notifyMessage,
            allowTools: true,
          });
          logger.info('运营任务重试通知已发送', { taskId, assignee: task.assigneeId });
        } catch (error) {
          logger.error('运营任务重试通知失败', { taskId, error: error.message });
        }
      });
    }

    return {
      success: true,
      message: `任务「${task.title}」已重新分配给「${assigneeConfig.name}」处理`,
    };
  }

  /**
   * 重试项目任务
   * @param {string} taskId
   */
  async _retryProjectTask(taskId) {
    if (!this.projectStore) {
      return { success: false, error: '项目系统未初始化' };
    }

    // 查找任务所属项目
    const projects = this.projectStore.listProjects();
    let targetProject = null;
    let targetTask = null;

    for (const project of projects) {
      const task = (project.tasks || []).find((t) => t.id === taskId);
      if (task) {
        targetProject = project;
        targetTask = task;
        break;
      }
    }

    if (!targetTask) {
      return { success: false, error: `任务不存在: ${taskId}` };
    }

    // paused → in_progress, blocked → todo
    const newStatus = targetTask.status === 'paused' ? 'in_progress' : 'todo';

    this.projectStore.updateTask(targetProject.id, taskId, {
      status: newStatus,
      blockerNote: null,
      pausedAt: null,
    });

    logger.info('项目任务重试', { taskId, projectId: targetProject.id, newStatus });

    return {
      success: true,
      message: `任务「${targetTask.title}」已恢复为${newStatus === 'in_progress' ? '进行中' : '待办'}状态`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 取消任务
  // ═══════════════════════════════════════════════════════════════

  /**
   * 批量取消任务
   * @param {Array<{type: string, id: string}>} tasks
   * @param {string} reason
   * @returns {{success: boolean, cancelled: number, errors: string[]}}
   */
  cancelBatch(tasks, reason = '用户手动取消') {
    const result = { success: true, cancelled: 0, errors: [] };

    for (const { type, id } of tasks) {
      try {
        this._cancelSingle(type, id, reason);
        result.cancelled++;
      } catch (error) {
        result.errors.push(`${type}:${id} - ${error.message}`);
      }
    }

    if (result.errors.length > 0) {
      result.success = result.cancelled > 0;
    }

    logger.info('批量取消任务', { cancelled: result.cancelled, errors: result.errors.length });
    return result;
  }

  /**
   * 取消单个任务
   */
  _cancelSingle(taskType, taskId, reason) {
    switch (taskType) {
      case 'delegated':
        if (this.agentCommunication) {
          const task = this.agentCommunication.delegatedTasks.find((t) => t.id === taskId);
          if (task) {
            // 如果正在执行，先中止
            if (task.status === 'in_progress' && this.chatManager) {
              this.chatManager._abortTask(task.toAgent, '任务取消');
            }
            this.agentCommunication.updateTask(taskId, {
              status: 'cancelled',
              result: reason,
              cancelledAt: new Date().toISOString(),
            });
          }
        }
        break;

      case 'ops':
        if (this.operationsStore) {
          this.operationsStore.updateTask(taskId, {
            status: 'cancelled',
            cancelReason: reason,
            cancelledAt: new Date().toISOString(),
          });
        }
        break;

      case 'project':
        if (this.projectStore) {
          const projects = this.projectStore.listProjects();
          for (const project of projects) {
            const task = (project.tasks || []).find((t) => t.id === taskId);
            if (task) {
              this.projectStore.updateTask(project.id, taskId, {
                status: 'cancelled',
                cancelReason: reason,
                cancelledAt: Date.now(),
              });
              break;
            }
          }
        }
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 辅助方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * 判断任务是否停滞
   */
  _isStale(timestamp, now = Date.now()) {
    if (!timestamp) return true;
    const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
    return now - ts > STALE_THRESHOLD_MS;
  }

  /**
   * 判断委派任务是否可以重试
   */
  _canRetryDelegatedTask(task, toConfig) {
    if (!toConfig) return false;
    if (toConfig.status === 'terminated') return false;
    if (toConfig.status === 'suspended') return false;
    return true;
  }

  /**
   * 截断文本
   */
  _truncate(text, maxLen = 80) {
    if (!text || text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  }
}

// 单例
const taskManager = new TaskManager();

module.exports = { TaskManager, taskManager };
