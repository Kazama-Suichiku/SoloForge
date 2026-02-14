/**
 * SoloForge - 文件操作工具
 * 提供文件读取和目录列表功能
 * @module tools/file-tool
 */

const fs = require('fs').promises;
const path = require('path');
const { toolRegistry } = require('./tool-registry');

/**
 * 读取文件内容
 */
const readFileTool = {
  name: 'read_file',
  description: '读取文件内容。可指定行号范围只读取部分内容。',
  category: 'file',
  parameters: {
    path: {
      type: 'string',
      description: '文件的绝对路径',
      required: true,
    },
    start_line: {
      type: 'number',
      description: '起始行号（从 1 开始），不指定则从开头读取',
      required: false,
    },
    end_line: {
      type: 'number',
      description: '结束行号（包含），不指定则读到末尾',
      required: false,
    },
  },
  requiredPermissions: ['files.allowedPaths'],

  async execute(args) {
    const filePath = args.path;
    const startLine = args.start_line ?? 1;
    const endLine = args.end_line ?? Infinity;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // 处理行号范围
      const selectedLines = lines.slice(
        Math.max(0, startLine - 1),
        endLine === Infinity ? undefined : endLine
      );

      // 添加行号
      const numberedLines = selectedLines.map((line, i) => {
        const lineNum = String(startLine + i).padStart(4, ' ');
        return `${lineNum}| ${line}`;
      });

      return {
        path: filePath,
        totalLines: lines.length,
        startLine,
        endLine: Math.min(endLine, lines.length),
        content: numberedLines.join('\n'),
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`文件不存在: ${filePath}`);
      }
      if (error.code === 'EISDIR') {
        throw new Error(`路径是目录而非文件: ${filePath}`);
      }
      throw error;
    }
  },
};

/**
 * 列出目录内容
 */
const listFilesTool = {
  name: 'list_files',
  description: '列出目录中的文件和子目录。',
  category: 'file',
  parameters: {
    path: {
      type: 'string',
      description: '目录的绝对路径',
      required: true,
    },
    recursive: {
      type: 'boolean',
      description: '是否递归列出子目录（默认 false，最多 3 层）',
      required: false,
      default: false,
    },
    pattern: {
      type: 'string',
      description: '文件名匹配模式（简单通配符，如 *.js）',
      required: false,
    },
  },
  requiredPermissions: ['files.allowedPaths'],

  async execute(args, context, depth = 0) {
    const dirPath = args.path;
    const recursive = args.recursive ?? false;
    const pattern = args.pattern;
    const maxDepth = 3;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const results = [];

      for (const entry of entries) {
        // 跳过隐藏文件和 node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const isDir = entry.isDirectory();

        // 模式匹配
        if (pattern && !isDir) {
          const regex = new RegExp(
            '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
          );
          if (!regex.test(entry.name)) {
            continue;
          }
        }

        const item = {
          name: entry.name,
          path: fullPath,
          type: isDir ? 'directory' : 'file',
        };

        if (!isDir) {
          try {
            const stat = await fs.stat(fullPath);
            item.size = stat.size;
            item.modified = stat.mtime.toISOString();
          } catch {
            // 忽略无法获取 stat 的文件
          }
        }

        results.push(item);

        // 递归子目录
        if (isDir && recursive && depth < maxDepth) {
          try {
            const subResults = await this.execute(
              { path: fullPath, recursive: true, pattern },
              context,
              depth + 1
            );
            item.children = subResults.entries;
          } catch {
            item.children = [];
          }
        }
      }

      // 排序：目录在前，然后按名称
      results.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return {
        path: dirPath,
        count: results.length,
        entries: results,
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`目录不存在: ${dirPath}`);
      }
      if (error.code === 'ENOTDIR') {
        throw new Error(`路径不是目录: ${dirPath}`);
      }
      throw error;
    }
  },
};

/**
 * 写入文件内容
 */
const writeFileTool = {
  name: 'write_file',
  description: '写入内容到文件。如果文件存在会覆盖，不存在则创建。需要用户确认。',
  category: 'file',
  parameters: {
    path: {
      type: 'string',
      description: '文件的绝对路径',
      required: true,
    },
    content: {
      type: 'string',
      description: '要写入的内容',
      required: true,
    },
    append: {
      type: 'boolean',
      description: '是否追加模式（默认覆盖）',
      required: false,
      default: false,
    },
  },
  requiredPermissions: ['files.allowedPaths', 'files.writeEnabled'],

  async execute(args) {
    const filePath = args.path;
    const content = args.content;
    const append = args.append ?? false;

    // 确保父目录存在
    const dir = path.dirname(filePath);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }

    // 获取原文件信息（如果存在）
    let existed = false;
    let originalSize = 0;
    try {
      const stat = await fs.stat(filePath);
      existed = true;
      originalSize = stat.size;
    } catch {
      // 文件不存在
    }

    // 写入文件
    if (append) {
      await fs.appendFile(filePath, content, 'utf-8');
    } else {
      await fs.writeFile(filePath, content, 'utf-8');
    }

    // 获取新文件信息
    const newStat = await fs.stat(filePath);

    return {
      path: filePath,
      action: existed ? (append ? 'appended' : 'overwritten') : 'created',
      originalSize: existed ? originalSize : null,
      newSize: newStat.size,
      contentLength: content.length,
    };
  },
};

/**
 * 注册文件工具
 */
function registerFileTools() {
  toolRegistry.register(readFileTool);
  toolRegistry.register(listFilesTool);
  toolRegistry.register(writeFileTool);
}

module.exports = {
  readFileTool,
  listFilesTool,
  writeFileTool,
  registerFileTools,
};
