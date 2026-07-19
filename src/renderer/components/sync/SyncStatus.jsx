import React, { useState, useEffect } from 'react';
import { ArrowPathIcon, CloudIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';

export default function SyncStatus() {
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 10000); // 每 10 秒更新状态
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const result = await window.electronAPI.sync.getStatus();
      // sync:get-status 返回 { success, configured, needsReauth, ...服务端字段 }
      // 旧组件逻辑依赖 status.isLoggedIn，而云同步服务返回的是 configured/isConfigured，
      // 这里做兼容：configured=true 且非 needsReauth 视为已登录可用。
      if (result?.success) {
        setStatus({
          ...result,
          isLoggedIn: result.configured && !result.needsReauth,
          syncing: result.syncing || false,
          lastSyncTime: result.lastSyncTime,
        });
      } else if (result?.needsReauth) {
        setStatus({ isLoggedIn: false, needsReauth: true });
      }
    } catch (err) {
      console.error('加载同步状态失败:', err);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      await window.electronAPI.sync.manualSync();
      await loadStatus();
    } catch (err) {
      console.error('手动同步失败:', err);
    } finally {
      setSyncing(false);
    }
  };

  if (!status || !status.isLoggedIn) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
      <CloudIcon className="w-4 h-4" />
      
      {status.syncing ? (
        <span className="flex items-center gap-1">
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
          同步中...
        </span>
      ) : status.lastSyncTime ? (
        <span className="flex items-center gap-1">
          <CheckCircleIcon className="w-4 h-4 text-green-500" />
          {new Date(status.lastSyncTime).toLocaleTimeString()}
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <ExclamationCircleIcon className="w-4 h-4 text-yellow-500" />
          未同步
        </span>
      )}

      <button
        onClick={handleManualSync}
        disabled={syncing || status.syncing}
        className="ml-2 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded
                 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        手动同步
      </button>
    </div>
  );
}
