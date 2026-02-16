/**
 * SoloForge - Agent 人员管理设置页面
 * 配置 Agent 的名字、职级、部门
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import OrgChart from '../components/OrgChart';
import AgentAvatar, { isImageAvatar } from '../components/AgentAvatar';

/**
 * Agent 编辑卡片组件
 */
/**
 * 获取 Agent 所属的所有部门（兼容新旧格式）
 */
function getAgentDepartments(config) {
  if (Array.isArray(config.departments) && config.departments.length > 0) {
    return config.departments;
  }
  if (config.department) {
    return [config.department];
  }
  return [];
}

function AgentCard({ config, levels, departments, models, onSave, onReset, saving, salaryInfo }) {
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: config.name,
    title: config.title,
    level: config.level,
    department: config.department,
    description: config.description || '',
    avatar: config.avatar || '',
    model: config.model || 'claude-sonnet-4-5',
  });

  // 支持多部门显示
  const agentDepts = getAgentDepartments(config);
  const primaryDept = departments.find((d) => d.id === agentDepts[0]) || {};
  const dept = primaryDept; // 兼容后续代码
  const level = levels.find((l) => l.id === config.level) || {};
  const modelInfo = models?.find((m) => m.id === config.model) || null;
  const isMultiDepartment = agentDepts.length > 1;

  const handleSave = async () => {
    await onSave(config.id, formData);
    setEditing(false);
  };

  const handleCancel = () => {
    setFormData({
      name: config.name,
      title: config.title,
      level: config.level,
      department: config.department,
      description: config.description || '',
      avatar: config.avatar || '',
      model: config.model || 'claude-sonnet-4-5',
    });
    setEditing(false);
  };

  const handleReset = async () => {
    const result = await onReset(config.id);
    if (result) {
      setFormData({
        name: result.name,
        title: result.title,
        level: result.level,
        department: result.department,
        description: result.description || '',
        avatar: result.avatar || '',
        model: result.model || 'claude-sonnet-4-5',
      });
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="bg-bg-elevated rounded-xl shadow-sm border border-blue-300 dark:border-blue-700 p-6">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="flex-shrink-0 flex flex-col items-center gap-2">
            <AgentAvatar
              avatar={formData.avatar}
              fallback="😊"
              size="2xl"
              bgClass="bg-bg-muted border-2 border-dashed border-[var(--border-color)]"
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={async () => {
                  const result = await window.electronAPI.uploadAgentAvatar(config.id);
                  if (result?.success && result.avatarPath) {
                    setFormData({ ...formData, avatar: result.avatarPath });
                  }
                }}
                className="text-xs px-2 py-1 rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 transition-colors"
                title="上传图片头像"
              >
                上传图片
              </button>
              {isImageAvatar(formData.avatar) && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, avatar: config.avatar?.includes('/') ? '' : (config.avatar || '') })}
                  className="text-xs px-2 py-1 rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                  title="移除图片，恢复为 Emoji"
                >
                  移除
                </button>
              )}
            </div>
            {!isImageAvatar(formData.avatar) && (
              <input
                type="text"
                value={formData.avatar}
                onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
                placeholder="😊"
                className="w-16 text-center text-xl rounded-lg border border-[var(--border-color)] bg-bg-muted py-1"
                title="输入 Emoji 作为头像"
              />
            )}
          </div>

          {/* Form */}
          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  名字
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                           bg-bg-elevated text-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  职位头衔
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                           bg-bg-elevated text-text-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  部门
                </label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                           bg-bg-elevated text-text-primary"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  职级
                </label>
                <select
                  value={formData.level}
                  onChange={(e) => setFormData({ ...formData, level: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                           bg-bg-elevated text-text-primary"
                >
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                职责描述
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                         bg-bg-elevated text-text-primary resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <button
                onClick={handleReset}
                disabled={saving}
                className="text-sm text-text-secondary hover:text-text-primary"
              >
                恢复默认
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-hover)]
                           disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-bg-elevated rounded-xl shadow-sm border border-[var(--border-color)] p-6
                 hover:border-[var(--border-color)] transition-colors cursor-pointer"
      onClick={() => setEditing(true)}
    >
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <AgentAvatar
          avatar={config.avatar}
          fallback="👤"
          size="xl"
          bgStyle={{ backgroundColor: dept.color ? `${dept.color}20` : '#f3f4f6' }}
          bgClass=""
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-semibold text-text-primary">
              {config.name}
            </h3>
            <span
              className="px-2 py-0.5 text-xs rounded-full"
              style={{
                backgroundColor: dept.color ? `${dept.color}20` : '#e5e7eb',
                color: dept.color || '#6b7280',
              }}
            >
              {dept.name || config.department}
            </span>
            {/* 多部门标记 */}
            {isMultiDepartment && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                +{agentDepts.length - 1} 部门
              </span>
            )}
          </div>
          <div className="text-sm text-text-secondary">
            {config.title} · {level.name || config.level}
          </div>
          {/* 显示所有部门 */}
          {isMultiDepartment && (
            <div className="text-xs text-purple-500 dark:text-purple-400 mt-1">
              跨部门：{agentDepts.map(d => departments.find(dept => dept.id === d)?.name || d).join('、')}
            </div>
          )}
          {modelInfo && (
            <div className="text-xs text-blue-500 dark:text-blue-400 mt-1 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {modelInfo.name}
            </div>
          )}
          {/* 薪资信息 */}
          {salaryInfo && (
            <div className={`text-xs mt-1 flex items-center gap-2 ${salaryInfo.isOverdrawn ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
              <span>
                余额: {(salaryInfo.balance || 0).toLocaleString()}
              </span>
              <span className="text-text-muted">|</span>
              <span className="text-text-secondary">
                日薪: {(salaryInfo.dailySalary || 0).toLocaleString()}
              </span>
              {salaryInfo.isOverdrawn && (
                <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-xs">
                  透支
                </span>
              )}
            </div>
          )}
          {config.description && (
            <div className="text-sm text-text-muted mt-1 truncate">
              {config.description}
            </div>
          )}
        </div>

        {/* Edit hint */}
        <div className="text-text-muted">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

/**
 * 编辑侧边面板组件
 */
function EditPanel({ config, levels, departments, models, onSave, onReset, onClose, saving }) {
  const [formData, setFormData] = useState({
    name: config?.name || '',
    title: config?.title || '',
    level: config?.level || '',
    department: config?.department || '',
    description: config?.description || '',
    avatar: config?.avatar || '',
    model: config?.model || 'claude-sonnet-4-5',
  });

  // 当 config 变化时更新表单
  useEffect(() => {
    if (config) {
      setFormData({
        name: config.name || '',
        title: config.title || '',
        level: config.level || '',
        department: config.department || '',
        description: config.description || '',
        avatar: config.avatar || '',
        model: config.model || 'claude-sonnet-4-5',
      });
    }
  }, [config]);

  if (!config) return null;

  const dept = departments.find((d) => d.id === config.department) || {};

  const handleSave = async () => {
    await onSave(config.id, formData);
  };

  const handleReset = async () => {
    const result = await onReset(config.id);
    if (result) {
      setFormData({
        name: result.name,
        title: result.title,
        level: result.level,
        department: result.department,
        description: result.description || '',
        avatar: result.avatar || '',
        model: result.model || 'claude-sonnet-4-5',
      });
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-bg-elevated shadow-2xl border-l border-[var(--border-color)] z-50 overflow-auto">
      {/* 头部 */}
      <div
        className="sticky top-0 p-4 border-b border-[var(--border-color)]"
        style={{ backgroundColor: `${dept.color}10` }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AgentAvatar
              avatar={config.avatar}
              fallback="👤"
              size="lg"
              bgStyle={{ backgroundColor: `${dept.color}20` }}
              bgClass=""
            />
            <div>
              <div className="font-semibold text-text-primary">{config.name}</div>
              <div className="text-sm text-text-secondary">{config.title}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-text-secondary hover:text-text-primary rounded-lg hover:bg-[var(--bg-hover)]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* 表单 */}
      <div className="p-4 space-y-4">
        {/* 头像 */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            头像
          </label>
          <div className="flex items-center gap-3">
            <AgentAvatar
              avatar={formData.avatar}
              fallback="👤"
              size="xl"
              bgStyle={{ backgroundColor: `${dept.color}20` }}
              bgClass=""
            />
            <div className="flex-1 space-y-2">
              <button
                type="button"
                onClick={async () => {
                  const result = await window.electronAPI.uploadAgentAvatar(config.id);
                  if (result?.success && result.avatarPath) {
                    setFormData({ ...formData, avatar: result.avatarPath });
                  }
                }}
                className="w-full px-3 py-2 text-sm rounded-lg border border-dashed border-[var(--border-color)] text-text-secondary hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors"
              >
                📷 上传图片头像
              </button>
              {isImageAvatar(formData.avatar) ? (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, avatar: '' })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                >
                  移除图片，恢复为 Emoji
                </button>
              ) : (
                <input
                  type="text"
                  value={formData.avatar}
                  onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
                  placeholder="👤 输入 Emoji"
                  className="w-full px-3 py-1.5 rounded-lg border border-[var(--border-color)]
                           bg-bg-elevated text-text-primary text-center text-lg"
                />
              )}
            </div>
          </div>
        </div>

        {/* 名字 */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            名字
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                     bg-bg-elevated text-text-primary"
          />
        </div>

        {/* 职位头衔 */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            职位头衔
          </label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                     bg-bg-elevated text-text-primary"
          />
        </div>

        {/* 部门 */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            所属部门
          </label>
          <select
            value={formData.department}
            onChange={(e) => setFormData({ ...formData, department: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                     bg-bg-elevated text-text-primary"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {/* 职级 */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            职级
          </label>
          <select
            value={formData.level}
            onChange={(e) => setFormData({ ...formData, level: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                     bg-bg-elevated text-text-primary"
          >
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} (Rank: {l.rank})
              </option>
            ))}
          </select>
        </div>

        {/* 职责描述 */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            职责描述
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                     bg-bg-elevated text-text-primary resize-none"
          />
        </div>

        {/* AI 模型 */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">
            AI 模型
          </label>
          <select
            value={formData.model}
            onChange={(e) => setFormData({ ...formData, model: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)]
                     bg-bg-elevated text-text-primary"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-secondary">
            选择此 Agent 使用的 AI 模型
          </p>
        </div>

        {/* 汇报关系说明 */}
        <div className="p-3 bg-bg-muted rounded-lg">
          <div className="text-xs text-text-secondary uppercase tracking-wider mb-1">
            汇报关系
          </div>
          <div className="text-sm text-text-primary">
            {formData.level === 'c_level' ? (
              <span>直接向 <strong>老板</strong> 汇报</span>
            ) : (
              <span>向 <strong>部门负责人</strong> 汇报，部门负责人向老板汇报</span>
            )}
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="sticky bottom-0 p-4 bg-bg-elevated border-t border-[var(--border-color)]">
        <div className="flex items-center justify-between">
          <button
            onClick={handleReset}
            disabled={saving}
            className="text-sm text-text-secondary hover:text-text-primary"
          >
            恢复默认
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-hover)]
                     disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Agent 管理设置页面
 */
export default function AgentSettings({ onBack }) {
  const [configs, setConfigs] = useState([]);
  const [levels, setLevels] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [models, setModels] = useState([]);
  const [salaryData, setSalaryData] = useState({}); // agentId -> salaryInfo
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [viewMode, setViewMode] = useState('chart'); // 'chart' | 'list'

  // 加载数据
  useEffect(() => {
    const loadData = async () => {
      try {
        const [configsData, levelsData, deptsData, modelsData, salaryConfig] = await Promise.all([
          window.electronAPI.getAgentConfigs(),
          window.electronAPI.getAgentLevels(),
          window.electronAPI.getAgentDepartments(),
          window.electronAPI.getAvailableModels(),
          window.electronAPI.getSalaryConfig?.(),
        ]);
        setConfigs(configsData);
        setLevels(levelsData);
        setDepartments(deptsData);
        setModels(modelsData || []);
        
        // 将薪资数据转换为 map 格式
        if (salaryConfig?.employeeSalaries) {
          const salaryMap = {};
          salaryConfig.employeeSalaries.forEach((s) => {
            salaryMap[s.agentId] = s;
          });
          setSalaryData(salaryMap);
        }
      } catch (error) {
        console.error('加载 Agent 配置失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();

    // 订阅后端配置变更（开除/停职/复职/新增等），实时更新架构图
    const unsubscribe = window.electronAPI?.onAgentConfigChanged?.((newConfigs) => {
      if (newConfigs && Array.isArray(newConfigs)) {
        setConfigs(newConfigs);
      }
    });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  // 过滤已开除的 Agent（架构图和列表只显示在职 + 停职人员）
  const activeConfigs = useMemo(
    () => configs.filter((c) => (c.status || 'active') !== 'terminated'),
    [configs]
  );

  // 保存配置
  const handleSave = useCallback(async (agentId, updates) => {
    setSaving(true);
    try {
      const result = await window.electronAPI.updateAgentConfig(agentId, updates);
      if (result.success && result.config) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === agentId ? result.config : c))
        );
      }
    } catch (error) {
      console.error('保存 Agent 配置失败:', error);
    } finally {
      setSaving(false);
    }
  }, []);

  // 重置配置
  const handleReset = useCallback(async (agentId) => {
    setSaving(true);
    try {
      const result = await window.electronAPI.resetAgentConfig(agentId);
      if (result.success && result.config) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === agentId ? result.config : c))
        );
        return result.config;
      }
    } catch (error) {
      console.error('重置 Agent 配置失败:', error);
    } finally {
      setSaving(false);
    }
    return null;
  }, []);

  const selectedConfig = configs.find((c) => c.id === selectedId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-text-secondary">加载中...</div>
      </div>
    );
  }

  // 按部门分组（用于列表视图），支持多部门，只显示在职/停职人员
  const groupedConfigs = activeConfigs.reduce((acc, config) => {
    const depts = getAgentDepartments(config);
    const deptIds = depts.length > 0 ? depts : ['other'];
    for (const deptId of deptIds) {
      if (!acc[deptId]) {
        acc[deptId] = [];
      }
      // 标记多部门信息
      acc[deptId].push({
        ...config,
        isPrimaryDepartment: deptId === deptIds[0],
        crossDepartments: deptIds.filter(d => d !== deptId),
        isMultiDepartment: deptIds.length > 1,
      });
    }
    return acc;
  }, {});

  // 按职级排序
  const sortByLevel = (a, b) => {
    const levelA = levels.find((l) => l.id === a.level)?.rank || 0;
    const levelB = levels.find((l) => l.id === b.level)?.rank || 0;
    return levelB - levelA;
  };

  return (
    <div className="h-full bg-bg-base overflow-auto">
      {/* macOS 标题栏占位 */}
      <div className="shrink-0 h-8 drag-region" />
      <div className="max-w-5xl mx-auto py-8 px-4">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">组织架构</h1>
            <p className="text-text-secondary mt-1">
              可视化管理团队成员，点击人员卡片编辑信息
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* 视图切换 */}
            <div className="flex items-center bg-bg-muted rounded-lg p-1">
              <button
                onClick={() => setViewMode('chart')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  viewMode === 'chart'
                    ? 'bg-bg-elevated text-text-primary shadow-sm'
                    : 'text-text-secondary'
                }`}
              >
                架构图
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  viewMode === 'list'
                    ? 'bg-bg-elevated text-text-primary shadow-sm'
                    : 'text-text-secondary'
                }`}
              >
                列表
              </button>
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
        </div>

        {/* 组织架构图视图 */}
        {viewMode === 'chart' && (
          <OrgChart
            configs={activeConfigs}
            levels={levels}
            departments={departments}
            onSelectMember={(member) => setSelectedId(member.id)}
            selectedId={selectedId}
          />
        )}

        {/* 列表视图 */}
        {viewMode === 'list' && (
          <div className="space-y-8">
            {Object.entries(groupedConfigs).map(([deptId, deptConfigs]) => {
              const dept = departments.find((d) => d.id === deptId) || { name: '其他', color: '#6b7280' };
              return (
                <div key={deptId}>
                  <div className="flex items-center gap-2 mb-4">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: dept.color }}
                    />
                    <h2 className="text-lg font-semibold text-text-primary">
                      {dept.name}
                    </h2>
                    <span className="text-sm text-text-secondary">
                      ({deptConfigs.length} 人)
                    </span>
                  </div>
                  <div className="space-y-3">
                    {deptConfigs.sort(sortByLevel).map((config) => (
                      <AgentCard
                        key={config.id}
                        config={config}
                        levels={levels}
                        departments={departments}
                        models={models}
                        onSave={handleSave}
                        onReset={handleReset}
                        saving={saving}
                        salaryInfo={salaryData[config.id]}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 提示 */}
        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="text-sm text-blue-700 dark:text-blue-300">
              <p className="font-medium">关于汇报关系</p>
              <p className="mt-1 text-blue-600 dark:text-blue-400">
                C-Level 高管直接向老板汇报，其他成员向所在部门的负责人（最高职级者）汇报。
                在对话中提到某人时，Agent 会自动识别其身份和所属部门。
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 编辑侧边面板 */}
      {selectedConfig && (
        <>
          {/* 遮罩 */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setSelectedId(null)}
          />
          <EditPanel
            config={selectedConfig}
            levels={levels}
            departments={departments}
            models={models}
            onSave={handleSave}
            onReset={handleReset}
            onClose={() => setSelectedId(null)}
            saving={saving}
          />
        </>
      )}
    </div>
  );
}
