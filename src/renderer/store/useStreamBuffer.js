/**
 * 独立的流式 buffer 外部存储（P2-7）。
 * 把流式 chunk 从 zustand store 移出，避免 16ms 全量重渲染。
 *
 * 流式过程中 chunk 只在这里累积，不触发 store set；
 * 完成时由 chat-store 的 updateMessage 一次性 consume 写入。
 * 组件通过 useStreamingContent(messageId) 订阅单条消息的 buffer，
 * 只有该消息的订阅者重渲染，其他消息不受影响。
 */
import { useSyncExternalStore } from 'react';

// messageId → { chunks: string, listeners: Set<Function> }
const _buffers = new Map();

function _ensureEntry(messageId) {
  let entry = _buffers.get(messageId);
  if (!entry) {
    entry = { chunks: '', listeners: new Set() };
    _buffers.set(messageId, entry);
  }
  return entry;
}

function _notify(messageId) {
  const entry = _buffers.get(messageId);
  if (entry) {
    for (const cb of entry.listeners) {
      try { cb(); } catch { /* 单个订阅者失败不影响其他 */ }
    }
  }
}

/**
 * 追加流式 chunk 到指定消息的 buffer。不触发任何 store 更新。
 * @param {string} messageId
 * @param {string} chunk
 */
export function appendChunk(messageId, chunk) {
  if (!messageId || !chunk) return;
  _ensureEntry(messageId).chunks += chunk;
  _notify(messageId);
}

/**
 * 获取当前 buffer 内容（未消费）。
 * @param {string} messageId
 * @returns {string}
 */
export function getBuffer(messageId) {
  const entry = _buffers.get(messageId);
  return entry ? entry.chunks : '';
}

/**
 * 是否有未消费的 buffer。
 * @param {string} messageId
 * @returns {boolean}
 */
export function hasBuffer(messageId) {
  const entry = _buffers.get(messageId);
  return !!entry && entry.chunks.length > 0;
}

/**
 * 消费并清除 buffer：返回当前内容并移除条目。
 * @param {string} messageId
 * @returns {string}
 */
export function consume(messageId) {
  const entry = _buffers.get(messageId);
  if (!entry) return '';
  const chunks = entry.chunks;
  _buffers.delete(messageId);
  _notify(messageId); // 通知订阅者变为空
  return chunks;
}

/**
 * 清除指定消息的 buffer（不返回内容）。
 * @param {string} messageId
 */
export function clearBuffer(messageId) {
  if (_buffers.delete(messageId)) _notify(messageId);
}

// ─── 订阅 API（useSyncExternalStore）─────────────────────────

/**
 * 订阅指定消息的 buffer 变化。
 * @param {string} messageId
 * @param {() => void} callback
 * @returns {() => void} 取消订阅
 */
export function subscribe(messageId, callback) {
  if (!messageId) return () => {};
  const entry = _ensureEntry(messageId);
  entry.listeners.add(callback);
  return () => {
    const e = _buffers.get(messageId);
    if (e) e.listeners.delete(callback);
  };
}

/**
 * React Hook：订阅单条消息的流式 buffer 内容。
 * 流式期间只有使用此 hook 的组件重渲染，其他消息的组件不受影响。
 * @param {string|null|undefined} messageId
 * @returns {string} 当前 buffer 内容（无 buffer 或 null id 时返回 ''）
 */
export function useStreamingContent(messageId) {
  return useSyncExternalStore(
    (cb) => (messageId ? subscribe(messageId, cb) : () => {}),
    () => (messageId ? getBuffer(messageId) : ''),
    () => '',
  );
}
