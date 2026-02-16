/**
 * SoloForge - Agent 暂存区
 * 跨会话保持 Agent 工作状态，记录当前任务、已完成步骤、关键发现
 * 
 * 核心思想（参考 Anthropic Agent SDK）：
 * - 每个 Agent 有独立的进度文件
 * - 新会话开始时自动恢复上下文
 * - Agent 可主动更新暂存区
 * 
 * @module context/agent-scratchpad
 */

const fs = require('fs');
const path = require('path');
const { dataPath } = require('../account/data-path');
const { atomicWriteSync } = require('../utils/atomic-write');
const { logger } = require('../utils/logger');

/**
 * 暂存区数据保留的最大条目数
 */
const MAX_TASK_HISTORY = 20;
const MAX_KEY_FINDINGS = 30;
const MAX_WORKING_FILES = 20;
const MAX_PENDING_ACTIONS = 10;

/**
 * 获取暂存区存储目录
 */
function getScratchpadsDir() {
  return path.join(dataPath.getBasePath(), 'scratchpads');
}

/**
 * 确保暂存区目录存在
 */
function ensureDir() {
  const dir = getScratchpadsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Agent 暂存区类
 */
class AgentScratchpad {
  /**
   * @param {string} agentId - Agent ID
   */
  constructor(agentId) {
    this.agentId = agentId;
    this.data = {
      currentTask: null,       // 当前任务描述
      currentTaskMeta: {},     // 当前任务元数据
      taskHistory: [],         // 已完成步骤 [{ description, result, timestamp }]
      keyFindings: [],         // 关键发现 [{ content, category, timestamp }]
      workingFiles: [],        // 正在处理的文件 [{ path, action, timestamp }]
      pendingActions: [],      // 待执行操作 [{ action, priority, timestamp }]
      lastUpdated: null,
    };
    this._loaded = false;
  }

  /**
   * 获取暂存区文件路径
   */
  _getFilePath() {
    return path.join(getScratchpadsDir(), `${this.agentId}.json`);
  }

  /**
   * 加载暂存区数据
   */
  load() {
    if (this._loaded) return this;

    try {
      const filePath = this._getFilePath();
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const loaded = JSON.parse(content);
        // 合并加载的数据，保持默认结构
        this.data = {
          currentTask: loaded.currentTask || null,
          currentTaskMeta: loaded.currentTaskMeta || {},
          taskHistory: loaded.taskHistory || [],
          keyFindings: loaded.keyFindings || [],
          workingFiles: loaded.workingFiles || [],
          pendingActions: loaded.pendingActions || [],
          lastUpdated: loaded.lastUpdated,
        };
        this._loaded = true;
        logger.debug('暂存区已加载', { agentId: this.agentId });
      }
    } catch (err) {
      logger.warn('暂存区加载失败', { agentId: this.agentId, error: err.message });
    }

    this._loaded = true;
    return this;
  }

  /**
   * 保存暂存区数据
   */
  save() {
    try {
      ensureDir();
      this.data.lastUpdated = Date.now();
      atomicWriteSync(this._getFilePath(), JSON.stringify(this.data, null, 2));
      logger.debug('暂存区已保存', { agentId: this.agentId });
    } catch (err) {
      logger.error('暂存区保存失败', { agentId: this.agentId, error: err.message });
    }
    return this;
  }

  /**
   * 设置当前任务
   * @param {string} description - 任务描述
   * @param {Object} [metadata] - 元数据
   */
  setCurrentTask(description, metadata = {}) {
    // 如果有旧任务，归档到历史
    if (this.data.currentTask) {
      this.recordStep(`[任务切换] 结束: ${this.data.currentTask}`, { 
        switchedTo: description 
      });
    }

    this.data.currentTask = description;
    this.data.currentTaskMeta = {
      ...metadata,
      startedAt: Date.now(),
    };
    this.save();
    logger.info('暂存区: 设置当前任务', { agentId: this.agentId, task: description.slice(0, 50) });
    return this;
  }

  /**
   * 记录完成的步骤
   * @param {string} description - 步骤描述
   * @param {Object} [result] - 执行结果
   */
  recordStep(description, result = {}) {
    this.data.taskHistory.push({
      description,
      result,
      timestamp: Date.now(),
    });

    // 限制历史条数
    if (this.data.taskHistory.length > MAX_TASK_HISTORY) {
      this.data.taskHistory = this.data.taskHistory.slice(-MAX_TASK_HISTORY);
    }

    this.save();
    return this;
  }

  /**
   * 添加关键发现
   * @param {string} content - 发现内容
   * @param {string} [category='general'] - 分类 (architecture/code_pattern/config/bug/decision/other)
   */
  addKeyFinding(content, category = 'general') {
    // 检查是否已存在相似发现（避免重复）
    const exists = this.data.keyFindings.some(
      (f) => f.content === content || f.content.includes(content.slice(0, 50))
    );
    if (exists) {
      return this;
    }

    this.data.keyFindings.push({
      content,
      category,
      timestamp: Date.now(),
    });

    // 限制发现条数
    if (this.data.keyFindings.length > MAX_KEY_FINDINGS) {
      this.data.keyFindings = this.data.keyFindings.slice(-MAX_KEY_FINDINGS);
    }

    this.save();
    logger.info('暂存区: 添加关键发现', { agentId: this.agentId, category, content: content.slice(0, 50) });
    return this;
  }

  /**
   * 添加正在处理的文件
   * @param {string} filePath - 文件路径
   * @param {string} [action='editing'] - 操作类型
   */
  addWorkingFile(filePath, action = 'editing') {
    // 更新已存在的条目或添加新条目
    const existing = this.data.workingFiles.findIndex((f) => f.path === filePath);
    if (existing >= 0) {
      this.data.workingFiles[existing] = { path: filePath, action, timestamp: Date.now() };
    } else {
      this.data.workingFiles.push({ path: filePath, action, timestamp: Date.now() });
    }

    // 限制文件数
    if (this.data.workingFiles.length > MAX_WORKING_FILES) {
      this.data.workingFiles = this.data.workingFiles.slice(-MAX_WORKING_FILES);
    }

    this.save();
    return this;
  }

  /**
   * 移除处理完成的文件
   * @param {string} filePath
   */
  removeWorkingFile(filePath) {
    this.data.workingFiles = this.data.workingFiles.filter((f) => f.path !== filePath);
    this.save();
    return this;
  }

  /**
   * 添加待执行操作
   * @param {string} action - 操作描述
   * @param {number} [priority=3] - 优先级 1-5
   */
  addPendingAction(action, priority = 3) {
    this.data.pendingActions.push({
      action,
      priority,
      timestamp: Date.now(),
    });

    // 限制并按优先级排序
    this.data.pendingActions = this.data.pendingActions
      .slice(-MAX_PENDING_ACTIONS)
      .sort((a, b) => a.priority - b.priority);

    this.save();
    return this;
  }

  /**
   * 完成待执行操作
   * @param {string} action - 操作描述（部分匹配）
   */
  completePendingAction(action) {
    this.data.pendingActions = this.data.pendingActions.filter(
      (a) => !a.action.includes(action) && !action.includes(a.action)
    );
    this.save();
    return this;
  }

  /**
   * 清空暂存区
   */
  clear() {
    this.data = {
      currentTask: null,
      currentTaskMeta: {},
      taskHistory: [],
      keyFindings: [],
      workingFiles: [],
      pendingActions: [],
      lastUpdated: null,
    };
    this.save();
    logger.info('暂存区已清空', { agentId: this.agentId });
    return this;
  }

  /**
   * 获取上下文摘要（用于注入到对话开始时）
   * @returns {string}
   */
  getContextSummary() {
    this.load();

    const parts = [];

    // 当前任务
    if (this.data.currentTask) {
      const elapsed = this.data.currentTaskMeta.startedAt
        ? Math.round((Date.now() - this.data.currentTaskMeta.startedAt) / 60000)
        : '?';
      parts.push(`**当前任务** (已进行 ${elapsed} 分钟): ${this.data.currentTask}`);
    }

    // 最近完成的步骤
    if (this.data.taskHistory.length > 0) {
      const recent = this.data.taskHistory.slice(-5);
      parts.push(
        '**最近完成的步骤**:\n' +
          recent.map((s) => `- ${s.description}`).join('\n')
      );
    }

    // 关键发现（按分类分组）
    if (this.data.keyFindings.length > 0) {
      const byCategory = {};
      for (const f of this.data.keyFindings.slice(-10)) {
        const cat = f.category || 'general';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(f.content);
      }

      const findingsStr = Object.entries(byCategory)
        .map(([cat, items]) => `  [${cat}] ${items.join('; ')}`)
        .join('\n');
      parts.push('**关键发现**:\n' + findingsStr);
    }

    // 正在处理的文件
    if (this.data.workingFiles.length > 0) {
      parts.push(
        '**正在处理的文件**: ' +
          this.data.workingFiles.map((f) => `${f.path} (${f.action})`).join(', ')
      );
    }

    // 待执行操作
    if (this.data.pendingActions.length > 0) {
      parts.push(
        '**待执行操作**:\n' +
          this.data.pendingActions
            .slice(0, 5)
            .map((a) => `- [P${a.priority}] ${a.action}`)
            .join('\n')
      );
    }

    if (parts.length === 0) {
      return '';
    }

    return `## 工作状态恢复\n\n${parts.join('\n\n')}\n`;
  }

  /**
   * 检查是否有有效内容
   * @returns {boolean}
   */
  hasContent() {
    this.load();
    return !!(
      this.data.currentTask ||
      this.data.taskHistory.length > 0 ||
      this.data.keyFindings.length > 0
    );
  }

  /**
   * 获取原始数据（用于调试）
   */
  getData() {
    this.load();
    return { ...this.data };
  }
}

// ═══════════════════════════════════════════════════════════
// 暂存区管理器（单例模式）
// ═══════════════════════════════════════════════════════════

class ScratchpadManager {
  constructor() {
    /** @type {Map<string, AgentScratchpad>} */
    this._scratchpads = new Map();
  }

  /**
   * 获取 Agent 的暂存区（惰性创建）
   * @param {string} agentId
   * @returns {AgentScratchpad}
   */
  get(agentId) {
    if (!this._scratchpads.has(agentId)) {
      const sp = new AgentScratchpad(agentId);
      sp.load();
      this._scratchpads.set(agentId, sp);
    }
    return this._scratchpads.get(agentId);
  }

  /**
   * 重新初始化（公司切换时调用）
   */
  reinitialize() {
    this._scratchpads.clear();
  }

  /**
   * 列出所有暂存区
   * @returns {Array<{ agentId: string, hasContent: boolean }>}
   */
  list() {
    const dir = getScratchpadsDir();
    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      const agentId = f.replace('.json', '');
      const sp = this.get(agentId);
      return {
        agentId,
        hasContent: sp.hasContent(),
        currentTask: sp.data.currentTask,
        lastUpdated: sp.data.lastUpdated,
      };
    });
  }

  /**
   * 清空所有暂存区
   */
  clearAll() {
    for (const sp of this._scratchpads.values()) {
      sp.clear();
    }
    this._scratchpads.clear();
  }
}

// 单例
const scratchpadManager = new ScratchpadManager();

module.exports = {
  AgentScratchpad,
  ScratchpadManager,
  scratchpadManager,
};
