/**
 * 聊天 API 路由
 */

const express = require('express');
const router = express.Router();
const { chatManager } = require('../core/chat');

// 发送消息（SSE 流式响应）
router.post('/send', async (req, res) => {
  const { agentId, message, conversationId } = req.body;

  if (!agentId || !message) {
    return res.status(400).json({ error: 'agentId and message are required' });
  }

  // 设置 SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await chatManager.sendMessageStream(agentId, message, conversationId, {
      onToken: (token) => {
        res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
      },
      onComplete: (response) => {
        res.write(`data: ${JSON.stringify({ type: 'complete', content: response })}\n\n`);
        res.end();
      },
      onError: (error) => {
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
      },
    });
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// 获取会话历史
router.get('/history/:conversationId', async (req, res) => {
  try {
    const history = chatManager.getHistory(req.params.conversationId);
    res.json({ success: true, messages: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取所有会话
router.get('/conversations', async (req, res) => {
  try {
    const conversations = chatManager.getConversations();
    res.json({ success: true, conversations });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 创建新会话
router.post('/conversations', async (req, res) => {
  try {
    const { agentId, title } = req.body;
    const conversation = chatManager.createConversation(agentId, title);
    res.json({ success: true, conversation });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取所有 Agents
router.get('/agents', async (req, res) => {
  try {
    const agents = chatManager.getAllAgents();
    res.json({ success: true, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
