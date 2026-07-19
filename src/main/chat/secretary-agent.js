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
 * Phase 4-B：秘书系统提示词（定义于 cxo-config.js 的 secretary.body）新增：
 *   - 多委派原则：可同时向多人发消息/委派任务
 *   - 权限管理职责（grant/revoke/list/audit，Phase 2-C 已加）
 *   - 群聊规则 / 组织架构工具 / 通信模式（所有 Agent 共享，定义于 collaboration-prompt.js，
 *     由 chat-agent.js 的 get systemPrompt() 自动拼接，无需在此重复）
 *
 * @module chat/secretary-agent
 */

const { CXO_CONFIGS, createCxoAgentClass, getSystemPrompt } = require('./cxo-config');

// ─────────────────────────────────────────────────────────────
// SecretaryAgent 自定义方法（保留原行为）
// ─────────────────────────────────────────────────────────────

/**
 * 分析消息，判断是否需要委派
 *
 * Phase 0 改动：支持返回多个目标（数组 delegateTo[]）。
 *   - 如果消息同时命中多个领域关键词（如「技术 + 财务」），返回所有匹配的 Agent。
 *   - 单个目标也用数组返回，调用方需要兼容数组。
 *   - 保留旧字段语义：delegateTo 现在是 `string[]`（可能为 null）。
 *   - shouldDelegate 仍为布尔值；当且仅当 delegateTo 非空数组时为 true。
 *
 * @param {string} message - 用户消息
 * @returns {{ shouldDelegate: boolean, delegateTo: string[] | null, reasons: string[] }}
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

  const delegateTo = [];
  const reasons = [];

  if (techKeywords.some((k) => lower.includes(k))) {
    delegateTo.push('cto');
    reasons.push('技术相关问题');
  }

  if (bizKeywords.some((k) => lower.includes(k))) {
    delegateTo.push('ceo');
    reasons.push('战略/业务相关问题');
  }

  if (finKeywords.some((k) => lower.includes(k))) {
    delegateTo.push('cfo');
    reasons.push('财务相关问题');
  }

  if (delegateTo.length === 0) {
    return { shouldDelegate: false, delegateTo: null, reasons: [] };
  }

  return { shouldDelegate: true, delegateTo, reasons };
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
