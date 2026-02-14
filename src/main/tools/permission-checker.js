/**
 * SoloForge - 权限检查器
 * 检查工具执行是否符合用户配置的安全边界
 * @module tools/permission-checker
 */

const path = require('path');
const os = require('os');

/**
 * 权限检查器
 */
class PermissionChecker {
  /**
   * @param {Object} userPermissions - 用户权限配置
   */
  constructor(userPermissions = {}) {
    this.permissions = userPermissions;
  }

  /**
   * 更新权限配置
   * @param {Object} permissions
   */
  setPermissions(permissions) {
    this.permissions = permissions;
  }

  /**
   * 展开路径中的 ~ 符号
   * @param {string} p
   * @returns {string}
   */
  expandPath(p) {
    if (!p || typeof p !== 'string') return p ?? '';
    if (p.startsWith('~')) {
      return path.join(os.homedir(), p.slice(1));
    }
    return p;
  }

  /**
   * 检查路径是否在允许列表中
   * @param {string} targetPath - 要访问的路径
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkPath(targetPath) {
    // 防御：path 未定义或不是字符串时，直接拒绝
    if (!targetPath || typeof targetPath !== 'string') {
      return { allowed: false, reason: '未提供有效的路径参数' };
    }

    const allowedPaths = this.permissions.files?.allowedPaths ?? [];
    
    if (allowedPaths.length === 0) {
      return { allowed: false, reason: '用户未配置任何可访问目录' };
    }

    const normalizedTarget = path.resolve(this.expandPath(targetPath));

    for (const allowed of allowedPaths) {
      const normalizedAllowed = path.resolve(this.expandPath(allowed));
      
      // 检查目标路径是否在允许的目录下
      if (
        normalizedTarget === normalizedAllowed ||
        normalizedTarget.startsWith(normalizedAllowed + path.sep)
      ) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `路径 "${targetPath}" 不在允许访问的目录列表中`,
    };
  }

  /**
   * 检查是否允许写入文件
   * @returns {{ allowed: boolean, reason?: string, needConfirm?: boolean }}
   */
  checkWrite() {
    if (!this.permissions.files?.writeEnabled) {
      return { allowed: false, reason: '用户未启用文件写入权限' };
    }
    return {
      allowed: true,
      needConfirm: this.permissions.files?.writeConfirm ?? true,
    };
  }

  /**
   * 检查是否允许执行 Shell 命令
   * @param {string} command - 要执行的命令
   * @returns {{ allowed: boolean, reason?: string, needConfirm?: boolean }}
   */
  checkShell(command) {
    if (!this.permissions.shell?.enabled) {
      return { allowed: false, reason: '用户未启用 Shell 命令权限' };
    }

    // 防御：command 未定义
    if (!command || typeof command !== 'string') {
      return { allowed: false, reason: '未提供有效的命令参数' };
    }

    // 检查黑名单
    const blacklist = this.permissions.shell?.blacklist ?? [];
    for (const pattern of blacklist) {
      if (command.includes(pattern)) {
        return {
          allowed: false,
          reason: `命令包含禁止的模式: "${pattern}"`,
        };
      }
    }

    return {
      allowed: true,
      needConfirm: this.permissions.shell?.confirmEach ?? true,
    };
  }

  /**
   * 检查是否允许网络搜索
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkNetwork() {
    if (!this.permissions.network?.searchEnabled) {
      return { allowed: false, reason: '用户未启用网络搜索权限' };
    }
    return { allowed: true };
  }

  /**
   * 检查是否启用 Git 协作
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkGit() {
    if (!this.permissions.git?.enabled) {
      return { allowed: false, reason: '用户未启用 Git 协作功能' };
    }
    return { allowed: true };
  }

  /**
   * 检查 Git 自动提交
   * @returns {{ allowed: boolean, needConfirm?: boolean }}
   */
  checkGitCommit() {
    const gitCheck = this.checkGit();
    if (!gitCheck.allowed) {
      return gitCheck;
    }
    return {
      allowed: true,
      needConfirm: !this.permissions.git?.autoCommit,
    };
  }

  /**
   * 综合检查工具执行权限
   * @param {string} toolName - 工具名称
   * @param {Object} args - 工具参数
   * @returns {{ allowed: boolean, reason?: string, needConfirm?: boolean }}
   */
  checkToolPermission(toolName, args = {}) {
    switch (toolName) {
      case 'read_file':
      case 'list_files':
        return this.checkPath(args.path);

      case 'write_file': {
        const pathCheck = this.checkPath(args.path);
        if (!pathCheck.allowed) return pathCheck;
        return this.checkWrite();
      }

      case 'shell':
        return this.checkShell(args.command);

      case 'web_search':
        return this.checkNetwork();

      case 'git_status':
      case 'git_create_pr':
      case 'git_review_pr':
      case 'git_branch':
      case 'git_list_branches':
      case 'git_log':
      case 'git_init':
      case 'git_list_prs':
      case 'git_pr_diff':
      case 'git_close_pr':
        return this.checkGit();

      case 'git_commit':
      case 'git_merge':
        return this.checkGitCommit();

      case 'calculator':
      case 'token_stats':
      case 'token_set_budget':
      case 'agent_approve':
        // 这些工具没有特殊权限要求
        return { allowed: true };

      default:
        return { allowed: true };
    }
  }
}

module.exports = { PermissionChecker };
