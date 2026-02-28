/**
 * LLM 服务 - 直接从 App 调用 DeepSeek API
 */

import { storage } from '../storage';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
  stream?: boolean;
}

export interface StreamCallback {
  onToken: (token: string) => void;
  onToolCall?: (toolCall: any) => void;
  onComplete: (fullResponse: string, usage?: any) => void;
  onError: (error: Error) => void;
}

const DEFAULT_MODEL = 'deepseek-chat';
const API_URL = 'https://api.deepseek.com/chat/completions';
const BUILTIN_API_KEY = 'sk-aacb18e63ffe48459c7badfa4c0a515d';

/**
 * 清理消息历史，确保 tool 消息结构合法
 * DeepSeek API 要求：
 * 1. tool 消息必须紧跟在有 tool_calls 的 assistant 消息之后
 * 2. 每个 tool_call 都必须有对应的 tool 响应
 */
function sanitizeMessages(messages: Message[]): Message[] {
  const result: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'system' || msg.role === 'user') {
      result.push({ role: msg.role, content: msg.content || '' });
      continue;
    }

    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const toolCallIds = new Set(msg.tool_calls.map((tc: any) => tc.id));
        result.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.tool_calls,
        });
        let j = i + 1;
        while (j < messages.length && messages[j].role === 'tool') {
          const toolMsg = messages[j];
          if (toolMsg.tool_call_id && toolCallIds.has(toolMsg.tool_call_id)) {
            result.push({
              role: 'tool',
              content: toolMsg.content || '',
              tool_call_id: toolMsg.tool_call_id,
            });
            toolCallIds.delete(toolMsg.tool_call_id);
          }
          j++;
        }
        for (const missingId of toolCallIds) {
          result.push({
            role: 'tool',
            content: JSON.stringify({ error: '工具执行结果丢失' }),
            tool_call_id: missingId,
          });
        }
        i = j - 1;
      } else {
        result.push({ role: 'assistant', content: msg.content || '(无内容)' });
      }
      continue;
    }
  }

  return result;
}

class LLMService {
  private apiKey: string | null = null;

  async initialize(): Promise<void> {
    this.apiKey = await storage.getApiKey();
    if (!this.apiKey) {
      this.apiKey = BUILTIN_API_KEY;
      await storage.setApiKey(BUILTIN_API_KEY);
    }
  }

  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    await storage.setApiKey(key);
  }

  getApiKey(): string | null {
    return this.apiKey;
  }

  /**
   * 非流式调用 - 用于工具调用轮次，确保拿到完整的 tool_calls
   */
  async chat(
    messages: Message[],
    options: ChatOptions = {}
  ): Promise<{ content: string; toolCalls?: any[]; usage?: any }> {
    if (!this.apiKey) throw new Error('API Key 未设置');

    const cleanMessages = sanitizeMessages(messages);
    console.log('[LLM] chat 非流式请求, 消息数:', cleanMessages.length, 'tools:', options.tools?.length || 0);

    const body: any = {
      model: options.model || DEFAULT_MODEL,
      messages: cleanMessages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4096,
      stream: false,
    };
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API 错误: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    console.log('[LLM] chat 响应, finish_reason:', choice?.finish_reason,
      'tool_calls:', choice?.message?.tool_calls?.length || 0,
      'content_len:', choice?.message?.content?.length || 0);

    return {
      content: choice?.message?.content || '',
      toolCalls: choice?.message?.tool_calls,
      usage: data.usage,
    };
  }

  /**
   * 流式调用 - 仅用于最终文本输出（无工具调用时）
   */
  async chatStream(
    messages: Message[],
    options: ChatOptions,
    callbacks: StreamCallback
  ): Promise<void> {
    if (!this.apiKey) {
      callbacks.onError(new Error('API Key 未设置'));
      return;
    }

    try {
      const cleanMessages = sanitizeMessages(messages);
      console.log('[LLM] chatStream 请求, 消息数:', cleanMessages.length, 'tools:', options.tools?.length || 0);

      // 如果有工具定义，使用非流式请求确保 tool_calls 完整
      if (options.tools && options.tools.length > 0) {
        const result = await this.chat(messages, { ...options, stream: false });

        if (result.toolCalls && result.toolCalls.length > 0) {
          console.log('[LLM] 检测到工具调用:', result.toolCalls.map((tc: any) => tc.function?.name));
          // 先输出文本内容（如果有的话）
          if (result.content) {
            callbacks.onToken(result.content);
          }
          for (const tc of result.toolCalls) {
            callbacks.onToolCall?.(tc);
          }
          callbacks.onComplete(result.content, result.usage);
          return;
        }

        // 没有工具调用，直接输出文本
        if (result.content) {
          callbacks.onToken(result.content);
        }
        callbacks.onComplete(result.content, result.usage);
        return;
      }

      // 没有工具定义时，尝试流式输出
      const body: any = {
        model: options.model || DEFAULT_MODEL,
        messages: cleanMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || 4096,
        stream: true,
      };

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        callbacks.onError(new Error(`LLM API 错误: ${response.status} - ${error}`));
        return;
      }

      // 解析 SSE 响应
      const text = await response.text();
      let fullContent = '';
      let usage: any = null;
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              callbacks.onToken(delta.content);
            }
            if (parsed.usage) usage = parsed.usage;
          } catch {}
        }
      }

      callbacks.onComplete(fullContent, usage);
    } catch (error) {
      callbacks.onError(error as Error);
    }
  }
}

export const llm = new LLMService();
