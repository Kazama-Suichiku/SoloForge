/**
 * SoloForge - 云同步 IPC 处理器
 * 驱动 cloud-sync.js（Cloudflare Workers 后端），桥接渲染进程与云同步服务。
 *
 * 注册的通道：
 *   sync:manual-sync   → cloudSync.sync()         手动触发完整同步（先拉后推）
 *   sync:pull          → cloudSync.pull()          仅拉取远程变更
 *   sync:push          → cloudSync.push()          仅推送本地变更
 *   sync:get-status    → cloudSync.getStatus()    查询同步状态
 *   sync:set-auto-sync → cloudSync.startAutoSync / stopAutoSync
 *
 * 不在此注册的通道（登录/注册/登出走 account 模块）：
 *   sync:login / sync:register / sync:logout
 *   → 由 account-ipc-handlers.js 处理（account:login / account:register / account:logout）
 *     account handler 在登录成功后已经调用 cloudSync.configure + startAutoSync，
 *     因此渲染进程无需在登录后再单独触发云同步初始化。
 *
 * token 缺失/过期语义：
 *   cloud-sync.js 的 pull/push/getStatus 在 token 缺失或 401/403 时返回
 *   {skipped:true, reason:'no-token'|'unauthorized'|'forbidden'} 或 {needsReauth:true}。
 *   本文件将这些返回值透传给渲染进程（在 safeHandler 之外补一个 success 字段，
 *   使 safeHandler 不再二次包装，渲染进程可直接读取 skipped/needsReauth 字段）。
 *
 * @module sync/sync-ipc-handlers
 */
const { ipcMain } = require('electron');
const { cloudSync } = require('./cloud-sync');
const { safeHandler } = require('../utils/safe-handler');

/**
 * 注册云同步 IPC handler
 * 应在 app.whenReady() 中调用（与 setupAccountIpcHandlers 同时机）。
 */
function setupSyncIpcHandlers() {
  // ─── 手动同步：完整 sync（先拉后推）─────────────────────────
  // cloudSync.sync() 已返回 {success, pulled, pushed} 或 {success:false, skipped, reason}
  ipcMain.handle(
    'sync:manual-sync',
    safeHandler(async () => {
      return await cloudSync.sync();
    }, { channel: 'sync:manual-sync' })
  );

  // ─── 拉取远程变更 ──────────────────────────────────────────
  // 返回 {skipped, reason}（token 缺失/401/403）或合并统计 {conversations, messages, agents, boss}
  ipcMain.handle(
    'sync:pull',
    safeHandler(async () => {
      const r = await cloudSync.pull();
      if (r && r.skipped) {
        return { success: false, ...r };
      }
      return { success: true, ...r };
    }, { channel: 'sync:pull' })
  );

  // ─── 推送本地变更 ──────────────────────────────────────────
  // 返回 {skipped, reason} 或推送统计
  ipcMain.handle(
    'sync:push',
    safeHandler(async () => {
      const r = await cloudSync.push();
      if (r && r.skipped) {
        return { success: false, ...r };
      }
      return { success: true, ...r };
    }, { channel: 'sync:push' })
  );

  // ─── 查询同步状态 ──────────────────────────────────────────
  // 返回 {configured:false} | {configured:true, needsReauth:true} | 服务端状态对象 | {error}
  ipcMain.handle(
    'sync:get-status',
    safeHandler(async () => {
      const r = await cloudSync.getStatus();
      if (r && r.error) {
        return { success: false, error: r.error };
      }
      // 透传 configured / needsReauth / 服务端字段
      return { success: true, ...r };
    }, { channel: 'sync:get-status' })
  );

  // ─── 开关自动同步 ──────────────────────────────────────────
  // 注意：startAutoSync 内部会检查 token/needsReauth，token 缺失时不会启动轮询
  // 并会通过 notifyListeners 发出 reauth-required 事件（目前仅主进程监听器消费）。
  ipcMain.handle(
    'sync:set-auto-sync',
    safeHandler(async (_event, enabled) => {
      if (enabled) {
        cloudSync.startAutoSync();
      } else {
        cloudSync.stopAutoSync();
      }
      return { success: true, autoSync: !!enabled };
    }, { channel: 'sync:set-auto-sync' })
  );
}

module.exports = { setupSyncIpcHandlers };
