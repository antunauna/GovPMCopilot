/**
 * HTTP 请求重试（指数退避）
 * 适用于 429（限流）和 5xx（服务端错误）
 */

interface RetryOptions {
  maxRetries: number;
  baseDelay: number;    // 首次重试延迟（ms）
  maxDelay: number;     // 最大延迟（ms）
  retryableStatuses: number[];
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带重试的 fetch 包装
 * - 429: 读取 Retry-After 头
 * - 5xx: 指数退避（1s → 2s → 4s）
 * - 网络错误: 指数退避
 * - 4xx 非 429: 不重试
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: Partial<RetryOptions>,
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const resp = await fetch(url, init);

      // 成功响应
      if (resp.ok) return resp;

      // 不应重试的状态码
      if (!opts.retryableStatuses.includes(resp.status)) {
        return resp;
      }

      // 429: 尊重 Retry-After
      if (resp.status === 429) {
        const retryAfter = resp.headers.get('Retry-After');
        let delay: number;
        if (retryAfter) {
          delay = parseInt(retryAfter, 10) * 1000;
          if (isNaN(delay)) {
            delay = opts.baseDelay;
          }
        } else {
          delay = opts.baseDelay;
        }
        delay = Math.min(delay, opts.maxDelay);

        lastError = new Error(`HTTP ${resp.status} (retry ${attempt + 1}/${opts.maxRetries}, wait ${delay}ms)`);
        if (attempt < opts.maxRetries) {
          process.stderr.write(`\n  ⚠️ 限流，${delay / 1000}s 后重试...\n`);
          await sleep(delay);
          continue;
        }
        return resp;
      }

      // 5xx: 指数退避
      const delay = Math.min(opts.baseDelay * Math.pow(2, attempt), opts.maxDelay);
      lastError = new Error(`HTTP ${resp.status} (retry ${attempt + 1}/${opts.maxRetries}, wait ${delay}ms)`);
      if (attempt < opts.maxRetries) {
        process.stderr.write(`\n  ⚠️ 服务错误 ${resp.status}，${delay / 1000}s 后重试...\n`);
        await sleep(delay);
        continue;
      }
      return resp;
    } catch (err: any) {
      // 网络错误等
      lastError = err;
      const delay = Math.min(opts.baseDelay * Math.pow(2, attempt), opts.maxDelay);
      if (attempt < opts.maxRetries) {
        process.stderr.write(`\n  ⚠️ 网络错误，${delay / 1000}s 后重试...\n`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('fetchWithRetry: unexpected state');
}
