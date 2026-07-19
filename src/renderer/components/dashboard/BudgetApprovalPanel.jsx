import { useState, useEffect, useCallback } from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { formatNumber } from './utils';
import { EmptyState } from './ui';

/**
 * 预算审批面板
 * props: { onRefresh: Function }
 *
 * 内部定时器：每 10 秒轮询一次预算数据；组件卸载时通过 useEffect cleanup 清理。
 */
export default function BudgetApprovalPanel({ onRefresh }) {
  const [blockedAgents, setBlockedAgents] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [granting, setGranting] = useState(null);

  const loadBudgetData = useCallback(async () => {
    try {
      const [blocked, activeOverrides] = await Promise.all([
        window.electronAPI?.getBlockedAgents?.() || [],
        window.electronAPI?.getBudgetOverrides?.() || [],
      ]);
      setBlockedAgents(blocked || []);
      setOverrides(activeOverrides || []);
    } catch (error) {
      console.error('加载预算数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBudgetData();
    const interval = setInterval(loadBudgetData, 10000);
    return () => clearInterval(interval);
  }, [loadBudgetData]);

  const handleGrantOverride = useCallback(async (agentId, hours = 24) => {
    setGranting(agentId);
    try {
      const result = await window.electronAPI?.grantBudgetOverride?.(agentId, hours);
      if (result?.success) {
        loadBudgetData();
        if (onRefresh) onRefresh();
      } else {
        console.error('授予放行失败:', result?.error);
      }
    } catch (error) {
      console.error('授予放行异常:', error);
    } finally {
      setGranting(null);
    }
  }, [loadBudgetData, onRefresh]);

  const handleRevokeOverride = useCallback(async (agentId) => {
    try {
      const result = await window.electronAPI?.revokeBudgetOverride?.(agentId);
      if (result?.success) {
        loadBudgetData();
        if (onRefresh) onRefresh();
      }
    } catch (error) {
      console.error('撤销放行异常:', error);
    }
  }, [loadBudgetData, onRefresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
      </div>
    );
  }

  const hasContent = blockedAgents.length > 0 || overrides.length > 0;

  if (!hasContent) {
    return <EmptyState icon={CheckCircleIcon} message="预算运行正常，无需审批" />;
  }

  return (
    <div className="space-y-4">
      {/* 被阻止的 Agent */}
      {blockedAgents.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2 flex items-center gap-1.5">
            <ExclamationTriangleIcon className="w-3.5 h-3.5 text-red-500" />
            预算超限 ({blockedAgents.length})
          </h4>
          <div className="space-y-2">
            {blockedAgents.map((agent) => (
              <div
                key={agent.agentId}
                className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {agent.agentId}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      使用率 {agent.percent}% · {formatNumber(agent.usage)} / {formatNumber(agent.limit)} tokens
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      阻止于 {new Date(agent.blockedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleGrantOverride(agent.agentId, 24)}
                      disabled={granting === agent.agentId}
                      className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 transition-colors"
                    >
                      {granting === agent.agentId ? '...' : '放行 24h'}
                    </button>
                    <button
                      onClick={() => handleGrantOverride(agent.agentId, 4)}
                      disabled={granting === agent.agentId}
                      className="px-2 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600 disabled:opacity-50 transition-colors"
                    >
                      4h
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 已放行的 Agent */}
      {overrides.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2 flex items-center gap-1.5">
            <CheckCircleIcon className="w-3.5 h-3.5 text-green-500" />
            临时放行中 ({overrides.length})
          </h4>
          <div className="space-y-1.5">
            {overrides.map((override) => (
              <div
                key={override.agentId}
                className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-900/20 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-primary truncate">
                    {override.agentId}
                  </p>
                  <p className="text-xs text-text-muted">
                    剩余 {override.remainingHours} 小时
                  </p>
                </div>
                <button
                  onClick={() => handleRevokeOverride(override.agentId)}
                  className="px-2 py-1 text-xs text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                >
                  撤销
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
