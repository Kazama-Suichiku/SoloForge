/**
 * SoloForge - IPC 处理器
 * 主进程 Agent 相关 IPC 的注册与处理
 * @module ipc-handlers
 */

const { ipcMain } = require('electron');
const CHANNELS = require('../shared/ipc-channels');
const { registry, AgentOrchestrator } = require('./agents');

/** @type {AgentOrchestrator | null} */
let orchestrator = null;

/**
 * 初始化 IPC 处理器并注册 Agent 相关 channel
 * @param {Electron.WebContents} webContents - 主窗口 webContents，用于发送进度
 */
function setupAgentIpcHandlers(webContents) {
  if (!orchestrator) {
    orchestrator = new AgentOrchestrator(webContents);
  } else {
    orchestrator.setWebContents(webContents);
  }

  ipcMain.handle(CHANNELS.AGENT_EXECUTE_TASK, async (_event, taskRequest) => {
    if (!orchestrator) {
      return { taskId: taskRequest?.taskId ?? '', success: false, error: '编排器未初始化' };
    }
    return orchestrator.runPipeline(taskRequest);
  });

  ipcMain.handle(CHANNELS.AGENT_CANCEL_TASK, async (_event, taskId) => {
    if (orchestrator) {
      orchestrator.cancelTask(taskId);
    }
    return { cancelled: true };
  });

  ipcMain.handle(CHANNELS.AGENT_GET_STATUS, async () => {
    const agents = registry.getAllAgents();
    return agents.map((a) => a.getStatus());
  });
}

module.exports = { setupAgentIpcHandlers };
