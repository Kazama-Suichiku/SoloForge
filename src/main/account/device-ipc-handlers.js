/**
 * SoloForge - 设备管理 IPC 处理器
 *
 * 注册的通道（均在 preload.js 的 electronAPI.device 命名空间暴露）：
 *   device:get-current → deviceManager.getCurrentDevice()  返回当前设备信息
 *   device:list        → deviceManager.fetchDevices()       返回设备列表
 *   device:rename      → deviceManager.setDeviceName(name)  设置当前设备名
 *   device:remove      → deviceManager.removeDevice(id)     注销指定设备
 *
 * 所有 handler 均用 safeHandler 包装，统一错误处理与返回格式：
 *   - handler 返回 { success, ... } 格式时，safeHandler 原样透传并注入 traceId
 *   - handler 抛异常时，safeHandler 返回 { success:false, error, code, traceId }
 *
 * 注册时机：
 *   应在 app.whenReady() 中调用，与 setupSyncIpcHandlers 同时机。
 *   集成点：在 src/main/ipc-bootstrap.js 的 registerGlobalIpcHandlers() 中，
 *   紧跟 setupSyncIpcHandlers() 之后调用 setupDeviceIpcHandlers()。
 *   （本任务不修改 ipc-bootstrap.js，留作集成说明，由负责主进程整合的任务接入。）
 *
 * @module account/device-ipc-handlers
 */

'use strict';

const { ipcMain } = require('electron');
const { deviceManager } = require('./device-manager');
const { safeHandler } = require('../utils/safe-handler');

/**
 * 注册设备管理 IPC handler
 * 幂等：重复调用安全（ipcMain.handle 对同一通道重复注册会抛错，
 * 这里用 try/catch 兜底，便于在测试或热重载场景下多次调用）。
 */
function setupDeviceIpcHandlers() {
  // ─── device:get-current → 返回当前设备信息 ─────────────────────
  // 返回 { success, device: { deviceId, deviceName, deviceType, userId, isCurrent } | null, error? }
  _register('device:get-current',
    safeHandler(async () => {
      return await deviceManager.getCurrentDevice();
    }, { channel: 'device:get-current' })
  );

  // ─── device:list → 返回设备列表 ──────────────────────────────
  // 返回 { success, devices: Array<{ deviceId, deviceName, deviceType, lastSyncAt, created_at, isCurrent }> }
  // 方案B：远端 /devices 端点未就绪时，devices 只含当前设备
  _register('device:list',
    safeHandler(async () => {
      return await deviceManager.fetchDevices();
    }, { channel: 'device:list' })
  );

  // ─── device:rename → 设置当前设备名 ──────────────────────────
  // 参数：(_event, name: string)
  // 返回 { success, deviceName?, error? }
  _register('device:rename',
    safeHandler(async (_event, name) => {
      return await deviceManager.setDeviceName(name);
    }, { channel: 'device:rename' })
  );

  // ─── device:remove → 注销指定设备 ────────────────────────────
  // 参数：(_event, deviceId: string)
  // 返回 { success, error? }（不允许注销当前设备，返回错误）
  _register('device:remove',
    safeHandler(async (_event, deviceId) => {
      return await deviceManager.removeDevice(deviceId);
    }, { channel: 'device:remove' })
  );
}

/**
 * 安全注册 ipcMain.handle，通道重复注册时只记录 warn，不抛错
 */
function _register(channel, wrapped) {
  try {
    ipcMain.handle(channel, wrapped);
  } catch (err) {
    // 重复注册（开发热重载场景）——忽略并记录
    if (err && /attempting to register a second handler/i.test(err.message)) {
      // 静默忽略；已注册的 handler 仍然有效
    } else {
      throw err;
    }
  }
}

module.exports = { setupDeviceIpcHandlers };
