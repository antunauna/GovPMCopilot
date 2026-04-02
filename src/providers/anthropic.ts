/**
 * Anthropic LLM Provider
 * 支持流式/非流式 + 工具调用
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, Message, ChatOptions, ChatResponse, StreamEvent, ToolDef } from '../types.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'Anthropic';
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.model = model || 'claude-sonnet-4-20250514';
    this.client = new Anthropic({ apiKey, baseURL: baseUrl });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const resp = await this.client.messages.create({
      model: options?.model || this.model,
      max_tokens: options?.maxTokens || 8192,
      temperature: options?.temperature ?? 0.7,
      system: options?.systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })) as Anthropic.MessageParam[],
      tools: options?.tools?.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
    });

    return {
      content: resp.content.map(block => {
        if (block.type === 'text') return { type: 'text' as const, text: block.text };
        if (block.type === 'tool_use') return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
        return { type: 'text' as const, text: '' };
      }),
      stopReason: resp.stop_reason === 'tool_use' ? 'tool_use' : resp.stop_reason as 'end_turn' | 'max_tokens',
      usage: { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens },
      model: resp.model,
    };
  }

  async *chatStream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamEvent> {
    const stream = this.client.messages.stream({
      model: options?.model || this.model,
      max_tokens: options?.maxTokens || 8192,
      temperature: options?.temperature ?? 0.7,
      system: options?.systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })) as Anthropic.MessageParam[],
      tools: options?.tools?.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
    });

    const currentToolCalls = new Map<string, { name: string; inputParts: string[] }>();

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'text') {
          // 文本块开始，不需要特殊处理
        } else if (event.content_block.type === 'tool_use') {
          currentToolCalls.set(event.content_block.id, {
            name: event.content_block.name,
            inputParts: [],
          });
          yield { type: 'tool_use_start', toolId: event.content_block.id, toolName: event.content_block.name };
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          // 累积 tool input JSON delta
          if (event.index !== undefined) {
            const block = stream.currentMessage?.content[event.index];
            if (block && block.type === 'tool_use') {
              const tc = currentToolCalls.get(block.id);
              if (tc) tc.inputParts.push(event.delta.partial_json);
            }
          }
          yield { type: 'tool_use_delta', inputJson: event.delta.partial_json };
        }
      } else if (event.type === 'content_block_stop') {
        // 文本块或工具块结束
      } else if (event.type === 'message_delta') {
        if (event.delta.stop_reason) {
          yield { type: 'message_end', stopReason: event.delta.stop_reason };
        }
        if (event.usage) {
          yield { type: 'message_end', usage: { inputTokens: stream.currentMessage?.usage.input_tokens ?? 0, outputTokens: event.usage.output_tokens } };
        }
      }
    }

    // 输出完整的 tool_use_end 事件
    for (const [id, tc] of currentToolCalls) {
      yield { type: 'tool_use_end', toolId: id, toolName: tc.name, inputJson: tc.inputParts.join('') };
    }
  }
}
