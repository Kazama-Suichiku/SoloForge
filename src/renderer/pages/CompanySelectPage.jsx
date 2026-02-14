/**
 * SoloForge - 公司选择页面
 * 展示公司列表卡片，支持创建新公司
 */
import { useState, useCallback } from 'react';
import { useAuthStore } from '../store/auth-store';

function CreateCompanyModal({ isOpen, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await onCreate(name, description);
      if (result.success) {
        setName('');
        setDescription('');
        onClose();
      } else {
        setError(result.error || '创建失败');
      }
    } catch (err) {
      setError(err.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-bg-elevated rounded-2xl shadow-xl border border-border-primary p-6 w-full max-w-md mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-text-primary mb-4">创建新公司</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">公司名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
              className="w-full px-4 py-2.5 bg-bg-base border border-border-primary rounded-xl
                       text-text-primary placeholder-text-muted
                       focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none
                       transition-all duration-200"
              placeholder="例：我的创业公司"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">公司描述（可选）</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-2.5 bg-bg-base border border-border-primary rounded-xl
                       text-text-primary placeholder-text-muted
                       focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none
                       transition-all duration-200 resize-none"
              placeholder="简单描述一下你的公司..."
            />
          </div>
          {error && (
            <div className="px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-bg-base border border-border-primary text-text-primary
                       rounded-xl hover:bg-bg-muted transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium
                       rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CompanySelectPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectingId, setSelectingId] = useState(null);

  const currentAccount = useAuthStore(s => s.currentAccount);
  const companies = useAuthStore(s => s.companies);
  const selectCompany = useAuthStore(s => s.selectCompany);
  const createCompany = useAuthStore(s => s.createCompany);
  const logout = useAuthStore(s => s.logout);
  const error = useAuthStore(s => s.error);

  const handleSelect = useCallback(async (companyId) => {
    setSelectingId(companyId);
    try {
      await selectCompany(companyId);
    } finally {
      setSelectingId(null);
    }
  }, [selectCompany]);

  return (
    <div className="min-h-screen bg-bg-base">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
        <div className="flex items-center gap-3">
          <span className="text-xl">🏢</span>
          <span className="font-semibold text-text-primary">SoloForge</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-text-secondary">
            {currentAccount?.username}
          </span>
          <button
            onClick={logout}
            className="text-sm text-text-secondary hover:text-red-500 transition-colors"
          >
            退出登录
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-text-primary mb-2">选择公司</h1>
          <p className="text-text-secondary">选择一个公司进入，或创建新的公司</p>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Company grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {companies.map(company => (
            <button
              key={company.id}
              onClick={() => handleSelect(company.id)}
              disabled={selectingId === company.id}
              className="group text-left p-6 bg-bg-elevated border border-border-primary rounded-2xl
                       hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/5
                       transition-all duration-200 disabled:opacity-70"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center
                              group-hover:bg-blue-500/20 transition-colors">
                  <span className="text-lg">🏗️</span>
                </div>
                {selectingId === company.id && (
                  <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                )}
              </div>
              <h3 className="font-semibold text-text-primary mb-1 group-hover:text-blue-500 transition-colors">
                {company.name}
              </h3>
              {company.description && (
                <p className="text-sm text-text-secondary line-clamp-2">
                  {company.description}
                </p>
              )}
              <p className="text-xs text-text-muted mt-3">
                创建于 {new Date(company.createdAt).toLocaleDateString('zh-CN')}
              </p>
            </button>
          ))}

          {/* Create new company button */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-6 border-2 border-dashed border-border-primary rounded-2xl
                     hover:border-blue-500/50 hover:bg-blue-500/5
                     transition-all duration-200 flex flex-col items-center justify-center min-h-[160px]"
          >
            <div className="w-10 h-10 bg-bg-base rounded-xl flex items-center justify-center mb-3">
              <span className="text-2xl text-text-muted">+</span>
            </div>
            <span className="text-sm font-medium text-text-secondary">创建新公司</span>
          </button>
        </div>

        {companies.length === 0 && (
          <div className="text-center py-8">
            <p className="text-text-secondary mb-2">还没有公司，创建你的第一家公司吧</p>
          </div>
        )}
      </div>

      <CreateCompanyModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={createCompany}
      />
    </div>
  );
}
