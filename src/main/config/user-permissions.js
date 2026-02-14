/**
 * SoloForge - 用户权限配置管理
 * 定义用户可配置的安全边界
 * @module config/user-permissions
 */

const os = require('os');
const path = require('path');

/**
 * @typedef {Object} FilePermissions
 * @property {string[]} allowedPaths - 允许访问的目录列表
 * @property {boolean} writeEnabled - 是否允许写入
 * @property {boolean} writeConfirm - 写入时是否需要确认
 */

/**
 * @typedef {Object} ShellPermissions
 * @property {boolean} enabled - 是否允许 Shell 命令
 * @property {string[]} blacklist - 禁止的命令模式
 * @property {boolean} confirmEach - 每次执行是否需要确认
 */

/**
 * @typedef {Object} NetworkPermissions
 * @property {boolean} searchEnabled - 是否允许网络搜索
 */

/**
 * @typedef {Object} GitPermissions
 * @property {boolean} enabled - 是否启用 Git 协作
 * @property {boolean} autoCommit - 是否允许自动提交
 */

/**
 * @typedef {Object} UserPermissions
 * @property {FilePermissions} files
 * @property {ShellPermissions} shell
 * @property {NetworkPermissions} network
 * @property {GitPermissions} git
 */

/**
 * 默认权限配置（保守策略）
 * @returns {UserPermissions}
 */
function getDefaultPermissions() {
  return {
    files: {
      allowedPaths: [],
      writeEnabled: false,
      writeConfirm: true,
    },
    shell: {
      enabled: false,
      blacklist: [
        'rm -rf /',
        'rm -rf ~',
        'rm -rf *',
        'mkfs',
        'dd if=',
        'chmod -R 777',
        ':(){:|:&};:',
        'wget | sh',
        'curl | sh',
        'sudo rm',
        'shutdown',
        'reboot',
        'halt',
        'poweroff',
        'init 0',
        'init 6',
      ],
      confirmEach: true,
    },
    network: {
      searchEnabled: false,
    },
    git: {
      enabled: false,
      autoCommit: false,
    },
  };
}

/**
 * 验证权限配置
 * @param {Partial<UserPermissions>} permissions
 * @returns {UserPermissions}
 */
function validatePermissions(permissions = {}) {
  const defaults = getDefaultPermissions();

  return {
    files: {
      allowedPaths: Array.isArray(permissions.files?.allowedPaths)
        ? permissions.files.allowedPaths.filter((p) => typeof p === 'string')
        : defaults.files.allowedPaths,
      writeEnabled: Boolean(permissions.files?.writeEnabled),
      writeConfirm: permissions.files?.writeConfirm ?? defaults.files.writeConfirm,
    },
    shell: {
      enabled: Boolean(permissions.shell?.enabled),
      blacklist: Array.isArray(permissions.shell?.blacklist)
        ? [...new Set([...defaults.shell.blacklist, ...permissions.shell.blacklist])]
        : defaults.shell.blacklist,
      confirmEach: permissions.shell?.confirmEach ?? defaults.shell.confirmEach,
    },
    network: {
      searchEnabled: Boolean(permissions.network?.searchEnabled),
    },
    git: {
      enabled: Boolean(permissions.git?.enabled),
      autoCommit: Boolean(permissions.git?.autoCommit),
    },
  };
}

/**
 * 获取常用的预设目录
 * @returns {Array<{label: string, path: string}>}
 */
function getSuggestedPaths() {
  const home = os.homedir();
  return [
    { label: '桌面', path: path.join(home, 'Desktop') },
    { label: '文档', path: path.join(home, 'Documents') },
    { label: '下载', path: path.join(home, 'Downloads') },
    { label: '项目目录', path: path.join(home, 'Projects') },
    { label: '代码目录', path: path.join(home, 'Code') },
    { label: '当前工作区', path: process.cwd() },
  ];
}

module.exports = {
  getDefaultPermissions,
  validatePermissions,
  getSuggestedPaths,
};
