/**
 * SoloForge - 设置页面
 * 用户配置安全权限
 * Linear 风格：半透明面板、细边框、靛紫 accent 仅用于 CTA、无 emoji 装饰
 */
import { useState, useEffect, useCallback, Component } from 'react';
import { useAuthStore } from '../store/auth-store';
import { useAgentStore } from '../store/agent-store';
import AgentAvatar, { isImageAvatar } from '../components/AgentAvatar';
import SyncPanel from '../components/sync/SyncPanel';
import DeviceManager from '../components/settings/DeviceManager';

/** ErrorBoundary：子组件崩溃时显示错误而非白屏 */
class SectionBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[Settings Boundary]', this.props.label, error?.message, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="py-4 text-sm text-danger">
          {this.props.label} 加载失败：{this.state.error?.message || '未知错误'}
          <button
            className="ml-2 text-accent underline"
            onClick={() => this.setState({ hasError: false, error: null })}
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
 * 权限开关组件
 * Linear 风格：ghost toggle（开启=accent，关闭=muted），无蓝色
 * Emil: toggle thumb 用 transform: translateX（GPU），自定义缓动曲线
 */
function PermissionSwitch({ label, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 pr-4">
        <div className="text-sm font-medium text-text-primary">{label}</div>
        {description && (
          <div className="text-sm text-text-tertiary mt-0.5">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`
          relative inline-flex h-[31px] w-[51px] flex-shrink-0 cursor-pointer rounded-full
          border border-transparent
          focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg-base
          ${checked ? 'bg-accent' : 'bg-border-strong'}
          ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        `}
        style={{
          transition: 'background-color 200ms cubic-bezier(0.23,1,0.32,1)',
        }}
      >
        <span
          aria-hidden
          className={`
            pointer-events-none absolute top-[2px] left-[2px] inline-block h-[27px] w-[27px] rounded-full bg-white
          `}
          style={{
            // Emil: transform translateX 走 GPU；220ms ease-out；位移=track-thumb=20px
            transform: checked ? 'translateX(20px)' : 'translateX(0)',
            transition: 'transform 220ms cubic-bezier(0.23,1,0.32,1)',
            willChange: 'transform',
          }}
        />
      </button>
    </div>
  );
}

/**
 * 路径列表组件
 * 紧凑列表，删除按钮 ghost 风格
 */
function PathList({ paths, onAdd, onRemove, disabled }) {
  const [newPath, setNewPath] = useState('');

  const handleAdd = () => {
    if (newPath.trim() && !paths.includes(newPath.trim())) {
      onAdd(newPath.trim());
      setNewPath('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleSelectFolder = async () => {
    try {
      const result = await window.electronAPI.selectFolder({
        title: '选择允许访问的文件夹',
      });
      if (!result.canceled && result.path) {
        if (!paths.includes(result.path)) {
          onAdd(result.path);
        }
      }
    } catch (error) {
      console.error('选择文件夹失败:', error);
    }
  };

  return (
    <div className="space-y-3">
      {/* 选择文件夹按钮（ghost 风格，虚线边框） */}
      <button
        onClick={handleSelectFolder}
        disabled={disabled}
        className="btn-ghost w-full justify-center px-4 py-2.5
                   border-dashed border-border-default text-text-secondary
                   hover:text-text-primary hover:border-border-strong"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <span>选择文件夹</span>
      </button>

      {/* 手动输入路径 */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="或手动输入路径，如 ~/projects"
          disabled={disabled}
          className="input"
        />
        <button
          onClick={handleAdd}
          disabled={disabled || !newPath.trim()}
          className="btn-ghost"
        >
          添加
        </button>
      </div>

      {/* 已添加的路径列表（紧凑） */}
      {paths.length > 0 ? (
        <ul className="space-y-1">
          {paths.map((p, i) => (
            <li
              key={i}
              className="flex items-center justify-between px-3 py-1.5 rounded-md
                         bg-bg-hover/50 group"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <svg
                  className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <code className="text-sm text-text-primary truncate font-mono">{p}</code>
              </div>
              <button
                onClick={() => onRemove(p)}
                disabled={disabled}
                className="btn-ghost px-2 py-0.5 text-xs
                           opacity-0 group-hover:opacity-100 transition-opacity-fast
                           text-text-tertiary hover:text-danger"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-tertiary italic text-center py-2">
          暂无允许的路径，Agent 将无法访问任何文件
        </p>
      )}
    </div>
  );
}

/**
 * 设置分组组件
 * Linear 风格：.panel 容器（半透明背景 + 细边框），标题 weight 590
 * Emil: 面板从 scale(0.95)+opacity:0 入场，280ms ease-out
 */
function SettingsSection({ title, children }) {
  return (
    <section
      className="panel p-6"
      style={{ animation: 'settingsSectionEnter 280ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      <h2 className="text-sm font-title tracking-tight text-text-primary mb-4">{title}</h2>
      <div className="divide-y divide-border-default">{children}</div>
      <style>{`
        @keyframes settingsSectionEnter {
          from { opacity: 0; transform: scale(0.97); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </section>
  );
}

/**
 * 设置页面
 */
export default function Settings({ onBack, onOpenAgentSettings, onOpenDashboard }) {
  const [permissions, setPermissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const currentAccount = useAuthStore((s) => s.currentAccount);
  const currentCompany = useAuthStore((s) => s.currentCompany);
  const switchCompany = useAuthStore((s) => s.switchCompany);
  const logout = useAuthStore((s) => s.logout);
  const bossConfig = useAgentStore((s) => s.bossConfig);
  const [bossName, setBossName] = useState(bossConfig.name || '老板');
  const [bossNameEditing, setBossNameEditing] = useState(false);

  // boss 名字与 store 同步
  useEffect(() => {
    setBossName(bossConfig.name || '老板');
  }, [bossConfig.name]);

  // 加载权限配置
  useEffect(() => {
    const loadPermissions = async () => {
      try {
        const result = await window.electronAPI.getPermissions();
        setPermissions(result);
      } catch (error) {
        console.error('加载权限配置失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadPermissions();
  }, []);

  // 保存权限配置
  const savePermissions = useCallback(async (newPermissions) => {
    setSaving(true);
    try {
      await window.electronAPI.updatePermissions(newPermissions);
      setPermissions(newPermissions);
    } catch (error) {
      console.error('保存权限配置失败:', error);
    } finally {
      setSaving(false);
    }
  }, []);

  // 更新文件权限
  const updateFiles = useCallback(
    (updates) => {
      const newPermissions = {
        ...permissions,
        files: { ...permissions.files, ...updates },
      };
      savePermissions(newPermissions);
    },
    [permissions, savePermissions]
  );

  // 更新 Shell 权限
  const updateShell = useCallback(
    (updates) => {
      const newPermissions = {
        ...permissions,
        shell: { ...permissions.shell, ...updates },
      };
      savePermissions(newPermissions);
    },
    [permissions, savePermissions]
  );

  // 更新网络权限
  const updateNetwork = useCallback(
    (updates) => {
      const newPermissions = {
        ...permissions,
        network: { ...permissions.network, ...updates },
      };
      savePermissions(newPermissions);
    },
    [permissions, savePermissions]
  );

  // 更新 Git 权限
  const updateGit = useCallback(
    (updates) => {
      const newPermissions = {
        ...permissions,
        git: { ...permissions.git, ...updates },
      };
      savePermissions(newPermissions);
    },
    [permissions, savePermissions]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-bg-base">
        <div
          className="text-text-secondary text-sm"
          style={{ animation: 'settingsLoaderEnter 280ms cubic-bezier(0.23,1,0.32,1) both' }}
        >
          加载中...
        </div>
        <style>{`
          @keyframes settingsLoaderEnter {
            from { opacity: 0; transform: scale(0.95); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    );
  }

  if (!permissions) {
    return (
      <div className="flex items-center justify-center h-full bg-bg-base">
        <div className="text-danger text-sm">加载权限配置失败</div>
      </div>
    );
  }

  return (
    <div className="h-full bg-bg-base overflow-auto">
      {/* macOS 标题栏占位 */}
      <div className="shrink-0 h-8 drag-region" />
      <div className="max-w-3xl mx-auto py-8 px-4">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-title tracking-tighter text-text-primary">设置</h1>
            <p className="text-text-secondary text-sm mt-1">
              配置 Agent 可使用的权限和安全边界
            </p>
          </div>
          {onBack && (
            <button onClick={onBack} className="btn-ghost">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
              </svg>
              返回
            </button>
          )}
        </div>

        {saving && (
          <div className="fixed top-4 right-4 px-3 py-1.5 rounded-md bg-accent text-white text-sm shadow-elevated">
            保存中...
          </div>
        )}

        <div className="space-y-4">
          {/* 快捷入口 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 运营仪表板入口 */}
            {onOpenDashboard && (
              <button
                onClick={onOpenDashboard}
                className="card card-hover text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-accent-subtle flex items-center justify-center">
                    <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium text-text-primary">运营仪表板</h2>
                    <p className="text-sm text-text-tertiary truncate">查看目标、KPI、任务和审批</p>
                  </div>
                </div>
              </button>
            )}

            {/* 人员管理入口 */}
            {onOpenAgentSettings && (
              <button
                onClick={onOpenAgentSettings}
                className="card card-hover text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-accent-subtle flex items-center justify-center">
                    <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-2.996-3h-1.002M9 20H4v-2a3 3 0 013-3h2m0 0a3 3 0 100-6 3 3 0 000 6zm9-6a3 3 0 100-6 3 3 0 000 6z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium text-text-primary">人员管理</h2>
                    <p className="text-sm text-text-tertiary truncate">配置 Agent 的名字、职级和部门</p>
                  </div>
                </div>
              </button>
            )}
          </div>

          {/* 老板个人信息 */}
          <SettingsSection title="个人信息（老板）">
            <div className="py-4">
              <div className="flex items-center gap-5">
                {/* 头像 */}
                <div className="flex flex-col items-center gap-2">
                  <AgentAvatar
                    avatar={bossConfig.avatar}
                    fallback="★"
                    size="2xl"
                    bgClass="border border-dashed border-border-default"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={async () => {
                        const result = await window.electronAPI.uploadAgentAvatar('boss');
                        if (result?.success && result.avatarPath) {
                          await window.electronAPI.updateBossConfig({ avatar: result.avatarPath });
                        }
                      }}
                      className="btn-ghost px-2 py-0.5 text-xs"
                    >
                      上传图片
                    </button>
                    {isImageAvatar(bossConfig.avatar) && (
                      <button
                        onClick={async () => {
                          await window.electronAPI.updateBossConfig({ avatar: '★' });
                        }}
                        className="btn-ghost px-2 py-0.5 text-xs text-text-tertiary hover:text-danger"
                      >
                        移除
                      </button>
                    )}
                  </div>
                  {!isImageAvatar(bossConfig.avatar) && (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={bossConfig.avatar || ''}
                        onChange={async (e) => {
                          await window.electronAPI.updateBossConfig({ avatar: e.target.value });
                        }}
                        placeholder="★"
                        className="input w-12 text-center text-base"
                        title="输入 Emoji 或符号作为头像"
                      />
                    </div>
                  )}
                </div>

                {/* 名字 */}
                <div className="flex-1">
                  <label className="block text-sm text-text-secondary mb-1">称呼</label>
                  {bossNameEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={bossName}
                        onChange={(e) => setBossName(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            await window.electronAPI.updateBossConfig({ name: bossName.trim() || '老板' });
                            setBossNameEditing(false);
                          }
                          if (e.key === 'Escape') {
                            setBossName(bossConfig.name || '老板');
                            setBossNameEditing(false);
                          }
                        }}
                        autoFocus
                        className="input text-base font-medium"
                      />
                      <button
                        onClick={async () => {
                          await window.electronAPI.updateBossConfig({ name: bossName.trim() || '老板' });
                          setBossNameEditing(false);
                        }}
                        className="btn-primary"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => {
                          setBossName(bossConfig.name || '老板');
                          setBossNameEditing(false);
                        }}
                        className="btn-ghost"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-2 cursor-pointer group"
                      onClick={() => setBossNameEditing(true)}
                    >
                      <span className="text-base font-medium text-text-primary">
                        {bossConfig.name || '老板'}
                      </span>
                      <svg
                        className="w-4 h-4 text-text-tertiary group-hover:text-accent transition-colors-fast"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                      </svg>
                    </div>
                  )}
                  <p className="text-sm text-text-tertiary mt-1.5">
                    你的头像和称呼会显示在聊天和组织架构中
                  </p>
                </div>
              </div>
            </div>
          </SettingsSection>

          {/* 账号与公司 */}
          <SettingsSection title="账号与公司">
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary">当前账号</div>
                  <div className="text-sm text-text-tertiary truncate">{currentAccount?.username || '未知'}</div>
                </div>
                <button
                  onClick={logout}
                  className="btn-ghost text-text-tertiary hover:text-danger hover:border-danger/40"
                >
                  退出登录
                </button>
              </div>
            </div>
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary">当前公司</div>
                  <div className="text-sm text-text-tertiary truncate">{currentCompany?.name || '未选择'}</div>
                </div>
                <button onClick={switchCompany} className="btn-ghost">
                  切换公司
                </button>
              </div>
            </div>
          </SettingsSection>

          {/* 云同步 */}
          <SettingsSection title="云同步">
            <SectionBoundary label="云同步">
              <div className="py-4">
                <div className="card">
                  <SyncPanel />
                </div>
              </div>
            </SectionBoundary>
          </SettingsSection>

          {/* 设备管理 */}
          <SettingsSection title="设备管理">
            <SectionBoundary label="设备管理">
              <div className="py-4">
                <div className="card">
                  <DeviceManager />
                </div>
              </div>
            </SectionBoundary>
          </SettingsSection>

          {/* 文件权限 — null guard 防止 permissions?.files 未加载时崩溃 */}
          {permissions?.files && (
            <>
              <SettingsSection title="文件访问">
                <div className="py-4">
                  <div className="text-sm font-medium text-text-primary mb-2">
                    允许访问的目录
                  </div>
                  <p className="text-sm text-text-tertiary mb-4">
                    Agent 只能读取和操作这些目录下的文件
                  </p>
                  <PathList
                    paths={permissions.files.allowedPaths}
                    onAdd={(path) =>
                      updateFiles({
                        allowedPaths: [...permissions.files.allowedPaths, path],
                      })
                    }
                    onRemove={(path) =>
                      updateFiles({
                        allowedPaths: permissions.files.allowedPaths.filter((p) => p !== path),
                      })
                    }
                    disabled={saving}
                  />
                </div>
                <PermissionSwitch
                  label="允许写入文件"
                  description="允许 Agent 创建、修改和删除文件"
                  checked={permissions.files.writeEnabled}
                  onChange={(checked) => updateFiles({ writeEnabled: checked })}
                  disabled={saving}
                />
                <PermissionSwitch
                  label="写入需要确认"
                  description="每次写入操作前询问用户确认"
                  checked={permissions.files.writeConfirm}
                  onChange={(checked) => updateFiles({ writeConfirm: checked })}
                  disabled={saving || !permissions.files.writeEnabled}
                />
              </SettingsSection>

              {/* Shell 权限 */}
              <SettingsSection title="终端命令">
                <PermissionSwitch
                  label="允许执行终端命令"
                  description="允许 Agent 执行 Shell 命令（无超时限制）"
                  checked={permissions.shell.enabled}
                  onChange={(checked) => updateShell({ enabled: checked })}
                  disabled={saving}
                />
                <PermissionSwitch
                  label="每次执行需要确认"
                  description="执行命令前询问用户确认"
                  checked={permissions.shell.confirmEach}
                  onChange={(checked) => updateShell({ confirmEach: checked })}
                  disabled={saving || !permissions.shell.enabled}
                />
                <div className="py-3">
                  <div className="text-sm text-text-tertiary">
                    危险命令已被自动禁止（如 rm -rf /、格式化磁盘等）
                  </div>
                </div>
              </SettingsSection>

              {/* 网络权限 */}
              <SettingsSection title="网络访问">
                <PermissionSwitch
                  label="允许网络搜索"
                  description="允许 Agent 搜索互联网获取信息"
                  checked={permissions.network.searchEnabled}
                  onChange={(checked) => updateNetwork({ searchEnabled: checked })}
                  disabled={saving}
                />
              </SettingsSection>

              {/* Git 协作 */}
              <SettingsSection title="Git 协作">
                <PermissionSwitch
                  label="启用 Git 协作"
                  description="允许 Agent 使用 Git 进行版本控制和协作"
                  checked={permissions.git.enabled}
                  onChange={(checked) => updateGit({ enabled: checked })}
                  disabled={saving}
                />
                <PermissionSwitch
                  label="允许自动提交"
                  description="Agent 可以自动创建 Git 提交，无需确认"
                  checked={permissions.git.autoCommit}
                  onChange={(checked) => updateGit({ autoCommit: checked })}
                  disabled={saving || !permissions.git.enabled}
                />
              </SettingsSection>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
