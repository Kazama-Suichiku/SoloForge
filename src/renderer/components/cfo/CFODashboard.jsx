/**
 * SoloForge - CFO 控制台
 * 展示 Token 使用统计、预算状态、工资管理和预警
 * 全部使用设计 token（--bg-* / --text-* / --accent / --color-success|warning|danger
 * / --border-* / .surface / .card / .input / .btn-primary / .btn-ghost），
 * 不依赖任何 Tailwind 原生调色板，与全局 Linear 风格一致。
 */
import { useState, useEffect, useCallback } from 'react';
import { EmptyState } from '../dashboard/ui';
import {
  BriefcaseIcon,
  BanknotesIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

/**
 * 语义进度条 —— 复用 dashboard/ui.jsx 的 ProgressBar 模式
 * 用 inline style 走 var(--color-success/warning/danger)，避免 transition-all
 */
function ProgressBar({ percentage, isNegative = false }) {
  let tone = 'var(--color-success)';
  if (isNegative) {
    tone = 'var(--color-danger)';
  } else if (percentage >= 100) {
    tone = 'var(--color-danger)';
  } else if (percentage >= 90) {
    tone = 'var(--color-warning)';
  }
  // 70-90 档保留 success（原 yellow-500 在语义色里无对应，warning 留给 90+）

  const pct = Math.min(Math.abs(percentage), 100);

  return (
    <div
      className="w-full rounded-full overflow-hidden h-2"
      style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
    >
      <div
        className="h-2 rounded-full"
        style={{
          backgroundColor: tone,
          width: '100%',
          transform: `scaleX(${pct / 100})`,
          transformOrigin: 'left center',
          transition: 'transform 280ms cubic-bezier(0.23,1,0.32,1)',
          willChange: 'transform',
        }}
      />
    </div>
  );
}

/**
 * 统计卡片 —— token 版本，走 .card 液态玻璃 + 语义圆点
 */
function StatCard({ title, value, subtitle, tone = 'neutral' }) {
  const dotColor =
    tone === 'danger' ? 'var(--color-danger)' :
    tone === 'warning' ? 'var(--color-warning)' :
    tone === 'success' ? 'var(--color-success)' :
    'var(--accent)';

  return (
    <div className="card card-hover flex flex-col gap-1.5 !p-4">
      <div className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
          aria-hidden="true"
        />
        <p className="text-xs text-text-tertiary leading-none">{title}</p>
      </div>
      <p
        className="text-[24px] font-title leading-none text-text-primary"
        style={{ letterSpacing: '-0.012em', fontWeight: 590 }}
      >
        {value}
      </p>
      {subtitle && <p className="text-xs text-text-quaternary leading-snug">{subtitle}</p>}
    </div>
  );
}

/**
 * 员工薪资行
 */
function EmployeeSalaryRow({ agent, onAdjustSalary, onPayBonus }) {
  const salary = agent.salary;
  const balance = salary?.balance ?? 0;
  const dailySalary = salary?.dailySalary ?? 0;
  const isOverdrawn = salary?.isOverdrawn || balance < 0;

  // 计算使用百分比
  const usedPercent = dailySalary > 0
    ? Math.round(((dailySalary - balance) / dailySalary) * 100)
    : 0;

  // 显示名称（优先使用 agentName，没有则用 agentId）
  const displayName = agent.agentName || agent.agentId;
  const displayTitle = agent.agentTitle || '';

  return (
    <div className="py-3 border-b border-border-subtle last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary">
            {displayName}
          </span>
          {displayTitle && (
            <span className="text-xs text-text-quaternary">
              {displayTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${isOverdrawn ? 'text-danger font-medium' : 'text-text-tertiary'}`}>
            {balance.toLocaleString()} / {dailySalary.toLocaleString()}
          </span>
          {isOverdrawn && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 text-xs rounded-sm leading-none"
              style={{
                color: 'var(--color-danger)',
                backgroundColor: 'rgba(248, 113, 113, 0.12)',
                border: '1px solid rgba(248, 113, 113, 0.24)',
              }}
            >
              透支
            </span>
          )}
        </div>
      </div>
      <ProgressBar percentage={usedPercent} isNegative={isOverdrawn} />
      <div className="flex justify-between mt-1 text-xs text-text-quaternary">
        <span>{agent.callCount || 0} 次调用</span>
        <div className="flex gap-2">
          <button
            onClick={() => onAdjustSalary?.(agent.agentId, displayName, dailySalary)}
            className="text-accent hover:text-accent-hover transition-colors-fast"
          >
            调薪
          </button>
          <button
            onClick={() => onPayBonus?.(agent.agentId, displayName)}
            className="text-success hover:text-accent-hover transition-colors-fast"
          >
            发奖金
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 职级工资配置行
 */
function LevelSalaryRow({ level, salary, onEdit }) {
  const levelNames = {
    c_level: 'C-Level 高管',
    vp: '副总裁',
    director: '总监',
    manager: '经理',
    senior: '高级专员',
    staff: '专员',
    intern: '实习生',
    assistant: '助理',
  };

  const displayName = levelNames[level] || level;

  return (
    <div className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0">
      <span className="text-sm text-text-secondary">
        {displayName}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-primary">
          {salary.toLocaleString()}
        </span>
        <button
          onClick={() => onEdit(level, displayName, salary)}
          className="text-xs text-accent hover:text-accent-hover transition-colors-fast"
        >
          编辑
        </button>
      </div>
    </div>
  );
}

/**
 * 预警项 —— 语义色边框 + 半透明底，按 level 映射 token
 */
function AlertItem({ alert, onAcknowledge }) {
  // level → 语义 token：warning/critical → warning, exceeded → danger
  const tone =
    alert.level === 'exceeded' ? 'var(--color-danger)' :
    'var(--color-warning)'; // warning & critical 都走 warning 色

  const toneSubtle =
    alert.level === 'exceeded' ? 'rgba(248, 113, 113, 0.08)' :
    'rgba(251, 191, 36, 0.08)';

  return (
    <div
      className={`p-3 rounded-lg border ${alert.acknowledged ? 'opacity-50' : ''}`}
      style={{
        backgroundColor: toneSubtle,
        borderColor: toneSubtle,
      }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="font-medium text-text-primary text-sm">
            {alert.message}
          </div>
          <div className="text-xs text-text-quaternary mt-1">
            {new Date(alert.timestamp).toLocaleString()}
          </div>
        </div>
        {!alert.acknowledged && (
          <button
            onClick={() => onAcknowledge(alert.id)}
            className="text-xs text-accent hover:text-accent-hover transition-colors-fast"
          >
            确认
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 调薪/发奖金弹窗 —— .surface + .glass-enter + .modal-center + shadow-dialog
 * 遮罩与 CompanySelectPage/ConfirmDialog 一致：bg-black/50 backdrop-blur-sm + ESC 关闭
 */
function SalaryModal({ type, agentId, agentName, currentValue, onConfirm, onClose }) {
  const [value, setValue] = useState(currentValue || 0);
  const [reason, setReason] = useState('');

  const title = type === 'salary' ? '调整日薪' : type === 'levelSalary' ? '修改职级默认日薪' : '发放奖金';
  const label = type === 'salary' ? '新日薪' : type === 'levelSalary' ? '默认日薪' : '奖金金额';
  const displayName = agentName || agentId;

  // ESC 关闭
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 弹窗本体 */}
      <div
        className="relative surface glass-enter modal-center rounded-xl shadow-dialog w-96 max-w-[calc(100vw-2rem)] mx-4 p-6 animate-scale-in"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="text-lg font-ui text-text-primary mb-4">
          {title}
        </h3>
        <div className="mb-4">
          <label className="block text-sm text-text-tertiary mb-1.5">
            {type === 'levelSalary' ? '职级' : '员工'}
          </label>
          <input
            type="text"
            value={displayName}
            disabled
            className="input"
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm text-text-tertiary mb-1.5">
            {label} (tokens)
          </label>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="input"
          />
        </div>
        {type === 'bonus' && (
          <div className="mb-4">
            <label className="block text-sm text-text-tertiary mb-1.5">
              发放原因（可选）
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：项目奖励"
              className="input"
            />
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost">
            取消
          </button>
          <button
            onClick={() => onConfirm(value, reason)}
            className="btn-primary"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Loading spinner —— accent 圆环，与 App.jsx 的 loading 模式一致
 */
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 animate-fade-in">
      <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-text-secondary">加载中...</p>
    </div>
  );
}

/**
 * CFO 控制台
 */
export default function CFODashboard({ onBack, isActive = true }) {
  const [stats, setStats] = useState(null);
  const [salaryConfig, setSalaryConfig] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('today');
  const [activeTab, setActiveTab] = useState('usage'); // 'usage' | 'salary' | 'alerts'
  const [modal, setModal] = useState(null); // { type, agentId, currentValue }

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tokenStats, alertList, salaryData] = await Promise.all([
        window.electronAPI?.getTokenStats?.({ period }),
        window.electronAPI?.getAlerts?.(),
        window.electronAPI?.getSalaryConfig?.(),
      ]);

      if (tokenStats) setStats(tokenStats);
      if (alertList) setAlerts(alertList);
      if (salaryData) setSalaryConfig(salaryData);
    } catch (error) {
      console.error('加载 CFO 数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    // 只在页面可见时加载数据和轮询
    if (!isActive) return;

    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData, isActive]);

  const handleAcknowledge = async (alertId) => {
    try {
      await window.electronAPI?.acknowledgeAlert?.(alertId);
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a))
      );
    } catch (error) {
      console.error('确认预警失败:', error);
    }
  };

  const handleAdjustSalary = (agentId, agentName, currentSalary) => {
    setModal({ type: 'salary', agentId, agentName, currentValue: currentSalary });
  };

  const handlePayBonus = (agentId, agentName) => {
    setModal({ type: 'bonus', agentId, agentName, currentValue: 10000 });
  };

  const handleEditLevelSalary = (level, levelName, currentSalary) => {
    setModal({ type: 'levelSalary', agentId: level, agentName: levelName, currentValue: currentSalary });
  };

  const handleModalConfirm = async (value, reason) => {
    if (!modal) return;

    try {
      if (modal.type === 'salary') {
        await window.electronAPI?.setAgentSalary?.(modal.agentId, value);
      } else if (modal.type === 'bonus') {
        await window.electronAPI?.payBonus?.(modal.agentId, value, reason);
      } else if (modal.type === 'levelSalary') {
        await window.electronAPI?.setLevelSalary?.(modal.agentId, value);
      }
      setModal(null);
      loadData(); // 刷新数据
    } catch (error) {
      console.error('操作失败:', error);
    }
  };

  const formatNumber = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num?.toString() || '0';
  };

  if (loading && !stats) {
    return <LoadingState />;
  }

  const overdrawnCount = salaryConfig?.overdrawnCount || 0;
  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="h-full bg-bg-base overflow-auto">
      <div className="max-w-5xl mx-auto py-8 px-4">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-title tracking-tightest text-text-primary">
              CFO 控制台
            </h1>
            <p className="text-sm text-text-tertiary mt-1">
              Token 使用统计与工资管理
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="input !w-auto"
            >
              <option value="today">今日</option>
              <option value="week">本周</option>
              <option value="month">本月</option>
              <option value="all">全部</option>
            </select>
            {onBack && (
              <button onClick={onBack} className="btn-ghost">
                <ArrowPathIcon className="w-4 h-4" />
                返回
              </button>
            )}
          </div>
        </div>

        {/* 统计卡片 —— 响应式：窄窗口 2 列，宽窗口 4 列 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatCard
            title="总 Token 使用"
            value={formatNumber(stats?.global?.totalTokens || 0)}
            subtitle={`${stats?.global?.callCount || 0} 次调用`}
            tone="accent"
          />
          <StatCard
            title="每日工资总预算"
            value={formatNumber(salaryConfig?.totalDailySalaryBudget || 0)}
            subtitle={`${salaryConfig?.employeeSalaries?.length || 0} 位员工`}
            tone="accent"
          />
          <StatCard
            title="透支员工"
            value={overdrawnCount}
            tone={overdrawnCount > 0 ? 'danger' : 'success'}
            subtitle={overdrawnCount > 0 ? '需要关注' : '状态良好'}
          />
          <StatCard
            title="全局预算使用"
            value={`${stats?.global?.dailyUsagePercent || 0}%`}
            subtitle={`限额 ${formatNumber(stats?.global?.globalDailyLimit || 0)}`}
            tone={stats?.global?.dailyUsagePercent >= 90 ? 'danger' : stats?.global?.dailyUsagePercent >= 70 ? 'warning' : 'success'}
          />
        </div>

        {/* 标签页 */}
        <div className="flex gap-2 mb-6">
          {[
            { id: 'usage', label: '员工使用情况', icon: BanknotesIcon },
            { id: 'salary', label: '工资配置', icon: BriefcaseIcon },
            { id: 'alerts', label: `预警${unacknowledgedCount ? ` ${unacknowledgedCount}` : ''}`, icon: ExclamationTriangleIcon },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`emil-pressable inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors-fast ${
                activeTab === tab.id
                  ? 'bg-accent text-white'
                  : 'bg-bg-hover text-text-secondary hover:text-text-primary'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区 —— .panel 玻璃面板 */}
        <div className="panel p-6">
          {activeTab === 'usage' && (
            <>
              <h2 className="text-lg font-ui text-text-primary mb-4">
                员工余额与使用
              </h2>
              {stats?.agents?.length > 0 ? (
                <div className="space-y-1 max-h-96 overflow-auto scroll-fade-bottom">
                  {stats.agents.map((agent) => (
                    <EmployeeSalaryRow
                      key={agent.agentId}
                      agent={agent}
                      onAdjustSalary={handleAdjustSalary}
                      onPayBonus={handlePayBonus}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState icon={BanknotesIcon} message="暂无数据" hint="尚无 Token 使用记录" />
              )}
            </>
          )}

          {activeTab === 'salary' && (
            <>
              <h2 className="text-lg font-ui text-text-primary mb-2">
                职级默认日薪配置
              </h2>
              <p className="text-sm text-text-tertiary mb-4">
                修改后仅影响新入职员工，不会自动调整现有员工的日薪
              </p>
              {salaryConfig?.levelDefaults ? (
                <div className="space-y-1">
                  {Object.entries(salaryConfig.levelDefaults).map(([level, salary]) => (
                    <LevelSalaryRow
                      key={level}
                      level={level}
                      salary={salary}
                      onEdit={handleEditLevelSalary}
                    />
                  ))}
                </div>
              ) : (
                <LoadingState />
              )}
            </>
          )}

          {activeTab === 'alerts' && (
            <>
              <h2 className="text-lg font-ui text-text-primary mb-4">
                预警通知
              </h2>
              {alerts.length > 0 ? (
                <div className="space-y-3 max-h-96 overflow-auto scroll-fade-bottom">
                  {alerts.slice(0, 20).map((alert) => (
                    <AlertItem
                      key={alert.id}
                      alert={alert}
                      onAcknowledge={handleAcknowledge}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState icon={ExclamationTriangleIcon} message="暂无预警" hint="所有指标正常" />
              )}
            </>
          )}
        </div>

        {/* 弹窗 */}
        {modal && (
          <SalaryModal
            type={modal.type}
            agentId={modal.agentId}
            agentName={modal.agentName}
            currentValue={modal.currentValue}
            onConfirm={handleModalConfirm}
            onClose={() => setModal(null)}
          />
        )}
      </div>
    </div>
  );
}
