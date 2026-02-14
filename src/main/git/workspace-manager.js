/**
 * SoloForge - 工作区管理器
 * 管理 Git 工作区初始化和状态
 * @module git/workspace-manager
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../utils/logger');

const execAsync = promisify(exec);

/**
 * 工作区管理器
 */
class WorkspaceManager {
  /**
   * @param {string} workspacePath - 工作区路径
   */
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
  }

  /**
   * 执行 Git 命令
   * @param {string} command
   * @returns {Promise<string>}
   */
  async git(command) {
    try {
      const { stdout, stderr } = await execAsync(`git ${command}`, {
        cwd: this.workspacePath,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      return stdout.trim();
    } catch (error) {
      const message = error.stderr || error.message;
      throw new Error(`Git 命令失败: ${message}`);
    }
  }

  /**
   * 检查是否是 Git 仓库
   * @returns {Promise<boolean>}
   */
  async isGitRepository() {
    try {
      await this.git('rev-parse --git-dir');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 初始化 Git 仓库
   * @returns {Promise<{ initialized: boolean, message: string }>}
   */
  async initRepository() {
    const isRepo = await this.isGitRepository();
    if (isRepo) {
      return { initialized: false, message: '已是 Git 仓库' };
    }

    await this.git('init');
    
    // 创建 .gitignore
    const gitignorePath = path.join(this.workspacePath, '.gitignore');
    try {
      await fs.access(gitignorePath);
    } catch {
      await fs.writeFile(
        gitignorePath,
        'node_modules/\n.env\n.DS_Store\n*.log\ndist/\n',
        'utf-8'
      );
    }

    // 初始提交
    await this.git('add -A');
    try {
      await this.git('commit -m "Initial commit"');
    } catch {
      // 可能没有文件要提交
    }

    logger.info('Git 仓库初始化完成:', this.workspacePath);
    return { initialized: true, message: 'Git 仓库初始化完成' };
  }

  /**
   * 获取仓库状态
   * @returns {Promise<Object>}
   */
  async getStatus() {
    const isRepo = await this.isGitRepository();
    if (!isRepo) {
      return { isRepository: false };
    }

    // 获取当前分支
    let currentBranch;
    try {
      currentBranch = await this.git('rev-parse --abbrev-ref HEAD');
    } catch {
      currentBranch = 'HEAD';
    }

    // 获取文件状态
    const statusOutput = await this.git('status --porcelain');
    const files = statusOutput
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }));

    // 获取最近提交
    let lastCommit;
    try {
      const log = await this.git('log -1 --format="%H|%s|%an|%ar"');
      const [hash, message, author, date] = log.split('|');
      lastCommit = { hash, message, author, date };
    } catch {
      lastCommit = null;
    }

    // 获取分支列表
    let branches;
    try {
      const branchOutput = await this.git('branch --list');
      branches = branchOutput
        .split('\n')
        .filter((b) => b.trim())
        .map((b) => ({
          name: b.replace(/^\*?\s*/, ''),
          isCurrent: b.startsWith('*'),
        }));
    } catch {
      branches = [];
    }

    return {
      isRepository: true,
      currentBranch,
      files,
      hasChanges: files.length > 0,
      lastCommit,
      branches,
    };
  }

  /**
   * 获取远程信息
   * @returns {Promise<Array>}
   */
  async getRemotes() {
    try {
      const output = await this.git('remote -v');
      const lines = output.split('\n').filter((l) => l.includes('(fetch)'));
      return lines.map((line) => {
        const parts = line.split(/\s+/);
        return { name: parts[0], url: parts[1] };
      });
    } catch {
      return [];
    }
  }
}

module.exports = { WorkspaceManager };
