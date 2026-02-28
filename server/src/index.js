/**
 * SoloForge Mobile Server - 入口文件
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { logger } = require('./utils/logger');

// 路由
const chatRoutes = require('./routes/chat');
const agentsRoutes = require('./routes/agents');
const configRoutes = require('./routes/config');
const importRoutes = require('./routes/import');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());

// 请求日志
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// API 路由
app.use('/api/chat', chatRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/import', importRoutes);
app.use('/api/dashboard', dashboardRoutes);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 错误处理
app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// 初始化并启动服务器
async function start() {
  try {
    // 初始化核心模块
    const { initializeCore } = require('./core');
    await initializeCore();

    app.listen(PORT, () => {
      logger.info(`SoloForge Mobile Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
