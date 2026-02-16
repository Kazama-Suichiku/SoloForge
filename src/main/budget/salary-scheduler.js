/**
 * SoloForge - 工资调度器
 * 实现每日 00:00 自动发薪
 * @module budget/salary-scheduler
 */

const { logger } = require('../utils/logger');

// 延迟加载 budgetManager 避免循环依赖
let _budgetManager = null;
function getBudgetManager() {
  if (!_budgetManager) {
    _budgetManager = require('./budget-manager').budgetManager;
  }
  return _budgetManager;
}

/**
 * 工资调度器
 */
class SalaryScheduler {
  constructor() {
    this.timer = null;
    this.lastPaydayCheck = null;
    this.isRunning = false;
  }

  /**
   * 启动调度器
   * 每分钟检查一次是否需要发薪
   */
  start() {
    if (this.isRunning) {
      logger.debug('工资调度器已在运行');
      return;
    }

    this.isRunning = true;
    logger.info('工资调度器启动');

    // 启动时先检查是否需要补发
    this._catchUp();

    // 每分钟检查一次（在 00:00 - 00:05 之间触发发薪）
    this.timer = setInterval(() => {
      this._checkAndProcess();
    }, 60 * 1000); // 每分钟

    // 立即检查一次
    this._checkAndProcess();
  }

  /**
   * 停止调度器
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('工资调度器停止');
  }

  /**
   * 检查并处理发薪
   * @private
   */
  _checkAndProcess() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const today = now.toISOString().split('T')[0];

    // 只在 00:00 - 00:05 之间执行发薪
    if (hours === 0 && minutes < 5) {
      // 检查今天是否已经处理过
      if (this.lastPaydayCheck === today) {
        return;
      }

      logger.info('触发每日发薪流程');
      this._processPayday();
      this.lastPaydayCheck = today;
    }
  }

  /**
   * 处理发薪
   * @private
   */
  _processPayday() {
    try {
      const budgetManager = getBudgetManager();
      const result = budgetManager.processPayday();

      if (result.processedCount > 0) {
        logger.info(`每日发薪完成: ${result.processedCount} 位员工`);

        // 检查是否有透支的员工，发送通知
        const overdrawn = result.results.filter((r) => r.wasOverdrawn);
        if (overdrawn.length > 0) {
          logger.warn(`${overdrawn.length} 位员工处于透支状态`);
        }
      }
    } catch (error) {
      logger.error('每日发薪失败:', error);
    }
  }

  /**
   * 补发缺失的工资（应用启动时调用）
   * @private
   */
  _catchUp() {
    try {
      const budgetManager = getBudgetManager();

      // 先迁移旧数据
      const migrateResult = budgetManager.migrateToSalarySystem();
      if (migrateResult.migratedCount > 0) {
        logger.info(`工资系统迁移: ${migrateResult.migratedCount} 位员工`);
      }

      // 补发缺失的工资
      const catchUpResult = budgetManager.catchUpPaydays();
      if (catchUpResult.processedCount > 0) {
        logger.info(`补发工资: ${catchUpResult.processedCount} 位员工，共 ${catchUpResult.missedDays} 天`);
      }

      // 记录今天
      this.lastPaydayCheck = new Date().toISOString().split('T')[0];
    } catch (error) {
      logger.error('补发工资失败:', error);
    }
  }

  /**
   * 手动触发发薪（用于测试或管理）
   * @returns {{ processedCount: number, results: Array }}
   */
  triggerPayday() {
    logger.info('手动触发发薪');
    const budgetManager = getBudgetManager();
    return budgetManager.processPayday();
  }
}

// 单例
const salaryScheduler = new SalaryScheduler();

module.exports = {
  SalaryScheduler,
  salaryScheduler,
};
