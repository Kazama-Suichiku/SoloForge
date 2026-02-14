/**
 * SoloForge - React 根组件
 * 聊天式多 Agent 协作界面
 *
 * 页面切换使用 CSS display:none 保留状态，避免重新挂载丢失滚动位置/表单数据。
 */
import { Component, useEffect, useState, useCallback } from 'react';
import { ChatView } from './components/chat';
import Settings from './pages/Settings';
import AgentSettings from './pages/AgentSettings';
import Dashboard from './pages/Dashboard';
import LoginPage from './pages/LoginPage';
import CompanySelectPage from './pages/CompanySelectPage';
import { useAuthStore } from './store/auth-store';
import { useChatAgent } from './hooks/useChatAgent';
import { useChatStore } from './store/chat-store';
import { useAgentStore } from './store/agent-store';

/**
 * 错误边界：捕获子组件渲染崩溃，防止全屏黑屏
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] 页面渲染崩溃:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-bg-base text-text-primary p-8">
          <div className="text-4xl mb-4">:(</div>
          <h2 className="text-lg font-semibold mb-2">页面渲染出错了</h2>
          <p className="text-sm text-text-secondary mb-4 max-w-md text-center">
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * 页面容器：通过 CSS 显示/隐藏，保留组件状态
 */
function PageSlot({ active, children }) {
  return (
    <div
      className={`absolute inset-0 transition-opacity duration-200 ${
        active ? 'opacity-100 z-10 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'
      }`}
      style={active ? undefined : { visibility: 'hidden' }}
    >
      {children}
    </div>
  );
}

export default function App() {
  const { sendToAgent, silenceGroup } = useChatAgent();
  const hasHydrated = useChatStore((s) => s._hasHydrated);
  const initFromBackend = useAgentStore((s) => s.initFromBackend);
  const appState = useAuthStore((s) => s.appState);
  const checkSession = useAuthStore((s) => s.checkSession);
  const [currentPage, setCurrentPage] = useState('chat');
  // 延迟挂载：仅在第一次访问某页面时才渲染它
  const [mountedPages, setMountedPages] = useState(new Set(['chat']));

  const navigateTo = useCallback((page) => {
    setMountedPages((prev) => {
      if (prev.has(page)) return prev;
      const next = new Set(prev);
      next.add(page);
      return next;
    });
    setCurrentPage(page);
  }, []);

  // 启动时检查登录会话
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // 进入主界面后，从后端同步 Agent 配置
  useEffect(() => {
    if (appState === 'main') {
      initFromBackend();
    }
  }, [appState, initFromBackend]);

  // 一次性清理旧的 localStorage 聊天数据（已迁移到文件存储）
  useEffect(() => {
    try {
      if (localStorage.getItem('soloforge-chat-history')) {
        localStorage.removeItem('soloforge-chat-history');
        console.log('已清理旧的 localStorage 聊天数据');
      }
    } catch { /* ignore */ }
  }, []);

  // ─── 渲染内容 ─────────────────────────────────────────────
  let content;

  if (appState === 'loading') {
    content = (
      <div className="flex items-center justify-center h-screen bg-bg-base text-text-secondary">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="w-10 h-10 border-3 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">正在检查登录状态...</p>
        </div>
      </div>
    );
  } else if (appState === 'login') {
    content = <LoginPage />;
  } else if (appState === 'company-select') {
    content = <CompanySelectPage />;
  } else if (!hasHydrated) {
    content = (
      <div className="flex items-center justify-center h-screen bg-bg-base text-text-secondary">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="w-10 h-10 border-3 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">加载中...</p>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="relative w-screen h-screen overflow-hidden">
        <PageSlot active={currentPage === 'chat'}>
          <ChatView
            onSendMessage={sendToAgent}
            onSilenceGroup={silenceGroup}
            onOpenSettings={() => navigateTo('settings')}
            onOpenDashboard={() => navigateTo('dashboard')}
          />
        </PageSlot>

        {mountedPages.has('settings') && (
          <PageSlot active={currentPage === 'settings'}>
            <Settings
              onBack={() => setCurrentPage('chat')}
              onOpenAgentSettings={() => navigateTo('agent-settings')}
              onOpenDashboard={() => navigateTo('dashboard')}
            />
          </PageSlot>
        )}

        {mountedPages.has('agent-settings') && (
          <PageSlot active={currentPage === 'agent-settings'}>
            <AgentSettings onBack={() => setCurrentPage('settings')} />
          </PageSlot>
        )}

        {mountedPages.has('dashboard') && (
          <PageSlot active={currentPage === 'dashboard'}>
            <ErrorBoundary>
              <Dashboard onBack={() => setCurrentPage('chat')} />
            </ErrorBoundary>
          </PageSlot>
        )}
      </div>
    );
  }

  return (
    <>
      {/* 全局窗口拖拽区域 — 固定在窗口最顶部，所有页面通用 */}
      <div className="fixed top-0 left-0 right-0 h-8 z-[9999] drag-region" />
      {content}
    </>
  );
}
