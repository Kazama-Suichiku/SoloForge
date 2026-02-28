/**
 * 云端数据同步服务
 */

import { storage } from '../storage';
import { importService } from '../import';

// 同步服务器地址
// 本地同步服务器（Mac 上运行 node local-sync-server.js）
const SYNC_SERVER_URL = 'http://192.168.1.3:3002';

// 默认用户 ID（可以后续改为登录系统）
const DEFAULT_USER_ID = 'default-user';

export interface SyncResult {
  success: boolean;
  message: string;
  stats?: {
    agents: number;
    conversations: number;
    messages: number;
  };
}

class SyncService {
  private userId: string = DEFAULT_USER_ID;
  private serverUrl: string = SYNC_SERVER_URL;

  setUserId(userId: string): void {
    this.userId = userId;
  }

  setServerUrl(url: string): void {
    this.serverUrl = url;
  }

  /**
   * 上传本地数据到云端
   */
  async upload(): Promise<SyncResult> {
    try {
      const exportData = await importService.exportData();
      const data = JSON.parse(exportData);

      const response = await fetch(`${this.serverUrl}/sync/${this.userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          uploadedAt: new Date().toISOString(),
          version: '2.0',
        }),
      });

      const result = await response.json();

      if (result.success) {
        await storage.set('@soloforge/last_sync', Date.now());
        return { success: true, message: '数据已上传到云端' };
      } else {
        return { success: false, message: result.error || '上传失败' };
      }
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  /**
   * 从云端下载数据
   */
  async download(): Promise<SyncResult> {
    try {
      const response = await fetch(`${this.serverUrl}/sync/${this.userId}`);
      const result = await response.json();

      if (!result.success) {
        return { success: false, message: result.error || '下载失败' };
      }

      if (!result.data) {
        return { success: false, message: '云端没有数据' };
      }

      // 导入数据
      const importResult = await importService.importFromJson(JSON.stringify(result.data));

      if (importResult.success) {
        await storage.set('@soloforge/last_sync', Date.now());
        return {
          success: true,
          message: '数据已从云端同步',
          stats: {
            agents: importResult.stats.agents,
            conversations: importResult.stats.conversations,
            messages: importResult.stats.messages,
          },
        };
      } else {
        return { success: false, message: importResult.error || '导入失败' };
      }
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  /**
   * 检查云端是否有数据
   */
  async checkCloudData(): Promise<{ hasData: boolean; uploadedAt?: string }> {
    try {
      const response = await fetch(`${this.serverUrl}/sync/${this.userId}`);
      const result = await response.json();

      if (result.success && result.data) {
        return { hasData: true, uploadedAt: result.data.uploadedAt };
      }
      return { hasData: false };
    } catch {
      return { hasData: false };
    }
  }

  /**
   * 获取上次同步时间
   */
  async getLastSyncTime(): Promise<number | null> {
    return await storage.get<number>('@soloforge/last_sync');
  }
}

export const syncService = new SyncService();
