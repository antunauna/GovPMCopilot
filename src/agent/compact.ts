/**
 * 上下文压缩 - Token 估算 + LLM 摘要式压缩
 *
 * 三级压缩策略（借鉴 Claude Code compact.ts）：
 * 1. 首尾保留：保留最近 N 条完整消息，中间消息提取摘要
 * 2. 结构化提取：工具调用保留关键信息（工具名、文件路径、结果摘要）
 * 3. LLM 摘要：调用 LLM 生成结构化摘要（降级为本地提取如果 LLM 不可用）
 */

import type { Message, ContentBlock, LLMProvider } from '../types.js';

/** 粗略估算 token 数（中文约 1.5 字符/token，英文约 4 字符/token） */
export function estimateTokens(text: string): number {
  let cnChars = 0;
  let enChars = 0;

  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code > 0x4e00 && code < 0x9fff) {
      cnChars++;
    } else if (code >= 32 && code < 127) {
      enChars++;
    } else {
      enChars += 2;
    }
  }

  return Math.ceil(cnChars / 1.5 + enChars / 4);
}

/** 估算消息列表的 token 数 */
export function estimateMessagesTokens(messages: Message[], systemPrompt = ''): number {
  let total = estimateTokens(systemPrompt);
  for (const m of messages) {
    total += estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
    total += 10; // 消息开销
  }
  return total;
}

/**
 * 本地摘要提取（不调用 LLM）
 * 对每条消息提取关键信息，保留结构
 */
function extractLocalSummary(messages: Message[]): string {
  const summaries: string[] = [];

  for (const m of messages) {
    if (typeof m.content === 'string') {
      // 用户/助手纯文本消息：截取前 150 字符
      summaries.push(`[${m.role}] ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}`);
    } else {
      const blocks = m.content as ContentBlock[];
      const parts: string[] = [];

      for (const b of blocks) {
        if (b.type === 'text' && b.text) {
          parts.push(b.text.slice(0, 100));
        } else if (b.type === 'tool_use') {
          const inputStr = JSON.stringify(b.input || {});
          parts.push(`[调用工具 ${b.name}] 参数: ${inputStr.slice(0, 80)}`);
        } else if (b.type === 'tool_result') {
          const outputStr = (b.output || '').slice(0, 80);
          parts.push(`[工具结果] ${outputStr}...`);
        }
      }

      summaries.push(`[${m.role}] ${parts.join(' | ')}`);
    }
  }

  return summaries.join('\n');
}

/**
 * LLM 摘要式压缩（可选）
 * 调用便宜模型生成结构化摘要
 * 如果失败则降级为本地摘要
 */
async function llmCompact(
  messages: Message[],
  provider: LLMProvider | undefined,
): Promise<string> {
  if (!provider) {
    return extractLocalSummary(messages);
  }

  const conversationText = messages
    .map(m => {
      const content = typeof m.content === 'string' ? m.content :
        (m.content as ContentBlock[]).map(b => {
          if (b.type === 'text') return b.text;
          if (b.type === 'tool_use') return `[调用工具: ${b.name}(${JSON.stringify(b.input || {}).slice(0, 50)})]`;
          if (b.type === 'tool_result') return `[工具结果: ${(b.output || '').slice(0, 50)}]`;
          return `[${b.type}]`;
        }).join('\n');
      return `${m.role}: ${content}`;
    })
    .join('\n\n');

  try {
    const response = await provider.chat(
      [{
        role: 'user',
        content: `请将以下对话历史压缩为结构化摘要，保留：
1. 用户的核心需求和关注点
2. 已完成的操作和结果（工具调用、文件读写等关键事实）
3. 当前进展和待处理事项
4. 重要的政策文号、企业名称等具体信息

原始对话：
${conversationText}

请用简洁的中文输出摘要，不超过 500 字：`,
      }],
      {
        maxTokens: 1024,
        temperature: 0,
        systemPrompt: '你是一个对话摘要工具。只输出摘要内容，不要输出其他内容。',
      },
    );

    const text = response.content.find(b => b.type === 'text')?.text;
    if (text) return text;
  } catch (err: any) {
    // LLM 压缩失败，降级为本地
    process.stderr.write(`\n  ⚠️ LLM 压缩失败，使用本地摘要: ${err.message}\n`);
  }

  return extractLocalSummary(messages);
}

/** 压缩结果 */
export interface CompactResult {
  compressed: boolean;
  originalCount: number;
  removedCount: number;
  summaryMethod: 'local' | 'llm';
}

/**
 * 执行上下文压缩
 * @param messages 当前消息列表
 * @param keepCount 保留最近 N 条消息
 * @param provider LLM Provider（用于摘要压缩，可为 undefined）
 * @param consecutiveFailures 连续失败次数（用于熔断）
 * @returns { messages, result }
 */
export async function compactMessages(
  messages: Message[],
  keepCount: number,
  provider: LLMProvider | undefined,
  consecutiveFailures: number,
): Promise<{ messages: Message[]; result: CompactResult }> {
  if (messages.length <= keepCount + 2) {
    return { messages, result: { compressed: false, originalCount: messages.length, removedCount: 0, summaryMethod: 'local' } };
  }

  const oldMessages = messages.slice(0, messages.length - keepCount);
  const recentMessages = messages.slice(messages.length - keepCount);

  // 熔断：连续失败 3 次以上只做本地压缩
  let summaryMethod: 'local' | 'llm' = 'local';
  let summary: string;

  if (provider && consecutiveFailures < 3) {
    summary = await llmCompact(oldMessages, provider);
    summaryMethod = 'llm';
  } else {
    summary = extractLocalSummary(oldMessages);
  }

  const compacted: Message[] = [
    {
      role: 'user',
      content: `[历史对话摘要，共 ${oldMessages.length} 条消息，使用${summaryMethod === 'llm' ? 'AI' : '本地'}压缩]:\n${summary}`,
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: '好的，我已了解历史上下文。请继续。' }],
    },
    ...recentMessages,
  ];

  return {
    messages: compacted,
    result: { compressed: true, originalCount: messages.length, removedCount: oldMessages.length, summaryMethod },
  };
}
