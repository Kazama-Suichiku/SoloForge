/**
 * SoloForge - 工具执行器与审批事件管线
 *
 * 原先位于 chat-manager.js 的 initToolEditor（515 行，3 个 subscribe）+
 * _processPendingApprovals + _processPendingDelegatedTasks，抽出为独立模块。
 *
 * 三个事件管线：
 *   1. approvalQueue.subscribe  — 招聘审批（CHRO 自动驱动）
 *   2. terminationQueue.subscribe — 开除审批（Secretary 通知老板）
 *   3. devPlanQueue.subscribe — 开发计划审批（Leader 审批）
 *
 * @module chat/tool-editor
 */

const { logger } = require('../utils/logger');
const { ToolExecutor } = require('../tools/tool-executor');
const { permissionStore } = require('../config/permission-store');
const { agentConfigStore } = require('../config/agent-config-store');
const { agentCommunication } = require('../collaboration/agent-communication');

/**
 * 初始化工具执行器与所有审批事件管线
 *
 * @param {Object} chatManager - ChatManager 实例（用于 pushProactiveMessage、getAgent、unregisterAgent、_abortTask 等）
 * @param {Object} [opts]
 * @param {boolean} [opts.skipPendingScan=false] - 跳过启动扫描（测试用）
 */
function initToolExecutor(chatManager, opts = {}) {
  // 防止重复初始化导致多次订阅
  if (chatManager._toolExecutorInitialized) {
    logger.debug('工具执行器已初始化，跳过重复初始化');
    return;
  }
  chatManager._toolExecutorInitialized = true;

  chatManager.toolExecutor = new ToolExecutor({
    userPermissions: permissionStore.get(),
  });

  // 监听权限变更
  permissionStore.subscribe((permissions) => {
    if (chatManager.toolExecutor) {
      chatManager.toolExecutor.setPermissions(permissions);
    }
  });

  // 设置 Agent 通信管理器的引用
  agentCommunication.setChatManager(chatManager);

  // 注入 chatManager 到 Git 工具，支持 PR 事件通知
  try {
    const { initGitNotifications } = require('../tools/git-tool');
    initGitNotifications(chatManager);
  } catch (e) {
    logger.warn('Git 通知初始化失败:', e.message);
  }

  _subscribeApprovalQueue(chatManager);
  _subscribeTerminationQueue(chatManager);
  _subscribeDevPlanQueue(chatManager);

  logger.info('工具执行器初始化完成');

  // ─── 启动时扫描未处理的审批请求和待执行任务 ────────────────────
  if (!opts.skipPendingScan) {
    setTimeout(() => {
      processPendingApprovals(chatManager);
      processPendingDelegatedTasks(chatManager);
    }, 5000); // 延迟 5 秒，等 Agent 恢复完成
  }
}

// ─────────────────────────────────────────────────────────────
// 招聘审批事件管线
// ─────────────────────────────────────────────────────────────
function _subscribeApprovalQueue(chatManager) {
  const { approvalQueue } = require('../agent-factory/approval-queue');
  approvalQueue.subscribe((event, request) => {
    const { requesterId, profile } = request;
    const profileName = profile?.name || '未知';
    const profileTitle = profile?.title || '未知';
    const requesterAgent = requesterId ? chatManager.getAgent(requesterId) : null;
    const requesterName = requesterAgent?.name || requesterId || '未知';

    // 1. 新申请提交 → 自动驱动 CHRO 开始审批
    if (event === 'submitted') {
      logger.info(`新招聘申请: ${requesterName} 提交了 ${profileName} (${profileTitle})`);

      chatManager.pushProactiveMessage(
        'chro',
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
          chatManager.pushProactiveMessage(
            'chro',
            `审核「${profileName} - ${profileTitle}」时遇到了问题：${error.message}。请手动让我重新审核。`
          );
        }
      });
      return;
    }

    // 2. CHRO 提出质疑 → 自动驱动申请人回应
    if (event === 'questioned') {
      if (!requesterId) return;
      const lastQuestion = request.discussion?.filter((d) => d.type === 'question').pop();
      const questionContent = lastQuestion?.content || '（未知质疑内容）';

      logger.info(`CHRO 质疑: → ${requesterName}`, { requestId: request.id });

      chatManager.pushProactiveMessage(
        requesterId,
        `CHRO 对「${profileName} - ${profileTitle}」的招聘申请提出了质疑，我将立即回应。\n\n> ${questionContent.slice(0, 200)}`
      );

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

    // 3. 申请人回复质疑或修订简历 → 自动驱动 CHRO 继续审批
    if (event === 'answered' || event === 'revised') {
      const actionText = event === 'revised' ? '修订了简历' : '回复了质疑';
      logger.info(`招聘申请更新: ${requesterName} ${actionText}, requestId=${request.id}`);

      chatManager.pushProactiveMessage(
        'chro',
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

    // 4. 审批通过 → 驱动申请人安排新员工 + 向老板汇报
    if (event === 'approved') {
      if (!requesterId) return;

      logger.info(`审批通过: ${profileName} (${profileTitle})，通知 ${requesterName}`);

      chatManager.pushProactiveMessage(
        requesterId,
        `好消息！「${profileName} - ${profileTitle}」的招聘申请已通过 CHRO 审批，新员工已入职。我将立即安排后续工作。`
      );

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

    // 5. 审批拒绝 → 驱动申请人向老板汇报
    if (event === 'rejected') {
      if (!requesterId) return;

      const reason =
        request.discussion?.filter((d) => d.role === 'reviewer').pop()?.content ||
        '未说明原因';

      logger.info(`审批拒绝: ${profileName} (${profileTitle})，通知 ${requesterName}`);

      chatManager.pushProactiveMessage(
        requesterId,
        `「${profileName} - ${profileTitle}」的招聘申请被 CHRO 拒绝了。\n拒绝原因：${reason.slice(0, 200)}\n我将向老板汇报此情况。`
      );

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
}

// ─────────────────────────────────────────────────────────────
// 开除审批事件管线
// ─────────────────────────────────────────────────────────────
function _subscribeTerminationQueue(chatManager) {
  const { terminationQueue } = require('../agent-factory/termination-queue');
  terminationQueue.subscribe((event, request) => {
    const { agentId, agentName, agentTitle, reason, proposedByName } = request;

    // 1. CHRO 提出开除申请 → 通知老板（通过 Secretary）
    if (event === 'proposed') {
      logger.info(`开除申请: ${proposedByName} 提议开除 ${agentName} (${agentTitle})`);

      chatManager.pushProactiveMessage(
        'secretary',
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

    // 2. 老板确认开除 → 执行开除并通知 CHRO
    if (event === 'confirmed') {
      logger.info(`开除确认: ${agentName} (${agentTitle}) 已被确认开除`);

      const terminateResult = agentConfigStore.terminate(agentId, reason);
      if (terminateResult.success) {
        chatManager.unregisterAgent(agentId, { cleanupResources: true });

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

      chatManager.pushProactiveMessage(
        'chro',
        `老板已确认开除「${agentName}（${agentTitle}）」，该员工已从组织中移除。\n老板意见：${request.bossComment || '无'}`
      );

      chatManager.pushProactiveMessage(
        'secretary',
        `「${agentName}（${agentTitle}）」已被正式开除并从组织中移除。`
      );
      return;
    }

    // 3. 老板拒绝开除 → 通知 CHRO
    if (event === 'rejected') {
      logger.info(`开除被拒: ${agentName} (${agentTitle}) 的开除申请被老板拒绝`);

      chatManager.pushProactiveMessage(
        'chro',
        `老板拒绝了开除「${agentName}（${agentTitle}）」的申请。\n老板意见：${request.bossComment || '无'}`
      );
      return;
    }
  });
}

// ─────────────────────────────────────────────────────────────
// 开发计划审批事件管线
// ─────────────────────────────────────────────────────────────
function _subscribeDevPlanQueue(chatManager) {
  const { devPlanQueue } = require('../collaboration/dev-plan-queue');
  devPlanQueue.subscribe((event, plan) => {
    const { agentId, agentName, reviewerId, reviewerName, taskId } = plan;

    // 1. 计划提交 → 通知 Leader 审批
    if (event === 'submitted' || event === 'revised') {
      const isRevision = event === 'revised';
      const actionText = isRevision ? '修订并重新提交了' : '提交了';

      logger.info(`开发计划${actionText}: ${agentName} → ${reviewerName}`, {
        planId: plan.id,
        taskId,
      });

      chatManager.pushProactiveMessage(
        reviewerId,
        `${agentName} ${actionText}开发计划，等待审批。`
      );

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
          chatManager.pushProactiveMessage(
            reviewerId,
            `审批 ${agentName} 的开发计划时遇到问题：${error.message}。请手动审批。`
          );
        }
      });
      return;
    }

    // 2. 计划批准 → 恢复任务执行（解锁全部工具）
    if (event === 'approved') {
      logger.info(`开发计划已批准: ${agentName}`, { planId: plan.id, taskId });

      const task = agentCommunication.delegatedTasks.find((t) => t.id === taskId);
      if (task) {
        task.planStatus = 'approved';
        agentCommunication._saveToDisk();

        chatManager.pushProactiveMessage(
          reviewerId,
          `已批准 ${agentName} 的开发计划，${agentName} 正在开始执行...`
        );

        setImmediate(async () => {
          try {
            logger.info(`恢复任务执行（计划已批准）: ${task.id}`, { executor: task.toAgent });
            await agentCommunication.executeTask(task.id);
          } catch (error) {
            logger.error(`恢复任务执行失败: ${task.id}`, error);
            chatManager.pushProactiveMessage(
              reviewerId,
              `${agentName} 的任务恢复执行时遇到问题：${error.message}`
            );
          }
        });
      }
      return;
    }

    // 3. 计划驳回 → 恢复规划阶段（带反馈）
    if (event === 'rejected') {
      logger.info(`开发计划已驳回: ${agentName}`, {
        planId: plan.id,
        taskId,
        feedback: plan.feedback?.slice(0, 100),
      });

      const task = agentCommunication.delegatedTasks.find((t) => t.id === taskId);
      if (task) {
        task.planStatus = 'planning';
        task.status = 'pending';
        agentCommunication._saveToDisk();

        chatManager.pushProactiveMessage(
          reviewerId,
          `已驳回 ${agentName} 的开发计划，已发送修改建议。`
        );

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
}

// ─────────────────────────────────────────────────────────────
// 启动扫描
// ─────────────────────────────────────────────────────────────

/**
 * 扫描并自动处理待审批的招聘请求
 * 在应用启动时调用，确保 pending/discussing 状态的请求不会遗漏
 */
function processPendingApprovals(chatManager) {
  try {
    const { approvalQueue } = require('../agent-factory/approval-queue');
    const pendingRequests = approvalQueue.getPending();

    if (pendingRequests.length === 0) {
      logger.info('启动扫描: 无待处理的招聘审批');
      return;
    }

    logger.info(`启动扫描: 发现 ${pendingRequests.length} 个待处理的招聘审批`);

    const processNext = async (index) => {
      if (index >= pendingRequests.length) return;

      const request = pendingRequests[index];
      const { requesterId, profile } = request;
      const profileName = profile?.name || '未知';
      const profileTitle = profile?.title || '未知';
      const requesterAgent = requesterId ? chatManager.getAgent(requesterId) : null;
      const requesterName = requesterAgent?.name || requesterId || '未知';

      if (request.status === 'pending') {
        logger.info(`启动扫描: 驱动 CHRO 审批 ${profileName} (${request.id})`);

        chatManager.pushProactiveMessage(
          'chro',
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
        const lastQuestion = request.discussion?.filter((d) => d.type === 'question').pop();
        const questionContent = lastQuestion?.content || '（请查看申请详情）';

        logger.info(`启动扫描: 驱动 ${requesterName} 回应质疑 (${request.id})`);

        chatManager.pushProactiveMessage(
          requesterId,
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
function processPendingDelegatedTasks(chatManager) {
  try {
    const pendingTasks = agentCommunication.delegatedTasks.filter(
      (t) => t.status === 'pending' || t.status === 'in_progress'
    );

    if (pendingTasks.length === 0) {
      logger.info('启动扫描: 无待执行的委派任务');
      return;
    }

    logger.info(`启动扫描: 发现 ${pendingTasks.length} 个待执行/恢复的委派任务（不自动执行）`);
    for (const task of pendingTasks) {
      const fromAgent = chatManager.getAgent(task.fromAgent);
      const toAgent = chatManager.getAgent(task.toAgent);
      logger.info(`  - 任务 ${task.id}: ${fromAgent?.name || task.fromAgent} → ${toAgent?.name || task.toAgent}`, {
        task: task.taskDescription?.slice(0, 60),
        status: task.status,
      });
    }

    const taskList = pendingTasks
      .map((t) => {
        const from = chatManager.getAgent(t.fromAgent)?.name || t.fromAgent;
        const to = chatManager.getAgent(t.toAgent)?.name || t.toAgent;
        return `- ${from} → ${to}: ${t.taskDescription?.slice(0, 40)}... (${t.status})`;
      })
      .join('\n');

    chatManager.pushProactiveMessage(
      'secretary',
      `系统重启后发现 ${pendingTasks.length} 个未完成的委派任务，已暂停自动执行：\n${taskList}\n\n如需继续执行，请指示相关负责人重新派发。`
    );
  } catch (error) {
    logger.error('启动扫描委派任务失败:', error);
  }
}

module.exports = {
  initToolExecutor,
  processPendingApprovals,
  processPendingDelegatedTasks,
};
