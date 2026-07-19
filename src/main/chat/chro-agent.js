/**
 * SoloForge - CHRO Agent（首席人力资源官）
 * 负责人事管理、组织架构、Agent 招聘审批
 *
 * Phase 2 批次 1（P2-3）：本文件已重构为数据驱动。
 *   - 系统提示词、模型等配置统一存放于 ./cxo-config.js 的 CXO_CONFIGS.chro
 *   - 「禁止假装执行工具」咒语等共同片段仅在 cxo-config.js 定义一次
 *   - 通过 createCxoAgentClass(cfg) 工厂生成 CHROAgent 类
 *   - 对外导出接口（CHROAgent 类 + CHRO_SYSTEM_PROMPT）与改造前完全一致
 *
 * @module chat/chro-agent
 */

const { CXO_CONFIGS, createCxoAgentClass, getSystemPrompt } = require('./cxo-config');

// ─────────────────────────────────────────────────────────────
// CHRO Agent 类（由工厂根据 CXO_CONFIGS.chro 数据驱动生成）
// ─────────────────────────────────────────────────────────────

const CHROAgent = createCxoAgentClass(CXO_CONFIGS.chro);

// 向后兼容：导出与改造前同名的系统提示词常量（内容由 cxo-config 统一生成）
const CHRO_SYSTEM_PROMPT = getSystemPrompt('chro');

module.exports = { CHROAgent, CHRO_SYSTEM_PROMPT };
