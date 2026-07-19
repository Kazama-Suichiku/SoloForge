/**
 * SoloForge - 流式输出处理
 * 智能缓冲：过滤 ｢tool_call｣ / ｢thinking｣ 等内部标签，避免把内部内容推送到前端
 *
 * 原先位于 chat-manager.js 的 _createStreamBuffer 方法，抽出为独立模块以便复用与测试。
 *
 * @module chat/stream-handler
 */

const { logger } = require('../utils/logger');
const CHANNELS = require('../../shared/ipc-channels');

// 需要过滤的标签对（注意：以伪标签书写避免被本文件自身字符串误识别）
const FILTER_TAGS = [
  { start: '<' + 'tool_call>', end: '</' + 'tool_call>' },
  { start: '<thinking>', end: '</thinking>' },
];

/**
 * 创建一个流式缓冲处理器
 * 持续处理 chunk，过滤 ｢tool_call｣ / ｢thinking｣ 等标签内容
 * @returns {{ process(chunk: string): { toSend: string }, flush(): string }}
 */
function createStreamBuffer() {
  return {
    buffer: '',
    currentTag: null,

    /**
     * 检查字符串是否是某个过滤标签的有效前缀
     */
    _isFilterTagPrefix(str) {
      if (!str.startsWith('<')) return false;
      for (const tag of FILTER_TAGS) {
        if (tag.start.startsWith(str) || tag.end.startsWith(str)) {
          return true;
        }
      }
      return false;
    },

    /**
     * 查找最早出现的过滤标签
     */
    _findFirstFilterTag(text) {
      let earliest = null;
      for (const tag of FILTER_TAGS) {
        const idx = text.indexOf(tag.start);
        if (idx !== -1 && (earliest === null || idx < earliest.index)) {
          earliest = { tag, index: idx };
        }
      }
      return earliest;
    },

    /**
     * 处理新的 chunk
     * @param {string} chunk
     * @returns {{ toSend: string }}
     */
    process(chunk) {
      this.buffer += chunk;
      let toSend = '';

      let processing = true;
      while (processing && this.buffer.length > 0) {
        if (this.currentTag) {
          const endIdx = this.buffer.indexOf(this.currentTag.end);
          if (endIdx !== -1) {
            this.buffer = this.buffer.slice(endIdx + this.currentTag.end.length);
            this.currentTag = null;
          } else {
            processing = false;
          }
        } else {
          const found = this._findFirstFilterTag(this.buffer);
          if (found) {
            if (found.index > 0) {
              toSend += this.buffer.slice(0, found.index);
            }
            this.buffer = this.buffer.slice(found.index + found.tag.start.length);
            this.currentTag = found.tag;
          } else {
            let safeLength = this.buffer.length;
            const maxTagLen = Math.max(...FILTER_TAGS.map((t) => t.start.length));
            for (let i = Math.max(0, this.buffer.length - maxTagLen); i < this.buffer.length; i++) {
              const suffix = this.buffer.slice(i);
              if (this._isFilterTagPrefix(suffix)) {
                safeLength = i;
                break;
              }
            }
            if (safeLength > 0) {
              toSend += this.buffer.slice(0, safeLength);
            }
            this.buffer = this.buffer.slice(safeLength);
            processing = false;
          }
        }
      }

      return { toSend };
    },

    /**
     * 刷新剩余内容（流结束时调用）
     */
    flush() {
      if (this.currentTag) {
        this.buffer = '';
        return '';
      }
      const remaining = this.buffer;
      this.buffer = '';
      return remaining;
    },
  };
}

/**
 * 向 webContents 推送流式内容
 * @param {Electron.WebContents | null} webContents
 * @param {string} messageId
 * @param {string} content
 */
function sendStreamChunk(webContents, messageId, content) {
  if (webContents && !webContents.isDestroyed() && content) {
    webContents.send(CHANNELS.CHAT_STREAM, { messageId, content });
  }
}

/**
 * 推送流式完成事件
 * @param {Electron.WebContents | null} webContents
 * @param {string} messageId
 * @param {string} content
 */
function sendStreamComplete(webContents, messageId, content) {
  if (webContents && !webContents.isDestroyed()) {
    webContents.send(CHANNELS.CHAT_COMPLETE, { messageId, content });
  }
}

/**
 * 推送工具事件（结构化数据）
 * @param {Electron.WebContents | null} webContents
 * @param {string} messageId
 * @param {Object} toolEvent
 */
function sendToolEvent(webContents, messageId, toolEvent) {
  if (webContents && !webContents.isDestroyed()) {
    webContents.send(CHANNELS.CHAT_STREAM, { messageId, toolEvent });
  }
}

module.exports = {
  FILTER_TAGS,
  createStreamBuffer,
  sendStreamChunk,
  sendStreamComplete,
  sendToolEvent,
};
