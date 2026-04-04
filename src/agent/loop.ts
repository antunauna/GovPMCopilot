/**
 * Agent Loop - 核心引擎 v0.4
 *
 * v0.4 改进：
 * - LLM 调用自动重试（指数退避，最多 3 次）
 * - Token 使用量持久化到 ~/.govpm/cost-tracker.json
 * - v0.3 保留：
 *   - Ctrl+C / Escape 中断（AbortController + SIGINT）
 *   - Markdown 终端渲染
 *   - 工具调用可视化（Spinner + 参数摘要 + 结果预览）
 *   - API 错误重试 + 请求中断信号传播
 *   - 工具执行超时
 *   - LLM 摘要式上下文压缩（含熔断）
 *   - Token/成本追踪
 *   - System Prompt 动态化（支持外部文件）
 */

import { createInterface } from 'readline';
import { readFileSync, existsSync } from 'fs';
import type {
  LLMProvider, Message, ContentBlock, ChatOptions,
  AgentConfig, TokenUsage,
} from '../types.js';
import { getToolDefs, getTool } from '../tools/index.js';
import { estimateMessagesTokens, compactMessages } from './compact.js';
import { renderMarkdownToTerminal, colors, Spinner, withTimeout } from '../utils/index.js';
import { recordUsage } from '../utils/session.js';

/** LLM 调用重试配置 */
const LLM_RETRY_CONFIG = {
  maxRetries: 2,       // 最大重试次数（不含首次）
  baseDelay: 2000,     // 首次重试延迟（ms）
  maxDelay: 10000,     // 最大延迟
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'socket hang up', 'overloaded', 'rate limit', '503', '502'],
};

/** 延迟函数 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 判断错误是否可重试 */
function isRetryableError(err: any): boolean {
  const msg = (err?.message || '').toLowerCase();
  return LLM_RETRY_CONFIG.retryableErrors.some(e => msg.includes(e.toLowerCase()));
}

const DEFAULT_SYSTEM_PROMPT = `你是 GovPM Copilot（政府项目助手），帮助用户完成政府项目申报、政策查询、材料撰写等工作。

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
  systemPromptFile: undefined as unknown as string, // 占位，实际由 constructor 处理
};

export class AgentLoop {
  private provider: LLMProvider;
  private messages: Message[] = [];
  private config: Required<AgentConfig>;
  private aborted = false;
  private turnCount = 0;
  private systemPrompt: string;
  private consecutiveCompactFailures = 0;
  private tokenUsage: TokenUsage = { totalInput: 0, totalOutput: 0, requestCount: 0 };
  private currentAbortController: AbortController | null = null;

  constructor(provider: LLMProvider, config?: AgentConfig) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.systemPrompt = this.loadSystemPrompt(config?.systemPromptFile);
  }

  /** 加载 System Prompt（外部文件 > 内置默认） */
  private loadSystemPrompt(filePath?: string): string {
    if (filePath && existsSync(filePath)) {
      try {
        return readFileSync(filePath, 'utf-8').trim();
      } catch {
        return DEFAULT_SYSTEM_PROMPT;
      }
    }
    return DEFAULT_SYSTEM_PROMPT;
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
    return estimateMessagesTokens(this.messages, this.systemPrompt);
  }

  /** 获取 token 使用统计 */
  getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage };
  }

  /** 获取 Provider */
  getProvider(): LLMProvider {
    return this.provider;
  }

  /** 动态切换 Provider */
  setProvider(provider: LLMProvider) {
    this.provider = provider;
  }

  /** 设置 System Prompt（从字符串） */
  setSystemPrompt(prompt: string) {
    this.systemPrompt = prompt;
  }

  /** 创建新的 AbortController（用于中断当前请求） */
  abort(): void {
    this.aborted = true;
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
  }

  /** 执行一轮用户对话 */
  async run(userInput: string, signal?: AbortSignal): Promise<void> {
    this.aborted = false;
    this.turnCount = 0;
    this.currentAbortController = new AbortController();

    // 链接外部 signal
    if (signal) {
      signal.addEventListener('abort', () => this.abort(), { once: true });
    }

    this.messages.push({ role: 'user', content: userInput });

    try {
      await this.loop(this.currentAbortController.signal);
    } finally {
      this.currentAbortController = null;
    }
  }

  /** 核心循环 */
  private async loop(signal: AbortSignal): Promise<void> {
    while (this.turnCount < this.config.maxTurns && !this.aborted) {
      this.turnCount++;

      // 检查上下文压缩
      const estimatedTokens = this.contextTokenCount();
      if (estimatedTokens > this.config.compactThreshold) {
        await this.compact();
      }

      const toolDefs = getToolDefs();
      const options: ChatOptions = {
        maxTokens: 8192,
        systemPrompt: this.systemPrompt,
        tools: toolDefs,
        enableSearch: true,
        signal,
      };

      if (this.config.stream) {
        await this.streamWithRetry(options, signal);
      } else {
        await this.syncWithRetry(options);
      }

      if (this.aborted) return;

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

  /** 带重试的 LLM 流式调用 */
  private async streamWithRetry(options: ChatOptions, signal: AbortSignal): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= LLM_RETRY_CONFIG.maxRetries; attempt++) {
      if (this.aborted || signal.aborted) return;

      try {
        await this.streamTurn(options, signal);
        return; // 成功
      } catch (err: any) {
        lastError = err;
        if (err.name === 'AbortError' || this.aborted) return;
        if (!isRetryableError(err) || attempt >= LLM_RETRY_CONFIG.maxRetries) throw err;

        const delay = Math.min(LLM_RETRY_CONFIG.baseDelay * Math.pow(2, attempt), LLM_RETRY_CONFIG.maxDelay);
        process.stderr.write(`\n  ⚠️ LLM 调用失败，${delay / 1000}s 后重试 (${attempt + 1}/${LLM_RETRY_CONFIG.maxRetries}): ${err.message}\n`);
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /** 带重试的 LLM 非流式调用 */
  private async syncWithRetry(options: ChatOptions): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= LLM_RETRY_CONFIG.maxRetries; attempt++) {
      if (this.aborted) return;

      try {
        await this.syncTurn(options);
        return; // 成功
      } catch (err: any) {
        lastError = err;
        if (err.name === 'AbortError' || this.aborted) return;
        if (!isRetryableError(err) || attempt >= LLM_RETRY_CONFIG.maxRetries) throw err;

        const delay = Math.min(LLM_RETRY_CONFIG.baseDelay * Math.pow(2, attempt), LLM_RETRY_CONFIG.maxDelay);
        process.stderr.write(`\n  ⚠️ LLM 调用失败，${delay / 1000}s 后重试 (${attempt + 1}/${LLM_RETRY_CONFIG.maxRetries}): ${err.message}\n`);
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /** 流式处理一轮 */
  private async streamTurn(options: ChatOptions, signal: AbortSignal): Promise<void> {
    const toolCalls = new Map<string, { name: string; inputParts: string[] }>();
    let textParts: string[] = [];
    let lastUsage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      const stream = this.provider.chatStream(this.messages, options);

      for await (const event of stream) {
        if (this.aborted || signal.aborted) {
          this.aborted = true;
          // 如果有累积文本，先渲染
          if (textParts.length > 0) {
            process.stdout.write('\n');
          } else {
            process.stdout.write('\n');
          }
          process.stdout.write(`${colors.yellow}⏹ 已中断${colors.reset}\n`);
          return;
        }

        switch (event.type) {
          case 'text':
            // 流式累积文本，最后一口气渲染
            textParts.push(event.text || '');
            break;

          case 'tool_use_start':
            // 先把累积的文本渲染出来
            if (textParts.length > 0) {
              process.stdout.write('\n' + renderMarkdownToTerminal(textParts.join('')) + '\n');
              textParts = [];
            }
            toolCalls.set(event.toolId || `tool_${Date.now()}`, { name: event.toolName || '', inputParts: [] });
            break;

          case 'tool_use_delta': {
            const tid = event.toolId;
            if (tid && toolCalls.has(tid) && event.inputJson) {
              toolCalls.get(tid)!.inputParts.push(event.inputJson);
            } else if (event.inputJson) {
              const keys = [...toolCalls.keys()];
              if (keys.length > 0) toolCalls.get(keys[keys.length - 1])!.inputParts.push(event.inputJson);
            }
            break;
          }

          case 'tool_use_end':
            break;

          case 'message_end':
            if (event.usage) {
              lastUsage = event.usage;
            }
            break;

          case 'error':
            process.stdout.write(`\n${colors.red}❌ 错误: ${event.error}${colors.reset}\n`);
            this.messages.push({
              role: 'assistant',
              content: [{ type: 'text', text: `发生错误: ${event.error}` }],
            });
            return;
        }
      }

      // 渲染最后累积的文本
      if (textParts.length > 0) {
        process.stdout.write('\n' + renderMarkdownToTerminal(textParts.join('')) + '\n');
      }

      // 记录 token 使用量
      if (lastUsage) {
        this.tokenUsage.totalInput += lastUsage.inputTokens;
        this.tokenUsage.totalOutput += lastUsage.outputTokens;
        this.tokenUsage.requestCount++;
        // 持久化到磁盘
        recordUsage(lastUsage.inputTokens, lastUsage.outputTokens, this.provider.name, this.provider.model);
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

      if (content.length > 0) {
        this.messages.push({ role: 'assistant', content });
      }

    } catch (err: any) {
      if (err.name === 'AbortError' || this.aborted) {
        if (textParts.length > 0) {
          process.stdout.write('\n' + renderMarkdownToTerminal(textParts.join('')) + '\n');
        }
        process.stdout.write(`${colors.yellow}⏹ 已中断${colors.reset}\n`);
        return;
      }
      process.stdout.write(`\n${colors.red}❌ 错误: ${err.message}${colors.reset}\n`);
      this.messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: `发生错误: ${err.message}` }],
      });
      this.consecutiveCompactFailures++;
    }
  }

  /** 非流式处理一轮（备用） */
  private async syncTurn(options: ChatOptions): Promise<void> {
    const response = await this.provider.chat(this.messages, options);
    this.messages.push({ role: 'assistant', content: response.content });

    // 记录 token
    this.tokenUsage.totalInput += response.usage.inputTokens;
    this.tokenUsage.totalOutput += response.usage.outputTokens;
    this.tokenUsage.requestCount++;
    // 持久化到磁盘
    recordUsage(response.usage.inputTokens, response.usage.outputTokens, this.provider.name, this.provider.model);

    for (const block of response.content) {
      if (block.type === 'text') {
        process.stdout.write('\n' + renderMarkdownToTerminal(block.text || '') + '\n');
      }
    }
  }

  /** 执行工具调用（带超时 + 可视化） */
  private async executeTools(blocks: ContentBlock[], signal: AbortSignal): Promise<void> {
    const toolResults: ContentBlock[] = [];

    for (const block of blocks) {
      if (block.type !== 'tool_use' || !block.id) continue;
      if (this.aborted || signal.aborted) {
        this.aborted = true;
        break;
      }

      const tool = getTool(block.name || '');
      if (!tool) {
        toolResults.push({ type: 'tool_result', id: block.id, output: `未知工具: ${block.name}` });
        continue;
      }

      // 构建工具调用的参数摘要
      const inputStr = JSON.stringify(block.input || {});
      const paramSummary = inputStr.length > 100 ? inputStr.slice(0, 100) + '...' : inputStr;

      // 权限检查
      if (tool.permission === 'confirm') {
        process.stdout.write(`\n${colors.yellow}⚠️  需要确认执行工具: ${colors.bold}${block.name}${colors.reset}\n`);
        process.stdout.write(`${colors.dim}参数: ${paramSummary}${colors.reset}\n`);
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
          process.stdout.write(`${colors.dim}已取消${colors.reset}\n`);
          continue;
        }
      }

      // 启动 Spinner
      const spinner = new Spinner(`${block.name}(${paramSummary})`);
      spinner.start();

      try {
        const timeout = tool.timeout || 30000;
        const result = await withTimeout(
          tool.execute(block.input as Record<string, unknown>, {
            dataDir: process.cwd(),
            workDir: process.cwd(),
          }),
          timeout,
        );

        toolResults.push({ type: 'tool_result', id: block.id, output: result });

        // 结果预览
        spinner.stop(true);
        const preview = result.length > 200 ? result.slice(0, 200) + `\n${colors.dim}... (共 ${result.length} 字符)${colors.reset}` : result;
        process.stdout.write(`${colors.dim}  → ${preview.split('\n')[0]}${colors.reset}\n`);
      } catch (err: any) {
        const isTimeout = err.message?.includes('超时');
        toolResults.push({
          type: 'tool_result',
          id: block.id,
          output: isTimeout ? `执行超时（${tool.timeout || 30000}ms）` : `执行失败: ${err.message}`,
        });
        spinner.stop(false);
      }
    }

    // 将工具结果作为用户消息发送
    if (toolResults.length > 0) {
      this.messages.push({ role: 'user', content: toolResults });
    }
  }

  /** 上下文压缩（LLM 摘要式 + 熔断） */
  private async compact(): Promise<void> {
    const keepCount = 6;
    const result = await compactMessages(
      this.messages,
      keepCount,
      this.provider,
      this.consecutiveCompactFailures,
    );

    if (result.result.compressed) {
      this.messages = result.messages;
      this.consecutiveCompactFailures = 0;

      const method = result.result.summaryMethod === 'llm' ? 'AI 摘要' : '本地提取';
      process.stdout.write(
        `\n${colors.cyan}📦 上下文已压缩${colors.reset} (${result.result.originalCount} → ${result.result.originalCount - result.result.removedCount + 2} 条，${method})\n`,
      );
    }
  }
}
