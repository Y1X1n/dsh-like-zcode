/**
 * 全局限速:令牌桶(字节)。
 * burst 默认 2 秒的速率,短块(如小文件)可一次取走不碎等;大块自动分片等待。
 */

export class TokenBucket {
  private rate: number
  private burst: number
  private tokens: number
  private last: number

  constructor(bytesPerSec: number, burstBytes?: number) {
    this.rate = Math.max(1, bytesPerSec)
    this.burst = Math.max(this.rate, burstBytes ?? this.rate * 2)
    this.tokens = this.burst
    this.last = Date.now()
  }

  setRate(bytesPerSec: number): void {
    const next = Math.max(1, bytesPerSec)
    if (next === this.rate) return
    this.refill()
    this.rate = next
    this.burst = Math.max(next, this.burst)
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.last) / 1000
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate)
      this.last = now
    }
  }

  /** 取 n 字节令牌;不足时等待并重试(避免长睡错过 setRate/外部取消)。 */
  async take(n: number, signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new Error('aborted')
      this.refill()
      if (this.tokens >= n) {
        this.tokens -= n
        return
      }
      const deficit = n - this.tokens
      // 1/10 秒粒度轮询:响应性优先,损耗可忽略
      await sleep(Math.min(2000, Math.max(20, (deficit / this.rate) * 1000)))
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 窗口判定,支持跨零点(如 22→6)。
 */
export function inWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return true
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}
