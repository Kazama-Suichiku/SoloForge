/**
 * LLM 模块统一导出
 */

const { LLMProvider } = require('./llm-provider');
const { OllamaProvider } = require('./ollama-provider');
const { OpenAIProvider } = require('./openai-provider');
const { DuojieProvider, SUPPORTED_MODELS: DUOJIE_MODELS, MODEL_CONTEXT_LIMITS: DUOJIE_CONTEXT_LIMITS } = require('./duojie-provider');
const { DeepSeekProvider, SUPPORTED_MODELS: DEEPSEEK_MODELS, MODEL_CONTEXT_LIMITS: DEEPSEEK_CONTEXT_LIMITS } = require('./deepseek-provider');
const { LocalGlmProvider } = require('./local-glm-provider');
const { MockProvider } = require('./mock-provider');
const {
  LLMManager,
  MODEL_EQUIVALENTS,
  PROVIDER_DEFAULT_MODELS,
  resolveEquivalentModel,
} = require('./llm-manager');

module.exports = {
  LLMProvider,
  OllamaProvider,
  OpenAIProvider,
  DuojieProvider,
  DeepSeekProvider,
  LocalGlmProvider,
  MockProvider,
  LLMManager,
  MODEL_EQUIVALENTS,
  PROVIDER_DEFAULT_MODELS,
  resolveEquivalentModel,
  DUOJIE_MODELS,
  DUOJIE_CONTEXT_LIMITS,
  DEEPSEEK_MODELS,
  DEEPSEEK_CONTEXT_LIMITS,
};
