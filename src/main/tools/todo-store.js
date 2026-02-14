/**
 * SoloForge - Agent TODO 数据存储
 * 每个 Agent 有独立的 TODO 列表，持久化到 agent-todos.json
 * @module tools/todo-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

/** 防抖延迟（毫秒） */
const DEBOUNCE_MS = 500;

function getTodoFile() {
  return path.join(dataPath.getBasePath(), 'agent-todos.json');
}

class TodoStore {
  constructor() {
    /** @type {Map<string, Array>} agentId → todos */
    this._data = new Map();
    /** @type {Function|null} 变更通知回调 */
    this._onChange = null;
    this._debounceTimer = null;
    this._loaded = false;
  }

  /**
   * 设置变更回调（用于推送到前端）
   * @param {Function} callback - (agentId, todos) => void
   */
  onChanged(callback) {
    this._onChange = callback;
  }

  /**
   * 从磁盘加载
   */
  load() {
    try {
      const file = getTodoFile();
      if (!fs.existsSync(file)) {
        this._data = new Map();
        this._loaded = true;
        return;
      }
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(content || '{}');
      this._data = new Map(Object.entries(parsed));
      this._loaded = true;
      logger.info('TodoStore: 加载成功', {
        agents: this._data.size,
        totalTodos: [...this._data.values()].reduce((sum, arr) => sum + arr.length, 0),
      });
    } catch (error) {
      logger.error('TodoStore: 加载失败', error);
      this._data = new Map();
      this._loaded = true;
    }
  }

  /**
   * 保存到磁盘（防抖）
   */
  _save() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._flushToDisk();
    }, DEBOUNCE_MS);
  }

  _flushToDisk() {
    try {
      const dir = dataPath.getBasePath();
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const obj = Object.fromEntries(this._data);
      fs.writeFileSync(getTodoFile(), JSON.stringify(obj, null, 2), 'utf-8');
    } catch (error) {
      logger.error('TodoStore: 写入失败', error);
    }
  }

  /**
   * 立即刷盘
   */
  flush() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._flushToDisk();
  }

  /**
   * 重新初始化（切换公司时调用）
   */
  reinitialize() {
    this.flush();
    this._data = new Map();
    this._loaded = false;
  }

  /**
   * 获取 Agent 的 TODO 列表
   * @param {string} agentId
   * @returns {Array}
   */
  getTodos(agentId) {
    if (!this._loaded) this.load();
    return this._data.get(agentId) || [];
  }

  /**
   * 获取所有 Agent 的 TODO（前端用）
   * @returns {Object} { agentId: [...todos] }
   */
  getAll() {
    if (!this._loaded) this.load();
    return Object.fromEntries(this._data);
  }

  /**
   * 创建 TODO
   * @param {string} agentId
   * @param {string} title
   * @returns {Object} 新创建的 todo
   */
  create(agentId, title) {
    if (!this._loaded) this.load();

    const todo = {
      id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      status: 'pending', // pending, in_progress, done
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const list = this._data.get(agentId) || [];
    list.push(todo);
    this._data.set(agentId, list);
    this._save();
    this._notifyChange(agentId);
    return todo;
  }

  /**
   * 更新 TODO 状态
   * @param {string} agentId
   * @param {string} todoId
   * @param {string} status - pending, in_progress, done
   * @param {string} [note] - 可选备注
   * @returns {Object|null}
   */
  update(agentId, todoId, status, note) {
    if (!this._loaded) this.load();

    const list = this._data.get(agentId) || [];
    const todo = list.find((t) => t.id === todoId);
    if (!todo) return null;

    todo.status = status;
    todo.updatedAt = Date.now();
    if (note) {
      todo.note = note;
    }

    this._save();
    this._notifyChange(agentId);
    return todo;
  }

  /**
   * 清除已完成的 TODO
   * @param {string} agentId
   * @returns {number} 清除数量
   */
  clearDone(agentId) {
    if (!this._loaded) this.load();

    const list = this._data.get(agentId) || [];
    const before = list.length;
    const remaining = list.filter((t) => t.status !== 'done');
    this._data.set(agentId, remaining);
    const cleared = before - remaining.length;

    if (cleared > 0) {
      this._save();
      this._notifyChange(agentId);
    }
    return cleared;
  }

  /**
   * 通知前端变更
   */
  _notifyChange(agentId) {
    if (this._onChange) {
      try {
        this._onChange(agentId, this.getTodos(agentId));
      } catch (err) {
        logger.error('TodoStore: 通知回调出错', err);
      }
    }
  }
}

const todoStore = new TodoStore();

module.exports = { todoStore };
