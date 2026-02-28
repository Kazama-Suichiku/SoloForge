/**
 * Dashboard API 路由
 */

const express = require('express');
const router = express.Router();
const { agentConfigStore } = require('../core/config');
const { budgetManager, tokenTracker } = require('../core/budget');
const { operationsStore } = require('../core/operations');
const { todoStore } = require('../core/todo');
const { logger } = require('../utils/logger');

/**
 * GET /api/dashboard
 * 获取仪表板数据
 */
router.get('/', async (req, res) => {
  try {
    // Agent 统计
    const allAgents = agentConfigStore.getAll();
    const activeAgents = allAgents.filter(a => a.status === 'active');
    
    // Token 统计
    const tokenSummary = tokenTracker.getSummary();
    
    // 预算信息
    const budgetInfo = {
      globalDailyLimit: budgetManager.globalDailyLimit,
      globalTotalLimit: budgetManager.globalTotalLimit,
    };
    
    // 运营数据
    const goals = operationsStore.getGoals();
    const tasks = operationsStore.getTasks();
    const kpis = operationsStore.getKPIs();
    
    // 任务统计
    const taskStats = {
      total: tasks.length,
      todo: tasks.filter(t => t.status === 'todo').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      done: tasks.filter(t => t.status === 'done').length,
    };
    
    // 目标统计
    const goalStats = {
      total: goals.length,
      active: goals.filter(g => g.status === 'active').length,
      completed: goals.filter(g => g.status === 'completed').length,
    };

    res.json({
      success: true,
      dashboard: {
        agents: {
          total: allAgents.length,
          active: activeAgents.length,
        },
        tokens: {
          totalUsed: tokenSummary.totalTokens || 0,
          todayUsed: tokenSummary.todayTokens || 0,
        },
        budget: budgetInfo,
        goals: goalStats,
        tasks: taskStats,
        kpis: {
          total: kpis.length,
        },
        recentActivity: operationsStore.getActivityLog?.() || [],
      },
    });
  } catch (error) {
    logger.error('Dashboard API error', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dashboard/tasks
 * 获取任务列表
 */
router.get('/tasks', async (req, res) => {
  try {
    const tasks = operationsStore.getTasks();
    res.json({ success: true, tasks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dashboard/goals
 * 获取目标列表
 */
router.get('/goals', async (req, res) => {
  try {
    const goals = operationsStore.getGoals();
    res.json({ success: true, goals });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dashboard/token-usage
 * 获取 Token 使用情况
 */
router.get('/token-usage', async (req, res) => {
  try {
    const summary = tokenTracker.getSummary();
    const byAgent = tokenTracker.getByAgent?.() || {};
    
    res.json({
      success: true,
      usage: {
        summary,
        byAgent,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
