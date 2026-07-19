/**
 * SoloForge - 同步主面板
 *
 * 四种状态展示逻辑（由 sync-store 派生）：
 *   1. syncing        → 显示 SyncProgressBar + 禁用按钮
 *   2. success/idle   → 显示上次同步时间 + 统计 + 同步/自动同步开关 + 最近变更
 *   3. failure        → 显示错误信息（lastResult.success === false 或 error 非空）
 *   4. needsReauth   → 显示 LoginDialog（syncStatus.needsReauth === true）
 *
 * 状态判定优先级：needsReauth > syncing > error > configured > 默认。
 * 未配置（configured=false）时展示引导文案（不弹 LoginDialog，因为可能未登录）。
 *
 * Linear 风格：.panel 容器 + 状态圆点（绿=已同步 / 橙=同步中 / 红=失败）。
 *
 * @module components/sync/SyncPanel
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowPathIcon,
  CloudIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useSyncStore } from '../../store/sync-store';
import SyncProgressBar from './SyncProgressBar';
import ConflictDiff from './ConflictDiff';
import LoginDialog from './LoginDialog';

// ─── 时间格式化 ─────────────────────────────────────────────
function formatLastSync(lastSyncAt) {
  if (!lastSyncAt) return '从未同步';
  // lastSyncAt 可能是 { _default: ts } 或 { conversations, messages, ... }
  let ts = null;
  if (typeof lastSyncAt === 'number') ts = lastSyncAt;
  else if (typeof lastSyncAt === 'object') {
    const vals = Object.values(lastSyncAt).filter((v) => typeof v === 'number');
    if (vals.length > 0) ts = Math.max(...vals);
  }
  if (!ts) return '从未同步';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '从未同步';
  const now = Date.now();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleString();
}

// ─── 状态圆点 ──────────────────────────────────────────────
/** 状态圆点：绿=已同步 / 橙=同步中 / 红=失败 / 灰=未配置 / 琥珀=需重登 */
function StatusDot({ variant }) {
  const colorMap = {
    synced: 'var(--color-success)',
    syncing: 'var(--color-warning)',
    error: 'var(--color-danger)',
    unconfigured: 'var(--text-quaternary)',
    reauth: 'var(--color-warning)',
  };
  const color = colorMap[variant] || colorMap.unconfigured;
  const extra = variant === 'syncing' ? 'animate-pulse' : '';
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${extra}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

// ─── 统计展示 ──────────────────────────────────────────────
function StatsGrid({ stats }) {
  if (!stats) return null;
  const items = [
    { key: 'conversations', label: '会话' },
    { key: 'messages', label: '消息' },
    { key: 'agents', label: 'Agent' },
    { key: 'boss', label: 'Boss' },
    { key: 'documents', label: '文档' },
  ].filter((it) => typeof stats[it.key] === 'number');

  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {items.map((it) => (
        <div
          key={it.key}
          className="card !p-2 flex flex-col items-center justify-center"
        >
          <span className="text-base font-ui text-text-primary leading-tight">
            {stats[it.key]}
          </span>
          <span className="text-xs text-text-tertiary">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── 主面板 ────────────────────────────────────────────────
/**
 * @param {Object} props
 * @param {boolean} [props.embedded=false] - 是否内嵌（true：不渲染固定容器阴影；false：浮窗）
 * @param {Function} [props.onClose] - 关闭回调（浮窗模式）
 * @param {string} [props.className]
 */
export default function SyncPanel({ embedded = false, onClose, className = '' }) {
  const {
    syncStatus,
    syncing,
    lastResult,
    autoSync,
    conflicts,
    error,
    initialized,
    fetchStatus,
    triggerSync,
    toggleAutoSync,
    clearConflicts,
    startPolling,
    stopPolling,
  } = useSyncStore();

  const [loginOpen, setLoginOpen] = useState(false);

  // 挂载时启动轮询 + 拉一次状态
  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // needsReauth 时自动弹 LoginDialog
  useEffect(() => {
    if (syncStatus?.needsReauth) setLoginOpen(true);
    else setLoginOpen(false);
  }, [syncStatus?.needsReauth]);

  const handleSync = useCallback(() => {
    triggerSync();
  }, [triggerSync]);

  const handleLoginSuccess = useCallback(() => {
    setLoginOpen(false);
    fetchStatus();
  }, [fetchStatus]);

  // ─── 状态判定 ─────────────────────────────────────────────
  const needsReauth = !!syncStatus?.needsReauth;
  const isConfigured = !!syncStatus?.configured;
  const isSyncing = syncing;
  const hasError = !!error || (lastResult && lastResult.success === false && !lastResult.skipped);
  const skippedReason = lastResult?.skipped ? lastResult.reason : null;

  // 状态圆点 + 文案
  let dotVariant = 'synced';
  let statusLabel = '已同步';
  let statusLabelCls = 'text-text-secondary';
  if (needsReauth) {
    dotVariant = 'reauth';
    statusLabel = '需要重新登录';
    statusLabelCls = 'text-warning';
  } else if (isSyncing) {
    dotVariant = 'syncing';
    statusLabel = '同步中...';
  } else if (hasError) {
    dotVariant = 'error';
    statusLabel = '同步失败';
    statusLabelCls = 'text-danger';
  } else if (!isConfigured) {
    dotVariant = 'unconfigured';
    statusLabel = '未配置';
  }

  // ─── 容器样式 ─────────────────────────────────────────────
  const containerCls = embedded
    ? `flex flex-col gap-3 p-0 ${className}`
    : `panel flex flex-col gap-3 p-4 w-80 shadow-dialog ${className}`;

  return (
    <div className={containerCls} role="region" aria-label="云同步">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-ui text-text-primary flex items-center gap-2">
          <CloudIcon className="w-4 h-4 text-accent" aria-hidden="true" />
          云同步
        </h2>
        {!embedded && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            aria-label="关闭"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 状态行：圆点 + 文字 */}
      <div className="flex items-center gap-2 text-sm">
        <StatusDot variant={dotVariant} />
        <span className={statusLabelCls}>{statusLabel}</span>
      </div>

      {/* 上次同步时间 */}
      <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
        <span>上次同步：{formatLastSync(syncStatus?.lastSyncAt)}</span>
      </div>

      {/* 同步进度条（syncing 时显示） */}
      <SyncProgressBar active={isSyncing} />

      {/* 错误信息（失败状态） */}
      {hasError && (
        <div
          className="text-xs text-danger rounded-md px-2 py-1.5 break-words"
          style={{
            backgroundColor: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.2)',
          }}
        >
          {error || lastResult?.error || '未知错误'}
          {skippedReason && (
            <span className="block mt-1 text-text-tertiary">跳过原因：{skippedReason}</span>
          )}
        </div>
      )}

      {/* 未配置提示 */}
      {!isConfigured && !needsReauth && initialized && (
        <div className="card !py-1.5 text-xs text-text-tertiary">
          云同步尚未配置。登录云账号后自动启用。
        </div>
      )}

      {/* 需重新登录提示 + 按钮 */}
      {needsReauth && (
        <div className="flex flex-col gap-2">
          <div
            className="text-xs text-warning rounded-md px-2 py-1.5"
            style={{
              backgroundColor: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.2)',
            }}
          >
            登录已过期或无效，请重新登录以恢复云同步。
          </div>
          <button type="button" onClick={() => setLoginOpen(true)} className="btn-primary text-xs self-start">
            重新登录
          </button>
        </div>
      )}

      {/* 统计（成功/已配置状态） */}
      {isConfigured && !needsReauth && syncStatus?.stats && (
        <StatsGrid stats={syncStatus.stats} />
      )}

      {/* 操作按钮区 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSync}
          disabled={isSyncing || needsReauth}
          className="btn-primary flex-1"
          aria-label="手动同步"
        >
          <ArrowPathIcon className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {isSyncing ? '同步中' : '立即同步'}
        </button>

        {/* 自动同步开关 */}
        <label
          className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none"
          title={autoSync ? '点击关闭自动同步' : '点击开启自动同步'}
        >
          <span className="relative inline-flex items-center">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => toggleAutoSync(e.target.checked)}
              disabled={needsReauth || !isConfigured}
              className="sr-only peer"
            />
            <span
              className="w-9 h-5 rounded-full border border-border-default transition-colors peer-checked:border-transparent"
              style={{ backgroundColor: autoSync ? 'var(--accent)' : 'var(--bg-surface)' }}
            />
            <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
          </span>
          自动
        </label>
      </div>

      {/* 最近变更 / 冲突 diff */}
      {(conflicts.length > 0) && (
        <ConflictDiff
          conflicts={conflicts}
          onClear={clearConflicts}
          className="border-t border-border-default pt-3"
        />
      )}

      {/* 登录弹窗（needsReauth 或手动触发） */}
      <LoginDialog
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={handleLoginSuccess}
      />
    </div>
  );
}
