import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { authHeaders, registerAccount, startTestApp, type TestApp } from './test-helpers.js';

let current: TestApp;

afterEach(async () => {
  await current?.close();
});

const upload = async (
  app: TestApp,
  token: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  fetch(`${app.baseUrl}/api/saves`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });

const downloadLatest = async (app: TestApp, token: string): Promise<Response> =>
  fetch(`${app.baseUrl}/api/saves/latest`, { headers: authHeaders(token) });

describe('云存档', () => {
  it('上传后可原样下载（往返一致）', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '存档员');

    const saveJson = JSON.stringify({ whale: { credits: 12345, ships: ['prospect'] } });
    const put = await upload(current, account.token, { data: saveJson, baseVersion: 0 });
    assert.equal(put.status, 200);
    const putPayload = (await put.json()) as { version: number };
    assert.equal(putPayload.version, 1);

    const get = await downloadLatest(current, account.token);
    const got = (await get.json()) as { version: number; data: string };
    assert.equal(got.version, 1);
    assert.equal(got.data, saveJson);
  });

  it('连续上传版本号递增', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '版本控');

    await upload(current, account.token, { data: 'v1-save' });
    await upload(current, account.token, { data: 'v2-save' });
    const put3 = await upload(current, account.token, { data: 'v3-save' });
    const payload = (await put3.json()) as { version: number };
    assert.equal(payload.version, 3);

    const get = await downloadLatest(current, account.token);
    const got = (await get.json()) as { data: string };
    assert.equal(got.data, 'v3-save');
  });

  it('基于旧版本上传触发 409 冲突并提示服务器最新版本', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '冲突员');

    await upload(current, account.token, { data: 'v1' });
    await upload(current, account.token, { data: 'v2' });

    const stale = await upload(current, account.token, { data: 'old-client-save', baseVersion: 1 });
    assert.equal(stale.status, 409);
    const payload = (await stale.json()) as { code: string; latestVersion: number };
    assert.equal(payload.code, 'save_conflict');
    assert.equal(payload.latestVersion, 2);

    // 不带 baseVersion 视为强制覆盖，允许通过
    const forced = await upload(current, account.token, { data: 'forced-save' });
    assert.equal(forced.status, 200);
  });

  it('历史版本只保留配置上限，最旧版本被清理', async () => {
    current = await startTestApp({ saveHistoryVersions: 3 });
    const account = await registerAccount(current.baseUrl, '历史员');

    for (let i = 1; i <= 5; i++) {
      await upload(current, account.token, { data: `save-${i}` });
    }

    const listRes = await fetch(`${current.baseUrl}/api/saves/versions`, {
      headers: authHeaders(account.token),
    });
    const list = (await listRes.json()) as { versions: Array<{ version: number }> };
    assert.deepEqual(
      list.versions.map((v) => v.version),
      [5, 4, 3],
    );

    // v1、v2 已清理
    const gone = await fetch(`${current.baseUrl}/api/saves/versions/1`, {
      headers: authHeaders(account.token),
    });
    assert.equal(gone.status, 404);

    // 保留期内可下载
    const kept = await fetch(`${current.baseUrl}/api/saves/versions/3`, {
      headers: authHeaders(account.token),
    });
    assert.equal(kept.status, 200);
    const keptPayload = (await kept.json()) as { data: string };
    assert.equal(keptPayload.data, 'save-3');
  });

  it('超限存档体积返回 413，各账号存档相互隔离', async () => {
    current = await startTestApp({ saveMaxBytes: 64 });
    const account = await registerAccount(current.baseUrl, '限长员');
    const other = await registerAccount(current.baseUrl, '隔壁号');

    const tooBig = await upload(current, account.token, { data: 'x'.repeat(65) });
    assert.equal(tooBig.status, 413);

    await upload(current, account.token, { data: 'mine' });
    await upload(current, other.token, { data: 'theirs' });

    const mine = await downloadLatest(current, account.token);
    const got = (await mine.json()) as { data: string };
    assert.equal(got.data, 'mine');
  });

  it('空存档内容返回 400', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '空档员');
    const res = await upload(current, account.token, { data: '' });
    assert.equal(res.status, 400);
  });
});
