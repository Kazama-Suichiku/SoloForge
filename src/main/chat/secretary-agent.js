/**
 * SoloForge - 秘书 Agent
 * 作为用户的主要入口，负责接收任务、协调其他 Agent
 *
 * Phase 2 批次 1（P2-3）：本文件已重构为数据驱动。
 *   - 系统提示词、模型等配置统一存放于 ./cxo-config.js 的 CXO_CONFIGS.secretary
 *   - 「禁止假装执行工具」咒语等共同片段仅在 cxo-config.js 定义一次
 *   - 通过 createCxoAgentClass(cfg, Base, extraMethods) 工厂生成 SecretaryAgent 类
 *   - 保留原 SecretaryAgent 的 analyzeForDelegation 自定义方法（通过 extraMethods 注入）
 *   - 对外导出接口（SecretaryAgent 类 + SECRETARY_SYSTEM_PROMPT）与改造前完全一致
 *
 * @module chat/secretary-agent
 */

const { CXO_CONFIGS, createCxoAgentClass, getSystemPrompt } = require('./cxo-config');

// ─────────────────────────────────────────────────────────────
// SecretaryAgent 自定义方法（保留原行为）
// ─────────────────────────────────────────────────────────────

/**
 * 分析消息，判断是否需要委派
 * @param {string} message - 用户消息
 * @returns {{ shouldDelegate: boolean, delegateTo: string | null, reason: string }}
 */
function analyzeForDelegation(message) {
  const lower = message.toLowerCase();

  // 技术相关关键词
  const techKeywords = [
    '代码', '程序', '开发', '技术', '架构', 'api', 'bug', '功能', '实现',
    '系统', '数据库', '服务器', '部署', '测试', '性能', '安全',
  ];

  // 战略/业务相关关键词
  const bizKeywords = [
    '战略', '规划', '业务', '市场', '竞争', '客户', '增长', '目标',
    '计划', '方向', '决策', '合作', '商业',
  ];

  // Token 消耗/预算相关关键词
  const finKeywords = [
    '财务', '预算', '成本', '费用', '开销', '花费', '消耗',
    'token', 'Token', '报表', '账目',
  ];

  if (techKeywords.some((k) => lower.includes(k))) {
    return { shouldDelegate: true, delegateTo: 'cto', reason: '技术相关问题' };
  }

  if (bizKeywords.some((k) => lower.includes(k))) {
    return { shouldDelegate: true, delegateTo: 'ceo', reason: '战略/业务相关问题' };
  }

  if (finKeywords.some((k) => lower.includes(k))) {
    return { shouldDelegate: true, delegateTo: 'cfo', reason: '财务相关问题' };
  }

  return { shouldDelegate: false, delegateTo: null, reason: '' };
}

// ─────────────────────────────────────────────────────────────
// SecretaryAgent 类（由工厂根据 CXO_CONFIGS.secretary 数据驱动生成）
// 通过 extraMethods 注入 analyzeForDelegation，保留原行为
// ─────────────────────────────────────────────────────────────

const SecretaryAgent = createCxoAgentClass(
  CXO_CONFIGS.secretary,
  undefined, // Base 默认 ChatAgent
  { analyzeForDelegation },
);

// 向后兼容：导出与改造前同名的系统提示词常量（内容由 cxo-config 统一生成）
const SECRETARY_SYSTEM_PROMPT = getSystemPrompt('secretary');

module.exports = { SecretaryAgent, SECRETARY_SYSTEM_PROMPT };
