/**
 * SoloForge - 附件管理器
 * 管理聊天中的图片和音频附件：保存、读取、删除
 * 存储目录：~/.soloforge/attachments/
 * @module attachments/attachment-manager
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getAttachmentsDirPath() {
  return path.join(dataPath.getBasePath(), 'attachments');
}

/** 支持的图片 MIME 类型 */
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]);

/** 支持的音频 MIME 类型 */
const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/wav',
  'audio/mp4',
  'audio/mpeg',
]);

/** MIME 类型到文件扩展名的映射 */
const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/webm': '.webm',
  'audio/webm;codecs=opus': '.webm',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
};

class AttachmentManager {
  constructor() {
    this._ensureDir();
  }

  /**
   * 确保附件目录存在
   */
  _ensureDir() {
    const dir = getAttachmentsDirPath();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info('创建附件目录:', dir);
    }
  }

  /**
   * 保存附件到本地磁盘
   * @param {Buffer | Uint8Array} buffer - 文件数据
   * @param {string} mimeType - MIME 类型
   * @param {string} [originalFilename] - 原始文件名
   * @returns {{ id: string, type: string, path: string, mimeType: string, filename: string, size: number }}
   */
  saveAttachment(buffer, mimeType, originalFilename = 'file') {
    // 判断附件类型
    const isImage = SUPPORTED_IMAGE_TYPES.has(mimeType);
    const isAudio = SUPPORTED_AUDIO_TYPES.has(mimeType);

    if (!isImage && !isAudio) {
      throw new Error(`不支持的文件格式: ${mimeType}，支持图片: ${[...SUPPORTED_IMAGE_TYPES].join(', ')}，支持音频: ${[...SUPPORTED_AUDIO_TYPES].join(', ')}`);
    }

    this._ensureDir();

    const id = crypto.randomUUID();
    const ext = MIME_TO_EXT[mimeType] || (isAudio ? '.webm' : '.png');
    const filename = `${id}${ext}`;
    const filePath = path.join(getAttachmentsDirPath(), filename);

    // 确保 buffer 是 Buffer 类型
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    fs.writeFileSync(filePath, buf);

    const size = buf.length;
    const type = isAudio ? 'audio' : 'image';
    logger.info('保存附件:', { id, type, path: filePath, mimeType, size, originalFilename });

    return {
      id,
      type,
      path: filePath,
      mimeType,
      filename: originalFilename,
      size,
    };
  }

  /**
   * 从本地文件路径保存附件（拖拽/文件选择场景）
   * @param {string} sourcePath - 源文件路径
   * @returns {{ id: string, path: string, mimeType: string, filename: string, size: number }}
   */
  saveAttachmentFromPath(sourcePath) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`文件不存在: ${sourcePath}`);
    }

    const ext = path.extname(sourcePath).toLowerCase();
    const mimeType = this._extToMime(ext);
    if (!mimeType) {
      throw new Error(`不支持的文件格式: ${ext}`);
    }

    const buffer = fs.readFileSync(sourcePath);
    const originalFilename = path.basename(sourcePath);
    return this.saveAttachment(buffer, mimeType, originalFilename);
  }

  /**
   * 读取附件并返回 base64 字符串
   * @param {string} filePath - 文件路径
   * @returns {{ base64: string, mimeType: string }}
   */
  getAttachmentAsBase64(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`附件文件不存在: ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = this._extToMime(ext) || 'image/png';
    const base64 = buffer.toString('base64');

    return { base64, mimeType };
  }

  /**
   * 删除附件文件
   * @param {string} filePath - 文件路径
   */
  deleteAttachment(filePath) {
    try {
      // 安全检查：确保文件在附件目录内
      const normalized = path.resolve(filePath);
      if (!normalized.startsWith(path.resolve(getAttachmentsDirPath()))) {
        logger.warn('拒绝删除附件目录外的文件:', filePath);
        return;
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info('已删除附件:', filePath);
      }
    } catch (err) {
      logger.warn('删除附件失败:', filePath, err.message);
    }
  }

  /**
   * 文件扩展名转 MIME 类型
   * @param {string} ext - 扩展名（含 .）
   * @returns {string | null}
   */
  _extToMime(ext) {
    const map = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.webm': 'audio/webm',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.mp3': 'audio/mpeg',
    };
    return map[ext] || null;
  }

  /**
   * 获取附件目录路径
   * @returns {string}
   */
  getAttachmentsDir() {
    return getAttachmentsDirPath();
  }

  /**
   * 重新初始化（切换公司后调用）
   * 确保新路径的附件目录存在
   */
  reinitialize() {
    this._ensureDir();
  }
}

const attachmentManager = new AttachmentManager();

module.exports = { attachmentManager, AttachmentManager };
