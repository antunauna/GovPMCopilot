/**
 * 终端 Markdown 渲染 v0.4
 * 手动终端格式化（零额外依赖）
 * 支持：标题、列表、表格、代码块（含语法标签）、引用、任务列表、分隔线、粗体/斜体/行内代码、删除线
 */

/** ANSI 颜色（终端友好） */
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
  underline: '\x1b[4m',
};

// 获取终端宽度（fallback 80）
function getTermWidth(): number {
  try {
    if (process.stdout.columns && process.stdout.columns > 20) return process.stdout.columns;
  } catch { /* ignore */ }
  return 80;
}

/** 去除 ANSI 转义码（用于计算显示宽度） */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** 处理行内 Markdown：粗体、斜体、行内代码、链接、删除线 */
function processInline(text: string): string {
  let result = text;

  // 行内代码 `code`
  result = result.replace(/`([^`]+)`/g, `${C.cyan}$1${C.reset}`);

  // 粗体 **text** 或 __text__
  result = result.replace(/\*\*(.+?)\*\*/g, `${C.bold}$1${C.reset}`);
  result = result.replace(/__(.+?)__/g, `${C.bold}$1${C.reset}`);

  // 斜体 *text* 或 _text_（避免与粗体冲突）
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `${C.yellow}$1${C.reset}`);

  // 删除线 ~~text~~
  result = result.replace(/~~(.+?)~~/g, `${C.dim}$1${C.reset}`);

  // 链接 [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
    return `${C.underline}${linkText}${C.reset}${C.dim} (${url})${C.reset}`;
  });

  return result;
}

/**
 * 渲染表格（自动计算列宽 + 对齐）
 */
function renderTable(rows: string[][], termWidth: number): string {
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map(r => r.length));
  const colWidths: number[] = [];

  for (let c = 0; c < colCount; c++) {
    let maxW = 3;
    for (const row of rows) {
      if (row[c]) maxW = Math.max(maxW, stripAnsi(processInline(row[c])).length);
    }
    colWidths.push(Math.min(maxW, 30));
  }

  const lines: string[] = [];
  lines.push('');

  for (let r = 0; r < rows.length; r++) {
    const isHeader = r === 0;
    const cells: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const raw = rows[r]?.[c] || '';
      const rendered = isHeader ? `${C.bold}${C.cyan}${raw}${C.reset}` : processInline(raw);
      const displayLen = stripAnsi(rendered).length;
      const pad = Math.max(colWidths[c] - displayLen, 1);
      cells.push(rendered + ' '.repeat(pad));
    }
    lines.push(`  ${cells.join(' │ ')}`);

    if (isHeader) {
      const seps = colWidths.map(w => '─'.repeat(w));
      lines.push(`  ${seps.join('─┼─')}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * 将 Markdown 文本渲染为带 ANSI 颜色的终端输出
 */
export function renderMarkdownToTerminal(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let tableHeaderProcessed = false;
  let tableRows: string[][] = [];
  const termWidth = getTermWidth();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块切换
    if (line.trim().startsWith('```')) {
      // 结束之前的表格
      if (tableHeaderProcessed && tableRows.length > 0) {
        output.push(renderTable(tableRows, termWidth));
        tableRows = [];
        tableHeaderProcessed = false;
      }
      if (inCodeBlock) {
        inCodeBlock = false;
        output.push(`${C.gray}${'─'.repeat(Math.min(termWidth - 4, 60))}${C.reset}`);
      } else {
        inCodeBlock = true;
        const lang = line.trim().slice(3).trim();
        const label = lang ? `${C.dim}${lang}${C.reset} ` : '';
        output.push(`${C.gray}${'─'.repeat(Math.min(termWidth - 4, 60))} ${label}${C.reset}`);
      }
      continue;
    }

    if (inCodeBlock) {
      output.push(`${C.dim}  ${line}${C.reset}`);
      continue;
    }

    const trimmed = line.trim();

    // 空行
    if (!trimmed) {
      if (tableHeaderProcessed && tableRows.length > 0) {
        output.push(renderTable(tableRows, termWidth));
        tableRows = [];
        tableHeaderProcessed = false;
      }
      inList = false;
      continue;
    }

    // 表格行
    if (trimmed.includes('|') && trimmed.startsWith('|')) {
      const cells = trimmed.split('|').filter(c => c.trim());
      if (cells.every(c => /^[\s\-:]+$/.test(c))) {
        tableHeaderProcessed = true;
        continue;
      }
      tableRows.push(cells.map(c => c.trim()));
      continue;
    }
    // 非表格行，结束表格
    if (tableHeaderProcessed && tableRows.length > 0) {
      output.push(renderTable(tableRows, termWidth));
      tableRows = [];
      tableHeaderProcessed = false;
    }

    // 标题
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2];
      const headingColors = [C.magenta, C.blue, C.cyan, C.green, C.yellow, C.white];
      const underline = level <= 2
        ? `${headingColors[level - 1]}${'─'.repeat(Math.min(title.length * 2, termWidth - 4))}${C.reset}`
        : '';
      output.push('');
      output.push(`${C.bold}${headingColors[level - 1]}${title}${C.reset}`);
      if (underline) output.push(underline);
      output.push('');
      continue;
    }

    // 水平分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      output.push(`${C.gray}${'─'.repeat(Math.min(termWidth - 4, 60))}${C.reset}`);
      continue;
    }

    // 任务列表 - [x] / [ ]
    const taskMatch = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.*)/);
    if (taskMatch) {
      if (!inList) inList = true;
      const checked = taskMatch[1] !== ' ';
      const icon = checked ? `${C.green}☑${C.reset}` : `${C.gray}☐${C.reset}`;
      const taskText = checked ? `${C.dim}${processInline(taskMatch[2])}${C.reset}` : processInline(taskMatch[2]);
      output.push(`  ${icon} ${taskText}`);
      continue;
    }

    // 引用
    const quoteMatch = trimmed.match(/^>\s*(.*)/);
    if (quoteMatch) {
      output.push(`${C.dim}${C.gray}│ ${C.white}${processInline(quoteMatch[1])}${C.reset}`);
      continue;
    }

    // 无序列表
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)/);
    if (ulMatch) {
      if (!inList) inList = true;
      output.push(`  ${C.green}●${C.reset} ${processInline(ulMatch[1])}`);
      continue;
    }

    // 有序列表
    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (olMatch) {
      if (!inList) inList = true;
      output.push(`  ${C.blue}${olMatch[1].padStart(2, ' ')}.${C.reset} ${processInline(olMatch[2])}`);
      continue;
    }

    // 普通段落
    output.push(processInline(trimmed));
  }

  // 文件末尾残留的表格
  if (tableHeaderProcessed && tableRows.length > 0) {
    output.push(renderTable(tableRows, termWidth));
  }

  return output.join('\n');
}

/** 导出颜色常量 */
export const colors = C;
