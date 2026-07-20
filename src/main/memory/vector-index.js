/**
 * SoloForge - HNSW 向量索引（hnswlib-node）
 *
 * 阶段一B 产物：用 hnswlib-node 在内存中构建 HNSW（Hierarchical Navigable
 * Small World）近似最近邻索引，对 memories.embedding 做 KNN 召回。
 * 配合 embedding-service.js（生成向量）与 sqlite-store.js（持久化 embedding BLOB）
 * 使用，由 memory-store.js 在启动时从 SQLite 重建。
 *
 * 设计要点：
 * - 维度：384（all-MiniLM-L6-v2 输出维度，与 embedding-service.DEFAULT_DIM 对齐）
 * - 距离度量：cosine（embedding-service 已做 normalize，cosine 等价于点积，
 *   hnswlib 的 cosine space 会自己做归一化，但归一化向量下结果一致）
 * - id 映射：hnswlib 内部用连续整数 label（0..N-1），与记忆的字符串 id 通过
 *   idMap (label → memoryId) / reverseIdMap (memoryId → label) 双向映射
 * - 容量自适应：initIndex 时按当前数据量开容量；增量添加到上限时自动
 *   resizeIndex 扩容（2 倍），避免预估不准导致写入失败
 * - 持久化：save/load 支持把 HNSW 结构序列化到文件；但默认启动时从 SQLite
 *   重建（更可靠，避免索引文件与数据库不一致）。save/load 留作可选优化
 *   （大量向量时省启动时间）
 * - 线程安全：hnswlib-node 单线程，主进程调用无并发问题；注意 addPoint/
 *   search 不要在异步回调中并发调用同一 index（本模块单例，调用方应串行）
 *
 * @module memory/vector-index
 */

'use strict';

const fs = require('fs');
const path = require('path');
const hnswlib = require('hnswlib-node');
const { logger } = require('../utils/logger');
const { DEFAULT_DIM } = require('./embedding-service');

// ─── 索引参数 ─────────────────────────────────────────────────
/** 向量维度（与 embedding-service 对齐） */
const DIM = DEFAULT_DIM; // 384
/** HNSW 参数：每个节点的最大连接数 */
const M = 16;
/** HNSW 参数：构建时 ef_construction（越大召回越准，构建越慢） */
const EF_CONSTRUCTION = 200;
/** HNSW 参数：随机种子（固定以保证可复现） */
const RANDOM_SEED = 1;
/** 初始容量（buildIndex 时按 items.length 开，增量 add 时按此起步） */
const INITIAL_CAPACITY = 1024;
/** 扩容倍数（容量不足时 resize） */
const RESIZE_FACTOR = 2;
/** 查询时 ef 参数（越大召回越准，查询越慢；默认 50 对 k=50 足够） */
const DEFAULT_EF = 50;

// ─── 模块状态 ─────────────────────────────────────────────────
/** @type {import('hnswlib-node').HierarchicalNSW|null} */
let index = null;
/** label(memory 内部序号) → memoryId 字符串 */
const idMap = new Map();
/** memoryId 字符串 → label（反向映射，用于 addVector 去重 / 删除） */
const reverseIdMap = new Map();
/** 当前容量（用于判断是否需要 resize） */
let currentCapacity = 0;
/** 当前使用的距离度量（固定 cosine） */
const SPACE = 'cosine';

// ─── 内部工具 ─────────────────────────────────────────────────

/**
 * 把 Float32Array / ArrayBuffer / Buffer 转成 hnswlib 需要的 number[]。
 * hnswlib-node 的 addPoint/searchKnn 接受 number[]（普通 JS 数组），
 * 不直接吃 TypedArray，故统一转换。
 *
 * 关键点：SQLite 存取的 embedding 是 Buffer，底层是 Float32 序列化
 * （384 floats × 4 bytes = 1536 bytes）。必须按 Float32 视角解析，
 * 不能把每个 byte 当成一个维度。
 *
 * @param {Float32Array|ArrayBuffer|Buffer|number[]} vec
 * @returns {number[]}
 * @private
 */
function toNumberArray(vec) {
  if (!vec) return [];
  // 普通 JS 数组：直接返回
  if (Array.isArray(vec)) return vec;
  // TypedArray（Float32Array 等）：按元素读
  if (ArrayBuffer.isView(vec) && !Buffer.isBuffer(vec)) {
    return Array.from(vec);
  }
  // Buffer：SQLite 存的 embedding 是 Float32 序列化后的字节流，
  // 必须按 Float32 视角解析（384 floats），不能逐字节当维度。
  if (Buffer.isBuffer(vec)) {
    // 用 slice 拷贝出独立的 ArrayBuffer（Buffer 可能共享池，直接 view 会越界）
    const ab = vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength);
    return Array.from(new Float32Array(ab));
  }
  // ArrayBuffer：按 Float32 解析
  if (vec instanceof ArrayBuffer) {
    return Array.from(new Float32Array(vec));
  }
  return Array.from(vec);
}

/**
 * 创建新的 HNSW 索引并初始化。
 * @param {number} maxElements
 * @returns {import('hnswlib-node').HierarchicalNSW}
 * @private
 */
function createIndex(maxElements) {
  const idx = new hnswlib.HierarchicalNSW(SPACE, DIM);
  idx.initIndex(maxElements, M, EF_CONSTRUCTION, RANDOM_SEED);
  idx.setEf(DEFAULT_EF);
  return idx;
}

/**
 * 确保容量 >= needed。不足则 resizeIndex 扩容。
 * @param {number} needed
 * @private
 */
function ensureCapacity(needed) {
  if (!index) return;
  const max = index.getMaxElements();
  if (max >= needed) return;
  const newMax = Math.max(needed, Math.ceil(max * RESIZE_FACTOR));
  index.resizeIndex(newMax);
  currentCapacity = newMax;
  logger.debug('HNSW 索引扩容', { from: max, to: newMax });
}

// ─── 对外接口（单例风格）─────────────────────────────────────

/**
 * 从 items 批量构建 HNSW 索引。
 * 会清空已有索引重建。items 顺序即 label 顺序（0..N-1）。
 * @param {Array<{id: string, embedding: Float32Array|Buffer|number[]}>} items
 * @returns {{ built: boolean, count: number, errors: number }}
 */
function buildIndex(items) {
  // 清空旧状态
  clear();

  if (!Array.isArray(items) || items.length === 0) {
    logger.info('buildIndex: 无数据，跳过构建');
    return { built: false, count: 0, errors: 0 };
  }

  const capacity = Math.max(items.length, INITIAL_CAPACITY);
  index = createIndex(capacity);
  currentCapacity = capacity;

  let count = 0;
  let errors = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || !item.id || !item.embedding) {
      errors++;
      continue;
    }
    try {
      const vec = toNumberArray(item.embedding);
      if (vec.length !== DIM) {
        logger.warn('buildIndex: 向量维度不符，跳过', {
          id: item.id,
          expected: DIM,
          actual: vec.length,
        });
        errors++;
        continue;
      }
      index.addPoint(vec, i, false);
      idMap.set(i, item.id);
      reverseIdMap.set(item.id, i);
      count++;
    } catch (e) {
      errors++;
      logger.debug('buildIndex: 添加点失败', { id: item.id, error: e.message });
    }
  }

  logger.info('HNSW 向量索引已构建', {
    total: items.length,
    indexed: count,
    errors,
    capacity,
  });
  return { built: true, count, errors };
}

/**
 * 增量添加一条向量。
 * - 若 id 已存在则覆盖（先 markDelete 旧 label，再加新点）。
 * - 容量不足自动扩容。
 * @param {string} id 记忆 id
 * @param {Float32Array|Buffer|number[]} embedding
 * @returns {{ added: boolean, label: number|null, error?: string }}
 */
function addVector(id, embedding) {
  if (!id || !embedding) return { added: false, label: null, error: '参数缺失' };

  const vec = toNumberArray(embedding);
  if (vec.length !== DIM) {
    return {
      added: false,
      label: null,
      error: `维度不符 (expected ${DIM}, got ${vec.length})`,
    };
  }

  // 惰性创建索引（首次 addVector 且未 buildIndex 时）
  if (!index) {
    index = createIndex(INITIAL_CAPACITY);
    currentCapacity = INITIAL_CAPACITY;
  }

  // 若已存在同 id，先标记删除旧点（hnswlib 的 markDelete 仅从搜索结果剔除，
  // 不释放 slot；复用 label 会报错，故分配新 label）
  if (reverseIdMap.has(id)) {
    const oldLabel = reverseIdMap.get(id);
    try {
      index.markDelete(oldLabel);
    } catch (_e) {
      // 忽略：某些版本无此方法或 label 已无效
    }
    idMap.delete(oldLabel);
    reverseIdMap.delete(id);
  }

  // 确保容量
  const nextLabel = index.getCurrentCount();
  ensureCapacity(nextLabel + 1);

  try {
    index.addPoint(vec, nextLabel, false);
    idMap.set(nextLabel, id);
    reverseIdMap.set(id, nextLabel);
    return { added: true, label: nextLabel };
  } catch (e) {
    logger.debug('addVector 失败', { id, error: e.message });
    return { added: false, label: null, error: e.message };
  }
}

/**
 * KNN 搜索：返回距离 query 最近的 k 条记忆。
 * @param {Float32Array|Buffer|number[]} queryEmbedding
 * @param {number} [k=50]
 * @returns {Array<{id: string, distance: number, label: number}>}
 *   distance 是 hnswlib cosine space 下的距离（= 1 - cos相似度，
 *   值越小越相似）。label 是内部序号，调试用。
 */
function search(queryEmbedding, k = 50) {
  if (!index || index.getCurrentCount() === 0) return [];

  const vec = toNumberArray(queryEmbedding);
  if (vec.length !== DIM) {
    logger.warn('search: 查询向量维度不符', {
      expected: DIM,
      actual: vec.length,
    });
    return [];
  }

  // k 不能超过当前点数
  const numNeighbors = Math.min(k, index.getCurrentCount());
  if (numNeighbors <= 0) return [];

  let result;
  try {
    result = index.searchKnn(vec, numNeighbors);
  } catch (e) {
    logger.debug('searchKnn 失败', { error: e.message });
    return [];
  }

  if (!result || !result.neighbors || result.neighbors.length === 0) return [];

  const out = [];
  for (let i = 0; i < result.neighbors.length; i++) {
    const label = result.neighbors[i];
    const id = idMap.get(label);
    if (id == null) continue; // 已删除或未映射
    out.push({
      id,
      distance: result.distances[i],
      label,
    });
  }
  return out;
}

/**
 * 获取当前索引中的向量数量。
 * @returns {number}
 */
function size() {
  return index ? index.getCurrentCount() : 0;
}

/**
 * 清空索引（释放内存，释放 id 映射）。
 * 不影响 SQLite 中的 embedding BLOB。
 */
function clear() {
  index = null;
  idMap.clear();
  reverseIdMap.clear();
  currentCapacity = 0;
}

/**
 * 从记忆 id 移除向量（标记删除，不释放 slot）。
 * 用于记忆被 delete 时同步清理向量索引。
 * @param {string} id
 * @returns {boolean}
 */
function removeVector(id) {
  if (!index) return false;
  const label = reverseIdMap.get(id);
  if (label == null) return false;
  try {
    index.markDelete(label);
  } catch (_e) {
    // 忽略
  }
  idMap.delete(label);
  reverseIdMap.delete(id);
  return true;
}

/**
 * 设置查询时的 ef 参数（越大召回越准，查询越慢）。
 * @param {number} ef
 */
function setEf(ef) {
  if (index && typeof ef === 'number' && ef > 0) {
    index.setEf(ef);
  }
}

// ─── 持久化（可选）──────────────────────────────────────────

/**
 * 把 HNSW 索引结构 + id 映射保存到文件。
 * 注意：id 映射单独存 JSON（hnswlib 只存向量与 label）。
 * 默认启动时从 SQLite 重建，此方法留作快速启动优化。
 * @param {string} filePath 索引文件路径（.bin）
 * @returns {{ saved: boolean, error?: string }}
 */
function save(filePath) {
  if (!index) return { saved: false, error: '索引未构建' };
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    index.writeIndexSync(filePath);
    // id 映射存到 .map.json
    const mapPath = filePath + '.map.json';
    const mapData = {
      idMap: Array.from(idMap.entries()),
      reverseIdMap: Array.from(reverseIdMap.entries()),
      dim: DIM,
      space: SPACE,
      capacity: currentCapacity,
    };
    fs.writeFileSync(mapPath, JSON.stringify(mapData));
    logger.info('HNSW 索引已保存', { file: filePath, size: size() });
    return { saved: true };
  } catch (e) {
    logger.warn('HNSW 索引保存失败', { error: e.message });
    return { saved: false, error: e.message };
  }
}

/**
 * 从文件加载 HNSW 索引 + id 映射。
 * @param {string} filePath
 * @returns {{ loaded: boolean, count: number, error?: string }}
 */
function load(filePath) {
  clear();
  try {
    if (!fs.existsSync(filePath)) {
      return { loaded: false, count: 0, error: '文件不存在' };
    }
    index = new hnswlib.HierarchicalNSW(SPACE, DIM);
    index.readIndexSync(filePath);
    index.setEf(DEFAULT_EF);
    currentCapacity = index.getMaxElements();

    // 读 id 映射
    const mapPath = filePath + '.map.json';
    if (fs.existsSync(mapPath)) {
      const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
      for (const [label, id] of mapData.idMap || []) {
        idMap.set(label, id);
      }
      for (const [id, label] of mapData.reverseIdMap || []) {
        reverseIdMap.set(id, label);
      }
    }

    logger.info('HNSW 索引已加载', { file: filePath, count: size() });
    return { loaded: true, count: size() };
  } catch (e) {
    logger.warn('HNSW 索引加载失败', { error: e.message });
    clear();
    return { loaded: false, count: 0, error: e.message };
  }
}

/**
 * 获取索引状态信息（调试/监控用）。
 * @returns {{ ready: boolean, size: number, capacity: number, dim: number, space: string }}
 */
function getInfo() {
  return {
    ready: !!index,
    size: size(),
    capacity: index ? index.getMaxElements() : 0,
    dim: DIM,
    space: SPACE,
  };
}

module.exports = {
  // 构建 / 增删
  buildIndex,
  addVector,
  removeVector,
  search,
  clear,
  // 状态
  size,
  getInfo,
  setEf,
  // 持久化（可选）
  save,
  load,
  // 常量
  DIM,
  SPACE,
};
