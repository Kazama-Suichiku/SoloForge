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
const departmentGroup = require('../chat/department-group');

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

    const agentId = request.createdAgentId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

    // 处理部门群聊：如果上级是 CXO，自动创建/加入部门群
    this._handleDepartmentGroupOnCreate(agentId, profile);

    return { success: true, agent };
  }

  /**
   * 处理新员工入职时的部门群聊逻辑
   * - 根据员工的 department 字段决定加入哪个部门群
   * - 如果部门有 CXO 级别的负责人，则加入该 CXO 的部门群
   * @param {string} agentId - 新员工 Agent ID
   * @param {Object} profile - 员工简历
   * @private
   */
  _handleDepartmentGroupOnCreate(agentId, profile) {
    try {
      // 使用员工的 department 字段来决定部门归属
      const departmentId = profile.department;
      if (!departmentId) {
        logger.warn('新员工没有指定部门，跳过部门群聊处理:', { agentId });
        return;
      }

      // 查找该部门的 CXO 负责人
      const allConfigs = agentConfigStore.getAll();
      const departmentCXO = allConfigs.find(
        (c) => c.level === 'c_level' && 
               c.department === departmentId && 
               (c.status || 'active') !== 'terminated'
      );

      if (departmentCXO) {
        // 该部门有 CXO 负责人，加入其部门群
        departmentGroup.ensureDepartmentGroup(departmentId, departmentCXO.id);
        departmentGroup.addMemberToGroup(departmentId, agentId);
        
        logger.info('新员工加入部门群聊:', {
          agentId,
          agentName: profile.name,
          departmentId,
          departmentOwner: departmentCXO.id,
        });
      } else {
        // 该部门没有 CXO 负责人（自定义部门或空部门）
        // 检查 reportsTo 是否指向某个 CXO，如果是，加入该 CXO 的群
        const reportsTo = profile.reportsTo;
        if (reportsTo) {
          const supervisorConfig = agentConfigStore.get(reportsTo);
          if (supervisorConfig?.level === 'c_level') {
            const supervisorDeptId = supervisorConfig.department;
            departmentGroup.ensureDepartmentGroup(supervisorDeptId, reportsTo);
            departmentGroup.addMemberToGroup(supervisorDeptId, agentId);
            
            logger.info('新员工加入上级部门群聊（自定义部门无 CXO）:', {
              agentId,
              agentName: profile.name,
              employeeDepartment: departmentId,
              joinedDepartment: supervisorDeptId,
              supervisor: reportsTo,
            });
          }
        }
        // 如果既没有部门 CXO 也没有 CXO 级别的上级，则不加入任何部门群
        // 这是正常情况，例如新创建的部门还没有 CXO 负责人
      }
    } catch (error) {
      logger.error('处理部门群聊失败:', { agentId, error: error.message });
    }
  }

  /**
   * 兼容旧格式的创建方法
   * @private
   */
  _createLegacy(request) {
    const agentId = request.createdAgentId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

    // 从聊天管理器注销，并清理所有相关资源
    chatManager.unregisterAgent(agentId, { cleanupResources: true });

    // 从配置存储中删除
    agentConfigStore.remove(agentId);

    // 删除本地记录
    this.dynamicAgents.delete(agentId);

    logger.info('删除动态 Agent，已清理相关资源:', agentId);
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
   * 
   * 恢复策略：
   * 1. 从 approvalQueue 恢复（有完整 profile）
   * 2. 从 agentConfigStore 恢复（兜底，处理请求数据丢失的情况）
   * @returns {{ restored: number, errors: string[] }}
   */
  restoreApprovedAgents() {
    const { approvalQueue } = require('./approval-queue');
    const restored = [];
    const errors = [];
    const restoredIds = new Set();

    // ─── 策略1: 从已批准的申请恢复（有完整 profile） ───────────────
    const approvedRequests = approvalQueue.getAll({ status: 'approved' });

    for (const request of approvedRequests) {
      const agentId = request.createdAgentId;
      if (!agentId) continue;

      // 只跳过内存中已存在的（本次启动已创建过的）
      if (this.dynamicAgents.has(agentId)) {
        restoredIds.add(agentId);
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
            restoredIds.add(agentId);
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

        restored.push({ agentId, name: profile.name, requestId: request.id, source: 'approvalQueue' });
        restoredIds.add(agentId);
        logger.info('恢复动态 Agent (从请求队列):', { agentId, name: profile.name });
      } catch (error) {
        errors.push(`${agentId}: ${error.message}`);
        logger.error('恢复动态 Agent 失败:', { agentId, error: error.message });
      }
    }

    // ─── 策略2: 从 agentConfigStore 恢复（请求数据丢失的兜底） ───────
    // 处理请求队列中没有记录，但 agentConfigStore 中有配置的动态 Agent
    const allConfigs = agentConfigStore.getAll();
    for (const config of allConfigs) {
      // 跳过非动态 Agent
      if (!config.isDynamic) continue;
      
      // 跳过已经恢复的
      if (restoredIds.has(config.id)) continue;
      
      // 跳过已开除的
      if (config.status === AGENT_STATUS.TERMINATED) continue;
      
      // 跳过已停职的
      if (config.status === AGENT_STATUS.SUSPENDED) continue;
      
      // 跳过内存中已存在的
      if (this.dynamicAgents.has(config.id)) continue;

      try {
        // 从 config 重建 profile（可能缺少一些信息，但足够运行）
        const profile = {
          name: config.name,
          title: config.title,
          level: config.level || 'staff',
          department: config.department,
          responsibilities: config.description ? [config.description] : [],
          avatar: config.avatar || '👤',
          reportsTo: config.reportsTo,
          model: config.model,
        };

        const systemPrompt = generateSystemPrompt(profile);
        const agent = new DynamicAgent({
          id: config.id,
          name: config.name,
          role: config.title,
          systemPrompt,
          profile,
          model: config.model,
          createdBy: config.createdBy || 'system',
        });

        if (chatManager.llmManager) {
          agent.setLLMManager(chatManager.llmManager);
        }
        chatManager.registerAgent(agent);
        this.dynamicAgents.set(config.id, agent);

        restored.push({ agentId: config.id, name: config.name, source: 'agentConfigStore' });
        restoredIds.add(config.id);
        logger.info('恢复动态 Agent (从配置存储):', { agentId: config.id, name: config.name });
      } catch (error) {
        errors.push(`${config.id}: ${error.message}`);
        logger.error('从配置存储恢复动态 Agent 失败:', { agentId: config.id, error: error.message });
      }
    }

    if (restored.length > 0) {
      logger.info('动态 Agent 恢复完成:', { 
        total: restored.length, 
        fromQueue: restored.filter((r) => r.source === 'approvalQueue').length,
        fromConfig: restored.filter((r) => r.source === 'agentConfigStore').length,
        errors: errors.length,
      });
    }

    return { restored: restored.length, errors };
  }
}

// 单例
const dynamicAgentFactory = new DynamicAgentFactory();

module.exports = { DynamicAgent, DynamicAgentFactory, dynamicAgentFactory };
