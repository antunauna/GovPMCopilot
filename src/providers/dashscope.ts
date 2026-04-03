/**
 * 阿里百炼（DashScope）LLM Provider
 * 使用 OpenAI 兼容协议接入
 * 支持：流式/非流式、工具调用、错误重试、请求中断
 */

import type { LLMProvider, Message, ChatOptions, ChatResponse, StreamEvent, ContentBlock } from '../types.js';
import { fetchWithRetry } from '../utils/retry.js';

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export class DashScopeProvider implements LLMProvider {
  readonly name = 'DashScope';
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model || 'qwen-plus';
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  /**
   * 将内部 Message 格式转换为 OpenAI 兼容格式
   * 关键差异：
   * - tool_result → role:'tool' + tool_call_id
   * - tool_use → assistant 消息的 tool_calls 字段
   */
  private convertMessages(messages: Message[]): object[] {
    const result: object[] = [];
    for (const m of messages) {
      if (typeof m.content === 'string') {
        result.push({ role: m.role, content: m.content });
        continue;
      }

      const blocks = m.content as ContentBlock[];
      const textParts = blocks.filter(b => b.type === 'text').map(b => b.text || '');
      const toolResults = blocks.filter(b => b.type === 'tool_result');
      const toolUses = blocks.filter(b => b.type === 'tool_use');

      // tool_result 消息（来自用户反馈工具结果）
      if (toolResults.length > 0) {
        if (textParts.join('').trim()) {
          result.push({ role: 'user', content: textParts.join('') });
        }
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.id,
            content: tr.output || '',
          });
        }
        continue;
      }

      // tool_use 消息（来自助手发起工具调用）
      if (toolUses.length > 0) {
        result.push({
          role: 'assistant',
          content: textParts.join('') || null,
          tool_calls: toolUses.map(tu => ({
            id: tu.id,
            type: 'function',
            function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) },
          })),
        });
        continue;
      }

      // 普通混合消息（只有 text blocks）
      result.push({ role: m.role, content: textParts.join('') });
    }
    return result;
  }

  private convertTools(tools?: ChatOptions['tools']): object[] | undefined {
    return tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: options?.model || this.model,
      max_tokens: options?.maxTokens || 8192,
      temperature: options?.temperature ?? 0.7,
      messages: this.convertMessages(messages),
    };
    if (options?.systemPrompt) body.system = options.systemPrompt;
    if (options?.enableSearch) body.enable_search = true;
    const tools = this.convertTools(options?.tools);
    if (tools) body.tools = tools;

    const resp = await fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      },
    );

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`DashScope API error ${resp.status}: ${err}`);
    }

    const data = await resp.json() as Record<string, unknown>;
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    const msg = choice?.message as Record<string, unknown> | undefined;

    if (!msg) throw new Error('No response from DashScope');

    const content: ContentBlock[] = [];

    if (typeof msg.content === 'string') {
      content.push({ type: 'text', text: msg.content });
    }

    const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown>;
        content.push({
          type: 'tool_use',
          id: tc.id as string,
          name: fn.name as string,
          input: JSON.parse(fn.arguments as string),
        });
      }
    }

    const usage = data.usage as Record<string, unknown> | undefined;
    const finishReason = choice?.finish_reason as string | undefined;

    return {
      content,
      stopReason: finishReason === 'tool_calls' ? 'tool_use' : (finishReason === 'length' ? 'max_tokens' : 'end_turn'),
      usage: { inputTokens: (usage?.prompt_tokens as number) ?? 0, outputTokens: (usage?.completion_tokens as number) ?? 0 },
      model: (data.model as string) || this.model,
    };
  }

  async *chatStream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamEvent> {
    const body: Record<string, unknown> = {
      model: options?.model || this.model,
      max_tokens: options?.maxTokens || 8192,
      temperature: options?.temperature ?? 0.7,
      messages: this.convertMessages(messages),
      stream: true,
    };
    if (options?.systemPrompt) body.system = options.systemPrompt;
    if (options?.enableSearch) body.enable_search = true;
    const tools = this.convertTools(options?.tools);
    if (tools) body.tools = tools;

    const resp = await fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      },
    );

    if (!resp.ok) {
      const err = await resp.text();
      yield { type: 'error', error: `DashScope API error ${resp.status}: ${err}` };
      return;
    }

    if (!resp.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let ended = false;

    // 追踪工具调用状态
    const activeToolIds = new Map<number, { id: string; name: string }>();

    try {
      while (true) {
        if (options?.signal?.aborted) {
          yield { type: 'error', error: 'Request aborted' };
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            for (const [, tc] of activeToolIds) {
              yield { type: 'tool_use_end', toolId: tc.id, toolName: tc.name };
            }
            if (!ended) {
              yield { type: 'message_end', stopReason: 'end_turn' };
              ended = true;
            }
            return;
          }

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const choice = (parsed.choices as Array<Record<string, unknown>>)?.[0];
            if (!choice) continue;
            const delta = choice.delta as Record<string, unknown> | undefined;
            if (!delta) continue;

            if (delta.content && typeof delta.content === 'string') {
              yield { type: 'text', text: delta.content };
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
                const idx = tc.index as number;
                const fn = tc.function as Record<string, unknown> | undefined;

                if (tc.id && !activeToolIds.has(idx)) {
                  activeToolIds.set(idx, { id: tc.id as string, name: (fn?.name as string) || '' });
                  yield { type: 'tool_use_start', toolId: tc.id as string, toolName: fn?.name as string };
                }

                if (fn?.arguments && typeof fn.arguments === 'string') {
                  yield { type: 'tool_use_delta', toolId: activeToolIds.get(idx)?.id, inputJson: fn.arguments };
                }
              }
            }

            const finishReason = choice.finish_reason as string | undefined;
            if (finishReason) {
              for (const [, tc] of activeToolIds) {
                yield { type: 'tool_use_end', toolId: tc.id, toolName: tc.name };
              }
              if (!ended) {
                yield {
                  type: 'message_end',
                  stopReason: finishReason === 'tool_calls' ? 'tool_use' : String(finishReason),
                  usage: {
                    inputTokens: ((parsed.usage as Record<string, unknown>)?.prompt_tokens as number) ?? 0,
                    outputTokens: ((parsed.usage as Record<string, unknown>)?.completion_tokens as number) ?? 0,
                  },
                };
                ended = true;
              }
            }
          } catch {
            // 忽略解析错误的行
          }
        }
      }
    } finally {
      // 确保释放 reader
      reader.releaseLock();
    }
  }
}
