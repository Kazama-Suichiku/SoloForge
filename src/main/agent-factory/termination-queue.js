/**
 * SoloForge - Agent 开除审批队列
 * 管理 Agent 开除申请的审批流程（需老板确认）
 * @module agent-factory/termination-queue
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getConfigDir() {
  return dataPath.getBasePath();
}

function getQueueFile() {
  return path.join(dataPath.getBasePath(), 'termination-requests.json');
}

/**
 * @typedef {Object} TerminationRequest
 * @property {string} id - 请求 ID
 * @property {string} agentId - 被开除的 Agent ID
 * @property {string} agentName - 被开除的 Agent 名称
 * @property {string} agentTitle - 被开除的 Agent 职位
 * @property {string} department - 所属部门
 * @property {string} proposedBy - 提出者 Agent ID（通常是 CHRO）
 * @property {string} proposedByName - 提出者名称
 * @property {string} reason - 开除原因
 * @property {'normal'|'urgent'} severity - 严重程度
 * @property {string} [impactAnalysis] - 影响分析
 * @property {'pending'|'confirmed'|'rejected'|'cancelled'} status - 状态
 * @property {string} [bossComment] - 老板的批复意见
 * @property {string} [confirmedAt] - 确认时间
 * @property {string} createdAt - 创建时间
 * @property {string} [updatedAt] - 更新时间
 */

/**
 * 开除审批队列管理器
 */
class TerminationQueue {
  constructor() {
    /** @type {TerminationRequest[]} */
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
   * @returns {TerminationRequest[]}
   */
  loadFromDisk() {
    try {
      const queueFile = getQueueFile();
      if (fs.existsSync(queueFile)) {
        const content = fs.readFileSync(queueFile, 'utf-8');
        const data = JSON.parse(content);
        logger.debug(`加载了 ${data.requests?.length || 0} 条开除申请`);
        return data.requests || [];
      }
    } catch (error) {
      logger.error('加载开除申请失败:', error);
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
        version: 1,
        lastUpdated: new Date().toISOString(),
        requests: this.requests,
      };
      fs.writeFileSync(getQueueFile(), JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('保存开除申请失败:', error);
    }
  }

  /**
   * CHRO 提出开除申请
   * @param {Object} params
   * @param {string} params.agentId - 被开除的 Agent ID
   * @param {string} params.agentName - 被开除的 Agent 名称
   * @param {string} params.agentTitle - 被开除的 Agent 职位
   * @param {string} params.department - 所属部门
   * @param {string} params.proposedBy - 提出者 Agent ID
   * @param {string} params.proposedByName - 提出者名称
   * @param {string} params.reason - 开除原因
   * @param {'normal'|'urgent'} [params.severity='normal'] - 严重程度
   * @param {string} [params.impactAnalysis] - 影响分析
   * @returns {{ success: boolean, request?: TerminationRequest, error?: string }}
   */
  propose(params) {
    if (!params.agentId) {
      return { success: false, error: '必须指定要开除的 Agent ID' };
    }
    if (!params.reason) {
      return { success: false, error: '必须提供开除原因' };
    }

    // 检查是否有该 Agent 的待处理开除申请
    const existing = this.requests.find(
      (r) => r.agentId === params.agentId && r.status === 'pending'
    );
    if (existing) {
      return { success: false, error: `Agent ${params.agentId} 已有待处理的开除申请 (${existing.id})` };
    }

    const request = {
      id: `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: params.agentId,
      agentName: params.agentName || params.agentId,
      agentTitle: params.agentTitle || '',
      department: params.department || '',
      proposedBy: params.proposedBy,
      proposedByName: params.proposedByName || params.proposedBy,
      reason: params.reason,
      severity: params.severity || 'normal',
      impactAnalysis: params.impactAnalysis || '',
      status: 'pending',
      bossComment: null,
      confirmedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };

    this.requests.push(request);
    this.saveToDisk();
    this.notifyListeners('proposed', request);

    logger.info('提交开除申请:', {
      id: request.id,
      agentId: request.agentId,
      agentName: request.agentName,
      proposedBy: request.proposedBy,
    });

    return { success: true, request };
  }

  /**
   * 老板确认或拒绝开除申请
   * @param {string} requestId - 请求 ID
   * @param {Object} decision
   * @param {boolean} decision.approved - 是否批准
   * @param {string} decision.comment - 批复意见
   * @returns {{ success: boolean, request?: TerminationRequest, error?: string }}
   */
  confirm(requestId, decision) {
    const request = this.get(requestId);
    if (!request) {
      return { success: false, error: '开除申请不存在' };
    }
    if (request.status !== 'pending') {
      return { success: false, error: `开除申请已处理（当前状态: ${request.status}）` };
    }

    request.status = decision.approved ? 'confirmed' : 'rejected';
    request.bossComment = decision.comment || '';
    request.confirmedAt = new Date().toISOString();
    request.updatedAt = new Date().toISOString();

    this.saveToDisk();
    this.notifyListeners(decision.approved ? 'confirmed' : 'rejected', request);

    logger.info('开除申请已处理:', {
      requestId,
      approved: decision.approved,
      agentId: request.agentId,
    });

    return { success: true, request };
  }

  /**
   * 取消开除申请（CHRO 可撤回）
   * @param {string} requestId
   * @param {string} [reason]
   * @returns {{ success: boolean, request?: TerminationRequest, error?: string }}
   */
  cancel(requestId, reason) {
    const request = this.get(requestId);
    if (!request) {
      return { success: false, error: '开除申请不存在' };
    }
    if (request.status !== 'pending') {
      return { success: false, error: '只能取消待处理的申请' };
    }

    request.status = 'cancelled';
    request.bossComment = reason || '已撤回';
    request.updatedAt = new Date().toISOString();

    this.saveToDisk();
    this.notifyListeners('cancelled', request);

    return { success: true, request };
  }

  /**
   * 获取指定请求
   * @param {string} requestId
   * @returns {TerminationRequest | null}
   */
  get(requestId) {
    return this.requests.find((r) => r.id === requestId) || null;
  }

  /**
   * 获取待处理的开除申请
   * @returns {TerminationRequest[]}
   */
  getPending() {
    return this.requests.filter((r) => r.status === 'pending');
  }

  /**
   * 获取所有开除申请（支持筛选）
   * @param {Object} [filter]
   * @param {string} [filter.status]
   * @param {string} [filter.agentId]
   * @returns {TerminationRequest[]}
   */
  getAll(filter = {}) {
    let result = [...this.requests];

    if (filter.status) {
      result = result.filter((r) => r.status === filter.status);
    }
    if (filter.agentId) {
      result = result.filter((r) => r.agentId === filter.agentId);
    }

    result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return result;
  }

  /**
   * 添加监听器
   * @param {(event: string, request: TerminationRequest) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知监听器
   * @param {string} event - 'proposed' | 'confirmed' | 'rejected' | 'cancelled'
   * @param {TerminationRequest} request
   */
  notifyListeners(event, request) {
    for (const listener of this.listeners) {
      try {
        listener(event, request);
      } catch (error) {
        logger.error('开除队列监听器执行失败:', error);
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
   * 清除历史记录（保留最近 50 条）
   */
  cleanup() {
    if (this.requests.length > 50) {
      this.requests = this.requests
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 50);
      this.saveToDisk();
    }
  }
}

// 单例
const terminationQueue = new TerminationQueue();

module.exports = { TerminationQueue, terminationQueue };
