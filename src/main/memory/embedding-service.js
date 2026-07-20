/**
 * SoloForge - Embedding 服务（@xenova/transformers 本地推理）
 *
 * 阶段一B 产物：用 @xenova/transformers 在主进程本地运行 sentence embedding
 * 模型，把记忆文本转向量，供 vector-index.js 做 KNN 召回，供 1-C 阶段的
 * memory-retriever.js 做混合检索。
 *
 * 设计要点：
 * - 默认模型 'Xenova/all-MiniLM-L6-v2'（22M，384 维，轻量快速）。首次调用
 *   embed() 时懒加载（pipeline() 会自动从 HF Hub 下载模型到本地缓存目录
 *   ~/.soloforge/models，后续直接读缓存）。
 * - 接口：embed(text) → Float32Array(384) | null
 *         embedBatch(texts[]) → (Float32Array|null)[]
 *         getModelInfo() → { model, dim, ready }
 *         isReady() → boolean
 *         clearCache() → void
 * - 内存缓存：相同文本复用结果（Map，LRU 策略待定，当前简单 Map 足够；
 *   记忆条目量 ~170，缓存命中率不高但避免重复 embedding）。
 * - 降级：若 @xenova/transformers 加载失败，embed() 返回 null。调用方
 *   （memory-store / retriever）应据此降级到纯 FTS5 + tag 检索，不应抛异常
 *   阻塞主流程。
 * - 模型签名：每次写入 embedding 时记录模型名到 memories.embedding_model，
 *   换模型时可据此标记需重新 embedding（阶段 4-B 冷热分离时用）。
 *
 * @module memory/embedding-service
 */

'use strict';

const path = require('path');
const os = require('os');
const { logger } = require('../utils/logger');

// ─── 模型配置 ─────────────────────────────────────────────────
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DIM = 384;

// 模型缓存目录：放在 ~/.soloforge/models 下，与 SQLite/记忆数据同根，
// 便于统一备份/清理；避免污染系统缓存。
const MODEL_CACHE_DIR = path.join(os.homedir(), '.soloforge', 'models');
process.env.TRANSFORMERS_CACHE = process.env.TRANSFORMERS_CACHE || MODEL_CACHE_DIR;

// ─── 模块状态 ─────────────────────────────────────────────────
/** @type {any|null} @xenova/transformers pipeline 对象 */
let embedder = null;
/** @type {Promise|null} 正在进行的加载 Promise（避免并发重复加载） */
let loading = null;
/** @type {boolean} 是否已永久禁用（加载失败后不再重试，避免每次调用都卡几秒） */
let disabled = false;
/** @type {string|null} 失败原因（disabled=true 时记录） */
let disabledReason = null;
/** @type {string} 当前使用的模型名 */
let currentModel = DEFAULT_MODEL;

// ─── 内存缓存 ─────────────────────────────────────────────────
/**
 * 文本 → embedding 缓存。key=文本，value=Float32Array。
 * 简单 Map，不做 LRU；记忆条目量小，命中率低但避免重复计算。
 * @type {Map<string, Float32Array>}
 */
const cache = new Map();

/** 缓存上限（超过则清空重建，简单防泄漏） */
const CACHE_MAX = 2000;

// ─── 内部工具 ─────────────────────────────────────────────────

/**
 * 懒加载 @xenova/transformers pipeline。
 * 首次调用时加载，后续复用；并发调用只加载一次（共享 loading Promise）。
 * 加载失败则永久禁用，后续 embed() 直接返回 null。
 * @returns {Promise<any|null>}
 * @private
 */
async function getEmbedder() {
  // 已禁用：不再尝试
  if (disabled) return null;
  // 已加载：直接返回
  if (embedder) return embedder;
  // 正在加载：复用进行中的 Promise（避免并发触发多次下载）
  if (loading) return loading;

  loading = (async () => {
    try {
      const { pipeline } = require('@xenova/transformers');
      logger.info('加载 embedding 模型', {
        model: currentModel,
        cacheDir: MODEL_CACHE_DIR,
      });
      const p = await pipeline('feature-extraction', currentModel);
      embedder = p;
      logger.info('embedding 模型加载完成', {
        model: currentModel,
        dim: DEFAULT_DIM,
      });
      return p;
    } catch (error) {
      // 永久禁用：避免每次调用都重试（每次重试都会卡几秒甚至失败）
      disabled = true;
      disabledReason = error.message;
      logger.warn(
        'embedding 模型加载失败，已禁用 embedding 服务（降级到纯 FTS5）',
        {
          model: currentModel,
          error: error.message,
        }
      );
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/**
 * 把 transformers.js 的 Tensor 输出转成标准 Float32Array。
 * output.data 在该 pipeline 下已是 Float32Array，这里做一次归一化校验。
 * @param {any} output pipeline 输出（Tensor）
 * @returns {Float32Array}
 * @private
 */
function tensorToFloat32Array(output) {
  // output.data 通常是 Float32Array；做一次拷贝避免外部修改影响缓存
  const src = output.data;
  if (src instanceof Float32Array) {
    return new Float32Array(src);
  }
  // 兜底：从类数组或普通数组转换
  return new Float32Array(Array.from(src));
}

// ─── 对外接口 ─────────────────────────────────────────────────

/**
 * 生成单条文本的 embedding。
 * - 空文本返回 null（不缓存 null，避免污染缓存）。
 * - 命中缓存直接返回（Float32Array 是可变引用，调用方不应修改）。
 * - 模型加载失败返回 null（调用方应降级到 FTS5）。
 * @param {string} text
 * @returns {Promise<Float32Array|null>} 384 维向量，或 null
 */
async function embed(text) {
  // 参数校验
  if (text == null || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }
  // 命中缓存
  const cached = cache.get(text);
  if (cached) return cached;

  // 获取 pipeline
  const extractor = await getEmbedder();
  if (!extractor) return null; // 已禁用

  try {
    const output = await extractor(text, {
      pooling: 'mean',
      normalize: true,
    });
    const result = tensorToFloat32Array(output);
    if (!result || result.length !== DEFAULT_DIM) {
      logger.warn('embedding 维度异常', {
        expected: DEFAULT_DIM,
        actual: result ? result.length : 0,
      });
      return null;
    }
    // 写入缓存（容量保护）
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(text, result);
    return result;
  } catch (error) {
    logger.debug('embedding 生成失败', { text: text.slice(0, 50), error: error.message });
    return null;
  }
}

/**
 * 批量生成 embedding。
 * 逐条调用 embed()（transformers.js 单条 pipeline 调用已足够快，
 * 批量 API 在 2.x 版本下行为不稳定，逐条更可靠且天然复用缓存）。
 * @param {string[]} texts
 * @returns {Promise<(Float32Array|null)[]>}
 */
async function embedBatch(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const results = new Array(texts.length);
  for (let i = 0; i < texts.length; i++) {
    results[i] = await embed(texts[i]);
  }
  return results;
}

/**
 * 获取当前 embedding 服务信息。
 * @returns {{ model: string, dim: number, ready: boolean, disabled: boolean, cacheSize: number }}
 */
function getModelInfo() {
  return {
    model: currentModel,
    dim: DEFAULT_DIM,
    ready: !!embedder && !disabled,
    disabled,
    disabledReason: disabled ? disabledReason : null,
    cacheSize: cache.size,
  };
}

/**
 * 服务是否就绪（模型已加载且未禁用）。
 * 注意：返回 false 不代表永远不可用，仅代表当前未加载；首次 embed() 会触发加载。
 * @returns {boolean}
 */
function isReady() {
  return !!embedder && !disabled;
}

/**
 * 清空内存缓存。
 * 切换公司或需要回收内存时调用。
 */
function clearCache() {
  cache.clear();
}

/**
 * 重置服务状态（测试用）。
 * 清空缓存 + 重置禁用标志，但保留已加载的模型（避免重复下载）。
 */
function reset() {
  cache.clear();
  disabled = false;
  disabledReason = null;
}

module.exports = {
  embed,
  embedBatch,
  getModelInfo,
  isReady,
  clearCache,
  reset,
  // 常量导出（供 vector-index / retriever 引用）
  DEFAULT_MODEL,
  DEFAULT_DIM,
};
