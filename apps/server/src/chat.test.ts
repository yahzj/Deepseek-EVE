import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import WebSocket from 'ws';
import { registerAccount, startTestApp, waitFor, type TestApp } from './test-helpers.js';

let current: TestApp;

afterEach(async () => {
  await current?.close();
});

interface Frame {
  type: string;
  [key: string]: unknown;
}

const wsUrl = (app: TestApp, token: string): string =>
  app.baseUrl.replace('http', 'ws') + `/api/chat/ws?token=${token}`;

class WsClient {
  readonly frames: Frame[] = [];
  private ws: WebSocket;
  private opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      this.frames.push(JSON.parse(String(raw)) as Frame);
    });
  }

  async open(): Promise<void> {
    await this.opened;
  }

  send(frame: Frame): void {
    this.ws.send(JSON.stringify(frame));
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.ws.once('close', resolve);
      this.ws.close();
    });
  }
}

describe('聊天（双频道 + 打包帧）', () => {
  it('连接后收到 hello 与在线名单，他人连接收到 presence 通知', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '主播');
    const client = new WsClient(wsUrl(current, account.token));
    await client.open();

    const hello = client.frames.find((f) => f.type === 'hello') as
      | { nickname: string; online: string[]; channels: string[] }
      | undefined;
    assert.ok(hello, '应收到 hello 帧');
    assert.equal(hello.nickname, '主播');
    assert.ok(hello.online.includes('主播'));
    assert.deepEqual(hello.channels.sort(), ['en', 'zh']);

    const viewer = await registerAccount(current.baseUrl, '观众');
    const client2 = new WsClient(wsUrl(current, viewer.token));
    await client2.open();
    await waitFor(() =>
      client.frames.some(
        (f) => f.type === 'presence' && f.event === 'join' && f.nickname === '观众',
      ),
    );

    const presence = client.frames.find(
      (f) => f.type === 'presence' && f.event === 'join' && f.nickname === '观众',
    ) as { nickname: string } | undefined;
    assert.equal(presence?.nickname, '观众');

    await client2.close();
    await client.close();
  });

  it('中文频道 batch 帧落库并广播给其他在线玩家', async () => {
    current = await startTestApp();
    const a = await registerAccount(current.baseUrl, '发送者');
    const b = await registerAccount(current.baseUrl, '接收者');

    const sender = new WsClient(wsUrl(current, a.token));
    const receiver = new WsClient(wsUrl(current, b.token));
    await sender.open();
    await receiver.open();
    await waitFor(() => sender.frames.length >= 2 && receiver.frames.length >= 2);

    sender.send({ type: 'batch', channel: 'zh', messages: ['喵呜！', '采矿去了'] });
    await waitFor(() => receiver.frames.some((f) => f.type === 'batch'));

    const batch = receiver.frames.find((f) => f.type === 'batch') as unknown as {
      channel: string;
      nickname: string;
      messages: string[];
    };
    assert.equal(batch.channel, 'zh');
    assert.equal(batch.nickname, '发送者');
    assert.deepEqual(batch.messages, ['喵呜！', '采矿去了']);

    // 历史接口可拉到这两条
    const res = await fetch(`${current.baseUrl}/api/chat/history?channel=zh`, {
      headers: { authorization: `Bearer ${b.token}` },
    });
    const history = (await res.json()) as { messages: Array<{ text: string }> };
    assert.deepEqual(history.messages.map((m) => m.text), ['喵呜！', '采矿去了']);

    await sender.close();
    await receiver.close();
  });

  it('英文频道与中文频道历史相互独立', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '双语者');
    const client = new WsClient(wsUrl(current, account.token));
    await client.open();
    await waitFor(() => client.frames.length >= 1);

    client.send({ type: 'batch', channel: 'en', messages: ['hello o7'] });
    await waitFor(() => client.frames.filter((f) => f.type === 'batch').length >= 1);

    const zh = await fetch(`${current.baseUrl}/api/chat/history?channel=zh`, {
      headers: { authorization: `Bearer ${account.token}` },
    });
    const zhHistory = (await zh.json()) as { messages: unknown[] };
    assert.equal(zhHistory.messages.length, 0);

    const en = await fetch(`${current.baseUrl}/api/chat/history?channel=en`, {
      headers: { authorization: `Bearer ${account.token}` },
    });
    const enHistory = (await en.json()) as { messages: Array<{ text: string }> };
    assert.deepEqual(enHistory.messages.map((m) => m.text), ['hello o7']);

    await client.close();
  });

  it('间隔小于限频窗口的第二个 batch 被拒绝且不落库', async () => {
    current = await startTestApp({ chatBatchIntervalMs: 300 });
    const account = await registerAccount(current.baseUrl, '连发员');
    const client = new WsClient(wsUrl(current, account.token));
    await client.open();
    await waitFor(() => client.frames.length >= 1);

    client.send({ type: 'batch', channel: 'zh', messages: ['第一条'] });
    client.send({ type: 'batch', channel: 'zh', messages: ['第二条太快'] });
    await waitFor(() => client.frames.some((f) => f.type === 'error'));

    const error = client.frames.find((f) => f.type === 'error') as unknown as { code: string };
    assert.equal(error.code, 'rate_limited');

    const res = await fetch(`${current.baseUrl}/api/chat/history?channel=zh`, {
      headers: { authorization: `Bearer ${account.token}` },
    });
    const history = (await res.json()) as { messages: Array<{ text: string }> };
    assert.deepEqual(history.messages.map((m) => m.text), ['第一条']);

    await client.close();
  });

  it('超过单帧条数上限、空消息帧、非法频道均报错', async () => {
    current = await startTestApp({ chatBatchIntervalMs: 50 });
    const account = await registerAccount(current.baseUrl, '校验员');
    const client = new WsClient(wsUrl(current, account.token));
    await client.open();
    await waitFor(() => client.frames.length >= 1);

    client.send({ type: 'batch', channel: 'zh', messages: ['1', '2', '3', '4', '5', '6'] });
    await waitFor(() => client.frames.some((f) => f.type === 'error' && f.code === 'bad_batch'));

    client.send({ type: 'batch', channel: 'zh', messages: [] });
    await waitFor(() => client.frames.filter((f) => f.type === 'error').length >= 2);

    client.send({ type: 'batch', channel: 'jp', messages: ['你好'] });
    await waitFor(() => client.frames.some((f) => f.type === 'error' && f.code === 'bad_channel'));

    const codes = client.frames
      .filter((f) => f.type === 'error')
      .map((f) => (f as unknown as { code: string }).code);
    assert.ok(codes.includes('bad_batch'));
    assert.ok(codes.includes('bad_channel'));

    await client.close();
  });

  it('无效 token 的 WebSocket 连接被拒绝', async () => {
    current = await startTestApp();
    const client = new WsClient(wsUrl(current, 'forged-token'));
    await assert.rejects(() => client.open());
  });

  it('每个频道只保留配置上限条数，最旧的被清理', async () => {
    current = await startTestApp({ chatBatchIntervalMs: 20, chatRetentionPerChannel: 3 });
    const account = await registerAccount(current.baseUrl, '留档测试');
    const client = new WsClient(wsUrl(current, account.token));
    await client.open();
    await waitFor(() => client.frames.length >= 1);

    for (let round = 0; round < 2; round++) {
      client.send({ type: 'batch', channel: 'en', messages: ['a', 'b', 'c'] });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    const res = await fetch(`${current.baseUrl}/api/chat/history?channel=en`, {
      headers: { authorization: `Bearer ${account.token}` },
    });
    const history = (await res.json()) as { messages: Array<{ text: string }> };
    assert.equal(history.messages.length, 3);

    await client.close();
  });
});
