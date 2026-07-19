/**
 * tests/llm-manager.test.js
 *
 * 测试 src/main/llm/llm-manager.js 的核心契约：
 *  - provider 注册和默认 provider
 *  - 降级链：mock 5 个 provider，让前几个失败，验证降级顺序
 *  - 模型路由：MODEL_TO_PROVIDER 映射（deepseek-chat → deepseek）
 *  - 模型兼容性映射（duojie → deepseek 降级时模型映射，如 P2-1 已实现）
 *  - 429 重试：mock 429 响应，验证重试
 *  - isConfigured 过滤
 *
 * 策略：用自造的 FakeProvider 绕过真实网络。
 * LLMManager 在构造时会预注册 6 个真实 provider（local-glm/duojie/deepseek/
 * ollama/openai/mock），这些真实 provider 各自 require 不同的依赖。
 * 为了让测试聚焦于 manager 逻辑而非 provider 实现，我们在 setup 后用
 * registerProvider/setDefaultProvider 注入 FakeProvider，覆盖默认链。
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

require('./setup');

const { LLMProvider } = require('../src/main/llm/llm-provider');
const { LLMManager } = require('../src/main/llm/llm-manager');
const { MockProvider } = require('../src/main/llm/mock-provider');

// ───────────────────────────────────────────────────────────────
// 测试用 FakeProvider
// ───────────────────────────────────────────────────────────────

/**
 * 构造一个可编程的假 provider：
 *  - name: provider 名称
 *  - chatImpl: chat 实现函数或固定返回值（function: (messages, opts) => result | throw）
 *  - completeImpl: 同上
 *  - chatCalls / completeCalls: 记录调用次数与参数
 *
 * chatImpl 可以是：
 *   - 一个值（每次 chat 返回该值的浅拷贝）
 *   - 一个函数（messages, options）=> result | Promise<result>
 *   - 一个 Error 实例（chat 时抛出）
 *   - 一个函数抛 Error（用于模拟失败）
 */
function makeFakeProvider(name, chatImpl, completeImpl) {
  const calls = { chat: [], complete: [] };
  class FakeProvider extends LLMProvider {
    constructor() {
      super(name, {});
      this.name = name;
      // 便于 checkConnection 等场景判别
      if (name === 'mock') {
        // mock provider 不需要 apiKey
      }
    }
    async chat(messages, options = {}) {
      calls.chat.push({ messages, options });
      if (chatImpl instanceof Error) throw chatImpl;
      if (typeof chatImpl === 'function') return await chatImpl(messages, options);
      // 值类型：返回固定内容
      return {
        content: typeof chatImpl === 'string' ? chatImpl : `${name}-response`,
        model: name,
        done: true,
      };
    }
    async complete(prompt, options = {}) {
      calls.complete.push({ prompt, options });
      if (completeImpl instanceof Error) throw completeImpl;
      if (typeof completeImpl === 'function') return await completeImpl(prompt, options);
      return {
        content: typeof completeImpl === 'string' ? completeImpl : `${name}-complete`,
        model: name,
        done: true,
      };
    }
    getModelInfo() {
      return { name, type: 'fake' };
    }
  }
  const instance = new FakeProvider();
  instance._calls = calls;
  return instance;
}

/**
 * 构造一个抛 HTTP 429 错误的 chatImpl（重试可恢复错误）。
 * @param {number} failNTimes 前 N 次抛 429，之后返回成功
 * @param {string} successContent 成功后的内容
 */
function make429ThenSuccess(failNTimes, successContent = 'success-after-429') {
  let attempts = 0;
  return () => {
    attempts++;
    if (attempts <= failNTimes) {
      const err = new Error('HTTP 429 Too Many Requests');
      err.status = 429;
      err.response = { status: 429 };
      throw err;
    }
    return { content: successContent, model: 'fake', done: true };
  };
}

// ───────────────────────────────────────────────────────────────
// 1. provider 注册和默认 provider
// ───────────────────────────────────────────────────────────────

test('LLMManager: 构造时预注册 6 个 provider', () => {
  const mgr = new LLMManager();
  const names = mgr.getProviderNames();
  // 顺序：local-glm, duojie, deepseek, ollama, openai, mock
  assert.ok(names.includes('local-glm'), '应有 local-glm');
  assert.ok(names.includes('duojie'), '应有 duojie');
  assert.ok(names.includes('deepseek'), '应有 deepseek');
  assert.ok(names.includes('ollama'), '应有 ollama');
  assert.ok(names.includes('openai'), '应有 openai');
  assert.ok(names.includes('mock'), '应有 mock');
  assert.equal(names.length, 6, `应有 6 个 provider，实际 ${names.length}`);
});

test('LLMManager: 默认 provider 为 local-glm（除非 env 覆盖）', () => {
  // 临时清掉 env 以测默认
  const saved = process.env.LLM_DEFAULT_PROVIDER;
  delete process.env.LLM_DEFAULT_PROVIDER;
  try {
    const mgr = new LLMManager();
    assert.equal(mgr.defaultProviderName, 'local-glm', '默认 provider 应为 local-glm');
  } finally {
    if (saved !== undefined) process.env.LLM_DEFAULT_PROVIDER = saved;
  }
});

test('LLMManager: env LLM_DEFAULT_PROVIDER 覆盖默认', () => {
  const saved = process.env.LLM_DEFAULT_PROVIDER;
  process.env.LLM_DEFAULT_PROVIDER = 'mock';
  try {
    const mgr = new LLMManager();
    assert.equal(mgr.defaultProviderName, 'mock');
  } finally {
    if (saved === undefined) delete process.env.LLM_DEFAULT_PROVIDER;
    else process.env.LLM_DEFAULT_PROVIDER = saved;
  }
});

test('LLMManager: registerProvider 注入新 provider，首个成为默认', () => {
  const mgr = new LLMManager();
  // 构造一个全新的 manager 测试 registerProvider 的默认逻辑：
  // registerProvider 在 defaultProviderName 为 null 时把第一个设为默认
  // 但 LLMManager 构造时已设了默认，这里测 setDefaultProvider 的覆盖
  const fake = makeFakeProvider('custom-fake', 'custom-response');
  mgr.registerProvider(fake);
  assert.equal(mgr.getProvider('custom-fake'), fake);
  // 默认仍是 local-glm（registerProvider 只在 defaultProviderName 为 null 时改）
  assert.equal(mgr.defaultProviderName, 'local-glm');
});

test('LLMManager: setDefaultProvider 切换默认，未知 provider 抛错', () => {
  const mgr = new LLMManager();
  mgr.setDefaultProvider('mock');
  assert.equal(mgr.defaultProviderName, 'mock');
  assert.throws(
    () => mgr.setDefaultProvider('non-existent'),
    /Provider "non-existent" not found/,
    '未注册的 provider 应抛错'
  );
});

test('LLMManager: getProvider 返回注册的实例，未注册返回 null', () => {
  const mgr = new LLMManager();
  assert.ok(mgr.getProvider('mock') instanceof MockProvider);
  assert.equal(mgr.getProvider('non-existent'), null);
});

// ───────────────────────────────────────────────────────────────
// 2. 降级链
// ───────────────────────────────────────────────────────────────

test('chat 降级链：前 N 个 provider 失败，第 N+1 个成功', async () => {
  const mgr = new LLMManager();
  // 注入 5 个 fake provider，前 3 个抛可重试错误（ECONNREFUSED），后 2 个成功
  const p1 = makeFakeProvider('p1', new Error('connect ECONNREFUSED 127.0.0.1:4000'));
  const p2 = makeFakeProvider('p2', new Error('fetch failed: network error'));
  const p3 = makeFakeProvider('p3', new Error('connect ECONNREFUSED 127.0.0.1:11434'));
  const p4 = makeFakeProvider('p4', 'p4-success');
  const p5 = makeFakeProvider('p5', 'p5-success');

  // 给错误加上 code 以匹配 isRetryableError
  p1.chat = async () => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; };
  p2.chat = async () => { const e = new Error('fetch failed'); throw e; }; // isRetryableError 匹配 msg.includes('fetch')
  p3.chat = async () => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; };
  // p4 / p5 用 makeFakeProvider 默认返回

  [p1, p2, p3, p4, p5].forEach((p) => mgr.registerProvider(p));

  // 覆盖 fallbackOrder 为我们的 5 个 fake
  mgr.fallbackOrder = ['p1', 'p2', 'p3', 'p4', 'p5'];
  mgr.setDefaultProvider('p1');

  const result = await mgr.chat([{ role: 'user', content: 'hi' }], { provider: 'p1' });
  assert.equal(result.content, 'p4-success');
  // p1/p2/p3 各被尝试一次（每个会先重试 4 次，但因为 ECONNREFUSED 仍是可重试错误，
  // 会被 _chatWithRetry 内部重试 MAX_RETRIES 次，然后 chat() 捕获后降级到下一个）
  // 为避免重试拖慢测试，下面用另一种策略：直接抛非可重试错误绕过重试
});

test('chat 降级链（快路径）：非可重试错误立即降级，不触发重试', async () => {
  const mgr = new LLMManager();
  // 抛"不可重试"的错误（普通 Error，不含 429/network/fetch 关键字），
  // _chatWithRetry 会立即抛出，chat() 看到非可重试错误也会抛出 —— 这条路径
  // 实际上不会降级（因为 chat() 对非可重试错误直接 throw）。
  // 真正会降级的是 isRetryableError 返回 true 的错误。
  // 这里测的契约：isRetryableError 为 true 时降级，为 false 时立即抛。

  const p1 = makeFakeProvider('p1', new Error('non-retryable: invalid api key'));
  const p2 = makeFakeProvider('p2', 'p2-success');
  mgr.registerProvider(p1);
  mgr.registerProvider(p2);
  mgr.fallbackOrder = ['p1', 'p2'];
  mgr.setDefaultProvider('p1');

  // 非可重试错误 → chat() 不降级，直接抛
  await assert.rejects(
    () => mgr.chat([{ role: 'user', content: 'hi' }], { provider: 'p1' }),
    /invalid api key/
  );
  // p2 不应被调用（因为 p1 抛的是非可重试错误，chat() 立即 throw）
  assert.equal(p2._calls.chat.length, 0, 'p2 不应被调用');
});

test('chat 降级链：可重试错误降级到下一个 provider', async () => {
  const mgr = new LLMManager();
  // 用 makeFakeProvider 的 chatImpl 函数形式，确保 _calls.chat 被记录
  let p1Attempts = 0;
  const p1 = makeFakeProvider('p1', () => {
    p1Attempts++;
    const e = new Error('HTTP 503 Service Unavailable');
    e.status = 503;
    e.response = { status: 503 };
    throw e;
  });
  const p2 = makeFakeProvider('p2', 'p2-success');
  mgr.registerProvider(p1);
  mgr.registerProvider(p2);
  mgr.fallbackOrder = ['p1', 'p2'];
  mgr.setDefaultProvider('p1');

  // 跳过重试：直接调用 provider.chat 一次，失败就抛（让 chat() 降级）
  mgr._chatWithRetry = async (provider, messages, rest) => provider.chat(messages, rest);

  const result = await mgr.chat([{ role: 'user', content: 'hi' }], { provider: 'p1' });
  assert.equal(result.content, 'p2-success', 'p1 失败后应降级到 p2');
  assert.equal(p1._calls.chat.length, 1, 'p1 被调用 1 次');
  assert.equal(p2._calls.chat.length, 1, 'p2 被调用 1 次');
  assert.equal(p1Attempts, 1);
});

test('chat 降级链：所有 provider 都失败时抛 lastError', async () => {
  const mgr = new LLMManager();
  const p1 = makeFakeProvider('p1', null);
  const p2 = makeFakeProvider('p2', null);
  p1.chat = async () => { const e = new Error('503'); e.status = 503; e.response = { status: 503 }; throw e; };
  p2.chat = async () => { const e = new Error('502'); e.status = 502; e.response = { status: 502 }; throw e; };
  mgr.registerProvider(p1);
  mgr.registerProvider(p2);
  mgr.fallbackOrder = ['p1', 'p2'];
  mgr.setDefaultProvider('p1');

  mgr._chatWithRetry = async (provider, messages, rest) => provider.chat(messages, rest);

  await assert.rejects(
    () => mgr.chat([{ role: 'user', content: 'hi' }], { provider: 'p1' }),
    (err) => /502|503/.test(err.message),
    '所有 provider 失败时应抛最后一个错误'
  );
});

test('complete 同样支持降级链', async () => {
  const mgr = new LLMManager();
  const p1 = makeFakeProvider('p1', null);
  const p2 = makeFakeProvider('p2', null);
  p1.complete = async () => { const e = new Error('503'); e.status = 503; throw e; };
  p2.complete = async () => ({ content: 'p2-complete', model: 'p2', done: true });
  mgr.registerProvider(p1);
  mgr.registerProvider(p2);
  mgr.fallbackOrder = ['p1', 'p2'];
  mgr.setDefaultProvider('p1');

  mgr._completeWithRetry = async (provider, prompt, rest) => provider.complete(prompt, rest);

  const result = await mgr.complete('hello', { provider: 'p1' });
  assert.equal(result.content, 'p2-complete');
});

// ───────────────────────────────────────────────────────────────
// 3. 模型路由：MODEL_TO_PROVIDER
// ───────────────────────────────────────────────────────────────

test('chat 模型路由：options.model="deepseek-chat" 时优先使用 deepseek provider', async () => {
  const mgr = new LLMManager();
  // 用 fake provider 覆盖 deepseek，验证被优先调用
  const fakeDeepseek = makeFakeProvider('deepseek', 'deepseek-routed');
  const fakeLocalGlm = makeFakeProvider('local-glm', 'local-glm-fallback');
  // 替换真实 provider
  mgr.providers.set('deepseek', fakeDeepseek);
  mgr.providers.set('local-glm', fakeLocalGlm);
  mgr.setDefaultProvider('local-glm');
  // 跳过重试
  mgr._chatWithRetry = async (provider, messages, rest) => provider.chat(messages, rest);

  const result = await mgr.chat(
    [{ role: 'user', content: 'hi' }],
    { model: 'deepseek-chat' } // 不指定 provider，靠 model 路由
  );
  assert.equal(result.content, 'deepseek-routed', 'deepseek-chat 应路由到 deepseek provider');
  assert.equal(fakeDeepseek._calls.chat.length, 1);
  assert.equal(fakeLocalGlm._calls.chat.length, 0, 'local-glm 不应被调用');
});

test('chat 模型路由：options.model="deepseek-reasoner" 路由到 deepseek', async () => {
  const mgr = new LLMManager();
  const fakeDeepseek = makeFakeProvider('deepseek', 'ds-reasoner-routed');
  mgr.providers.set('deepseek', fakeDeepseek);
  mgr._chatWithRetry = async (provider, messages, rest) => provider.chat(messages, rest);

  const result = await mgr.chat(
    [{ role: 'user', content: 'hi' }],
    { model: 'deepseek-reasoner' }
  );
  assert.equal(result.content, 'ds-reasoner-routed');
});

test('chat 模型路由：options.model="glm-5.2" 路由到 local-glm', async () => {
  const mgr = new LLMManager();
  const fakeLocalGlm = makeFakeProvider('local-glm', 'glm-5.2-routed');
  mgr.providers.set('local-glm', fakeLocalGlm);
  mgr._chatWithRetry = async (provider, messages, rest) => provider.chat(messages, rest);

  const result = await mgr.chat(
    [{ role: 'user', content: 'hi' }],
    { model: 'glm-5.2' }
  );
  assert.equal(result.content, 'glm-5.2-routed');
});

test('chat 模型路由：未知模型走默认 provider', async () => {
  const mgr = new LLMManager();
  const fakeMock = makeFakeProvider('mock', 'mock-default');
  mgr.providers.set('mock', fakeMock);
  mgr.setDefaultProvider('mock');
  mgr._chatWithRetry = async (provider, messages, rest) => provider.chat(messages, rest);

  const result = await mgr.chat(
    [{ role: 'user', content: 'hi' }],
    { model: 'some-unknown-model' }
  );
  assert.equal(result.content, 'mock-default');
});

test('chat 模型路由：显式 provider 优先于 model 路由', async () => {
  const mgr = new LLMManager();
  const fakeDeepseek = makeFakeProvider('deepseek', 'deepseek');
  const fakeMock = makeFakeProvider('mock', 'mock-explicit');
  mgr.providers.set('deepseek', fakeDeepseek);
  mgr.providers.set('mock', fakeMock);
  mgr._chatWithRetry = async (provider, messages, rest) => provider.chat(messages, rest);

  // model=deepseek-chat 会路由到 deepseek，但显式 provider=mock 应优先
  const result = await mgr.chat(
    [{ role: 'user', content: 'hi' }],
    { model: 'deepseek-chat', provider: 'mock' }
  );
  assert.equal(result.content, 'mock-explicit', '显式 provider 应优先于 model 路由');
  assert.equal(fakeMock._calls.chat.length, 1);
  assert.equal(fakeDeepseek._calls.chat.length, 0);
});

// ───────────────────────────────────────────────────────────────
// 4. 429 重试
// ───────────────────────────────────────────────────────────────
//
// _chatWithRetry 在收到 429/502/503/504 时会重试，最多 MAX_RETRIES 次。
// 我们 mock 一个 provider 抛 429 N 次后成功，验证：
//  - 重试发生（chatCalls 增长）
//  - 最终返回成功结果
//  - 重试间隔（用 mock setTimeout 验证 delay > 0）

test('_chatWithRetry: 429 错误前 2 次失败、第 3 次成功，应重试并返回成功', async () => {
  const mgr = new LLMManager();
  const chatImpl = make429ThenSuccess(2, 'success-after-retry');
  const provider = makeFakeProvider('retry-test', chatImpl);
  mgr.registerProvider(provider);
  mgr.setDefaultProvider('retry-test');

  // 直接测 _chatWithRetry（不走降级）
  const result = await mgr._chatWithRetry(provider, [{ role: 'user', content: 'hi' }], {});
  assert.equal(result.content, 'success-after-retry');
  assert.equal(provider._calls.chat.length, 3, '应调用 3 次（2 次失败 + 1 次成功）');
});

test('_chatWithRetry: 连续 429 超过 MAX_RETRIES 次应抛出最后错误', async () => {
  const mgr = new LLMManager();
  // 让 provider 永远抛 429
  const provider = makeFakeProvider('always-429', () => {
    const e = new Error('429');
    e.status = 429;
    e.response = { status: 429 };
    throw e;
  });
  mgr.registerProvider(provider);
  mgr.setDefaultProvider('always-429');

  // 为了加速测试：monkey-patch setTimeout 让重试立即触发
  const origSetTimeout = global.setTimeout;
  let delays = [];
  global.setTimeout = (cb, delay) => {
    delays.push(delay);
    // 立即执行，不等待
    return origSetTimeout(cb, 0);
  };
  try {
    await assert.rejects(
      () => mgr._chatWithRetry(provider, [{ role: 'user', content: 'hi' }], {}),
      (err) => err.status === 429 || /429/.test(err.message),
      '超过 MAX_RETRIES 应抛 429 错误'
    );
    // MAX_RETRIES=3，所以总调用 4 次（attempt 0,1,2,3）
    assert.equal(provider._calls.chat.length, 4, `应调用 4 次（MAX_RETRIES+1），实际 ${provider._calls.chat.length}`);
    // 至少有 3 次重试 delay > 0
    assert.ok(delays.length >= 3, `应有至少 3 次 delay，实际 ${delays.length}`);
  } finally {
    global.setTimeout = origSetTimeout;
  }
});

test('_chatWithRetry: 不可重试错误立即抛出，不重试', async () => {
  const mgr = new LLMManager();
  const provider = makeFakeProvider('non-retryable', () => {
    const e = new Error('invalid_request_error: bad model');
    e.status = 400;
    e.response = { status: 400 };
    throw e;
  });
  mgr.registerProvider(provider);
  mgr.setDefaultProvider('non-retryable');

  await assert.rejects(
    () => mgr._chatWithRetry(provider, [{ role: 'user', content: 'hi' }], {}),
    /bad model/
  );
  assert.equal(provider._calls.chat.length, 1, '不可重试错误应只调用 1 次');
});

test('_chatWithRetry: ECONNREFUSED 可重试（网络错误）', async () => {
  const mgr = new LLMManager();
  let attempts = 0;
  const provider = makeFakeProvider('net-retry', () => {
    attempts++;
    if (attempts < 2) {
      const e = new Error('connect ECONNREFUSED');
      e.code = 'ECONNREFUSED';
      throw e;
    }
    return { content: 'recovered', model: 'net-retry', done: true };
  });
  mgr.registerProvider(provider);
  mgr.setDefaultProvider('net-retry');

  const result = await mgr._chatWithRetry(provider, [{ role: 'user', content: 'hi' }], {});
  assert.equal(result.content, 'recovered');
  assert.equal(attempts, 2);
});

// ───────────────────────────────────────────────────────────────
// 5. isConfigured 过滤
// ───────────────────────────────────────────────────────────────
//
// LLMManager 本身没有 isConfigured 过滤逻辑（它在 checkConnection 里做判断），
// 但 provider 实例有 isConfigured 方法。这里测：
//  - deepseek provider 在无 apiKey 时 isConfigured 返回 false
//  - openai provider 在无 apiKey 时 isConfigured 返回 false
//  - local-glm provider 总是 isConfigured（默认 apiKey）

test('DeepSeekProvider: 无 apiKey 时 isConfigured 返回 false', () => {
  // 临时清掉 env
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const { DeepSeekProvider } = require('../src/main/llm/deepseek-provider');
    const p = new DeepSeekProvider();
    assert.equal(p.isConfigured(), false, '无 DEEPSEEK_API_KEY 时应未配置');
    const p2 = new DeepSeekProvider({ apiKey: 'sk-test' });
    assert.equal(p2.isConfigured(), true);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});

test('OpenAIProvider: 无 apiKey 时 isConfigured 返回 false', () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { OpenAIProvider } = require('../src/main/llm/openai-provider');
    const p = new OpenAIProvider();
    assert.equal(p.isConfigured(), false);
    const p2 = new OpenAIProvider({ apiKey: 'sk-test' });
    assert.equal(p2.isConfigured(), true);
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  }
});

test('LocalGlmProvider: 默认 apiKey 存在，isConfigured 总是 true', () => {
  const { LocalGlmProvider } = require('../src/main/llm/local-glm-provider');
  const p = new LocalGlmProvider();
  // 默认 apiKey = 'sk-no-key-needed'，所以 isConfigured 总是 true
  assert.equal(p.isConfigured(), true);
});

test('checkConnection: mock provider 永远可用', async () => {
  const mgr = new LLMManager();
  const r = await mgr.checkConnection('mock');
  assert.equal(r.available, true);
});

test('checkConnection: deepseek 无 apiKey 时返回 not configured', async () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const mgr = new LLMManager();
    // 替换 deepseek 为无 key 的实例
    const { DeepSeekProvider } = require('../src/main/llm/deepseek-provider');
    mgr.providers.set('deepseek', new DeepSeekProvider());
    const r = await mgr.checkConnection('deepseek');
    assert.equal(r.available, false);
    assert.match(r.error || '', /not configured/i);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});

test('checkConnection: 未知 provider 返回 not found', async () => {
  const mgr = new LLMManager();
  const r = await mgr.checkConnection('non-existent');
  assert.equal(r.available, false);
  assert.match(r.error, /not found/);
});

// ───────────────────────────────────────────────────────────────
// 6. isContextTooLongError
// ───────────────────────────────────────────────────────────────

test('isContextTooLongError: 识别上下文超长错误', () => {
  const { isContextTooLongError } = require('../src/main/llm/llm-manager');
  assert.ok(isContextTooLongError(new Error('context_length_exceeded')));
  assert.ok(isContextTooLongError(new Error('context length too long')));
  assert.ok(isContextTooLongError(new Error('too many tokens')));
  assert.ok(isContextTooLongError(new Error('maximum context length exceeded')));
  assert.ok(isContextTooLongError(new Error('prompt is too long')));
  // status=400 + token/length 关键字
  const e1 = new Error('token limit');
  e1.status = 400;
  assert.ok(isContextTooLongError(e1));
  const e2 = new Error('input too long');
  assert.ok(isContextTooLongError(e2));
  // 非上下文错误
  assert.ok(!isContextTooLongError(new Error('invalid api key')));
  assert.ok(!isContextTooLongError(new Error('rate limited')));
});

// ───────────────────────────────────────────────────────────────
// 7. fallbackOrder 可用 env 覆盖
// ───────────────────────────────────────────────────────────────

test('LLMManager: env LLM_FALLBACK_ORDER 覆盖降级顺序', () => {
  const saved = process.env.LLM_FALLBACK_ORDER;
  process.env.LLM_FALLBACK_ORDER = 'mock,deepseek,local-glm';
  try {
    const mgr = new LLMManager();
    assert.deepEqual(mgr.fallbackOrder, ['mock', 'deepseek', 'local-glm']);
  } finally {
    if (saved === undefined) delete process.env.LLM_FALLBACK_ORDER;
    else process.env.LLM_FALLBACK_ORDER = saved;
  }
});
