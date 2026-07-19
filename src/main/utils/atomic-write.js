/**
 * SoloForge - 原子写入工具
 * 防止写入过程中崩溃导致文件损坏
 * 并发安全：每次写入使用唯一临时文件，避免并发写入同一 .tmp 导致内容交错
 * @module utils/atomic-write
 */

const fs = require('fs');
const path = require('path');

/**
 * 生成唯一的临时文件路径
 * 格式：${filePath}.${pid}.${timestamp}.${random}.tmp
 * @param {string} filePath - 目标文件路径
 * @returns {string} 唯一临时文件路径
 */
function generateTempPath(filePath) {
  return `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.tmp`;
}

/**
 * 安全重命名（异步），Windows 兼容
 * POSIX 系统上 rename 是原子操作；Windows 上跨卷或被占用时会抛 EPERM/EXDEV，
 * 此时回退为 copyFile + unlink（非原子，但保证最终一致性）
 * @param {string} tempPath - 临时文件路径
 * @param {string} filePath - 目标文件路径
 * @returns {Promise<void>}
 */
async function safeRename(tempPath, filePath) {
  try {
    await fs.promises.rename(tempPath, filePath);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EXDEV') {
      // Windows 跨盘 / 权限问题，回退为 copy + unlink
      await fs.promises.copyFile(tempPath, filePath);
      try {
        await fs.promises.unlink(tempPath);
      } catch (_unlinkErr) {
        // 临时文件可能已被删除，忽略
      }
    } else {
      throw err;
    }
  }
}

/**
 * 安全重命名（同步），Windows 兼容
 * @param {string} tempPath - 临时文件路径
 * @param {string} filePath - 目标文件路径
 */
function safeRenameSync(tempPath, filePath) {
  try {
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EXDEV') {
      fs.copyFileSync(tempPath, filePath);
      try {
        fs.unlinkSync(tempPath);
      } catch (_unlinkErr) {
        // 忽略
      }
    } else {
      throw err;
    }
  }
}

/**
 * 原子写入文件（同步版本）
 * 先写入唯一临时文件，然后重命名，确保文件内容完整性
 * 注意：同步版本不会并发，但保持与异步版本一致的临时文件命名
 * @param {string} filePath - 目标文件路径
 * @param {string} content - 文件内容
 */
function atomicWriteSync(filePath, content) {
  const tempPath = generateTempPath(filePath);
  const dir = path.dirname(filePath);

  // 确保目录存在
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 先写入唯一临时文件
  fs.writeFileSync(tempPath, content, 'utf-8');

  // 然后原子重命名（带 Windows 兼容回退）
  safeRenameSync(tempPath, filePath);
}

/**
 * 原子写入文件（异步版本）
 * 并发安全：每次调用使用唯一临时文件，避免并发写入同一 .tmp 导致内容交错损坏
 * @param {string} filePath - 目标文件路径
 * @param {string} content - 文件内容
 * @returns {Promise<void>}
 */
async function atomicWrite(filePath, content) {
  const tempPath = generateTempPath(filePath);
  const dir = path.dirname(filePath);

  // 确保目录存在
  await fs.promises.mkdir(dir, { recursive: true });

  // 先写入唯一临时文件
  await fs.promises.writeFile(tempPath, content, 'utf-8');

  // 然后原子重命名（带 Windows 兼容回退）
  await safeRename(tempPath, filePath);
}

/**
 * 原子写入 JSON 文件（同步版本）
 * @param {string} filePath - 目标文件路径
 * @param {any} data - 要写入的数据
 * @param {number} [indent=2] - JSON 缩进空格数
 */
function atomicWriteJsonSync(filePath, data, indent = 2) {
  const content = JSON.stringify(data, null, indent);
  atomicWriteSync(filePath, content);
}

/**
 * 原子写入 JSON 文件（异步版本）
 * @param {string} filePath - 目标文件路径
 * @param {any} data - 要写入的数据
 * @param {number} [indent=2] - JSON 缩进空格数
 * @returns {Promise<void>}
 */
async function atomicWriteJson(filePath, data, indent = 2) {
  const content = JSON.stringify(data, null, indent);
  await atomicWrite(filePath, content);
}

/**
 * 清理指定目录下的孤儿 .tmp 临时文件
 * 建议在应用启动时调用，扫描数据/配置目录并删除上次崩溃遗留的 .tmp 文件
 * @param {string} dir - 要扫描的目录
 * @param {Object} [options]
 * @param {number} [options.maxAgeMs=0] - 仅删除早于该时间（毫秒）的文件；0 表示全部删除
 * @returns {Promise<string[]>} 已删除的文件路径列表
 */
async function cleanupOrphanedTempFiles(dir, options = {}) {
  const { maxAgeMs = 0, recursive = false } = options;
  const deleted = [];
  const now = Date.now();

  async function scanDir(currentDir) {
    let entries;
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (_err) {
      return; // 目录不存在或无权限，忽略
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) await scanDir(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.tmp')) continue;
      try {
        if (maxAgeMs > 0) {
          const stat = await fs.promises.stat(fullPath);
          if (now - stat.mtimeMs < maxAgeMs) continue; // 文件太新，可能正在写入
        }
        await fs.promises.unlink(fullPath);
        deleted.push(fullPath);
      } catch (_err) {
        // 单个文件删除失败不影响其他文件
      }
    }
  }

  await scanDir(dir);
  return deleted;
}

module.exports = {
  atomicWriteSync,
  atomicWrite,
  atomicWriteJsonSync,
  atomicWriteJson,
  cleanupOrphanedTempFiles,
  generateTempPath,
};
