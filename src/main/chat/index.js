/**
 * SoloForge - 聊天模块统一导出
 * @module chat
 */

const { ChatAgent } = require('./chat-agent');
const { SecretaryAgent, SECRETARY_SYSTEM_PROMPT } = require('./secretary-agent');
const { CEOAgent, CTOAgent, CFOAgent } = require('./cxo-agents');
const { ChatManager, chatManager } = require('./chat-manager');

module.exports = {
  ChatAgent,
  SecretaryAgent,
  CEOAgent,
  CTOAgent,
  CFOAgent,
  ChatManager,
  chatManager,
  SECRETARY_SYSTEM_PROMPT,
};
