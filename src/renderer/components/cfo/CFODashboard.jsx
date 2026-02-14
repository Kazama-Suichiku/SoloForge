/**
 * SoloForge - CFO 控制台
 * 展示 Token 使用统计、预算状态和预警
 */
import { useState, useEffect, useCallback } from 'react';

/**
 * 进度条组件
 */
function ProgressBar({ percentage, level }) {
  const colorMap = {
    normal: 'bg-green-500',
    warning: 'bg-yellow-500',
    critical: 'bg-orange-500',
    exceeded: 'bg-red-500',
  };

  const color = percentage >= 100 ? colorMap.exceeded
    : percentage >= 90 ? colorMap.critical
    : percentage >= 70 ? colorMap.warning
    : colorMap.normal;

  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div
        className={`h-2 rounded-full transition-all duration-300 ${color}`}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  );
}

/**
 * 统计卡片组件
 */
function StatCard({ title, value, subtitle, trend }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="text-sm text-gray-500 dark:text-gray-400">{title}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
        {value}
      </div>
      {subtitle && (
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {subtitle}
        </div>
      )}
      {trend && (
        <div className={`text-sm mt-1 ${trend > 0 ? 'text-green-500' : 'text-red-500'}`}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
        </div>
      )}
    </div>
  );
}

/**
 * Agent 使用行
 */
function AgentUsageRow({ agent }) {
  const percentage = agent.budgetUsagePercent ?? 0;

  return (
    <div className="py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {agent.agentId}
        </span>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {agent.totalTokens.toLocaleString()} / {agent.budget?.dailyLimit?.toLocaleString() || '∞'}
        </span>
      </div>
      <ProgressBar percentage={percentage} />
      <div className="flex justify-between mt-1 text-xs text-gray-400">
        <span>{agent.callCount} 次调用</span>
        <span>{percentage}%</span>
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

  const levelIcons = {
    warning: '⚠️',
    critical: '🔶',
    exceeded: '🚨',
  };

  return (
    <div className={`p-3 rounded-lg border ${levelStyles[alert.level]} ${alert.acknowledged ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-2">
        <span className="text-lg">{levelIcons[alert.level]}</span>
        <div className="flex-1">
          <div className="font-medium text-gray-900 dark:text-gray-100">
            {alert.message}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            使用量: {alert.currentUsage.toLocaleString()} / {alert.limit.toLocaleString()} ({alert.percentage}%)
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {new Date(alert.timestamp).toLocaleString()}
          </div>
        </div>
        {!alert.acknowledged && (
          <button
            onClick={() => onAcknowledge(alert.id)}
            className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
          >
            确认
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * CFO 控制台
 */
export default function CFODashboard({ onBack }) {
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('today');

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 通过 IPC 获取数据
      const tokenStats = await window.electronAPI?.getTokenStats?.(period);
      const alertList = await window.electronAPI?.getAlerts?.();
      
      if (tokenStats) setStats(tokenStats);
      if (alertList) setAlerts(alertList);
    } catch (error) {
      console.error('加载 CFO 数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadData();
    // 每 30 秒刷新一次
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

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

  const formatNumber = (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-950 overflow-auto">
      <div className="max-w-4xl mx-auto py-8 px-4">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              CFO 控制台
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Token 使用统计与预算管理
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* 周期选择 */}
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
                ← 返回
              </button>
            )}
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <StatCard
            title="总 Token 使用"
            value={formatNumber(stats?.global?.totalTokens || 0)}
            subtitle={`${stats?.global?.callCount || 0} 次调用`}
          />
          <StatCard
            title="输入 Token"
            value={formatNumber(stats?.global?.totalPromptTokens || 0)}
          />
          <StatCard
            title="输出 Token"
            value={formatNumber(stats?.global?.totalCompletionTokens || 0)}
          />
          <StatCard
            title="预算使用率"
            value={`${stats?.global?.dailyUsagePercent || 0}%`}
            subtitle={`限额 ${formatNumber(stats?.global?.globalDailyLimit || 0)}`}
          />
        </div>

        {/* 全局预算进度 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            全局预算
          </h2>
          <div className="mb-2">
            <div className="flex justify-between mb-1">
              <span className="text-sm text-gray-500">
                {formatNumber(stats?.global?.totalTokens || 0)} / {formatNumber(stats?.global?.globalDailyLimit || 0)}
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {stats?.global?.dailyUsagePercent || 0}%
              </span>
            </div>
            <ProgressBar percentage={stats?.global?.dailyUsagePercent || 0} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8">
          {/* Agent 使用情况 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Agent 使用情况
            </h2>
            {stats?.agents?.length > 0 ? (
              <div className="space-y-1">
                {stats.agents.map((agent) => (
                  <AgentUsageRow key={agent.agentId} agent={agent} />
                ))}
              </div>
            ) : (
              <div className="text-gray-500 dark:text-gray-400 text-center py-8">
                暂无数据
              </div>
            )}
          </div>

          {/* 预警列表 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              预警通知
            </h2>
            {alerts.length > 0 ? (
              <div className="space-y-3 max-h-80 overflow-auto">
                {alerts.slice(0, 10).map((alert) => (
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
          </div>
        </div>
      </div>
    </div>
  );
}
