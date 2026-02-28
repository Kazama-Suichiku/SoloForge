/**
 * Agent 管理 API 路由
 */

const express = require('express');
const router = express.Router();
const { agentConfigStore, CORE_AGENT_IDS } = require('../core/config');
const { logger } = require('../utils/logger');

// 获取在职 Agent 列表（放在 /:id 之前避免路由冲突）
router.get('/active', async (req, res) => {
  try {
    const agents = agentConfigStore.getActive();
    res.json({ success: true, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取所有 Agent
router.get('/', async (req, res) => {
  try {
    const agents = agentConfigStore.getAll();
    res.json({ success: true, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 创建新 Agent
router.post('/', async (req, res) => {
  try {
    const { name, title, department, description, avatar, model, reportsTo, profile } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }

    // 生成 ID
    const id = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    
    const config = {
      id,
      name,
      role: id,
      title: title || name,
      level: 'staff',
      department: department || 'admin',
      description: description || '',
      avatar: avatar || '👤',
      model: model || 'deepseek-chat',
      status: 'active',
      isDynamic: true,
      reportsTo: reportsTo || 'chro',
      profile: profile || null,
      createdAt: new Date().toISOString(),
    };

    agentConfigStore.add(config);
    logger.info('Agent created', { id, name });

    res.json({ success: true, agent: config });
  } catch (error) {
    logger.error('Create agent error', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取单个 Agent
router.get('/:id', async (req, res) => {
  try {
    const agent = agentConfigStore.get(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    res.json({ success: true, agent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新 Agent
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = agentConfigStore.get(id);
    
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const updates = {};
    const allowedFields = ['name', 'title', 'department', 'description', 'avatar', 'model', 'status', 'reportsTo', 'profile'];
    
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const updated = agentConfigStore.update(id, updates);
    logger.info('Agent updated', { id, updates: Object.keys(updates) });

    res.json({ success: true, agent: updated });
  } catch (error) {
    logger.error('Update agent error', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除 Agent（仅限动态 Agent）
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (CORE_AGENT_IDS.includes(id)) {
      return res.status(400).json({ success: false, error: 'Cannot delete core agent' });
    }

    const existing = agentConfigStore.get(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    // 标记为离职而不是真正删除
    agentConfigStore.update(id, { status: 'terminated' });
    logger.info('Agent terminated', { id });

    res.json({ success: true, message: 'Agent terminated' });
  } catch (error) {
    logger.error('Delete agent error', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
