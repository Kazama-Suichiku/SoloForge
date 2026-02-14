/**
 * SoloForge - STT IPC Handlers
 * 处理语音转文字的 IPC 通信
 * @module stt/stt-ipc-handlers
 */

const { ipcMain } = require('electron');
const { sttService } = require('./stt-service');
const { logger } = require('../utils/logger');

/**
 * 设置 STT IPC Handlers
 */
function setupSTTIpcHandlers() {
  logger.info('注册 STT IPC 处理器...');

  // 预编译平台 STT 工具（后台异步，避免首次使用延迟）
  sttService.initialize();

  // 语音转文字
  ipcMain.handle('stt:transcribe', async (_event, audioBuffer) => {
    try {
      if (!audioBuffer) {
        return { success: false, error: '缺少音频数据' };
      }

      // IPC buffer 转换（同 attachment-ipc-handlers 的健壮逻辑）
      let buf;
      if (Buffer.isBuffer(audioBuffer)) {
        buf = audioBuffer;
      } else if (audioBuffer instanceof ArrayBuffer || audioBuffer instanceof SharedArrayBuffer) {
        buf = Buffer.from(audioBuffer);
      } else if (audioBuffer instanceof Uint8Array || ArrayBuffer.isView(audioBuffer)) {
        buf = Buffer.from(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
      } else if (audioBuffer && typeof audioBuffer === 'object') {
        if (audioBuffer.type === 'Buffer' && Array.isArray(audioBuffer.data)) {
          buf = Buffer.from(audioBuffer.data);
        } else {
          const keys = Object.keys(audioBuffer).filter(k => !isNaN(k)).sort((a, b) => Number(a) - Number(b));
          if (keys.length > 0) {
            buf = Buffer.from(keys.map(k => audioBuffer[k]));
          } else {
            buf = Buffer.from(audioBuffer);
          }
        }
      } else {
        return { success: false, error: '音频数据格式无法识别' };
      }

      if (buf.length === 0) {
        return { success: false, error: '音频数据为空' };
      }

      logger.info('STT IPC: 收到音频数据', {
        originalType: typeof audioBuffer,
        isBuffer: Buffer.isBuffer(audioBuffer),
        bufferLength: buf.length,
      });

      const result = await sttService.transcribe(buf);
      return result;
    } catch (err) {
      logger.error('STT IPC: 转写失败', err);
      return { success: false, error: err.message };
    }
  });

  logger.info('STT IPC 处理器注册完成');
}

/**
 * 移除 STT IPC Handlers
 */
function removeSTTIpcHandlers() {
  ipcMain.removeHandler('stt:transcribe');
}

module.exports = {
  setupSTTIpcHandlers,
  removeSTTIpcHandlers,
};
