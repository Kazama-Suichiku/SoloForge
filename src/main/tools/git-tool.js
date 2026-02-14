/**
 * SoloForge - Git 工具
 * 提供 Git 版本控制和协作功能
 * @module tools/git-tool
 */

const { toolRegistry } = require('./tool-registry');
const { PRManager } = require('../git/pr-manager');
const { permissionStore } = require('../config/permission-store');
const { logger } = require('../utils/logger');

// chatManager 引用，由 initGitNotifications 注入
let _chatManager = null;

/**
 * 注入 chatManager 引用以支持 PR 事件通知
 * @param {Object} chatManager
 */
function initGitNotifications(chatManager) {
  _chatManager = chatManager;
}

/**
 * 向指定 Agent 推送 PR 通知
 * @param {string} agentId
 * @param {string} content
 */
function notifyAgent(agentId, content) {
  if (!_chatManager?.pushProactiveMessage) return;
  try {
    _chatManager.pushProactiveMessage(agentId, content);
  } catch (e) {
    logger.warn('PR 通知推送失败:', e.message);
  }
}

// 默认工作区路径（可在运行时配置）
let defaultWorkspacePath = process.cwd();

/**
 * 设置默认工作区路径
 * @param {string} path
 */
function setWorkspacePath(path) {
  defaultWorkspacePath = path;
}

/**
 * 智能解析工作区路径
 * 优先使用传入的 workspace，否则从用户权限 allowedPaths 取第一个，最后 fallback 到 defaultWorkspacePath
 * @param {string} [workspace]
 * @returns {string}
 */
function resolveWorkspace(workspace) {
  if (workspace) return workspace;

  // 从用户权限配置中获取 allowedPaths
  try {
    const perms = permissionStore.get();
    const allowedPaths = perms?.files?.allowedPaths;
    if (Array.isArray(allowedPaths) && allowedPaths.length > 0) {
      return allowedPaths[0];
    }
  } catch (e) {
    logger.warn('读取权限配置获取工作区路径失败:', e.message);
  }

  return defaultWorkspacePath;
}

/**
 * 获取 PR 管理器
 * @param {string} [workspacePath]
 * @returns {PRManager}
 */
function getPRManager(workspacePath) {
  return new PRManager(resolveWorkspace(workspacePath));
}

/**
 * Git 状态工具
 */
const gitStatusTool = {
  name: 'git_status',
  description: '获取 Git 仓库状态，包括当前分支、变更文件、最近提交等。',
  category: 'git',
  parameters: {
    workspace: {
      type: 'string',
      description: '工作区路径（默认当前目录）',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args) {
    const manager = getPRManager(args.workspace);
    const status = await manager.getStatus();

    if (!status.isRepository) {
      return { isRepository: false, message: '当前目录不是 Git 仓库' };
    }

    return status;
  },
};

/**
 * Git 提交工具
 */
const gitCommitTool = {
  name: 'git_commit',
  description: '提交当前更改到 Git 仓库。',
  category: 'git',
  parameters: {
    message: {
      type: 'string',
      description: '提交信息',
      required: true,
    },
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
    addAll: {
      type: 'boolean',
      description: '是否添加所有更改（默认 true）',
      required: false,
      default: true,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args, context) {
    const { message, workspace, addAll = true } = args;
    const manager = getPRManager(workspace);

    if (addAll) {
      await manager.git('add -A');
    }

    // 使用 Agent 身份作为 commit author，区分不同 Agent 的提交
    const agentId = context?.agentId || 'unknown';
    let authorName = agentId;
    let authorEmail = `${agentId}@soloforge.local`;
    try {
      const { agentConfigStore } = require('../config/agent-config-store');
      const config = agentConfigStore.get(agentId);
      if (config?.name) {
        authorName = config.name;
      }
    } catch { /* fallback to agentId */ }

    const escapedMsg = message.replace(/"/g, '\\"');
    const authorArg = `--author="${authorName} <${authorEmail}>"`;
    const output = await manager.git(`commit ${authorArg} -m "${escapedMsg}"`);

    return {
      success: true,
      message: output,
      commitMessage: message,
      author: `${authorName} <${authorEmail}>`,
    };
  },
};

/**
 * 创建 PR 工具
 */
const gitCreatePRTool = {
  name: 'git_create_pr',
  description: '创建 Pull Request（合并请求）。',
  category: 'git',
  parameters: {
    title: {
      type: 'string',
      description: 'PR 标题',
      required: true,
    },
    description: {
      type: 'string',
      description: 'PR 描述',
      required: false,
    },
    source_branch: {
      type: 'string',
      description: '源分支（要合并的分支）',
      required: true,
    },
    target_branch: {
      type: 'string',
      description: '目标分支（默认 main）',
      required: false,
      default: 'main',
    },
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args, context) {
    const {
      title,
      description = '',
      source_branch,
      target_branch = 'main',
      workspace,
    } = args;

    const manager = getPRManager(workspace);
    const pr = await manager.createPR({
      title,
      description,
      sourceBranch: source_branch,
      targetBranch: target_branch,
      author: context.agentId || 'unknown',
    });

    // 通知老板有新 PR 创建
    notifyAgent(context.agentId,
      `📋 PR 已创建: **${pr.title}** (${pr.sourceBranch} → ${pr.targetBranch})，等待审核。`
    );

    return {
      success: true,
      pr: {
        id: pr.id,
        title: pr.title,
        sourceBranch: pr.sourceBranch,
        targetBranch: pr.targetBranch,
        status: pr.status,
        changedFiles: pr.changedFiles?.length || 0,
      },
    };
  },
};

/**
 * 审核 PR 工具
 */
const gitReviewPRTool = {
  name: 'git_review_pr',
  description: '审核 Pull Request。',
  category: 'git',
  parameters: {
    pr_id: {
      type: 'string',
      description: 'PR ID',
      required: true,
    },
    action: {
      type: 'string',
      description: '审核动作：approve（批准）、request_changes（要求修改）、comment（评论）',
      required: true,
    },
    comment: {
      type: 'string',
      description: '审核意见',
      required: false,
    },
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args, context) {
    const { pr_id, action, comment, workspace } = args;

    if (!['approve', 'request_changes', 'comment'].includes(action)) {
      throw new Error('action 必须是 approve、request_changes 或 comment');
    }

    const manager = getPRManager(workspace);
    const pr = await manager.reviewPR(pr_id, {
      reviewer: context.agentId || 'unknown',
      status: action,
      comment,
    });

    // 通知 PR 作者审核结果
    const reviewer = context.agentId || 'unknown';
    const actionLabel = { approve: '✅ 已批准', request_changes: '🔄 要求修改', comment: '💬 评论' };
    const commentSuffix = comment ? `\n意见: ${comment}` : '';
    notifyAgent(pr.author,
      `${actionLabel[action] || action} - PR「${pr.title}」被 ${reviewer} 审核。当前状态: ${pr.status}${commentSuffix}`
    );

    return {
      success: true,
      pr: {
        id: pr.id,
        status: pr.status,
        reviews: pr.reviews,
      },
    };
  },
};

/**
 * 合并 PR 工具
 */
const gitMergeTool = {
  name: 'git_merge',
  description: '合并已批准的 Pull Request。',
  category: 'git',
  parameters: {
    pr_id: {
      type: 'string',
      description: 'PR ID',
      required: true,
    },
    squash: {
      type: 'boolean',
      description: '是否压缩提交',
      required: false,
      default: false,
    },
    delete_branch: {
      type: 'boolean',
      description: '合并后是否删除源分支',
      required: false,
      default: true,
    },
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args, context) {
    const { pr_id, squash = false, delete_branch = true, workspace } = args;

    const manager = getPRManager(workspace);
    const pr = await manager.mergePR(pr_id, {
      mergedBy: context.agentId || 'unknown',
      squash,
      deleteBranch: delete_branch,
    });

    // 通知 PR 作者合并成功
    notifyAgent(pr.author,
      `🎉 PR「${pr.title}」已合并到 ${pr.targetBranch}（by ${context.agentId || 'unknown'}）${pr.branchDeleted ? '，工作分支已清理' : ''}`
    );

    return {
      success: true,
      pr: {
        id: pr.id,
        status: pr.status,
        mergedBy: pr.mergedBy,
        mergedAt: pr.mergedAt,
        branchDeleted: pr.branchDeleted,
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════
// 新增工具
// ═══════════════════════════════════════════════════════════

/**
 * 分支管理工具（创建/切换/删除）
 */
const gitBranchTool = {
  name: 'git_branch',
  description: `管理 Git 分支：创建、切换或删除分支。

操作说明：
- action=create: 创建新分支（可指定 base_branch 基于哪个分支创建）
- action=checkout: 切换到已有分支
- action=delete: 删除分支（force=true 强制删除）

分支命名规范：agentId/task-name（如 writer/add-readme）`,
  category: 'git',
  parameters: {
    action: {
      type: 'string',
      description: '操作：create（创建）、checkout（切换）、delete（删除）',
      required: true,
    },
    branch_name: {
      type: 'string',
      description: '分支名称',
      required: true,
    },
    base_branch: {
      type: 'string',
      description: '基于哪个分支创建（仅 create 时有效，默认当前分支）',
      required: false,
    },
    force: {
      type: 'boolean',
      description: '是否强制删除（仅 delete 时有效）',
      required: false,
      default: false,
    },
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args) {
    const { action, branch_name, base_branch, force = false, workspace } = args;
    const manager = getPRManager(workspace);

    switch (action) {
      case 'create':
        return manager.createBranch(branch_name, { baseBranch: base_branch, checkout: true });
      case 'checkout':
        return manager.checkoutBranch(branch_name);
      case 'delete':
        return manager.deleteBranch(branch_name, { force });
      default:
        throw new Error('action 必须是 create、checkout 或 delete');
    }
  },
};

/**
 * 列出分支
 */
const gitListBranchesTool = {
  name: 'git_list_branches',
  description: '列出 Git 仓库的所有分支，显示当前分支和最近提交。',
  category: 'git',
  parameters: {
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args) {
    const manager = getPRManager(args.workspace);
    const branches = await manager.listBranches();
    const current = branches.find((b) => b.isCurrent);
    return {
      currentBranch: current?.name || 'unknown',
      total: branches.length,
      branches,
    };
  },
};

/**
 * 查看提交历史
 */
const gitLogTool = {
  name: 'git_log',
  description: '查看 Git 提交历史。',
  category: 'git',
  parameters: {
    count: {
      type: 'number',
      description: '显示条数（默认 10，最大 50）',
      required: false,
      default: 10,
    },
    branch: {
      type: 'string',
      description: '查看指定分支的历史（默认当前分支）',
      required: false,
    },
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args) {
    const { count = 10, branch, workspace } = args;
    const limit = Math.min(Math.max(count, 1), 50);
    const manager = getPRManager(workspace);

    const branchArg = branch ? ` ${branch}` : '';
    const output = await manager.git(
      `log --oneline --format="%H|%s|%an|%ar"${branchArg} -${limit}`
    );

    const commits = output
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const [hash, message, author, date] = line.split('|');
        return { hash: hash?.slice(0, 8), message, author, date };
      });

    return { total: commits.length, commits };
  },
};

/**
 * 初始化仓库
 */
const gitInitTool = {
  name: 'git_init',
  description: '初始化一个新的 Git 仓库（如果已经是仓库则跳过）。',
  category: 'git',
  parameters: {
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args) {
    const manager = getPRManager(args.workspace);
    return manager.initRepository();
  },
};

/**
 * 列出 PR
 */
const gitListPRsTool = {
  name: 'git_list_prs',
  description: '列出 Pull Request，可按状态和作者过滤。',
  category: 'git',
  parameters: {
    status: {
      type: 'string',
      description: '按状态过滤：open、approved、merged、closed（不填显示全部）',
      required: false,
    },
    author: {
      type: 'string',
      description: '按作者过滤（Agent ID）',
      required: false,
    },
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args) {
    const { status, author, workspace } = args;
    const manager = getPRManager(workspace);
    const prs = manager.listPRs({ status, author });

    return {
      total: prs.length,
      filter: { status: status || '全部', author: author || '全部' },
      pullRequests: prs.map((pr) => ({
        id: pr.id,
        title: pr.title,
        author: pr.author,
        sourceBranch: pr.sourceBranch,
        targetBranch: pr.targetBranch,
        status: pr.status,
        reviewCount: pr.reviews?.length || 0,
        createdAt: pr.createdAt,
      })),
    };
  },
};

/**
 * 查看 PR diff
 */
const gitPRDiffTool = {
  name: 'git_pr_diff',
  description: '查看 Pull Request 的代码变更内容。审核 PR 前必须先查看 diff。',
  category: 'git',
  parameters: {
    pr_id: {
      type: 'string',
      description: 'PR ID',
      required: true,
    },
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args) {
    const { pr_id, workspace } = args;
    const manager = getPRManager(workspace);
    const pr = manager.getPR(pr_id);
    if (!pr) throw new Error(`PR "${pr_id}" 不存在`);

    const diff = await manager.getPRDiff(pr_id);

    return {
      pr: {
        id: pr.id,
        title: pr.title,
        author: pr.author,
        sourceBranch: pr.sourceBranch,
        targetBranch: pr.targetBranch,
        changedFiles: pr.changedFiles,
      },
      diff: diff || '（无差异）',
    };
  },
};

/**
 * 关闭 PR
 */
const gitClosePRTool = {
  name: 'git_close_pr',
  description: '关闭一个 Pull Request（不合并）。',
  category: 'git',
  parameters: {
    pr_id: {
      type: 'string',
      description: 'PR ID',
      required: true,
    },
    workspace: {
      type: 'string',
      description: '工作区路径',
      required: false,
    },
  },
  requiredPermissions: ['git.enabled'],

  async execute(args, context) {
    const { pr_id, workspace } = args;
    const manager = getPRManager(workspace);
    const pr = await manager.closePR(pr_id, context.agentId || 'unknown');
    return {
      success: true,
      pr: { id: pr.id, status: pr.status, closedBy: pr.closedBy },
    };
  },
};

/**
 * 注册 Git 工具
 */
function registerGitTools() {
  // 原有工具
  toolRegistry.register(gitStatusTool);
  toolRegistry.register(gitCommitTool);
  toolRegistry.register(gitCreatePRTool);
  toolRegistry.register(gitReviewPRTool);
  toolRegistry.register(gitMergeTool);
  // 新增工具
  toolRegistry.register(gitBranchTool);
  toolRegistry.register(gitListBranchesTool);
  toolRegistry.register(gitLogTool);
  toolRegistry.register(gitInitTool);
  toolRegistry.register(gitListPRsTool);
  toolRegistry.register(gitPRDiffTool);
  toolRegistry.register(gitClosePRTool);
}

module.exports = {
  gitStatusTool,
  gitCommitTool,
  gitCreatePRTool,
  gitReviewPRTool,
  gitMergeTool,
  gitBranchTool,
  gitListBranchesTool,
  gitLogTool,
  gitInitTool,
  gitListPRsTool,
  gitPRDiffTool,
  gitClosePRTool,
  registerGitTools,
  setWorkspacePath,
  resolveWorkspace,
  initGitNotifications,
};
