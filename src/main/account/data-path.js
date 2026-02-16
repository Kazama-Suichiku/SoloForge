/**
 * SoloForge - 数据路径管理器
 * 中央路径管理，所有 store 通过此模块获取当前公司的数据目录
 * @module account/data-path
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { logger } = require('../utils/logger');

const SOLOFORGE_ROOT = path.join(os.homedir(), '.soloforge');

class DataPath {
  constructor() {
    this._accountId = null;
    this._companyId = null;
    this._companyName = null;
  }

  /** Get global path: ~/.soloforge/ */
  getGlobalPath() {
    return SOLOFORGE_ROOT;
  }

  /** Get current company data path: ~/.soloforge/data/{accountId}/{companyId} */
  getBasePath() {
    if (!this._accountId || !this._companyId) {
      // Fallback to legacy path for backward compatibility during migration
      return SOLOFORGE_ROOT;
    }
    return path.join(SOLOFORGE_ROOT, 'data', this._accountId, this._companyId);
  }

  /** Set current context */
  setCurrentContext(accountId, companyId, companyName = null) {
    this._accountId = accountId;
    this._companyId = companyId;
    if (companyName) this._companyName = companyName;
    logger.info('数据路径上下文已更新', { accountId, companyId, basePath: this.getBasePath() });
  }

  /** Get current company name */
  getCompanyName() {
    return this._companyName || '我的公司';
  }

  /** Get current context */
  getCurrentContext() {
    return {
      accountId: this._accountId,
      companyId: this._companyId,
      companyName: this._companyName,
    };
  }

  /** Check if context is set */
  isContextSet() {
    return !!(this._accountId && this._companyId);
  }

  /** Ensure all necessary directories exist for current context */
  ensureDirectories() {
    const dirs = [
      SOLOFORGE_ROOT,
      path.join(SOLOFORGE_ROOT, 'data'),
    ];

    if (this._accountId) {
      dirs.push(path.join(SOLOFORGE_ROOT, 'data', this._accountId));
    }

    if (this._accountId && this._companyId) {
      const basePath = this.getBasePath();
      dirs.push(basePath);
      dirs.push(path.join(basePath, 'memory'));
      dirs.push(path.join(basePath, 'reports'));
      dirs.push(path.join(basePath, 'attachments'));
      dirs.push(path.join(basePath, 'virtual-files'));  // 虚拟文件存储
      dirs.push(path.join(basePath, 'scratchpads'));    // Agent 暂存区
    }

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
}

const dataPath = new DataPath();

module.exports = { DataPath, dataPath, SOLOFORGE_ROOT };
