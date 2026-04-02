/**
 * 阿里百炼（DashScope）LLM Provider
 * 使用 OpenAI 兼容协议接入
 */

import type { LLMProvider, Message, ChatOptions, ChatResponse, StreamEvent, ContentBlock } from '../types.js';

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

  private convertMessages(messages: Message[]): object[] {
    const result: object[] = [];
    for (const m of messages) {
      if (typeof m.content === 'string') {
        result.push({ role: m.role, content: m.content });
        continue;
      }
      // 处理 content blocks
      const blocks = m.content as ContentBlock[];
      const textParts = blocks.filter(b => b.type === 'text').map(b => b.text || '');
      const toolResults = blocks.filter(b => b.type === 'tool_result');
      const toolUses = blocks.filter(b => b.type === 'tool_use');

      // 如果有 tool_result，按 OpenAI 协议拆分为多条 tool 消息
      if (toolResults.length > 0) {
        // 先输出文本部分（如果有）
        if (textParts.join('').trim()) {
          result.push({ role: 'user', content: textParts.join('') });
        }
        // 每个 tool_result 作为单独的 tool message
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.id,
            content: tr.output || '',
          });
        }
        continue;
      }

      // tool_use 消息 (assistant role)
      if (toolUses.length > 0) {
        const parts: object[] = [];
        if (textParts.join('').trim()) {
          parts.push({ type: 'text', text: textParts.join('') });
        }
        for (const tu of toolUses) {
          parts.push({
            type: 'tool_calls',
            id: tu.id,
            function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) },
          });
        }
        result.push({ role: 'assistant', content: parts.length === 1 && !('type' in parts[0] && (parts[0] as any).type === 'text') ? parts : parts });
        // 简化：assistant 的 tool_calls 要放在 message 级别
        result.pop();
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

      // 普通混合消息
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

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

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

    // 处理 tool_calls
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

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

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

    // 追踪工具调用状态，用于在结束前发 tool_use_end
    const activeToolIds = new Map<number, { id: string; name: string }>();

    while (true) {
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
          // 发出所有未结束的工具调用的 end 事件
          for (const [idx, tc] of activeToolIds) {
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

          // 文本内容
          if (delta.content && typeof delta.content === 'string') {
            yield { type: 'text', text: delta.content };
          }

          // 工具调用
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
              const idx = tc.index as number;
              const fn = tc.function as Record<string, unknown> | undefined;

              // 新工具调用开始（有 id 就说明是新工具）
              if (tc.id && !activeToolIds.has(idx)) {
                activeToolIds.set(idx, { id: tc.id as string, name: (fn?.name as string) || '' });
                yield { type: 'tool_use_start', toolId: tc.id as string, toolName: fn?.name as string };
              }

              // 工具参数增量
              if (fn?.arguments && typeof fn.arguments === 'string') {
                yield { type: 'tool_use_delta', toolId: activeToolIds.get(idx)?.id, inputJson: fn.arguments };
              }
            }
          }

          // finish_reason 表示当前 chunk 是最后一块
          const finishReason = choice.finish_reason as string | undefined;
          if (finishReason) {
            // 发出所有工具调用的 end 事件
            for (const [idx, tc] of activeToolIds) {
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
  }
}
