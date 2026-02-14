/**
 * SoloForge - 动态 Agent 工厂
 * 根据审批通过的请求创建新 Agent，使用详细简历生成 System Prompt
 * @module agent-factory/dynamic-agent
 */

const { ChatAgent } = require('../chat/chat-agent');
const { chatManager } = require('../chat');
const { agentConfigStore, AGENT_STATUS, createDefaultOnboardingChecklist } = require('../config/agent-config-store');
const { generateSystemPrompt, safeParseArray } = require('./agent-request');
const { logger } = require('../utils/logger');

/**
 * 动态 Agent 类
 * 继承自 ChatAgent，支持运行时创建
 */
class DynamicAgent extends ChatAgent {
  /**
   * @param {Object} config
   * @param {string} config.id - Agent ID
   * @param {string} config.name - 显示名称
   * @param {string} config.role - 角色
   * @param {string} config.systemPrompt - 系统提示词
   * @param {import('./agent-request').AgentProfile} [config.profile] - 完整画像
   * @param {string} [config.model] - 模型
   * @param {string} [config.createdBy] - 创建者
   * @param {string} [config.requestId] - 关联的申请 ID
   */
  constructor(config) {
    super(config.id, config.name, config.role, config.systemPrompt, {
      model: config.model,
    });
    this.profile = config.profile || null;
    this.createdBy = config.createdBy;
    this.requestId = config.requestId;
    this.createdAt = new Date().toISOString();
    this.isDynamic = true;
  }

  /**
   * 获取 Agent 信息
   * @returns {Object}
   */
  getInfo() {
    return {
      ...super.getInfo(),
      profile: this.profile,
      createdBy: this.createdBy,
      requestId: this.requestId,
      createdAt: this.createdAt,
      isDynamic: true,
    };
  }
}

/**
 * 动态 Agent 工厂
 */
class DynamicAgentFactory {
  constructor() {
    /** @type {Map<string, DynamicAgent>} */
    this.dynamicAgents = new Map();
  }

  /**
   * 创建动态 Agent（使用新的简历系统）
   * @param {import('./agent-request').AgentRequest} request - 已批准的申请
   * @returns {{ success: boolean, agent?: DynamicAgent, error?: string }}
   */
  create(request) {
    if (request.status !== 'approved') {
      return { success: false, error: '申请未被批准' };
    }

    const agentId = request.createdAgentId || `agent-${Date.now()}`;

    // 检查是否已存在
    if (this.dynamicAgents.has(agentId)) {
      return { success: false, error: `Agent ${agentId} 已存在` };
    }

    // 获取简历
    const profile = request.profile;
    if (!profile) {
      // 兼容旧格式
      return this._createLegacy(request);
    }

    // 使用简历生成 System Prompt
    const systemPrompt = generateSystemPrompt(profile);

    // 创建 Agent
    const agent = new DynamicAgent({
      id: agentId,
      name: profile.name,
      role: profile.title,
      systemPrompt,
      profile,
      model: profile.model || request.model,
      createdBy: request.requesterId,
      requestId: request.id,
    });

    // 设置 LLM Manager
    if (chatManager.llmManager) {
      agent.setLLMManager(chatManager.llmManager);
    }

    // 注册到聊天管理器
    chatManager.registerAgent(agent);

    // 保存到本地
    this.dynamicAgents.set(agentId, agent);

    // 同步到 Agent 配置存储（以便在组织架构中显示）
    const responsibilities = safeParseArray(profile.responsibilities);
    const now = new Date();
    const probationEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 默认 30 天试用期
    agentConfigStore.add({
      id: agentId,
      name: profile.name,
      title: profile.title,
      level: profile.level || 'staff',
      department: profile.department,
      description: responsibilities.join('; ') || '',
      avatar: profile.avatar || '👤',
      reportsTo: profile.reportsTo,
      isDynamic: true,
      status: AGENT_STATUS.ACTIVE,
      hireDate: now.toISOString(),
      probationEnd: probationEnd.toISOString(),
      promotionHistory: [],
      onboardingChecklist: createDefaultOnboardingChecklist(),
    });

    logger.info('创建动态 Agent:', {
      id: agentId,
      name: profile.name,
      title: profile.title,
      department: profile.department,
      createdBy: request.requesterId,
      revisionCount: request.revisionCount,
      hireDate: now.toISOString(),
      probationEnd: probationEnd.toISOString(),
    });

    return { success: true, agent };
  }

  /**
   * 兼容旧格式的创建方法
   * @private
   */
  _createLegacy(request) {
    const agentId = request.createdAgentId || `agent-${Date.now()}`;

    const agent = new DynamicAgent({
      id: agentId,
      name: request.agentName,
      role: request.agentRole,
      systemPrompt: request.systemPrompt,
      model: request.model,
      createdBy: request.requesterId,
      requestId: request.id,
    });

    if (chatManager.llmManager) {
      agent.setLLMManager(chatManager.llmManager);
    }

    chatManager.registerAgent(agent);
    this.dynamicAgents.set(agentId, agent);

    logger.info('创建动态 Agent (兼容模式):', {
      id: agentId,
      name: request.agentName,
      createdBy: request.requesterId,
    });

    return { success: true, agent };
  }

  /**
   * 获取动态 Agent
   * @param {string} agentId
   * @returns {DynamicAgent | null}
   */
  get(agentId) {
    return this.dynamicAgents.get(agentId) || null;
  }

  /**
   * 获取所有动态 Agent
   * @returns {DynamicAgent[]}
   */
  getAll() {
    return Array.from(this.dynamicAgents.values());
  }

  /**
   * 删除动态 Agent
   * @param {string} agentId
   * @returns {boolean}
   */
  remove(agentId) {
    const agent = this.dynamicAgents.get(agentId);
    if (!agent) {
      return false;
    }

    // 从聊天管理器注销
    chatManager.unregisterAgent(agentId);

    // 从配置存储中删除
    agentConfigStore.remove(agentId);

    // 删除本地记录
    this.dynamicAgents.delete(agentId);

    logger.info('删除动态 Agent:', agentId);
    return true;
  }

  /**
   * 列出动态 Agent 信息
   * @returns {Object[]}
   */
  list() {
    return this.getAll().map((agent) => agent.getInfo());
  }

  /**
   * 恢复已批准的 Agent（应用启动时调用）
   * 每次启动都需要重新创建 ChatAgent 实例并注册到 ChatManager
   * 因为 ChatManager 的 agents Map 是内存数据，重启后丢失
   * @returns {{ restored: number, errors: string[] }}
   */
  restoreApprovedAgents() {
    const { approvalQueue } = require('./approval-queue');
    const restored = [];
    const errors = [];

    // 获取所有已批准的申请
    const approvedRequests = approvalQueue.getAll({ status: 'approved' });

    for (const request of approvedRequests) {
      const agentId = request.createdAgentId;
      if (!agentId) continue;

      // 只跳过内存中已存在的（本次启动已创建过的）
      if (this.dynamicAgents.has(agentId)) {
        continue;
      }

      // 跳过已开除的 Agent（不恢复）
      const existingConfig = agentConfigStore.get(agentId);
      if (existingConfig && existingConfig.status === AGENT_STATUS.TERMINATED) {
        logger.debug('跳过已开除的 Agent:', { agentId });
        continue;
      }

      // 跳过已停职的 Agent（不恢复运行时实例，但保留配置）
      if (existingConfig && existingConfig.status === AGENT_STATUS.SUSPENDED) {
        logger.debug('跳过已停职的 Agent:', { agentId });
        continue;
      }

      // 尝试创建 Agent 实例（即使 agentConfigStore 已有配置）
      // agentConfigStore 的配置是持久化的，但 ChatAgent 实例是内存的
      try {
        const profile = request.profile;
        if (!profile) {
          // 旧格式兼容
          const result = this._createLegacy(request);
          if (result.success) {
            restored.push({ agentId, name: request.agentName, requestId: request.id });
          } else {
            errors.push(`${agentId}: ${result.error}`);
          }
          continue;
        }

        // 生成系统提示词并创建 Agent 实例
        const systemPrompt = generateSystemPrompt(profile);
        const agent = new DynamicAgent({
          id: agentId,
          name: profile.name,
          role: profile.title,
          systemPrompt,
          profile,
          model: profile.model || request.model,
          createdBy: request.requesterId,
          requestId: request.id,
        });

        // 设置 LLM Manager 并注册到 ChatManager
        if (chatManager.llmManager) {
          agent.setLLMManager(chatManager.llmManager);
        }
        chatManager.registerAgent(agent);
        this.dynamicAgents.set(agentId, agent);

        // 确保 agentConfigStore 也有配置（首次创建失败的情况）
        if (!agentConfigStore.get(agentId)) {
          const responsibilities = safeParseArray(profile.responsibilities);
          agentConfigStore.add({
            id: agentId,
            name: profile.name,
            title: profile.title,
            level: profile.level || 'staff',
            department: profile.department,
            description: responsibilities.join('; ') || '',
            avatar: profile.avatar || '👤',
            reportsTo: profile.reportsTo,
            isDynamic: true,
          });
        }

        restored.push({ agentId, name: profile.name, requestId: request.id });
        logger.info('恢复动态 Agent:', { agentId, name: profile.name });
      } catch (error) {
        errors.push(`${agentId}: ${error.message}`);
        logger.error('恢复动态 Agent 失败:', { agentId, error: error.message });
      }
    }

    if (restored.length > 0) {
      logger.info('动态 Agent 恢复完成:', { restored: restored.length, errors: errors.length });
    }

    return { restored: restored.length, errors };
  }
}

// 单例
const dynamicAgentFactory = new DynamicAgentFactory();

module.exports = { DynamicAgent, DynamicAgentFactory, dynamicAgentFactory };
