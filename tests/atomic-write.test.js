/**
 * tests/atomic-write.test.js
 *
 * 测试 src/main/utils/atomic-write.js 的核心契约：
 *  - 并发写入：50 次 atomicWrite 同一文件，最终内容正确不损坏
 *  - 崩溃恢复：写 .tmp 中途模拟崩溃（删 .tmp），目标文件不损坏
 *  - 孤儿清理：cleanupOrphanedTempFiles 清理旧 .tmp，保留新文件
 *  - Windows 回退：模拟 rename 失败（EPERM/EXDEV），验证 copyFile+unlink 回退
 *
 * atomic-write 是纯 fs 模块，无 electron 依赖，不需要 mock-electron。
 * 但为了与其它测试保持一致，仍然引入 setup（统一 console 抑制）。
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

require('./setup');

const {
  atomicWrite,
  atomicWriteSync,
  atomicWriteJson,
  atomicWriteJsonSync,
  cleanupOrphanedTempFiles,
  generateTempPath,
} = require('../src/main/utils/atomic-write');

/**
 * 用 fs.mkdtempSync 创建临时目录，返回 { dir, cleanup }。
 */
function tmpdir(prefix = 'aw-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} } };
}

// ───────────────────────────────────────────────────────────────
// 1. 并发写入：50 次并发 atomicWrite 同一文件
// ───────────────────────────────────────────────────────────────

test('atomicWrite: 50 次并发写入同一文件，最终内容不损坏', async () => {
  const { dir, cleanup } = tmpdir();
  try {
    const target = path.join(dir, 'concurrent.txt');
    // 50 次并发写入不同的内容。由于每次都使用唯一 .tmp + rename，
    // 最终文件内容必然是某一次写入的完整内容，不应出现半截或交错。
    const contents = Array.from({ length: 50 }, (_, i) => `line-${i}-${'x'.repeat(100)}`);
    await Promise.all(contents.map((c) => atomicWrite(target, c)));

    const final = fs.readFileSync(target, 'utf-8');
    // 最终内容必须是 50 次写入中的某一次的完整内容
    const matched = contents.some((c) => c === final);
    assert.ok(matched, `最终内容不是任何一次写入的完整内容（长度=${final.length}）`);
    // 没有半截写入：长度必须等于某次写入的长度
    assert.ok(contents.some((c) => c.length === final.length), '最终内容长度与所有候选都不符');
  } finally {
    cleanup();
  }
});

test('atomicWrite: 50 次并发写入同一文件后无遗留 .tmp', async () => {
  const { dir, cleanup } = tmpdir();
  try {
    const target = path.join(dir, 'no-tmp-left.txt');
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => atomicWrite(target, `content-${i}`))
    );
    const entries = fs.readdirSync(dir);
    const leftoverTmp = entries.filter((n) => n.endsWith('.tmp'));
    assert.equal(leftoverTmp.length, 0, `发现遗留 .tmp 文件: ${leftoverTmp.join(', ')}`);
  } finally {
    cleanup();
  }
});

// ───────────────────────────────────────────────────────────────
// 2. 崩溃恢复：写 .tmp 中途模拟崩溃
// ───────────────────────────────────────────────────────────────

test('atomicWrite 崩溃恢复：先写一份完整内容，再制造中途崩溃的 .tmp，原文件不损坏', async () => {
  const { dir, cleanup } = tmpdir();
  try {
    const target = path.join(dir, 'crash-recovery.txt');
    // 先写一份完整内容
    const good = '完整的原始内容';
    await atomicWrite(target, good);
    assert.equal(fs.readFileSync(target, 'utf-8'), good);

    // 模拟崩溃：手动写一个半截 .tmp 文件（就像 atomicWrite 在 rename 之前进程被杀）
    const tempPath = generateTempPath(target);
    fs.writeFileSync(tempPath, '半截内容未写完', 'utf-8');

    // 此时原文件应当还是完整的
    assert.equal(fs.readFileSync(target, 'utf-8'), good);

    // 再次 atomicWrite 应当成功（不依赖之前的 .tmp）
    const next = '新的完整内容';
    await atomicWrite(target, next);
    assert.equal(fs.readFileSync(target, 'utf-8'), next);

    // 旧的半截 .tmp 应当还在（atomicWrite 不会清理别人的 .tmp），
    // 但它不会影响目标文件的正确性 —— 这正是"原子"的含义
    assert.ok(fs.existsSync(tempPath), '旧 .tmp 仍在，但目标文件不受影响');
  } finally {
    cleanup();
  }
});

test('atomicWriteSync 崩溃恢复：同步写入中途留 .tmp，目标文件仍完整', () => {
  const { dir, cleanup } = tmpdir();
  try {
    const target = path.join(dir, 'sync-crash.txt');
    atomicWriteSync(target, '同步完整内容 A');
    assert.equal(fs.readFileSync(target, 'utf-8'), '同步完整内容 A');

    const tempPath = generateTempPath(target);
    fs.writeFileSync(tempPath, '半截', 'utf-8');

    atomicWriteSync(target, '同步完整内容 B');
    assert.equal(fs.readFileSync(target, 'utf-8'), '同步完整内容 B');
  } finally {
    cleanup();
  }
});

// ───────────────────────────────────────────────────────────────
// 3. 孤儿清理：cleanupOrphanedTempFiles
// ───────────────────────────────────────────────────────────────

test('cleanupOrphanedTempFiles: 清理所有 .tmp 文件，保留普通文件', async () => {
  const { dir, cleanup } = tmpdir();
  try {
    // 准备：1 个普通文件 + 3 个 .tmp 文件
    fs.writeFileSync(path.join(dir, 'data.json'), '{"ok":true}');
    fs.writeFileSync(path.join(dir, 'a.tmp'), 'a');
    fs.writeFileSync(path.join(dir, 'b.tmp'), 'b');
    fs.writeFileSync(path.join(dir, 'c.tmp'), 'c');
    // 子目录里也有一个 .tmp，默认非递归不应清理
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'd.tmp'), 'd');

    const deleted = await cleanupOrphanedTempFiles(dir);
    assert.equal(deleted.length, 3, `应删除 3 个 .tmp，实际 ${deleted.length}`);

    // 普通文件保留
    assert.ok(fs.existsSync(path.join(dir, 'data.json')), '普通文件应保留');
    // 子目录里的 .tmp 在非递归模式下应保留
    assert.ok(fs.existsSync(path.join(dir, 'sub', 'd.tmp')), '子目录 .tmp 在非递归模式下应保留');
  } finally {
    cleanup();
  }
});

test('cleanupOrphanedTempFiles: recursive=true 清理子目录 .tmp', async () => {
  const { dir, cleanup } = tmpdir();
  try {
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.tmp'), 'a');
    fs.writeFileSync(path.join(dir, 'sub', 'b.tmp'), 'b');
    fs.writeFileSync(path.join(dir, 'sub', 'c.tmp'), 'c');

    const deleted = await cleanupOrphanedTempFiles(dir, { recursive: true });
    assert.equal(deleted.length, 3, `递归应删除 3 个 .tmp，实际 ${deleted.length}`);
  } finally {
    cleanup();
  }
});

test('cleanupOrphanedTempFiles: maxAgeMs 过滤保留新文件', async () => {
  const { dir, cleanup } = tmpdir();
  try {
    // 旧文件（mtime 已设为 1 小时前）
    const oldTmp = path.join(dir, 'old.tmp');
    fs.writeFileSync(oldTmp, 'old');
    const oneHourAgo = Date.now() / 1000 - 3600;
    fs.utimesSync(oldTmp, oneHourAgo, oneHourAgo);

    // 新文件（mtime=now）
    const newTmp = path.join(dir, 'new.tmp');
    fs.writeFileSync(newTmp, 'new');

    // maxAgeMs = 60_000：只删 1 分钟前的 .tmp
    const deleted = await cleanupOrphanedTempFiles(dir, { maxAgeMs: 60_000 });
    assert.deepEqual(deleted.map((p) => path.basename(p)).sort(), ['old.tmp']);
    assert.ok(!fs.existsSync(oldTmp), '旧 .tmp 应被删除');
    assert.ok(fs.existsSync(newTmp), '新 .tmp 应保留');
  } finally {
    cleanup();
  }
});

test('cleanupOrphanedTempFiles: 不存在的目录返回空数组', async () => {
  const deleted = await cleanupOrphanedTempFiles(path.join(os.tmpdir(), 'definitely-not-exist-' + Date.now()));
  assert.deepEqual(deleted, []);
});

// ───────────────────────────────────────────────────────────────
// 4. Windows 回退：模拟 rename 失败 → copyFile + unlink 回退
// ───────────────────────────────────────────────────────────────
//
// safeRename 的实现：rename 失败时，若 err.code 是 EPERM 或 EXDEV，
// 则回退为 copyFile + unlink。我们 monkey-patch fs.promises.rename
// 使其抛 EPERM，验证回退路径被触发，最终文件内容正确。

test('safeRename Windows 回退：rename 抛 EPERM 时回退为 copyFile+unlink', async () => {
  const { dir, cleanup } = tmpdir();
  try {
    const target = path.join(dir, 'win-fallback.txt');
    const realRename = fs.promises.rename;
    const realCopyFile = fs.promises.copyFile;
    let renameCalled = 0, copyFileCalled = 0;

    fs.promises.rename = async (from, to) => {
      renameCalled++;
      const err = new Error('EPERM: operation not permitted');
      err.code = 'EPERM';
      throw err;
    };
    fs.promises.copyFile = async (...args) => {
      copyFileCalled++;
      return realCopyFile(...args);
    };

    try {
      await atomicWrite(target, 'windows-fallback-content');
      // 验证：rename 被调用并抛 EPERM，触发 copyFile 回退
      assert.ok(renameCalled >= 1, 'rename 应被调用');
      assert.ok(copyFileCalled >= 1, 'copyFile 回退应被调用');
      // 最终目标文件内容正确
      assert.equal(fs.readFileSync(target, 'utf-8'), 'windows-fallback-content');
    } finally {
      fs.promises.rename = realRename;
      fs.promises.copyFile = realCopyFile;
    }
  } finally {
    cleanup();
  }
});

test('safeRenameSync Windows 回退：renameSync 抛 EXDEV 时回退为 copyFileSync+unlinkSync', () => {
  const { dir, cleanup } = tmpdir();
  try {
    const target = path.join(dir, 'sync-win-fallback.txt');
    const realRenameSync = fs.renameSync;
    const realCopyFileSync = fs.copyFileSync;
    let renameCalled = 0, copyFileCalled = 0;

    fs.renameSync = (..._args) => {
      renameCalled++;
      const err = new Error('EXDEV: cross-device link not permitted');
      err.code = 'EXDEV';
      throw err;
    };
    fs.copyFileSync = (...args) => {
      copyFileCalled++;
      return realCopyFileSync(...args);
    };

    try {
      atomicWriteSync(target, 'sync-windows-content');
      assert.ok(renameCalled >= 1, 'renameSync 应被调用');
      assert.ok(copyFileCalled >= 1, 'copyFileSync 回退应被调用');
      assert.equal(fs.readFileSync(target, 'utf-8'), 'sync-windows-content');
    } finally {
      fs.renameSync = realRenameSync;
      fs.copyFileSync = realCopyFileSync;
    }
  } finally {
    cleanup();
  }
});

test('safeRename 非 Windows 错误不应回退，应向上抛', async () => {
  const { dir, cleanup } = tmpdir();
  try {
    const target = path.join(dir, 'non-win-error.txt');
    const realRename = fs.promises.rename;

    fs.promises.rename = async () => {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    };

    try {
      await assert.rejects(
        () => atomicWrite(target, 'should-fail'),
        (err) => err.code === 'EACCES',
        '非 EPERM/EXDEV 错误应直接抛出，不回退'
      );
    } finally {
      fs.promises.rename = realRename;
    }
    // 目标文件不应被创建（rename 失败且未回退）
    assert.ok(!fs.existsSync(target), '目标文件不应存在');
  } finally {
    cleanup();
  }
});

// ───────────────────────────────────────────────────────────────
// 5. atomicWriteJson / atomicWriteJsonSync
// ───────────────────────────────────────────────────────────────

test('atomicWriteJson: 写入 JSON 对象，读取后内容一致', async () => {
  const { dir, cleanup } = tmpdir();
  try {
    const target = path.join(dir, 'data.json');
    const obj = { name: 'test', nested: { a: [1, 2, 3] }, n: 42 };
    await atomicWriteJson(target, obj);
    const read = JSON.parse(fs.readFileSync(target, 'utf-8'));
    assert.deepEqual(read, obj);
  } finally {
    cleanup();
  }
});

test('atomicWriteJsonSync: 同步写入 JSON，默认缩进 2 空格', () => {
  const { dir, cleanup } = tmpdir();
  try {
    const target = path.join(dir, 'sync.json');
    const obj = { a: 1, b: 'two' };
    atomicWriteJsonSync(target, obj);
    const content = fs.readFileSync(target, 'utf-8');
    // 缩进为 2 空格
    assert.ok(content.includes('  "a": 1'), '应使用 2 空格缩进');
    assert.deepEqual(JSON.parse(content), obj);
  } finally {
    cleanup();
  }
});

test('atomicWriteJsonSync: 自定义缩进 4 空格', () => {
  const { dir, cleanup } = tmpdir();
  try {
    const target = path.join(dir, 'sync4.json');
    const obj = { a: 1 };
    atomicWriteJsonSync(target, obj, 4);
    const content = fs.readFileSync(target, 'utf-8');
    assert.ok(content.includes('    "a": 1'), '应使用 4 空格缩进');
  } finally {
    cleanup();
  }
});

// ───────────────────────────────────────────────────────────────
// 6. generateTempPath 唯一性
// ───────────────────────────────────────────────────────────────

test('generateTempPath: 连续生成 100 个路径互不相同', () => {
  const target = '/tmp/soloforge-test-target.txt';
  const paths = new Set();
  for (let i = 0; i < 100; i++) {
    paths.add(generateTempPath(target));
  }
  assert.equal(paths.size, 100, '100 次生成的临时路径应全部唯一');
  // 所有路径都以 .tmp 结尾
  for (const p of paths) {
    assert.ok(p.endsWith('.tmp'), `路径 ${p} 应以 .tmp 结尾`);
    assert.ok(p.startsWith('/tmp/soloforge-test-target.txt.'), `路径 ${p} 应以目标路径开头`);
  }
});

// ───────────────────────────────────────────────────────────────
// 7. 目录不存在时自动创建
// ───────────────────────────────────────────────────────────────

test('atomicWrite: 目标目录不存在时自动创建', async () => {
  const { dir, cleanup } = tmpdir();
  try {
    const deep = path.join(dir, 'a', 'b', 'c', 'target.txt');
    await atomicWrite(deep, 'nested');
    assert.equal(fs.readFileSync(deep, 'utf-8'), 'nested');
  } finally {
    cleanup();
  }
});

test('atomicWriteSync: 目标目录不存在时自动创建', () => {
  const { dir, cleanup } = tmpdir();
  try {
    const deep = path.join(dir, 'x', 'y', 'z.txt');
    atomicWriteSync(deep, 'nested-sync');
    assert.equal(fs.readFileSync(deep, 'utf-8'), 'nested-sync');
  } finally {
    cleanup();
  }
});
