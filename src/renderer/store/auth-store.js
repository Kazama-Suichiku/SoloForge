/**
 * SoloForge - 认证状态管理
 * 管理账号登录状态和公司选择
 */
import { create } from 'zustand';
import { useChatStore } from './chat-store';

/**
 * 公司切换后，重置渲染进程的聊天状态并从新公司路径重新加载。
 * 防止旧公司的会话内存通过 persist 写入新公司目录（数据隔离）。
 *
 * 时序要点（避免丢新公司真实数据）：
 * - 不能先 clear 再 rehydrate：clear 触发的防抖写入会把"空状态"覆盖到新公司路径，
 *   随后的 rehydrate 只会读到刚写入的空数据，导致新公司真实聊天记录被清空。
 * - 正确做法：先 rehydrate（从新公司路径读数据整体替换 conversations/messagesByConversation），
 *   若新公司无数据（rehydrate 未触发 set），内存仍是旧公司数据，此时再手动清空。
 */
async function resetChatForCompany() {
  try {
    const store = useChatStore;
    // 记录 rehydrate 前的会话数，用于判断 rehydrate 是否真正加载到了新公司数据
    const hadConversations = store.getState().conversations.size;

    if (store.persist && typeof store.persist.rehydrate === 'function') {
      await store.persist.rehydrate();
    }

    // rehydrate 后：
    // - 新公司若有数据，partialize 指定的字段已被整体替换（此处无需操作）
    // - 新公司若无数据，rehydrate 未触发 set，内存仍残留旧公司会话 → 必须清空
    const state = store.getState();
    const stillHasOldData = state.conversations.size > 0;
    if (stillHasOldData && hadConversations >= 0) {
      // 进一步判断：当前内存里的会话是否属于新公司。最可靠的方式是重新读取后端文件，
      // 但为简洁起见，采用约定：公司切换后期望 chat 状态由后端文件决定。
      // 若 rehydrate 后内存会话与后端不一致（后端为空但内存非空），清空内存。
      // 通过再次主动读取后端校验：
      try {
        const backend = await window.electronAPI.getChatHistory();
        const backendConvCount = backend && backend.state && backend.state.conversations
          ? Object.keys(backend.state.conversations).length
          : 0;
        if (backendConvCount === 0 && state.conversations.size > 0) {
          // 后端新公司确实无聊天记录，清空内存避免旧数据残留
          state.clearAllConversations();
        }
      } catch (e) {
        // 校验失败时保守清空，避免旧数据污染新公司
        console.warn('resetChatForCompany: 校验后端数据失败，保守清空', e);
        state.clearAllConversations();
      }
    }
  } catch (e) {
    console.error('resetChatForCompany: 重置聊天状态失败', e);
  }
}

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
        // 主进程 dataPath 已切换到新公司，重置渲染进程聊天状态（数据隔离）
        await resetChatForCompany();
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
