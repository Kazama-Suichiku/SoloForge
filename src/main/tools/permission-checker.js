/**
 * SoloForge - 权限检查器
 * 检查工具执行是否符合用户配置的安全边界
 *
 * Phase 2-C：数据源改为优先从 AgentPermissionStore（每 Agent 粒度的权限集）读取
 * fileAccess/shellAccess/networkAccess/gitAccess。若该 Agent 在 PermissionStore 中
 * 没有记录，则回退到构造时传入的 this.permissions（用户全局权限配置）。
 * 所有 check 逻辑保持不变，只换数据来源。
 *
 * 注意：本检查器是「用户/Agent 级」资源权限（文件路径/Shell/Git/网络开关），
 * 不负责「工具可见性」过滤（那由 PermissionManager.getAccessibleTools 在
 * tool-context.js 中处理）。
 *
 * @module tools/permission-checker
 */

const path = require('path');
const os = require('os');

// ─────────────────────────────────────────────────────────────
// 懒加载 AgentPermissionStore（2-A 产物，可能缺失）
// ─────────────────────────────────────────────────────────────
let _agentPermStore = null;
let _agentPermStoreChecked = false;
function getAgentPermStore() {
  if (!_agentPermStoreChecked) {
    _agentPermStoreChecked = true;
    try {
      const mod = require('../permission/permission-store');
      _agentPermStore = mod.agentPermissionStore || mod.AgentPermissionStore?.instance || mod.default || null;
    } catch (e) {
      _agentPermStore = null;
    }
  }
  return _agentPermStore;
}

/**
 * 将 PermissionStore 的 PermissionSet 归一化为本检查器使用的
 * this.permissions 风格（files / shell / network / git 四段）。
 *
 * PermissionSet 的字段命名与 this.permissions 略有不同：
 *   - PermissionSet.fileAccess.{allowedPaths, writeEnabled, writeConfirm}
 *     ↔ this.permissions.files.{allowedPaths, writeEnabled, writeConfirm}
 *   - PermissionSet.shellAccess.{enabled, blacklist, confirmEach}
 *     ↔ this.permissions.shell.{enabled, blacklist, confirmEach}
 *   - PermissionSet.networkAccess.{searchEnabled}
 *     ↔ this.permissions.network.{searchEnabled}
 *   - PermissionSet.gitAccess.{enabled, autoCommit}
 *     ↔ this.permissions.git.{enabled, autoCommit}
 *
 * @param {Object} permSet - PermissionStore 中的 PermissionSet
 * @returns {Object} this.permissions 风格对象
 */
function _permSetToUserStyle(permSet) {
  if (!permSet || typeof permSet !== 'object') return null;
  const fa = permSet.fileAccess || {};
  const sa = permSet.shellAccess || {};
  const na = permSet.networkAccess || {};
  const ga = permSet.gitAccess || {};
  return {
    files: {
      allowedPaths: Array.isArray(fa.allowedPaths) ? fa.allowedPaths : [],
      writeEnabled: !!fa.writeEnabled,
      writeConfirm: fa.writeConfirm != null ? !!fa.writeConfirm : true,
    },
    shell: {
      enabled: !!sa.enabled,
      blacklist: Array.isArray(sa.blacklist) ? sa.blacklist : [],
      confirmEach: sa.confirmEach != null ? !!sa.confirmEach : true,
    },
    network: {
      searchEnabled: na.searchEnabled != null ? !!na.searchEnabled : true,
    },
    git: {
      enabled: !!ga.enabled,
      autoCommit: !!ga.autoCommit,
    },
  };
}

/**
 * 权限检查器
 */
class PermissionChecker {
  /**
   * @param {Object} userPermissions - 用户权限配置（回退数据源）
   */
  constructor(userPermissions = {}) {
    this.permissions = userPermissions;
    /** @type {string|null} 当前绑定的 Agent ID（由 setAgentContext 设置） */
    this._agentId = null;
  }

  /**
   * 更新权限配置（回退数据源）
   * @param {Object} permissions
   */
  setPermissions(permissions) {
    this.permissions = permissions || {};
  }

  /**
   * 绑定当前调用的 Agent 上下文。
   * 设置后，check* 方法会优先从 PermissionStore 读取该 Agent 的权限集；
   * 若该 Agent 在 PermissionStore 中没有记录，回退到 this.permissions。
   *
   * @param {string|null} agentId
   */
  setAgentContext(agentId) {
    this._agentId = agentId || null;
  }

  /**
   * 获取当前生效的权限对象（this.permissions 风格）。
   *
   * 优先级：
   *   1. 若已 setAgentContext(agentId) 且 PermissionStore 中有该 Agent 的记录
   *      → 返回归一化后的 PermissionSet
   *   2. 否则 → 返回 this.permissions（用户全局配置）
   *
   * @returns {Object} { files, shell, network, git }
   */
  _effectivePermissions() {
    if (this._agentId) {
      const store = getAgentPermStore();
      if (store && typeof store.getPermissionSet === 'function') {
        try {
          const permSet = store.getPermissionSet(this._agentId);
          if (permSet) {
            const userStyle = _permSetToUserStyle(permSet);
            if (userStyle) return userStyle;
          }
        } catch (e) {
          // 读取失败 → 回退
        }
      }
    }
    return this.permissions || {};
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

    const perms = this._effectivePermissions();
    const allowedPaths = perms.files?.allowedPaths ?? [];

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
    const perms = this._effectivePermissions();
    if (!perms.files?.writeEnabled) {
      return { allowed: false, reason: '用户未启用文件写入权限' };
    }
    return {
      allowed: true,
      needConfirm: perms.files?.writeConfirm ?? true,
    };
  }

  /**
   * 检查是否允许执行 Shell 命令
   * @param {string} command - 要执行的命令
   * @param {string} [cwd] - 工作目录
   * @returns {{ allowed: boolean, reason?: string, needConfirm?: boolean }}
   */
  checkShell(command, cwd) {
    const perms = this._effectivePermissions();
    if (!perms.shell?.enabled) {
      return { allowed: false, reason: '用户未启用 Shell 命令权限' };
    }

    // 防御：command 未定义
    if (!command || typeof command !== 'string') {
      return { allowed: false, reason: '未提供有效的命令参数' };
    }

    // 检查黑名单
    const blacklist = perms.shell?.blacklist ?? [];
    for (const pattern of blacklist) {
      if (command.includes(pattern)) {
        return {
          allowed: false,
          reason: `命令包含禁止的模式: "${pattern}"`,
        };
      }
    }

    // 检查文件写入操作的路径安全性
    const fileWriteCheck = this._checkShellFileOperations(command, cwd);
    if (!fileWriteCheck.allowed) {
      return fileWriteCheck;
    }

    return {
      allowed: true,
      needConfirm: perms.shell?.confirmEach ?? true,
    };
  }

  /**
   * 检查 Shell 命令中的文件操作是否在允许的路径内
   * @param {string} command - 命令
   * @param {string} [cwd] - 工作目录
   * @returns {{ allowed: boolean, reason?: string }}
   */
  _checkShellFileOperations(command, cwd) {
    const perms = this._effectivePermissions();
    const allowedPaths = perms.files?.allowedPaths ?? [];
    
    // 如果没有配置允许路径，则不检查（向后兼容）
    if (allowedPaths.length === 0) {
      return { allowed: true };
    }

    // 提取可能的文件写入目标路径
    const writePaths = this._extractWritePathsFromCommand(command);
    
    if (writePaths.length === 0) {
      return { allowed: true };
    }

    // 检查每个写入路径是否在允许范围内
    for (const writePath of writePaths) {
      // 解析相对路径
      let absolutePath;
      if (path.isAbsolute(writePath)) {
        absolutePath = writePath;
      } else if (cwd) {
        absolutePath = path.resolve(cwd, writePath);
      } else {
        // 没有 cwd，使用相对路径检查
        absolutePath = path.resolve(process.cwd(), writePath);
      }

      const normalizedTarget = path.resolve(this.expandPath(absolutePath));
      let isAllowed = false;

      for (const allowed of allowedPaths) {
        const normalizedAllowed = path.resolve(this.expandPath(allowed));
        if (
          normalizedTarget === normalizedAllowed ||
          normalizedTarget.startsWith(normalizedAllowed + path.sep)
        ) {
          isAllowed = true;
          break;
        }
      }

      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Shell 命令尝试写入不允许的路径: "${writePath}"。只能在以下目录操作: ${allowedPaths.join(', ')}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 从 Shell 命令中提取可能的文件写入目标路径
   * @param {string} command
   * @returns {string[]}
   */
  _extractWritePathsFromCommand(command) {
    const paths = [];

    // 匹配重定向操作符 >, >>, 2>, 2>>, &>, &>>
    // 例如: echo "test" > /path/to/file
    // 例如: cat << EOF > /path/to/file
    const redirectPatterns = [
      /(?:^|[;&|])\s*[^>]*\s+>{1,2}\s*["']?([^\s"';&|]+)["']?/g,  // > 或 >>
      /(?:^|[;&|])\s*[^>]*\s+2>{1,2}\s*["']?([^\s"';&|]+)["']?/g, // 2> 或 2>>
      /(?:^|[;&|])\s*[^>]*\s+&>{1,2}\s*["']?([^\s"';&|]+)["']?/g, // &> 或 &>>
    ];

    for (const pattern of redirectPatterns) {
      let match;
      while ((match = pattern.exec(command)) !== null) {
        const filePath = match[1];
        if (filePath && filePath !== '/dev/null' && !filePath.startsWith('/dev/')) {
          paths.push(filePath);
        }
      }
    }

    // 匹配 tee 命令
    // 例如: echo "test" | tee /path/to/file
    const teePattern = /\|\s*tee\s+(?:-a\s+)?["']?([^\s"';&|]+)["']?/g;
    let teeMatch;
    while ((teeMatch = teePattern.exec(command)) !== null) {
      const filePath = teeMatch[1];
      if (filePath && !filePath.startsWith('-')) {
        paths.push(filePath);
      }
    }

    // 匹配 cp, mv 命令的目标路径
    // 例如: cp source dest
    // 例如: mv source dest
    const cpMvPattern = /(?:^|[;&|])\s*(?:cp|mv)\s+(?:-[a-zA-Z]+\s+)*["']?[^\s"';&|]+["']?\s+["']?([^\s"';&|]+)["']?/g;
    let cpMvMatch;
    while ((cpMvMatch = cpMvPattern.exec(command)) !== null) {
      const destPath = cpMvMatch[1];
      if (destPath && !destPath.startsWith('-')) {
        paths.push(destPath);
      }
    }

    // 匹配 mkdir 命令
    // 例如: mkdir -p /path/to/dir
    const mkdirPattern = /(?:^|[;&|])\s*mkdir\s+(?:-[a-zA-Z]+\s+)*["']?([^\s"';&|]+)["']?/g;
    let mkdirMatch;
    while ((mkdirMatch = mkdirPattern.exec(command)) !== null) {
      const dirPath = mkdirMatch[1];
      if (dirPath && !dirPath.startsWith('-')) {
        paths.push(dirPath);
      }
    }

    // 匹配 touch 命令
    const touchPattern = /(?:^|[;&|])\s*touch\s+["']?([^\s"';&|]+)["']?/g;
    let touchMatch;
    while ((touchMatch = touchPattern.exec(command)) !== null) {
      const filePath = touchMatch[1];
      if (filePath && !filePath.startsWith('-')) {
        paths.push(filePath);
      }
    }

    // 匹配 rm 命令（删除也是危险操作）
    const rmPattern = /(?:^|[;&|])\s*rm\s+(?:-[a-zA-Z]+\s+)*["']?([^\s"';&|]+)["']?/g;
    let rmMatch;
    while ((rmMatch = rmPattern.exec(command)) !== null) {
      const filePath = rmMatch[1];
      if (filePath && !filePath.startsWith('-')) {
        paths.push(filePath);
      }
    }

    // 匹配 cat << 'EOF' > file 的 heredoc 模式
    const heredocPattern = /<<\s*['"]?(\w+)['"]?\s*>{1,2}\s*["']?([^\s"';&|]+)["']?/g;
    let heredocMatch;
    while ((heredocMatch = heredocPattern.exec(command)) !== null) {
      const filePath = heredocMatch[2];
      if (filePath) {
        paths.push(filePath);
      }
    }

    return [...new Set(paths)]; // 去重
  }

  /**
   * 检查是否允许网络搜索
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkNetwork() {
    const perms = this._effectivePermissions();
    if (!perms.network?.searchEnabled) {
      return { allowed: false, reason: '用户未启用网络搜索权限' };
    }
    return { allowed: true };
  }

  /**
   * 检查是否启用 Git 协作
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkGit() {
    const perms = this._effectivePermissions();
    if (!perms.git?.enabled) {
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
    const perms = this._effectivePermissions();
    return {
      allowed: true,
      needConfirm: !perms.git?.autoCommit,
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
      // ───────────────────────────────────────────────────────────
      // 只读工具：路径校验（保持原有逻辑）
      // ───────────────────────────────────────────────────────────
      case 'read_file':
      case 'list_files':
        return this.checkPath(args.path);

      // ───────────────────────────────────────────────────────────
      // 写操作 / 低风险：路径 + 写权限校验（保持原有逻辑）
      // ───────────────────────────────────────────────────────────
      case 'write_file': {
        const pathCheck = this.checkPath(args.path);
        if (!pathCheck.allowed) return pathCheck;
        return this.checkWrite();
      }

      // ───────────────────────────────────────────────────────────
      // 中风险：Shell / 网络 / Git（保持原有逻辑，依赖用户配置）
      // ───────────────────────────────────────────────────────────
      case 'shell':
        return this.checkShell(args.command, args.cwd);

      case 'shell_read_output':
      case 'shell_kill_process': {
        // Shell 衍生工具：需要 shell.enabled；kill 另需 confirm
        const shellCheck = this.checkShell('', args.cwd);
        if (!shellCheck.allowed) {
          return shellCheck;
        }
        const perms = this._effectivePermissions();
        return {
          allowed: true,
          needConfirm: toolName === 'shell_kill_process'
            ? true
            : (perms.shell?.confirmEach ?? true),
        };
      }

      case 'web_search':
      case 'fetch_webpage':
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

      // ───────────────────────────────────────────────────────────
      // 只读工具：无路径要求（直接放行）
      // ───────────────────────────────────────────────────────────
      case 'calculator':
      case 'token_stats':
      case 'token_set_budget':
        // 这些工具没有特殊权限要求
        return { allowed: true };

      // 上下文 / 虚拟文件（只读）
      case 'read_virtual_file':
      case 'list_virtual_files':
      case 'view_scratchpad':
      case 'recall_compressed_history':
        return { allowed: true };

      // 记忆（只读）
      case 'memory_recall':
      case 'memory_search':
      case 'memory_list_recent':
      case 'memory_company_facts':
      case 'memory_user_profile':
      case 'memory_project_context':
        return { allowed: true };

      // Todo（只读）
      case 'todo_list':
        return { allowed: true };

      // 历史（只读）
      case 'load_history':
      case 'history_info':
        return { allowed: true };

      // 报告（只读）
      case 'list_reports':
        return { allowed: true };

      // HR 只读
      case 'hr_list_agents':
      case 'hr_org_chart':
      case 'agent_requests':
      case 'hr_question':
      case 'hr_team_analytics':
      case 'hr_onboarding_status':
      case 'hr_list_departments':
      case 'hr_view_budget':
      case 'hr_personnel_history':
        return { allowed: true };

      // 协作只读
      case 'list_colleagues':
      case 'collaboration_stats':
      case 'communication_info':
      case 'communication_history':
      case 'browse_communication_history':
      case 'my_tasks':
        return { allowed: true };

      // PM 只读
      case 'pm_list_projects':
      case 'pm_project_detail':
      case 'pm_status_report':
        return { allowed: true };

      // 运营只读
      case 'ops_list_goals':
      case 'ops_list_kpis':
      case 'ops_list_tasks':
      case 'ops_dashboard':
      case 'ops_activity_log':
      case 'ops_my_tasks':
        return { allowed: true };

      // 招聘只读（查看自己的请求）
      case 'recruit_my_requests':
        return { allowed: true };

      // Shell 只读
      case 'shell_process_status':
      case 'shell_list_processes':
        return { allowed: true };

      // ───────────────────────────────────────────────────────────
      // 写操作 / 低风险（放行）
      // ───────────────────────────────────────────────────────────
      // 记忆写入
      case 'memory_store':
        return { allowed: true };

      // Todo 写入
      case 'todo_create':
      case 'todo_update':
      case 'todo_clear_done':
        return { allowed: true };

      // 上下文写入
      case 'update_scratchpad':
        return { allowed: true };

      // 报告写入
      case 'create_report':
        return { allowed: true };

      // 部门管理（创建/修改/成员调整，低风险）
      case 'hr_create_department':
      case 'hr_update_department':
      case 'hr_add_department':
      case 'hr_remove_department':
      case 'hr_set_primary_department':
        return { allowed: true };

      // 协作写入（低风险）
      case 'post_to_department':
      case 'rename_department_group':
      case 'send_to_agent':
      case 'delegate_task':
      case 'notify_boss':
      case 'submit_dev_plan':
      case 'approve_dev_plan':
      case 'reject_dev_plan':
      case 'create_group_chat':
        return { allowed: true };

      // PM 写入（创建/更新/分配，低风险；删除见下方高风险区）
      case 'pm_create_project':
      case 'pm_update_project':
      case 'pm_add_milestone':
      case 'pm_update_milestone':
      case 'pm_add_tasks':
      case 'pm_start_project':
      case 'pm_assign_task':
      case 'pm_update_task':
        return { allowed: true };

      // 运营写入（创建/更新/认领/汇报，低风险；删除见下方高风险区）
      case 'ops_create_goal':
      case 'ops_update_goal':
      case 'ops_create_kpi':
      case 'ops_update_kpi':
      case 'ops_create_task':
      case 'ops_update_task':
      case 'ops_claim_task':
      case 'ops_report_progress':
        return { allowed: true };

      // ───────────────────────────────────────────────────────────
      // 高风险：需老板审批（拒绝，并标记 requiresApproval）
      // ───────────────────────────────────────────────────────────
      // 人事高风险操作
      case 'hr_dismiss_request':
      case 'dismiss_confirm':
      case 'hr_suspend_agent':
      case 'hr_reinstate_agent':
      case 'hr_promote_agent':
      case 'hr_demote_agent':
      case 'hr_end_probation':
      case 'hr_performance_review':
      case 'hr_transfer_agent':
      case 'hr_update_agent':
      case 'hr_batch_update':
      case 'hr_delete_department':
        return {
          allowed: false,
          reason: '需要老板审批',
          requiresApproval: true,
        };

      // 协作高风险操作
      case 'suspend_subordinate':
      case 'reinstate_subordinate':
      case 'cancel_delegated_task':
        return {
          allowed: false,
          reason: '需要老板审批',
          requiresApproval: true,
        };

      // 招聘高风险操作
      case 'recruit_request':
      case 'recruit_respond':
        return {
          allowed: false,
          reason: '需要老板审批',
          requiresApproval: true,
        };

      // 破坏性删除操作（宁可错杀）
      case 'pm_delete_project':
      case 'ops_delete_goal':
      case 'ops_delete_kpi':
      case 'ops_delete_task':
        return {
          allowed: false,
          reason: '需要老板审批',
          requiresApproval: true,
        };

      // ───────────────────────────────────────────────────────────
      // 兼容旧入口（保持原 agent_approve 逻辑：放行）
      // 注：任务文档将 agent_approve 列为高风险，但现有代码放行。
      // 遵循"不改变现有 case 逻辑"原则，保持原状，后续可单独评估。
      // ───────────────────────────────────────────────────────────
      case 'agent_approve':
        return { allowed: true };

      // ───────────────────────────────────────────────────────────
      // 默认拒绝：未明式声明的工具一律拒绝（P0-7 安全加固）
      // ───────────────────────────────────────────────────────────
      default:
        return {
          allowed: false,
          reason: '未明式声明的工具默认拒绝',
        };
    }
  }
}

module.exports = { PermissionChecker };
