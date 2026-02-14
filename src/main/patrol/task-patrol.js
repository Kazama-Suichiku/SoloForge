/**
 * SoloForge - 任务巡查系统
 * 定期轮询运营任务和 Agent TODO，自动催促负责人开始工作并向上级汇报
 * 
 * 工作流程：
 * 1. 定时扫描 operationsStore 中 status='todo' 的任务
 * 2. 发现待办任务 → 通过 agentCommunication 驱动负责人开始执行
 * 3. 向任务发起人（上级）推送进度汇报
 * 4. 去重：同一任务在冷却期内不重复催促
 * 
 * @module patrol/task-patrol
 */

const { logger } = require('../utils/logger');
const { agentConfigStore } = require('../config/agent-config-store');

/** 默认巡查间隔：5 分钟 */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** 催促冷却期：同一任务 60 分钟内不重复催促 */
const NUDGE_COOLDOWN_MS = 60 * 60 * 1000;

/** 滞留判定：in_progress 超过 30 分钟未更新 → 提醒 */
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

class TaskPatrol {
  /**
   * @param {Object} deps - 依赖注入
   * @param {Object} deps.operationsStore - 运营数据 store
   * @param {Object} deps.todoStore - Agent TODO store
   * @param {Object} deps.agentCommunication - Agent 间通信
   * @param {Object} deps.chatManager - 聊天管理器（用于 pushProactiveMessage）
   */
  constructor(deps) {
    this.operationsStore = deps.operationsStore;
    this.todoStore = deps.todoStore;
    this.agentCommunication = deps.agentCommunication;
    this.chatManager = deps.chatManager;

    /** @type {ReturnType<typeof setInterval>|null} */
    this._interval = null;
    this._running = false;
    this._checking = false; // 防止并发检查

    /** @type {Map<string, number>} taskId → 上次催促时间戳 */
    this._nudgedAt = new Map();
  }

  /**
   * 启动巡查
   * @param {number} [intervalMs] - 巡查间隔（毫秒）
   */
  start(intervalMs = DEFAULT_INTERVAL_MS) {
    if (this._running) return;
    this._running = true;
    logger.info('任务巡查系统已启动', { intervalMs });

    // 首次延迟 30 秒执行（等系统完全就绪）
    setTimeout(() => {
      if (this._running) this._runCheck();
    }, 30000);

    this._interval = setInterval(() => {
      if (this._running) this._runCheck();
    }, intervalMs);
  }

  /**
   * 停止巡查
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._running = false;
    this._checking = false;
    logger.info('任务巡查系统已停止');
  }

  /**
   * 重置（公司切换时）
   */
  reinitialize() {
    this.stop();
    this._nudgedAt.clear();
  }

  /**
   * 执行一次巡查
   */
  async _runCheck() {
    if (this._checking) {
      logger.debug('任务巡查: 上次检查尚未完成，跳过');
      return;
    }
    this._checking = true;

    try {
      const now = Date.now();

      // ── 1. 扫描运营任务 ──────────────────────────────────
      await this._checkOpsTasks(now);

      // ── 2. 扫描 Agent TODO（滞留提醒） ──────────────────
      await this._checkAgentTodos(now);

      // ── 3. 清理过期的催促记录 ─────────────────────────────
      this._cleanupNudgeRecords(now);

    } catch (error) {
      logger.error('任务巡查执行出错', error);
    } finally {
      this._checking = false;
    }
  }

  /**
   * 检查运营任务系统中的待办任务
   */
  async _checkOpsTasks(now) {
    if (!this.operationsStore) return;

    // 获取所有待办任务（status: todo，有负责人）
    const todoTasks = this.operationsStore.getTasks({ status: 'todo' })
      .filter((t) => t.assigneeId);

    // 获取滞留中的任务（in_progress 但长时间未更新）
    const staleTasks = this.operationsStore.getTasks({ status: 'in_progress' })
      .filter((t) => {
        if (!t.assigneeId) return false;
        const lastUpdate = t.updatedAt || t.createdAt;
        return (now - lastUpdate) > STALE_THRESHOLD_MS;
      });

    if (todoTasks.length === 0 && staleTasks.length === 0) {
      logger.debug('任务巡查: 无待处理的运营任务');
      return;
    }

    logger.info('任务巡查: 发现待处理运营任务', {
      todo: todoTasks.length,
      stale: staleTasks.length,
    });

    // 处理待办任务：催促负责人开始
    for (const task of todoTasks) {
      if (this._isInCooldown(task.id, now)) continue;
      await this._nudgeOpsTask(task, 'todo');
      this._nudgedAt.set(task.id, now);
      // 间隔 3 秒，避免同时触发多个 LLM 调用
      await this._sleep(3000);
    }

    // 处理滞留任务：提醒负责人
    for (const task of staleTasks) {
      if (this._isInCooldown(task.id, now)) continue;
      await this._nudgeOpsTask(task, 'stale');
      this._nudgedAt.set(task.id, now);
      await this._sleep(3000);
    }
  }

  /**
   * 催促运营任务负责人
   * @param {Object} task - 运营任务对象
   * @param {'todo'|'stale'} reason - 催促原因
   */
  async _nudgeOpsTask(task, reason) {
    const assigneeName = task.assigneeName || task.assigneeId;
    const requesterName = task.requesterName || task.requesterId || '系统';
    const assigneeConfig = agentConfigStore.get(task.assigneeId);

    // 跳过停职/离职 Agent
    if (assigneeConfig && ['suspended', 'terminated'].includes(assigneeConfig.status)) {
      logger.debug(`任务巡查: 跳过 ${assigneeName}（${assigneeConfig.status}）`);
      return;
    }

    const taskInfo = `「${task.title}」（优先级: ${task.priority || '普通'}${task.dueDate ? `，截止: ${new Date(task.dueDate).toLocaleDateString('zh-CN')}` : ''}）`;

    if (reason === 'todo') {
      // ── 催促开始执行 ──

      // 1. 向老板汇报（通过秘书推送）
      if (this.chatManager) {
        this.chatManager.pushProactiveMessage('secretary',
          `任务巡查提醒：${assigneeName} 有一个待办任务 ${taskInfo} 尚未开始，已自动催促。`
        );
      }

      // 2. 驱动负责人开始工作
      if (this.agentCommunication) {
        try {
          logger.info(`任务巡查: 催促 ${assigneeName} 开始任务`, { taskId: task.id });
          await this.agentCommunication.sendMessage({
            fromAgent: 'system',
            toAgent: task.assigneeId,
            message: `【任务提醒 - 你有待办任务需要处理】

任务: ${task.title}
${task.description ? `描述: ${task.description}\n` : ''}优先级: ${task.priority || '普通'}
分配人: ${requesterName}
任务 ID: ${task.id}
${task.dueDate ? `截止日期: ${new Date(task.dueDate).toLocaleDateString('zh-CN')}\n` : ''}
请立即开始执行此任务：
1. 使用 todo_create 将任务拆解为具体步骤
2. 使用 ops_update_task(task_id="${task.id}", status="in_progress") 将任务标记为进行中
3. 按计划逐步完成，每完成一步更新 todo_update
4. 全部完成后使用 ops_update_task(task_id="${task.id}", status="done") 标记完成
5. 使用 notify_boss 向老板汇报成果

请立刻开始，不要等待进一步指示。`,
            allowTools: true,
            includeUserContext: false, // 巡查消息不带用户聊天上下文
          });
          logger.info(`任务巡查: ${assigneeName} 已收到催促`, { taskId: task.id });
        } catch (error) {
          logger.error(`任务巡查: 催促 ${assigneeName} 失败`, error);
        }
      }

    } else if (reason === 'stale') {
      // ── 提醒滞留任务 ──

      const staleMinutes = Math.round((Date.now() - (task.updatedAt || task.createdAt)) / 60000);

      if (this.chatManager) {
        this.chatManager.pushProactiveMessage('secretary',
          `任务巡查提醒：${assigneeName} 的任务 ${taskInfo} 已进行 ${staleMinutes} 分钟未更新，已催促跟进。`
        );
      }

      if (this.agentCommunication) {
        try {
          logger.info(`任务巡查: 提醒 ${assigneeName} 跟进滞留任务`, { taskId: task.id, staleMinutes });
          await this.agentCommunication.sendMessage({
            fromAgent: 'system',
            toAgent: task.assigneeId,
            message: `【任务跟进提醒】

你的任务「${task.title}」（ID: ${task.id}）已标记为进行中，但 ${staleMinutes} 分钟未更新进度。

请检查当前进展：
1. 使用 todo_list 查看你的待办步骤
2. 继续推进未完成的步骤
3. 使用 ops_report_progress(task_id="${task.id}", progress_text="进展说明") 汇报进度
4. 如果遇到阻塞，请通过 notify_boss 向老板说明情况

请继续推进任务。`,
            allowTools: true,
            includeUserContext: false,
          });
        } catch (error) {
          logger.error(`任务巡查: 提醒 ${assigneeName} 失败`, error);
        }
      }
    }
  }

  /**
   * 检查 Agent TODO 中的滞留项（长时间 pending/in_progress）
   */
  async _checkAgentTodos(now) {
    if (!this.todoStore) return;

    const allTodos = this.todoStore.getAll();
    let totalPending = 0;

    for (const [agentId, todos] of Object.entries(allTodos)) {
      const pendingTodos = todos.filter((t) => t.status === 'pending' || t.status === 'in_progress');
      if (pendingTodos.length === 0) continue;

      totalPending += pendingTodos.length;

      // 检查是否有长时间未处理的 TODO（超过 30 分钟）
      const staleTodos = pendingTodos.filter((t) => (now - (t.updatedAt || t.createdAt)) > STALE_THRESHOLD_MS);
      if (staleTodos.length === 0) continue;

      const cooldownKey = `todo:${agentId}`;
      if (this._isInCooldown(cooldownKey, now)) continue;

      const agentConfig = agentConfigStore.get(agentId);
      if (agentConfig && ['suspended', 'terminated'].includes(agentConfig.status)) continue;

      const agentName = agentConfig?.name || agentId;
      const todoSummary = staleTodos.map((t) => `• ${t.title}（${t.status === 'in_progress' ? '进行中' : '待办'}）`).join('\n');

      logger.info(`任务巡查: ${agentName} 有 ${staleTodos.length} 个滞留 TODO`);

      // 提醒 Agent 继续处理 TODO
      if (this.agentCommunication) {
        try {
          await this.agentCommunication.sendMessage({
            fromAgent: 'system',
            toAgent: agentId,
            message: `【待办提醒】你有 ${staleTodos.length} 个待办事项较长时间未更新：

${todoSummary}

请继续处理：
1. 使用 todo_list 查看完整待办列表
2. 逐个推进，完成时用 todo_update 标记 done
3. 全部完成后用 todo_clear_done 清理

请继续工作。`,
            allowTools: true,
            includeUserContext: false,
          });
        } catch (error) {
          logger.error(`任务巡查: 提醒 ${agentName} TODO 失败`, error);
        }
      }

      this._nudgedAt.set(cooldownKey, now);
      await this._sleep(3000);
    }

    if (totalPending === 0) {
      logger.debug('任务巡查: 无待处理的 Agent TODO');
    }
  }

  /**
   * 检查是否在冷却期内
   */
  _isInCooldown(key, now) {
    const lastNudge = this._nudgedAt.get(key);
    return lastNudge && (now - lastNudge) < NUDGE_COOLDOWN_MS;
  }

  /**
   * 清理过期的催促记录（超过 2 倍冷却期）
   */
  _cleanupNudgeRecords(now) {
    for (const [key, timestamp] of this._nudgedAt.entries()) {
      if (now - timestamp > NUDGE_COOLDOWN_MS * 2) {
        this._nudgedAt.delete(key);
      }
    }
  }

  /**
   * 延迟辅助函数
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { TaskPatrol };
