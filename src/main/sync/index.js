/**
 * 同步模块入口
 */

const { supabaseClient } = require('./supabase-client');
const { authManager } = require('./auth-manager');
const { syncManager } = require('./sync-manager');
const { AgentConfigAdapter } = require('./data-adapters/agent-config-adapter');

/**
 * 初始化同步系统
 */
function initializeSync() {
  // 从环境变量读取 Supabase 配置
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey && 
      supabaseUrl !== 'https://your-project.supabase.co' &&
      supabaseKey !== 'your-anon-key-here') {
    try {
      // 初始化 Supabase 客户端
      supabaseClient.initialize(supabaseUrl, supabaseKey);

      // 注册数据适配器
      syncManager.registerAdapter('agent_configs', new AgentConfigAdapter());

      // 尝试恢复会话
      authManager.restoreSession().then(result => {
        if (result.success) {
          // 会话恢复成功,启动自动同步
          syncManager.startAutoSync();
        }
      });

      return true;
    } catch (error) {
      console.error('同步系统初始化失败:', error);
      return false;
    }
  }

  return false;
}

module.exports = {
  supabaseClient,
  authManager,
  syncManager,
  initializeSync
};
