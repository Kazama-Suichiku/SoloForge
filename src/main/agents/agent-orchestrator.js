/**
 * SoloForge - Agent 编排器
 * 按 Pipeline 顺序执行多个 Agent，支持进度通知、取消、错误处理与部分成功
 * @module agents/agent-orchestrator
 */

const CHANNELS = require('../../shared/ipc-channels');
const { registry } = require('./agent-registry');
const { logger } = require('../utils/logger');

/**
 * 编排器执行上下文，传递给每个 Agent.execute
 * @typedef {Object} OrchestratorContext
 * @property {string} taskId - 任务 ID
 * @property {() => boolean} isCancelled - 检查是否已取消
 */

/**
 * 发送进度回调类型
 * @typedef {(progress: import('../shared/ipc-types').TaskProgress) => void} SendProgressFn
 */

/**
 * Agent 编排器
 */
class AgentOrchestrator {
  /**
   * @param {Electron.WebContents} [webContents] - 用于向渲染进程发送 IPC 的 webContents
   */
  constructor(webContents = null) {
    this.webContents = webContents;
    /** @type {Map<string, { cancelled: boolean }>} 任务取消标记 */
    this._taskCancellations = new Map();
  }

  /**
   * 设置 webContents（主进程创建窗口后可调用）
   * @param {Electron.WebContents} wc
   */
  setWebContents(wc) {
    this.webContents = wc;
  }

  /**
   * 发送任务进度到渲染进程
   * @param {import('../shared/ipc-types').TaskProgress} progress
   */
  sendTaskProgress(progress) {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send(CHANNELS.TASK_PROGRESS, progress);
    }
  }

  /**
   * 发送任务完成到渲染进程
   * @param {import('../shared/ipc-types').TaskResult} result
   */
  sendTaskComplete(result) {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send(CHANNELS.TASK_COMPLETE, result);
    }
  }

  /**
   * 发送任务错误到渲染进程
   * @param {import('../shared/ipc-types').TaskResult} result
   */
  sendTaskError(result) {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send(CHANNELS.TASK_ERROR, result);
    }
  }

  /**
   * 请求取消任务
   * @param {string} taskId
   */
  cancelTask(taskId) {
    const meta = this._taskCancellations.get(taskId);
    if (meta) {
      meta.cancelled = true;
    }
  }

  /**
   * 按 Pipeline 顺序执行 Agents
   * @param {import('../shared/ipc-types').TaskRequest} taskRequest
   * @returns {Promise<import('../shared/ipc-types').TaskResult>}
   */
  async runPipeline(taskRequest) {
    const { taskId, taskType, input, agents: agentIds } = taskRequest;

    if (!agentIds || agentIds.length === 0) {
      const result = {
        taskId,
        success: true,
        output: input,
      };
      this.sendTaskComplete(result);
      return result;
    }

    this._taskCancellations.set(taskId, { cancelled: false });
    const isCancelled = () => this._taskCancellations.get(taskId)?.cancelled ?? false;

    const context = {
      taskId,
      isCancelled,
    };

    let currentOutput = { ...input };
    const total = agentIds.length;

    try {
      for (let i = 0; i < agentIds.length; i++) {
        if (isCancelled()) {
          const cancelledResult = {
            taskId,
            success: false,
            error: '任务已取消',
          };
          this.sendTaskError(cancelledResult);
          return cancelledResult;
        }

        const agentId = agentIds[i];
        const agent = registry.getAgent(agentId);

        if (!agent) {
          const errResult = {
            taskId,
            success: false,
            error: `未找到 Agent: ${agentId}`,
          };
          this.sendTaskError(errResult);
          return errResult;
        }

        const progress = Math.round(((i + 0.5) / total) * 100);
        this.sendTaskProgress({
          taskId,
          currentAgent: agentId,
          progress,
          message: `正在执行 ${agent.name}...`,
        });

        agent._setStatus('running', taskId);

        try {
          const output = await agent.execute(currentOutput, context);
          agent._setStatus('completed', null);

          currentOutput = output && typeof output === 'object' ? { ...output } : { result: output };

          this.sendTaskProgress({
            taskId,
            currentAgent: agentId,
            progress: Math.round(((i + 1) / total) * 100),
            message: `${agent.name} 已完成`,
          });
        } catch (err) {
          agent._setStatus('error', null, err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error(`Agent "${agent.name}" 执行失败:`, errorMsg);

          const completedAgents = agentIds.slice(0, i).map((id) => registry.getAgent(id)?.name || id);
          const hasPartialOutput = i > 0;

          if (hasPartialOutput) {
            const partialResult = {
              taskId,
              success: true,
              output: currentOutput,
              partialSuccess: {
                failedAgent: agent.name,
                error: errorMsg,
                completedAgents,
              },
            };
            this.sendTaskProgress({
              taskId,
              currentAgent: agentId,
              progress: Math.round(((i + 1) / total) * 100),
              message: `${agent.name} 失败，已返回前面步骤的结果`,
            });
            this.sendTaskComplete(partialResult);
            return partialResult;
          }

          const errResult = {
            taskId,
            success: false,
            error: `Agent "${agent.name}" 执行失败: ${errorMsg}`,
          };
          this.sendTaskError(errResult);
          return errResult;
        }
      }

      const result = {
        taskId,
        success: true,
        output: currentOutput,
      };
      this.sendTaskComplete(result);
      return result;
    } finally {
      this._taskCancellations.delete(taskId);
      agentIds.forEach((id) => {
        const a = registry.getAgent(id);
        if (a && a._status === 'running') {
          a._setStatus('idle', null);
        }
      });
    }
  }
}

module.exports = { AgentOrchestrator };
