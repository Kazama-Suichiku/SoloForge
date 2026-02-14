/**
 * SoloForge - 权限持久化存储
 * 将用户权限配置保存到本地文件
 * @module config/permission-store
 */

const fs = require('fs');
const path = require('path');
const { getDefaultPermissions, validatePermissions } = require('./user-permissions');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getConfigDir() {
  return dataPath.getBasePath();
}

function getPermissionsFile() {
  return path.join(dataPath.getBasePath(), 'permissions.json');
}

/**
 * 确保配置目录存在
 */
function ensureConfigDir() {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info('创建配置目录:', dir);
  }
}

/**
 * 加载用户权限配置
 * @returns {import('./user-permissions').UserPermissions}
 */
function loadPermissions() {
  try {
    const permsFile = getPermissionsFile();
    if (fs.existsSync(permsFile)) {
      const content = fs.readFileSync(permsFile, 'utf-8');
      const parsed = JSON.parse(content);
      logger.info('加载权限配置成功');
      return validatePermissions(parsed);
    }
  } catch (error) {
    logger.error('加载权限配置失败:', error);
  }

  logger.info('使用默认权限配置');
  return getDefaultPermissions();
}

/**
 * 保存用户权限配置
 * @param {import('./user-permissions').UserPermissions} permissions
 * @returns {boolean}
 */
function savePermissions(permissions) {
  try {
    ensureConfigDir();
    const validated = validatePermissions(permissions);
    const content = JSON.stringify(validated, null, 2);
    fs.writeFileSync(getPermissionsFile(), content, 'utf-8');
    logger.info('保存权限配置成功');
    return true;
  } catch (error) {
    logger.error('保存权限配置失败:', error);
    return false;
  }
}

/**
 * 重置为默认权限
 * @returns {import('./user-permissions').UserPermissions}
 */
function resetPermissions() {
  const defaults = getDefaultPermissions();
  savePermissions(defaults);
  return defaults;
}

/**
 * 权限存储管理器（单例）
 */
class PermissionStore {
  constructor() {
    this.permissions = loadPermissions();
    this.listeners = new Set();
  }

  /**
   * 获取当前权限
   * @returns {import('./user-permissions').UserPermissions}
   */
  get() {
    return this.permissions;
  }

  /**
   * 更新权限
   * @param {Partial<import('./user-permissions').UserPermissions>} updates
   * @returns {boolean}
   */
  update(updates) {
    const merged = {
      files: { ...this.permissions.files, ...updates.files },
      shell: { ...this.permissions.shell, ...updates.shell },
      network: { ...this.permissions.network, ...updates.network },
      git: { ...this.permissions.git, ...updates.git },
    };

    const validated = validatePermissions(merged);
    const success = savePermissions(validated);

    if (success) {
      this.permissions = validated;
      this.notifyListeners();
    }

    return success;
  }

  /**
   * 重置权限
   * @returns {import('./user-permissions').UserPermissions}
   */
  reset() {
    this.permissions = resetPermissions();
    this.notifyListeners();
    return this.permissions;
  }

  /**
   * 添加权限变更监听器
   * @param {Function} listener
   * @returns {Function} 取消监听的函数
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 重新初始化（切换公司后调用）
   * 从新路径重新加载权限配置
   */
  reinitialize() {
    this.permissions = loadPermissions();
    this.notifyListeners();
  }

  /**
   * 通知所有监听器
   */
  notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener(this.permissions);
      } catch (error) {
        logger.error('权限监听器执行失败:', error);
      }
    }
  }
}

// 单例
const permissionStore = new PermissionStore();

module.exports = {
  permissionStore,
  loadPermissions,
  savePermissions,
  resetPermissions,
  getConfigDir,
  getPermissionsFile,
};
