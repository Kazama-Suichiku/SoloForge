/**
 * SoloForge - CXO Agents (CEO, CTO, CFO)
 * 高管团队 Agent 定义
 *
 * Phase 2 批次 1（P2-3）：本文件已重构为数据驱动。
 *   - 系统提示词、模型等配置统一存放于 ./cxo-config.js 的 CXO_CONFIGS
 *   - 「禁止假装执行工具」咒语等共同片段仅在 cxo-config.js 定义一次
 *   - 通过 createCxoAgentClass(cfg) 工厂生成各 Agent 类
 *   - 对外导出接口（CEOAgent / CTOAgent / CFOAgent 类 + 各 *_SYSTEM_PROMPT）
 *     与改造前完全一致，外部调用方（chat-manager、chat/index 等）无需修改
 *
 * @module chat/cxo-agents
 */

const { CXO_CONFIGS, createCxoAgentClass, getSystemPrompt } = require('./cxo-config');

// ─────────────────────────────────────────────────────────────
// CEO / CTO / CFO Agent 类（由工厂根据 CXO_CONFIGS 数据驱动生成）
// ─────────────────────────────────────────────────────────────

const CEOAgent = createCxoAgentClass(CXO_CONFIGS.ceo);
const CTOAgent = createCxoAgentClass(CXO_CONFIGS.cto);
const CFOAgent = createCxoAgentClass(CXO_CONFIGS.cfo);

// 向后兼容：导出与改造前同名的系统提示词常量（内容由 cxo-config 统一生成）
const CEO_SYSTEM_PROMPT = getSystemPrompt('ceo');
const CTO_SYSTEM_PROMPT = getSystemPrompt('cto');
const CFO_SYSTEM_PROMPT = getSystemPrompt('cfo');

module.exports = {
  CEOAgent,
  CTOAgent,
  CFOAgent,
  CEO_SYSTEM_PROMPT,
  CTO_SYSTEM_PROMPT,
  CFO_SYSTEM_PROMPT,
};
