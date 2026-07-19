/**
 * SoloForge - 工具调用审计
 *
 * 记录每一次工具调用（谁、调用了什么、是否成功、耗时多少、traceId），
 * 写入 ~/.soloforge/logs/audit-{date}.jsonl（每行一个 JSON）。
 *
 * 设计要点：
 * - 独立模块，不耦合 tool-executor；tool-executor 自行 require 后调用即可
 * - 只记录关键信息：不存完整 args/result，只存工具名/agentId/成功与否/耗时/traceId
 *   - args 仅记录 key（不记 value），用于事后看调用模式，不泄露具体内容
 *   - result 仅记录 success / error 摘要（截断到 200 字符）
 * - 批处理 + 定时 flush，避免阻塞主进程（与 logger 同思路）
 * - 进程退出前同步 flush，避免丢日志
 *
 * 与 logger 的关系：审计记录与 logger 各自独立落盘，互不影响。
 * 串联排查时，traceId 同时出现在 logger 日志和审计 jsonl 里。
 *
 * @module utils/audit
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTraceId } = require('./trace');

// ---------------------------------------------------------------------------
// 目录与文件名
// ---------------------------------------------------------------------------

function getLogDir() {
  return path.join(os.homedir(), '.soloforge', 'logs');
}

function getTodayAuditFile() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(getLogDir(), `audit-${date}.jsonl`);
}

// ---------------------------------------------------------------------------
// 批处理 + 定时 flush
// ---------------------------------------------------------------------------

const BATCH_FLUSH_THRESHOLD = 50;
const BATCH_FLUSH_INTERVAL_MS = 1000;

const writeQueue = [];
let flushTimer = null;
let logDirEnsured = false;

function ensureLogDir() {
  if (logDirEnsured) return;
  try {
    fs.mkdirSync(getLogDir(), { recursive: true });
  } catch (err) {
    // 降级，避免日志目录创建失败拖垮工具执行
    // 不打 console.error 太多，避免在工具热路径上刷屏
  }
  logDirEnsured = true;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, BATCH_FLUSH_INTERVAL_MS);
  if (flushTimer && typeof flushTimer.unref === 'function') {
    flushTimer.unref();
  }
}

function flush() {
  flushTimer = null;
  if (writeQueue.length === 0) return;

  const file = getTodayAuditFile();
  const lines = writeQueue.splice(0, writeQueue.length);
  const payload = lines.map((l) => (l.endsWith('\n') ? l : l + '\n')).join('');

  fs.appendFile(file, payload, (err) => {
    if (err) {
      // 失败降级：丢失这批记录，不打断业务；只在 stderr 提示一次
      try {
        process.stderr.write(`[audit] 写入审计文件失败: ${err.message}\n`);
      } catch (_e) {
        // 忽略
      }
    }
  });
}

function flushSync() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (writeQueue.length === 0) return;
  try {
    const file = getTodayAuditFile();
    ensureLogDir();
    const lines = writeQueue.splice(0, writeQueue.length);
    const payload = lines.map((l) => (l.endsWith('\n') ? l : l + '\n')).join('');
    fs.appendFileSync(file, payload);
  } catch (_err) {
    // 忽略
  }
}

process.once('exit', flushSync);
process.once('SIGINT', () => {
  flushSync();
  process.exit(0);
});
process.once('SIGTERM', () => {
  flushSync();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// 工具调用审计
// ---------------------------------------------------------------------------

const ERROR_SUMMARY_MAX_LEN = 200;

/**
 * 提取 args 的 key 列表（不记录 value，避免泄露内容 / 撑爆日志）
 * @param {Object} args
 * @returns {string[]}
 */
function extractArgKeys(args) {
  if (!args || typeof args !== 'object') return [];
  try {
    return Object.keys(args);
  } catch (_e) {
    return [];
  }
}

/**
 * 提取 result 摘要：仅记 success / error（截断）
 * @param {any} result
 * @returns {{ ok: boolean, errorSnippet?: string, hasResult: boolean }}
 */
function summarizeResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: true, hasResult: Boolean(result) };
  }
  const ok = result.success !== false;
  let errorSnippet;
  if (result.error) {
    errorSnippet = String(result.error).slice(0, ERROR_SUMMARY_MAX_LEN);
  }
  return { ok, errorSnippet, hasResult: true };
}

/**
 * 记录一次工具调用
 *
 * @param {Object} entry
 * @param {string} entry.toolName - 工具名
 * @param {string} [entry.agentId] - 调用方 agent id（可空）
 * @param {string} [entry.agentName] - 调用方 agent 名称（可空）
 * @param {Object} [entry.args] - 工具参数（只记录 key，不记 value）
 * @param {any} [entry.result] - 工具返回值（只记 success / error 摘要）
 * @param {boolean} entry.success - 是否成功
 * @param {number} entry.durationMs - 耗时（毫秒）
 * @param {string} [entry.traceId] - 可选，显式 traceId；不传则自动取当前 AsyncLocalStorage 的
 * @param {string} [entry.error] - 失败时的错误摘要（可空）
 * @returns {void}
 */
function recordToolCall(entry) {
  try {
    const now = new Date().toISOString();
    const traceId = entry.traceId || getTraceId() || null;
    const argKeys = extractArgKeys(entry.args);
    const resultSummary = entry.result !== undefined ? summarizeResult(entry.result) : undefined;

    const record = {
      ts: now,
      traceId,
      agentId: entry.agentId || null,
      agentName: entry.agentName || null,
      tool: entry.toolName,
      success: Boolean(entry.success),
      durationMs: typeof entry.durationMs === 'number' ? Math.round(entry.durationMs) : null,
      argKeys,
      result: resultSummary,
      error: entry.error ? String(entry.error).slice(0, ERROR_SUMMARY_MAX_LEN) : undefined,
    };
    // 删除 undefined 字段，让 jsonl 更紧凑
    Object.keys(record).forEach((k) => record[k] === undefined && delete record[k]);

    ensureLogDir();
    const line = JSON.stringify(record) + '\n';
    writeQueue.push(line);

    if (writeQueue.length >= BATCH_FLUSH_THRESHOLD) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
    } else {
      scheduleFlush();
    }
  } catch (err) {
    // 审计本身永远不能抛错拖垮工具执行
    try {
      process.stderr.write(`[audit] recordToolCall 异常: ${err.message}\n`);
    } catch (_e) {
      // 忽略
    }
  }
}

/**
 * 强制 flush（测试用）
 */
function flushAuditSync() {
  flushSync();
}

module.exports = {
  recordToolCall,
  flushAuditSync,
  getTodayAuditFile,
};
