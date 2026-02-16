/**
 * SoloForge - CFO 控制台
 * 展示 Token 使用统计、预算状态、工资管理和预警
 */
import { useState, useEffect, useCallback } from 'react';

/**
 * 进度条组件
 */
function ProgressBar({ percentage, isNegative = false }) {
  let color = 'bg-green-500';
  if (isNegative) {
    color = 'bg-red-500';
  } else if (percentage >= 100) {
    color = 'bg-red-500';
  } else if (percentage >= 90) {
    color = 'bg-orange-500';
  } else if (percentage >= 70) {
    color = 'bg-yellow-500';
  }

  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div
        className={`h-2 rounded-full transition-all duration-300 ${color}`}
        style={{ width: `${Math.min(Math.abs(percentage), 100)}%` }}
      />
    </div>
  );
}

/**
 * 统计卡片组件
 */
function StatCard({ title, value, subtitle, warning = false }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="text-sm text-gray-500 dark:text-gray-400">{title}</div>
      <div className={`text-2xl font-bold mt-1 ${warning ? 'text-red-500' : 'text-gray-900 dark:text-gray-100'}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {subtitle}
        </div>
      )}
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
    <div className="py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {displayName}
          </span>
          {displayTitle && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {displayTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${isOverdrawn ? 'text-red-500 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
            {balance.toLocaleString()} / {dailySalary.toLocaleString()}
          </span>
          {isOverdrawn && (
            <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded">
              透支
            </span>
          )}
        </div>
      </div>
      <ProgressBar percentage={usedPercent} isNegative={isOverdrawn} />
      <div className="flex justify-between mt-1 text-xs text-gray-400">
        <span>{agent.callCount || 0} 次调用</span>
        <div className="flex gap-2">
          <button
            onClick={() => onAdjustSalary?.(agent.agentId, displayName, dailySalary)}
            className="text-blue-500 hover:text-blue-700"
          >
            调薪
          </button>
          <button
            onClick={() => onPayBonus?.(agent.agentId, displayName)}
            className="text-green-500 hover:text-green-700"
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
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-700 dark:text-gray-300">
        {displayName}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {salary.toLocaleString()}
        </span>
        <button
          onClick={() => onEdit(level, displayName, salary)}
          className="text-xs text-blue-500 hover:text-blue-700"
        >
          编辑
        </button>
      </div>
    </div>
  );
}

/**
 * 预警项
 */
function AlertItem({ alert, onAcknowledge }) {
  const levelStyles = {
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    critical: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
    exceeded: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  };

  return (
    <div className={`p-3 rounded-lg border ${levelStyles[alert.level] || levelStyles.warning} ${alert.acknowledged ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">
            {alert.message}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {new Date(alert.timestamp).toLocaleString()}
          </div>
        </div>
        {!alert.acknowledged && (
          <button
            onClick={() => onAcknowledge(alert.id)}
            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
          >
            确认
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 调薪/发奖金弹窗
 */
function SalaryModal({ type, agentId, agentName, currentValue, onConfirm, onClose }) {
  const [value, setValue] = useState(currentValue || 0);
  const [reason, setReason] = useState('');

  const title = type === 'salary' ? '调整日薪' : type === 'levelSalary' ? '修改职级默认日薪' : '发放奖金';
  const label = type === 'salary' ? '新日薪' : type === 'levelSalary' ? '默认日薪' : '奖金金额';
  const displayName = agentName || agentId;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-96 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {title}
        </h3>
        <div className="mb-4">
          <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
            {type === 'levelSalary' ? '职级' : '员工'}
          </label>
          <input
            type="text"
            value={displayName}
            disabled
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-gray-100 dark:bg-gray-700 text-gray-500"
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
            {label} (tokens)
          </label>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
        </div>
        {type === 'bonus' && (
          <div className="mb-4">
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
              发放原因（可选）
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：项目奖励"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(value, reason)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            确认
          </button>
        </div>
      </div>
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
  const [activeTab, setActiveTab] = useState('usage'); // 'usage' | 'salary' | 'config'
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
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  const overdrawnCount = salaryConfig?.overdrawnCount || 0;

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-950 overflow-auto">
      <div className="max-w-5xl mx-auto py-8 px-4">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              CFO 控制台
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Token 使用统计与工资管理
            </p>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="today">今日</option>
              <option value="week">本周</option>
              <option value="month">本月</option>
              <option value="all">全部</option>
            </select>
            {onBack && (
              <button
                onClick={onBack}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                返回
              </button>
            )}
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard
            title="总 Token 使用"
            value={formatNumber(stats?.global?.totalTokens || 0)}
            subtitle={`${stats?.global?.callCount || 0} 次调用`}
          />
          <StatCard
            title="每日工资总预算"
            value={formatNumber(salaryConfig?.totalDailySalaryBudget || 0)}
            subtitle={`${salaryConfig?.employeeSalaries?.length || 0} 位员工`}
          />
          <StatCard
            title="透支员工"
            value={overdrawnCount}
            warning={overdrawnCount > 0}
            subtitle={overdrawnCount > 0 ? '需要关注' : '状态良好'}
          />
          <StatCard
            title="全局预算使用"
            value={`${stats?.global?.dailyUsagePercent || 0}%`}
            subtitle={`限额 ${formatNumber(stats?.global?.globalDailyLimit || 0)}`}
          />
        </div>

        {/* 标签页 */}
        <div className="flex gap-2 mb-6">
          {[
            { id: 'usage', label: '员工使用情况' },
            { id: 'salary', label: '工资配置' },
            { id: 'alerts', label: `预警 ${alerts.filter(a => !a.acknowledged).length || ''}` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${activeTab === tab.id
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          {activeTab === 'usage' && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                员工余额与使用
              </h2>
              {stats?.agents?.length > 0 ? (
                <div className="space-y-1 max-h-96 overflow-auto">
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
                <div className="text-gray-500 dark:text-gray-400 text-center py-8">
                  暂无数据
                </div>
              )}
            </>
          )}

          {activeTab === 'salary' && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                职级默认日薪配置
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
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
                <div className="text-gray-500 dark:text-gray-400 text-center py-8">
                  加载中...
                </div>
              )}
            </>
          )}

          {activeTab === 'alerts' && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                预警通知
              </h2>
              {alerts.length > 0 ? (
                <div className="space-y-3 max-h-96 overflow-auto">
                  {alerts.slice(0, 20).map((alert) => (
                    <AlertItem
                      key={alert.id}
                      alert={alert}
                      onAcknowledge={handleAcknowledge}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 dark:text-gray-400 text-center py-8">
                  暂无预警
                </div>
              )}
            </>
          )}
        </div>
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
  );
}
