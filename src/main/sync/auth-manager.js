/**
 * 用户认证管理器
 */

const { supabaseClient } = require('./supabase-client');
const { logger } = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const os = require('os');

// electron-store 是 ESM-only，改用简单的 JSON 文件存储
const AUTH_DIR = path.join(os.homedir(), '.soloforge');
const AUTH_FILE = path.join(AUTH_DIR, 'auth-store.json');

const authStore = {
  _data: {},
  _load() {
    try {
      if (fs.existsSync(AUTH_FILE)) {
        this._data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
      }
    } catch (e) {
      this._data = {};
    }
  },
  _save() {
    try {
      if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
      fs.writeFileSync(AUTH_FILE, JSON.stringify(this._data, null, 2));
    } catch (e) {
      logger.error('保存 auth store 失败:', e);
    }
  },
  get(key) { this._load(); return this._data[key]; },
  set(key, value) { this._load(); this._data[key] = value; this._save(); },
  delete(key) { this._load(); delete this._data[key]; this._save(); },
};

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.session = null;
  }

  /**
   * 邮箱注册
   */
  async register(email, password) {
    try {
      const client = supabaseClient.getClient();
      const { data, error } = await client.auth.signUp({
        email,
        password
      });

      if (error) throw error;

      logger.info('用户注册成功:', email);
      return { success: true, user: data.user };
    } catch (error) {
      logger.error('注册失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 邮箱登录
   */
  async login(email, password) {
    try {
      const client = supabaseClient.getClient();
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      this.currentUser = data.user;
      this.session = data.session;

      // 持久化会话
      authStore.set('session', data.session);

      logger.info('用户登录成功:', email);
      return { success: true, user: data.user, session: data.session };
    } catch (error) {
      logger.error('登录失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 登出
   */
  async logout() {
    try {
      const client = supabaseClient.getClient();
      const { error } = await client.auth.signOut();

      if (error) throw error;

      this.currentUser = null;
      this.session = null;
      authStore.delete('session');

      logger.info('用户登出成功');
      return { success: true };
    } catch (error) {
      logger.error('登出失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 恢复会话
   */
  async restoreSession() {
    try {
      const savedSession = authStore.get('session');
      if (!savedSession) {
        return { success: false, error: '无保存的会话' };
      }

      const client = supabaseClient.getClient();
      const { data, error } = await client.auth.setSession(savedSession);

      if (error) throw error;

      this.currentUser = data.user;
      this.session = data.session;

      logger.info('会话恢复成功');
      return { success: true, user: data.user };
    } catch (error) {
      logger.error('会话恢复失败:', error);
      authStore.delete('session');
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取当前用户
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * 获取当前会话
   */
  getSession() {
    return this.session;
  }

  /**
   * 检查是否已登录
   */
  isLoggedIn() {
    return !!this.currentUser && !!this.session;
  }
}

const authManager = new AuthManager();

module.exports = { authManager };
