/**
 * SoloForge - 登录/注册页面
 * 全屏居中卡片布局，Linear 风格（暗色优先、accent 靛紫、细边框）
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
      <div
        className="relative w-full max-w-md mx-4"
        style={{
          // Emil: 弹窗从 scale(0.95)+opacity:0 入场，300ms cubic-bezier(0.23,1,0.32,1)
          animation: 'loginCardEnter 300ms cubic-bezier(0.23,1,0.32,1) both',
        }}
      >
        {/* 标题区：Inter 32px / weight 590 / 负字距 */}
        <div className="text-center mb-8">
          <h1
            className="text-[32px] font-title tracking-tightest text-text-primary"
            style={{ letterSpacing: '-0.704px' }}
          >
            SoloForge
          </h1>
          <p className="text-sm text-text-secondary mt-2">AI 多 Agent 企业协作平台</p>
        </div>

        {/* 登录卡片：半透明背景 + 细边框 + 12px 圆角 */}
        <div className="surface glass-enter rounded-xl p-8">
          <h2 className="text-base font-ui text-text-primary mb-6">
            {mode === 'login' ? '登录' : '注册账号'}
          </h2>
          {/* 入场动画 keyframes（仅本页局部，不污染全局） */}
          <style>{`
            @keyframes loginCardEnter {
              from { opacity: 0; transform: scale(0.95); }
              to   { opacity: 1; transform: scale(1); }
            }
            .login-input {
              transition: border-color 160ms cubic-bezier(0.23,1,0.32,1),
                          box-shadow 160ms cubic-bezier(0.23,1,0.32,1),
                          transform 160ms cubic-bezier(0.23,1,0.32,1);
            }
            .login-input:focus {
              transform: translateY(-1px);
            }
          `}</style>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-ui text-text-tertiary mb-1.5">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={2}
                autoFocus
                className="input login-input"
                placeholder="请输入用户名"
              />
            </div>

            <div>
              <label className="block text-xs font-ui text-text-tertiary mb-1.5">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={4}
                className="input login-input"
                placeholder="请输入密码"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-xs font-ui text-text-tertiary mb-1.5">
                  确认密码
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={4}
                  className="input login-input"
                  placeholder="再次输入密码"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-danger">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5 mt-2"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg
                    className="w-4 h-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12" cy="12" r="10"
                      stroke="currentColor" strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
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
              className="text-sm text-accent hover:text-accent-hover transition-colors"
            >
              {mode === 'login' ? '没有账号？点击注册' : '已有账号？点击登录'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
