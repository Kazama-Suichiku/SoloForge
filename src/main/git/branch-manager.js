/**
 * SoloForge - 分支管理器
 * 管理 Git 分支的创建、切换和删除
 * @module git/branch-manager
 */

const { WorkspaceManager } = require('./workspace-manager');
const { logger } = require('../utils/logger');

/**
 * 分支管理器
 */
class BranchManager extends WorkspaceManager {
  /**
   * 创建新分支
   * @param {string} branchName - 分支名称
   * @param {Object} [options]
   * @param {string} [options.baseBranch] - 基于哪个分支创建
   * @param {boolean} [options.checkout] - 是否切换到新分支
   * @returns {Promise<{ success: boolean, branch: string }>}
   */
  async createBranch(branchName, options = {}) {
    const { baseBranch, checkout = true } = options;

    // 验证分支名称
    if (!/^[a-zA-Z0-9._/-]+$/.test(branchName)) {
      throw new Error('分支名称只能包含字母、数字、点、下划线、斜杠和连字符');
    }

    // 检查分支是否已存在
    const status = await this.getStatus();
    const exists = status.branches?.some((b) => b.name === branchName);
    if (exists) {
      throw new Error(`分支 "${branchName}" 已存在`);
    }

    // 如果指定了基础分支，先切换过去
    if (baseBranch && status.currentBranch !== baseBranch) {
      await this.git(`checkout ${baseBranch}`);
    }

    // 创建分支
    if (checkout) {
      await this.git(`checkout -b ${branchName}`);
    } else {
      await this.git(`branch ${branchName}`);
    }

    logger.info(`创建分支: ${branchName}`, { baseBranch, checkout });
    return { success: true, branch: branchName };
  }

  /**
   * 切换分支
   * @param {string} branchName
   * @returns {Promise<{ success: boolean, branch: string }>}
   */
  async checkoutBranch(branchName) {
    await this.git(`checkout ${branchName}`);
    logger.info(`切换到分支: ${branchName}`);
    return { success: true, branch: branchName };
  }

  /**
   * 删除分支
   * @param {string} branchName
   * @param {Object} [options]
   * @param {boolean} [options.force] - 强制删除
   * @returns {Promise<{ success: boolean }>}
   */
  async deleteBranch(branchName, options = {}) {
    const { force = false } = options;
    const flag = force ? '-D' : '-d';
    await this.git(`branch ${flag} ${branchName}`);
    logger.info(`删除分支: ${branchName}`);
    return { success: true };
  }

  /**
   * 获取分支列表
   * @returns {Promise<Array<{ name: string, isCurrent: boolean, lastCommit?: string }>>}
   */
  async listBranches() {
    const output = await this.git('branch -v --no-color');
    const branches = [];

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;

      const isCurrent = line.startsWith('*');
      const parts = line.replace(/^\*?\s*/, '').split(/\s+/);
      const name = parts[0];
      const lastCommit = parts[1];

      branches.push({ name, isCurrent, lastCommit });
    }

    return branches;
  }

  /**
   * 合并分支
   * @param {string} sourceBranch - 要合并的分支
   * @param {Object} [options]
   * @param {string} [options.targetBranch] - 目标分支（默认当前分支）
   * @param {boolean} [options.squash] - 是否压缩提交
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async mergeBranch(sourceBranch, options = {}) {
    const { targetBranch, squash = false } = options;

    // 如果指定了目标分支，先切换过去
    if (targetBranch) {
      await this.checkoutBranch(targetBranch);
    }

    const squashFlag = squash ? '--squash' : '';
    const output = await this.git(`merge ${squashFlag} ${sourceBranch}`);

    if (squash) {
      // squash 合并需要手动提交
      const status = await this.getStatus();
      if (status.hasChanges) {
        await this.git(`commit -m "Merge branch '${sourceBranch}' (squashed)"`);
      }
    }

    logger.info(`合并分支: ${sourceBranch} -> ${targetBranch || '当前分支'}`);
    return { success: true, message: output || '合并成功' };
  }

  /**
   * 为 Agent 任务创建工作分支
   * @param {string} agentId - Agent ID
   * @param {string} taskId - 任务 ID
   * @param {Object} [options]
   * @returns {Promise<{ success: boolean, branch: string }>}
   */
  async createTaskBranch(agentId, taskId, options = {}) {
    const branchName = `${agentId}/${taskId}`;
    return this.createBranch(branchName, options);
  }

  /**
   * 获取当前分支名
   * @returns {Promise<string>}
   */
  async getCurrentBranch() {
    return this.git('rev-parse --abbrev-ref HEAD');
  }

  /**
   * 检查是否有未提交的更改
   * @returns {Promise<boolean>}
   */
  async hasUncommittedChanges() {
    const status = await this.getStatus();
    return status.hasChanges;
  }
}

module.exports = { BranchManager };
