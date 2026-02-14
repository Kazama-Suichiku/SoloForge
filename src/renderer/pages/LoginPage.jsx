/**
 * SoloForge - 登录/注册页面
 * 全屏居中卡片布局
 */
import { useState, useCallback } from 'react';
import { useAuthStore } from '../store/auth-store';

export default function LoginPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  const login = useAuthStore(s => s.login);
  const register = useAuthStore(s => s.register);
  const storeError = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);

  const error = localError || storeError;

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setLocalError('');
    clearError();

    if (mode === 'register' && password !== confirmPassword) {
      setLocalError('两次密码不一致');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, password);
      }
    } finally {
      setLoading(false);
    }
  }, [mode, username, password, confirmPassword, login, register, clearError]);

  const switchMode = useCallback(() => {
    setMode(m => m === 'login' ? 'register' : 'login');
    setLocalError('');
    clearError();
    setConfirmPassword('');
  }, [clearError]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg-base">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md mx-4">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500/10 rounded-2xl mb-4">
            <span className="text-3xl">🏢</span>
          </div>
          <h1 className="text-2xl font-bold text-text-primary">SoloForge</h1>
          <p className="text-sm text-text-secondary mt-1">AI 多 Agent 企业协作平台</p>
        </div>

        {/* Card */}
        <div className="bg-bg-elevated rounded-2xl shadow-xl border border-border-primary p-8">
          <h2 className="text-xl font-semibold text-text-primary mb-6">
            {mode === 'login' ? '登录' : '注册账号'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={2}
                autoFocus
                className="w-full px-4 py-2.5 bg-bg-base border border-border-primary rounded-xl
                         text-text-primary placeholder-text-muted
                         focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none
                         transition-all duration-200"
                placeholder="请输入用户名"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={4}
                className="w-full px-4 py-2.5 bg-bg-base border border-border-primary rounded-xl
                         text-text-primary placeholder-text-muted
                         focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none
                         transition-all duration-200"
                placeholder="请输入密码"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  确认密码
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={4}
                  className="w-full px-4 py-2.5 bg-bg-base border border-border-primary rounded-xl
                           text-text-primary placeholder-text-muted
                           focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none
                           transition-all duration-200"
                  placeholder="再次输入密码"
                />
              </div>
            )}

            {error && (
              <div className="px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-sm text-red-500">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                       text-white font-medium rounded-xl shadow-lg shadow-blue-500/25
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200 mt-2"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  处理中...
                </span>
              ) : (
                mode === 'login' ? '登录' : '注册'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={switchMode}
              className="text-sm text-blue-500 hover:text-blue-400 transition-colors"
            >
              {mode === 'login' ? '没有账号？点击注册' : '已有账号？点击登录'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
