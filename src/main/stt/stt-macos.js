/**
 * SoloForge - macOS STT 实现
 * 使用 SFSpeechRecognizer 进行本地语音识别
 * 通过 Swift CLI 工具调用 macOS 原生 Speech 框架
 * @module stt/stt-macos
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

const TEMP_DIR = path.join(os.tmpdir(), 'soloforge-stt');

class MacOSSTT {
  constructor() {
    this._swiftToolPath = null;
    this._compiling = false;
    this._compilePromise = null;
    this._ensureTempDir();
  }

  _ensureTempDir() {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  }

  /**
   * 应用启动时后台预编译 Swift CLI 工具（避免首次使用时 9 秒延迟）
   */
  precompile() {
    if (this._swiftToolPath || this._compiling) return;

    const compiledPath = path.join(TEMP_DIR, 'macos-stt');
    if (fs.existsSync(compiledPath)) {
      this._swiftToolPath = compiledPath;
      logger.info('STT macOS: Swift CLI 工具已存在，跳过编译');
      return;
    }

    this._compilePromise = this._compileSwiftTool();
  }

  /**
   * 后台编译 Swift 源码
   * @returns {Promise<string|null>}
   */
  async _compileSwiftTool() {
    const swiftSrc = path.join(__dirname, 'native', 'macos-stt.swift');
    const compiledPath = path.join(TEMP_DIR, 'macos-stt');

    if (!fs.existsSync(swiftSrc)) {
      logger.warn('STT macOS: Swift 源码不存在:', swiftSrc);
      return null;
    }

    this._compiling = true;
    logger.info('STT macOS: 后台预编译 Swift CLI 工具...');

    return new Promise((resolve) => {
      const { execFile: execFileAsync } = require('child_process');
      execFileAsync('swiftc', ['-O', '-o', compiledPath, swiftSrc, '-framework', 'Speech', '-framework', 'Foundation'], {
        timeout: 60000,
      }, (error) => {
        this._compiling = false;
        if (error) {
          logger.warn('STT macOS: Swift CLI 预编译失败:', error.message);
          resolve(null);
        } else {
          this._swiftToolPath = compiledPath;
          logger.info('STT macOS: Swift CLI 预编译成功');
          resolve(compiledPath);
        }
      });
    });
  }

  /**
   * 获取 Swift CLI 工具路径（如果正在编译，等待完成）
   */
  async _getSwiftToolPath() {
    if (this._swiftToolPath && fs.existsSync(this._swiftToolPath)) {
      return this._swiftToolPath;
    }

    // 检查打包路径
    const isDev = require('electron-is-dev');
    const bundledPath = isDev
      ? path.join(__dirname, 'native', 'macos-stt')
      : path.join(process.resourcesPath, 'stt', 'macos-stt');

    if (fs.existsSync(bundledPath)) {
      this._swiftToolPath = bundledPath;
      return bundledPath;
    }

    // 检查已编译的缓存
    const compiledPath = path.join(TEMP_DIR, 'macos-stt');
    if (fs.existsSync(compiledPath)) {
      this._swiftToolPath = compiledPath;
      return compiledPath;
    }

    // 如果正在后台编译，等待完成
    if (this._compilePromise) {
      const result = await this._compilePromise;
      this._compilePromise = null;
      return result;
    }

    // 同步编译（fallback，不应该执行到这里）
    logger.info('STT macOS: 编译 Swift CLI 工具...');
    try {
      const { execSync } = require('child_process');
      execSync(`swiftc -O -o "${compiledPath}" "${path.join(__dirname, 'native', 'macos-stt.swift')}" -framework Speech -framework Foundation`, {
        timeout: 30000,
      });
      logger.info('STT macOS: Swift CLI 编译成功');
      this._swiftToolPath = compiledPath;
      return compiledPath;
    } catch (err) {
      logger.warn('STT macOS: Swift CLI 编译失败:', err.message);
      return null;
    }
  }

  /**
   * 检查是否可用
   * @returns {boolean}
   */
  isAvailable() {
    // macOS 10.15+ 支持 SFSpeechRecognizer
    return process.platform === 'darwin';
  }

  /**
   * 将音频 buffer 转写为文字
   * @param {Buffer} audioBuffer - 音频数据 (WAV 格式，16kHz 16-bit PCM)
   * @returns {Promise<{ success: boolean, text?: string, error?: string }>}
   */
  async transcribe(audioBuffer) {
    this._ensureTempDir();

    // 将 audio buffer 写入临时 WAV 文件
    const tempId = crypto.randomUUID();
    const tempAudioPath = path.join(TEMP_DIR, `${tempId}.wav`);

    try {
      fs.writeFileSync(tempAudioPath, audioBuffer);

      // 获取编译好的 Swift CLI 工具（如果正在预编译，等待完成）
      const swiftTool = await this._getSwiftToolPath();
      if (swiftTool) {
        return await this._transcribeWithSwift(swiftTool, tempAudioPath);
      }

      // 降级方案
      return await this._transcribeWithAppleScript(tempAudioPath);
    } finally {
      // 清理临时文件
      try {
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
      } catch { /* ignore */ }
    }
  }

  /**
   * 使用 Swift CLI 工具转写
   */
  async _transcribeWithSwift(toolPath, audioPath) {
    return new Promise((resolve) => {
      execFile(toolPath, [audioPath], { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          logger.warn('STT macOS Swift 转写失败:', error.message, stderr);
          resolve({
            success: false,
            error: `语音识别失败: ${error.message}`,
          });
          return;
        }

        const text = stdout.trim();
        if (text) {
          resolve({ success: true, text });
        } else {
          resolve({
            success: false,
            error: '未能识别任何语音内容',
          });
        }
      });
    });
  }

  /**
   * 降级方案：使用 AppleScript 调用 macOS 语音识别
   * 注意：这是一个有限的降级方案，准确度不如 Swift CLI
   */
  async _transcribeWithAppleScript(audioPath) {
    // AppleScript 无法直接调用 SFSpeechRecognizer
    // 作为降级方案，提示用户需要编译 Swift 工具
    return {
      success: false,
      error: '语音识别需要编译 Swift CLI 工具。请在项目 src/main/stt/native/ 目录下运行: swiftc -O -o macos-stt macos-stt.swift -framework Speech -framework Foundation',
    };
  }
}

module.exports = { MacOSSTT };
