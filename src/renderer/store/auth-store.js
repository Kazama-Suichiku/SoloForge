/**
 * SoloForge - 认证状态管理
 * 管理账号登录状态和公司选择
 */
import { create } from 'zustand';

export const useAuthStore = create((set, get) => ({
  // State
  appState: 'loading', // 'loading' | 'login' | 'company-select' | 'main'
  currentAccount: null, // { id, username }
  currentCompany: null, // { id, name, description }
  companies: [],
  error: null,

  // Check existing session on app start
  checkSession: async () => {
    try {
      const session = await window.electronAPI.account.getSession();
      if (session) {
        set({
          currentAccount: { id: session.accountId, username: session.username },
        });

        // Load companies for this account
        const companies = await window.electronAPI.company.list();
        set({ companies });

        // If there was a last company, auto-select it
        if (session.lastCompanyId) {
          const company = companies.find(c => c.id === session.lastCompanyId);
          if (company) {
            const result = await window.electronAPI.company.select({ companyId: company.id });
            if (result.success) {
              set({ currentCompany: company, appState: 'main', error: null });
              return;
            }
          }
        }

        set({ appState: 'company-select', error: null });
      } else {
        set({ appState: 'login', error: null });
      }
    } catch (error) {
      console.error('检查会话失败:', error);
      set({ appState: 'login', error: null });
    }
  },

  // Login
  login: async (username, password) => {
    try {
      set({ error: null });
      const result = await window.electronAPI.account.login({ username, password });
      if (result.success) {
        const session = await window.electronAPI.account.getSession();
        set({
          currentAccount: { id: result.accountId, username: session?.username || username },
        });

        const companies = await window.electronAPI.company.list();
        set({ companies, appState: 'company-select', error: null });
        return { success: true };
      } else {
        set({ error: result.error });
        return { success: false, error: result.error };
      }
    } catch (error) {
      const msg = error.message || '登录失败';
      set({ error: msg });
      return { success: false, error: msg };
    }
  },

  // Register
  register: async (username, password) => {
    try {
      set({ error: null });
      const result = await window.electronAPI.account.register({ username, password });
      if (result.success) {
        set({
          currentAccount: { id: result.accountId, username },
          companies: [],
          appState: 'company-select',
          error: null,
        });
        return { success: true };
      } else {
        set({ error: result.error });
        return { success: false, error: result.error };
      }
    } catch (error) {
      const msg = error.message || '注册失败';
      set({ error: msg });
      return { success: false, error: msg };
    }
  },

  // Logout
  logout: async () => {
    try {
      await window.electronAPI.account.logout();
    } catch (e) {
      console.error('登出失败:', e);
    }
    set({
      appState: 'login',
      currentAccount: null,
      currentCompany: null,
      companies: [],
      error: null,
    });
  },

  // Select company
  selectCompany: async (companyId) => {
    try {
      set({ error: null });
      const result = await window.electronAPI.company.select({ companyId });
      if (result.success) {
        set({
          currentCompany: result.company,
          appState: 'main',
          error: null,
        });
        return { success: true };
      } else {
        set({ error: result.error });
        return { success: false, error: result.error };
      }
    } catch (error) {
      const msg = error.message || '选择公司失败';
      set({ error: msg });
      return { success: false, error: msg };
    }
  },

  // Create company
  createCompany: async (name, description) => {
    try {
      set({ error: null });
      const result = await window.electronAPI.company.create({ name, description });
      if (result.success) {
        const companies = await window.electronAPI.company.list();
        set({ companies, error: null });
        return { success: true, companyId: result.companyId };
      } else {
        set({ error: result.error });
        return { success: false, error: result.error };
      }
    } catch (error) {
      const msg = error.message || '创建公司失败';
      set({ error: msg });
      return { success: false, error: msg };
    }
  },

  // Delete company
  deleteCompany: async (companyId) => {
    try {
      const result = await window.electronAPI.company.delete({ companyId });
      if (result.success) {
        const companies = await window.electronAPI.company.list();
        set({ companies, error: null });
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Switch company (from main app back to company select)
  switchCompany: () => {
    set({
      appState: 'company-select',
      currentCompany: null,
    });
  },

  // Clear error
  clearError: () => set({ error: null }),
}));
