/**
 * SoloForge - STT (Speech-to-Text) 服务
 * 根据平台选择不同的语音识别实现
 * - macOS: SFSpeechRecognizer (on-device)
 * - Windows: System.Speech.Recognition (PowerShell)
 * @module stt/stt-service
 */

const { logger } = require('../utils/logger');

class STTService {
  constructor() {
    this._provider = null;
  }

  /**
   * 初始化：预编译平台相关的 STT 工具（应用启动时调用）
   */
  initialize() {
    const provider = this._getProvider();
    if (provider && typeof provider.precompile === 'function') {
      provider.precompile();
    }
  }

  /**
   * 获取平台对应的 STT 提供者
   * @returns {Object} STT provider
   */
  _getProvider() {
    if (this._provider) return this._provider;

    if (process.platform === 'darwin') {
      const { MacOSSTT } = require('./stt-macos');
      this._provider = new MacOSSTT();
    } else if (process.platform === 'win32') {
      const { WindowsSTT } = require('./stt-windows');
      this._provider = new WindowsSTT();
    } else {
      this._provider = {
        async transcribe() {
          return { success: false, error: '当前平台不支持语音识别' };
        },
        isAvailable() { return false; },
      };
    }

    return this._provider;
  }

  /**
   * 将音频数据转为文字
   * @param {Buffer | ArrayBuffer | Uint8Array} audioBuffer - 音频数据 (webm/opus 格式)
   * @returns {Promise<{ success: boolean, text?: string, error?: string }>}
   */
  async transcribe(audioBuffer) {
    try {
      const provider = this._getProvider();
      if (!provider.isAvailable()) {
        return { success: false, error: '语音识别服务不可用，请检查系统设置' };
      }

      // 确保是 Buffer
      const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
      if (buf.length === 0) {
        return { success: false, error: '音频数据为空' };
      }

      logger.info('STT: 开始转写', { bufferSize: buf.length, platform: process.platform });
      const result = await provider.transcribe(buf);
      logger.info('STT: 转写完成', { success: result.success, textLength: result.text?.length });
      return result;
    } catch (err) {
      logger.error('STT: 转写失败', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * 检查 STT 是否可用
   * @returns {boolean}
   */
  isAvailable() {
    try {
      return this._getProvider().isAvailable();
    } catch {
      return false;
    }
  }
}

const sttService = new STTService();

module.exports = { sttService, STTService };
