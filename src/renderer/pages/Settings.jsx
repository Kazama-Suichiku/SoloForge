/**
 * SoloForge - 设置页面
 * 用户配置安全权限
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/auth-store';
import { useAgentStore } from '../store/agent-store';
import AgentAvatar, { isImageAvatar } from '../components/AgentAvatar';

/**
 * 权限开关组件
 */
function PermissionSwitch({ label, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1">
        <div className="font-medium text-text-primary">{label}</div>
        {description && (
          <div className="text-sm text-text-secondary">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`
          relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
          transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2
          ${checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--bg-hover)]'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <span
          className={`
            pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
            transition duration-200 ease-in-out
            ${checked ? 'translate-x-5' : 'translate-x-0'}
          `}
        />
      </button>
    </div>
  );
}

/**
 * 路径列表组件
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
      {/* 选择文件夹按钮 */}
      <button
        onClick={handleSelectFolder}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 
                   border-2 border-dashed border-[var(--border-color)] 
                   rounded-lg text-text-secondary
                   hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]
                   transition-colors duration-200
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <span>选择文件夹</span>
      </button>

      {/* 手动输入路径（可选） */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="或手动输入路径，如 ~/projects"
          disabled={disabled}
          className="flex-1 px-3 py-2 border border-[var(--border-color)] rounded-lg
                     bg-bg-elevated text-text-primary
                     placeholder:text-text-muted
                     focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-sm"
        />
        <button
          onClick={handleAdd}
          disabled={disabled || !newPath.trim()}
          className="px-3 py-2 bg-[var(--bg-hover)] text-text-primary 
                     rounded-lg hover:bg-[var(--bg-hover)]
                     disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          添加
        </button>
      </div>

      {/* 已添加的路径列表 */}
      {paths.length > 0 ? (
        <ul className="space-y-1">
          {paths.map((p, i) => (
            <li
              key={i}
              className="flex items-center justify-between px-3 py-2 bg-bg-muted rounded-lg group"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <code className="text-sm text-text-primary truncate">{p}</code>
              </div>
              <button
                onClick={() => onRemove(p)}
                disabled={disabled}
                className="text-text-muted hover:text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-secondary italic text-center py-2">
          暂无允许的路径，Agent 将无法访问任何文件
        </p>
      )}
    </div>
  );
}

/**
 * 设置分组组件
 */
function SettingsSection({ title, children }) {
  return (
    <div className="bg-bg-elevated rounded-xl shadow-sm border border-[var(--border-color)] p-6">
      <h2 className="text-lg font-semibold text-text-primary mb-4">{title}</h2>
      <div className="divide-y divide-[var(--border-color)]">{children}</div>
    </div>
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
      <div className="flex items-center justify-center h-full">
        <div className="text-text-secondary">加载中...</div>
      </div>
    );
  }

  if (!permissions) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">加载权限配置失败</div>
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
            <h1 className="text-2xl font-bold text-text-primary">设置</h1>
            <p className="text-text-secondary mt-1">
              配置 Agent 可使用的权限和安全边界
            </p>
          </div>
          {onBack && (
            <button
              onClick={onBack}
              className="px-4 py-2 text-text-secondary hover:text-text-primary"
            >
              ← 返回
            </button>
          )}
        </div>

        {saving && (
          <div className="fixed top-4 right-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg shadow-lg">
            保存中...
          </div>
        )}

        <div className="space-y-6">
          {/* 快捷入口 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 运营仪表板入口 */}
            {onOpenDashboard && (
              <button
                onClick={onOpenDashboard}
                className="bg-bg-elevated rounded-xl shadow-sm border border-[var(--border-color)] p-6
                         hover:border-green-300 dark:hover:border-green-700 transition-colors text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <span className="text-2xl">📊</span>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">运营仪表板</h2>
                    <p className="text-sm text-text-secondary">
                      查看目标、KPI、任务和审批
                    </p>
                  </div>
                </div>
              </button>
            )}

            {/* 人员管理入口 */}
            {onOpenAgentSettings && (
              <button
                onClick={onOpenAgentSettings}
                className="bg-bg-elevated rounded-xl shadow-sm border border-[var(--border-color)] p-6
                         hover:border-blue-300 dark:hover:border-blue-700 transition-colors text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <span className="text-2xl">👥</span>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">人员管理</h2>
                    <p className="text-sm text-text-secondary">
                      配置 Agent 的名字、职级和部门
                    </p>
                  </div>
                </div>
              </button>
            )}
          </div>

          {/* 老板个人信息 */}
          <SettingsSection title="👤 个人信息（老板）">
            <div className="py-4">
              <div className="flex items-center gap-5">
                {/* 头像 */}
                <div className="flex flex-col items-center gap-2">
                  <AgentAvatar
                    avatar={bossConfig.avatar}
                    fallback="👑"
                    size="2xl"
                    bgClass="bg-gradient-to-br from-yellow-100 to-orange-100 dark:from-yellow-900/30 dark:to-orange-900/30"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={async () => {
                        const result = await window.electronAPI.uploadAgentAvatar('boss');
                        if (result?.success && result.avatarPath) {
                          await window.electronAPI.updateBossConfig({ avatar: result.avatarPath });
                        }
                      }}
                      className="text-xs px-2.5 py-1 rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 transition-colors"
                    >
                      上传图片
                    </button>
                    {isImageAvatar(bossConfig.avatar) && (
                      <button
                        onClick={async () => {
                          await window.electronAPI.updateBossConfig({ avatar: '👑' });
                        }}
                        className="text-xs px-2.5 py-1 rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
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
                        placeholder="👑"
                        className="w-12 text-center text-xl rounded-lg border border-[var(--border-color)] bg-bg-muted py-1"
                        title="输入 Emoji 作为头像"
                      />
                    </div>
                  )}
                </div>

                {/* 名字 */}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-text-secondary mb-1">称呼</label>
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
                        className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-primary)] bg-bg-elevated text-text-primary text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
                      />
                      <button
                        onClick={async () => {
                          await window.electronAPI.updateBossConfig({ name: bossName.trim() || '老板' });
                          setBossNameEditing(false);
                        }}
                        className="px-3 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-hover)]"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => {
                          setBossName(bossConfig.name || '老板');
                          setBossNameEditing(false);
                        }}
                        className="px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-2 cursor-pointer group"
                      onClick={() => setBossNameEditing(true)}
                    >
                      <span className="text-lg font-semibold text-text-primary">
                        {bossConfig.name || '老板'}
                      </span>
                      <svg className="w-4 h-4 text-text-muted group-hover:text-[var(--color-primary)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </div>
                  )}
                  <p className="text-sm text-text-secondary mt-1.5">
                    你的头像和称呼会显示在聊天和组织架构中
                  </p>
                </div>
              </div>
            </div>
          </SettingsSection>

          {/* 账号与公司 */}
          <SettingsSection title="🏢 账号与公司">
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-text-primary">当前账号</div>
                  <div className="text-sm text-text-secondary">{currentAccount?.username || '未知'}</div>
                </div>
                <button
                  onClick={logout}
                  className="px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  退出登录
                </button>
              </div>
            </div>
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-text-primary">当前公司</div>
                  <div className="text-sm text-text-secondary">{currentCompany?.name || '未选择'}</div>
                </div>
                <button
                  onClick={switchCompany}
                  className="px-3 py-1.5 text-sm text-[var(--color-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                >
                  切换公司
                </button>
              </div>
            </div>
          </SettingsSection>

          {/* 文件权限 */}
          <SettingsSection title="📁 文件访问">
            <div className="py-4">
              <div className="font-medium text-text-primary mb-2">
                允许访问的目录
              </div>
              <p className="text-sm text-text-secondary mb-4">
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
          <SettingsSection title="💻 终端命令">
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
              <div className="text-sm text-text-secondary">
                危险命令已被自动禁止（如 rm -rf /、格式化磁盘等）
              </div>
            </div>
          </SettingsSection>

          {/* 网络权限 */}
          <SettingsSection title="🌐 网络访问">
            <PermissionSwitch
              label="允许网络搜索"
              description="允许 Agent 搜索互联网获取信息"
              checked={permissions.network.searchEnabled}
              onChange={(checked) => updateNetwork({ searchEnabled: checked })}
              disabled={saving}
            />
          </SettingsSection>

          {/* Git 协作 */}
          <SettingsSection title="📦 Git 协作">
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
        </div>
      </div>
    </div>
  );
}
