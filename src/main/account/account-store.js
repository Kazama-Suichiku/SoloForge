/**
 * SoloForge - 账号存储
 * 支持云端账号和本地账号双模式
 * 云端账号：通过 Cloudflare Workers API 认证，可在多设备间同步
 * 本地账号：仅存储在本地，用于离线模式
 * @module account/account-store
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../utils/logger');
const { SOLOFORGE_ROOT } = require('./data-path');

const ACCOUNTS_FILE = path.join(SOLOFORGE_ROOT, 'accounts.json');
const CLOUD_AUTH_URL = 'https://soloforge-sync.fengzhongcuizhu.workers.dev';

class AccountStore {
  constructor() {
    this.accounts = this._loadFromDisk();
    this.cloudAuthUrl = CLOUD_AUTH_URL;
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
   * Hash password using scrypt (for local accounts)
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
   * 云端注册
   */
  async registerCloud(username, password, displayName) {
    try {
      const response = await fetch(`${this.cloudAuthUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        return { success: false, error: result.error || '云端注册失败' };
      }

      // P0-12：从响应中提取 token（Worker 仅在登录时签发，注册响应可能不含 token）
      const token = result.token || null;
      const tokenExpiresAt = result.tokenExpiresAt || null;

      // 保存云端账号到本地缓存
      const cloudAccount = {
        id: result.userId,
        username: result.username,
        displayName: result.displayName,
        isCloud: true,
        createdAt: new Date().toISOString(),
        token,
        tokenExpiresAt,
      };

      // 更新或添加到本地缓存
      const existingIdx = this.accounts.findIndex(a => a.id === result.userId);
      if (existingIdx !== -1) {
        this.accounts[existingIdx] = { ...this.accounts[existingIdx], ...cloudAccount };
      } else {
        this.accounts.push(cloudAccount);
      }
      this._saveToDisk();

      // P0-12：Worker 注册接口不签发 token，自动登录获取（仅在无 token 时）
      if (!token) {
        logger.info('注册响应未含 token，自动登录获取', { userId: result.userId });
        const autoLogin = await this.loginCloud(username, password);
        if (autoLogin.success) {
          // loginCloud 已保存 token；返回注册成功结果
          return {
            success: true,
            accountId: result.userId,
            username: result.username,
            displayName: result.displayName,
            isCloud: true,
          };
        }
        logger.warn('注册成功但自动登录失败，需手动登录以启用云同步', {
          userId: result.userId, error: autoLogin.error,
        });
      }

      logger.info('云端账号注册成功', { userId: result.userId, username: result.username, hasToken: !!token });
      return {
        success: true,
        accountId: result.userId,
        username: result.username,
        displayName: result.displayName,
        isCloud: true,
      };
    } catch (error) {
      logger.error('云端注册失败:', error);
      return { success: false, error: '网络错误，请检查网络连接' };
    }
  }

  /**
   * 云端登录
   */
  async loginCloud(username, password) {
    try {
      const response = await fetch(`${this.cloudAuthUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        return { success: false, error: result.error || '云端登录失败' };
      }

      // 保存云端账号到本地缓存
      const cloudAccount = {
        id: result.userId,
        username: result.username,
        displayName: result.displayName,
        isCloud: true,
        lastLoginAt: new Date().toISOString(),
        // P0-12：保存 token 与过期时间，用于后续同步请求鉴权
        token: result.token || null,
        tokenExpiresAt: result.tokenExpiresAt || null,
      };

      const existingIdx = this.accounts.findIndex(a => a.id === result.userId);
      if (existingIdx !== -1) {
        this.accounts[existingIdx] = { ...this.accounts[existingIdx], ...cloudAccount };
      } else {
        this.accounts.push(cloudAccount);
      }
      this._saveToDisk();

      logger.info('云端账号登录成功', { userId: result.userId, username: result.username, hasToken: !!result.token });
      return {
        success: true,
        accountId: result.userId,
        username: result.username,
        displayName: result.displayName,
        isCloud: true,
        // P0-12：向调用方暴露 token 状态（便于登录后配置同步）
        token: result.token || null,
        tokenExpiresAt: result.tokenExpiresAt || null,
      };
    } catch (error) {
      logger.error('云端登录失败:', error);
      return { success: false, error: '网络错误，请检查网络连接或使用本地账号' };
    }
  }

  /**
   * 注册 - 优先使用云端，失败则使用本地
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

    // 尝试云端注册
    const cloudResult = await this.registerCloud(username, password, username);
    if (cloudResult.success) {
      return cloudResult;
    }

    // 云端失败，使用本地注册
    logger.warn('云端注册失败，使用本地注册', { error: cloudResult.error });
    return this.registerLocal(username, password);
  }

  /**
   * 本地注册
   */
  async registerLocal(username, password) {
    const existing = this.accounts.find(a => a.username === username && !a.isCloud);
    if (existing) {
      return { success: false, error: '用户名已存在' };
    }

    const accountId = `local-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const { hash, salt } = await this._hashPassword(password);

    const account = {
      id: accountId,
      username,
      passwordHash: hash,
      passwordSalt: salt,
      isCloud: false,
      createdAt: new Date().toISOString(),
    };

    this.accounts.push(account);
    this._saveToDisk();
    logger.info('本地账号已注册', { accountId, username });
    return { success: true, accountId, isCloud: false };
  }

  /**
   * 登录 - 优先使用云端，失败则尝试本地
   */
  async login(username, password) {
    // 先尝试云端登录
    const cloudResult = await this.loginCloud(username, password);
    if (cloudResult.success) {
      return cloudResult;
    }

    // 云端失败，尝试本地登录
    logger.warn('云端登录失败，尝试本地登录', { error: cloudResult.error });
    return this.loginLocal(username, password);
  }

  /**
   * 本地登录
   */
  async loginLocal(username, password) {
    const account = this.accounts.find(a => a.username === username && !a.isCloud);
    if (!account) {
      return { success: false, error: '用户名或密码错误' };
    }

    if (!account.passwordHash || !account.passwordSalt) {
      return { success: false, error: '此账号需要云端登录' };
    }

    const { hash } = await this._hashPassword(password, account.passwordSalt);
    if (hash !== account.passwordHash) {
      return { success: false, error: '用户名或密码错误' };
    }

    logger.info('本地账号登录成功', { accountId: account.id, username });
    return { success: true, accountId: account.id, isCloud: false };
  }

  /**
   * Get all accounts (without password info)
   */
  getAccounts() {
    return this.accounts.map(a => ({
      id: a.id,
      username: a.username,
      displayName: a.displayName,
      isCloud: a.isCloud,
      createdAt: a.createdAt,
      // P0-12：暴露 token 状态供 UI 判断是否需要重新登录
      needsReauth: this.needsReauth(a.id),
    }));
  }

  /**
   * P0-12：获取指定账号的 token（用于同步请求鉴权）
   * 过期返回 null。本地账号、无 token 的旧云端账号也返回 null。
   */
  getToken(accountId) {
    const account = this.accounts.find(a => a.id === accountId);
    if (!account || !account.isCloud) return null;
    if (!account.token) return null;
    if (this.isTokenExpired(accountId)) return null;
    return account.token;
  }

  /**
   * P0-12：判断指定账号的 token 是否过期
   * 无 token 或无 tokenExpiresAt 视为"已过期/不可用"，返回 true。
   */
  isTokenExpired(accountId) {
    const account = this.accounts.find(a => a.id === accountId);
    if (!account || !account.isCloud) return true;
    if (!account.token || !account.tokenExpiresAt) return true;
    // tokenExpiresAt 为毫秒时间戳；留 60s 安全余量，避免边界过期
    const now = Date.now();
    return now >= (account.tokenExpiresAt - 60 * 1000);
  }

  /**
   * P0-12：清除指定账号的 token（登出或 401 时调用）
   * 保留账号本身，仅移除 token 字段，便于引导重新登录。
   */
  clearToken(accountId) {
    const idx = this.accounts.findIndex(a => a.id === accountId);
    if (idx === -1) return;
    const account = this.accounts[idx];
    delete account.token;
    delete account.tokenExpiresAt;
    // 标记需要重新登录（供 UI/同步模块判断）
    account.needsReauth = true;
    this._saveToDisk();
    logger.info('账号 token 已清除', { accountId });
  }

  /**
   * P0-12：判断指定账号是否需要重新登录（token 缺失或过期）
   */
  needsReauth(accountId) {
    const account = this.accounts.find(a => a.id === accountId);
    if (!account || !account.isCloud) return false;
    if (account.needsReauth) return true;
    return this.isTokenExpired(accountId);
  }

  /**
   * Get account by ID (without password info)
   */
  getAccount(accountId) {
    const account = this.accounts.find(a => a.id === accountId);
    if (!account) return null;
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      isCloud: account.isCloud,
      createdAt: account.createdAt,
      // P0-12：暴露 token 状态供 UI 判断
      needsReauth: this.needsReauth(accountId),
    };
  }

  /**
   * Delete account
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
