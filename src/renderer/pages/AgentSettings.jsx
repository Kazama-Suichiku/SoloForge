/**
 * SoloForge - Agent 人员管理设置页面
 * 配置 Agent 的名字、职级、部门
 * Linear 风格：.panel/.card/.input/.btn-primary/.btn-ghost、accent 仅用于 CTA、无蓝色无 emoji 装饰
 * 状态 pill badge：active=绿 / suspended=橙 / terminated=红
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import OrgChart from '../components/OrgChart';
import AgentAvatar, { isImageAvatar } from '../components/AgentAvatar';

/** 获取 Agent 所属的所有部门（兼容新旧格式） */
function getAgentDepartments(config) {
  if (Array.isArray(config.departments) && config.departments.length > 0) {
    return config.departments;
  }
  if (config.department) {
    return [config.department];
  }
  return [];
}

/**
 * P2-5: 将 hex 颜色转为标准 rgba 字符串，避免 `${color}20` 字符串拼接 alpha
 * 兼容 #rgb / #rrggbb；alpha 为 0-1 浮点。非合法 hex 回退 null。
 */
function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 部门 tint：hex 走 rgba，否则回退到中性半透明 */
function deptTint(color, alpha) {
  return hexToRgba(color, alpha) || 'rgba(255,255,255,0.04)';
}

/** 状态 pill badge：active=绿 / suspended=橙 / terminated=红 */
function StatusBadge({ status }) {
  const s = status || 'active';
  const map = {
    active: 'text-success border-success/30 bg-success/10',
    suspended: 'text-warning border-warning/30 bg-warning/10',
    terminated: 'text-danger border-danger/30 bg-danger/10',
  };
  const label = { active: '在职', suspended: '停职', terminated: '已开除' }[s] || s;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-xs rounded-full border ${map[s] || map.active}`}
    >
      {label}
    </span>
  );
}

/**
 * Agent 编辑卡片组件（列表视图内嵌编辑）
 */
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
      <div className="card border-accent/40">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="flex-shrink-0 flex flex-col items-center gap-2">
            <AgentAvatar
              avatar={formData.avatar}
              fallback="A"
              size="2xl"
              bgClass="border border-dashed border-border-default"
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
                className="btn-ghost px-2 py-0.5 text-xs"
                title="上传图片头像"
              >
                上传图片
              </button>
              {isImageAvatar(formData.avatar) && (
                <button
                  type="button"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      avatar: config.avatar?.includes('/') ? '' : config.avatar || '',
                    })
                  }
                  className="btn-ghost px-2 py-0.5 text-xs text-text-tertiary hover:text-danger"
                  title="移除图片"
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
                placeholder="A"
                className="input w-16 text-center text-base"
                title="输入 Emoji 或符号作为头像"
              />
            )}
          </div>

          {/* Form */}
          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">名字</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">职位头衔</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">部门</label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  className="input"
                >
                  {Array.isArray(departments) &&
                    departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">职级</label>
                <select
                  value={formData.level}
                  onChange={(e) => setFormData({ ...formData, level: e.target.value })}
                  className="input"
                >
                  {Array.isArray(levels) &&
                    levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">职责描述</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
                className="input resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-1">
              <button
                onClick={handleReset}
                disabled={saving}
                className="text-sm text-text-tertiary hover:text-text-primary transition-colors-fast"
              >
                恢复默认
              </button>
              <div className="flex gap-2">
                <button onClick={handleCancel} disabled={saving} className="btn-ghost">
                  取消
                </button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
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
      className="card card-hover cursor-pointer"
      onClick={() => setEditing(true)}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <AgentAvatar
          avatar={config.avatar}
          fallback="A"
          size="lg"
          bgStyle={{ backgroundColor: deptTint(dept.color, 0.125) }}
          bgClass=""
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-text-primary truncate">
              {config.name}
            </h3>
            <StatusBadge status={config.status} />
            <span
              className="inline-flex items-center px-1.5 py-0.5 text-xs rounded-full border"
              style={{
                backgroundColor: deptTint(dept.color, 0.125),
                borderColor: deptTint(dept.color, 0.25) || 'var(--border-default)',
                color: dept.color || 'var(--text-tertiary)',
              }}
            >
              {dept.name || config.department}
            </span>
            {/* 多部门标记 */}
            {isMultiDepartment && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-xs rounded-full border border-border-default text-text-tertiary">
                +{agentDepts.length - 1} 部门
              </span>
            )}
          </div>
          <div className="text-sm text-text-tertiary mt-0.5 truncate">
            {config.title} · {level.name || config.level}
          </div>
          {/* 显示所有部门 */}
          {isMultiDepartment && (
            <div className="text-xs text-text-quaternary mt-1 truncate">
              跨部门：{agentDepts.map((d) => departments.find((dep) => dep.id === d)?.name || d).join('、')}
            </div>
          )}
          {modelInfo && (
            <div className="text-xs text-text-tertiary mt-1 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              {modelInfo.name}
            </div>
          )}
          {/* 薪资信息（紧凑） */}
          {salaryInfo && (
            <div
              className={`text-xs mt-1 flex items-center gap-2 ${
                salaryInfo.isOverdrawn ? 'text-danger' : 'text-success'
              }`}
            >
              <span>余额: {(salaryInfo.balance || 0).toLocaleString()}</span>
              <span className="text-text-quaternary">|</span>
              <span className="text-text-tertiary">
                日薪: {(salaryInfo.dailySalary || 0).toLocaleString()}
              </span>
              {salaryInfo.isOverdrawn && (
                <span className="inline-flex items-center px-1 py-0 text-xs rounded border border-danger/30 bg-danger/10 text-danger">
                  透支
                </span>
              )}
            </div>
          )}
          {config.description && (
            <div className="text-sm text-text-quaternary mt-1 truncate">{config.description}</div>
          )}
        </div>

        {/* Edit hint */}
        <div className="text-text-quaternary flex-shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
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

  const dept = (Array.isArray(departments) ? departments.find((d) => d.id === config.department) : null) || {};

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
    <div
      className="fixed inset-y-0 right-0 w-96 bg-bg-panel border-l border-border-default shadow-dialog z-50 overflow-auto"
      style={{
        // Emil: 侧边面板从 translateX(20px)+opacity:0 入场，280ms ease-out
        animation: 'editPanelEnter 280ms cubic-bezier(0.23,1,0.32,1) both',
        willChange: 'transform, opacity',
      }}
    >
      <style>{`
        @keyframes editPanelEnter {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      {/* 头部 */}
      <div className="sticky top-0 p-4 border-b border-border-default bg-bg-panel/95 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <AgentAvatar
              avatar={config.avatar}
              fallback="A"
              size="lg"
              bgStyle={{ backgroundColor: deptTint(dept.color, 0.125) }}
              bgClass=""
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-text-primary truncate">{config.name}</div>
                <StatusBadge status={config.status} />
              </div>
              <div className="text-sm text-text-tertiary truncate">{config.title}</div>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* 表单 */}
      <div className="p-4 space-y-4">
        {/* 头像 */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">头像</label>
          <div className="flex items-center gap-3">
            <AgentAvatar
              avatar={formData.avatar}
              fallback="A"
              size="xl"
              bgStyle={{ backgroundColor: deptTint(dept.color, 0.125) }}
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
                className="btn-ghost w-full justify-center border-dashed"
              >
                上传图片头像
              </button>
              {isImageAvatar(formData.avatar) ? (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, avatar: '' })}
                  className="btn-ghost w-full text-xs text-text-tertiary hover:text-danger"
                >
                  移除图片，恢复为 Emoji
                </button>
              ) : (
                <input
                  type="text"
                  value={formData.avatar}
                  onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
                  placeholder="输入 Emoji 或符号"
                  className="input text-center text-base"
                />
              )}
            </div>
          </div>
        </div>

        {/* 名字 */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">名字</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="input"
          />
        </div>

        {/* 职位头衔 */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">职位头衔</label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="input"
          />
        </div>

        {/* 部门 */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">所属部门</label>
          <select
            value={formData.department}
            onChange={(e) => setFormData({ ...formData, department: e.target.value })}
            className="input"
          >
            {Array.isArray(departments) &&
              departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </div>

        {/* 职级 */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">职级</label>
          <select
            value={formData.level}
            onChange={(e) => setFormData({ ...formData, level: e.target.value })}
            className="input"
          >
            {Array.isArray(levels) &&
              levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} (Rank: {l.rank})
                </option>
              ))}
          </select>
        </div>

        {/* 职责描述 */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">职责描述</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
            className="input resize-none"
          />
        </div>

        {/* AI 模型 */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">AI 模型</label>
          <select
            value={formData.model}
            onChange={(e) => setFormData({ ...formData, model: e.target.value })}
            className="input"
          >
            {Array.isArray(models) &&
              models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.provider})
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-text-tertiary">选择此 Agent 使用的 AI 模型</p>
        </div>

        {/* 汇报关系说明 */}
        <div className="card">
          <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">汇报关系</div>
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
      <div className="sticky bottom-0 p-4 bg-bg-panel border-t border-border-default">
        <div className="flex items-center justify-between">
          <button
            onClick={handleReset}
            disabled={saving}
            className="text-sm text-text-tertiary hover:text-text-primary transition-colors-fast"
          >
            恢复默认
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary px-6 py-2">
            {saving ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 薪资配置紧凑表格
 */
function SalaryTable({ salaryData, configs }) {
  if (!salaryData) return null;
  const entries = Array.isArray(configs)
    ? configs.map((c) => ({ config: c, salary: salaryData[c.id] })).filter((e) => e.salary)
    : [];
  if (entries.length === 0) return null;
  return (
    <div className="panel">
      <div className="p-4 border-b border-border-default">
        <h2 className="text-sm font-title tracking-tight text-text-primary">薪资配置</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-tertiary text-xs uppercase tracking-wider">
              <th className="text-left font-normal px-4 py-2">姓名</th>
              <th className="text-right font-normal px-4 py-2">日薪</th>
              <th className="text-right font-normal px-4 py-2">余额</th>
              <th className="text-left font-normal px-4 py-2">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {entries.map(({ config, salary }) => (
              <tr key={config.id} className="hover:bg-bg-hover transition-colors-fast">
                <td className="px-4 py-2 text-text-primary">{config.name}</td>
                <td className="px-4 py-2 text-right text-text-secondary font-mono">
                  {(salary.dailySalary || 0).toLocaleString()}
                </td>
                <td
                  className={`px-4 py-2 text-right font-mono ${
                    salary.isOverdrawn ? 'text-danger' : 'text-text-secondary'
                  }`}
                >
                  {(salary.balance || 0).toLocaleString()}
                </td>
                <td className="px-4 py-2">
                  {salary.isOverdrawn ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 text-xs rounded border border-danger/30 bg-danger/10 text-danger">
                      透支
                    </span>
                  ) : (
                    <span className="text-text-tertiary text-xs">正常</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    let retryTimer = null;
    const loadData = async () => {
      try {
        const [configsData, levelsData, deptsData, modelsData, salaryConfig] = await Promise.all([
          window.electronAPI.getAgentConfigs(),
          window.electronAPI.getAgentLevels(),
          window.electronAPI.getAgentDepartments(),
          window.electronAPI.getAvailableModels(),
          window.electronAPI.getSalaryConfig?.(),
        ]);
        // 防御：确保 configsData 是数组（公司切换瞬间 IPC 可能返回空/旧数据）
        const safeConfigs = Array.isArray(configsData) ? configsData : [];
        setConfigs(safeConfigs);
        setLevels(Array.isArray(levelsData) ? levelsData : []);
        setDepartments(Array.isArray(deptsData) ? deptsData : []);
        setModels(Array.isArray(modelsData) ? modelsData : []);

        // 将薪资数据转换为 map 格式
        if (salaryConfig?.employeeSalaries) {
          const salaryMap = {};
          salaryConfig.employeeSalaries.forEach((s) => {
            salaryMap[s.agentId] = s;
          });
          setSalaryData(salaryMap);
        }
        return { empty: safeConfigs.length === 0 };
      } catch (error) {
        console.error('加载 Agent 配置失败:', error);
        return { empty: true };
      } finally {
        setLoading(false);
      }
    };
    let loaded = false;
    loadData().then((result) => {
      loaded = true;
      // 公司切换时序兜底：如果首次加载返回空 configs，延迟重试一次
      if (result && result.empty) {
        retryTimer = setTimeout(() => loadData(), 500);
      }
    });

    // 订阅后端配置变更（开除/停职/复职/新增等），实时更新架构图
    const unsubscribe = window.electronAPI?.onAgentConfigChanged?.((newConfigs) => {
      if (newConfigs && Array.isArray(newConfigs)) {
        setConfigs(newConfigs);
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  // 过滤已开除的 Agent（架构图和列表只显示在职 + 停职人员）
  const activeConfigs = useMemo(
    () => (Array.isArray(configs) ? configs.filter((c) => (c.status || 'active') !== 'terminated') : []),
    [configs]
  );

  // 保存配置
  const handleSave = useCallback(async (agentId, updates) => {
    setSaving(true);
    try {
      const result = await window.electronAPI.updateAgentConfig(agentId, updates);
      if (result.success && result.config) {
        setConfigs((prev) =>
          (Array.isArray(prev) ? prev : []).map((c) => (c.id === agentId ? result.config : c))
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
          (Array.isArray(prev) ? prev : []).map((c) => (c.id === agentId ? result.config : c))
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

  const selectedConfig = Array.isArray(configs) ? configs.find((c) => c.id === selectedId) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-bg-base">
        <div
          className="text-text-secondary text-sm"
          style={{ animation: 'agentSettingsLoaderEnter 280ms cubic-bezier(0.23,1,0.32,1) both' }}
        >
          加载中...
        </div>
        <style>{`
          @keyframes agentSettingsLoaderEnter {
            from { opacity: 0; transform: scale(0.95); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>
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
        crossDepartments: deptIds.filter((d) => d !== deptId),
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
            <h1 className="text-2xl font-title tracking-tighter text-text-primary">组织架构</h1>
            <p className="text-text-secondary text-sm mt-1">
              可视化管理团队成员，点击人员卡片编辑信息
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* 视图切换 */}
            <div className="flex items-center rounded-md border border-border-default p-0.5 bg-bg-hover/50">
              <button
                onClick={() => setViewMode('chart')}
                className={`px-3 py-1 text-sm rounded-sm transition-colors-fast ${
                  viewMode === 'chart'
                    ? 'bg-bg-surface text-text-primary'
                    : 'text-text-tertiary hover:text-text-primary'
                }`}
              >
                架构图
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1 text-sm rounded-sm transition-colors-fast ${
                  viewMode === 'list'
                    ? 'bg-bg-surface text-text-primary'
                    : 'text-text-tertiary hover:text-text-primary'
                }`}
              >
                列表
              </button>
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
        </div>

        {/* 组织架构图视图 — OrgChart 容器用 .panel，节点用 .card */}
        {viewMode === 'chart' && activeConfigs.length > 0 && (
          <div className="panel p-6 mb-6">
            <OrgChart
              configs={activeConfigs}
              levels={levels}
              departments={departments}
              onSelectMember={(member) => setSelectedId(member.id)}
              selectedId={selectedId}
            />
          </div>
        )}
        {viewMode === 'chart' && activeConfigs.length === 0 && (
          <div className="panel p-8 mb-6 text-center">
            <p className="text-sm text-text-tertiary">暂无成员，在运营仪表板中招募新员工</p>
          </div>
        )}

        {/* 列表视图 — 紧凑列表，选中态用 accent 半透明背景 */}
        {viewMode === 'list' && (
          <div className="space-y-6">
            {Object.entries(groupedConfigs).map(([deptId, deptConfigs]) => {
              const dept =
                (Array.isArray(departments) ? departments.find((d) => d.id === deptId) : null) ||
                { name: '其他', color: 'var(--text-tertiary)' };
              return (
                <div key={deptId}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dept.color }} />
                    <h2 className="text-sm font-title tracking-tight text-text-primary">{dept.name}</h2>
                    <span className="text-sm text-text-tertiary">({deptConfigs.length} 人)</span>
                  </div>
                  <div className="space-y-2">
                    {[...deptConfigs].sort(sortByLevel).map((config) => {
                      const isSelected = config.id === selectedId;
                      return (
                        <div
                          key={config.id}
                          onClick={() => setSelectedId(config.id)}
                          className={`card card-hover cursor-pointer relative overflow-hidden transition-colors-fast ${
                            isSelected ? 'border-accent/40 bg-accent-subtle' : ''
                          }`}
                        >
                          {/* Emil: 选中态竖线 scaleX 入场（accent，transform-origin top） */}
                          {isSelected && (
                            <span
                              aria-hidden
                              className="absolute left-0 top-0 bottom-0 w-[2px]"
                              style={{
                                backgroundColor: 'var(--accent)',
                                transformOrigin: 'top center',
                                animation: 'agentSelectedBarEnter 220ms cubic-bezier(0.23,1,0.32,1) both',
                                willChange: 'transform',
                              }}
                            />
                          )}
                          <div className="flex items-center gap-3">
                            <AgentAvatar
                              avatar={config.avatar}
                              fallback="A"
                              size="md"
                              bgStyle={{
                                backgroundColor: deptTint(dept.color, 0.125),
                              }}
                              bgClass=""
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-sm font-medium text-text-primary truncate">
                                  {config.name}
                                </h3>
                                <StatusBadge status={config.status} />
                                <span className="text-sm text-text-tertiary truncate">
                                  {config.title}
                                </span>
                              </div>
                              <div className="text-xs text-text-quaternary mt-0.5">
                                {levels.find((l) => l.id === config.level)?.name || config.level}
                              </div>
                            </div>
                            <svg
                              className="w-4 h-4 text-text-quaternary flex-shrink-0"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 薪资配置紧凑表格 */}
        <div className="mt-6">
          <SalaryTable salaryData={salaryData} configs={activeConfigs} />
        </div>

        {/* 提示 — 去掉蓝色，用 .card 中性风格 */}
        <div className="mt-6 card">
          <div className="flex items-start gap-3">
            <svg
              className="w-4 h-4 text-text-tertiary mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="text-sm text-text-secondary">
              <p className="font-medium text-text-primary">关于汇报关系</p>
              <p className="mt-1 text-text-tertiary">
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
            className="fixed inset-0 bg-black/40 z-40"
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

      {/* Emil: 选中态竖线 scaleX 入场 keyframes（仅本页局部） */}
      <style>{`
        @keyframes agentSelectedBarEnter {
          from { opacity: 0; transform: scaleY(0); }
          to   { opacity: 1; transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}
