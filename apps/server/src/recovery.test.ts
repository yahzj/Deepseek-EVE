import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { authHeaders, registerAccount, startTestApp, type TestApp } from './test-helpers.js';

let current: TestApp;

afterEach(async () => {
  await current?.close();
});

const post = (path: string, body: unknown, token?: string): Promise<Response> =>
  fetch(`${current.baseUrl}${path}`, {
    method: 'POST',
    headers: token ? authHeaders(token) : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('恢复码', () => {
  it('注册时下发恢复码，换设备后可找回同一账号', async () => {
    current = await startTestApp();
    const deviceCode = 'origin-device-01';
    const reg = await post('/api/auth/register', { deviceCode, nickname: '找回测试' });
    const body = (await reg.json()) as { recoveryCode: string; playerId: number };
    assert.match(body.recoveryCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const redeemed = await post('/api/auth/recovery/redeem', {
      recoveryCode: body.recoveryCode,
      deviceCode: 'new-device-02',
    });
    assert.equal(redeemed.status, 200);
    const payload = (await redeemed.json()) as { playerId: number; nickname: string; token: string };
    assert.equal(payload.playerId, body.playerId);
    assert.equal(payload.nickname, '找回测试');

    // 旧设备码已失效
    const oldLogin = await post('/api/auth/login', { deviceCode });
    assert.equal(oldLogin.status, 404);

    // 新 token 可用
    const profile = await fetch(`${current.baseUrl}/api/profile`, {
      headers: authHeaders(payload.token),
    });
    assert.equal(profile.status, 200);
  });

  it('恢复码忽略大小写与分隔符，错误码返回 404', async () => {
    current = await startTestApp();
    const reg = await post('/api/auth/register', { deviceCode: 'case-device-01', nickname: '大小写' });
    const { recoveryCode } = (await reg.json()) as { recoveryCode: string };

    const ok = await post('/api/auth/recovery/redeem', {
      recoveryCode: recoveryCode.toLowerCase().replace(/-/g, ''),
      deviceCode: 'case-device-02',
    });
    assert.equal(ok.status, 200);

    const bad = await post('/api/auth/recovery/redeem', {
      recoveryCode: 'AAAA-BBBB-CCCC-DDDD',
      deviceCode: 'case-device-03',
    });
    assert.equal(bad.status, 404);
  });

  it('重新签发恢复码后旧码立即失效', async () => {
    current = await startTestApp();
    const reg = await post('/api/auth/register', { deviceCode: 'rotate-device-01', nickname: '轮换者' });
    const first = (await reg.json()) as { recoveryCode: string; token: string };

    const rotated = await post('/api/auth/recovery/rotate', {}, first.token);
    assert.equal(rotated.status, 200);
    const { recoveryCode: second } = (await rotated.json()) as { recoveryCode: string };
    assert.notEqual(second, first.recoveryCode);

    const oldAttempt = await post('/api/auth/recovery/redeem', {
      recoveryCode: first.recoveryCode,
      deviceCode: 'rotate-device-02',
    });
    assert.equal(oldAttempt.status, 404);

    const newAttempt = await post('/api/auth/recovery/redeem', {
      recoveryCode: second,
      deviceCode: 'rotate-device-02',
    });
    assert.equal(newAttempt.status, 200);
  });

  it('注册响应不再回传恢复码以外的敏感信息', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '隐私检查');
    const profile = await fetch(`${current.baseUrl}/api/profile`, {
      headers: authHeaders(account.token),
    });
    const payload = (await profile.json()) as Record<string, unknown>;
    assert.equal(payload['token'], undefined);
    assert.equal(payload['recoveryCode'], undefined);
  });
});
