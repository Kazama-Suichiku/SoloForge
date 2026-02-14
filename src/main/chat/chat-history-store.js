/**
 * SoloForge - 聊天历史文件存储
 * 将聊天记录持久化到 ~/.soloforge/chat-history.json
 * 
 * 不使用 localStorage（Chromium LevelDB），因为：
 * - 进程被强杀时 LevelDB 来不及刷盘，数据丢失
 * - 开发模式频繁重启 Electron 容易触发此问题
 * 
 * 本模块使用 fs.writeFileSync 确保每次写入立即落盘。
 * 为避免流式输出时高频写入影响性能，setItem 使用防抖（1 秒）。
 * 
 * @module chat/chat-history-store
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getConfigDir() {
  return dataPath.getBasePath();
}

function getHistoryFile() {
  return path.join(dataPath.getBasePath(), 'chat-history.json');
}

/** 防抖延迟（毫秒） */
const DEBOUNCE_MS = 1000;

class ChatHistoryStore {
  constructor() {
    /** @type {Object|null} 最新待写入的数据 */
    this._pendingData = null;
    /** @type {ReturnType<typeof setTimeout>|null} 防抖定时器 */
    this._debounceTimer = null;
    this._ensureDir();
  }

  _ensureDir() {
    const dir = getConfigDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 读取聊天历史
   * @returns {Object|null} Zustand StorageValue 格式: { state, version }
   */
  getItem() {
    try {
      if (!fs.existsSync(getHistoryFile())) {
        logger.debug('chat-history-store: 文件不存在，返回 null');
        return null;
      }
      const content = fs.readFileSync(getHistoryFile(), 'utf-8');
      if (!content || content.trim() === '') {
        return null;
      }
      const data = JSON.parse(content);
      logger.info('chat-history-store: 加载成功', {
        conversations: data.state ? Object.keys(data.state.conversations || {}).length : 0,
        version: data.version,
      });
      return data;
    } catch (error) {
      logger.error('chat-history-store: 读取失败', error);
      return null;
    }
  }

  /**
   * 保存聊天历史（防抖写入）
   * @param {Object} value - Zustand StorageValue 格式: { state, version }
   */
  setItem(value) {
    this._pendingData = value;

    // 清除之前的定时器
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    // 设置新的防抖定时器
    this._debounceTimer = setTimeout(() => {
      this._flushToDisk();
    }, DEBOUNCE_MS);
  }

  /**
   * 立即将待写入数据刷盘
   */
  _flushToDisk() {
    if (!this._pendingData) return;

    try {
      this._ensureDir();
      const content = JSON.stringify(this._pendingData, null, 2);
      fs.writeFileSync(getHistoryFile(), content, 'utf-8');

      const convCount = this._pendingData.state
        ? Object.keys(this._pendingData.state.conversations || {}).length
        : 0;
      logger.debug('chat-history-store: 写入成功', { conversations: convCount, size: content.length });
    } catch (error) {
      logger.error('chat-history-store: 写入失败', error);
    } finally {
      this._pendingData = null;
      this._debounceTimer = null;
    }
  }

  /**
   * 立即刷盘（用于应用退出前）
   */
  flush() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._flushToDisk();
  }

  /**
   * 重新初始化（切换公司后调用）
   * 刷新待写入数据、清除防抖定时器
   */
  reinitialize() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._flushToDisk();
    this._pendingData = null;
  }

  /**
   * 删除聊天历史文件
   */
  removeItem() {
    try {
      if (fs.existsSync(getHistoryFile())) {
        fs.unlinkSync(getHistoryFile());
        logger.info('chat-history-store: 文件已删除');
      }
    } catch (error) {
      logger.error('chat-history-store: 删除失败', error);
    }
  }
}

const chatHistoryStore = new ChatHistoryStore();

module.exports = { chatHistoryStore };
