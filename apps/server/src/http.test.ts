import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { registerAccount, startTestApp, type TestApp } from './test-helpers.js';

let current: TestApp;

afterEach(async () => {
  await current?.close();
});

describe('跨域与调试页', () => {
  it('所有响应带跨域头，预检请求直接返回 204', async () => {
    current = await startTestApp();
    const health = await fetch(`${current.baseUrl}/health`, {
      headers: { origin: 'https://example.github.io' },
    });
    assert.equal(health.headers.get('access-control-allow-origin'), '*');

    const preflight = await fetch(`${current.baseUrl}/api/saves`, {
      method: 'OPTIONS',
      headers: { origin: 'https://example.github.io' },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /authorization/);
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /PUT/);
  });

  it('根路径与 /debug 返回调试台页面', async () => {
    current = await startTestApp();
    const page = await fetch(`${current.baseUrl}/debug`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    const html = await page.text();
    assert.match(html, /服务端调试台/);
  });

  it('未知接口返回 404 且带跨域头（便于网页端读错误）', async () => {
    current = await startTestApp();
    const res = await fetch(`${current.baseUrl}/api/nope`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('健康检查不需要鉴权，业务接口需要', async () => {
    current = await startTestApp();
    assert.equal((await fetch(`${current.baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${current.baseUrl}/api/wallet`)).status, 401);
    const account = await registerAccount(current.baseUrl, '健康检查');
    const wallet = await fetch(`${current.baseUrl}/api/wallet`, {
      headers: { authorization: `Bearer ${account.token}` },
    });
    assert.equal(wallet.status, 200);
  });
});
