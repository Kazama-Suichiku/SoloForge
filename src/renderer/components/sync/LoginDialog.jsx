/**
 * SoloForge - 同步登录/注册弹窗
 * Linear 风格：.surface + .glass-enter + .input + .btn-primary
 * 与 LoginPage.jsx / ConfirmDialog.jsx 模式一致，全部走设计 token。
 * @module components/sync/LoginDialog
 */
import { useState, useEffect, useCallback } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

export default function LoginDialog({ isOpen, onClose, onSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ESC 关闭（与 ConfirmDialog 一致）
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose?.();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 登录/注册走 account 模块（account-ipc-handlers.js → account-store → Worker /auth/*）
      // account handler 在登录成功后会自动调用 cloudSync.configure + startAutoSync，
      // 因此这里不需要再单独触发云同步初始化。
      // account API 使用 { username, password }，旧表单字段叫 email，这里做映射。
      const payload = { username: email, password };
      const result =
        mode === 'login'
          ? await window.electronAPI.account.login(payload)
          : await window.electronAPI.account.register(payload);

      if (result.success) {
        onSuccess({ id: result.accountId, username: email, isCloud: result.isCloud });
        onClose();
      } else {
        setError(result.error || '操作失败');
      }
    } catch (err) {
      setError(err.message || '网络错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩：与 CompanySelectPage / ConfirmDialog 一致 —— bg-black/50 + backdrop-blur-sm，点击关闭 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 弹窗：.surface 玻璃材质 + .glass-enter materialize 入场 + .modal-center center origin
          + shadow-dialog 多层阴影 + animate-scale-in 快速入场 */}
      <div
        className="relative surface glass-enter modal-center rounded-xl shadow-dialog w-full max-w-md mx-4 p-6 animate-scale-in"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'login' ? '登录' : '注册'}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-ui text-text-primary">
            {mode === 'login' ? '登录' : '注册'}
          </h2>
          <button
            onClick={onClose}
            className="emil-pressable p-1 rounded-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors-fast"
            aria-label="关闭"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-ui text-text-tertiary mb-1.5">
              邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
              placeholder="your@email.com"
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
              minLength={6}
              className="input"
              placeholder="至少 6 位"
            />
          </div>

          {error && (
            <p className="text-sm text-danger">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-2.5"
          >
            {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-sm text-accent hover:text-accent-hover transition-colors"
          >
            {mode === 'login' ? '没有账号？点击注册' : '已有账号？点击登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
