import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { startTestApp, type TestApp } from './test-helpers.js';

/**
 * 静态资源服务的用例：客户端页面必须能从服务端直接打开，
 * 同时不能被路径穿越读到 public/ 之外的文件（比如数据库与源码）。
 */
describe('客户端静态资源', () => {
  let current: TestApp | null = null;

  afterEach(async () => {
    await current?.close();
    current = null;
  });

  it('根路径返回客户端页面，/debug 返回调试台', async () => {
    current = await startTestApp();

    const page = await fetch(`${current.baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    const html = await page.text();
    assert.ok(html.includes('大鲸鱼 · 云端'), '页面应包含标题');
    assert.ok(html.includes('./app.js'), '页面应加载客户端脚本');

    const debug = await fetch(`${current.baseUrl}/debug`);
    assert.equal(debug.status, 200);
    assert.ok((await debug.text()).includes('调试台'));
  });

  it('脚本与样式带正确的 MIME，且不缓存旧版本', async () => {
    current = await startTestApp();

    const script = await fetch(`${current.baseUrl}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
    assert.equal(script.headers.get('cache-control'), 'no-cache');
    assert.ok((await script.text()).includes('createBatchQueue'));

    const style = await fetch(`${current.baseUrl}/app.css`);
    assert.equal(style.status, 200);
    assert.match(style.headers.get('content-type') ?? '', /text\/css/);
  });

  it('不存在的文件与路径穿越都被拒绝', async () => {
    current = await startTestApp();

    const missing = await fetch(`${current.baseUrl}/nope.js`);
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as { code: string }).code, 'not_found');

    const traversal = await fetch(`${current.baseUrl}/%2e%2e/package.json`);
    assert.equal(traversal.status, 404, '路径穿越不能读到 public/ 之外的文件');

    const encoded = await fetch(`${current.baseUrl}/..%2fpackage.json`);
    assert.equal(encoded.status, 404);

    const database = await fetch(`${current.baseUrl}/../data/whale-server.db`);
    assert.equal(database.status, 404);
  });
});
