/**
 * 应用初始化
 */

import { storage } from '../storage';
import { llm } from '../llm';
import { DEFAULT_AGENTS } from '../config/agents';

const INIT_KEY = '@soloforge/initialized';

export async function initializeApp(): Promise<{ firstRun: boolean }> {
  try {
    // 初始化 LLM（会自动设置内置 API Key）
    await llm.initialize();
  } catch (e) {
    console.log('LLM init error:', e);
  }
  
  // 检查是否已初始化
  let initialized = false;
  try {
    initialized = (await storage.get<boolean>(INIT_KEY)) || false;
  } catch (e) {
    console.log('Storage read error:', e);
  }
  
  if (initialized) {
    return { firstRun: false };
  }

  // 首次运行，初始化默认 Agent
  try {
    const agents = await storage.getAgents();
    if (!agents || agents.length === 0) {
      await storage.setAgents(DEFAULT_AGENTS);
      console.log('已初始化默认 Agent');
    }
  } catch (e) {
    console.log('Agent init error:', e);
  }
  
  // 标记已初始化
  try {
    await storage.set(INIT_KEY, true);
  } catch (e) {
    console.log('Storage write error:', e);
  }
  
  return { firstRun: true };
}

export async function resetInitialization(): Promise<void> {
  await storage.remove(INIT_KEY);
}
