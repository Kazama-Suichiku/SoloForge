/**
 * SoloForge - 聊天 Agent 管理器
 * 管理所有聊天 Agent，处理消息路由
 * @module chat/chat-manager
 */

const { SecretaryAgent } = require('./secretary-agent');
const { CEOAgent, CTOAgent, CFOAgent } = require('./cxo-agents');
const { CHROAgent } = require('./chro-agent');
const { logger } = require('../utils/logger');
const {
  ToolExecutor,
  parseToolCalls,
  hasToolCalls,
  removeToolCalls,
} = require('../tools/tool-executor');
const { toolRegistry } = require('../tools/tool-registry');
const { permissionStore } = require('../config/permission-store');
const { agentConfigStore, AGENT_STATUS } = require('../config/agent-config-store');
const { historyManager, PAGE_SIZE } = require('./history-manager');
const { setConversationHistory } = require('../tools/history-tool');
const { agentCommunication } = require('../collaboration/agent-communication');
const { estimateTokens, estimateMessages, getAvailableBudget } = require('../llm/token-estimator');
const { compressToolHistory } = require('./context-fitter');
const { isContextTooLongError } = require('../llm/llm-manager');
const { tokenTracker } = require('../budget/token-tracker');

// 延迟加载记忆系统，避免循环依赖
let _memoryManager = null;
function getMemoryManager() {
  if (!_memoryManager) {
    try {
      const { memoryManager } = require('../memory');
      _memoryManager = memoryManager;
    } catch (e) {
      // 记忆系统可能尚未初始化
    }
  }
  return _memoryManager;
}

/**
 * 聊天 Agent 管理器
 */
class ChatManager {
  constructor() {
    /** @type {Map<string, import('./chat-agent').ChatAgent>} */
    this.agents = new Map();
    this.llmManager = null;
    this.webContents = null;
    this.toolExecutor = null;

    /**
     * 活跃任务追踪
     * key: agentId, value: { agentId, agentName, conversationId, messageId, task, startTime, stage, abortController }
     * @type {Map<string, Object>}
     */
    this.activeTasks = new Map();

    /**
     * 主动推送消息队列：当 Agent 有活跃用户对话时，消息排队等待
     * key: agentId, value: Array<{ content: string, timestamp: number }>
     * @type {Map<string, Array>}
     */
    this._proactiveQueue = new Map();

    // 初始化默认 Agent
    this._initDefaultAgents();
  }

  /**
   * 初始化工具执行器
   */
  initToolExecutor() {
    // 防止重复初始化导致多次订阅
    if (this._toolExecutorInitialized) {
      logger.debug('工具执行器已初始化，跳过重复初始化');
      return;
    }
    this._toolExecutorInitialized = true;

    this.toolExecutor = new ToolExecutor({
      userPermissions: permissionStore.get(),
    });

    // 监听权限变更
    permissionStore.subscribe((permissions) => {
      if (this.toolExecutor) {
        this.toolExecutor.setPermissions(permissions);
      }
    });

    // 设置 Agent 通信管理器的引用
    agentCommunication.setChatManager(this);

    // 注入 chatManager 到 Git 工具，支持 PR 事件通知
    try {
      const { initGitNotifications } = require('../tools/git-tool');
      initGitNotifications(this);
    } catch (e) {
      logger.warn('Git 通知初始化失败:', e.message);
    }

    // ─── 审批事件自动管线 ─────────────────────────────────────────
    // 监听审批队列的所有关键事件
    // 核心原则：每个 Agent 收到通知后都自动行动，不等待用户指令
    const { approvalQueue } = require('../agent-factory/approval-queue');
    approvalQueue.subscribe((event, request) => {
      const { requesterId, profile } = request;
      const profileName = profile?.name || '未知';
      const profileTitle = profile?.title || '未知';
      const requesterAgent = requesterId ? this.getAgent(requesterId) : null;
      const requesterName = requesterAgent?.name || requesterId || '未知';

      // ────────────────────────────────────────────────────────────
      // 1. 新申请提交 → 自动驱动 CHRO 开始审批
      // ────────────────────────────────────────────────────────────
      if (event === 'submitted') {
        logger.info(`新招聘申请: ${requesterName} 提交了 ${profileName} (${profileTitle})`);

        this.pushProactiveMessage('chro', 
          `收到新的招聘申请：**${requesterName}** 提交了「${profileName} - ${profileTitle}」的招聘请求，我将立即开始审核流程。`
        );

        setImmediate(async () => {
          try {
            const reviewMsg = `【系统通知 - 新招聘申请待审批】

申请人: ${requesterName} (${requesterId})
候选人: ${profileName}
职位: ${profileTitle}
部门: ${profile?.department || '未指定'}
申请 ID: ${request.id}

请立即开始审批流程：
1. 使用 agent_requests(request_id="${request.id}") 查看完整简历
2. 评估简历质量和岗位匹配度
3. 如果信息不完整，使用 hr_question 提出质疑
4. 如果简历满足要求，使用 agent_approve(request_id="${request.id}", approved=true, comment="审批意见") 批准
5. 审批完成后，使用 notify_boss 向老板汇报审批结果

⚠️ 重要：你必须通过调用工具来执行操作。口头说"批准"或"拒绝"不会生效——只有调用 agent_approve 工具才能真正完成审批。

请立刻开始，不要等待进一步指示。`;

            logger.info('驱动 CHRO 自动审批:', { requestId: request.id, profileName });
            await agentCommunication.sendMessage({
              fromAgent: 'system',
              toAgent: 'chro',
              message: reviewMsg,
              allowTools: true,
            });
            logger.info('CHRO 自动审批完成:', { requestId: request.id });
          } catch (error) {
            logger.error('CHRO 自动审批失败:', error);
            this.pushProactiveMessage('chro',
              `审核「${profileName} - ${profileTitle}」时遇到了问题：${error.message}。请手动让我重新审核。`
            );
          }
        });
        return;
      }

      // ────────────────────────────────────────────────────────────
      // 2. CHRO 提出质疑 → 自动驱动申请人回应
      // ────────────────────────────────────────────────────────────
      if (event === 'questioned') {
        if (!requesterId) return;
        const lastQuestion = request.discussion?.filter((d) => d.type === 'question').pop();
        const questionContent = lastQuestion?.content || '（未知质疑内容）';

        logger.info(`CHRO 质疑: → ${requesterName}`, { requestId: request.id });

        // 通知用户
        this.pushProactiveMessage(requesterId,
          `CHRO 对「${profileName} - ${profileTitle}」的招聘申请提出了质疑，我将立即回应。\n\n> ${questionContent.slice(0, 200)}`
        );

        // 驱动申请人自动回应
        setImmediate(async () => {
          try {
            const respondMsg = `【系统通知 - 你的招聘申请收到质疑】

CHRO 对你提交的招聘申请「${profileName} - ${profileTitle}」提出了以下质疑：

"${questionContent}"

申请 ID: ${request.id}

请立即处理：
1. 认真阅读 CHRO 的质疑
2. 如果只需要回答问题，使用 recruit_respond(request_id="${request.id}", answer="你的详细回答")
3. 如果需要修订简历，使用 recruit_respond(request_id="${request.id}", answer="修订说明", expertise=["技能1","技能2"], responsibilities=["职责1","职责2"], ...) 同时提供 answer 和需要修改的字段
4. 注意：必须使用 recruit_respond 工具，不要使用 agent_requests
5. 回复应当详尽、专业，直接解决 CHRO 的疑问

请立刻回应，不要等待进一步指示。`;

            logger.info(`驱动 ${requesterName} 回应质疑:`, { requestId: request.id });
            await agentCommunication.sendMessage({
              fromAgent: 'system',
              toAgent: requesterId,
              message: respondMsg,
              allowTools: true,
            });
            logger.info(`${requesterName} 回应质疑完成:`, { requestId: request.id });
          } catch (error) {
            logger.error(`${requesterName} 回应质疑失败:`, error);
          }
        });
        return;
      }

      // ────────────────────────────────────────────────────────────
      // 3. 申请人回复质疑或修订简历 → 自动驱动 CHRO 继续审批
      // ────────────────────────────────────────────────────────────
      if (event === 'answered' || event === 'revised') {
        const actionText = event === 'revised' ? '修订了简历' : '回复了质疑';
        logger.info(`招聘申请更新: ${requesterName} ${actionText}, requestId=${request.id}`);

        this.pushProactiveMessage('chro',
          `${requesterName} ${actionText}（${profileName} - ${profileTitle}），我将继续审核。`
        );

        setImmediate(async () => {
          try {
            const followUpMsg = `【系统通知 - 招聘申请更新】

${requesterName} ${actionText}。
候选人: ${profileName} - ${profileTitle}
申请 ID: ${request.id}

请立即继续审批：
1. 使用 agent_requests(request_id="${request.id}") 查看更新后的完整简历和回复
2. 重新评估是否满足要求
3. 满足要求则使用 agent_approve(request_id="${request.id}", approved=true, comment="审批意见") 批准
4. 不满足则继续使用 hr_question 质疑或拒绝
5. 审批完成后，使用 notify_boss 向老板汇报结果

⚠️ 重要：你必须通过调用工具来执行操作。口头说"批准"不会生效——只有调用 agent_approve 工具才能真正完成审批。

请立刻继续，不要等待进一步指示。`;

            await agentCommunication.sendMessage({
              fromAgent: 'system',
              toAgent: 'chro',
              message: followUpMsg,
              allowTools: true,
            });
            logger.info('CHRO 继续审批完成:', { requestId: request.id, event });
          } catch (error) {
            logger.error('CHRO 继续审批失败:', error);
          }
        });
        return;
      }

      // ────────────────────────────────────────────────────────────
      // 4. 审批通过 → 驱动申请人安排新员工 + 向老板汇报
      // ────────────────────────────────────────────────────────────
      if (event === 'approved') {
        if (!requesterId) return;

        logger.info(`审批通过: ${profileName} (${profileTitle})，通知 ${requesterName}`);

        // 通知用户审批结果
        this.pushProactiveMessage(requesterId,
          `好消息！「${profileName} - ${profileTitle}」的招聘申请已通过 CHRO 审批，新员工已入职。我将立即安排后续工作。`
        );

        // 驱动申请人自动执行后续动作
        setImmediate(async () => {
          try {
            const actionMsg = `【系统通知 - 招聘审批已通过】

你提交的招聘申请「${profileName} - ${profileTitle}」已通过 CHRO 审批，新员工已正式入职！

请立即执行以下操作：
1. 使用 list_colleagues 查看新员工的完整信息
2. 使用 delegate_task 给新员工分配第一批工作任务（根据其职责和当前项目需要）
3. 完成以上操作后，使用 notify_boss 向老板汇报：
   - 新员工已入职
   - 已分配的任务内容
   - 后续工作计划

请立刻开始，不要等待进一步指示。`;

            logger.info(`驱动 ${requesterName} 安排新员工:`, { profileName });
            await agentCommunication.sendMessage({
              fromAgent: 'chro',
              toAgent: requesterId,
              message: actionMsg,
              allowTools: true,
            });
            logger.info(`${requesterName} 安排新员工完成:`, { profileName });
          } catch (error) {
            logger.error(`${requesterName} 安排新员工失败:`, error);
          }
        });
        return;
      }

      // ────────────────────────────────────────────────────────────
      // 5. 审批拒绝 → 驱动申请人向老板汇报
      // ────────────────────────────────────────────────────────────
      if (event === 'rejected') {
        if (!requesterId) return;

        const reason = request.discussion?.filter((d) => d.role === 'reviewer').pop()?.content || '未说明原因';

        logger.info(`审批拒绝: ${profileName} (${profileTitle})，通知 ${requesterName}`);

        this.pushProactiveMessage(requesterId,
          `「${profileName} - ${profileTitle}」的招聘申请被 CHRO 拒绝了。\n拒绝原因：${reason.slice(0, 200)}\n我将向老板汇报此情况。`
        );

        // 驱动申请人自动汇报
        setImmediate(async () => {
          try {
            const rejectMsg = `【系统通知 - 招聘审批被拒绝】

你提交的招聘申请「${profileName} - ${profileTitle}」已被 CHRO 拒绝。
拒绝原因：${reason}

请立即执行：
1. 使用 notify_boss 向老板汇报此情况，包含：
   - 被拒绝的申请详情
   - CHRO 的拒绝原因
   - 你的建议（是否需要修改后重新申请）

请立刻汇报，不要等待进一步指示。`;

            await agentCommunication.sendMessage({
              fromAgent: 'chro',
              toAgent: requesterId,
              message: rejectMsg,
              allowTools: true,
            });
            logger.info(`${requesterName} 拒绝汇报完成:`, { profileName });
          } catch (error) {
            logger.error(`${requesterName} 拒绝汇报失败:`, error);
          }
        });
      }
    });

    // ─── 开除审批事件管线 ─────────────────────────────────────────
    const { terminationQueue } = require('../agent-factory/termination-queue');
    terminationQueue.subscribe((event, request) => {
      const { agentId, agentName, agentTitle, reason, proposedByName } = request;

      // ────────────────────────────────────────────────────────────
      // 1. CHRO 提出开除申请 → 通知老板（通过 Secretary）
      // ────────────────────────────────────────────────────────────
      if (event === 'proposed') {
        logger.info(`开除申请: ${proposedByName} 提议开除 ${agentName} (${agentTitle})`);

        this.pushProactiveMessage('secretary',
          `收到 CHRO 的开除申请：提议开除「${agentName}（${agentTitle}）」。\n原因：${reason}\n\n请通知老板前往运营仪表板的「开除审批」模块进行审批。`
        );

        setImmediate(async () => {
          try {
            const notifyMsg = `【系统通知 - 开除申请待确认】

${proposedByName} 提议开除以下员工：
- 姓名: ${agentName}
- 职位: ${agentTitle}
- 开除原因: ${reason}
- 影响分析: ${request.impactAnalysis || '未提供'}
- 严重程度: ${request.severity === 'urgent' ? '紧急' : '一般'}

请通知老板：有一份新的开除申请需要审批。老板可以在运营仪表板（Dashboard）的「开除审批」模块中查看详情并进行批准或拒绝操作。

⚠️ 重要：你只需要通知老板去仪表板审批，不需要自己执行任何开除确认操作。`;

            logger.info('通知 Secretary 开除申请:', { requestId: request.id, agentName });
            await agentCommunication.sendMessage({
              fromAgent: 'system',
              toAgent: 'secretary',
              message: notifyMsg,
              allowTools: true,
            });
          } catch (error) {
            logger.error('通知 Secretary 开除申请失败:', error);
          }
        });
        return;
      }

      // ────────────────────────────────────────────────────────────
      // 2. 老板确认开除 → 执行开除并通知 CHRO
      // ────────────────────────────────────────────────────────────
      if (event === 'confirmed') {
        logger.info(`开除确认: ${agentName} (${agentTitle}) 已被确认开除`);

        // 执行开除：标记状态为 terminated + 从 chatManager 注销 + 清理所有相关资源
        const terminateResult = agentConfigStore.terminate(agentId, reason);
        if (terminateResult.success) {
          // 从聊天管理器注销 Agent，并清理所有相关资源
          this.unregisterAgent(agentId, { cleanupResources: true });

          // 从动态 Agent 工厂中移除
          try {
            const { dynamicAgentFactory } = require('../agent-factory/dynamic-agent');
            if (dynamicAgentFactory.get(agentId)) {
              dynamicAgentFactory.dynamicAgents.delete(agentId);
            }
          } catch (e) {
            logger.warn('从动态工厂移除 Agent 失败:', e.message);
          }

          logger.info('Agent 已开除，所有相关资源已清理:', { agentId, agentName });
        }

        // 通知 CHRO 开除已执行
        this.pushProactiveMessage('chro',
          `老板已确认开除「${agentName}（${agentTitle}）」，该员工已从组织中移除。\n老板意见：${request.bossComment || '无'}`
        );

        // 通知 Secretary
        this.pushProactiveMessage('secretary',
          `「${agentName}（${agentTitle}）」已被正式开除并从组织中移除。`
        );
        return;
      }

      // ────────────────────────────────────────────────────────────
      // 3. 老板拒绝开除 → 通知 CHRO
      // ────────────────────────────────────────────────────────────
      if (event === 'rejected') {
        logger.info(`开除被拒: ${agentName} (${agentTitle}) 的开除申请被老板拒绝`);

        this.pushProactiveMessage('chro',
          `老板拒绝了开除「${agentName}（${agentTitle}）」的申请。\n老板意见：${request.bossComment || '无'}`
        );
        return;
      }
    });

    // ─── 开发计划审批事件管线 ─────────────────────────────────────────
    const { devPlanQueue } = require('../collaboration/dev-plan-queue');
    devPlanQueue.subscribe((event, plan) => {
      const { agentId, agentName, reviewerId, reviewerName, taskId } = plan;

      // ────────────────────────────────────────────────────────────
      // 1. 计划提交 → 通知 Leader 审批
      // ────────────────────────────────────────────────────────────
      if (event === 'submitted' || event === 'revised') {
        const isRevision = event === 'revised';
        const actionText = isRevision ? '修订并重新提交了' : '提交了';

        logger.info(`开发计划${actionText}: ${agentName} → ${reviewerName}`, {
          planId: plan.id,
          taskId,
        });

        // 通知老板
        this.pushProactiveMessage(reviewerId,
          `${agentName} ${actionText}开发计划，等待审批。`
        );

        // 驱动 Leader 审批
        setImmediate(async () => {
          try {
            const reviewMsg = `【系统通知 - 开发计划待审批】

${agentName} ${actionText}一份开发计划，需要你审批。
${isRevision ? `（第 ${plan.revisionCount + 1} 次修订）\n` : ''}
任务 ID: ${taskId}
计划 ID: ${plan.id}

【开发计划内容】
${plan.content}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
请审阅以上计划并决定：

1. 如果计划合理 → 使用 approve_dev_plan(plan_id="${plan.id}") 批准
   - 批准后，${agentName} 将获得开发工具权限并开始编码

2. 如果需要修改 → 使用 reject_dev_plan(plan_id="${plan.id}", feedback="你的修改建议") 驳回
   - ${agentName} 将根据你的反馈修改计划并重新提交

审批标准：
- 技术方案是否合理
- 影响范围是否可控
- 工时估计是否合理
- 是否遗漏重要风险点

请立刻审批，不要等待进一步指示。`;

            await agentCommunication.sendMessage({
              fromAgent: 'system',
              toAgent: reviewerId,
              message: reviewMsg,
              allowTools: true,
              historyStrategy: 'focused',
            });
            logger.info(`Leader 审批开发计划完成: ${reviewerName}`, { planId: plan.id });
          } catch (error) {
            logger.error(`Leader 审批开发计划失败:`, error);
            this.pushProactiveMessage(reviewerId,
              `审批 ${agentName} 的开发计划时遇到问题：${error.message}。请手动审批。`
            );
          }
        });
        return;
      }

      // ────────────────────────────────────────────────────────────
      // 2. 计划批准 → 恢复任务执行（解锁全部工具）
      // ────────────────────────────────────────────────────────────
      if (event === 'approved') {
        logger.info(`开发计划已批准: ${agentName}`, { planId: plan.id, taskId });

        // 更新任务状态
        const task = agentCommunication.delegatedTasks.find((t) => t.id === taskId);
        if (task) {
          task.planStatus = 'approved';
          agentCommunication._saveToDisk();

          // 通知老板
          this.pushProactiveMessage(reviewerId,
            `已批准 ${agentName} 的开发计划，${agentName} 正在开始执行...`
          );

          // 恢复任务执行（Phase 2，带全部工具）
          setImmediate(async () => {
            try {
              logger.info(`恢复任务执行（计划已批准）: ${task.id}`, { executor: task.toAgent });
              await agentCommunication.executeTask(task.id);
            } catch (error) {
              logger.error(`恢复任务执行失败: ${task.id}`, error);
              this.pushProactiveMessage(reviewerId,
                `${agentName} 的任务恢复执行时遇到问题：${error.message}`
              );
            }
          });
        }
        return;
      }

      // ────────────────────────────────────────────────────────────
      // 3. 计划驳回 → 恢复规划阶段（带反馈）
      // ────────────────────────────────────────────────────────────
      if (event === 'rejected') {
        logger.info(`开发计划已驳回: ${agentName}`, {
          planId: plan.id,
          taskId,
          feedback: plan.feedback?.slice(0, 100),
        });

        // 更新任务状态回到 planning
        const task = agentCommunication.delegatedTasks.find((t) => t.id === taskId);
        if (task) {
          task.planStatus = 'planning';
          task.status = 'pending'; // 重置为 pending 以便重新进入 executeTask
          agentCommunication._saveToDisk();

          // 通知老板
          this.pushProactiveMessage(reviewerId,
            `已驳回 ${agentName} 的开发计划，已发送修改建议。`
          );

          // 重新进入规划阶段（带反馈）
          setImmediate(async () => {
            try {
              logger.info(`重新进入规划阶段（计划被驳回）: ${task.id}`, { executor: task.toAgent });
              await agentCommunication.executeTask(task.id);
            } catch (error) {
              logger.error(`重新规划失败: ${task.id}`, error);
            }
          });
        }
        return;
      }
    });

    logger.info('工具执行器初始化完成');

    // ─── 启动时扫描未处理的审批请求和待执行任务 ────────────────────
    // 处理应用重启期间提交的、尚未被 CHRO 审批的请求
    // 以及尚未执行的委派任务
    setTimeout(() => {
      this._processPendingApprovals();
      this._processPendingDelegatedTasks();
    }, 5000); // 延迟 5 秒，等 Agent 恢复完成
  }

  /**
   * 扫描并自动处理待审批的招聘请求
   * 在应用启动时调用，确保 pending/discussing 状态的请求不会遗漏
   */
  _processPendingApprovals() {
    try {
      const { approvalQueue } = require('../agent-factory/approval-queue');
      const pendingRequests = approvalQueue.getPending();

      if (pendingRequests.length === 0) {
        logger.info('启动扫描: 无待处理的招聘审批');
        return;
      }

      logger.info(`启动扫描: 发现 ${pendingRequests.length} 个待处理的招聘审批`);

      // 逐个驱动 CHRO 审批（串行，避免并发冲突）
      const processNext = async (index) => {
        if (index >= pendingRequests.length) return;

        const request = pendingRequests[index];
        const { requesterId, profile } = request;
        const profileName = profile?.name || '未知';
        const profileTitle = profile?.title || '未知';
        const requesterAgent = requesterId ? this.getAgent(requesterId) : null;
        const requesterName = requesterAgent?.name || requesterId || '未知';

        // pending 状态 → 驱动 CHRO 审批
        // discussing 状态 → 说明 CHRO 已经质疑过，需要申请人回应
        if (request.status === 'pending') {
          logger.info(`启动扫描: 驱动 CHRO 审批 ${profileName} (${request.id})`);

          this.pushProactiveMessage('chro',
            `启动检查：发现待审批的招聘申请「${profileName} - ${profileTitle}」（由 ${requesterName} 提交），我将立即开始审核。`
          );

          try {
            const reviewMsg = `【系统通知 - 待处理的招聘申请】

这是一个启动时发现的待审批申请，请立即处理。
注意：请忽略你之前对此申请的所有记忆，以当前系统数据为准。

申请人: ${requesterName} (${requesterId})
候选人: ${profileName}
职位: ${profileTitle}
部门: ${profile?.department || '未指定'}
申请 ID: ${request.id}

请立即开始审批流程：
1. 使用 agent_requests(request_id="${request.id}") 查看完整简历（必须先查看，不要凭记忆判断）
2. 评估简历质量和岗位匹配度
3. 如果信息不完整，使用 hr_question 提出质疑
4. 如果简历满足要求，使用 agent_approve(request_id="${request.id}", approved=true, comment="审批意见") 批准
5. 审批完成后，使用 notify_boss 向老板汇报审批结果

⚠️ 重要：你必须通过调用工具来执行操作。口头说"批准"或"拒绝"不会生效——只有调用 agent_approve 工具才能真正完成审批。

请立刻开始，不要等待进一步指示。`;

            await agentCommunication.sendMessage({
              fromAgent: 'system',
              toAgent: 'chro',
              message: reviewMsg,
              allowTools: true,
            });
            logger.info(`启动扫描: CHRO 审批 ${profileName} 完成`);
          } catch (error) {
            logger.error(`启动扫描: CHRO 审批 ${profileName} 失败:`, error);
          }
        } else if (request.status === 'discussing') {
          // CHRO 已质疑，需要申请人回应
          const lastQuestion = request.discussion?.filter((d) => d.type === 'question').pop();
          const questionContent = lastQuestion?.content || '（请查看申请详情）';

          logger.info(`启动扫描: 驱动 ${requesterName} 回应质疑 (${request.id})`);

          this.pushProactiveMessage(requesterId,
            `启动检查：CHRO 之前对「${profileName} - ${profileTitle}」提出了质疑，我将立即回应。`
          );

          try {
            const respondMsg = `【系统通知 - 你的招聘申请有未回应的质疑】

CHRO 之前对你提交的招聘申请「${profileName} - ${profileTitle}」提出了质疑，但你尚未回应。

CHRO 的质疑：
"${questionContent}"

申请 ID: ${request.id}

请立即处理：
1. 如果只需要回答问题，使用 recruit_respond(request_id="${request.id}", answer="你的详细回答")
2. 如果需要修订简历，使用 recruit_respond(request_id="${request.id}", answer="修订说明", expertise=["技能1","技能2"], responsibilities=["职责1","职责2"], ...) 同时提供 answer 和需要修改的字段
3. 注意：必须使用 recruit_respond 工具，不要使用 agent_requests

请立刻回应，不要等待进一步指示。`;

            await agentCommunication.sendMessage({
              fromAgent: 'system',
              toAgent: requesterId,
              message: respondMsg,
              allowTools: true,
            });
            logger.info(`启动扫描: ${requesterName} 回应质疑完成`);
          } catch (error) {
            logger.error(`启动扫描: ${requesterName} 回应质疑失败:`, error);
          }
        }

        // 处理下一个（延迟 2 秒避免并发）
        setTimeout(() => processNext(index + 1), 2000);
      };

      processNext(0);
    } catch (error) {
      logger.error('启动扫描审批失败:', error);
    }
  }

  /**
   * 扫描并自动执行待处理的委派任务
   * 在应用启动时调用，确保 pending 状态的任务不会遗漏
   */
  _processPendingDelegatedTasks() {
    try {
      const pendingTasks = agentCommunication.delegatedTasks.filter(
        (t) => t.status === 'pending' || t.status === 'in_progress'
      );

      if (pendingTasks.length === 0) {
        logger.info('启动扫描: 无待执行的委派任务');
        return;
      }

      // 启动时不自动恢复任务（防止失控），仅记录日志
      logger.info(`启动扫描: 发现 ${pendingTasks.length} 个待执行/恢复的委派任务（不自动执行）`);
      for (const task of pendingTasks) {
        const fromAgent = this.getAgent(task.fromAgent);
        const toAgent = this.getAgent(task.toAgent);
        logger.info(`  - 任务 ${task.id}: ${fromAgent?.name || task.fromAgent} → ${toAgent?.name || task.toAgent}`, {
          task: task.taskDescription?.slice(0, 60),
          status: task.status,
        });
      }

      // 通知老板有未完成的任务
      if (pendingTasks.length > 0) {
        const taskList = pendingTasks.map((t) => {
          const from = this.getAgent(t.fromAgent)?.name || t.fromAgent;
          const to = this.getAgent(t.toAgent)?.name || t.toAgent;
          return `- ${from} → ${to}: ${t.taskDescription?.slice(0, 40)}... (${t.status})`;
        }).join('\n');

        this.pushProactiveMessage('secretary',
          `系统重启后发现 ${pendingTasks.length} 个未完成的委派任务，已暂停自动执行：\n${taskList}\n\n如需继续执行，请指示相关负责人重新派发。`
        );
      }
    } catch (error) {
      logger.error('启动扫描委派任务失败:', error);
    }
  }

  /**
   * 设置工具确认回调
   * @param {Function} callback
   */
  setToolConfirmCallback(callback) {
    if (this.toolExecutor) {
      this.toolExecutor.setConfirmCallback(callback);
    }
  }

  /**
   * 初始化默认 Agent
   */
  _initDefaultAgents() {
    const secretary = new SecretaryAgent();
    const ceo = new CEOAgent();
    const cto = new CTOAgent();
    const cfo = new CFOAgent();
    const chro = new CHROAgent();

    this.agents.set(secretary.id, secretary);
    this.agents.set(ceo.id, ceo);
    this.agents.set(cto.id, cto);
    this.agents.set(cfo.id, cfo);
    this.agents.set(chro.id, chro);
  }

  /**
   * 重新初始化（公司切换时调用）
   * 清空所有运行时状态，重新初始化默认 Agent
   */
  reinitialize() {
    // 1. 中止所有活跃任务
    for (const agentId of this.activeTasks.keys()) {
      this._abortTask(agentId, '公司切换');
    }

    // 2. 清空主动推送队列
    this._proactiveQueue.clear();

    // 3. 清空 agents Map（移除所有动态 Agent）
    this.agents.clear();

    // 4. 重新初始化默认 Agent
    this._initDefaultAgents();

    // 5. 重新设置 LLM Manager（如果已有）
    if (this.llmManager) {
      this.setLLMManager(this.llmManager);
    }

    logger.info('ChatManager: 已重新初始化');
  }

  /**
   * 设置 LLM Manager
   * @param {import('../llm/llm-manager').LLMManager} llmManager
   */
  setLLMManager(llmManager) {
    this.llmManager = llmManager;
    for (const agent of this.agents.values()) {
      agent.setLLMManager(llmManager);
    }
  }

  /**
   * 设置 webContents（用于流式推送）
   * @param {Electron.WebContents} webContents
   */
  setWebContents(webContents) {
    this.webContents = webContents;
  }

  /**
   * 主动向用户推送消息（实时出现在聊天窗口中）
   * 用于 Agent 主动汇报、审批通知等场景
   *
   * 排队机制：如果该 Agent 正在处理用户的流式会话，消息先排队，
   * 等当前会话轮结束后再依次推送，避免打断用户正在进行的对话。
   *
   * @param {string} agentId - 发送消息的 Agent ID
   * @param {string} content - 消息内容
   */
  pushProactiveMessage(agentId, content) {
    if (!this.webContents || this.webContents.isDestroyed()) {
      logger.warn('pushProactiveMessage: webContents 不可用，消息未推送', { agentId });
      return;
    }

    // 如果该 Agent 当前有活跃的用户对话（流式响应中），排队等待
    if (this.activeTasks.has(agentId)) {
      if (!this._proactiveQueue.has(agentId)) {
        this._proactiveQueue.set(agentId, []);
      }
      this._proactiveQueue.get(agentId).push({ content, timestamp: Date.now() });
      const agent = this.getAgent(agentId);
      logger.info(`主动推送消息已排队（Agent 会话中）: ${agent?.name || agentId} → 老板`, {
        contentLength: content.length,
        queueSize: this._proactiveQueue.get(agentId).length,
      });
      return;
    }

    this._sendProactiveMessage(agentId, content);
  }

  /**
   * 实际发送主动推送消息（不检查排队）
   * @param {string} agentId
   * @param {string} content
   * @param {number} [timestamp]
   */
  _sendProactiveMessage(agentId, content, timestamp) {
    if (!this.webContents || this.webContents.isDestroyed()) return;

    const agent = this.getAgent(agentId);
    const agentName = agent?.name || agentId;

    this.webContents.send('agent:proactive-message', {
      agentId,
      agentName,
      content,
      timestamp: timestamp || Date.now(),
    });

    logger.info(`主动推送消息: ${agentName} → 老板`, { contentLength: content.length });
  }

  /**
   * 冲洗排队的主动推送消息（在 Agent 会话结束后调用）
   * @param {string} agentId
   */
  _flushProactiveQueue(agentId) {
    const queue = this._proactiveQueue.get(agentId);
    if (!queue || queue.length === 0) return;

    logger.info(`冲洗排队消息: ${agentId}`, { count: queue.length });
    this._proactiveQueue.delete(agentId);

    // 延迟 500ms 发送，让前端有时间处理完当前流式响应
    setTimeout(() => {
      for (const msg of queue) {
        this._sendProactiveMessage(agentId, msg.content, msg.timestamp);
      }
    }, 500);
  }

  /**
   * 从主进程创建群聊（Agent 拉群）
   * 通过 IPC 推送到渲染进程，由前端 chat-store 创建
   * @param {Object} params
   * @param {string} params.name - 群聊名称
   * @param {string[]} params.participants - 参与者 Agent ID 列表
   * @param {string} params.creatorId - 创建者 Agent ID
   * @param {string} [params.initialMessage] - 初始消息
   * @returns {{ success: boolean, groupId?: string, error?: string }}
   */
  createGroupFromBackend({ name, participants, creatorId, initialMessage }) {
    if (!this.webContents || this.webContents.isDestroyed()) {
      logger.warn('createGroupFromBackend: webContents 不可用');
      return { success: false, error: 'UI 未就绪，无法创建群聊' };
    }

    // 生成群聊 ID
    const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const creator = this.getAgent(creatorId);
    const creatorName = creator?.name || creatorId;

    const CHANNELS = require('../../shared/ipc-channels');
    this.webContents.send(CHANNELS.CHAT_CREATE_GROUP, {
      groupId,
      name,
      participants,
      creatorId,
      creatorName,
      initialMessage,
    });

    logger.info(`后端创建群聊: ${name} (${groupId})`, {
      creator: creatorName,
      participants,
    });

    return { success: true, groupId };
  }

  /**
   * 获取 Agent
   * @param {string} agentId
   * @returns {import('./chat-agent').ChatAgent | null}
   */
  getAgent(agentId) {
    return this.agents.get(agentId) ?? null;
  }

  /**
   * 获取所有 Agent 信息
   * @returns {Array<Object>}
   */
  getAgentList() {
    return Array.from(this.agents.values()).map((a) => a.getInfo());
  }

  /**
   * 注册新 Agent
   * @param {import('./chat-agent').ChatAgent} agent
   */
  registerAgent(agent) {
    if (this.llmManager) {
      agent.setLLMManager(this.llmManager);
    }
    this.agents.set(agent.id, agent);
    logger.info(`注册 Agent: ${agent.id}`, { name: agent.name });
  }

  /**
   * 注销 Agent
   * @param {string} agentId
   * @param {Object} [options] - 选项
   * @param {boolean} [options.cleanupResources=false] - 是否清理相关资源（开除时应为 true）
   * @returns {boolean}
   */
  unregisterAgent(agentId, options = {}) {
    const { cleanupResources = false } = options;

    // 从 agents Map 中删除
    const deleted = this.agents.delete(agentId);
    if (deleted) {
      logger.info(`注销 Agent: ${agentId}`);
    }

    // 如果需要清理资源（开除场景）
    if (cleanupResources) {
      // 1. 中止该 Agent 的活跃任务
      this._abortTask(agentId, 'Agent 已开除');

      // 2. 清理主动推送队列
      if (this._proactiveQueue.has(agentId)) {
        this._proactiveQueue.delete(agentId);
        logger.debug(`已清理 Agent ${agentId} 的主动推送队列`);
      }

      // 3. 清理 Agent 通信队列
      try {
        const { agentCommunication } = require('../collaboration/agent-communication');
        agentCommunication.clearAgentQueues(agentId);
      } catch (e) {
        logger.warn('清理通信队列失败:', e.message);
      }

      // 4. 清理预算配置
      try {
        const { budgetManager } = require('../budget/budget-manager');
        budgetManager.removeAgentBudget(agentId);
        logger.debug(`已清理 Agent ${agentId} 的预算配置`);
      } catch (e) {
        logger.warn('清理预算配置失败:', e.message);
      }

      // 5. 清理 TODO 列表
      try {
        const { todoStore } = require('../tools/todo-store');
        todoStore.removeAgent(agentId);
        logger.debug(`已清理 Agent ${agentId} 的 TODO 列表`);
      } catch (e) {
        logger.warn('清理 TODO 列表失败:', e.message);
      }

      logger.info(`Agent ${agentId} 相关资源已清理完毕`);
    }

    return deleted;
  }

  // ─────────────────────────────────────────────────────────────
  // 任务追踪与终止
  // ─────────────────────────────────────────────────────────────

  /**
   * 注册一个活跃任务
   * @param {string} agentId
   * @param {Object} info - { conversationId, messageId, task, stage }
   * @returns {{taskId: string, abortController: AbortController}}
   */
  _startTask(agentId, info) {
    // 如果该 Agent 已有活跃任务，先中止旧任务
    this._abortTask(agentId, '新任务覆盖');

    const abortController = new AbortController();
    const agent = this.getAgent(agentId);
    // 生成唯一任务 ID，用于防止 _finishTask 误删新任务
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.activeTasks.set(agentId, {
      taskId,
      agentId,
      agentName: agent?.name || agentId,
      conversationId: info.conversationId,
      messageId: info.messageId,
      task: info.task?.slice(0, 200) || '', // 截断任务描述
      startTime: Date.now(),
      stage: info.stage || 'thinking', // thinking | tools | responding
      abortController,
    });
    logger.info(`任务开始: ${agent?.name || agentId}`, { taskId, task: info.task?.slice(0, 50) });
    return { taskId, abortController };
  }

  /**
   * 更新任务阶段
   * @param {string} agentId
   * @param {string} stage
   */
  _updateTaskStage(agentId, stage) {
    const task = this.activeTasks.get(agentId);
    if (task) {
      task.stage = stage;
    }
  }

  /**
   * 完成任务（移除追踪）
   * @param {string} agentId
   * @param {string} [taskId] - 任务 ID，如果提供则只删除匹配的任务
   */
  _finishTask(agentId, taskId) {
    const task = this.activeTasks.get(agentId);
    if (task) {
      // 如果提供了 taskId，只有匹配时才删除（防止误删新任务）
      if (taskId && task.taskId !== taskId) {
        logger.debug(`_finishTask: taskId 不匹配，跳过删除`, {
          agentId,
          expectedTaskId: taskId,
          currentTaskId: task.taskId,
        });
        return;
      }

      const elapsed = Date.now() - task.startTime;
      logger.info(`任务完成: ${task.agentName}`, { taskId: task.taskId, elapsed: `${elapsed}ms` });
      this.activeTasks.delete(agentId);

      // 冲洗排队的主动推送消息
      this._flushProactiveQueue(agentId);
    }
  }

  /**
   * 中止 Agent 的当前任务
   * @param {string} agentId
   * @param {string} [reason] - 中止原因
   * @returns {boolean} 是否成功中止
   */
  _abortTask(agentId, reason) {
    const task = this.activeTasks.get(agentId);
    if (!task) return false;

    logger.info(`任务中止: ${task.agentName}`, { reason: reason || '用户终止' });
    if (task.abortController && typeof task.abortController.abort === 'function') {
      task.abortController.abort(reason || '用户终止');
    }
    this.activeTasks.delete(agentId);

    // 中止后也要冲洗排队消息（除非是新任务覆盖，那种情况新任务会继续阻塞队列）
    if (reason !== '新任务覆盖') {
      this._flushProactiveQueue(agentId);
    }
    return true;
  }

  /**
   * 用户请求终止指定 Agent 的任务
   * @param {string} agentId
   * @returns {{ success: boolean, message: string }}
   */
  abortAgentTask(agentId) {
    const agent = this.getAgent(agentId);
    const agentName = agent?.name || agentId;

    if (!this.activeTasks.has(agentId)) {
      return { success: false, message: `${agentName} 当前没有进行中的任务` };
    }

    this._abortTask(agentId, '用户手动终止');
    return { success: true, message: `已终止 ${agentName} 的当前任务` };
  }

  /**
   * 获取所有活跃任务状态（供前端展示）
   * @returns {Array<Object>}
   */
  getActiveTasksList() {
    const tasks = [];
    for (const [agentId, task] of this.activeTasks) {
      tasks.push({
        agentId,
        agentName: task.agentName,
        conversationId: task.conversationId,
        task: task.task,
        startTime: task.startTime,
        elapsed: Date.now() - task.startTime,
        stage: task.stage,
      });
    }
    return tasks;
  }

  /**
   * 生成当前权限的上下文描述，注入到工具提示中
   * 让 Agent 知道自己能访问哪些目录、哪些功能已启用
   * @returns {string}
   */
  _getPermissionContext() {
    const perms = permissionStore.get();
    const lines = ['【当前权限与可访问路径】'];

    // 文件访问
    const paths = perms.files?.allowedPaths ?? [];
    if (paths.length > 0) {
      lines.push(`- 可访问目录（文件操作必须在这些目录之下）：`);
      for (const p of paths) {
        lines.push(`  • ${p}`);
      }
      lines.push(`- 文件写入：${perms.files?.writeEnabled ? '已启用' : '未启用'}`);
    } else {
      lines.push('- 文件访问：用户尚未配置任何可访问目录。请提醒用户在 SoloForge 设置中添加项目目录。');
    }

    // Shell
    lines.push(`- Shell 命令：${perms.shell?.enabled ? '已启用' : '未启用'}`);

    // Git
    lines.push(`- Git 操作：${perms.git?.enabled ? '已启用' : '未启用'}`);

    // 网络
    lines.push(`- 网络搜索：${perms.network?.searchEnabled ? '已启用' : '未启用'}`);

    lines.push('');
    lines.push('重要：使用 list_files、read_file、write_file 工具时，path 参数必须是上述"可访问目录"下的绝对路径，否则会被权限系统拒绝。');

    return lines.join('\n');
  }

  /**
   * 获取 Agent 可用的原始工具定义列表（用于传递给 LLM Provider 的原生工具调用）
   * @param {string} agentId
   * @returns {Array<Object>} 过滤后的工具定义对象数组
   */
  getToolDefinitionsForAgent(agentId) {
    const allTools = toolRegistry.getAll();
    const agent = this.getAgent(agentId);
    const agentConfig = agentConfigStore.get(agentId);

    const agentStatus = agentConfig?.status || 'active';
    if (agentStatus === 'suspended' || agentStatus === 'terminated') {
      return [];
    }

    let availableTools = allTools;
    const role = agent?.role || agentConfig?.role;
    const level = agentConfig?.level;

    if (role !== 'cfo') {
      availableTools = availableTools.filter((t) => t.category !== 'cfo');
    }
    if (role !== 'chro') {
      availableTools = availableTools.filter((t) => t.category !== 'hr');
    }
    const cxoRoles = ['ceo', 'cto', 'cfo'];
    const isCxo = cxoRoles.includes(role) || level === 'c_level';
    if (!isCxo && role !== 'chro') {
      availableTools = availableTools.filter((t) => t.category !== 'recruit');
    }
    if (role !== 'secretary') {
      availableTools = availableTools.filter((t) => t.category !== 'dismiss_confirm');
    }
    const isLeader = isCxo || ['manager', 'director', 'vp'].includes(level);
    if (!isLeader) {
      availableTools = availableTools.filter((t) => t.category !== 'dev_plan_review');
    }
    if (!isCxo && role !== 'chro') {
      availableTools = availableTools.filter((t) => t.category !== 'suspension');
    }
    if (role !== 'secretary' && !isCxo && role !== 'chro') {
      availableTools = availableTools.filter((t) => t.category !== 'group_chat');
    }

    return availableTools;
  }

  /**
   * 获取 Agent 可用的工具描述（XML Schema 格式，用于注入 prompt）
   * @param {string} agentId
   * @returns {string}
   */
  getToolsForAgent(agentId) {
    const availableTools = this.getToolDefinitionsForAgent(agentId);
    if (availableTools.length === 0) {
      return '';
    }
    return toolRegistry.getToolCallSchema(availableTools);
  }

  /**
   * 获取分页优化后的历史消息
   * 支持两种模式：
   *   1. Token 预算模式（传 model + contextualMessage）—— 动态裁剪，推荐
   *   2. 固定条数模式（不传 model）—— 向后兼容，退化为 PAGE_SIZE=30
   * 
   * @param {Array} fullHistory - 完整历史
   * @param {string} conversationId - 对话 ID
   * @param {Object} [budgetParams] - token 预算相关参数
   * @param {string} [budgetParams.model] - 模型标识符
   * @param {string} [budgetParams.systemPrompt] - 系统提示词（用于估算 token 占用）
   * @param {string} [budgetParams.contextualMessage] - 当前用户消息（含注入上下文，用于估算 token 占用）
   * @returns {{ paginatedHistory: Array, historyInfo: string, hasMoreHistory: boolean, totalMessages: number, shownMessages: number }}
   */
  getPaginatedHistory(fullHistory, conversationId, budgetParams) {
    // 设置完整历史供 load_history 工具使用
    setConversationHistory(conversationId, fullHistory);

    // 计算 token 预算（如果提供了 model 信息）
    let tokenBudget;
    if (budgetParams?.model && budgetParams?.systemPrompt) {
      const systemPromptTokens = estimateTokens(budgetParams.systemPrompt);
      const userMessageTokens = estimateTokens(budgetParams.contextualMessage || '');
      tokenBudget = getAvailableBudget({
        model: budgetParams.model,
        systemPromptTokens,
        userMessageTokens,
      });
      logger.debug('getPaginatedHistory: token 预算模式', {
        model: budgetParams.model,
        systemPromptTokens,
        userMessageTokens,
        tokenBudget,
      });
    }

    // 获取优化后的历史
    const optimized = historyManager.getOptimizedHistory(
      fullHistory,
      conversationId,
      { recentCount: PAGE_SIZE, tokenBudget, includeSummary: true }
    );

    return {
      paginatedHistory: optimized.messages,
      historyInfo: optimized.historyInfo,
      hasMoreHistory: optimized.hasMoreHistory,
      totalMessages: optimized.totalMessages,
      shownMessages: optimized.shownMessages,
    };
  }

  /**
   * 带工具调用循环的消息处理
   * @param {import('./chat-agent').ChatAgent} agent
   * @param {string} userMessage
   * @param {Array} history
   * @param {Object} context
   * @returns {Promise<string>}
   */
  async _chatWithToolLoop(agent, userMessage, history, context = {}) {
    // CXO 级别不限制工具调用次数，其他 Agent 限制 100 次
    const agentConfig = agentConfigStore.get(agent.id);
    const isCxoLevel = agentConfig?.level === 'c_level' || 
                       ['ceo', 'cto', 'cfo', 'chro', 'secretary'].includes(agent.role);
    const MAX_TOOL_ITERATIONS = isCxoLevel ? Infinity : 100;
    
    let currentHistory = [...history];
    // 注入本轮行动提醒
    let currentMessage = `${this._getTurnReminder()}\n\n${userMessage}`;
    let finalContent = '';
    let iteration = 0;

    // 支持取消：从 activeTasks 中获取 AbortController
    const taskInfo = this.activeTasks.get(agent.id);
    const signal = taskInfo?.abortController?.signal;

    // 获取 Agent 可用的工具 schema
    const toolSchema = this.getToolsForAgent(agent.id);

    // 第 4 层防御：检查是否需要注入停职提示（替代工具 schema）
    const suspendConfig = agentConfigStore.get(agent.id);
    const isSuspended = (suspendConfig?.status === 'suspended' || suspendConfig?.status === 'terminated');
    const suspensionNotice = isSuspended
      ? `\n\n---\n\n【重要通知】你目前处于停职状态，所有工具权限已被冻结，无法与同事沟通。如需申诉，请直接与老板对话。\n停职原因：${suspendConfig?.suspendReason || '未说明'}`
      : '';

    while (iteration < MAX_TOOL_ITERATIONS) {
      // 检查是否已被取消
      if (signal?.aborted) {
        logger.info(`ChatManager: ${agent.name} 非流式工具循环被取消`);
        finalContent += '\n\n（操作已被用户取消）';
        break;
      }

      iteration++;

      // 第一轮注入完整工具说明 + 权限上下文；后续轮次注入简短提醒
      let messageWithTools = currentMessage;
      if (isSuspended && iteration === 1) {
        // 停职：注入停职提示替代工具 schema
        messageWithTools = `${currentMessage}${suspensionNotice}`;
      } else if (toolSchema && iteration === 1) {
        const permContext = this._getPermissionContext();
        messageWithTools = `${currentMessage}\n\n---\n\n${permContext}\n\n【可用工具】\n${toolSchema}`;
      } else if (toolSchema && iteration > 1) {
        messageWithTools = `${currentMessage}\n\n---\n提醒：你仍然可以继续使用工具。如需调用工具，请使用 <tool_call><name>工具名</name><arguments><参数名>参数值</参数名></arguments></tool_call> 格式。不要仅用文字描述你"打算"做什么——必须输出 <tool_call> 标签才能执行。`;
      }

      // 调用 Agent（第一轮传入图片附件），含上下文超限降级重试
      const nonStreamOptions = { stream: false };
      if (iteration === 1 && context.attachments?.length > 0) {
        nonStreamOptions.attachments = context.attachments;
      }
      // 传递原始工具定义，供 Provider 使用原生工具调用 API
      if (toolSchema) {
        nonStreamOptions.tools = this.getToolDefinitionsForAgent(agent.id);
      }
      let response;
      try {
        response = await agent.chat(messageWithTools, currentHistory, nonStreamOptions);
      } catch (chatErr) {
        if (isContextTooLongError(chatErr) && currentHistory.length > 0) {
          // 降级策略：先减半历史，再试无历史
          logger.warn(`ChatManager: ${agent.name} 上下文超限，尝试减半历史重试`, {
            historyLen: currentHistory.length,
            error: chatErr.message,
          });
          const halvedHistory = currentHistory.slice(-Math.floor(currentHistory.length / 2));
          try {
            response = await agent.chat(messageWithTools, halvedHistory, nonStreamOptions);
            currentHistory = halvedHistory; // 成功后更新历史为减半版本
          } catch (retryErr) {
            if (isContextTooLongError(retryErr)) {
              logger.warn(`ChatManager: ${agent.name} 减半历史仍超限，无历史重试`);
              response = await agent.chat(messageWithTools, [], nonStreamOptions);
              currentHistory = [];
            } else {
              throw retryErr;
            }
          }
        } else {
          throw chatErr;
        }
      }

      // 再次检查取消（LLM 调用期间可能被取消）
      if (signal?.aborted) {
        logger.info(`ChatManager: ${agent.name} 非流式工具循环被取消（LLM 返回后）`);
        finalContent += '\n\n（操作已被用户取消）';
        break;
      }

      // 第 2 层防御：停职 Agent 即使生成了工具调用也跳过解析
      const runtimeConfig = agentConfigStore.get(agent.id);
      const runtimeStatus = runtimeConfig?.status || 'active';
      if (runtimeStatus === 'suspended' || runtimeStatus === 'terminated') {
        finalContent = removeToolCalls(response) || response;
        break;
      }

      // 检查是否有工具调用
      if (!hasToolCalls(response)) {
        // 没有工具调用，返回最终内容
        finalContent = response;
        break;
      }

      logger.info(`ChatManager: ${agent.name} 第 ${iteration} 轮工具调用`);

      // 解析工具调用
      const toolCalls = parseToolCalls(response);
      const textContent = removeToolCalls(response);

      // 如果有文本内容（工具调用前的说明），先记录
      if (textContent) {
        finalContent += textContent + '\n\n';
      }

      // 执行工具
      if (this.toolExecutor && toolCalls.length > 0) {
        const toolResults = await this.toolExecutor.executeToolCalls(toolCalls, {
          agentId: agent.id,
          agentName: agent.name,
          ...context,
        });

        // 格式化工具结果（传入 sessionId 用于虚拟文件关联）
        const formattedResults = this.toolExecutor.formatToolResults(toolResults, {
          sessionId: context.conversationId,
        });

        // 更新历史，添加 Agent 响应和工具结果
        currentHistory = [
          ...currentHistory,
          { role: 'assistant', content: response },
          { role: 'user', content: `工具执行结果：\n\n${formattedResults}` },
        ];

        // 工具循环上下文压缩：防止多轮工具调用导致上下文超限
        const toolBudget = getAvailableBudget({
          model: agent.model,
          systemPromptTokens: estimateTokens(agent.systemPrompt),
          userMessageTokens: estimateTokens(currentMessage),
        });
        const { compressed, wasCompressed } = compressToolHistory(
          currentHistory, 
          toolBudget,
          { sessionId: context.conversationId, taskContext: userMessage?.slice(0, 100) }
        );
        if (wasCompressed) {
          currentHistory = compressed;
          logger.info(`ChatManager: ${agent.name} 第 ${iteration} 轮工具循环上下文已压缩`);
        }

        // 下一轮使用工具结果提示
        currentMessage = '请根据以上工具执行结果继续回答。';

        logger.info(`ChatManager: 工具执行完成`, {
          tools: toolCalls.map((t) => t.name),
          resultsLength: formattedResults.length,
        });
      } else {
        // 没有工具执行器或没有工具调用，直接返回
        finalContent = response;
        break;
      }
    }

    if (iteration >= MAX_TOOL_ITERATIONS) {
      logger.warn(`ChatManager: ${agent.name} 达到最大工具调用轮数`);
      finalContent += '\n\n（已达到最大工具调用次数）';
    }

    return finalContent;
  }

  /**
   * 处理聊天消息
   * @param {Object} request
   * @param {string} request.conversationId - 对话 ID
   * @param {string} request.agentId - Agent ID
   * @param {string} request.message - 用户消息
   * @param {Array} request.history - 对话历史
   * @returns {Promise<{ content: string, delegatedTo?: string }>}
   */
  async handleMessage(request) {
    const { conversationId, agentId, message, history = [], attachments } = request;

    // 检查 Agent 状态
    const agentConfig = agentConfigStore.get(agentId);
    if (agentConfig) {
      const agentStatus = agentConfig.status || 'active';
      if (agentStatus === AGENT_STATUS.TERMINATED) {
        return { content: `「${agentConfig.name || agentId}」已离职，无法响应消息。` };
      }
      if (agentStatus === AGENT_STATUS.SUSPENDED) {
        return { content: `「${agentConfig.name || agentId}」目前处于停职状态，无法响应消息。停职原因：${agentConfig.suspendReason || '未说明'}` };
      }
    }

    const agent = this.getAgent(agentId);
    if (!agent) {
      logger.error(`ChatManager: Agent ${agentId} 不存在`);
      return { content: `抱歉，找不到对应的员工 (${agentId})` };
    }

    if (!this.llmManager) {
      logger.error('ChatManager: LLM Manager 未设置');
      return { content: '抱歉，AI 服务暂时不可用' };
    }

    // 注册活跃任务，获取 taskId 用于完成时匹配
    const { taskId } = this._startTask(agentId, {
      conversationId,
      task: message,
      stage: 'thinking',
    });

    try {
      logger.info(`ChatManager: ${agent.name} 处理消息`, { conversationId, message: message.slice(0, 50) });

      // 先构建 contextualMessage（不含 historyInfo），用于 token 预算计算
      let contextualMessage = message;

      // 注入 Agent 最近的内部通信记录
      const commContext = this._getRecentCommunicationContext(agentId);
      if (commContext) {
        contextualMessage = `${commContext}\n\n---\n\n${contextualMessage}`;
      }

      // 注入记忆系统的相关记忆
      const mm = getMemoryManager();
      if (mm && mm._initialized) {
        try {
          const memoryContext = mm.getContextForAgent(agentId, message, conversationId);
          if (memoryContext) {
            contextualMessage = `${memoryContext}\n\n---\n\n${contextualMessage}`;
          }
        } catch (memError) {
          logger.debug('记忆注入失败（不影响对话）:', memError.message);
        }
      }

      // 获取分页优化后的历史（使用 token 预算模式）
      const { paginatedHistory, historyInfo, hasMoreHistory, totalMessages, shownMessages } = 
        this.getPaginatedHistory(history, conversationId, {
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          contextualMessage,
        });

      // 清洗历史消息：去除工具调用标记，避免 LLM 混淆历史工具调用和当前轮次
      const cleanedHistory = this._cleanHistoryForLLM(paginatedHistory);

      // 如果有历史信息提示，添加到消息前缀
      if (historyInfo) {
        contextualMessage = `${historyInfo}\n\n---\n\n${contextualMessage}`;
      }

      logger.debug('历史分页信息', {
        conversationId,
        totalMessages,
        shownMessages,
        hasMoreHistory,
      });

      // 秘书特殊处理：只在私聊中检测是否需要委派
      // 群聊中不自动委派，因为群聊的规则是"只有被 @的人才能回复"
      const isGroupChat = message.startsWith('[群聊:');
      
      if (agentId === 'secretary' && agent.analyzeForDelegation && !isGroupChat) {
        const delegation = agent.analyzeForDelegation(message);
        
        if (delegation.shouldDelegate && delegation.delegateTo) {
          const delegateAgent = this.getAgent(delegation.delegateTo);
          
          if (delegateAgent) {
            logger.info(`ChatManager: 秘书委派给 ${delegateAgent.name}`, { reason: delegation.reason });
            
            // 先让秘书说明委派情况
            const secretaryIntro = `好的老板，这个问题涉及${delegation.reason}，我来安排 ${delegateAgent.name} 为您处理。\n\n---\n\n`;
            
            // 调用被委派的 Agent（带工具循环），使用分页后的历史
            const delegateResponse = await this._chatWithToolLoop(
              delegateAgent,
              contextualMessage,
              cleanedHistory,
              { conversationId }
            );
            
            logger.info(`ChatManager: ${delegateAgent.name} 响应完成`, { contentLength: delegateResponse.length });
            
            return { 
              content: secretaryIntro + `**${delegateAgent.name}：**\n\n${delegateResponse}`,
              delegatedTo: delegation.delegateTo,
            };
          }
        }
      }

      // 带工具调用循环的消息处理
      const content = await this._chatWithToolLoop(
        agent,
        contextualMessage,
        cleanedHistory,
        { conversationId }
      );

      logger.info(`ChatManager: ${agent.name} 响应完成`, { contentLength: content.length });

      return { content };
    } catch (error) {
      logger.error(`ChatManager: ${agent.name} 处理失败`, error);
      return {
        content: `抱歉老板，我在处理您的请求时遇到了问题：${error.message || '未知错误'}`,
      };
    } finally {
      this._finishTask(agentId, taskId);
    }
  }

  /**
   * 获取 Agent 最近的内部通信记录，注入到对话上下文中
   * 按条数分页，最近 PAGE_SIZE 条直接注入，更早的告知 Agent 可用工具查询
   * @param {string} agentId
   * @returns {string | null}
   */
  /**
   * 清洗历史消息，去除工具调用标记和中间产物
   * 避免 LLM 把历史中的工具调用误认为当前轮次已完成的操作
   * @param {Array<{role: string, content: string}>} history
   * @returns {Array<{role: string, content: string}>}
   */
  /**
   * 每轮用户消息前的行动提醒
   * 放在 user message 正前方，处于 LLM 注意力最集中的位置
   */
  _getTurnReminder() {
    return `【本轮行动提醒】
这是一条新消息，请认真阅读用户的最新消息并直接回应。
- 如果历史对话中已有相关信息（如之前已询问过同事并得到回复），请直接引用那些结果，不要重复调用工具
- 只有当你需要获取新的、历史中没有的信息时，才调用工具
- 不要说"我已经做了"来指代本轮没做的事，但可以引用历史中已有的工具返回结果`;
  }

  _cleanHistoryForLLM(history) {
    if (!history || history.length === 0) return history;

    return history.map((msg) => {
      if (!msg.content || typeof msg.content !== 'string') return msg;

      let cleaned = msg.content;

      // 去除 "_正在查询: xxx, yyy..._" 标记
      cleaned = cleaned.replace(/_正在查询:.*?\.{3}_/g, '');
      // 去除 "正在查询: xxx..." 的非斜体版本
      cleaned = cleaned.replace(/正在查询:.*?\.{3}/g, '');

      // 去除 "（已达到最大工具调用次数）"
      cleaned = cleaned.replace(/（已达到最大工具调用次数）/g, '');

      // 去除 "（任务已被终止）" / "_（任务已被终止）_"
      cleaned = cleaned.replace(/_?（任务已被终止[^）]*）_?/g, '');

      // 去除 <tool_call>...</tool_call> 块（如果残留在历史里）
      cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
      // 去除 <tool_result>...</tool_result> 块
      cleaned = cleaned.replace(/<tool_result[\s\S]*?<\/tool_result>/g, '');

      // 去除工具执行结果注入的 "工具执行结果：" 块
      cleaned = cleaned.replace(/工具执行结果：[\s\S]*$/g, '');

      // 清理多余空行（连续 3 个以上换行 → 2 个）
      cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

      // 如果清洗后内容为空，保留一个占位
      if (!cleaned) {
        cleaned = msg.role === 'assistant' ? '（之前的回复）' : '（之前的消息）';
      }

      return { ...msg, content: cleaned };
    });
  }

  _getRecentCommunicationContext(agentId) {
    const PAGE_SIZE = 5; // 直接注入的最近条数

    try {
      const { agentCommunication } = require('../collaboration/agent-communication');

      // 获取该 Agent 所有已完成的通信（按时间正序）
      const allMessages = agentCommunication.getMessages(agentId, { limit: 200 });
      const responded = allMessages.filter((m) => m.status === 'responded');

      if (responded.length === 0) return null;

      const totalCount = responded.length;
      // 取最近 PAGE_SIZE 条
      const recentPage = responded.slice(-PAGE_SIZE);

      const lines = [];

      // 分页提示：如果有更早的记录，告知 Agent 可以工具查询
      if (totalCount > PAGE_SIZE) {
        lines.push(
          `【内部通信记录】共 ${totalCount} 条，当前显示最近 ${recentPage.length} 条。` +
          `如需查看更早记录，请使用 browse_communication_history 工具翻页查询。`
        );
      } else {
        lines.push(`【内部通信记录】共 ${totalCount} 条：`);
      }
      lines.push('');

      for (let i = 0; i < recentPage.length; i++) {
        const msg = recentPage[i];
        const idx = totalCount - recentPage.length + i + 1; // 全局编号
        const time = new Date(msg.timestamp).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        // 显示通信对象名称（如有）
        const peerAgent = msg.fromAgent === agentId ? msg.toAgent : msg.fromAgent;
        const direction = msg.fromAgent === agentId ? `你 → ${peerAgent}` : `${peerAgent} → 你`;

        // 消息和回复均截断，避免上下文过长
        const msgText = msg.message?.length > 120 ? msg.message.slice(0, 120) + '...' : (msg.message || '');
        const respText = msg.response?.length > 200 ? msg.response.slice(0, 200) + '...' : (msg.response || '');

        lines.push(`#${idx} [${time}] ${direction}`);
        lines.push(`  消息: ${msgText}`);
        if (respText) {
          lines.push(`  回复: ${respText}`);
        }
        lines.push('');
      }

      return lines.join('\n');
    } catch (error) {
      logger.debug('获取内部通信上下文失败:', error.message);
      return null;
    }
  }

  /**
   * 流式输出时的智能缓冲处理
   * 过滤 <tool_call> 和 <thinking> 标签，避免将内部内容推送到前端
   */
  _createStreamBuffer() {
    // 需要过滤的标签对
    const FILTER_TAGS = [
      { start: '<tool_call>', end: '</tool_call>' },
      { start: '<thinking>', end: '</thinking>' },
    ];

    return {
      buffer: '',
      currentTag: null, // 当前处于哪个标签内部

      /**
       * 检查字符串是否是某个过滤标签的有效前缀
       * @param {string} str
       * @returns {boolean}
       */
      _isFilterTagPrefix(str) {
        if (!str.startsWith('<')) return false;
        
        for (const tag of FILTER_TAGS) {
          if (tag.start.startsWith(str) || tag.end.startsWith(str)) {
            return true;
          }
        }
        return false;
      },

      /**
       * 查找最早出现的过滤标签
       * @param {string} text
       * @returns {{ tag: Object, index: number } | null}
       */
      _findFirstFilterTag(text) {
        let earliest = null;
        
        for (const tag of FILTER_TAGS) {
          const idx = text.indexOf(tag.start);
          if (idx !== -1 && (earliest === null || idx < earliest.index)) {
            earliest = { tag, index: idx };
          }
        }
        
        return earliest;
      },

      /**
       * 处理新的 chunk
       * @param {string} chunk
       * @returns {{ toSend: string }}
       */
      process(chunk) {
        this.buffer += chunk;
        let toSend = '';

        // 持续处理直到无法继续
        let processing = true;
        while (processing && this.buffer.length > 0) {
          if (this.currentTag) {
            // 在某个过滤标签内，查找对应的结束标签
            const endIdx = this.buffer.indexOf(this.currentTag.end);
            if (endIdx !== -1) {
              // 找到结束标签，丢弃标签内容（包括结束标签）
              this.buffer = this.buffer.slice(endIdx + this.currentTag.end.length);
              this.currentTag = null;
              // 继续处理剩余内容
            } else {
              // 还没找到结束标签，等待更多数据
              processing = false;
            }
          } else {
            // 不在任何过滤标签中，查找开始标签
            const found = this._findFirstFilterTag(this.buffer);
            
            if (found) {
              // 找到开始标签，发送标签之前的内容
              if (found.index > 0) {
                toSend += this.buffer.slice(0, found.index);
              }
              // 跳过开始标签，进入标签内部模式
              this.buffer = this.buffer.slice(found.index + found.tag.start.length);
              this.currentTag = found.tag;
              // 继续处理（寻找结束标签）
            } else {
              // 没有找到完整的开始标签
              // 检查结尾是否有可能是某个过滤标签的不完整前缀
              let safeLength = this.buffer.length;
              
              // 计算需要保留检查的最大长度
              const maxTagLen = Math.max(...FILTER_TAGS.map(t => t.start.length));
              
              // 从后往前检查
              for (let i = Math.max(0, this.buffer.length - maxTagLen); i < this.buffer.length; i++) {
                const suffix = this.buffer.slice(i);
                if (this._isFilterTagPrefix(suffix)) {
                  safeLength = i;
                  break;
                }
              }
              
              if (safeLength > 0) {
                toSend += this.buffer.slice(0, safeLength);
              }
              this.buffer = this.buffer.slice(safeLength);
              processing = false;
            }
          }
        }

        return { toSend };
      },

      /**
       * 刷新剩余内容（流结束时调用）
       * @returns {string}
       */
      flush() {
        // 如果还在过滤标签中，不输出
        if (this.currentTag) {
          this.buffer = '';
          return '';
        }
        // 缓冲区的剩余内容直接输出（流已结束，不会再有更多数据）
        const remaining = this.buffer;
        this.buffer = '';
        return remaining;
      },
    };
  }

  /**
   * 处理流式聊天消息（带工具调用支持，智能过滤工具标签）
   * @param {Object} request
   * @param {string} request.conversationId - 对话 ID
   * @param {string} request.agentId - Agent ID
   * @param {string} request.message - 用户消息
   * @param {string} request.messageId - 消息 ID（用于流式更新）
   * @param {Array} request.history - 对话历史
   * @returns {Promise<{ content: string }>}
   */
  async handleStreamMessage(request) {
    const { conversationId, agentId, message, messageId, history = [], attachments } = request;
    const CHANNELS = require('../../shared/ipc-channels');

    // 检查 Agent 状态
    const streamAgentConfig = agentConfigStore.get(agentId);
    if (streamAgentConfig) {
      const agentStatus = streamAgentConfig.status || 'active';
      if (agentStatus === AGENT_STATUS.TERMINATED) {
        return { content: `「${streamAgentConfig.name || agentId}」已离职，无法响应消息。` };
      }
      if (agentStatus === AGENT_STATUS.SUSPENDED) {
        return { content: `「${streamAgentConfig.name || agentId}」目前处于停职状态，无法响应消息。停职原因：${streamAgentConfig.suspendReason || '未说明'}` };
      }
    }

    const agent = this.getAgent(agentId);
    if (!agent) {
      return { content: `抱歉，找不到对应的员工 (${agentId})` };
    }

    if (!this.llmManager) {
      return { content: '抱歉，AI 服务暂时不可用' };
    }

    // CXO 级别不限制工具调用次数，其他 Agent 限制 100 次
    const isCxoLevel = streamAgentConfig?.level === 'c_level' || 
                       ['ceo', 'cto', 'cfo', 'chro', 'secretary'].includes(agent.role);
    const MAX_TOOL_ITERATIONS = isCxoLevel ? Infinity : 100;

    // 注册活跃任务并获取 AbortController 和 taskId
    const { taskId, abortController } = this._startTask(agentId, {
      conversationId,
      messageId,
      task: message,
      stage: 'thinking',
    });
    const signal = abortController.signal;

    try {
      // 先构建 contextualMessage（不含 historyInfo），用于 token 预算计算
      let contextualMessage = message;

      // 注入 Agent 最近的内部通信记录（让 Agent 记得和其他同事的讨论）
      const commContext = this._getRecentCommunicationContext(agentId);
      if (commContext) {
        contextualMessage = `${commContext}\n\n---\n\n${contextualMessage}`;
      }

      // 注入记忆系统的相关记忆
      const mm = getMemoryManager();
      if (mm && mm._initialized) {
        try {
          const memoryContext = mm.getContextForAgent(agentId, message, conversationId);
          if (memoryContext) {
            contextualMessage = `${memoryContext}\n\n---\n\n${contextualMessage}`;
          }
          // 通知记忆系统有新消息（用于触发提取）
          mm.onNewMessage(conversationId, agentId, history.slice(-10));
        } catch (memError) {
          logger.debug('记忆注入失败（不影响对话）:', memError.message);
        }
      }

      // 注入暂存区上下文（工作状态恢复）
      try {
        const { scratchpadManager } = require('../context/agent-scratchpad');
        const scratchpad = scratchpadManager.get(agentId);
        if (scratchpad.hasContent()) {
          contextualMessage = `${scratchpad.getContextSummary()}\n\n---\n\n${contextualMessage}`;
        }
      } catch (scratchpadError) {
        logger.debug('暂存区注入失败（不影响对话）:', scratchpadError.message);
      }

      // 获取分页优化后的历史（使用 token 预算模式）
      const { paginatedHistory, historyInfo } = this.getPaginatedHistory(history, conversationId, {
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        contextualMessage,
      });

      // 清洗历史消息：去除工具调用标记，避免 LLM 混淆过去的工具调用和当前轮次
      const cleanedHistory = this._cleanHistoryForLLM(paginatedHistory);

      // 如果有历史信息提示，添加到消息前缀
      if (historyInfo) {
        contextualMessage = `${historyInfo}\n\n---\n\n${contextualMessage}`;
      }

      // 注入本轮行动提醒（放在用户消息正前方，LLM 注意力最集中的位置）
      contextualMessage = `${this._getTurnReminder()}\n\n${contextualMessage}`;

      // 获取工具 schema
      const toolSchema = this.getToolsForAgent(agent.id);

      // 第 4 层防御：停职提示
      const streamSuspendConfig = agentConfigStore.get(agentId);
      const isStreamSuspended = (streamSuspendConfig?.status === 'suspended' || streamSuspendConfig?.status === 'terminated');
      const streamSuspensionNotice = isStreamSuspended
        ? `\n\n---\n\n【重要通知】你目前处于停职状态，所有工具权限已被冻结，无法与同事沟通。如需申诉，请直接与老板对话。\n停职原因：${streamSuspendConfig?.suspendReason || '未说明'}`
        : '';

      let currentHistory = [...cleanedHistory];
      let currentMessage = contextualMessage;
      let displayContent = ''; // 显示给用户的内容
      let iteration = 0;

      while (iteration < MAX_TOOL_ITERATIONS) {
        // 检查是否被中止
        if (signal.aborted) {
          const abortMsg = '\n\n_（任务已被终止）_';
          displayContent += abortMsg;
          if (this.webContents && !this.webContents.isDestroyed()) {
            this.webContents.send(CHANNELS.CHAT_STREAM, { messageId, content: abortMsg });
          }
          break;
        }

        iteration++;
        this._updateTaskStage(agentId, iteration === 1 ? 'thinking' : 'responding');

        // 第一轮注入完整工具说明 + 权限上下文；后续轮次注入简短提醒
        let messageWithTools = currentMessage;
        if (isStreamSuspended && iteration === 1) {
          messageWithTools = `${currentMessage}${streamSuspensionNotice}`;
        } else if (toolSchema && iteration === 1) {
          const permContext = this._getPermissionContext();
          messageWithTools = `${currentMessage}\n\n---\n\n${permContext}\n\n【可用工具】\n${toolSchema}`;
        } else if (toolSchema && iteration > 1) {
          messageWithTools = `${currentMessage}\n\n---\n提醒：你仍然可以继续使用工具。如需调用工具，请使用 <tool_call><name>工具名</name><arguments><参数名>参数值</参数名></arguments></tool_call> 格式。不要仅用文字描述你"打算"做什么——必须输出 <tool_call> 标签才能执行。`;
        }

        // 流式调用（第一轮传入图片附件，后续轮次不传），含上下文超限降级重试
        logger.info(`ChatManager: ${agent.name} 开始流式调用`);
        const chatOptions = { stream: true, _streamUsage: {} };
        if (iteration === 1 && attachments?.length > 0) {
          chatOptions.attachments = attachments;
        }
        // 传递原始工具定义，供 Provider 使用原生工具调用 API
        if (toolSchema) {
          chatOptions.tools = this.getToolDefinitionsForAgent(agentId);
        }
        let stream;
        try {
          stream = await agent.chat(messageWithTools, currentHistory, chatOptions);
        } catch (streamChatErr) {
          if (isContextTooLongError(streamChatErr) && currentHistory.length > 0) {
            logger.warn(`ChatManager: ${agent.name} 流式上下文超限，尝试减半历史重试`, {
              historyLen: currentHistory.length,
              error: streamChatErr.message,
            });
            const halvedHistory = currentHistory.slice(-Math.floor(currentHistory.length / 2));
            try {
              stream = await agent.chat(messageWithTools, halvedHistory, chatOptions);
              currentHistory = halvedHistory;
            } catch (streamRetryErr) {
              if (isContextTooLongError(streamRetryErr)) {
                logger.warn(`ChatManager: ${agent.name} 流式减半历史仍超限，无历史重试`);
                stream = await agent.chat(messageWithTools, [], chatOptions);
                currentHistory = [];
              } else {
                throw streamRetryErr;
              }
            }
          } else {
            throw streamChatErr;
          }
        }
        let roundContent = ''; // 完整的原始响应（包含工具调用）
        const streamBuffer = this._createStreamBuffer();
        let chunkCount = 0;
        let aborted = false;

        // 逐块处理，智能过滤工具调用标签
        for await (const chunk of stream) {
          // 检查是否被中止
          if (signal.aborted) {
            aborted = true;
            break;
          }

          chunkCount++;
          roundContent += chunk;
          const { toSend } = streamBuffer.process(chunk);

          if (chunkCount <= 5) {
            logger.debug(`ChatManager: 流式块 ${chunkCount}`, { chunkLen: chunk.length, toSendLen: toSend?.length || 0 });
          }

          // 只推送非工具调用的内容
          if (toSend && this.webContents && !this.webContents.isDestroyed()) {
            this.webContents.send(CHANNELS.CHAT_STREAM, { messageId, content: toSend });
            displayContent += toSend;
          }
        }

        // 如果被中止，推送中止提示并退出循环
        if (aborted) {
          const abortMsg = '\n\n_（任务已被终止）_';
          displayContent += abortMsg;
          if (this.webContents && !this.webContents.isDestroyed()) {
            this.webContents.send(CHANNELS.CHAT_STREAM, { messageId, content: abortMsg });
          }
          break;
        }

        // 记录流式调用的 token 用量（SSE 精确值 > 估算值兜底）
        const su = chatOptions._streamUsage;
        let recordedPrompt = su?.promptTokens || 0;
        let recordedCompletion = su?.completionTokens || 0;
        let tokenSource = 'sse';

        // 分别检查 prompt 和 completion，缺失的用估算值兜底
        // 注意：有些模型（如 GLM 通过中转站）可能只返回 completion 不返回 prompt
        if (recordedPrompt === 0) {
          // 估算 prompt tokens：系统提示 + 历史 + 当前消息
          const messagesForEstimate = [
            { role: 'system', content: agent.systemPrompt || '' },
            ...currentHistory,
            { role: 'user', content: messageWithTools || '' },
          ];
          recordedPrompt = estimateMessages(messagesForEstimate);
          tokenSource = recordedCompletion === 0 ? 'estimated' : 'sse+estimated';
        }
        if (recordedCompletion === 0) {
          // 估算 completion tokens：基于实际生成的内容
          recordedCompletion = estimateTokens(roundContent);
          tokenSource = recordedPrompt === 0 ? 'estimated' : 'sse+estimated';
        }

        if (recordedPrompt > 0 || recordedCompletion > 0) {
          const totalTokens = recordedPrompt + recordedCompletion;
          tokenTracker.record({
            agentId: agent.id,
            model: su?.model || agent.model || 'unknown',
            promptTokens: recordedPrompt,
            completionTokens: recordedCompletion,
            conversationId,
          });
          logger.info(`ChatManager: ${agent.name} token 用量 (${tokenSource})`, {
            promptTokens: recordedPrompt,
            completionTokens: recordedCompletion,
            total: totalTokens,
          });

          // 从工资余额中扣除 token
          const { budgetManager } = require('../budget/budget-manager');
          const deductResult = budgetManager.deductTokens(agent.id, totalTokens);
          if (deductResult.success) {
            logger.debug(`ChatManager: ${agent.name} 扣除 ${totalTokens} tokens，余额: ${deductResult.newBalance}`);
          }
        }
        // 重置 _streamUsage 供下一轮使用
        chatOptions._streamUsage = {};

        logger.info(`ChatManager: ${agent.name} 流式完成`, {
          totalChunks: chunkCount,
          roundContentLen: roundContent.length,
          displayContentLen: displayContent.length,
          displayContentPreview: displayContent.slice(-100),
        });

        // 刷新缓冲区剩余内容
        const remaining = streamBuffer.flush();
        if (remaining && this.webContents && !this.webContents.isDestroyed()) {
          this.webContents.send(CHANNELS.CHAT_STREAM, { messageId, content: remaining });
          displayContent += remaining;
        }

        // 第 2 层防御：停职 Agent 即使生成了工具调用也跳过解析
        const streamRuntimeConfig = agentConfigStore.get(agentId);
        const streamRuntimeStatus = streamRuntimeConfig?.status || 'active';
        if (streamRuntimeStatus === 'suspended' || streamRuntimeStatus === 'terminated') {
          break;
        }

        // 检查是否有工具调用
        if (!hasToolCalls(roundContent)) {
          break;
        }

        logger.info(`ChatManager: ${agent.name} 流式第 ${iteration} 轮工具调用`, {
          visibleText: displayContent.slice(0, 200),
        });
        this._updateTaskStage(agentId, 'tools');

        // 解析工具调用
        const toolCalls = parseToolCalls(roundContent);

        // 执行工具
        if (this.toolExecutor && toolCalls.length > 0) {
          // 为每个工具调用生成唯一 ID（带随机后缀避免冲突）
          const toolGroupIndex = iteration - 1; // 第几批工具调用（从 0 开始）
          const toolCallsWithId = toolCalls.map((t, i) => ({
            ...t,
            id: `tc-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          }));

          // 推送工具分组标记（用于前端内容分割定位）
          const toolMarker = `\n\n<!--tool-group:${toolGroupIndex}-->\n\n`;
          if (this.webContents && !this.webContents.isDestroyed()) {
            this.webContents.send(CHANNELS.CHAT_STREAM, { messageId, content: toolMarker });
          }
          displayContent += toolMarker;

          // 推送工具开始事件（结构化数据）
          if (this.webContents && !this.webContents.isDestroyed()) {
            this.webContents.send(CHANNELS.CHAT_STREAM, {
              messageId,
              toolEvent: {
                type: 'tool_start',
                groupIndex: toolGroupIndex,
                tools: toolCallsWithId.map((t) => ({
                  id: t.id,
                  name: t.name,
                  args: t.arguments || {},
                })),
              },
            });
          }

          // 再次检查中止
          if (signal.aborted) {
            const abortMsg = '\n\n_（任务已被终止，工具未执行）_';
            displayContent += abortMsg;
            if (this.webContents && !this.webContents.isDestroyed()) {
              this.webContents.send(CHANNELS.CHAT_STREAM, { messageId, content: abortMsg });
            }
            break;
          }

          const toolResults = await this.toolExecutor.executeToolCalls(
            toolCallsWithId,
            {
              agentId: agent.id,
              agentName: agent.name,
              conversationId,
            },
            // onProgress: 每个工具完成时推送结果到前端
            (progressEvent) => {
              if (this.webContents && !this.webContents.isDestroyed()) {
                this.webContents.send(CHANNELS.CHAT_STREAM, {
                  messageId,
                  toolEvent: progressEvent,
                });
              }
            }
          );

          // 格式化工具结果（传入 sessionId 用于虚拟文件关联）
          const formattedResults = this.toolExecutor.formatToolResults(toolResults, {
            sessionId: conversationId,
          });

          // 更新历史
          currentHistory = [
            ...currentHistory,
            { role: 'assistant', content: roundContent },
            { role: 'user', content: `工具执行结果：\n\n${formattedResults}` },
          ];

          // 工具循环上下文压缩：防止多轮工具调用导致上下文超限
          const streamToolBudget = getAvailableBudget({
            model: agent.model,
            systemPromptTokens: estimateTokens(agent.systemPrompt),
            userMessageTokens: estimateTokens(currentMessage),
          });
          const { compressed: streamCompressed, wasCompressed: streamWasCompressed } = compressToolHistory(
            currentHistory, 
            streamToolBudget, 
            { sessionId: conversationId, taskContext: message.slice(0, 100) }
          );
          if (streamWasCompressed) {
            currentHistory = streamCompressed;
            logger.info(`ChatManager: ${agent.name} 流式第 ${iteration} 轮工具循环上下文已压缩`);
          }

          currentMessage = '【系统指令】工具已执行完毕。请直接基于工具返回的结果回答用户问题。禁止：1)重复问候语 2)重复之前说过的话 3)再次调用工具。直接输出答案内容。';
        } else {
          break;
        }
      }

      if (!signal.aborted && iteration >= MAX_TOOL_ITERATIONS) {
        const maxMsg = '\n\n（已达到最大工具调用次数）';
        displayContent += maxMsg;
        if (this.webContents && !this.webContents.isDestroyed()) {
          this.webContents.send(CHANNELS.CHAT_STREAM, { messageId, content: maxMsg });
        }
      }

      // 完成推送（发送最终的干净内容）
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send(CHANNELS.CHAT_COMPLETE, { messageId, content: displayContent });
      }

      return { content: displayContent };
    } catch (error) {
      // 如果是中止导致的错误，不当作异常
      if (signal.aborted) {
        const abortContent = '（任务已被终止）';
        if (this.webContents && !this.webContents.isDestroyed()) {
          this.webContents.send(CHANNELS.CHAT_COMPLETE, { messageId, content: abortContent });
        }
        return { content: abortContent };
      }
      logger.error(`ChatManager: ${agent.name} 流式处理失败`, error);
      const errorContent = `抱歉老板，我在处理您的请求时遇到了问题：${error.message || '未知错误'}`;
      // 确保即使出错也发送 CHAT_COMPLETE，避免前端消息卡在"发送中"状态
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send(CHANNELS.CHAT_STREAM, { messageId, content: `\n\n${errorContent}` });
        this.webContents.send(CHANNELS.CHAT_COMPLETE, { messageId, content: errorContent });
      }
      return { content: errorContent };
    } finally {
      this._finishTask(agentId, taskId);
    }
  }
}

// 单例
const chatManager = new ChatManager();

module.exports = { ChatManager, chatManager };
