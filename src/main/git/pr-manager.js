/**
 * SoloForge - PR 管理器
 * 管理 Pull Request 的创建、审核和合并
 * 注：由于是本地应用，PR 以本地记录形式存在
 * @module git/pr-manager
 */

const fs = require('fs');
const path = require('path');
const { BranchManager } = require('./branch-manager');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getConfigDir() {
  return dataPath.getBasePath();
}

function getPRFile() {
  return path.join(dataPath.getBasePath(), 'pull-requests.json');
}

/**
 * @typedef {Object} PullRequest
 * @property {string} id - PR ID
 * @property {string} title - 标题
 * @property {string} description - 描述
 * @property {string} sourceBranch - 源分支
 * @property {string} targetBranch - 目标分支
 * @property {string} author - 创建者 (Agent ID)
 * @property {string} status - 状态: open, approved, merged, closed
 * @property {string} createdAt - 创建时间
 * @property {string} [updatedAt] - 更新时间
 * @property {Array<{ reviewer: string, status: string, comment?: string, timestamp: string }>} reviews - 审核记录
 * @property {string} [mergedBy] - 合并者
 * @property {string} [mergedAt] - 合并时间
 */

/**
 * PR 管理器
 */
class PRManager extends BranchManager {
  constructor(workspacePath) {
    super(workspacePath);
    this.prs = this.loadPRs();
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
   * 加载 PR 数据
   * @returns {PullRequest[]}
   */
  loadPRs() {
    try {
      const prFile = getPRFile();
      if (fs.existsSync(prFile)) {
        const content = fs.readFileSync(prFile, 'utf-8');
        return JSON.parse(content).prs || [];
      }
    } catch (error) {
      logger.error('加载 PR 数据失败:', error);
    }
    return [];
  }

  /**
   * 保存 PR 数据
   */
  savePRs() {
    try {
      this.ensureConfigDir();
      const data = { version: 1, prs: this.prs };
      fs.writeFileSync(getPRFile(), JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('保存 PR 数据失败:', error);
    }
  }

  /**
   * 创建 PR
   * @param {Object} options
   * @param {string} options.title - 标题
   * @param {string} options.description - 描述
   * @param {string} options.sourceBranch - 源分支
   * @param {string} options.targetBranch - 目标分支
   * @param {string} options.author - 创建者 Agent ID
   * @returns {Promise<PullRequest>}
   */
  async createPR(options) {
    const { title, description, sourceBranch, targetBranch, author } = options;

    // 验证分支存在
    const branches = await this.listBranches();
    const branchNames = branches.map((b) => b.name);

    if (!branchNames.includes(sourceBranch)) {
      throw new Error(`源分支 "${sourceBranch}" 不存在`);
    }
    if (!branchNames.includes(targetBranch)) {
      throw new Error(`目标分支 "${targetBranch}" 不存在`);
    }

    // 检查是否有相同的 open PR
    const existingPR = this.prs.find(
      (pr) =>
        pr.sourceBranch === sourceBranch &&
        pr.targetBranch === targetBranch &&
        pr.status === 'open'
    );
    if (existingPR) {
      throw new Error(`已存在相同分支的 PR: #${existingPR.id}`);
    }

    // 获取变更文件
    const diffOutput = await this.git(
      `diff --name-status ${targetBranch}...${sourceBranch}`
    );
    const changedFiles = diffOutput.split('\n').filter((l) => l.trim());

    const pr = {
      id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      description,
      sourceBranch,
      targetBranch,
      author,
      status: 'open',
      createdAt: new Date().toISOString(),
      reviews: [],
      changedFiles,
    };

    this.prs.push(pr);
    this.savePRs();

    logger.info('创建 PR:', pr);
    return pr;
  }

  /**
   * 获取 PR
   * @param {string} prId
   * @returns {PullRequest | null}
   */
  getPR(prId) {
    return this.prs.find((pr) => pr.id === prId) || null;
  }

  /**
   * 获取所有 PR
   * @param {Object} [filter]
   * @param {string} [filter.status] - 状态过滤
   * @param {string} [filter.author] - 作者过滤
   * @returns {PullRequest[]}
   */
  listPRs(filter = {}) {
    let result = [...this.prs];

    if (filter.status) {
      result = result.filter((pr) => pr.status === filter.status);
    }
    if (filter.author) {
      result = result.filter((pr) => pr.author === filter.author);
    }

    // 按创建时间倒序
    result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return result;
  }

  /**
   * 审核 PR
   * @param {string} prId - PR ID
   * @param {Object} review
   * @param {string} review.reviewer - 审核者 Agent ID
   * @param {'approve' | 'request_changes' | 'comment'} review.status - 审核状态
   * @param {string} [review.comment] - 审核意见
   * @returns {Promise<PullRequest>}
   */
  async reviewPR(prId, review) {
    const pr = this.getPR(prId);
    if (!pr) {
      throw new Error(`PR "${prId}" 不存在`);
    }
    if (pr.status === 'merged' || pr.status === 'closed') {
      throw new Error(`PR "${prId}" 已${pr.status === 'merged' ? '合并' : '关闭'}，无法审核`);
    }

    // 禁止自审：作者不能 approve 自己的 PR
    if (review.status === 'approve' && review.reviewer === pr.author) {
      throw new Error('不能审批自己创建的 PR');
    }

    const reviewRecord = {
      reviewer: review.reviewer,
      status: review.status,
      comment: review.comment,
      timestamp: new Date().toISOString(),
    };

    pr.reviews.push(reviewRecord);
    pr.updatedAt = new Date().toISOString();

    // 重新计算 PR 状态
    pr.status = this._calculatePRStatus(pr);

    this.savePRs();
    logger.info('审核 PR:', { prId, review: reviewRecord, newStatus: pr.status });
    return pr;
  }

  /**
   * 计算 PR 状态
   * 规则：
   * - 有未解决的 request_changes → 保持 open
   * - 至少 1 个 approve 且无未解决的 request_changes → approved
   * - 其他 → open
   * @param {PullRequest} pr
   * @returns {string}
   */
  _calculatePRStatus(pr) {
    if (pr.status === 'merged' || pr.status === 'closed') return pr.status;

    // 按 reviewer 取每人最新的审核结果
    const latestReviewByReviewer = new Map();
    for (const review of pr.reviews) {
      if (review.status === 'approve' || review.status === 'request_changes') {
        latestReviewByReviewer.set(review.reviewer, review);
      }
    }

    const latestReviews = Array.from(latestReviewByReviewer.values());
    const hasApproval = latestReviews.some((r) => r.status === 'approve');
    const hasUnresolvedChanges = latestReviews.some((r) => r.status === 'request_changes');

    // 有未解决的 change request → 不能通过
    if (hasUnresolvedChanges) return 'open';

    // 至少 1 个 approve → 通过
    if (hasApproval) return 'approved';

    return 'open';
  }

  /**
   * 合并 PR
   * @param {string} prId - PR ID
   * @param {Object} options
   * @param {string} options.mergedBy - 合并者 Agent ID
   * @param {boolean} [options.squash] - 是否压缩提交
   * @param {boolean} [options.deleteBranch] - 合并后是否删除源分支
   * @returns {Promise<PullRequest>}
   */
  async mergePR(prId, options) {
    const { mergedBy, squash = false, deleteBranch = true } = options;

    const pr = this.getPR(prId);
    if (!pr) {
      throw new Error(`PR "${prId}" 不存在`);
    }
    if (pr.status === 'merged') {
      throw new Error(`PR "${prId}" 已合并`);
    }
    if (pr.status === 'closed') {
      throw new Error(`PR "${prId}" 已关闭`);
    }
    if (pr.status === 'open') {
      throw new Error(`PR "${prId}" 尚未通过审核，无法合并。请先获得至少 1 个 approve 且无未解决的 change request。`);
    }

    // 执行合并
    await this.mergeBranch(pr.sourceBranch, {
      targetBranch: pr.targetBranch,
      squash,
    });

    // 更新 PR 状态
    pr.status = 'merged';
    pr.mergedBy = mergedBy;
    pr.mergedAt = new Date().toISOString();
    pr.updatedAt = new Date().toISOString();

    // 删除源分支
    if (deleteBranch) {
      try {
        await this.deleteBranch(pr.sourceBranch, { force: true });
        pr.branchDeleted = true;
      } catch (error) {
        logger.warn('删除分支失败:', error.message);
        pr.branchDeleted = false;
      }
    }

    this.savePRs();
    logger.info('合并 PR:', { prId, mergedBy });
    return pr;
  }

  /**
   * 关闭 PR（不合并）
   * @param {string} prId
   * @param {string} closedBy
   * @returns {Promise<PullRequest>}
   */
  async closePR(prId, closedBy) {
    const pr = this.getPR(prId);
    if (!pr) {
      throw new Error(`PR "${prId}" 不存在`);
    }
    if (pr.status === 'merged') {
      throw new Error(`PR "${prId}" 已合并，无法关闭`);
    }

    pr.status = 'closed';
    pr.closedBy = closedBy;
    pr.updatedAt = new Date().toISOString();

    this.savePRs();
    logger.info('关闭 PR:', { prId, closedBy });
    return pr;
  }

  /**
   * 重新初始化（切换公司后调用）
   * 从新路径重新加载 PR 数据
   */
  reinitialize() {
    this.prs = this.loadPRs();
  }

  /**
   * 获取 PR 变更内容
   * @param {string} prId
   * @returns {Promise<string>}
   */
  async getPRDiff(prId) {
    const pr = this.getPR(prId);
    if (!pr) {
      throw new Error(`PR "${prId}" 不存在`);
    }

    const diff = await this.git(`diff ${pr.targetBranch}...${pr.sourceBranch}`);
    return diff;
  }
}

module.exports = { PRManager };
