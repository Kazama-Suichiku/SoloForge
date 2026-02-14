/**
 * SoloForge - 运营数据 IPC 处理器
 * 处理仪表板相关的 IPC 通信
 * @module operations/operations-ipc-handlers
 */

const { ipcMain } = require('electron');
const { operationsStore } = require('./operations-store');
const { approvalQueue } = require('../agent-factory/approval-queue');
const { logger } = require('../utils/logger');

/**
 * 设置运营数据 IPC 处理器
 */
function setupOperationsIpcHandlers() {
  // 获取仪表板摘要
  ipcMain.handle('operations:get-summary', async () => {
    logger.debug('IPC: operations:get-summary');
    try {
      const summary = operationsStore.getDashboardSummary();
      return summary;
    } catch (error) {
      logger.error('获取运营摘要失败', error);
      return null;
    }
  });

  // 获取目标列表
  ipcMain.handle('operations:get-goals', async (_event, filter = {}) => {
    logger.debug('IPC: operations:get-goals', filter);
    try {
      const goals = operationsStore.getGoals(filter);
      return goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        type: g.type,
        owner: g.ownerName,
        department: g.department,
        progress: g.progress,
        status: g.status,
        dueDate: g.dueDate,
        keyResults: Array.isArray(g.keyResults)
          ? g.keyResults
          : typeof g.keyResults === 'string'
            ? (() => { try { const parsed = JSON.parse(g.keyResults); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })()
            : [],
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      }));
    } catch (error) {
      logger.error('获取目标列表失败', error);
      return [];
    }
  });

  // 获取任务列表
  ipcMain.handle('operations:get-tasks', async (_event, filter = {}) => {
    logger.debug('IPC: operations:get-tasks', filter);
    try {
      const tasks = operationsStore.getTasks(filter);
      return tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        assignee: t.assigneeName,
        assigneeId: t.assigneeId,
        requester: t.requesterName,
        requesterId: t.requesterId,
        goalId: t.goalId,
        status: t.status,
        dueDate: t.dueDate,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        completedAt: t.completedAt,
      }));
    } catch (error) {
      logger.error('获取任务列表失败', error);
      return [];
    }
  });

  // 获取 KPI 列表
  ipcMain.handle('operations:get-kpis', async (_event, filter = {}) => {
    logger.debug('IPC: operations:get-kpis', filter);
    try {
      const kpis = operationsStore.getKPIs(filter);
      return kpis.map((k) => ({
        id: k.id,
        name: k.name,
        description: k.description,
        owner: k.ownerName,
        department: k.department,
        target: `${k.target}${k.unit}`,
        current: `${k.current}${k.unit}`,
        progress: k.target ? `${Math.round((k.current / k.target) * 100)}%` : '0%',
        direction: k.direction,
        period: k.period,
        history: k.history,
      }));
    } catch (error) {
      logger.error('获取 KPI 列表失败', error);
      return [];
    }
  });

  // 获取招聘申请列表
  ipcMain.handle('operations:get-recruit-requests', async () => {
    logger.debug('IPC: operations:get-recruit-requests');
    try {
      const requests = approvalQueue.getAll();
      return requests.map((r) => ({
        id: r.id,
        candidateName: r.profile?.name || r.agentName || '(未命名)',
        candidateTitle: r.profile?.title || r.agentRole || '(未指定)',
        department: r.profile?.department || '',
        status: r.status,
        requester: r.requesterName,
        requesterId: r.requesterId,
        revisionCount: r.revisionCount || 0,
        discussionCount: r.discussion?.length || 0,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        reviewedBy: r.reviewedBy,
      }));
    } catch (error) {
      logger.error('获取招聘申请列表失败', error);
      return [];
    }
  });

  // 获取活动日志
  ipcMain.handle('operations:get-activity-log', async (_event, { filter, limit } = {}) => {
    logger.debug('IPC: operations:get-activity-log', { filter, limit });
    try {
      const logs = operationsStore.getActivityLog(filter || {}, limit || 50);
      return logs.map((l) => ({
        id: l.id,
        category: l.category,
        action: l.action,
        actor: l.actorName,
        actorId: l.actorId,
        time: l.createdAt,
        data: l.data,
      }));
    } catch (error) {
      logger.error('获取活动日志失败', error);
      return [];
    }
  });

  logger.info('运营数据 IPC 处理器已设置');
}

module.exports = { setupOperationsIpcHandlers };
