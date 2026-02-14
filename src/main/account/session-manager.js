/**
 * SoloForge - 会话管理器
 * 管理当前登录状态和选中的公司
 * 持久化到 ~/.soloforge/session.json
 * @module account/session-manager
 */
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { SOLOFORGE_ROOT } = require('./data-path');

const SESSION_FILE = path.join(SOLOFORGE_ROOT, 'session.json');

class SessionManager {
  constructor() {
    this._session = this._loadFromDisk();
  }

  _loadFromDisk() {
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const content = fs.readFileSync(SESSION_FILE, 'utf-8');
        const data = JSON.parse(content);
        logger.info('会话数据已加载', { accountId: data.accountId });
        return data;
      }
    } catch (error) {
      logger.error('加载会话数据失败', error);
    }
    return null;
  }

  _saveToDisk() {
    try {
      if (!fs.existsSync(SOLOFORGE_ROOT)) {
        fs.mkdirSync(SOLOFORGE_ROOT, { recursive: true });
      }
      if (this._session) {
        fs.writeFileSync(SESSION_FILE, JSON.stringify(this._session, null, 2), 'utf-8');
      } else {
        // Clear session file
        if (fs.existsSync(SESSION_FILE)) {
          fs.unlinkSync(SESSION_FILE);
        }
      }
    } catch (error) {
      logger.error('保存会话数据失败', error);
    }
  }

  /**
   * Save session after login
   * @param {string} accountId
   * @param {string} [companyId] - Last selected company
   */
  saveSession(accountId, companyId = null) {
    this._session = {
      accountId,
      lastCompanyId: companyId,
      updatedAt: new Date().toISOString(),
    };
    this._saveToDisk();
    logger.info('会话已保存', { accountId, companyId });
  }

  /**
   * Update the last selected company
   * @param {string} companyId
   */
  updateLastCompany(companyId) {
    if (this._session) {
      this._session.lastCompanyId = companyId;
      this._session.updatedAt = new Date().toISOString();
      this._saveToDisk();
    }
  }

  /**
   * Get current session
   * @returns {{accountId: string, lastCompanyId: string|null, updatedAt: string} | null}
   */
  getSession() {
    return this._session;
  }

  /**
   * Clear session (logout)
   */
  clearSession() {
    this._session = null;
    this._saveToDisk();
    logger.info('会话已清除');
  }

  /**
   * Check if there's a valid session
   * @returns {boolean}
   */
  hasSession() {
    return !!(this._session && this._session.accountId);
  }
}

const sessionManager = new SessionManager();

module.exports = { SessionManager, sessionManager };
