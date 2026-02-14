/**
 * SoloForge - 账号存储
 * 纯本地账号系统，使用 crypto.scrypt 做密码哈希
 * @module account/account-store
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../utils/logger');
const { SOLOFORGE_ROOT } = require('./data-path');

const ACCOUNTS_FILE = path.join(SOLOFORGE_ROOT, 'accounts.json');

class AccountStore {
  constructor() {
    this.accounts = this._loadFromDisk();
  }

  _ensureDir() {
    if (!fs.existsSync(SOLOFORGE_ROOT)) {
      fs.mkdirSync(SOLOFORGE_ROOT, { recursive: true });
    }
  }

  _loadFromDisk() {
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        const content = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
        const data = JSON.parse(content);
        logger.info('账号数据已加载', { count: data.length });
        return data;
      }
    } catch (error) {
      logger.error('加载账号数据失败', error);
    }
    return [];
  }

  _saveToDisk() {
    try {
      this._ensureDir();
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(this.accounts, null, 2), 'utf-8');
    } catch (error) {
      logger.error('保存账号数据失败', error);
    }
  }

  /**
   * Hash password using scrypt
   * @param {string} password
   * @param {string} [salt] - If not provided, generates random salt
   * @returns {Promise<{hash: string, salt: string}>}
   */
  async _hashPassword(password, salt) {
    const s = salt || crypto.randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, s, 64, (err, derivedKey) => {
        if (err) reject(err);
        else resolve({ hash: derivedKey.toString('hex'), salt: s });
      });
    });
  }

  /**
   * Register a new account
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{success: boolean, accountId?: string, error?: string}>}
   */
  async register(username, password) {
    if (!username || !password) {
      return { success: false, error: '用户名和密码不能为空' };
    }
    if (username.length < 2) {
      return { success: false, error: '用户名至少 2 个字符' };
    }
    if (password.length < 4) {
      return { success: false, error: '密码至少 4 个字符' };
    }

    // Check if username already exists
    const existing = this.accounts.find(a => a.username === username);
    if (existing) {
      return { success: false, error: '用户名已存在' };
    }

    const accountId = `acc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const { hash, salt } = await this._hashPassword(password);

    const account = {
      id: accountId,
      username,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
    };

    this.accounts.push(account);
    this._saveToDisk();
    logger.info('新账号已注册', { accountId, username });
    return { success: true, accountId };
  }

  /**
   * Login with username and password
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{success: boolean, accountId?: string, error?: string}>}
   */
  async login(username, password) {
    const account = this.accounts.find(a => a.username === username);
    if (!account) {
      return { success: false, error: '用户名或密码错误' };
    }

    const { hash } = await this._hashPassword(password, account.passwordSalt);
    if (hash !== account.passwordHash) {
      return { success: false, error: '用户名或密码错误' };
    }

    logger.info('账号登录成功', { accountId: account.id, username });
    return { success: true, accountId: account.id };
  }

  /**
   * Get all accounts (without password info)
   * @returns {Array<{id: string, username: string, createdAt: string}>}
   */
  getAccounts() {
    return this.accounts.map(a => ({
      id: a.id,
      username: a.username,
      createdAt: a.createdAt,
    }));
  }

  /**
   * Get account by ID (without password info)
   * @param {string} accountId
   * @returns {{id: string, username: string, createdAt: string} | null}
   */
  getAccount(accountId) {
    const account = this.accounts.find(a => a.id === accountId);
    if (!account) return null;
    return {
      id: account.id,
      username: account.username,
      createdAt: account.createdAt,
    };
  }

  /**
   * Delete account
   * @param {string} accountId
   * @returns {{success: boolean, error?: string}}
   */
  deleteAccount(accountId) {
    const idx = this.accounts.findIndex(a => a.id === accountId);
    if (idx === -1) {
      return { success: false, error: '账号不存在' };
    }

    this.accounts.splice(idx, 1);
    this._saveToDisk();
    logger.info('账号已删除', { accountId });
    return { success: true };
  }
}

const accountStore = new AccountStore();

module.exports = { AccountStore, accountStore };
