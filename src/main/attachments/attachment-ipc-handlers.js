/**
 * SoloForge - 附件 IPC Handlers
 * 处理附件的保存、读取等 IPC 通信
 * @module attachments/attachment-ipc-handlers
 */

const { ipcMain, dialog } = require('electron');
const { attachmentManager } = require('./attachment-manager');
const { logger } = require('../utils/logger');

/**
 * 设置附件 IPC Handlers
 */
function setupAttachmentIpcHandlers() {
  // 保存附件（从 buffer）
  ipcMain.handle('attachment:save', async (_event, data) => {
    try {
      const { buffer, mimeType, filename } = data;
      if (!buffer || !mimeType) {
        return { error: '缺少 buffer 或 mimeType' };
      }

      // IPC buffer 转换：ArrayBuffer/Uint8Array/普通对象 → Node.js Buffer
      // Electron sandbox 模式下，ArrayBuffer 经过 contextBridge + IPC 两层序列化后
      // 可能变成 Buffer、Uint8Array、ArrayBuffer 或甚至带数字键的普通对象
      let buf;
      if (Buffer.isBuffer(buffer)) {
        buf = buffer;
      } else if (buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer) {
        buf = Buffer.from(buffer);
      } else if (buffer instanceof Uint8Array || ArrayBuffer.isView(buffer)) {
        buf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } else if (buffer && typeof buffer === 'object') {
        // IPC 序列化降级：对象带数字键 { 0: 255, 1: 216, ... } 或 { type: 'Buffer', data: [...] }
        if (buffer.type === 'Buffer' && Array.isArray(buffer.data)) {
          buf = Buffer.from(buffer.data);
        } else {
          // 尝试从对象的值构建 buffer（按数字键排序）
          const keys = Object.keys(buffer).filter(k => !isNaN(k)).sort((a, b) => Number(a) - Number(b));
          if (keys.length > 0) {
            const arr = keys.map(k => buffer[k]);
            buf = Buffer.from(arr);
          } else {
            buf = Buffer.from(buffer);
          }
        }
      } else {
        return { error: 'buffer 格式无法识别' };
      }

      if (buf.length === 0) {
        return { error: 'buffer 为空' };
      }

      logger.info('附件 IPC: 收到 buffer', { 
        originalType: typeof buffer, 
        isBuffer: Buffer.isBuffer(buffer),
        bufferLength: buf.length, 
        mimeType 
      });

      const result = attachmentManager.saveAttachment(buf, mimeType, filename);
      return { success: true, attachment: result };
    } catch (err) {
      logger.error('保存附件失败:', err);
      return { error: err.message };
    }
  });

  // 从本地文件路径保存附件
  ipcMain.handle('attachment:save-from-path', async (_event, sourcePath) => {
    try {
      if (!sourcePath) {
        return { error: '缺少文件路径' };
      }
      const result = attachmentManager.saveAttachmentFromPath(sourcePath);
      return { success: true, attachment: result };
    } catch (err) {
      logger.error('从路径保存附件失败:', err);
      return { error: err.message };
    }
  });

  // 获取附件 base64
  ipcMain.handle('attachment:get-base64', async (_event, filePath) => {
    try {
      if (!filePath) {
        return { error: '缺少文件路径' };
      }
      const result = attachmentManager.getAttachmentAsBase64(filePath);
      return { success: true, ...result };
    } catch (err) {
      logger.error('获取附件 base64 失败:', err);
      return { error: err.message };
    }
  });

  // 打开文件选择对话框（选择图片）
  ipcMain.handle('dialog:select-images', async (_event) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        ],
      });

      if (result.canceled || !result.filePaths.length) {
        return { canceled: true, attachments: [] };
      }

      // 保存选中的文件到附件目录
      const attachments = [];
      for (const filePath of result.filePaths) {
        try {
          const attachment = attachmentManager.saveAttachmentFromPath(filePath);
          attachments.push(attachment);
        } catch (err) {
          logger.warn('保存选中的图片失败:', filePath, err.message);
        }
      }

      return { canceled: false, attachments };
    } catch (err) {
      logger.error('选择图片对话框失败:', err);
      return { error: err.message };
    }
  });
}

/**
 * 移除附件 IPC Handlers
 */
function removeAttachmentIpcHandlers() {
  ipcMain.removeHandler('attachment:save');
  ipcMain.removeHandler('attachment:save-from-path');
  ipcMain.removeHandler('attachment:get-base64');
  ipcMain.removeHandler('dialog:select-images');
}

module.exports = {
  setupAttachmentIpcHandlers,
  removeAttachmentIpcHandlers,
};
