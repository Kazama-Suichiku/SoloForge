/**
 * 认证服务
 * 处理用户登录、注册和会话管理
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_KEY = '@soloforge/auth';
const DEFAULT_SERVER_URL = 'https://soloforge-sync.fengzhongcuizhu.workers.dev';

interface AuthState {
  isLoggedIn: boolean;
  userId: string | null;
  username: string | null;
  displayName: string | null;
  serverUrl: string;
}

interface LoginResult {
  success: boolean;
  error?: string;
  userId?: string;
  username?: string;
  displayName?: string;
}

interface RegisterResult {
  success: boolean;
  error?: string;
  userId?: string;
  username?: string;
  displayName?: string;
}

class AuthService {
  private state: AuthState = {
    isLoggedIn: false,
    userId: null,
    username: null,
    displayName: null,
    serverUrl: DEFAULT_SERVER_URL,
  };

  async initialize(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(AUTH_KEY);
      if (stored) {
        this.state = { ...this.state, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('加载认证状态失败:', error);
    }
  }

  getState(): AuthState {
    return { ...this.state };
  }

  isLoggedIn(): boolean {
    return this.state.isLoggedIn && !!this.state.userId;
  }

  getUserId(): string | null {
    return this.state.userId;
  }

  getDisplayName(): string | null {
    return this.state.displayName;
  }

  setServerUrl(url: string): void {
    this.state.serverUrl = url;
    this.saveState();
  }

  private async saveState(): Promise<void> {
    try {
      await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.error('保存认证状态失败:', error);
    }
  }

  async register(username: string, password: string, displayName?: string): Promise<RegisterResult> {
    try {
      const response = await fetch(`${this.state.serverUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        return { success: false, error: result.error || '注册失败' };
      }

      // 注册成功后自动登录
      this.state = {
        ...this.state,
        isLoggedIn: true,
        userId: result.userId,
        username: result.username,
        displayName: result.displayName,
      };
      await this.saveState();

      return {
        success: true,
        userId: result.userId,
        username: result.username,
        displayName: result.displayName,
      };
    } catch (error) {
      console.error('注册错误:', error);
      return { success: false, error: '网络错误，请检查网络连接' };
    }
  }

  async login(username: string, password: string): Promise<LoginResult> {
    try {
      const response = await fetch(`${this.state.serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        return { success: false, error: result.error || '登录失败' };
      }

      this.state = {
        ...this.state,
        isLoggedIn: true,
        userId: result.userId,
        username: result.username,
        displayName: result.displayName,
      };
      await this.saveState();

      return {
        success: true,
        userId: result.userId,
        username: result.username,
        displayName: result.displayName,
      };
    } catch (error) {
      console.error('登录错误:', error);
      return { success: false, error: '网络错误，请检查网络连接' };
    }
  }

  async logout(): Promise<void> {
    this.state = {
      ...this.state,
      isLoggedIn: false,
      userId: null,
      username: null,
      displayName: null,
    };
    await this.saveState();
  }
}

export const authService = new AuthService();
