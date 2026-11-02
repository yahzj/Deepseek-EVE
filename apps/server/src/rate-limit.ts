import type { IncomingMessage } from 'node:http';

export interface RateLimitResult {
  ok: boolean;
  /** 被拒时建议客户端等待的毫秒数 */
  retryAfterMs: number;
}

/**
 * 进程内滑动窗口限流器（够小圈子自用；多进程部署时换成共享存储）。
 *
 * 为什么需要：服务直接暴露在公网，注册/登录接口是最容易被脚本刷的入口——
 * 不加限制的话，一个循环就能把 accounts 表灌满、把 SQLite 写锁抢死。
 */
export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private lastPruneAt = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  hit(key: string, windowMs: number, max: number): RateLimitResult {
    const now = this.now();
    this.pruneIfNeeded(now);
    const hits = (this.buckets.get(key) ?? []).filter((ts) => now - ts < windowMs);
    if (hits.length >= max) {
      // 最早那次请求滑出窗口时就能再试
      const retryAfterMs = Math.max(0, windowMs - (now - hits[0]!));
      this.buckets.set(key, hits);
      return { ok: false, retryAfterMs };
    }
    hits.push(now);
    this.buckets.set(key, hits);
    return { ok: true, retryAfterMs: 0 };
  }

  /** 当前跟踪的 key 数量（测试与运维观测用）。 */
  size(): number {
    return this.buckets.size;
  }

  private pruneIfNeeded(now: number): void {
    // 每分钟清一次空桶，避免长期运行内存只涨不落
    if (now - this.lastPruneAt < 60_000) {
      return;
    }
    this.lastPruneAt = now;
    for (const [key, hits] of this.buckets) {
      if (hits.length === 0 || now - hits[hits.length - 1]! > 5 * 60_000) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * 取客户端 IP：反向代理（Caddy）后 remoteAddress 恒为 127.0.0.1，
 * 因此开启 trustProxy 时优先读 X-Forwarded-For 的第一段。
 * ⚠ 直连公网且未配反代时必须关掉 trustProxy，否则客户端可伪造头绕过限流。
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = raw?.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}
