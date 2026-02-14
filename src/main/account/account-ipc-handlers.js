/**
 * SoloForge - 账号系统 IPC 处理器
 * 处理账号注册/登录/登出、公司 CRUD、公司选择等 IPC 请求
 * @module account/account-ipc-handlers
 */
const { ipcMain } = require('electron');
const { logger } = require('../utils/logger');
const { accountStore } = require('./account-store');
const { companyStore } = require('./company-store');
const { sessionManager } = require('./session-manager');
const { dataPath } = require('./data-path');

/**
 * Setup all account/company IPC handlers
 * @param {Object} options
 * @param {Function} options.onCompanySelected - Callback when a company is selected. Receives (accountId, companyId). Should trigger store reinitialization.
 * @param {Function} options.onLogout - Callback when user logs out. Should cleanup current state.
 */
function setupAccountIpcHandlers({ onCompanySelected, onLogout }) {
  // ─── Account ──────────────────────────────────────────────
  
  ipcMain.handle('account:register', async (_event, { username, password }) => {
    try {
      const result = await accountStore.register(username, password);
      if (result.success) {
        sessionManager.saveSession(result.accountId);
        companyStore.initForAccount(result.accountId);
      }
      return result;
    } catch (error) {
      logger.error('注册失败', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:login', async (_event, { username, password }) => {
    try {
      const result = await accountStore.login(username, password);
      if (result.success) {
        sessionManager.saveSession(result.accountId);
        companyStore.initForAccount(result.accountId);
      }
      return result;
    } catch (error) {
      logger.error('登录失败', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:logout', async () => {
    try {
      if (onLogout) await onLogout();
      sessionManager.clearSession();
      return { success: true };
    } catch (error) {
      logger.error('登出失败', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('account:get-session', () => {
    try {
      const session = sessionManager.getSession();
      if (!session) return null;

      const account = accountStore.getAccount(session.accountId);
      if (!account) {
        // Session references a deleted account
        sessionManager.clearSession();
        return null;
      }

      return {
        accountId: session.accountId,
        username: account.username,
        lastCompanyId: session.lastCompanyId,
      };
    } catch (error) {
      logger.error('获取会话失败', error);
      return null;
    }
  });

  // ─── Company ──────────────────────────────────────────────

  ipcMain.handle('company:create', (_event, { name, description }) => {
    try {
      return companyStore.createCompany(name, description);
    } catch (error) {
      logger.error('创建公司失败', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('company:list', () => {
    try {
      return companyStore.getCompanies();
    } catch (error) {
      logger.error('获取公司列表失败', error);
      return [];
    }
  });

  ipcMain.handle('company:delete', (_event, { companyId }) => {
    try {
      return companyStore.deleteCompany(companyId);
    } catch (error) {
      logger.error('删除公司失败', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('company:update', (_event, { companyId, data }) => {
    try {
      return companyStore.updateCompany(companyId, data);
    } catch (error) {
      logger.error('更新公司失败', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('company:select', async (_event, { companyId }) => {
    try {
      const session = sessionManager.getSession();
      if (!session) {
        return { success: false, error: '未登录' };
      }

      const company = companyStore.getCompany(companyId);
      if (!company) {
        return { success: false, error: '公司不存在' };
      }

      // Update session
      sessionManager.updateLastCompany(companyId);

      // Update data path context (including company name for prompts)
      dataPath.setCurrentContext(session.accountId, companyId, company.name);
      dataPath.ensureDirectories();

      // Trigger store reinitialization
      if (onCompanySelected) {
        await onCompanySelected(session.accountId, companyId);
      }

      logger.info('公司已选择', { companyId, name: company.name });
      return { success: true, company };
    } catch (error) {
      logger.error('选择公司失败', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('company:get-current', () => {
    try {
      const ctx = dataPath.getCurrentContext();
      if (!ctx.companyId) return null;
      const company = companyStore.getCompany(ctx.companyId);
      return company;
    } catch (error) {
      logger.error('获取当前公司失败', error);
      return null;
    }
  });
}

module.exports = { setupAccountIpcHandlers };
