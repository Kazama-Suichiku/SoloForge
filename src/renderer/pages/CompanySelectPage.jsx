/**
 * SoloForge - 公司选择页面
 * 展示公司列表卡片，支持创建新公司，Linear 风格
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
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="surface rounded-xl shadow-dialog w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{
          // Emil: 弹窗从 scale(0.95)+opacity:0 入场，200ms cubic-bezier(0.23,1,0.32,1)
          animation: 'companyModalEnter 200ms cubic-bezier(0.23,1,0.32,1) both',
        }}
      >
        <style>{`
          @keyframes companyModalEnter {
            from { opacity: 0; transform: scale(0.95); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>
        <div className="px-6 py-4 border-b border-border-default">
          <h3 className="text-base font-ui text-text-primary">创建新公司</h3>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-ui text-text-tertiary mb-1.5">公司名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
              className="input"
              placeholder="例：我的创业公司"
            />
          </div>
          <div>
            <label className="block text-xs font-ui text-text-tertiary mb-1.5">公司描述（可选）</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="input resize-none"
              placeholder="简单描述一下你的公司..."
            />
          </div>
          {error && (
            <p className="text-sm text-danger">{error}</p>
          )}
          <div className="flex gap-3 pt-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
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
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-border-default bg-bg-panel">
        <div className="flex items-center gap-2">
          <span className="font-ui font-title tracking-tightest text-text-primary">SoloForge</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">
            {currentAccount?.username}
          </span>
          <button onClick={logout} className="btn-ghost">
            退出登录
          </button>
        </div>
      </div>

      {/* 主内容 */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-2xl font-title tracking-tighter text-text-primary">选择公司</h1>
            <p className="text-sm text-text-secondary mt-1">选择一个公司进入，或创建新的公司</p>
          </div>
          <button onClick={() => setShowCreateModal(true)} className="btn-ghost">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新建公司
          </button>
        </div>

        {error && (
          <p className="mb-6 text-sm text-danger text-center">{error}</p>
        )}

        {/* 公司网格 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {/* stagger 入场 keyframes（仅本页局部） */}
          <style>{`
            @keyframes companyCardEnter {
              from { opacity: 0; transform: translateY(6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          {companies.map((company, idx) => {
            const isSelecting = selectingId === company.id;
            return (
              <button
                key={company.id}
                onClick={() => handleSelect(company.id)}
                disabled={isSelecting}
                className={`card text-left p-5
                  ${isSelecting ? 'border-accent' : ''}`}
                style={{
                  // Emil: 同时过渡 transform + border-color（避免 transition-transform 覆盖 .card 的 border-color transition）
                  transition: 'transform 160ms cubic-bezier(0.23,1,0.32,1), border-color 160ms cubic-bezier(0.23,1,0.32,1), background-color 160ms cubic-bezier(0.23,1,0.32,1)',
                  // stagger 入场 50ms 延迟
                  animation: `companyCardEnter 300ms cubic-bezier(0.23,1,0.32,1) ${idx * 50}ms both`,
                  // 选中态 accent 边框用过渡而非跳变
                  borderColor: isSelecting ? 'var(--accent)' : undefined,
                }}
                onMouseEnter={(e) => {
                  // Emil: 卡片 hover translateY(-2px) + border-color 过渡（仅 pointer:fine 设备）
                  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    if (!isSelecting) e.currentTarget.style.borderColor = 'var(--border-strong)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = '';
                  if (!isSelecting) e.currentTarget.style.borderColor = '';
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div
                    className="w-9 h-9 rounded-md flex items-center justify-center border border-border-default"
                    style={{ backgroundColor: 'var(--accent-subtle)' }}
                  >
                    <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  {isSelecting && (
                    <svg className="w-4 h-4 text-accent animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                </div>
                <h3 className="font-ui text-text-primary mb-1">{company.name}</h3>
                {company.description && (
                  <p className="text-sm text-text-secondary line-clamp-2">
                    {company.description}
                  </p>
                )}
                <p className="text-xs text-text-tertiary mt-3">
                  创建于 {new Date(company.createdAt).toLocaleDateString('zh-CN')}
                </p>
              </button>
            );
          })}

          {/* 创建新公司卡片（虚线占位） */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-5 border border-dashed border-border-default rounded-lg
                     hover:border-accent hover:bg-bg-hover
                     transition-colors flex flex-col items-center justify-center min-h-[140px]"
          >
            <svg className="w-5 h-5 text-text-tertiary mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm text-text-secondary">创建新公司</span>
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
