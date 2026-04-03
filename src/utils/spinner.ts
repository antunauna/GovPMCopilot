/**
 * 终端 Spinner 动画
 * 用于工具执行、API 请求等等待场景
 */

const FRAMES = ['◐', '◓', '◑', '◒'];
const INTERVAL = 100; // ms

export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private text: string;
  private active = false;

  constructor(text: string) {
    this.text = text;
  }

  start(): void {
    if (this.active) return;
    this.active = true;

    process.stdout.write(`  ${FRAMES[0]} ${this.text}`);

    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      // 用 \r 回到行首覆盖
      process.stdout.write(`\r  ${FRAMES[this.frame]} ${this.text}`);
    }, INTERVAL);
  }

  stop(success = true): void {
    if (!this.active) return;
    this.active = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // 清除当前行并写入结果
    process.stdout.write('\r  ');
    if (success) {
      process.stdout.write(`✅ ${this.text}`);
    } else {
      process.stdout.write(`❌ ${this.text}`);
    }
    process.stdout.write('\n');
  }

  updateText(text: string): void {
    this.text = text;
  }
}

/**
 * 带超时的 Promise 包装
 * @returns Promise，超时时 reject
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`操作超时（${ms}ms）`));
    }, ms);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
