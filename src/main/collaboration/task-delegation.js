/**
 * TaskDelegation — 任务委派、执行、审阅
 *
 * 从 agent-communication.js 拆出。职责：
 *   - delegateTask：委派任务给另一个 Agent（同步/异步）
 *   - executeTask：执行委派的任务（含规划阶段 + 执行阶段）
 *   - _triggerSupervisorReview：任务完成后触发上司审阅流程
 *   - 任务状态查询：getTasks / getPendingTasks / getStats / getRecentActivity
 *   - 任务讨论与更新：addTaskDiscussion / updateTask
 *   - 清理：clearStaleTasks / clearCompletedTasks / clearMessages
 *   - 运营系统/PM 引擎同步：_syncOpsTaskStatus / _notifyPMEngine
 *
 * 依赖注入（host = AgentCommunicationManager 实例）：
 *   - host.messages / host.delegatedTasks / host._saveToDisk / host._generateId
 *   - host.chatManager / host.toolExecutor
 *   - host.runToolLoop (tool-loop-runner)
 *   - host.messaging (AgentMessaging 实例，用于 sendMessage / getUserContextSummary 等)
 *   - host._trackAgentActivity / _untrackAgentActivity
 *   - host._triggerMemoryExtraction
 *
 * @module collaboration/task-delegation
 */

const { logger } = require('../utils/logger');
const { agentConfigStore } = require('../config/agent-config-store');
const { scratchpadManager } = require('../context/agent-scratchpad');

const DELEGATE_TIMEOUT_MS = 300000; // 5 分钟

class TaskDelegation {
  constructor(host) {
    this.host = host;
  }

  /**
   * 获取任务相关的历史讨论（用于任务执行上下文）
   */
  getTaskHistory(task) {
    const history = [];
    for (const disc of task.discussion || []) {
      history.push({
        role: disc.agent === task.toAgent ? 'assistant' : 'user',
        content: `[${disc.agent}]: ${disc.content}`,
      });
    }
    const pairwiseHistory = this.host.messaging.getPairwiseHistory(task.fromAgent, task.toAgent, 5);
    return [...pairwiseHistory, ...history];
  }

  /**
   * 委派任务给另一个 Agent
   */
  async delegateTask(params) {
    const host = this.host;
    const {
      fromAgent,
      toAgent,
      taskDescription,
      priority = 3,
      waitForResult = false,
      conversationId,
      includeUserContext = true,
      gitBranch = null,
      gitWorkspace = null,
      requirePlanApproval = false,
    } = params;

    if (!host.chatManager) {
      return { success: false, error: 'ChatManager 未初始化' };
    }

    if (fromAgent === toAgent) {
      logger.warn(`阻止自我委派: ${fromAgent} 试图给自己委派任务`, {
        taskDescription: taskDescription?.slice(0, 100),
      });
      return { success: false, error: '不能给自己委派任务' };
    }

    const targetConfig = agentConfigStore.get(toAgent);
    const targetStatus = targetConfig?.status || 'active';
    if (targetStatus === 'suspended') {
      return { success: false, error: `${targetConfig?.name || toAgent} 当前处于停职状态，无法接收任务。` };
    }
    if (targetStatus === 'terminated') {
      return { success: false, error: `${targetConfig?.name || toAgent} 已离职，无法接收任务。` };
    }

    const targetAgent = host.chatManager.getAgent(toAgent);
    if (!targetAgent) {
      return { success: false, error: `找不到目标同事: ${toAgent}` };
    }

    const fromAgentInfo = host.chatManager.getAgent(fromAgent);
    const fromAgentName = fromAgentInfo?.name || fromAgent;

    let userContextSummary = '';
    if (includeUserContext && conversationId) {
      userContextSummary = host.messaging.getUserContextSummary(conversationId);
    }

    const task = {
      id: host._generateId(),
      fromAgent,
      fromAgentName,
      toAgent,
      taskDescription,
      status: 'pending',
      priority,
      createdAt: Date.now(),
      conversationId,
      userContextSummary,
      gitBranch: gitBranch || null,
      gitWorkspace: gitWorkspace || null,
      planApprovalRequired: requirePlanApproval,
      planStatus: requirePlanApproval ? 'planning' : null,
      discussion: [],
    };

    host.delegatedTasks.push(task);
    host._saveToDisk();

    // 同步创建运营系统 task
    try {
      const { operationsStore } = require('../operations/operations-store');
      const opsTask = operationsStore.createTask({
        title: taskDescription.slice(0, 80),
        description: taskDescription,
        priority: priority <= 2 ? 'high' : priority <= 3 ? 'medium' : 'low',
        assigneeId: toAgent,
        assigneeName: targetAgent.name,
        requesterId: fromAgent,
        requesterName: fromAgentName,
      });
      task.opsTaskId = opsTask.id;
      host._saveToDisk();
      logger.info(`运营任务已创建: ${opsTask.id}`, { delegatedTaskId: task.id });
    } catch (error) {
      logger.warn('创建运营任务失败（不影响委派）:', error.message);
    }

    logger.info(`任务委派: ${fromAgent} → ${toAgent}`, {
      taskId: task.id,
      description: taskDescription.slice(0, 100),
      hasUserContext: !!userContextSummary,
    });

    if (waitForResult) {
      return await this.executeTask(task.id);
    }

    setImmediate(async () => {
      try {
        logger.info(`异步执行委派任务: ${task.id}`, { executor: toAgent });
        await this.executeTask(task.id);
      } catch (error) {
        logger.error(`异步任务执行失败: ${task.id}`, error);
      }
    });

    return { success: true, taskId: task.id, message: '任务已委派，正在后台执行' };
  }

  /**
   * 执行委派的任务
   */
  async executeTask(taskId, options = {}) {
    const host = this.host;
    const { allowTools = true } = options;

    const task = host.delegatedTasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `任务不存在: ${taskId}` };
    }

    if (task.status !== 'pending' && task.status !== 'in_progress' && task.status !== 'awaiting_plan_approval') {
      return { success: false, error: `任务状态不正确: ${task.status}` };
    }

    // 执行者状态
    const executorConfig = agentConfigStore.get(task.toAgent);
    const executorStatus = executorConfig?.status || 'active';
    if (executorStatus === 'suspended') {
      task.status = 'failed';
      task.result = `执行者 ${executorConfig?.name || task.toAgent} 处于停职状态，无法执行任务`;
      host._saveToDisk();
      return { success: false, error: task.result };
    }
    if (executorStatus === 'terminated') {
      task.status = 'failed';
      task.result = `执行者 ${executorConfig?.name || task.toAgent} 已离职，无法执行任务`;
      host._saveToDisk();
      return { success: false, error: task.result };
    }

    const targetAgent = host.chatManager?.getAgent(task.toAgent);
    if (!targetAgent) {
      task.status = 'failed';
      task.result = '找不到执行者';
      host._saveToDisk();
      return { success: false, error: '找不到执行者' };
    }

    // ═══════════════════════════════════════════════════════════
    // Phase 1: 规划阶段
    // ═══════════════════════════════════════════════════════════
    if (task.planApprovalRequired && task.planStatus !== 'approved') {
      const { devPlanQueue } = require('./dev-plan-queue');
      const latestPlan = devPlanQueue.getByTask(task.id);
      const rejectionFeedback =
        task.planStatus === 'planning' && latestPlan?.status === 'rejected'
          ? latestPlan.feedback
          : null;

      task.status = 'in_progress';
      task.planStatus = task.planStatus || 'planning';
      if (!task.startedAt) task.startedAt = Date.now();
      if (!task.discussion) task.discussion = [];
      host._saveToDisk();

      const fromAgentName = task.fromAgentName || task.fromAgent;
      const planActivityTaskId = host._trackAgentActivity(task.toAgent, `规划任务: 来自 ${fromAgentName}`);

      logger.info(`进入规划阶段: ${task.id}`, {
        executor: task.toAgent,
        planStatus: task.planStatus,
        hasRejectionFeedback: !!rejectionFeedback,
      });

      try {
        const taskHistory = this.getTaskHistory(task);

        let userContextPart = '';
        if (task.userContextSummary) {
          userContextPart = `\n\n[用户对话背景]\n${task.userContextSummary}\n`;
        }

        let planScratchpadContext = '';
        try {
          const scratchpad = scratchpadManager.get(task.toAgent);
          if (scratchpad.hasContent()) {
            planScratchpadContext = `\n${scratchpad.getContextSummary()}\n`;
          }
        } catch (err) {
          logger.debug('获取暂存区失败', { toAgent: task.toAgent, error: err.message });
        }

        let feedbackSection = '';
        if (rejectionFeedback) {
          feedbackSection = `
═══════════════════════════════════════
上级反馈（你之前的计划被驳回）：
═══════════════════════════════════════
${rejectionFeedback}

请根据以上反馈修改你的开发计划，然后用 submit_dev_plan 重新提交。
`;
        }

        const planningMessage = `[工作指令 - 来自上级 ${fromAgentName}]${userContextPart}${planScratchpadContext}
═══════════════════════════════════════
任务要求：
═══════════════════════════════════════
${task.taskDescription}
${feedbackSection}
═══════════════════════════════════════
重要：此任务需要先提交开发计划审批
═══════════════════════════════════════

你当前处于【规划阶段】，只能使用以下工具：
- read_file / list_files：调研代码和项目结构
- send_to_agent / list_colleagues：与同事沟通、了解情况
- submit_dev_plan：提交开发计划

你现在不能写代码、执行命令或做 Git 操作。

请按以下步骤操作：
1. 使用 read_file 和 list_files 充分调研代码
2. 制定开发计划，内容需包含：
   - 目标：要实现什么
   - 技术方案：怎么实现、用什么技术
   - 影响范围：涉及哪些文件/模块
   - 预估工时：大约需要多少时间
   - 风险点：可能遇到的问题
3. 使用 submit_dev_plan(plan_content="你的计划") 提交审批

审批通过后，系统会自动解锁所有开发工具，你就可以开始编码了。`;

        // 规划阶段：使用受限工具集 + submit_dev_plan 中断钩子
        const planToolSchema = host.messaging.getFilteredToolSchema(targetAgent.id, 'planning');
        const planLoopResult = await host.runToolLoop(
          targetAgent,
          planningMessage,
          taskHistory,
          {
            conversationId: task.conversationId,
            fromAgent: task.fromAgent,
            taskId: task.id,
            isInternalCommunication: true,
          },
          {
            toolSchema: planToolSchema,
            toolExecutor: host.toolExecutor,
            getPermissionContext: () => host.messaging.getPermissionContext(),
            onToolExecuted: (toolCalls) => {
              const submitted = toolCalls.some((tc) => tc.name === 'submit_dev_plan');
              if (submitted) return { shouldBreak: true };
              return null;
            },
            onStageChange: (stage) => host._updateAgentActivityStage(targetAgent.id, stage),
          }
        );
        const planResult = planLoopResult.content;

        if (task.planStatus === 'submitted') {
          task.status = 'awaiting_plan_approval';
          task.discussion.push({
            agent: task.toAgent,
            content: `[规划阶段] ${planResult}`,
            timestamp: Date.now(),
          });
          host._saveToDisk();
          logger.info(`任务进入等待审批状态: ${task.id}`, { executor: task.toAgent });
          return {
            success: true,
            taskId: task.id,
            status: 'awaiting_plan_approval',
            message: '员工已提交开发计划，等待审批',
          };
        }

        logger.warn(`规划阶段结束但未提交计划: ${task.id}`);
        task.discussion.push({
          agent: task.toAgent,
          content: `[规划阶段 - 未提交计划] ${planResult}`,
          timestamp: Date.now(),
        });
        host._saveToDisk();
        return { success: false, taskId: task.id, error: '员工未提交开发计划' };
      } catch (error) {
        task.status = 'failed';
        task.result = `规划阶段失败: ${error.message}`;
        task.completedAt = Date.now();
        host._saveToDisk();
        this._syncOpsTaskStatus(task, 'cancelled', error.message);
        logger.error(`规划阶段执行失败: ${task.id}`, error);
        return { success: false, error: error.message };
      } finally {
        host._untrackAgentActivity(task.toAgent, planActivityTaskId);
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Phase 2: 正常执行阶段
    // ═══════════════════════════════════════════════════════════
    task.status = 'in_progress';
    if (!task.startedAt) task.startedAt = Date.now();
    if (!task.discussion) task.discussion = [];
    host._saveToDisk();

    const execActivityTaskId = host._trackAgentActivity(
      task.toAgent,
      `执行任务: 来自 ${task.fromAgentName || task.fromAgent}`
    );

    logger.info(`开始执行任务: ${task.id}`, {
      executor: task.toAgent,
      allowTools,
      planApproved: task.planStatus === 'approved',
    });

    try {
      const taskHistory = this.getTaskHistory(task);

      let userContextPart = '';
      if (task.userContextSummary) {
        userContextPart = `\n\n[用户对话背景]\n${task.userContextSummary}\n`;
      }

      let scratchpadContext = '';
      try {
        const scratchpad = scratchpadManager.get(task.toAgent);
        if (scratchpad.hasContent()) {
          scratchpadContext = `\n${scratchpad.getContextSummary()}\n`;
        }
      } catch (err) {
        logger.debug('获取暂存区失败', { toAgent: task.toAgent, error: err.message });
      }

      const fromAgentName = task.fromAgentName || task.fromAgent;

      let gitInstructions = '';
      if (task.gitBranch) {
        gitInstructions = `
═══════════════════════════════════════
Git 工作流（强制执行）：
═══════════════════════════════════════
你的工作分支: ${task.gitBranch}
工作区路径: ${task.gitWorkspace || '（使用默认工作区）'}

你必须按以下流程工作：
1. 开始前：用 git_branch 切换到工作分支 ${task.gitBranch}
    <name>git_branch</name><arguments><action>checkout</action><branch_name>${task.gitBranch}</branch_name></arguments>
2. 编码：在该分支上读取代码、编写代码（使用 read_file / write_file）
3. 每完成一个功能点：用 git_commit 提交
    <name>git_commit</name><arguments><message>描述你做了什么</message></arguments>
4. 全部完成后：用 git_create_pr 提交 Pull Request 给上级审核
    <name>git_create_pr</name><arguments><title>任务标题</title><description>完成了什么</description><source_branch>${task.gitBranch}</source_branch><target_branch>main</target_branch></arguments>

严禁：
- 不切换分支就直接写代码
- 写完代码不 commit
- 不提 PR 就汇报"完成了"
`;
      }

      let planApprovalNote = '';
      if (task.planApprovalRequired && task.planStatus === 'approved') {
        const { devPlanQueue } = require('./dev-plan-queue');
        const approvedPlan = devPlanQueue.getByTask(task.id);
        if (approvedPlan) {
          planApprovalNote = `
═══════════════════════════════════════
开发计划（已批准）：
═══════════════════════════════════════
${approvedPlan.content}
${approvedPlan.approveComment ? `\n上级备注：${approvedPlan.approveComment}` : ''}

请严格按照以上已批准的计划执行开发工作。
`;
        }
      }

      const taskMessage = `[工作指令 - 来自上级 ${fromAgentName}]${userContextPart}${scratchpadContext}
═══════════════════════════════════════
任务要求（你必须完成以下工作）：
═══════════════════════════════════════
${task.taskDescription}
${planApprovalNote}${gitInstructions}
═══════════════════════════════════════
执行规范：
═══════════════════════════════════════
1. 这是一个工作任务，不是闲聊。你必须立即开始执行，不要反问"需要我帮什么"
2. 使用工具完成实际工作（读文件、写代码、执行命令等），不要只是描述你"打算"做什么
3. 完成所有工作后，汇报你实际做了什么、产出了什么文件、遇到了什么问题
4. 可用的工具名：read_file（读文件）、write_file（写文件）、list_files（列目录）、shell（执行命令）、git_branch / git_commit / git_create_pr（Git 操作）
5. 不要使用 fs_write、read_code、list_dir、execute_command 等错误工具名`;

      logger.debug(`任务执行历史条数: ${taskHistory.length}`);

      let result;
      let toolsUsedInTask = [];
      if (allowTools && host.toolExecutor) {
        const execToolSchema = host.messaging.getFilteredToolSchema(targetAgent.id, 'full');
        const loopResult = await host.runToolLoop(
          targetAgent,
          taskMessage,
          taskHistory,
          {
            conversationId: task.conversationId,
            fromAgent: task.fromAgent,
            taskId: task.id,
            isInternalCommunication: true,
          },
          {
            toolSchema: execToolSchema,
            toolExecutor: host.toolExecutor,
            getPermissionContext: () => host.messaging.getPermissionContext(),
            onStageChange: (stage) => host._updateAgentActivityStage(targetAgent.id, stage),
          }
        );
        result = loopResult.content;
        toolsUsedInTask = loopResult.toolsUsed || [];
      } else {
        result = await targetAgent.chat(taskMessage, taskHistory, { stream: false });
      }

      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      if (!task.discussion) task.discussion = [];
      task.discussion.push({ agent: task.toAgent, content: result, timestamp: Date.now() });
      host._saveToDisk();

      this._syncOpsTaskStatus(task, 'review', result);
      this._notifyPMEngine('completed', task.id);

      logger.info(`任务完成: ${task.id}`, {
        resultLength: result.length,
        historyUsed: taskHistory.length,
        allowTools,
      });

      host._triggerMemoryExtraction('task', {
        taskId: task.id,
        fromAgent: task.fromAgent,
        toAgent: task.toAgent,
        taskDescription: task.taskDescription,
        result,
        wasRejected: false,
      });

      // 任务完成后自动触发上司审阅
      this._triggerSupervisorReview(task, result);

      return { success: true, taskId: task.id, result };
    } catch (error) {
      task.status = 'failed';
      task.result = error.message;
      task.completedAt = Date.now();
      host._saveToDisk();
      this._syncOpsTaskStatus(task, 'cancelled', error.message);
      this._notifyPMEngine('failed', task.id);
      logger.error(`任务执行失败: ${task.id}`, error);
      return { success: false, error: error.message };
    } finally {
      host._untrackAgentActivity(task.toAgent, execActivityTaskId);
    }
  }

  /**
   * 任务完成后触发上司审阅流程
   */
  _triggerSupervisorReview(task, result) {
    const host = this.host;
    if (!host.chatManager) return;

    if (task.fromAgent === task.toAgent) {
      const selfAgent = host.chatManager.getAgent(task.fromAgent);
      const selfName = selfAgent?.name || task.fromAgent;
      logger.info(`跳过自我审阅: ${selfName} 既是委派者又是执行者`, { taskId: task.id });
      const resultPreview = result.length > 500 ? result.slice(0, 500) + '...' : result;
      host.chatManager.pushProactiveMessage(
        task.fromAgent,
        `任务已完成：${task.taskDescription.slice(0, 100)}\n\n结果：${resultPreview}`
      );
      this._syncOpsTaskStatus(task, 'done', '任务完成（自行执行）');
      this._notifyPMEngine('approved', task.id);
      return;
    }

    const fromAgent = host.chatManager.getAgent(task.fromAgent);
    const toAgent = host.chatManager.getAgent(task.toAgent);
    const fromAgentName = fromAgent?.name || task.fromAgentName || task.fromAgent;
    const toAgentName = toAgent?.name || task.toAgent;

    const resultPreview =
      result.length > 2000
        ? result.slice(0, 2000) + '\n\n...(结果已截断，完整内容请查看任务记录)'
        : result;

    logger.info(`触发上司审阅: ${toAgentName} → ${fromAgentName}`, {
      taskId: task.id,
      resultLength: result.length,
    });

    host.chatManager.pushProactiveMessage(
      task.fromAgent,
      `${toAgentName} 已完成任务并提交了工作报告，我正在审阅...`
    );

    setImmediate(async () => {
      try {
        const reviewMsg = `【系统通知 - 下属任务完成报告】

你的下属 ${toAgentName} (${task.toAgent}) 已完成你委派的任务并提交了工作报告。

【委派的任务】
${task.taskDescription.slice(0, 500)}

【${toAgentName} 的完成报告】
${resultPreview}

【任务 ID】${task.id}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
请立即审阅并决定下一步行动：

1. **如果工作质量合格、任务已完成**：
   - 使用 notify_boss 向老板汇报工作成果，包括：员工姓名、任务内容、完成情况、产出质量评价
   - 示例：notify_boss(message="老板，${toAgentName}已完成XX任务，产出质量..., 总结...")

2. **如果工作质量不足或任务未完全完成**：
   - 使用 delegate_task(target_agent="${task.toAgent}", task_description="具体的修改要求和改进意见...", wait_for_result=false) 布置修改任务
   - 修改任务完成后你会再次收到审阅通知，形成"审阅→推回→修改→再审阅"的循环
   - 注意：请使用 delegate_task 而非 send_to_agent，这样修改完成后系统会自动通知你再次审阅

3. **【必须】更新项目进度**：
   - 审阅后，使用 ops_list_goals 查看当前项目目标
   - 如果有关联目标，使用 ops_update_goal 更新目标进度和状态（根据此任务完成情况调整 progress 百分比）
   - 如果还没有项目目标，使用 ops_create_goal 创建一个项目目标，然后更新进度
   - 老板通过控制面板查看项目进展，你必须保持进度信息最新！
   - 示例：ops_update_goal(goal_id="xxx", progress=30, status="in_progress")

4. **你的审阅应当包含**：
   - 产出是否符合任务要求
   - 质量评价（专业度、完整性、可行性）
   - 具体的改进建议（如果需要）

⚠️⚠️⚠️ 极其重要：
- 你必须调用工具来执行操作！在文字中描述"我已汇报"或"我已写入文件"是无效的！
- 如果你认为工作合格 → 必须调用 notify_boss(message="你的汇报内容") 工具
- 如果你认为需要返工 → 必须调用 delegate_task(target_agent="${task.toAgent}", task_description="修改要求", wait_for_result=false) 工具
- 审阅后必须更新项目进度 → 调用 ops_list_goals 和 ops_update_goal（或 ops_create_goal）
- 不调用工具 = 什么都没做！

请立刻开始审阅并调用相应工具，不要等待进一步指示。`;

        const reviewResult = await host.messaging.sendMessage({
          fromAgent: 'system',
          toAgent: task.fromAgent,
          message: reviewMsg,
          allowTools: true,
          historyStrategy: 'focused',
        });

        const reviewToolsUsed = reviewResult?.toolsUsed || [];
        const usedNotifyBoss = reviewToolsUsed.includes('notify_boss');
        const usedDelegateTask = reviewToolsUsed.includes('delegate_task');

        if (usedDelegateTask) {
          this._syncOpsTaskStatus(task, 'in_progress', '上司要求返工修改');
          this._notifyPMEngine('rejected', task.id);
        } else {
          this._syncOpsTaskStatus(task, 'done', '上司审阅通过');
          this._notifyPMEngine('approved', task.id);
        }

        if (!usedNotifyBoss && !usedDelegateTask) {
          const supervisorResponse = reviewResult?.response || '';

          const rejectKeywords = [
            '重新', '返工', '不符合', '执行有误', '有误', '不正确',
            '需要修改', '让他', '退回', '打回', '重做', '不合格', '需要改',
          ];
          const wantsReject = rejectKeywords.some((kw) => supervisorResponse.includes(kw));

          if (wantsReject) {
            logger.info(`检测到退回意图，系统自动退回任务: ${fromAgentName} → ${toAgentName}`, {
              taskId: task.id,
              responsePreview: supervisorResponse.slice(0, 100),
            });

            const reworkDescription = `【${fromAgentName}审阅退回】\n\n你之前提交的任务被上司退回，原因如下：\n${supervisorResponse.slice(0, 800)}\n\n请根据上述反馈重新执行任务。原始任务：\n${task.taskDescription.slice(0, 500)}`;

            try {
              await this.delegateTask({
                fromAgent: task.fromAgent,
                toAgent: task.toAgent,
                taskDescription: reworkDescription,
                priority: 2,
                waitForResult: false,
                conversationId: task.conversationId,
              });
              this._syncOpsTaskStatus(task, 'in_progress', `${fromAgentName}审阅退回，要求返工`);
              this._notifyPMEngine('rejected', task.id);
              host.chatManager.pushProactiveMessage(
                task.fromAgent,
                `${fromAgentName}审阅了${toAgentName}的工作，发现问题并已自动退回返工：\n${supervisorResponse.slice(0, 200)}`
              );
            } catch (delegateError) {
              logger.error('自动退回任务失败:', delegateError);
              host.chatManager.pushProactiveMessage(
                task.fromAgent,
                `【${toAgentName}任务报告审阅】\n\n${supervisorResponse}\n\n⚠️ 系统尝试自动退回任务但失败，请手动处理。`
              );
            }
          } else {
            logger.warn(`上司审阅未调用工具，自动推送审阅结果给老板: ${fromAgentName}`, {
              taskId: task.id,
              responsePreview: supervisorResponse.slice(0, 100),
            });
            const bossMsg = supervisorResponse.trim()
              ? `【${toAgentName}任务报告审阅】\n\n${supervisorResponse}`
              : `${toAgentName} 已完成任务「${task.taskDescription.slice(0, 60)}」，${fromAgentName}已审阅。`;
            host.chatManager.pushProactiveMessage(task.fromAgent, bossMsg);
            logger.info(`自动推送审阅结果完成: ${fromAgentName} → 老板`, { taskId: task.id });
          }
        }

        logger.info(`上司审阅完成: ${fromAgentName} 已审阅 ${toAgentName} 的报告`, { taskId: task.id });
      } catch (error) {
        logger.error(`触发上司审阅失败: ${task.id}`, error);
        host.chatManager.pushProactiveMessage(
          task.fromAgent,
          `审阅 ${toAgentName} 的工作报告时遇到了问题：${error.message}`
        );
      }
    });
  }

  _syncOpsTaskStatus(task, opsStatus, progressNote = '') {
    const host = this.host;
    if (!task.opsTaskId) return;
    try {
      const { operationsStore } = require('../operations/operations-store');
      const config = agentConfigStore.get(task.toAgent) || {};
      const updates = { status: opsStatus };
      operationsStore.updateTask(task.opsTaskId, updates, task.toAgent, config.name || task.toAgent);
      if (progressNote) {
        const opsTask = operationsStore.getTask(task.opsTaskId);
        if (opsTask) {
          if (!opsTask.progressLog) opsTask.progressLog = [];
          opsTask.progressLog.push({
            agent: task.toAgent,
            agentName: config.name || task.toAgent,
            content: progressNote,
            timestamp: Date.now(),
          });
          operationsStore.saveToDisk();
        }
      }
      logger.debug(`运营 task 状态同步: ${task.opsTaskId} → ${opsStatus}`, {
        delegatedTaskId: task.id,
        progressNote,
      });
    } catch (error) {
      logger.warn('同步运营 task 状态失败:', error.message);
    }
  }

  _notifyPMEngine(event, delegatedTaskId) {
    try {
      const { pmEngine } = require('../pm');
      if (!pmEngine) return;
      if (event === 'approved') pmEngine.onTaskReviewApproved(delegatedTaskId);
      else if (event === 'rejected') pmEngine.onTaskReviewRejected(delegatedTaskId);
      else if (event === 'completed') pmEngine.onDelegatedTaskStatusChange(delegatedTaskId, 'completed');
      else if (event === 'failed') pmEngine.onDelegatedTaskStatusChange(delegatedTaskId, 'failed');
    } catch (error) {
      logger.debug('PM 引擎通知失败（可能未初始化）:', error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 任务查询/更新/清理
  // ═══════════════════════════════════════════════════════════

  getTasks(agentId, options = {}) {
    const { type = 'all', status } = options;
    let tasks = this.host.delegatedTasks;
    if (type === 'assigned') tasks = tasks.filter((t) => t.fromAgent === agentId);
    else if (type === 'received') tasks = tasks.filter((t) => t.toAgent === agentId);
    else tasks = tasks.filter((t) => t.fromAgent === agentId || t.toAgent === agentId);
    if (status) tasks = tasks.filter((t) => t.status === status);
    return tasks;
  }

  getPendingTasks(agentId) {
    return this.host.delegatedTasks.filter(
      (t) => t.toAgent === agentId && (t.status === 'pending' || t.status === 'in_progress')
    );
  }

  addTaskDiscussion(taskId, agentId, content) {
    const host = this.host;
    const task = host.delegatedTasks.find((t) => t.id === taskId);
    if (task) {
      if (!task.discussion) task.discussion = [];
      task.discussion.push({ agent: agentId, content, timestamp: Date.now() });
      host._saveToDisk();
    }
  }

  updateTask(taskId, updates) {
    const host = this.host;
    const task = host.delegatedTasks.find((t) => t.id === taskId);
    if (task) {
      Object.assign(task, updates);
      host._saveToDisk();
    }
  }

  getStats(agentId) {
    const host = this.host;
    const sentMessages = host.messages.filter((m) => m.fromAgent === agentId).length;
    const receivedMessages = host.messages.filter((m) => m.toAgent === agentId).length;
    const assignedTasks = host.delegatedTasks.filter((t) => t.fromAgent === agentId).length;
    const receivedTasks = host.delegatedTasks.filter((t) => t.toAgent === agentId).length;
    const completedTasks = host.delegatedTasks.filter(
      (t) => t.toAgent === agentId && t.status === 'completed'
    ).length;
    const pendingTasks = host.delegatedTasks.filter(
      (t) => t.toAgent === agentId && t.status === 'pending'
    ).length;
    return {
      messages: { sent: sentMessages, received: receivedMessages },
      tasks: { assigned: assignedTasks, received: receivedTasks, completed: completedTasks, pending: pendingTasks },
    };
  }

  getRecentActivity(limit = 20) {
    const host = this.host;
    const activities = [];
    for (const msg of host.messages) {
      activities.push({
        type: 'message',
        id: msg.id,
        from: msg.fromAgent,
        to: msg.toAgent,
        summary: msg.content.slice(0, 50) + (msg.content.length > 50 ? '...' : ''),
        content: msg.content,
        response: msg.response || '',
        status: msg.status,
        timestamp: msg.createdAt,
        respondedAt: msg.respondedAt || null,
      });
    }
    for (const task of host.delegatedTasks) {
      activities.push({
        type: 'task',
        id: task.id,
        from: task.fromAgent,
        to: task.toAgent,
        summary: task.taskDescription.slice(0, 50) + (task.taskDescription.length > 50 ? '...' : ''),
        content: task.taskDescription,
        result: task.result || '',
        status: task.status,
        priority: task.priority,
        timestamp: task.createdAt,
        startedAt: task.startedAt || null,
        completedAt: task.completedAt || null,
        discussionCount: task.discussion?.length || 0,
      });
    }
    const sorted = activities.sort((a, b) => b.timestamp - a.timestamp);
    return limit > 0 ? sorted.slice(0, limit) : sorted;
  }

  clearStaleTasks(options = {}) {
    const host = this.host;
    const maxAgeDays = options.maxAgeDays ?? 1;
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const clearedTasks = [];

    for (const task of host.delegatedTasks) {
      if (task.status !== 'in_progress' && task.status !== 'pending') continue;
      if (options.agentId && task.toAgent !== options.agentId && task.fromAgent !== options.agentId) continue;
      const taskAge = now - task.createdAt;
      if (taskAge > maxAgeMs) {
        task.status = 'cancelled';
        task.completedAt = now;
        task.result = `[系统自动关闭] 任务超过 ${maxAgeDays} 天未完成，已自动取消`;
        clearedTasks.push(task.id);
        logger.info('清理积压任务', { taskId: task.id, toAgent: task.toAgent, ageHours: Math.round(taskAge / 3600000) });
      }
    }

    if (clearedTasks.length > 0) host._saveToDisk();
    return { success: true, clearedCount: clearedTasks.length, clearedTasks };
  }

  clearCompletedTasks() {
    const host = this.host;
    const before = host.delegatedTasks.length;
    host.delegatedTasks = host.delegatedTasks.filter(
      (t) => t.status === 'in_progress' || t.status === 'pending'
    );
    const clearedCount = before - host.delegatedTasks.length;
    if (clearedCount > 0) {
      host._saveToDisk();
      logger.info(`清空了 ${clearedCount} 条已完成/已取消的任务记录`);
    }
    return { success: true, clearedCount };
  }

  clearMessages() {
    const host = this.host;
    const clearedCount = host.messages.length;
    if (clearedCount > 0) {
      host.messages = [];
      host._saveToDisk();
      logger.info(`清空了 ${clearedCount} 条协作消息记录`);
    }
    return { success: true, clearedCount };
  }
}

module.exports = {
  TaskDelegation,
  DELEGATE_TIMEOUT_MS,
};
