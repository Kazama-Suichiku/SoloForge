/**
 * SoloForge - Agent 招聘审批队列
 * 管理 Agent 创建申请的审批流程，支持多轮讨论
 * @module agent-factory/approval-queue
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');
const { atomicWriteSync } = require('../utils/atomic-write');
const {
  createAgentRequest,
  validateAgentRequest,
  addDiscussionMessage,
  formatProfileForReview,
} = require('./agent-request');
const { budgetManager } = require('../budget/budget-manager');
// 延迟加载 dynamicAgentFactory 以避免循环依赖
let dynamicAgentFactory = null;
const getDynamicAgentFactory = () => {
  if (!dynamicAgentFactory) {
    dynamicAgentFactory = require('./dynamic-agent').dynamicAgentFactory;
  }
  return dynamicAgentFactory;
};

function getConfigDir() {
  return dataPath.getBasePath();
}

function getQueueFile() {
  return path.join(dataPath.getBasePath(), 'agent-requests.json');
}

/**
 * 审批队列管理器
 */
class ApprovalQueue {
  constructor() {
    /** @type {import('./agent-request').AgentRequest[]} */
    this.requests = this.loadFromDisk();
    this.listeners = new Set();
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
   * 从磁盘加载
   * @returns {import('./agent-request').AgentRequest[]}
   */
  loadFromDisk() {
    try {
      const queueFile = getQueueFile();
      if (fs.existsSync(queueFile)) {
        const content = fs.readFileSync(queueFile, 'utf-8');
        const data = JSON.parse(content);
        logger.debug(`加载了 ${data.requests?.length || 0} 条 Agent 招聘申请`);
        return data.requests || [];
      }
    } catch (error) {
      logger.error('加载 Agent 招聘申请失败:', error);
    }
    return [];
  }

  /**
   * 保存到磁盘
   */
  saveToDisk() {
    try {
      this.ensureConfigDir();
      const data = {
        version: 2,
        lastUpdated: new Date().toISOString(),
        requests: this.requests,
      };
      // 使用原子写入，防止写入过程中崩溃导致文件损坏
      atomicWriteSync(getQueueFile(), JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('保存 Agent 招聘申请失败:', error);
    }
  }

  /**
   * 提交新招聘申请
   * @param {Object} params - 申请参数
   * @param {string} params.requesterId - 申请者 ID
   * @param {string} params.requesterName - 申请者名称
   * @param {string} params.reason - 招聘原因
   * @param {string} [params.businessNeed] - 业务需求
   * @param {import('./agent-request').AgentProfile} params.profile - Agent 画像
   * @returns {{ success: boolean, request?: import('./agent-request').AgentRequest, errors?: string[], warnings?: string[] }}
   */
  submit(params) {
    const validation = validateAgentRequest(params);
    if (!validation.valid) {
      return { success: false, errors: validation.errors, warnings: validation.warnings };
    }

    const request = createAgentRequest(params);
    this.requests.push(request);
    this.saveToDisk();
    this.notifyListeners('submitted', request);

    logger.info('提交 Agent 招聘申请:', {
      id: request.id,
      requester: request.requesterName,
      candidateName: request.profile.name,
    });

    return { success: true, request, warnings: validation.warnings };
  }

  /**
   * 获取申请
   * @param {string} requestId
   * @returns {import('./agent-request').AgentRequest | null}
   */
  get(requestId) {
    return this.requests.find((r) => r.id === requestId) || null;
  }

  /**
   * 获取待处理的申请（pending 或 discussing）
   * @returns {import('./agent-request').AgentRequest[]}
   */
  getPending() {
    return this.requests.filter((r) => r.status === 'pending' || r.status === 'discussing');
  }

  /**
   * 获取所有申请
   * @param {Object} [filter]
   * @param {string} [filter.status]
   * @param {string} [filter.requesterId]
   * @returns {import('./agent-request').AgentRequest[]}
   */
  getAll(filter = {}) {
    let result = [...this.requests];

    if (filter.status) {
      result = result.filter((r) => r.status === filter.status);
    }
    if (filter.requesterId) {
      result = result.filter((r) => r.requesterId === filter.requesterId);
    }

    // 按创建时间倒序
    result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return result;
  }

  /**
   * 提出质疑（CHRO 使用）
   * @param {string} requestId
   * @param {Object} params
   * @param {string} params.reviewerId - 质疑者 ID (CHRO)
   * @param {string} params.reviewerName - 质疑者名称
   * @param {string} params.question - 质疑内容
   * @returns {{ success: boolean, request?: import('./agent-request').AgentRequest, error?: string }}
   */
  raiseQuestion(requestId, params) {
    const request = this.get(requestId);
    if (!request) {
      return { success: false, error: '申请不存在' };
    }

    if (request.status === 'approved' || request.status === 'rejected') {
      return { success: false, error: '申请已结束，无法继续讨论' };
    }

    addDiscussionMessage(request, {
      authorId: params.reviewerId,
      authorName: params.reviewerName,
      type: 'question',
      content: params.question,
    });

    this.saveToDisk();
    this.notifyListeners('questioned', request);

    logger.info('CHRO 提出质疑:', {
      requestId,
      reviewerId: params.reviewerId,
      questionPreview: params.question.slice(0, 50),
    });

    return { success: true, request };
  }

  /**
   * 回答质疑或提出修正（业务方使用）
   * @param {string} requestId
   * @param {Object} params
   * @param {string} params.authorId - 回复者 ID
   * @param {string} params.authorName - 回复者名称
   * @param {string} params.content - 回复内容
   * @param {Partial<import('./agent-request').AgentProfile>} [params.profileRevision] - 简历修订
   * @returns {{ success: boolean, request?: import('./agent-request').AgentRequest, error?: string }}
   */
  respond(requestId, params) {
    const request = this.get(requestId);
    if (!request) {
      return { success: false, error: '申请不存在' };
    }

    if (request.status === 'approved' || request.status === 'rejected') {
      return { success: false, error: '申请已结束，无法继续讨论' };
    }

    // 判断是回答还是修订
    const type = params.profileRevision ? 'revision' : 'answer';

    addDiscussionMessage(request, {
      authorId: params.authorId,
      authorName: params.authorName,
      type,
      content: params.content,
      profileRevision: params.profileRevision,
    });

    // 如果是修订，状态回到 pending 等待重新审核
    if (type === 'revision') {
      request.status = 'pending';
    }

    this.saveToDisk();
    this.notifyListeners(type === 'revision' ? 'revised' : 'answered', request);

    logger.info('业务方回复:', {
      requestId,
      authorId: params.authorId,
      type,
      hasRevision: !!params.profileRevision,
    });

    return { success: true, request };
  }

  /**
   * 添加评论（任何人）
   * @param {string} requestId
   * @param {Object} params
   * @param {string} params.authorId
   * @param {string} params.authorName
   * @param {string} params.content
   * @returns {{ success: boolean, request?: import('./agent-request').AgentRequest, error?: string }}
   */
  addComment(requestId, params) {
    const request = this.get(requestId);
    if (!request) {
      return { success: false, error: '申请不存在' };
    }

    addDiscussionMessage(request, {
      authorId: params.authorId,
      authorName: params.authorName,
      type: 'comment',
      content: params.content,
    });

    this.saveToDisk();
    this.notifyListeners('commented', request);

    return { success: true, request };
  }

  /**
   * 最终审批（CHRO 使用）
   * @param {string} requestId
   * @param {Object} decision
   * @param {boolean} decision.approved - 是否批准
   * @param {string} decision.reviewerId - 审批者 ID
   * @param {string} decision.reviewerName - 审批者名称
   * @param {string} decision.comment - 审批意见
   * @param {number} [decision.assignedBudget] - 分配的预算
   * @returns {{ success: boolean, request?: import('./agent-request').AgentRequest, error?: string }}
   */
  review(requestId, decision) {
    const request = this.get(requestId);
    if (!request) {
      return { success: false, error: '申请不存在' };
    }

    if (request.status === 'approved' || request.status === 'rejected') {
      return { success: false, error: '申请已处理' };
    }

    request.status = decision.approved ? 'approved' : 'rejected';
    request.reviewedBy = decision.reviewerId;
    request.reviewedAt = new Date().toISOString();
    request.reviewComment = decision.comment;

    // 添加最终决定到讨论记录
    addDiscussionMessage(request, {
      authorId: decision.reviewerId,
      authorName: decision.reviewerName,
      type: 'comment',
      content: `【最终决定】${decision.approved ? '✅ 批准' : '❌ 拒绝'}\n\n${decision.comment}`,
    });

    // 如果批准，设置预算并创建 Agent
    if (decision.approved) {
      // 预留 Agent ID（带随机后缀避免同毫秒冲突）
      request.createdAgentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // 获取职级，用于初始化工资账户
      const level = request.profile?.level || 'staff';
      // 自定义日薪（如果审批时指定了）
      const customSalary = decision.assignedBudget || request.profile?.tokenBudget || null;

      // 初始化工资账户（使用新的工资系统）
      budgetManager.initSalaryAccount(request.createdAgentId, level, customSalary);

      // 真正创建 Agent 实例
      try {
        const factory = getDynamicAgentFactory();
        const createResult = factory.create(request);
        if (createResult.success) {
          logger.info('动态 Agent 创建成功:', {
            agentId: request.createdAgentId,
            agentName: request.profile?.name,
          });
        } else {
          logger.error('动态 Agent 创建失败:', createResult.error);
        }
      } catch (error) {
        logger.error('动态 Agent 创建异常:', error);
      }
    }

    this.saveToDisk();
    this.notifyListeners(decision.approved ? 'approved' : 'rejected', request);

    logger.info('CHRO 审批 Agent 招聘申请:', {
      requestId,
      approved: decision.approved,
      reviewerId: decision.reviewerId,
      revisionCount: request.revisionCount,
    });

    return { success: true, request };
  }

  /**
   * 获取申请的完整信息（含格式化简历）
   * @param {string} requestId
   * @returns {Object | null}
   */
  getFullDetails(requestId) {
    const request = this.get(requestId);
    if (!request) {
      return null;
    }

    return {
      ...request,
      formattedProfile: formatProfileForReview(request.profile),
      formattedOriginalProfile: request.originalProfile
        ? formatProfileForReview(request.originalProfile)
        : null,
    };
  }

  /**
   * 添加监听器
   * @param {(event: string, request: import('./agent-request').AgentRequest) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知监听器
   * @param {string} event
   * @param {import('./agent-request').AgentRequest} request
   */
  notifyListeners(event, request) {
    for (const listener of this.listeners) {
      try {
        listener(event, request);
      } catch (error) {
        logger.error('审批队列监听器执行失败:', error);
      }
    }
  }

  /**
   * 重新初始化（切换公司后调用）
   * 清空内存状态并从新路径重新加载
   */
  reinitialize() {
    this.requests = this.loadFromDisk();
  }

  /**
   * 清除历史记录（保留最近 100 条）
   */
  cleanup() {
    if (this.requests.length > 100) {
      this.requests = this.requests
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 100);
      this.saveToDisk();
    }
  }

  /**
   * 清空所有已处理的记录（保留 pending 和 discussing 的）
   * @returns {{ success: boolean, clearedCount: number }}
   */
  clearProcessed() {
    const pendingRequests = this.requests.filter(
      (r) => r.status === 'pending' || r.status === 'discussing'
    );
    const clearedCount = this.requests.length - pendingRequests.length;
    
    if (clearedCount > 0) {
      this.requests = pendingRequests;
      this.saveToDisk();
      logger.info(`清空了 ${clearedCount} 条已处理的招聘记录`);
    }
    
    return { success: true, clearedCount };
  }
}

// 单例
const approvalQueue = new ApprovalQueue();

module.exports = { ApprovalQueue, approvalQueue };
