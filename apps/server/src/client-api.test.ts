import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startTestApp, type TestApp } from './test-helpers.js';

/**
 * 客户端 SDK（public/api-client.js）的用例：
 * 地址规范化属于纯函数，存档往返与冲突映射走真实 HTTP，保证浏览器里跑的是同一套行为。
 */
interface ClientError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
}

interface ApiClient {
  readonly server: string;
  readonly token: string;
  setServer(value: string): string;
  setToken(value: string): void;
  health(): Promise<{ ok: boolean; time: number }>;
  register(deviceCode: string, nickname: string): Promise<Record<string, unknown>>;
  login(deviceCode: string): Promise<Record<string, unknown>>;
  saveLatest(): Promise<{ version: number; data: string | null; size?: number }>;
  uploadSave(data: string, baseVersion?: number): Promise<{ version: number; size: number }>;
  saveVersions(): Promise<{ versions: Array<{ version: number }> }>;
  wallet(): Promise<{ credits: number; escrow: number; available: number }>;
}

type CreateApi = (options?: Record<string, unknown>) => ApiClient;

const moduleUrl = new URL('../public/api-client.js', import.meta.url).href;
const client = (await import(moduleUrl)) as unknown as {
  createApi: CreateApi;
  normalizeServer: (input: unknown, fallback?: string) => string;
  chatWsUrl: (server: string, token: string) => string;
  ApiError: new (status: number, code: string, message: string, extra?: Record<string, unknown>) => ClientError;
};

describe('服务器地址规范化', () => {
  it('缺协议自动补 http，去尾部斜杠与空白', () => {
    assert.equal(client.normalizeServer('1.2.3.4:8787'), 'http://1.2.3.4:8787');
    assert.equal(client.normalizeServer('  https://whale.example.com/  '), 'https://whale.example.com');
    assert.equal(client.normalizeServer('http://a.com//'), 'http://a.com');
    assert.equal(client.normalizeServer(''), '');
  });

  it('空输入用回退值；WebSocket 地址按协议升级推导', () => {
    assert.equal(client.normalizeServer('', 'http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
    assert.equal(client.chatWsUrl('http://1.2.3.4:8787', 'abc'), 'ws://1.2.3.4:8787/api/chat/ws?token=abc');
    assert.equal(
      client.chatWsUrl('https://whale.example.com', 'a b'),
      'wss://whale.example.com/api/chat/ws?token=a%20b',
    );
  });
});

describe('客户端接口调用（真实 HTTP）', () => {
  let current: TestApp;
  let api: ApiClient;
  let deviceCode: string;

  before(async () => {
    current = await startTestApp();
    api = client.createApi({ server: current.baseUrl });
    deviceCode = `client-test-${Date.now()}`;
  });

  after(async () => {
    await current.close();
  });

  it('注册后能用 token 上传与读取存档', async () => {
    const registered = await api.register(deviceCode, '客户端水手');
    assert.equal(typeof registered['token'], 'string');
    api.setToken(String(registered['token']));

    const health = await api.health();
    assert.equal(health.ok, true);

    const first = await api.uploadSave('{"credits":100}', 0);
    assert.equal(first.version, 1);

    const latest = await api.saveLatest();
    assert.equal(latest.version, 1);
    assert.equal(latest.data, '{"credits":100}');
  });

  it('基于旧版本上传抛出 409 save_conflict，并带最新版本号', async () => {
    const error = await api.uploadSave('{"stale":true}', 0).then(
      () => null,
      (reason: unknown) => reason as ClientError,
    );
    assert.ok(error, '应当抛错');
    assert.equal(error.status, 409);
    assert.equal(error.code, 'save_conflict');
    assert.equal(error.extra['latestVersion'], 1);
  });

  it('不传 baseVersion 视为强制覆盖，版本号继续递增', async () => {
    const forced = await api.uploadSave('{"forced":true}');
    assert.equal(forced.version, 2);
    const { versions } = await api.saveVersions();
    assert.deepEqual(
      versions.map((item) => item.version),
      [2, 1],
    );
  });

  it('钱包初始为零，未注册设备登录返回 404', async () => {
    const wallet = await api.wallet();
    assert.deepEqual(wallet, { credits: 0, escrow: 0, available: 0 });

    const error = await api.login('never-registered-device').then(
      () => null,
      (reason: unknown) => reason as ClientError,
    );
    assert.ok(error);
    assert.equal(error.status, 404);
    assert.equal(error.code, 'account_not_found');
  });

  it('连不上的地址报 network_error（status 0），而不是抛原始异常', async () => {
    const broken = client.createApi({ server: 'http://127.0.0.1:1' });
    const error = await broken.health().then(
      () => null,
      (reason: unknown) => reason as ClientError,
    );
    assert.ok(error);
    assert.equal(error.status, 0);
    assert.equal(error.code, 'network_error');
  });
});
