/**
 * SoloForge - Shell 命令执行工具
 * 支持短期命令执行和长期进程后台运行
 * @module tools/shell-tool
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { toolRegistry } = require('./tool-registry');
const { logger } = require('../utils/logger');

/** 默认阻塞等待时间（毫秒） */
const DEFAULT_BLOCK_UNTIL_MS = 30000;

/** 最大输出长度 */
const MAX_OUTPUT_LENGTH = 100000;

/** 后台进程存储目录 */
const BACKGROUND_PROCESSES_DIR = path.join(os.tmpdir(), 'soloforge-shell-processes');

// 确保目录存在
if (!fs.existsSync(BACKGROUND_PROCESSES_DIR)) {
  fs.mkdirSync(BACKGROUND_PROCESSES_DIR, { recursive: true });
}

/** 活跃的后台进程 Map<processId, { pid, outputFile, startTime }> */
const backgroundProcesses = new Map();

/**
 * 生成进程输出文件路径
 * @param {string} processId
 * @returns {string}
 */
function getOutputFilePath(processId) {
  return path.join(BACKGROUND_PROCESSES_DIR, `${processId}.txt`);
}

/**
 * 写入进程输出文件头部
 * @param {string} outputFile
 * @param {Object} metadata
 */
function writeOutputHeader(outputFile, metadata) {
  const header = `---
pid: ${metadata.pid}
command: ${metadata.command}
cwd: ${metadata.cwd}
started_at: ${metadata.startedAt}
status: running
---

`;
  fs.writeFileSync(outputFile, header);
}

/**
 * 更新进程输出文件尾部（进程结束时）
 * @param {string} outputFile
 * @param {Object} result
 */
function appendOutputFooter(outputFile, result) {
  const footer = `
---
exit_code: ${result.exitCode}
elapsed_ms: ${result.elapsedMs}
ended_at: ${new Date().toISOString()}
---
`;
  fs.appendFileSync(outputFile, footer);
}

/**
 * 执行 Shell 命令
 * @param {string} command - 命令
 * @param {Object} [options]
 * @param {string} [options.cwd] - 工作目录
 * @param {number} [options.blockUntilMs] - 阻塞等待时间（0 = 立即后台运行）
 * @param {string} [options.description] - 命令描述
 * @returns {Promise<Object>}
 */
async function executeShellCommand(command, options = {}) {
  const { 
    cwd = process.cwd(), 
    blockUntilMs = DEFAULT_BLOCK_UNTIL_MS,
    description = ''
  } = options;

  const processId = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputFile = getOutputFilePath(processId);
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  // 使用 shell 执行命令
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

  const child = spawn(shell, shellArgs, {
    cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // 允许进程独立运行
  });

  const pid = child.pid;

  // 写入输出文件头部
  writeOutputHeader(outputFile, {
    pid,
    command,
    cwd,
    startedAt,
  });

  // 注册后台进程
  backgroundProcesses.set(processId, {
    pid,
    outputFile,
    startTime,
    command,
    description,
  });

  let stdout = '';
  let stderr = '';
  let finished = false;
  let exitCode = null;

  // 将输出写入文件
  child.stdout.on('data', (data) => {
    const text = data.toString();
    stdout += text;
    fs.appendFileSync(outputFile, text);
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    fs.appendFileSync(outputFile, text);
  });

  child.on('error', (error) => {
    finished = true;
    exitCode = 1;
    const errorMsg = `\n[ERROR] ${error.message}\n`;
    fs.appendFileSync(outputFile, errorMsg);
    appendOutputFooter(outputFile, {
      exitCode: 1,
      elapsedMs: Date.now() - startTime,
    });
    backgroundProcesses.delete(processId);
  });

  child.on('close', (code) => {
    finished = true;
    exitCode = code ?? 0;
    appendOutputFooter(outputFile, {
      exitCode,
      elapsedMs: Date.now() - startTime,
    });
    backgroundProcesses.delete(processId);
    logger.debug('Shell 进程结束', { processId, pid, exitCode, elapsed: Date.now() - startTime });
  });

  // 如果 blockUntilMs = 0，立即返回（后台运行模式）
  if (blockUntilMs === 0) {
    // 让子进程独立运行，不随父进程退出
    child.unref();
    
    logger.info('Shell 命令后台启动', { processId, pid, command: command.slice(0, 100) });
    
    return {
      mode: 'background',
      processId,
      pid,
      outputFile,
      command,
      cwd,
      message: `命令已在后台启动。\n` +
        `进程 ID: ${processId}\n` +
        `PID: ${pid}\n` +
        `输出文件: ${outputFile}\n\n` +
        `使用 shell_read_output 工具读取输出，shell_process_status 检查状态，shell_kill_process 终止进程。`,
    };
  }

  // 阻塞模式：等待进程完成或超时
  return new Promise((resolve) => {
    const checkInterval = 100; // 每 100ms 检查一次
    let elapsed = 0;

    const check = () => {
      elapsed += checkInterval;

      if (finished) {
        // 进程已完成
        const duration = Date.now() - startTime;
        resolve({
          mode: 'completed',
          processId,
          pid,
          outputFile,
          command,
          cwd,
          exitCode,
          success: exitCode === 0,
          duration: `${duration}ms`,
          stdout: stdout.length > MAX_OUTPUT_LENGTH 
            ? stdout.slice(0, MAX_OUTPUT_LENGTH) + '\n...(输出已截断)' 
            : stdout,
          stderr: stderr.length > MAX_OUTPUT_LENGTH 
            ? stderr.slice(0, MAX_OUTPUT_LENGTH) + '\n...(输出已截断)' 
            : stderr,
        });
        return;
      }

      if (elapsed >= blockUntilMs) {
        // 超时，转为后台运行
        child.unref();
        
        logger.info('Shell 命令超时转后台', { processId, pid, elapsed: blockUntilMs });
        
        resolve({
          mode: 'background',
          processId,
          pid,
          outputFile,
          command,
          cwd,
          message: `命令执行超过 ${blockUntilMs}ms，已转为后台运行。\n` +
            `进程 ID: ${processId}\n` +
            `PID: ${pid}\n` +
            `输出文件: ${outputFile}\n\n` +
            `当前输出预览:\n${stdout.slice(-2000) || '(暂无输出)'}\n\n` +
            `使用 shell_read_output 工具读取完整输出，shell_process_status 检查状态。`,
          partialStdout: stdout.slice(-5000),
          partialStderr: stderr.slice(-2000),
        });
        return;
      }

      setTimeout(check, checkInterval);
    };

    setTimeout(check, checkInterval);
  });
}

/**
 * 读取后台进程输出
 * @param {string} processId - 进程 ID
 * @param {Object} [options]
 * @param {number} [options.tailLines] - 只读取最后 N 行
 * @param {number} [options.offset] - 从指定字节开始读取
 * @returns {Object}
 */
function readProcessOutput(processId, options = {}) {
  const { tailLines, offset = 0 } = options;
  const outputFile = getOutputFilePath(processId);

  if (!fs.existsSync(outputFile)) {
    return { error: `进程输出文件不存在: ${processId}` };
  }

  const content = fs.readFileSync(outputFile, 'utf-8');
  
  if (tailLines && tailLines > 0) {
    const lines = content.split('\n');
    const tail = lines.slice(-tailLines).join('\n');
    return {
      processId,
      outputFile,
      totalLength: content.length,
      content: tail,
      truncated: lines.length > tailLines,
    };
  }

  if (offset > 0) {
    return {
      processId,
      outputFile,
      totalLength: content.length,
      content: content.slice(offset),
      offset,
    };
  }

  // 如果内容太长，截断
  if (content.length > MAX_OUTPUT_LENGTH) {
    return {
      processId,
      outputFile,
      totalLength: content.length,
      content: content.slice(0, MAX_OUTPUT_LENGTH) + '\n...(输出已截断，使用 tailLines 或 offset 参数读取更多)',
      truncated: true,
    };
  }

  return {
    processId,
    outputFile,
    totalLength: content.length,
    content,
  };
}

/**
 * 检查进程状态
 * @param {string} processId - 进程 ID
 * @returns {Object}
 */
function getProcessStatus(processId) {
  const outputFile = getOutputFilePath(processId);
  
  if (!fs.existsSync(outputFile)) {
    return { processId, status: 'not_found', error: '进程不存在或输出文件已删除' };
  }

  const content = fs.readFileSync(outputFile, 'utf-8');
  
  // 检查是否有结束标记
  const footerMatch = content.match(/---\nexit_code: (\d+)\nelapsed_ms: (\d+)\nended_at: (.+)\n---/);
  
  if (footerMatch) {
    return {
      processId,
      status: 'completed',
      exitCode: parseInt(footerMatch[1], 10),
      elapsedMs: parseInt(footerMatch[2], 10),
      endedAt: footerMatch[3],
      outputFile,
    };
  }

  // 解析头部获取 PID
  const headerMatch = content.match(/pid: (\d+)/);
  const pid = headerMatch ? parseInt(headerMatch[1], 10) : null;

  // 检查进程是否还在运行
  let isRunning = false;
  if (pid) {
    try {
      process.kill(pid, 0); // 发送信号 0 检查进程是否存在
      isRunning = true;
    } catch {
      isRunning = false;
    }
  }

  const startMatch = content.match(/started_at: (.+)/);
  const startedAt = startMatch ? startMatch[1] : null;
  const runningFor = startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : null;

  return {
    processId,
    pid,
    status: isRunning ? 'running' : 'unknown',
    runningForSeconds: runningFor,
    outputFile,
  };
}

/**
 * 终止后台进程
 * @param {string} processId - 进程 ID
 * @param {string} [signal='SIGTERM'] - 信号
 * @returns {Object}
 */
function killProcess(processId, signal = 'SIGTERM') {
  const status = getProcessStatus(processId);
  
  if (status.status === 'not_found') {
    return { success: false, error: '进程不存在' };
  }
  
  if (status.status === 'completed') {
    return { success: false, error: '进程已结束', exitCode: status.exitCode };
  }

  if (!status.pid) {
    return { success: false, error: '无法获取进程 PID' };
  }

  try {
    process.kill(status.pid, signal);
    logger.info('Shell 进程已终止', { processId, pid: status.pid, signal });
    return { success: true, message: `进程 ${status.pid} 已发送 ${signal} 信号` };
  } catch (error) {
    return { success: false, error: `终止进程失败: ${error.message}` };
  }
}

/**
 * 列出所有后台进程
 * @returns {Array}
 */
function listBackgroundProcesses() {
  const processes = [];
  
  try {
    const files = fs.readdirSync(BACKGROUND_PROCESSES_DIR);
    for (const file of files) {
      if (file.endsWith('.txt')) {
        const processId = file.replace('.txt', '');
        const status = getProcessStatus(processId);
        processes.push(status);
      }
    }
  } catch (error) {
    logger.error('列出后台进程失败', { error: error.message });
  }

  return processes;
}

// ═══════════════════════════════════════════════════════════════
// 工具定义
// ═══════════════════════════════════════════════════════════════

/**
 * Shell 工具定义（支持后台运行）
 */
const shellTool = {
  name: 'shell',
  description: `执行终端命令。支持两种模式：
1. 阻塞模式（默认）：等待命令完成，最多等待 block_until_ms 毫秒
2. 后台模式：设置 block_until_ms=0 立即返回，命令在后台运行

对于长期运行的服务（如 npm run dev、python server.py），使用 block_until_ms=0 后台运行，
然后用 shell_read_output 读取输出、shell_process_status 检查状态。`,
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
    block_until_ms: {
      type: 'number',
      description: '阻塞等待时间（毫秒）。0 = 立即后台运行，默认 30000（30秒）',
      required: false,
    },
    description: {
      type: 'string',
      description: '命令描述（用于后续追踪）',
      required: false,
    },
  },
  requiredPermissions: ['shell.enabled'],

  async execute(args) {
    const { command, cwd, block_until_ms, description } = args;

    if (!command || typeof command !== 'string') {
      throw new Error('请提供有效的命令');
    }

    return await executeShellCommand(command, {
      cwd,
      blockUntilMs: block_until_ms ?? DEFAULT_BLOCK_UNTIL_MS,
      description,
    });
  },
};

/**
 * 读取进程输出工具
 */
const shellReadOutputTool = {
  name: 'shell_read_output',
  description: '读取后台进程的输出内容。用于监控长期运行的命令。',
  category: 'shell',
  parameters: {
    process_id: {
      type: 'string',
      description: '进程 ID（由 shell 命令返回）',
      required: true,
    },
    tail_lines: {
      type: 'number',
      description: '只读取最后 N 行',
      required: false,
    },
    offset: {
      type: 'number',
      description: '从指定字节位置开始读取',
      required: false,
    },
  },
  requiredPermissions: ['shell.enabled'],

  async execute(args) {
    const { process_id, tail_lines, offset } = args;
    
    if (!process_id) {
      throw new Error('请提供进程 ID');
    }

    return readProcessOutput(process_id, { tailLines: tail_lines, offset });
  },
};

/**
 * 进程状态工具
 */
const shellProcessStatusTool = {
  name: 'shell_process_status',
  description: '检查后台进程的运行状态（运行中/已完成/已终止）。',
  category: 'shell',
  parameters: {
    process_id: {
      type: 'string',
      description: '进程 ID（由 shell 命令返回）',
      required: true,
    },
  },
  requiredPermissions: ['shell.enabled'],

  async execute(args) {
    const { process_id } = args;
    
    if (!process_id) {
      throw new Error('请提供进程 ID');
    }

    return getProcessStatus(process_id);
  },
};

/**
 * 终止进程工具
 */
const shellKillProcessTool = {
  name: 'shell_kill_process',
  description: '终止后台运行的进程。',
  category: 'shell',
  parameters: {
    process_id: {
      type: 'string',
      description: '进程 ID（由 shell 命令返回）',
      required: true,
    },
    signal: {
      type: 'string',
      description: '终止信号，默认 SIGTERM。可选 SIGKILL（强制终止）',
      required: false,
    },
  },
  requiredPermissions: ['shell.enabled'],

  async execute(args) {
    const { process_id, signal } = args;
    
    if (!process_id) {
      throw new Error('请提供进程 ID');
    }

    return killProcess(process_id, signal || 'SIGTERM');
  },
};

/**
 * 列出后台进程工具
 */
const shellListProcessesTool = {
  name: 'shell_list_processes',
  description: '列出所有后台运行的进程及其状态。',
  category: 'shell',
  parameters: {},
  requiredPermissions: ['shell.enabled'],

  async execute() {
    const processes = listBackgroundProcesses();
    return {
      count: processes.length,
      processes,
    };
  },
};

/**
 * 注册 Shell 工具
 */
function registerShellTool() {
  toolRegistry.register(shellTool);
  toolRegistry.register(shellReadOutputTool);
  toolRegistry.register(shellProcessStatusTool);
  toolRegistry.register(shellKillProcessTool);
  toolRegistry.register(shellListProcessesTool);
  
  logger.info('Shell 工具已注册（支持后台进程）');
}

module.exports = {
  shellTool,
  shellReadOutputTool,
  shellProcessStatusTool,
  shellKillProcessTool,
  shellListProcessesTool,
  registerShellTool,
  executeShellCommand,
  readProcessOutput,
  getProcessStatus,
  killProcess,
  listBackgroundProcesses,
};
