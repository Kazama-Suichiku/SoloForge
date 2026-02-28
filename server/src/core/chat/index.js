/**
 * Chat Module Exports
 */

const { ChatManager, chatManager } = require('./chat-manager');
const { ChatAgent } = require('./chat-agent');
const {
  CEOAgent,
  CTOAgent,
  CFOAgent,
  CHROAgent,
  SecretaryAgent,
} = require('./cxo-agents');

module.exports = {
  ChatManager,
  chatManager,
  ChatAgent,
  CEOAgent,
  CTOAgent,
  CFOAgent,
  CHROAgent,
  SecretaryAgent,
};
