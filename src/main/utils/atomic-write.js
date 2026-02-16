/**
 * SoloForge - 原子写入工具
 * 防止写入过程中崩溃导致文件损坏
 * @module utils/atomic-write
 */

const fs = require('fs');
const path = require('path');

/**
 * 原子写入文件（同步版本）
 * 先写入临时文件，然后重命名，确保文件内容完整性
 * @param {string} filePath - 目标文件路径
 * @param {string} content - 文件内容
 */
function atomicWriteSync(filePath, content) {
  const tempPath = filePath + '.tmp';
  const dir = path.dirname(filePath);

  // 确保目录存在
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 先写入临时文件
  fs.writeFileSync(tempPath, content, 'utf-8');

  // 然后原子重命名（在 POSIX 系统上是原子操作）
  fs.renameSync(tempPath, filePath);
}

/**
 * 原子写入文件（异步版本）
 * @param {string} filePath - 目标文件路径
 * @param {string} content - 文件内容
 * @returns {Promise<void>}
 */
async function atomicWrite(filePath, content) {
  const tempPath = filePath + '.tmp';
  const dir = path.dirname(filePath);

  // 确保目录存在
  await fs.promises.mkdir(dir, { recursive: true });

  // 先写入临时文件
  await fs.promises.writeFile(tempPath, content, 'utf-8');

  // 然后原子重命名
  await fs.promises.rename(tempPath, filePath);
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

module.exports = {
  atomicWriteSync,
  atomicWrite,
  atomicWriteJsonSync,
  atomicWriteJson,
};
