/**
 * SoloForge - 设备管理 UI 组件（设置页子组件）
 *
 * 功能：
 *   - 显示当前设备（名、类型、ID、登录状态）
 *   - 重命名当前设备（输入框 + 保存按钮，Enter/Esc 确认/取消）
 *   - 设备列表表格（设备名 / 类型 / 最后同步时间 / 操作）
 *   - 注销其他设备（按钮 + 二次确认）
 *   - 远端列表为空时显示"等待 Worker 设备端点"占位（方案B）
 *
 * 数据来源：
 *   - 当前设备：window.electronAPI.device.getCurrent() → device:get-current
 *   - 设备列表：window.electronAPI.device.list()       → device:list
 *   - 重命名：  window.electronAPI.device.rename(name)   → device:rename
 *   - 注销：    window.electronAPI.device.remove(id)      → device:remove
 *
 * 组件设计为可独立嵌入设置页的子区域（不耦合 Settings.jsx 的其他 state），
 * 父组件只需 <DeviceManager /> 即可使用。
 *
 * @module renderer/components/settings/DeviceManager
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 格式化时间戳为本地可读时间
 * @param {number|null|undefined} ts - 毫秒时间戳
 * @returns {string}
 */
function formatTime(ts) {
  if (!ts || typeof ts !== 'number') return '—';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  } catch {
    return '—';
  }
}

/**
 * 设备类型显示图标（当前只支持 desktop，未来可扩展）
 */
function DeviceTypeIcon({ type }) {
  const t = (type || 'desktop').toLowerCase();
  const emoji = t === 'mobile' || t === 'phone' ? '📱'
    : t === 'tablet' ? '📲'
    : t === 'web' ? '🌐'
    : '💻'; // desktop / unknown
  return <span className="text-lg" title={t}>{emoji}</span>;
}

/**
 * 设备管理组件
 */
export default function DeviceManager() {
  // ─── 当前设备 ──────────────────────────────────────────────
  const [currentDevice, setCurrentDevice] = useState(null); // { deviceId, deviceName, deviceType, userId, isCurrent }
  const [currentLoading, setCurrentLoading] = useState(true);
  const [currentError, setCurrentError] = useState(null);

  // ─── 设备列表 ──────────────────────────────────────────────
  const [devices, setDevices] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  // ─── 重命名 ────────────────────────────────────────────────
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState(null);
  const renameInputRef = useRef(null);

  // ─── 注销 ──────────────────────────────────────────────────
  const [removingId, setRemovingId] = useState(null); // 正在注销的 deviceId（用于确认 + loading）
  const [removeError, setRemoveError] = useState(null);

  // ─── 数据加载 ──────────────────────────────────────────────
  const loadCurrent = useCallback(async () => {
    setCurrentLoading(true);
    setCurrentError(null);
    try {
      const res = await window.electronAPI.device.getCurrent();
      if (res?.success && res.device) {
        setCurrentDevice(res.device);
      } else {
        setCurrentDevice(null);
        // 当前设备尚未初始化不算严重错误，仅作为提示
        setCurrentError(res?.error || '当前设备未初始化');
      }
    } catch (err) {
      setCurrentError(err.message || '加载当前设备失败');
    } finally {
      setCurrentLoading(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await window.electronAPI.device.list();
      if (res?.success && Array.isArray(res.devices)) {
        setDevices(res.devices);
      } else {
        setDevices([]);
        setListError(res?.error || '获取设备列表失败');
      }
    } catch (err) {
      setListError(err.message || '获取设备列表失败');
    } finally {
      setListLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    loadCurrent();
    loadList();
  }, [loadCurrent, loadList]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ─── 重命名交互 ─────────────────────────────────────────────
  const startRename = useCallback(() => {
    setRenameValue(currentDevice?.deviceName || '');
    setRenameError(null);
    setRenaming(true);
    // focus 在下一帧，确保 input 已渲染
    requestAnimationFrame(() => renameInputRef.current?.focus());
  }, [currentDevice]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
    setRenameValue('');
    setRenameError(null);
  }, []);

  const submitRename = useCallback(async () => {
    const name = renameValue.trim();
    if (!name) {
      setRenameError('设备名不能为空');
      return;
    }
    if (name.length > 64) {
      setRenameError('设备名不能超过 64 个字符');
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    try {
      const res = await window.electronAPI.device.rename(name);
      if (res?.success) {
        // 更新当前设备的 deviceName（无需重新拉取）
        setCurrentDevice((d) => (d ? { ...d, deviceName: res.deviceName || name } : d));
        setDevices((list) =>
          list.map((d) =>
            d.isCurrent ? { ...d, deviceName: res.deviceName || name } : d
          )
        );
        setRenaming(false);
        setRenameValue('');
      } else {
        setRenameError(res?.error || '保存失败');
      }
    } catch (err) {
      setRenameError(err.message || '保存失败');
    } finally {
      setRenameSaving(false);
    }
  }, [renameValue]);

  const handleRenameKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRename();
      }
    },
    [submitRename, cancelRename]
  );

  // ─── 注销交互 ──────────────────────────────────────────────
  const handleRemove = useCallback(async (deviceId) => {
    setRemoveError(null);
    setRemovingId(deviceId);
    try {
      const res = await window.electronAPI.device.remove(deviceId);
      if (res?.success) {
        // 本地从列表移除
        setDevices((list) => list.filter((d) => d.deviceId !== deviceId));
        setRemovingId(null);
      } else {
        setRemoveError(res?.error || '注销失败');
        setRemovingId(null);
      }
    } catch (err) {
      setRemoveError(err.message || '注销失败');
      setRemovingId(null);
    }
  }, []);

  const cancelRemove = useCallback(() => {
    setRemovingId(null);
    setRemoveError(null);
  }, []);

  // ─── 渲染 ───────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* 当前设备卡片 */}
      <div className="bg-bg-elevated rounded-xl shadow-sm border border-[var(--border-color)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-text-primary">当前设备</h3>
          <button
            onClick={reload}
            disabled={currentLoading || listLoading}
            className="text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
            title="重新加载"
          >
            ↻ 刷新
          </button>
        </div>

        {currentLoading ? (
          <div className="text-text-secondary py-4">加载中…</div>
        ) : currentDevice ? (
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <DeviceTypeIcon type={currentDevice.deviceType} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {renaming ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        maxLength={64}
                        disabled={renameSaving}
                        placeholder="输入设备名（如：公司 Mac）"
                        className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-[var(--color-primary)] bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
                      />
                      <button
                        onClick={submitRename}
                        disabled={renameSaving}
                        className="px-3 py-1.5 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
                      >
                        {renameSaving ? '保存中…' : '保存'}
                      </button>
                      <button
                        onClick={cancelRename}
                        disabled={renameSaving}
                        className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <span className="text-lg font-semibold text-text-primary">
                        {currentDevice.deviceName || (
                          <span className="text-text-muted italic">未命名设备</span>
                        )}
                      </span>
                      <button
                        onClick={startRename}
                        className="text-text-muted hover:text-[var(--color-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
                        title="重命名"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {renameError && (
                  <div className="mt-2 text-sm text-[var(--color-danger)]">{renameError}</div>
                )}

                <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <dt className="text-text-muted">设备 ID</dt>
                    <dd className="text-text-secondary font-mono truncate" title={currentDevice.deviceId}>
                      {currentDevice.deviceId}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="text-text-muted">类型</dt>
                    <dd className="text-text-secondary">{currentDevice.deviceType}</dd>
                  </div>
                  {currentDevice.userId && (
                    <div className="flex items-center gap-2">
                      <dt className="text-text-muted">账号</dt>
                      <dd className="text-text-secondary font-mono truncate" title={currentDevice.userId}>
                        {currentDevice.userId}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-4">
            <div className="text-sm text-[var(--color-warning)] mb-1">
              {currentError || '当前设备未初始化'}
            </div>
            <div className="text-sm text-text-secondary">
              请先登录云端账号以生成设备 ID 并启用设备管理。
            </div>
          </div>
        )}
      </div>

      {/* 设备列表 */}
      <div className="bg-bg-elevated rounded-xl shadow-sm border border-[var(--border-color)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-text-primary">设备列表</h3>
          <span className="text-sm text-text-secondary">{devices.length} 台设备</span>
        </div>

        {listLoading ? (
          <div className="text-text-secondary py-4">加载中…</div>
        ) : listError ? (
          <div className="py-4 text-sm text-[var(--color-danger)]">{listError}</div>
        ) : devices.length === 0 ? (
          <div className="py-6 text-center">
            <div className="text-sm text-text-secondary mb-1">暂无设备</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-[var(--border-color)]">
                  <th className="py-2 pr-4 font-medium">设备名</th>
                  <th className="py-2 pr-4 font-medium">类型</th>
                  <th className="py-2 pr-4 font-medium">设备 ID</th>
                  <th className="py-2 pr-4 font-medium">最后同步</th>
                  <th className="py-2 pr-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const isCurrent = !!d.isCurrent;
                  const isConfirming = removingId === d.deviceId;
                  return (
                    <tr key={d.deviceId} className="border-b border-[var(--border-color)] last:border-0">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <DeviceTypeIcon type={d.deviceType} />
                          <span className="text-text-primary">
                            {d.deviceName || (
                              <span className="text-text-muted italic">未命名</span>
                            )}
                          </span>
                          {isCurrent && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                              当前
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-text-secondary">{d.deviceType || '—'}</td>
                      <td className="py-3 pr-4 text-text-secondary font-mono truncate max-w-[12rem]" title={d.deviceId}>
                        {d.deviceId}
                      </td>
                      <td className="py-3 pr-4 text-text-secondary">{formatTime(d.lastSyncAt)}</td>
                      <td className="py-3 pr-4 text-right">
                        {isCurrent ? (
                          <span className="text-text-muted text-xs">—</span>
                        ) : isConfirming ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-xs text-[var(--color-warning)]">确认注销？</span>
                            <button
                              onClick={() => handleRemove(d.deviceId)}
                              className="text-xs px-2 py-1 bg-[var(--color-danger)] text-white rounded hover:bg-[var(--color-danger-hover)]"
                            >
                              确认
                            </button>
                            <button
                              onClick={cancelRemove}
                              className="text-xs px-2 py-1 text-text-secondary hover:text-text-primary"
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setRemovingId(d.deviceId)}
                            className="text-xs px-2 py-1 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 rounded transition-colors"
                          >
                            注销
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {removeError && (
          <div className="mt-3 text-sm text-[var(--color-danger)]">{removeError}</div>
        )}

        {/* 方案B 占位提示：当列表只有当前设备且无远端数据时，提示 Worker 端点待就绪 */}
        {!listLoading && !listError && devices.length <= 1 && (
          <div className="mt-4 px-3 py-2 rounded-lg bg-[var(--bg-muted)] text-sm text-text-secondary">
            {devices.length === 1
              ? 'ℹ️ 远端设备列表正在等待 Cloudflare Worker 的 /devices 端点就绪（方案B 占位）。届时此处将显示你的其他设备。'
              : 'ℹ️ 尚未检测到任何设备。登录云端账号后此处将显示当前设备。'}
          </div>
        )}
      </div>
    </div>
  );
}
