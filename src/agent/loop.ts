/**
 * Agent Loop - 核心引擎
 * 流式输出 + 工具调用 + 上下文压缩
 */

import { createInterface } from 'readline';
import type {
  LLMProvider, Message, ContentBlock, ChatOptions,
  ToolCall, ToolResult, StreamEvent, AgentConfig,
} from '../types.js';
import { getToolDefs, getTool } from '../tools/index.js';
import { estimateTokens } from './compact.js';

const SYSTEM_PROMPT = `你是 GovPM Copilot（政府项目助手），帮助用户完成政府项目申报、政策查询、材料撰写等工作。

你的能力：
- 联网搜索最新的政府政策、通知、公告（已内置联网搜索，可直接回答实时问题）
- 读写文件，生成申报材料
- 分析政策要求，匹配企业资质

工作原则：
1. 回答准确、专业，引用具体政策条款和文号
2. 搜索政策时优先引用 gov.cn（中国政府网）和各部委官网
3. 需要写入文件时会先征求用户同意
4. 如果不确定，明确告知并建议用户核实
5. 使用中文回复`;

const DEFAULT_CONFIG: Required<AgentConfig> = {
  maxTurns: 20,
  maxContextTokens: 100000,
  compactThreshold: 60000,
  stream: true,
};

export class AgentLoop {
  private provider: LLMProvider;
  private messages: Message[] = [];
  private config: Required<AgentConfig>;
  private aborted = false;
  private turnCount = 0;

  constructor(provider: LLMProvider, config?: AgentConfig) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 获取当前消息历史（用于序列化） */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /** 加载历史消息 */
  loadMessages(messages: Message[]) {
    this.messages = [...messages];
  }

  /** 估算当前上下文 token 数 */
  contextTokenCount(): number {
    return estimateTokens(JSON.stringify(this.messages)) + 500; // + system prompt
  }

  /** 执行一轮用户对话 */
  async run(userInput: string, signal?: AbortSignal): Promise<void> {
    this.aborted = false;
    this.turnCount = 0;
    this.messages.push({ role: 'user', content: userInput });

    await this.loop(signal);
  }

  /** 核心循环 */
  private async loop(signal?: AbortSignal): Promise<void> {
    while (this.turnCount < this.config.maxTurns && !this.aborted) {
      this.turnCount++;

      // 检查上下文压缩
      if (this.contextTokenCount() > this.config.compactThreshold) {
        await this.compact();
      }

      const toolDefs = getToolDefs();
      const options: ChatOptions = {
        maxTokens: 8192,
        systemPrompt: SYSTEM_PROMPT,
        tools: toolDefs,
        enableSearch: true,  // 默认开启百炼联网搜索
      };

      if (this.config.stream) {
        await this.streamTurn(options, signal);
      } else {
        await this.syncTurn(options);
      }

      // 检查是否有工具调用（最后一个 assistant 消息）
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg?.role !== 'assistant') break;

      const content = typeof lastMsg.content === 'string' ? [] : lastMsg.content;
      const hasToolUse = content.some((b: ContentBlock) => b.type === 'tool_use');
      if (!hasToolUse) break;

      // 执行工具调用
      await this.executeTools(content, signal);
    }
  }

  /** 流式处理一轮 */
  private async streamTurn(options: ChatOptions, signal?: AbortSignal): Promise<void> {
    const toolCalls = new Map<string, { name: string; inputParts: string[] }>();
    let textParts: string[] = [];

    try {
      const stream = this.provider.chatStream(this.messages, options);

      for await (const event of stream) {
        if (this.aborted || signal?.aborted) {
          this.aborted = true;
          process.stdout.write('\n');
          return;
        }

        switch (event.type) {
          case 'text':
            process.stdout.write(event.text || '');
            textParts.push(event.text || '');
            break;

          case 'tool_use_start':
            toolCalls.set(event.toolId || `tool_${Date.now()}`, { name: event.toolName || '', inputParts: [] });
            break;

          case 'tool_use_delta': {
            const tid = event.toolId;
            if (tid && toolCalls.has(tid) && event.inputJson) {
              toolCalls.get(tid)!.inputParts.push(event.inputJson);
            } else if (event.inputJson) {
              // fallback: 追加到最后一个活跃工具
              const keys = [...toolCalls.keys()];
              if (keys.length > 0) toolCalls.get(keys[keys.length - 1])!.inputParts.push(event.inputJson);
            }
            break;
          }

          case 'tool_use_end':
            // tool_use_end - 工具调用完成，状态已在 toolCalls map 中
            break;

          case 'message_end':
            // 流结束
            break;
        }
      }

      // 构建助手消息
      const content: ContentBlock[] = [];
      if (textParts.length > 0) {
        content.push({ type: 'text', text: textParts.join('') });
      }
      for (const [id, tc] of toolCalls) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(tc.inputParts.join(''));
        } catch {
          parsed = { raw_input: tc.inputParts.join('') };
        }
        content.push({ type: 'tool_use', id, name: tc.name, input: parsed });
      }

      this.messages.push({ role: 'assistant', content });

    } catch (err: any) {
      if (err.name === 'AbortError' || this.aborted) {
        process.stdout.write('\n[已中断]\n');
        return;
      }
      process.stdout.write(`\n[错误: ${err.message}]\n`);
      this.messages.push({ role: 'assistant', content: [{ type: 'text', text: `发生错误: ${err.message}` }] });
    }
  }

  /** 非流式处理一轮（备用） */
  private async syncTurn(options: ChatOptions): Promise<void> {
    const response = await this.provider.chat(this.messages, options);
    this.messages.push({ role: 'assistant', content: response.content });

    // 输出文本
    for (const block of response.content) {
      if (block.type === 'text') {
        process.stdout.write(block.text + '\n');
      }
    }
  }

  /** 执行工具调用 */
  private async executeTools(blocks: ContentBlock[], signal?: AbortSignal): Promise<void> {
    const toolResults: ContentBlock[] = [];

    for (const block of blocks) {
      if (block.type !== 'tool_use' || !block.id) continue;

      const tool = getTool(block.name);
      if (!tool) {
        toolResults.push({ type: 'tool_result', id: block.id, output: `未知工具: ${block.name}` });
        continue;
      }

      // 权限检查
      if (tool.permission === 'confirm') {
        process.stdout.write(`\n⚠️  需要确认执行工具: ${block.name}\n`);
        process.stdout.write(`输入参数: ${JSON.stringify(block.input, null, 2)}\n`);
        process.stdout.write(`确认执行? [y/N] `);

        const confirmed = await new Promise<boolean>((resolve) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question('', (answer: string) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y');
          });
        });

        if (!confirmed) {
          toolResults.push({ type: 'tool_result', id: block.id, output: '用户取消了操作' });
          continue;
        }
      }

      process.stdout.write(`\n🔧 执行工具: ${block.name}...\n`);

      try {
        const result = await tool.execute(block.input as Record<string, unknown>, {
          dataDir: process.cwd(),
          workDir: process.cwd(),
        });
        toolResults.push({ type: 'tool_result', id: block.id, output: result });

        // 截断过长结果
        const displayResult = result.length > 3000 ? result.slice(0, 3000) + '\n... [结果过长已截断]' : result;
        process.stdout.write(`✅ ${block.name} 完成\n`);
      } catch (err: any) {
        toolResults.push({ type: 'tool_result', id: block.id, output: `执行失败: ${err.message}` });
        process.stdout.write(`❌ ${block.name} 失败: ${err.message}\n`);
      }

      if (signal?.aborted) {
        this.aborted = true;
        break;
      }
    }

    // 将工具结果作为用户消息发送
    this.messages.push({ role: 'user', content: toolResults });
  }

  /** 上下文压缩 */
  private async compact(): Promise<void> {
    const keepCount = 6; // 保留最近 6 条消息
    if (this.messages.length <= keepCount + 2) return; // 没什么可压缩的

    const oldMessages = this.messages.slice(0, this.messages.length - keepCount);
    const recentMessages = this.messages.slice(this.messages.length - keepCount);

    // 简单压缩：把老消息拼成摘要文本
    const summary = oldMessages
      .map(m => {
        const content = typeof m.content === 'string' ? m.content :
          (m.content as ContentBlock[]).map(b => b.type === 'text' ? b.text : `[${b.type}]`).join('');
        const truncated = (content || '').slice(0, 200);
        return `${m.role}: ${truncated}`;
      })
      .join('\n');

    this.messages = [
      { role: 'user', content: `[历史对话摘要，共 ${oldMessages.length} 条消息]:\n${summary}` },
      { role: 'assistant', content: [{ type: 'text', text: '好的，我已了解历史上下文。请继续。' }] },
      ...recentMessages,
    ];

    process.stdout.write(`\n📦 上下文已压缩（${oldMessages.length} → 摘要）\n`);
  }
}
