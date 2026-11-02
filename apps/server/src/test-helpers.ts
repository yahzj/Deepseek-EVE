import { createApp, type App } from './app.js';
import { TEST_CATALOG } from './test-fixtures.js';

export interface TestApp {
  app: App;
  baseUrl: string;
  close: () => Promise<void>;
}

/** 每个用例独立的内存库 + 随机端口，用例之间互不影响。 */
export async function startTestApp(
  configOverrides: Record<string, unknown> = {},
): Promise<TestApp> {
  const app = createApp({ dbPath: ':memory:', config: configOverrides, catalog: TEST_CATALOG });
  const port = await app.listen(0);
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => app.close(),
  };
}

export interface TestAccount {
  token: string;
  playerId: number;
  nickname: string;
  deviceCode: string;
}

export async function registerAccount(
  baseUrl: string,
  nickname: string,
): Promise<TestAccount> {
  const deviceCode = `dev-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceCode, nickname }),
  });
  if (!res.ok) {
    throw new Error(`注册失败：${res.status} ${await res.text()}`);
  }
  const payload = (await res.json()) as { token: string; playerId: number; nickname: string };
  return { token: payload.token, playerId: payload.playerId, nickname: payload.nickname, deviceCode };
}

export const authHeaders = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
});

/** 等待直到谓词成立或超时，用于 WebSocket 异步广播断言。 */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor 超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
