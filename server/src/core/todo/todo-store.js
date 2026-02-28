/**
 * SoloForge Mobile - Agent TODO 数据存储
 * 每个 Agent 有独立的 TODO 列表，持久化到 JSON 文件
 * @module core/todo/todo-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');

const DATA_DIR = path.join(__dirname, '../../../data');
const TODO_FILE = path.join(DATA_DIR, 'agent-todos.json');

/** 防抖延迟（毫秒） */
const DEBOUNCE_MS = 500;

class TodoStore {
  constructor() {
    /** @type {Map<string, Array>} agentId → todos */
    this._data = new Map();
    this._debounceTimer = null;
    this._loaded = false;
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * 从磁盘加载
   */
  load() {
    try {
      if (!fs.existsSync(TODO_FILE)) {
        this._data = new Map();
        this._loaded = true;
        return;
      }
      const content = fs.readFileSync(TODO_FILE, 'utf-8');
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
      this._ensureDataDir();
      const obj = Object.fromEntries(this._data);
      fs.writeFileSync(TODO_FILE, JSON.stringify(obj, null, 2), 'utf-8');
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
   * 获取 Agent 的 TODO 列表
   */
  getTodos(agentId) {
    if (!this._loaded) this.load();
    return this._data.get(agentId) || [];
  }

  /**
   * 获取所有 Agent 的 TODO
   */
  getAll() {
    if (!this._loaded) this.load();
    return Object.fromEntries(this._data);
  }

  /**
   * 创建 TODO
   */
  create(agentId, title) {
    if (!this._loaded) this.load();

    const todo = {
      id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const list = this._data.get(agentId) || [];
    list.push(todo);
    this._data.set(agentId, list);
    this._save();
    return todo;
  }

  /**
   * 更新 TODO 状态
   */
  update(agentId, todoId, status, note) {
    if (!this._loaded) this.load();

    const list = this._data.get(agentId) || [];
    const todo = list.find((t) => t.id === todoId);
    if (!todo) return null;

    todo.status = status;
    todo.updatedAt = Date.now();
    if (note) todo.note = note;

    this._save();
    return todo;
  }

  /**
   * 清除已完成的 TODO
   */
  clearDone(agentId) {
    if (!this._loaded) this.load();

    const list = this._data.get(agentId) || [];
    const before = list.length;
    const remaining = list.filter((t) => t.status !== 'done');
    this._data.set(agentId, remaining);
    const cleared = before - remaining.length;

    if (cleared > 0) this._save();
    return cleared;
  }

  /**
   * 移除 Agent 的所有 TODO
   */
  removeAgent(agentId) {
    if (!this._loaded) this.load();

    const list = this._data.get(agentId) || [];
    const count = list.length;
    if (count > 0) {
      this._data.delete(agentId);
      this._save();
      logger.info(`TodoStore: 已移除 Agent ${agentId} 的 ${count} 个 TODO`);
    }
    return count;
  }
}

const todoStore = new TodoStore();

module.exports = { todoStore };
