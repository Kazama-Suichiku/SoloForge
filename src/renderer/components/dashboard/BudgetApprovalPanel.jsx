import { useState, useEffect, useCallback } from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { formatNumber } from './utils';
import { EmptyState, Badge, ProgressBar } from './ui';

/**
 * 预算审批面板 —— Linear 风格，danger 语义色 + ghost 按钮
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
        <div
          className="w-5 h-5 rounded-full animate-spin"
          style={{
            border: '2px solid rgba(255,255,255,0.08)',
            borderTopColor: 'var(--accent)',
            animation: 'budgetLoaderEnter 280ms cubic-bezier(0.23,1,0.32,1) both, spin 700ms linear infinite',
          }}
        />
        <style>{`
          @keyframes budgetLoaderEnter {
            from { opacity: 0; transform: scale(0.95); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    );
  }

  const hasContent = blockedAgents.length > 0 || overrides.length > 0;

  if (!hasContent) {
    return <EmptyState icon={CheckCircleIcon} message="预算运行正常，无需审批" />;
  }

  return (
    <div className="space-y-4">
      {/* 被阻止的 Agent —— danger 语义 */}
      {blockedAgents.length > 0 && (
        <div>
          <h4 className="text-xs font-ui text-text-tertiary mb-2 flex items-center gap-1.5">
            <ExclamationTriangleIcon className="w-3.5 h-3.5 text-danger" />
            预算超限 ({blockedAgents.length})
          </h4>
          <div className="space-y-2">
            {blockedAgents.map((agent) => (
              <div
                key={agent.agentId}
                className="p-3 rounded-md border border-border-subtle"
                style={{ backgroundColor: 'rgba(248,113,113,0.04)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-ui text-text-primary truncate">
                      {agent.agentId}
                    </p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      使用率 {agent.percent}% · {formatNumber(agent.usage)} / {formatNumber(agent.limit)} tokens
                    </p>
                    <p className="text-xs text-text-quaternary mt-1">
                      阻止于 {new Date(agent.blockedAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {/* 进度条 —— danger 语义，Emil: transform scaleX 走 GPU */}
                    <div className="mt-2">
                      <ProgressBar
                        value={Math.min(100, agent.percent)}
                        size="sm"
                        tone="danger"
                      />
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleGrantOverride(agent.agentId, 24)}
                      disabled={granting === agent.agentId}
                      className="btn-primary !px-2 !py-1 !text-xs"
                    >
                      {granting === agent.agentId ? '…' : '放行 24h'}
                    </button>
                    <button
                      onClick={() => handleGrantOverride(agent.agentId, 4)}
                      disabled={granting === agent.agentId}
                      className="btn-ghost !px-2 !py-1 !text-xs"
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

      {/* 已放行的 Agent —— success 语义 */}
      {overrides.length > 0 && (
        <div>
          <h4 className="text-xs font-ui text-text-tertiary mb-2 flex items-center gap-1.5">
            <CheckCircleIcon className="w-3.5 h-3.5 text-success" />
            临时放行中 ({overrides.length})
          </h4>
          <div className="space-y-1.5">
            {overrides.map((override) => (
              <div
                key={override.agentId}
                className="flex items-center justify-between p-2 rounded-md border border-border-subtle"
                style={{ backgroundColor: 'rgba(74,222,128,0.04)' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-ui text-text-primary truncate">
                    {override.agentId}
                  </p>
                  <p className="text-xs text-text-quaternary mt-0.5">
                    剩余 {override.remainingHours} 小时
                  </p>
                </div>
                <button
                  onClick={() => handleRevokeOverride(override.agentId)}
                  className="px-2 py-1 text-xs text-danger hover:text-danger-hover rounded-sm transition-colors-fast"
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
