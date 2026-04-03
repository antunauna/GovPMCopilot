/**
 * 终端 Markdown 渲染
 * 使用 marked 解析 + 手动终端格式化（无需终端宽度检测）
 */

import { marked } from 'marked';

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

/** ANSI 颜色 */
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

/**
 * 将 Markdown 文本渲染为带 ANSI 颜色的终端输出
 * 流式友好的简化实现：逐行处理基本 Markdown 语法
 */
export function renderMarkdownToTerminal(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let inList = false;

  for (const line of lines) {
    // 代码块切换
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        output.push(`${C.gray}${'─'.repeat(40)}${C.reset}`);
      } else {
        inCodeBlock = true;
        output.push(`${C.gray}${'─'.repeat(40)}${C.reset}`);
      }
      continue;
    }

    if (inCodeBlock) {
      output.push(`${C.dim}${line}${C.reset}`);
      continue;
    }

    const trimmed = line.trim();

    // 空行
    if (!trimmed) {
      inList = false;
      continue;
    }

    // 标题
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2];
      const colors = [C.magenta, C.blue, C.cyan, C.green, C.yellow, C.white];
      output.push('');
      output.push(`${C.bold}${colors[level - 1]}${title}${C.reset}`);
      output.push('');
      continue;
    }

    // 水平分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      output.push(`${C.gray}${'─'.repeat(40)}${C.reset}`);
      continue;
    }

    // 表格
    if (trimmed.includes('|') && trimmed.startsWith('|')) {
      // 简单渲染：清理管道符
      const cells = trimmed.split('|').filter(c => c.trim());
      output.push(`  ${C.cyan}${cells.join('  │  ')}${C.reset}`);
      continue;
    }

    // 引用
    const quoteMatch = trimmed.match(/^>\s*(.*)/);
    if (quoteMatch) {
      output.push(`${C.dim}${C.gray}│ ${C.white}${quoteMatch[1]}${C.reset}`);
      continue;
    }

    // 无序列表
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)/);
    if (ulMatch) {
      if (!inList) { inList = true; }
      output.push(`  ${C.green}●${C.reset} ${processInline(ulMatch[1])}`);
      continue;
    }

    // 有序列表
    const olMatch = trimmed.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (!inList) { inList = true; }
      output.push(`  ${C.blue}▸${C.reset} ${processInline(olMatch[1])}`);
      continue;
    }

    // 普通段落
    output.push(processInline(trimmed));
  }

  return output.join('\n');
}

/** 处理行内 Markdown：粗体、斜体、行内代码、链接 */
function processInline(text: string): string {
  let result = text;

  // 行内代码 `code`
  result = result.replace(/`([^`]+)`/g, `${C.cyan}$1${C.reset}`);

  // 粗体 **text** 或 __text__
  result = result.replace(/\*\*(.+?)\*\*/g, `${C.bold}$1${C.reset}`);
  result = result.replace(/__(.+?)__/g, `${C.bold}$1${C.reset}`);

  // 斜体 *text* 或 _text_（避免与粗体冲突）
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `${C.yellow}$1${C.reset}`);

  // 链接 [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${C.underline}$1${C.reset}${C.dim} ($2)${C.reset}`);

  return result;
}

/** 导出颜色常量 */
export const colors = C;
