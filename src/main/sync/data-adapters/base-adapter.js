/**
 * 数据适配器基类
 */

const { supabaseClient } = require('../supabase-client');
const { authManager } = require('../auth-manager');
const { logger } = require('../../utils/logger');

class BaseAdapter {
  constructor(tableName, localStore) {
    this.tableName = tableName;
    this.localStore = localStore;
    this.name = tableName;
  }

  /**
   * 从云端拉取数据
   */
  async pull() {
    const client = supabaseClient.getClient();
    const user = authManager.getCurrentUser();

    if (!user) {
      throw new Error('用户未登录');
    }

    const { data, error } = await client
      .from(this.tableName)
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(`拉取数据失败: ${error.message}`);
    }

    return data || [];
  }

  /**
   * 推送数据到云端
   */
  async push(data) {
    const client = supabaseClient.getClient();
    const user = authManager.getCurrentUser();

    if (!user) {
      throw new Error('用户未登录');
    }

    // 添加 user_id 和时间戳
    const records = Array.isArray(data) ? data : [data];
    const enriched = records.map(record => ({
      ...record,
      user_id: user.id,
      updated_at: new Date().toISOString()
    }));

    const { error } = await client
      .from(this.tableName)
      .upsert(enriched, { onConflict: 'id' });

    if (error) {
      throw new Error(`推送数据失败: ${error.message}`);
    }

    return { success: true };
  }

  /**
   * 获取本地数据
   */
  async getLocal() {
    return this.localStore.get('data') || [];
  }

  /**
   * 更新本地数据
   */
  async updateLocal(data) {
    this.localStore.set('data', data);
    return { success: true };
  }

  /**
   * 检测冲突
   */
  detectConflicts(localData, cloudData) {
    const conflicts = [];
    const localMap = new Map(localData.map(item => [item.id, item]));

    for (const cloudItem of cloudData) {
      const localItem = localMap.get(cloudItem.id);
      if (localItem) {
        // 比较版本号或时间戳
        if (localItem.version !== cloudItem.version) {
          conflicts.push({
            id: cloudItem.id,
            local: localItem,
            cloud: cloudItem
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * 合并数据 (Last Write Wins)
   */
  merge(localData, cloudData) {
    const merged = new Map();

    // 先添加本地数据
    for (const item of localData) {
      merged.set(item.id, item);
    }

    // 云端数据覆盖（如果更新时间更晚）
    for (const item of cloudData) {
      const existing = merged.get(item.id);
      if (!existing || new Date(item.updated_at) > new Date(existing.updated_at)) {
        merged.set(item.id, item);
      }
    }

    return Array.from(merged.values());
  }
}

module.exports = { BaseAdapter };
