import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { authHeaders, registerAccount, startTestApp, type TestApp } from './test-helpers.js';

let current: TestApp;

afterEach(async () => {
  await current?.close();
});

describe('设备码注册与登录', () => {
  it('注册返回 token 与昵称，profile 可鉴权读取', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '鲸鱼一号');

    assert.equal(account.nickname, '鲸鱼一号');
    assert.ok(account.token.length >= 32);

    const res = await fetch(`${current.baseUrl}/api/profile`, {
      headers: authHeaders(account.token),
    });
    assert.equal(res.status, 200);
    const profile = (await res.json()) as { playerId: number; nickname: string };
    assert.equal(profile.nickname, '鲸鱼一号');
    assert.equal(profile.playerId, account.playerId);
  });

  it('同一设备码再次登录沿用旧昵称，不建新账号', async () => {
    current = await startTestApp();
    const first = await registerAccount(current.baseUrl, '老船长');
    const res = await fetch(`${current.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCode: first.deviceCode }),
    });
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { playerId: number; nickname: string };
    assert.equal(payload.playerId, first.playerId);
    assert.equal(payload.nickname, '老船长');
  });

  it('未注册设备走登录端点报 404，不允许偷偷建号', async () => {
    current = await startTestApp();
    const res = await fetch(`${current.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCode: 'ghost-device-01' }),
    });
    assert.equal(res.status, 404);
    const payload = (await res.json()) as { code: string };
    assert.equal(payload.code, 'account_not_found');
  });

  it('重复昵称注册被拒绝', async () => {
    current = await startTestApp();
    await registerAccount(current.baseUrl, '独一名');
    const res = await fetch(`${current.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCode: 'another-device-1', nickname: '独一名' }),
    });
    assert.equal(res.status, 409);
    const payload = (await res.json()) as { code: string };
    assert.equal(payload.code, 'nickname_taken');
  });

  it('改名接口生效且拒绝撞名', async () => {
    current = await startTestApp();
    const a = await registerAccount(current.baseUrl, '甲');
    const b = await registerAccount(current.baseUrl, '乙');

    const ok = await fetch(`${current.baseUrl}/api/profile`, {
      method: 'PUT',
      headers: authHeaders(b.token),
      body: JSON.stringify({ nickname: '乙二号' }),
    });
    assert.equal(ok.status, 200);

    const conflict = await fetch(`${current.baseUrl}/api/profile`, {
      method: 'PUT',
      headers: authHeaders(b.token),
      body: JSON.stringify({ nickname: '甲' }),
    });
    assert.equal(conflict.status, 409);
  });

  it('非法 token 与缺失 token 均返回 401', async () => {
    current = await startTestApp();
    const noToken = await fetch(`${current.baseUrl}/api/profile`);
    assert.equal(noToken.status, 401);

    const badToken = await fetch(`${current.baseUrl}/api/profile`, {
      headers: authHeaders('not-a-real-token'),
    });
    assert.equal(badToken.status, 401);
  });
});
