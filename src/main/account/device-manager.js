/**
 * SoloForge - 设备管理模块（主进程）
 *
 * 提供"当前设备"管理能力：
 *   - 读取当前 deviceId（来源：cloud-sync 的配置文件 cloud-sync-config.json）
 *   - 设置/读取当前设备的可读名称（存到本地 device-manager-config.json）
 *   - 拉取远端设备列表（方案B 占位：Worker 尚未提供 /devices 端点，返回空数组 + TODO）
 *   - 注销远端设备（方案B 占位：仅本地标记 + TODO）
 *
 * 设计约束：
 *   - 不 require cloud-sync.js（避免潜在的初始化时序/循环依赖问题）。
 *     deviceId 通过直接读取 cloud-sync 写入的配置文件获得，路径与 cloud-sync 保持一致：
 *       path.join(app.getPath('userData'), 'cloud-sync-config.json')
 *     该文件由 cloud-sync 在 initialize/loadConfig/saveConfig 时读写，结构：
 *       { syncUrl, userId, deviceId, lastSyncAt }
 *   - 远端设备列表与远程注销需要 Worker 端 /devices 端点（由批次2另一个任务添加）。
 *     本模块在 fetchDevices / removeDevice 中留出清晰的对接点，等 Worker 端点就绪后
 *     只需在这两个方法内补充 HTTP 调用，无需改动 IPC handler 或 UI。
 *
 * @module account/device-manager
 */

'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { accountStore } = require('./account-store');

/**
 * cloud-sync 写入的配置文件路径（与 cloud-sync.js 的 this.configPath 一致）
 */
function getCloudSyncConfigPath() {
  return path.join(app.getPath('userData'), 'cloud-sync-config.json');
}

/**
 * 设备管理自有的本地配置文件路径（存放设备别名等）
 */
function getDeviceManagerConfigPath() {
  return path.join(app.getPath('userData'), 'device-manager-config.json');
}

/**
 * 默认设备类型（与 cloud-sync push 时的 deviceType:'desktop' 保持一致）
 */
const DEFAULT_DEVICE_TYPE = 'desktop';

/**
 * 设备管理器
 *
 * 所有方法均返回 { success, ... } 形式，便于被 safeHandler 透传或包装。
 * 方法本身不抛异常（内部 catch），异常以 { success:false, error } 返回。
 */
class DeviceManager {
  constructor() {
    // 本地配置缓存：{ deviceName: string|null, removedDeviceIds: string[] }
    // - deviceName：当前设备别名（用户可读）
    // - removedDeviceIds：方案B 本地已"注销"的设备 id 列表（占位，等 Worker 远程注销就绪后可移除）
    this._cache = null;
  }

  /**
   * 读取并缓存本地 device-manager 配置
   */
  _loadLocalConfig() {
    if (this._cache) return this._cache;
    try {
      const p = getDeviceManagerConfigPath();
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
        this._cache = {
          deviceName: typeof raw.deviceName === 'string' ? raw.deviceName : null,
          removedDeviceIds: Array.isArray(raw.removedDeviceIds) ? raw.removedDeviceIds : [],
        };
      } else {
        this._cache = { deviceName: null, removedDeviceIds: [] };
      }
    } catch (err) {
      logger.warn('加载 device-manager 配置失败，使用默认值:', err);
      this._cache = { deviceName: null, removedDeviceIds: [] };
    }
    return this._cache;
  }

  /**
   * 持久化本地 device-manager 配置
   */
  _saveLocalConfig() {
    try {
      const p = getDeviceManagerConfigPath();
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(this._cache, null, 2), 'utf-8');
    } catch (err) {
      logger.error('保存 device-manager 配置失败:', err);
    }
  }

  /**
   * 直接从 cloud-sync 的配置文件读取 deviceId / userId。
   * 不 require cloud-sync 模块，避免任何初始化时序问题。
   * 返回 { deviceId, userId } | null（文件不存在或解析失败）
   */
  _readCloudSyncConfig() {
    try {
      const p = getCloudSyncConfigPath();
      if (!fs.existsSync(p)) return null;
      const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!cfg || typeof cfg !== 'object') return null;
      return {
        deviceId: typeof cfg.deviceId === 'string' ? cfg.deviceId : null,
        userId: typeof cfg.userId === 'string' ? cfg.userId : null,
        syncUrl: typeof cfg.syncUrl === 'string' ? cfg.syncUrl : null,
        lastSyncAt: cfg.lastSyncAt || null,
      };
    } catch (err) {
      logger.warn('读取 cloud-sync 配置失败:', err);
      return null;
    }
  }

  /**
   * 获取当前设备信息
   *
   * @returns {Promise<{ success: boolean, device?: object, error?: string }>}
   *   device = { deviceId, deviceName, deviceType, userId, isCurrent }
   *   - deviceName：本地别名（未设置时为 null，UI 可显示 deviceId）
   *   - deviceType：'desktop'（与 cloud-sync push 的 deviceType 一致）
   *   - isCurrent：始终 true（表示这是当前正在使用的设备）
   */
  async getCurrentDevice() {
    try {
      const cfg = this._readCloudSyncConfig();
      if (!cfg || !cfg.deviceId) {
        // cloud-sync 尚未初始化（用户未登录或刚启动未生成 deviceId）
        return {
          success: false,
          error: '当前设备尚未初始化（deviceId 未生成，请先登录并启动云同步）',
          device: null,
        };
      }
      const local = this._loadLocalConfig();
      return {
        success: true,
        device: {
          deviceId: cfg.deviceId,
          deviceName: local.deviceName,
          deviceType: DEFAULT_DEVICE_TYPE,
          userId: cfg.userId,
          isCurrent: true,
        },
      };
    } catch (err) {
      logger.error('getCurrentDevice 失败:', err);
      return { success: false, error: err.message || '读取当前设备失败', device: null };
    }
  }

  /**
   * 设置当前设备的可读名称
   *
   * @param {string} name - 设备别名（1-64 字符，自动 trim）
   * @returns {Promise<{ success: boolean, deviceName?: string, error?: string }>}
   */
  async setDeviceName(name) {
    try {
      if (typeof name !== 'string') {
        return { success: false, error: '设备名必须为字符串' };
      }
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        return { success: false, error: '设备名不能为空' };
      }
      if (trimmed.length > 64) {
        return { success: false, error: '设备名不能超过 64 个字符' };
      }
      const local = this._loadLocalConfig();
      local.deviceName = trimmed;
      this._saveLocalConfig();
      logger.info('设备名已更新', { deviceName: trimmed });
      return { success: true, deviceName: trimmed };
    } catch (err) {
      logger.error('setDeviceName 失败:', err);
      return { success: false, error: err.message || '设置设备名失败' };
    }
  }

  /**
   * 远程获取设备列表
   *
   * 方案B（当前实现）：
   *   Worker 端 /devices 端点尚未就绪（由批次2另一个任务添加），此处返回空数组。
   *   同时把"当前设备"作为列表的第一项返回，使 UI 能在占位阶段正常展示。
   *
   * 对接点（批次2 Worker /devices 端点就绪后补充）：
   *   1. 从 _readCloudSyncConfig() 取 syncUrl / userId / deviceId。
   *   2. 从 account-store 取 token（accountStore.getToken(userId)）。
   *   3. 发起 GET `${syncUrl}/devices?userId=${userId}`，header 带 Authorization: Bearer ${token}。
   *   4. 处理 401/403（参考 cloud-sync.js 的 _handle401 逻辑，或透传 needsReauth）。
   *   5. 将返回的远端列表与当前设备合并（当前设备始终在列表中，isCurrent=true）。
   *   6. 用 removedDeviceIds 过滤掉已本地注销但尚未被 Worker 清理的设备。
   *
   * @returns {Promise<{ success: boolean, devices?: object[], needsReauth?: boolean, error?: string }>}
   *   devices[i] = { deviceId, deviceName, deviceType, lastSyncAt, created_at, isCurrent }
   */
  async fetchDevices() {
    try {
      const cfg = this._readCloudSyncConfig();
      if (!cfg || !cfg.deviceId) {
        return { success: false, error: '当前设备尚未初始化', devices: [] };
      }

      const local = this._loadLocalConfig();
      const currentDevice = {
        deviceId: cfg.deviceId,
        deviceName: local.deviceName,
        deviceType: DEFAULT_DEVICE_TYPE,
        lastSyncAt: cfg.lastSyncAt ? this._maxLastSyncAt(cfg.lastSyncAt) : null,
        created_at: null,
        isCurrent: true,
      };

      // 调 Worker GET /devices 获取远端设备列表
      if (cfg.syncUrl && cfg.userId) {
        try {
          const token = accountStore.getToken(cfg.userId);
          if (token) {
            const res = await fetch(`${cfg.syncUrl}/devices?userId=${encodeURIComponent(cfg.userId)}`, {
              headers: { Authorization: 'Bearer ' + token },
            });
            if (res.ok) {
              const data = await res.json();
              if (data.success && Array.isArray(data.devices)) {
                // 合并远端列表：标记当前设备，过滤已本地注销的
                const removed = new Set(local.removedDeviceIds);
                const remote = data.devices
                  .map((d) => ({
                    deviceId: d.id || d.deviceId,
                    deviceName: d.deviceName || d.device_name,
                    deviceType: d.deviceType || d.device_type || DEFAULT_DEVICE_TYPE,
                    lastSyncAt: d.lastSyncAt || d.last_sync_at || null,
                    created_at: d.createdAt || d.created_at || null,
                    isCurrent: (d.id || d.deviceId) === cfg.deviceId,
                  }))
                  .filter((d) => !removed.has(d.deviceId));
                // 确保当前设备在列表里（远端可能还没注册）
                if (!remote.some((d) => d.isCurrent)) remote.unshift(currentDevice);
                return { success: true, devices: remote };
              }
            }
          }
        } catch (apiErr) {
          logger.warn('fetchDevices 远端请求失败，回退到本地', apiErr.message);
        }
      }

      // 回退：只返回当前设备
      return { success: true, devices: [currentDevice] };
    } catch (err) {
      logger.error('fetchDevices 失败:', err);
      return { success: false, error: err.message || '获取设备列表失败', devices: [] };
    }
  }

  /**
   * 注销设备
   *
   * 方案B（当前实现）：
   *   Worker 端 DELETE /devices/:id 端点尚未就绪，此处仅做本地标记：
   *   将 deviceId 追加到 removedDeviceIds，下次 fetchDevices 时若 Worker 返回该设备，
   *   会用此列表过滤掉，使 UI 上不再显示已注销的设备。
   *
   * 安全约束：
   *   - 不允许注销当前设备（deviceId === 当前设备 id）。当前设备应通过"退出登录"处理。
   *   - 注销当前设备返回错误，避免云同步陷入不一致状态。
   *
   * 对接点（批次2 Worker 端点就绪后补充）：
   *   1. 发起 DELETE `${syncUrl}/devices/${deviceId}`，带 token。
   *   2. 成功后从 removedDeviceIds 移除（已被 Worker 真正清理）。
   *   3. 失败时保留 removedDeviceIds 标记，下次重试。
   *
   * @param {string} deviceId - 要注销的设备 id
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async removeDevice(deviceId) {
    try {
      if (!deviceId || typeof deviceId !== 'string') {
        return { success: false, error: 'deviceId 无效' };
      }
      const cfg = this._readCloudSyncConfig();
      const currentDeviceId = cfg?.deviceId || null;

      if (currentDeviceId && deviceId === currentDeviceId) {
        return {
          success: false,
          error: '不能注销当前正在使用的设备，请使用"退出登录"切换设备',
        };
      }

      const local = this._loadLocalConfig();
      // 先尝试远程注销
      let remoteDeleted = false;
      if (cfg.syncUrl && cfg.userId) {
        try {
          const token = accountStore.getToken(cfg.userId);
          if (token) {
            const res = await fetch(`${cfg.syncUrl}/devices/${encodeURIComponent(deviceId)}?userId=${encodeURIComponent(cfg.userId)}`, {
              method: 'DELETE',
              headers: { Authorization: 'Bearer ' + token },
            });
            if (res.ok) {
              const data = await res.json();
              remoteDeleted = data.success !== false;
            }
          }
        } catch (apiErr) {
          logger.warn('removeDevice 远程注销失败，仅本地标记', apiErr.message);
        }
      }
      // 本地标记（远程失败时保留，下次 fetchDevices 过滤）
      if (!remoteDeleted && !local.removedDeviceIds.includes(deviceId)) {
        local.removedDeviceIds.push(deviceId);
        this._saveLocalConfig();
      }
      logger.info('设备已注销', { deviceId, remote: remoteDeleted });
      return { success: true };
    } catch (err) {
      logger.error('removeDevice 失败:', err);
      return { success: false, error: err.message || '注销设备失败' };
    }
  }

  /**
   * 从 lastSyncAt 对象（各数据类型分别记录）中取最大时间戳
   * cloud-sync 的 lastSyncAt 结构：{ messages, conversations, agents, boss }
   */
  _maxLastSyncAt(lastSyncAt) {
    if (!lastSyncAt || typeof lastSyncAt !== 'object') return null;
    const vals = Object.values(lastSyncAt).filter(v => typeof v === 'number');
    if (vals.length === 0) return null;
    return Math.max(...vals);
  }
}

const deviceManager = new DeviceManager();

module.exports = { DeviceManager, deviceManager, DEFAULT_DEVICE_TYPE };
