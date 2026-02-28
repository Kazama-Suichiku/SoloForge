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
 * 清理消息历史，移除无效的 tool 消息
 * DeepSeek API 要求 tool 消息必须紧跟在有 tool_calls 的 assistant 消息之后
 */
function sanitizeMessages(messages: Message[]): Message[] {
  const result: Message[] = [];
  
  for (const msg of messages) {
    // 直接丢弃所有 tool 角色的消息
    if (msg.role === 'tool') {
      continue;
    }
    
    // assistant 消息：移除 tool_calls，只保留文本内容
    if (msg.role === 'assistant') {
      result.push({
        role: 'assistant',
        content: msg.content || '(无内容)',
      });
      continue;
    }
    
    // user 和 system 消息直接保留
    if (msg.content || msg.role === 'system') {
      result.push({
        role: msg.role,
        content: msg.content || '',
      });
    }
  }
  
  return result;
}

class LLMService {
  private apiKey: string | null = null;

  async initialize(): Promise<void> {
    this.apiKey = await storage.getApiKey();
    // 如果没有设置，使用内置 Key
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

  async chat(
    messages: Message[],
    options: ChatOptions = {}
  ): Promise<{ content: string; toolCalls?: any[]; usage?: any }> {
    if (!this.apiKey) {
      throw new Error('API Key 未设置');
    }

    // 清理消息历史，移除无效的 tool 消息
    const cleanMessages = sanitizeMessages(messages);

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        messages: cleanMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || 4096,
        tools: options.tools,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API 错误: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || '',
      toolCalls: choice?.message?.tool_calls,
      usage: data.usage,
    };
  }

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
      // 清理消息历史，移除无效的 tool 消息
      const cleanMessages = sanitizeMessages(messages);

      // React Native 不支持 ReadableStream，使用非流式请求模拟
      // 先尝试流式，如果不支持则降级
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model || DEFAULT_MODEL,
          messages: cleanMessages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens || 4096,
          tools: options.tools,
          stream: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        callbacks.onError(new Error(`LLM API 错误: ${response.status} - ${error}`));
        return;
      }

      // React Native fetch 可能不支持 getReader()
      // 尝试使用 getReader，如果失败则读取整个响应
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      try {
        reader = response.body?.getReader() || null;
      } catch (e) {
        reader = null;
      }

      if (!reader) {
        // 降级：读取整个响应并解析 SSE
        const text = await response.text();
        let fullContent = '';
        let toolCalls: any[] = [];
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

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (tc.index !== undefined) {
                    if (!toolCalls[tc.index]) {
                      toolCalls[tc.index] = {
                        id: tc.id,
                        type: tc.type,
                        function: { name: '', arguments: '' },
                      };
                    }
                    if (tc.function?.name) {
                      toolCalls[tc.index].function.name = tc.function.name;
                    }
                    if (tc.function?.arguments) {
                      toolCalls[tc.index].function.arguments += tc.function.arguments;
                    }
                  }
                }
              }

              if (parsed.usage) {
                usage = parsed.usage;
              }
            } catch {
              // 忽略解析错误
            }
          }
        }

        if (toolCalls.length > 0 && callbacks.onToolCall) {
          for (const tc of toolCalls) {
            callbacks.onToolCall(tc);
          }
        }

        callbacks.onComplete(fullContent, usage);
        return;
      }

      // 如果支持 getReader，使用流式处理
      const decoder = new TextDecoder();
      let fullContent = '';
      let toolCalls: any[] = [];
      let usage: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

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

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (tc.index !== undefined) {
                    if (!toolCalls[tc.index]) {
                      toolCalls[tc.index] = {
                        id: tc.id,
                        type: tc.type,
                        function: { name: '', arguments: '' },
                      };
                    }
                    if (tc.function?.name) {
                      toolCalls[tc.index].function.name = tc.function.name;
                    }
                    if (tc.function?.arguments) {
                      toolCalls[tc.index].function.arguments += tc.function.arguments;
                    }
                  }
                }
              }

              if (parsed.usage) {
                usage = parsed.usage;
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      // 处理工具调用
      if (toolCalls.length > 0 && callbacks.onToolCall) {
        for (const tc of toolCalls) {
          callbacks.onToolCall(tc);
        }
      }

      callbacks.onComplete(fullContent, usage);
    } catch (error) {
      callbacks.onError(error as Error);
    }
  }
}

export const llm = new LLMService();
