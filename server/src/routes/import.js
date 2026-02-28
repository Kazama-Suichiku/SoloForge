/**
 * 数据导入 API 路由
 */

const express = require('express');
const router = express.Router();
const { importService } = require('../core/import');
const { logger } = require('../utils/logger');

/**
 * POST /api/import/desktop
 * 从桌面版数据目录导入数据
 */
router.post('/desktop', async (req, res) => {
  try {
    const { dataPath } = req.body;
    
    if (!dataPath) {
      return res.status(400).json({
        success: false,
        error: 'dataPath is required',
      });
    }

    logger.info('Starting desktop data import', { dataPath });
    
    const result = await importService.importFromDesktop(dataPath);
    
    res.json({
      success: result.success,
      stats: result.stats,
      errors: result.errors,
    });
  } catch (error) {
    logger.error('Import API error', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/import/stats
 * 获取最近一次导入的统计信息
 */
router.get('/stats', (req, res) => {
  res.json({
    success: true,
    stats: importService.getImportStats(),
  });
});

module.exports = router;
