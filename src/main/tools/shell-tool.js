/**
 * SoloForge - Shell 命令执行工具
 * 执行终端命令，带 30 秒超时保护
 * @module tools/shell-tool
 */

const { spawn } = require('child_process');
const { toolRegistry } = require('./tool-registry');
const { logger } = require('../utils/logger');

/** 默认命令执行超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * 执行 Shell 命令
 * @param {string} command - 命令
 * @param {Object} [options]
 * @param {string} [options.cwd] - 工作目录
 * @param {number} [options.maxOutput] - 最大输出长度
 * @param {number} [options.timeout] - 超时时间（毫秒），默认 30 秒
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, timedOut?: boolean }>}
 */
async function executeShellCommand(command, options = {}) {
  const { cwd, maxOutput = 100000, timeout = DEFAULT_TIMEOUT_MS } = options;

  return new Promise((resolve) => {
    // 使用 shell 执行命令
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

    const child = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // Unix 创建进程组，方便超时时杀掉整个进程树
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let killed = false;

    // 超时保护：防止长驻进程（如 npm run dev）卡死
    const timer = setTimeout(() => {
      killed = true;
      try {
        // 杀掉进程组（确保子进程也被杀掉）
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
      }
      logger.warn(`Shell 命令超时 (${timeout}ms)，已强制终止`, { command });
    }, timeout);

    child.stdout.on('data', (data) => {
      if (!stdoutTruncated) {
        stdout += data.toString();
        if (stdout.length > maxOutput) {
          stdout = stdout.slice(0, maxOutput);
          stdoutTruncated = true;
        }
      }
    });

    child.stderr.on('data', (data) => {
      if (!stderrTruncated) {
        stderr += data.toString();
        if (stderr.length > maxOutput) {
          stderr = stderr.slice(0, maxOutput);
          stderrTruncated = true;
        }
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: `执行错误: ${error.message}`,
        exitCode: 1,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const result = {
        stdout: stdoutTruncated ? stdout + '\n...(输出已截断)' : stdout,
        stderr: stderrTruncated ? stderr + '\n...(输出已截断)' : stderr,
        exitCode: killed ? 124 : (code ?? 0),
        timedOut: killed,
      };

      if (killed) {
        result.stderr = (result.stderr ? result.stderr + '\n' : '') +
          `命令执行超时（${timeout / 1000}秒）已被终止。注意：不要执行长驻进程（如 npm run dev、npm start 等服务器命令）。如需运行项目，请使用构建命令（如 npm run build）或一次性检查命令。`;
      }

      logger.debug('Shell 命令执行完成', { command, exitCode: code, timedOut: killed });
      resolve(result);
    });
  });
}

/**
 * Shell 工具定义
 */
const shellTool = {
  name: 'shell',
  description: '执行终端命令（30秒超时）。支持 bash/cmd。危险命令已被自动禁止。注意：不要执行长驻进程（npm run dev、npm start 等），它们会超时被杀。如需验证代码，使用 npm run build 或检查语法。',
  category: 'shell',
  parameters: {
    command: {
      type: 'string',
      description: '要执行的命令',
      required: true,
    },
    cwd: {
      type: 'string',
      description: '工作目录（绝对路径）',
      required: false,
    },
  },
  requiredPermissions: ['shell.enabled'],

  async execute(args) {
    const { command, cwd } = args;

    if (!command || typeof command !== 'string') {
      throw new Error('请提供有效的命令');
    }

    const startTime = Date.now();
    const result = await executeShellCommand(command, { cwd });
    const duration = Date.now() - startTime;

    return {
      command,
      cwd: cwd || process.cwd(),
      exitCode: result.exitCode,
      success: result.exitCode === 0,
      duration: `${duration}ms`,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
};

/**
 * 注册 Shell 工具
 */
function registerShellTool() {
  toolRegistry.register(shellTool);
}

module.exports = {
  shellTool,
  registerShellTool,
  executeShellCommand,
};
