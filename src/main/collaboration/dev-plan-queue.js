/**
 * SoloForge - 开发计划审批队列
 * 管理员工 Agent 提交的开发计划审批流程
 * 员工提交计划 → Leader 审批 → 通过后解锁开发工具
 * @module collaboration/dev-plan-queue
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getConfigDir() {
  return dataPath.getBasePath();
}

function getPlansFile() {
  return path.join(dataPath.getBasePath(), 'dev-plans.json');
}

/**
 * @typedef {Object} DevPlan
 * @property {string} id - 计划 ID
 * @property {string} taskId - 关联的委派任务 ID
 * @property {string} agentId - 提交者 Agent ID
 * @property {string} agentName - 提交者名称
 * @property {string} reviewerId - 审批者 Agent ID (= task.fromAgent)
 * @property {string} reviewerName - 审批者名称
 * @property {string} content - 计划内容
 * @property {'pending' | 'approved' | 'rejected'} status - 状态
 * @property {string} [feedback] - 驳回理由
 * @property {string} [approveComment] - 批准备注
 * @property {number} revisionCount - 修订次数
 * @property {number} createdAt - 创建时间
 * @property {number} [reviewedAt] - 审批时间
 */

/**
 * 开发计划审批队列管理器
 */
class DevPlanQueue {
  constructor() {
    /** @type {DevPlan[]} */
    this.plans = [];
    /** @type {Set<Function>} */
    this.listeners = new Set();

    this._ensureConfigDir();
    this._loadFromDisk();
  }

  /**
   * 确保配置目录存在
   */
  _ensureConfigDir() {
    const dir = getConfigDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 从磁盘加载
   */
  _loadFromDisk() {
    try {
      const plansFile = getPlansFile();
      if (fs.existsSync(plansFile)) {
        const content = fs.readFileSync(plansFile, 'utf-8');
        const data = JSON.parse(content);
        this.plans = data.plans || [];
        logger.debug(`加载了 ${this.plans.length} 条开发计划`);
      }
    } catch (error) {
      logger.error('加载开发计划失败:', error);
    }
  }

  /**
   * 保存到磁盘
   */
  _saveToDisk() {
    try {
      this._ensureConfigDir();
      const data = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        plans: this.plans,
      };
      fs.writeFileSync(getPlansFile(), JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('保存开发计划失败:', error);
    }
  }

  /**
   * 生成唯一 ID
   */
  _generateId() {
    return `devplan-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * 提交开发计划
   * @param {Object} params
   * @param {string} params.taskId - 关联任务 ID
   * @param {string} params.agentId - 提交者 Agent ID
   * @param {string} params.agentName - 提交者名称
   * @param {string} params.reviewerId - 审批者 Agent ID
   * @param {string} params.reviewerName - 审批者名称
   * @param {string} params.content - 计划内容
   * @returns {{ success: boolean, plan?: DevPlan, error?: string }}
   */
  submit(params) {
    const { taskId, agentId, agentName, reviewerId, reviewerName, content } = params;

    if (!taskId || !agentId || !content) {
      return { success: false, error: '缺少必要参数：taskId, agentId, content' };
    }

    // 检查是否已有该任务的待审批计划
    const existingPending = this.plans.find(
      (p) => p.taskId === taskId && p.status === 'pending'
    );
    if (existingPending) {
      // 更新现有的待审批计划（修订）
      existingPending.content = content;
      existingPending.revisionCount += 1;
      existingPending.createdAt = Date.now();
      existingPending.reviewedAt = null;
      existingPending.feedback = null;

      this._saveToDisk();
      this._notifyListeners('revised', existingPending);

      logger.info('开发计划已修订:', {
        planId: existingPending.id,
        taskId,
        agentId,
        revision: existingPending.revisionCount,
      });

      return { success: true, plan: existingPending };
    }

    // 计算修订次数（基于该任务的历史计划数）
    const previousPlans = this.plans.filter((p) => p.taskId === taskId);
    const revisionCount = previousPlans.length;

    const plan = {
      id: this._generateId(),
      taskId,
      agentId,
      agentName: agentName || agentId,
      reviewerId: reviewerId || '',
      reviewerName: reviewerName || '',
      content,
      status: 'pending',
      feedback: null,
      approveComment: null,
      revisionCount,
      createdAt: Date.now(),
      reviewedAt: null,
    };

    this.plans.push(plan);
    this._saveToDisk();
    this._notifyListeners('submitted', plan);

    logger.info('开发计划已提交:', {
      planId: plan.id,
      taskId,
      agentId,
      reviewerId,
    });

    return { success: true, plan };
  }

  /**
   * 批准开发计划
   * @param {string} planId - 计划 ID
   * @param {string} reviewerId - 审批者 ID
   * @param {string} [comment] - 批准备注
   * @returns {{ success: boolean, plan?: DevPlan, error?: string }}
   */
  approve(planId, reviewerId, comment = '') {
    const plan = this.get(planId);
    if (!plan) {
      return { success: false, error: `计划不存在: ${planId}` };
    }

    if (plan.status !== 'pending') {
      return { success: false, error: `计划状态不正确: ${plan.status}，只能审批 pending 状态的计划` };
    }

    plan.status = 'approved';
    plan.reviewedAt = Date.now();
    plan.approveComment = comment;

    this._saveToDisk();
    this._notifyListeners('approved', plan);

    logger.info('开发计划已批准:', {
      planId: plan.id,
      taskId: plan.taskId,
      reviewerId,
    });

    return { success: true, plan };
  }

  /**
   * 驳回开发计划
   * @param {string} planId - 计划 ID
   * @param {string} reviewerId - 审批者 ID
   * @param {string} feedback - 驳回理由（必填）
   * @returns {{ success: boolean, plan?: DevPlan, error?: string }}
   */
  reject(planId, reviewerId, feedback) {
    const plan = this.get(planId);
    if (!plan) {
      return { success: false, error: `计划不存在: ${planId}` };
    }

    if (plan.status !== 'pending') {
      return { success: false, error: `计划状态不正确: ${plan.status}，只能驳回 pending 状态的计划` };
    }

    if (!feedback) {
      return { success: false, error: '驳回必须提供反馈理由' };
    }

    plan.status = 'rejected';
    plan.reviewedAt = Date.now();
    plan.feedback = feedback;

    this._saveToDisk();
    this._notifyListeners('rejected', plan);

    logger.info('开发计划已驳回:', {
      planId: plan.id,
      taskId: plan.taskId,
      reviewerId,
      feedback: feedback.slice(0, 100),
    });

    return { success: true, plan };
  }

  /**
   * 获取计划
   * @param {string} planId
   * @returns {DevPlan | null}
   */
  get(planId) {
    return this.plans.find((p) => p.id === planId) || null;
  }

  /**
   * 获取某任务的最新计划
   * @param {string} taskId
   * @returns {DevPlan | null}
   */
  getByTask(taskId) {
    const taskPlans = this.plans
      .filter((p) => p.taskId === taskId)
      .sort((a, b) => b.createdAt - a.createdAt);
    return taskPlans[0] || null;
  }

  /**
   * 获取某任务的所有计划（按时间倒序）
   * @param {string} taskId
   * @returns {DevPlan[]}
   */
  getAllByTask(taskId) {
    return this.plans
      .filter((p) => p.taskId === taskId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取待审批的计划
   * @param {string} [reviewerId] - 可选，按审批者过滤
   * @returns {DevPlan[]}
   */
  getPending(reviewerId) {
    let result = this.plans.filter((p) => p.status === 'pending');
    if (reviewerId) {
      result = result.filter((p) => p.reviewerId === reviewerId);
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取所有计划
   * @param {Object} [filter]
   * @param {string} [filter.status]
   * @param {string} [filter.agentId]
   * @param {string} [filter.reviewerId]
   * @returns {DevPlan[]}
   */
  getAll(filter = {}) {
    let result = [...this.plans];
    if (filter.status) {
      result = result.filter((p) => p.status === filter.status);
    }
    if (filter.agentId) {
      result = result.filter((p) => p.agentId === filter.agentId);
    }
    if (filter.reviewerId) {
      result = result.filter((p) => p.reviewerId === filter.reviewerId);
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 添加监听器
   * @param {(event: string, plan: DevPlan) => void} listener
   * @returns {() => void} 取消订阅函数
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知监听器
   * @param {string} event - submitted | revised | approved | rejected
   * @param {DevPlan} plan
   */
  _notifyListeners(event, plan) {
    for (const listener of this.listeners) {
      try {
        listener(event, plan);
      } catch (error) {
        logger.error('开发计划队列监听器执行失败:', error);
      }
    }
  }

  /**
   * 重新初始化（切换公司后调用）
   * 清空内存状态并从新路径重新加载
   */
  reinitialize() {
    this.plans = [];
    this._ensureConfigDir();
    this._loadFromDisk();
  }

  /**
   * 清理历史记录（保留最近 200 条）
   */
  cleanup() {
    if (this.plans.length > 200) {
      this.plans = this.plans
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 200);
      this._saveToDisk();
    }
  }
}

// 单例
const devPlanQueue = new DevPlanQueue();

module.exports = { DevPlanQueue, devPlanQueue };
