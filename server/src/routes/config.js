/**
 * 配置 API 路由
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { agentConfigStore } = require('../core/config');
const { llmManager } = require('../core/llm');
const { logger } = require('../utils/logger');

const DATA_DIR = path.join(__dirname, '../../data');
const BOSS_CONFIG_FILE = path.join(DATA_DIR, 'boss-config.json');

// 默认老板配置
const DEFAULT_BOSS_CONFIG = {
  name: '老板',
  avatar: '👑',
};

// 获取老板配置
function getBossConfig() {
  try {
    if (fs.existsSync(BOSS_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(BOSS_CONFIG_FILE, 'utf-8'));
    }
  } catch (error) {
    logger.error('Failed to load boss config', error);
  }
  return { ...DEFAULT_BOSS_CONFIG };
}

// 保存老板配置
function saveBossConfig(config) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(BOSS_CONFIG_FILE, JSON.stringify(config, null, 2));
}

// 获取系统配置
router.get('/', async (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        organization: agentConfigStore.getOrganizationInfo(),
        llm: {
          availableModels: llmManager.getAvailableModels(),
          defaultModel: llmManager.getDefaultModel(),
        },
        boss: getBossConfig(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取组织信息
router.get('/organization', async (req, res) => {
  try {
    res.json({
      success: true,
      organization: agentConfigStore.getOrganizationInfo(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取老板配置
router.get('/boss', async (req, res) => {
  try {
    res.json({
      success: true,
      boss: getBossConfig(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新老板配置
router.put('/boss', async (req, res) => {
  try {
    const current = getBossConfig();
    const { name, avatar } = req.body;
    
    if (name !== undefined) current.name = name;
    if (avatar !== undefined) current.avatar = avatar;
    current.updatedAt = new Date().toISOString();
    
    saveBossConfig(current);
    logger.info('Boss config updated', current);
    
    res.json({
      success: true,
      boss: current,
    });
  } catch (error) {
    logger.error('Update boss config error', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
