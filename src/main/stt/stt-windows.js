/**
 * SoloForge - Windows STT 实现
 * 使用 System.Speech.Recognition (PowerShell) 进行本地语音识别
 * @module stt/stt-windows
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

const TEMP_DIR = path.join(os.tmpdir(), 'soloforge-stt');

class WindowsSTT {
  constructor() {
    this._ensureTempDir();
  }

  _ensureTempDir() {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  }

  /**
   * 检查是否可用
   * @returns {boolean}
   */
  isAvailable() {
    return process.platform === 'win32';
  }

  /**
   * 将音频 buffer 转写为文字
   * @param {Buffer} audioBuffer - 音频数据 (webm 格式)
   * @returns {Promise<{ success: boolean, text?: string, error?: string }>}
   */
  async transcribe(audioBuffer) {
    this._ensureTempDir();

    const tempId = crypto.randomUUID();
    const tempAudioPath = path.join(TEMP_DIR, `${tempId}.wav`);

    try {
      // 注意：Windows Speech API 通常需要 WAV 格式
      // WebM 格式可能需要先转换，这里先直接写入
      fs.writeFileSync(tempAudioPath, audioBuffer);

      return await this._transcribeWithPowerShell(tempAudioPath);
    } finally {
      try {
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
      } catch { /* ignore */ }
    }
  }

  /**
   * 使用 PowerShell 调用 System.Speech.Recognition
   */
  async _transcribeWithPowerShell(audioPath) {
    // PowerShell 脚本使用 System.Speech.Recognition
    const psScript = `
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToWaveFile("${audioPath.replace(/\\/g, '\\\\')}")

# 加载默认语法
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($grammar)

try {
    $result = $recognizer.Recognize()
    if ($result) {
        Write-Output $result.Text
    } else {
        Write-Error "NO_RESULT"
    }
} catch {
    Write-Error $_.Exception.Message
} finally {
    $recognizer.Dispose()
}
`;

    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { timeout: 30000 },
        (error, stdout, stderr) => {
          if (error) {
            logger.warn('STT Windows 转写失败:', error.message, stderr);
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
              error: stderr?.includes('NO_RESULT')
                ? '未能识别任何语音内容'
                : `语音识别失败: ${stderr || '未知错误'}`,
            });
          }
        }
      );
    });
  }
}

module.exports = { WindowsSTT };
