/**
 * SoloForge - 同步状态轻量指示器
 *
 * 设计：小圆点 + 文字，适合放在标题栏 / 侧边栏。
 * 点击展开 SyncPanel（浮窗模式，fixed 定位）。
 *
 * 状态显示规则（派生自 sync-store）：
 *   syncing       → 橙色脉冲圆点 + "同步中"
 *   needsReauth   → 琥珀色圆点 + "需登录"
 *   error/failed  → 红色圆点 + "同步失败"
 *   configured    → 绿色圆点 + 上次同步相对时间
 *   未配置         → 灰色圆点 + "未配置"（点击展开面板引导登录）
 *
 * 旧组件通过轮询 window.electronAPI.sync.getStatus 自管状态；本重写改用 sync-store
 * 单一数据源，避免与 SyncPanel 重复请求。挂载时启动 store 轮询。
 *
 * Linear 风格：紧凑圆点指示器。
 * @module components/sync/SyncStatus
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSyncStore } from '../../store/sync-store';
import SyncPanel from './SyncPanel';

// ─── 相对时间格式化（轻量） ─────────────────────────────────
function relativeTime(lastSyncAt) {
  if (!lastSyncAt) return '未同步';
  let ts = null;
  if (typeof lastSyncAt === 'number') ts = lastSyncAt;
  else if (typeof lastSyncAt === 'object') {
    const vals = Object.values(lastSyncAt).filter((v) => typeof v === 'number');
    if (vals.length > 0) ts = Math.max(...vals);
  }
  if (!ts) return '未同步';
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}天前`;
  return new Date(ts).toLocaleDateString();
}

/** 状态圆点 */
function Dot({ variant }) {
  const colorMap = {
    synced: 'var(--color-success)',
    syncing: 'var(--color-warning)',
    error: 'var(--color-danger)',
    reauth: 'var(--color-warning)',
    unconfigured: 'var(--text-quaternary)',
  };
  const color = colorMap[variant] || colorMap.unconfigured;
  const pulse = variant === 'syncing' ? 'animate-pulse' : '';
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${pulse}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

/**
 * @param {Object} props
 * @param {boolean} [props.compact=false] - 紧凑模式：仅圆点，无文字
 * @param {string} [props.className]
 * @param {'right'|'left'|'center'} [props.panelAlign='right'] - 浮窗水平对齐
 */
export default function SyncStatus({ compact = false, className = '', panelAlign = 'right' }) {
  const {
    syncStatus,
    syncing,
    error,
    lastResult,
    startPolling,
    stopPolling,
  } = useSyncStore();

  const [panelOpen, setPanelOpen] = useState(false);
  const containerRef = useRef(null);

  // 挂载时启动轮询（store 内部幂等）
  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // 点击外部关闭浮窗
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [panelOpen]);

  const togglePanel = useCallback(() => setPanelOpen((v) => !v), []);

  // ─── 状态派生 ─────────────────────────────────────────────
  const needsReauth = !!syncStatus?.needsReauth;
  const isConfigured = !!syncStatus?.configured;
  const hasError = !!error || (lastResult && lastResult.success === false && !lastResult.skipped);

  let variant = 'unconfigured';
  let label = '未配置';
  let labelCls = 'text-text-tertiary';

  if (needsReauth) {
    variant = 'reauth';
    label = '需登录';
    labelCls = 'text-warning';
  } else if (syncing) {
    variant = 'syncing';
    label = '同步中';
    labelCls = 'text-text-secondary';
  } else if (hasError) {
    variant = 'error';
    label = '同步失败';
    labelCls = 'text-danger';
  } else if (isConfigured) {
    variant = 'synced';
    label = relativeTime(syncStatus?.lastSyncAt);
    labelCls = 'text-text-secondary';
  }

  // ─── 浮窗定位 ─────────────────────────────────────────────
  const alignCls =
    panelAlign === 'left' ? 'left-0' :
    panelAlign === 'center' ? 'left-1/2 -translate-x-1/2' :
    'right-0';

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={togglePanel}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs
                   hover:bg-bg-hover transition-colors
                   focus:outline-none focus:ring-2 focus:ring-accent"
        aria-label={`云同步：${label}（点击${panelOpen ? '关闭' : '展开'}面板）`}
        aria-expanded={panelOpen}
      >
        <Dot variant={variant} />
        {!compact && (
          <span className={labelCls}>{label}</span>
        )}
      </button>

      {panelOpen && (
        <div
          className={`absolute top-full mt-1 ${alignCls} z-50`}
          role="dialog"
          aria-label="云同步面板"
        >
          <SyncPanel onClose={() => setPanelOpen(false)} />
        </div>
      )}
    </div>
  );
}
