import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { RateLimiter } from './rate-limit.js';
import { startTestApp, type TestApp } from './test-helpers.js';

let current: TestApp;

afterEach(async () => {
  await current?.close();
});

describe('限流器', () => {
  it('窗口内超过上限就拒绝，并给出可重试时间', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(() => now);
    assert.equal(limiter.hit('k', 60_000, 3).ok, true);
    assert.equal(limiter.hit('k', 60_000, 3).ok, true);
    assert.equal(limiter.hit('k', 60_000, 3).ok, true);

    const denied = limiter.hit('k', 60_000, 3);
    assert.equal(denied.ok, false);
    assert.ok(denied.retryAfterMs > 0 && denied.retryAfterMs <= 60_000);

    // 窗口滑过去之后恢复
    now += 60_001;
    assert.equal(limiter.hit('k', 60_000, 3).ok, true);
  });

  it('不同 key 互不影响', () => {
    const limiter = new RateLimiter(() => 5_000);
    assert.equal(limiter.hit('a', 60_000, 1).ok, true);
    assert.equal(limiter.hit('a', 60_000, 1).ok, false);
    assert.equal(limiter.hit('b', 60_000, 1).ok, true);
  });
});

describe('注册/登录限流（端到端）', () => {
  it('同一 IP 超额注册返回 429 并带 retry-after', async () => {
    current = await startTestApp({ rateLimitAuthPerMin: 2 });
    const register = (n: number): Promise<Response> =>
      fetch(`${current.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCode: `dev-ratelimit-${n}`, nickname: `限流${n}` }),
      });

    assert.equal((await register(1)).status, 200);
    assert.equal((await register(2)).status, 200);

    const blocked = await register(3);
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'), '应带 retry-after 头');
    const payload = (await blocked.json()) as { code: string };
    assert.equal(payload.code, 'rate_limited');

    // 被拒绝的注册不应该落库
    const count = current.app.db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number };
    assert.equal(count.n, 2);
  });
});
