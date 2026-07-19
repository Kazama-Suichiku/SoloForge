/**
 * SoloForge - 报告 IPC 处理器
 * 处理报告相关的 IPC 请求
 * @module report-ipc-handlers
 */

const { ipcMain, shell } = require('electron');
const path = require('path');
const { getReportContent, getReportsDir } = require('./tools/report-tool');
const { logger } = require('./utils/logger');
const { safeHandler } = require('./utils/safe-handler');

/**
 * 设置报告相关的 IPC 处理器
 */
function setupReportIpcHandlers() {
  // 获取报告内容
  ipcMain.handle(
    'report:get-content',
    safeHandler(async (_event, reportId) => {
      logger.debug('IPC: report:get-content', { reportId });
      const content = await getReportContent(reportId);
      return content;
    }, { channel: 'report:get-content' })
  );

  // 在浏览器中打开报告
  ipcMain.handle(
    'report:open-in-browser',
    safeHandler(async (_event, reportId) => {
      logger.info('IPC: report:open-in-browser', { reportId });
      const filepath = path.join(getReportsDir(), `${reportId}.html`);
      await shell.openPath(filepath);
      return { success: true };
    }, { channel: 'report:open-in-browser' })
  );

  // 获取报告列表
  ipcMain.handle(
    'report:list',
    safeHandler(async (_event, limit = 20) => {
      logger.debug('IPC: report:list', { limit });
      const { listReportsTool } = require('./tools/report-tool');
      const result = await listReportsTool.execute({ limit });
      return result;
    }, { channel: 'report:list' })
  );
}

module.exports = { setupReportIpcHandlers };
