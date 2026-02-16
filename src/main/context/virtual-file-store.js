/**
 * SoloForge - 虚拟文件存储
 * 管理大型工具结果的外部化存储，减少上下文窗口占用
 * 
 * 核心思想（参考 lethain.com 方案）：
 * - 大消息（>5KB）写入临时文件
 * - 上下文只保留预览 + 文件引用
 * - Agent 可按需读取完整内容
 * 
 * @module context/virtual-file-store
 */

const fs = require('fs');
const path = require('path');
const { dataPath } = require('../account/data-path');
const { atomicWriteSync } = require('../utils/atomic-write');
const { logger } = require('../utils/logger');

/**
 * 虚拟文件外部化阈值（字符数）
 */
const VIRTUALIZE_THRESHOLD = 5000;

/**
 * 预览长度（字符数）
 */
const PREVIEW_LENGTH = 800;

/**
 * 虚拟文件最大保留时间（毫秒）- 24 小时
 */
const MAX_FILE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 获取虚拟文件存储目录
 */
function getVirtualFilesDir() {
  return path.join(dataPath.getBasePath(), 'virtual-files');
}

/**
 * 确保虚拟文件目录存在
 */
function ensureDir() {
  const dir = getVirtualFilesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 生成唯一的虚拟文件 ID
 */
function generateFileId() {
  return `vf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 虚拟文件存储类
 */
class VirtualFileStore {
  constructor() {
    // 内存索引：fileId -> metadata
    this._index = new Map();
    this._initialized = false;
  }

  /**
   * 初始化/重新初始化
   */
  initialize() {
    this._index.clear();
    this._loadIndex();
    this._initialized = true;
    
    // 启动时清理过期文件
    this.cleanup();
  }

  /**
   * 重新初始化（公司切换时调用）
   */
  reinitialize() {
    this.initialize();
  }

  /**
   * 加载索引文件
   */
  _loadIndex() {
    try {
      const indexPath = path.join(getVirtualFilesDir(), 'index.json');
      if (fs.existsSync(indexPath)) {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        for (const [id, meta] of Object.entries(data)) {
          this._index.set(id, meta);
        }
      }
    } catch (err) {
      logger.warn('虚拟文件索引加载失败:', err.message);
    }
  }

  /**
   * 保存索引文件
   */
  _saveIndex() {
    try {
      const dir = ensureDir();
      const indexPath = path.join(dir, 'index.json');
      const data = Object.fromEntries(this._index);
      atomicWriteSync(indexPath, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error('虚拟文件索引保存失败:', err.message);
    }
  }

  /**
   * 存储大内容，返回虚拟文件引用
   * 
   * @param {string} content - 要存储的内容
   * @param {Object} metadata - 元数据
   * @param {string} [metadata.toolName] - 来源工具名
   * @param {string} [metadata.type] - 类型（tool_result, compressed_history 等）
   * @param {string} [metadata.sessionId] - 会话 ID（用于清理）
   * @returns {{ fileId: string, preview: string, fullPath: string, size: number }}
   */
  store(content, metadata = {}) {
    const dir = ensureDir();
    const fileId = generateFileId();
    const filePath = path.join(dir, `${fileId}.txt`);

    // 写入文件
    atomicWriteSync(filePath, content);

    // 生成预览
    const preview = content.length > PREVIEW_LENGTH
      ? content.slice(0, PREVIEW_LENGTH) + '\n...(已截断，共 ' + content.length + ' 字符)'
      : content;

    // 更新索引
    const meta = {
      fileId,
      createdAt: Date.now(),
      size: content.length,
      readCount: 0,
      ...metadata,
    };
    this._index.set(fileId, meta);
    this._saveIndex();

    logger.info('虚拟文件已存储', { fileId, size: content.length, toolName: metadata.toolName });

    return {
      fileId,
      preview,
      fullPath: filePath,
      size: content.length,
    };
  }

  /**
   * 读取虚拟文件内容
   * 
   * @param {string} fileId - 虚拟文件 ID
   * @param {Object} options - 读取选项
   * @param {number} [options.offset=0] - 起始字符位置
   * @param {number} [options.limit] - 读取字符数（不指定则读取全部）
   * @param {string} [options.grep] - 搜索模式（正则表达式）
   * @returns {{ success: boolean, content?: string, matches?: Array, error?: string }}
   */
  read(fileId, options = {}) {
    const meta = this._index.get(fileId);
    if (!meta) {
      return { success: false, error: `虚拟文件不存在: ${fileId}` };
    }

    const filePath = path.join(getVirtualFilesDir(), `${fileId}.txt`);
    if (!fs.existsSync(filePath)) {
      this._index.delete(fileId);
      this._saveIndex();
      return { success: false, error: `虚拟文件已被删除: ${fileId}` };
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // 更新读取计数
      meta.readCount = (meta.readCount || 0) + 1;
      meta.lastReadAt = Date.now();
      this._saveIndex();

      // 搜索模式
      if (options.grep) {
        const regex = new RegExp(options.grep, 'gi');
        const matches = [];
        let match;
        while ((match = regex.exec(content)) !== null) {
          // 提取匹配行及上下文
          const start = Math.max(0, content.lastIndexOf('\n', match.index - 100) + 1);
          const end = content.indexOf('\n', match.index + match[0].length + 100);
          const context = content.slice(start, end === -1 ? undefined : end);
          matches.push({
            match: match[0],
            index: match.index,
            context: context.trim(),
          });
          if (matches.length >= 10) break; // 最多返回 10 个匹配
        }
        return { success: true, matches, totalMatches: matches.length };
      }

      // 范围读取
      const offset = options.offset || 0;
      const limit = options.limit;
      const slice = limit
        ? content.slice(offset, offset + limit)
        : content.slice(offset);

      return {
        success: true,
        content: slice,
        totalSize: content.length,
        offset,
        returnedSize: slice.length,
      };
    } catch (err) {
      logger.error('虚拟文件读取失败:', { fileId, error: err.message });
      return { success: false, error: `读取失败: ${err.message}` };
    }
  }

  /**
   * 检查内容是否应该被虚拟化
   * @param {string} content - 内容
   * @returns {boolean}
   */
  shouldVirtualize(content) {
    return typeof content === 'string' && content.length > VIRTUALIZE_THRESHOLD;
  }

  /**
   * 获取虚拟文件元数据
   * @param {string} fileId
   * @returns {Object|null}
   */
  getMeta(fileId) {
    return this._index.get(fileId) || null;
  }

  /**
   * 列出所有虚拟文件
   * @param {Object} options
   * @param {string} [options.sessionId] - 按会话过滤
   * @param {string} [options.type] - 按类型过滤
   * @returns {Array}
   */
  list(options = {}) {
    const results = [];
    for (const meta of this._index.values()) {
      if (options.sessionId && meta.sessionId !== options.sessionId) continue;
      if (options.type && meta.type !== options.type) continue;
      results.push(meta);
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 删除虚拟文件
   * @param {string} fileId
   * @returns {boolean}
   */
  delete(fileId) {
    const meta = this._index.get(fileId);
    if (!meta) return false;

    const filePath = path.join(getVirtualFilesDir(), `${fileId}.txt`);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this._index.delete(fileId);
      this._saveIndex();
      logger.info('虚拟文件已删除', { fileId });
      return true;
    } catch (err) {
      logger.error('虚拟文件删除失败:', { fileId, error: err.message });
      return false;
    }
  }

  /**
   * 清理过期文件
   * @param {Object} options
   * @param {string} [options.sessionId] - 清理指定会话的所有文件
   * @param {number} [options.maxAge=MAX_FILE_AGE_MS] - 最大保留时间
   */
  cleanup(options = {}) {
    const { sessionId, maxAge = MAX_FILE_AGE_MS } = options;
    const now = Date.now();
    const toDelete = [];

    for (const [fileId, meta] of this._index) {
      // 按会话清理
      if (sessionId && meta.sessionId === sessionId) {
        toDelete.push(fileId);
        continue;
      }

      // 按时间清理
      if (now - meta.createdAt > maxAge) {
        toDelete.push(fileId);
      }
    }

    for (const fileId of toDelete) {
      this.delete(fileId);
    }

    if (toDelete.length > 0) {
      logger.info('虚拟文件清理完成', { deleted: toDelete.length });
    }

    return toDelete.length;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    let totalSize = 0;
    let totalFiles = 0;
    const byType = {};

    for (const meta of this._index.values()) {
      totalFiles++;
      totalSize += meta.size || 0;
      const type = meta.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      totalFiles,
      totalSize,
      totalSizeFormatted: (totalSize / 1024).toFixed(1) + ' KB',
      byType,
    };
  }
}

// 单例
const virtualFileStore = new VirtualFileStore();

module.exports = {
  VirtualFileStore,
  virtualFileStore,
  VIRTUALIZE_THRESHOLD,
  PREVIEW_LENGTH,
};
