/**
 * Supabase 客户端初始化
 */

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');

class SupabaseClient {
  constructor() {
    this.client = null;
    this.initialized = false;
  }

  /**
   * 初始化 Supabase 客户端
   */
  initialize(supabaseUrl, supabaseKey) {
    if (this.initialized) {
      return this.client;
    }

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL 和 Key 不能为空');
    }

    try {
      this.client = createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        }
      });

      this.initialized = true;
      logger.info('Supabase 客户端初始化成功');
      return this.client;
    } catch (error) {
      logger.error('Supabase 客户端初始化失败:', error);
      throw error;
    }
  }

  /**
   * 获取客户端实例
   */
  getClient() {
    if (!this.initialized) {
      throw new Error('Supabase 客户端未初始化');
    }
    return this.client;
  }

  /**
   * 检查是否已初始化
   */
  isInitialized() {
    return this.initialized;
  }
}

const supabaseClient = new SupabaseClient();

module.exports = { supabaseClient };
