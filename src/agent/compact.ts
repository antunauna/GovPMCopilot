/**
 * 上下文压缩 - Token 估算
 */

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
      // 其他字符（标点、符号等）算 2 个 token
      enChars += 2;
    }
  }

  return Math.ceil(cnChars / 1.5 + enChars / 4);
}
