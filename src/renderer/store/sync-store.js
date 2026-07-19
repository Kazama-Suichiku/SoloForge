/**
 * SoloForge - 云同步状态管理 (Zustand)
 *
 * 状态契约（参考 src/shared/ipc-types.d.ts）：
 *   SyncStatus  = { configured, needsReauth?, lastSyncAt?, stats? }
 *   SyncResult  = { success, skipped?, reason?, needsReauth?, syncedAt?, stats?, errors? }
 *
 * 主进程 IPC（src/preload/preload.js sync 命名空间，不可在此修改）：
 *   window.electronAPI.sync.manualSync() → Promise<SyncResult>
 *   window.electronAPI.sync.pull()       → Promise<SyncResult>
 *   window.electronAPI.sync.push()       → Promise<SyncResult>
 *   window.electronAPI.sync.getStatus()   → Promise<{success, data?, ...透传字段}>
 *   window.electronAPI.sync.setAutoSync(enabled) → Promise<{success, autoSync}>
 *
 * 事件说明：
 *   preload 未注册任何 sync:progress / sync:complete IPC 事件（已确认源码），
 *   因此本 store 不订阅事件，改用「调用即阻塞 + 轮询刷新」策略：
 *   - triggerSync 调用 manualSync（返回时同步已完成），同步期间本地 syncing=true
 *   - 挂载时启动 30 秒慢轮询，持续刷新 syncStatus（同步后状态变化可见）
 *
 * 冲突说明：
 *   云同步采用 LWW（server_rev 比较），理论上无冲突。本 store 维护 conflicts 列表，
 *   实际语义为「最近一次同步的变更摘要」，供 ConflictDiff 组件展示「最近变更」视图。
 *
 * @module store/sync-store
 */

import { create } from 'zustand';

// ─── 慢轮询间隔（毫秒）─────────────────────────────────────────
const STATUS_POLL_INTERVAL = 30_000;

/**
 * 从 cloud-sync.js 透传返回中提取统一的 SyncStatus 形态。
 * preload 透传会把服务端字段 + configured/needsReauth 合并返回。
 * 兼容旧字段 lastSyncTime / isConfigured。
 */
function normalizeStatus(raw) {
  if (!raw) return null;
  // sync:get-status 返回 { success, configured?, needsReauth?, ...服务端字段 }
  // 也可能直接是服务端字段（无 success 包装）
  const configured = raw.configured !== undefined
    ? !!raw.configured
    : (raw.isConfigured !== undefined ? !!raw.isConfigured : true);
  const needsReauth = !!raw.needsReauth;
  // lastSyncAt 可能是 Record<string, number> 或单值 lastSyncTime
  let lastSyncAt = raw.lastSyncAt;
  if (!lastSyncAt && raw.lastSyncTime) {
    lastSyncAt = { _default: raw.lastSyncTime };
  }
  // stats 可能是对象 {conversations, messages, agents, boss, documents}
  // 也可能是 Record<string, number>
  const stats = raw.stats || undefined;
  return { configured, needsReauth, lastSyncAt, stats, _raw: raw };
}

/**
 * 从 manualSync/pull/push 返回的 SyncResult 中提取「最近变更」条目，
 * 作为 conflicts 列表（LWW 下实际是变更摘要而非冲突）。
 * 每条：{ type, op, count, detail? }
 */
function extractChanges(result) {
  const changes = [];
  if (!result) return changes;

  // pulled / pushed 子结构（cloudSync.sync() 返回 { pulled, pushed }）
  const pulled = result.pulled || null;
  const pushed = result.pushed || null;

  // pull 统计：{ conversations, messages, agents, boss, documents }
  if (pulled) {
    if (typeof pulled.conversations === 'number' && pulled.conversations > 0) {
      changes.push({ type: 'conversations', op: 'pull', count: pulled.conversations });
    }
    if (typeof pulled.messages === 'number' && pulled.messages > 0) {
      changes.push({ type: 'messages', op: 'pull', count: pulled.messages });
    }
    if (typeof pulled.agents === 'number' && pulled.agents > 0) {
      changes.push({ type: 'agents', op: 'pull', count: pulled.agents });
    }
    if (typeof pulled.boss === 'number' && pulled.boss > 0) {
      changes.push({ type: 'boss', op: 'pull', count: pulled.boss });
    }
    if (typeof pulled.documents === 'number' && pulled.documents > 0) {
      changes.push({ type: 'documents', op: 'pull', count: pulled.documents });
    }
    // 文档内容快照（若 pull 返回里带 documents 数组，保留做 diff）
    if (Array.isArray(pulled.documents) && pulled.documents.length > 0) {
      // pulled.documents 在 cloud-sync 是 number 统计；但若服务端返回数组则透传
      changes
        .filter((c) => c.type === 'documents' && c.op === 'pull')
        .forEach((c) => {
          c.detail = pulled.documents.map((d) => ({
            id: d.id,
            dataType: d.dataType,
            updatedAt: d.updatedAt,
          }));
        });
    }
  }

  // push 统计：服务端返回 result.stats 或顶层 {conversations, messages, ...}
  const pushStats = pushed?.stats || pushed || null;
  if (pushStats) {
    if (typeof pushStats.conversations === 'number' && pushStats.conversations > 0) {
      changes.push({ type: 'conversations', op: 'push', count: pushStats.conversations });
    }
    if (typeof pushStats.messages === 'number' && pushStats.messages > 0) {
      changes.push({ type: 'messages', op: 'push', count: pushStats.messages });
    }
    if (typeof pushStats.agents === 'number' && pushStats.agents > 0) {
      changes.push({ type: 'agents', op: 'push', count: pushStats.agents });
    }
    if (typeof pushStats.boss === 'number' && pushStats.boss > 0) {
      changes.push({ type: 'boss', op: 'push', count: pushStats.boss });
    }
    if (typeof pushStats.documents === 'number' && pushStats.documents > 0) {
      changes.push({ type: 'documents', op: 'push', count: pushStats.documents });
    }
  }

  return changes;
}

export const useSyncStore = create((set, get) => ({
  // ─── State ──────────────────────────────────────────────────
  /** @type {SyncStatus | null} 规范化后的同步状态 */
  syncStatus: null,
  /** 是否正在同步（本地标记，triggerSync 调用期间为 true） */
  syncing: false,
  /** 最近一次同步结果（manualSync/pull/push 的返回） */
  lastResult: null,
  /** 自动同步开关（本地镜像；实际由主进程 cloudSync 管理） */
  autoSync: false,
  /** 最近变更/冲突列表（LWW 下为变更摘要） */
  conflicts: [],
  /** 错误信息（最近一次操作失败） */
  error: null,
  /** 是否已初始化（fetchStatus 至少调用过一次） */
  initialized: false,
  /** 轮询定时器 ID（内部） */
  _pollTimer: null,

  // ─── Actions ─────────────────────────────────────────────────

  /**
   * 拉取同步状态。安全调用：失败不抛错，写入 error。
   */
  fetchStatus: async () => {
    try {
      const raw = await window.electronAPI.sync.getStatus();
      // preload 透传：{ success, configured?, needsReauth?, ...服务端字段 }
      // 兼容旧逻辑：success=false 且 needsReauth=true → 视为需重登录
      if (raw && raw.success === false) {
        // 失败但仍可能携带 needsReauth
        if (raw.needsReauth) {
          set({
            syncStatus: normalizeStatus({ configured: true, needsReauth: true }),
            error: raw.error || null,
            initialized: true,
          });
        } else {
          set({ error: raw.error || '查询同步状态失败', initialized: true });
        }
        return;
      }
      const normalized = normalizeStatus(raw);
      set({
        syncStatus: normalized,
        error: null,
        initialized: true,
        // 若服务端返回中带 autoSync 字段，同步本地镜像
        autoSync: raw.autoSync !== undefined ? !!raw.autoSync : get().autoSync,
      });
    } catch (err) {
      console.error('[sync-store] fetchStatus 失败:', err);
      set({ error: err?.message || '查询同步状态失败', initialized: true });
    }
  },

  /**
   * 手动触发完整同步（先拉后推）。
   * 同步期间 syncing=true，完成后写入 lastResult + conflicts，并刷新 status。
   * @returns {Promise<SyncResult>} 同步结果（即便失败也返回）
   */
  triggerSync: async () => {
    if (get().syncing) {
      return { success: false, skipped: true, reason: 'syncing' };
    }
    set({ syncing: true, error: null });
    try {
      const result = await window.electronAPI.sync.manualSync();
      const changes = extractChanges(result);
      set({
        lastResult: result,
        conflicts: changes,
        syncing: false,
      });
      // 同步后刷新状态（lastSyncAt 更新）
      await get().fetchStatus();
      return result;
    } catch (err) {
      console.error('[sync-store] triggerSync 失败:', err);
      const failResult = { success: false, error: err?.message || String(err) };
      set({
        lastResult: failResult,
        syncing: false,
        error: failResult.error,
      });
      return failResult;
    }
  },

  /**
   * 仅拉取远程变更。
   */
  triggerPull: async () => {
    if (get().syncing) {
      return { success: false, skipped: true, reason: 'syncing' };
    }
    set({ syncing: true, error: null });
    try {
      const result = await window.electronAPI.sync.pull();
      set({
        lastResult: result,
        conflicts: extractChanges(result),
        syncing: false,
      });
      await get().fetchStatus();
      return result;
    } catch (err) {
      console.error('[sync-store] triggerPull 失败:', err);
      const failResult = { success: false, error: err?.message || String(err) };
      set({ lastResult: failResult, syncing: false, error: failResult.error });
      return failResult;
    }
  },

  /**
   * 仅推送本地变更。
   */
  triggerPush: async () => {
    if (get().syncing) {
      return { success: false, skipped: true, reason: 'syncing' };
    }
    set({ syncing: true, error: null });
    try {
      const result = await window.electronAPI.sync.push();
      set({
        lastResult: result,
        conflicts: extractChanges(result),
        syncing: false,
      });
      await get().fetchStatus();
      return result;
    } catch (err) {
      console.error('[sync-store] triggerPush 失败:', err);
      const failResult = { success: false, error: err?.message || String(err) };
      set({ lastResult: failResult, syncing: false, error: failResult.error });
      return failResult;
    }
  },

  /**
   * 开关自动同步。调用主进程 setAutoSync，成功后更新本地镜像。
   */
  toggleAutoSync: async (enabled) => {
    const want = !!enabled;
    // 乐观更新
    set({ autoSync: want });
    try {
      const r = await window.electronAPI.sync.setAutoSync(want);
      if (r && r.success) {
        set({ autoSync: !!r.autoSync });
      } else {
        // 失败回滚
        set({ autoSync: !want, error: r?.error || '设置自动同步失败' });
      }
    } catch (err) {
      console.error('[sync-store] toggleAutoSync 失败:', err);
      set({ autoSync: !want, error: err?.message || '设置自动同步失败' });
    }
  },

  /**
   * 清空 conflicts（最近变更列表）。
   */
  clearConflicts: () => set({ conflicts: [] }),

  /**
   * 清空 error。
   */
  clearError: () => set({ error: null }),

  /**
   * 启动状态慢轮询。应在组件挂载时调用一次。
   * 幂等：重复调用不会叠加定时器。
   */
  startPolling: () => {
    const get_ = get;
    if (get_()._pollTimer) return;
    // 首次立即拉一次
    get_().fetchStatus();
    const timer = setInterval(() => {
      // 同步中跳过轮询，避免与 triggerSync 的 fetchStatus 重复
      if (!get_().syncing) {
        get_().fetchStatus();
      }
    }, STATUS_POLL_INTERVAL);
    set({ _pollTimer: timer });
  },

  /**
   * 停止轮询。应在组件卸载时调用。
   */
  stopPolling: () => {
    const timer = get()._pollTimer;
    if (timer) {
      clearInterval(timer);
      set({ _pollTimer: null });
    }
  },
}));

export { extractChanges, normalizeStatus };
