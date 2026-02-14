/**
 * Agent 配置数据适配器
 */

const { BaseAdapter } = require('./base-adapter');
const { agentConfigStore } = require('../../config/agent-config-store');

class AgentConfigAdapter extends BaseAdapter {
  constructor() {
    super('agent_configs', agentConfigStore);
  }

  async getLocal() {
    const configs = agentConfigStore.getAllConfigs();
    return Object.entries(configs).map(([agentId, config]) => ({
      id: agentId,
      agent_id: agentId,
      config: config,
      updated_at: config.updatedAt || new Date().toISOString(),
      version: config.version || 1
    }));
  }

  async updateLocal(data) {
    for (const item of data) {
      agentConfigStore.setConfig(item.agent_id, item.config);
    }
    return { success: true };
  }
}

module.exports = { AgentConfigAdapter };
