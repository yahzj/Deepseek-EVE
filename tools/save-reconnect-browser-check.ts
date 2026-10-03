/**
 * C02 隔离浏览器回归：真实 Web Locks/OPFS/IndexedDB 与构建后 UI，模拟选择器与权限返回。
 * 用法：先 npm run build --prefix web，再 npm run save:reconnect-check。
 * 自建只读服务 4293 与独占 CDP 9437；端口已占用则失败，不连接现有浏览器。
 * Edge 路径可由 WHALE_EDGE_EXE 覆盖；自建临时配置、合成存档，失败非零退出。
 * 版本自检：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-10-04 · 最后跑过 2026-10-04。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { join, resolve, extname, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createInitialState, serializeSaveFile } from '@whale/core'

const ROOT = resolve(process.cwd())
const APP = 'http://127.0.0.1:4293/'
const CDP = 'http://127.0.0.1:9437'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
type Obj = Record<string, unknown>
class Page {
  seq = 0
  waiting = new Map<number, { resolve: (v: Obj) => void; reject: (e: Error) => void }>()
  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const v = JSON.parse(String(e.data)) as { id?: number; result?: Obj; error?: unknown }
      if (v.id === undefined) return
      const pending = this.waiting.get(v.id)
      if (!pending) return
      this.waiting.delete(v.id)
      if (v.error) pending.reject(new Error(JSON.stringify(v.error)))
      else pending.resolve(v.result ?? {})
    })
  }
  send(method: string, params: Obj = {}): Promise<Obj> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async js<T>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }) as {
      exceptionDetails?: unknown; result?: { value?: T }
    }
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result?.value as T
  }
  async until(expression: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (await this.js<boolean>(expression)) return
      await sleep(100)
    }
    throw new Error('页面等待超时：' + expression)
  }
}
async function newPage(): Promise<{ page: Page; id: string }> {
  const result = await (await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })).json() as { id: string; webSocketDebuggerUrl: string }
  const ws = new WebSocket(result.webSocketDebuggerUrl)
  await new Promise<void>((r, j) => { ws.addEventListener('open', () => r(), { once: true }); ws.addEventListener('error', () => j(new Error('CDP open')), { once: true }) })
  const page = new Page(ws)
  await page.send('Page.enable')
  return { page, id: result.id }
}
const click = (text: string) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}); if(!b || b.disabled) return false; b.click(); return true })()`
const readFile = `(async()=>{const root=await navigator.storage.getDirectory();const h=await root.getFileHandle('synthetic.json');return await (await h.getFile()).text()})()`

async function main(): Promise<void> {
  const state = createInitialState({ nowWallMs: Date.now(), seed: 7 })
  state.modeChosen = true
  state.wallet.isk = 111111111
  const text = serializeSaveFile(state)
  // 只允许连接本工具启动的浏览器，CDP 已占用时在启动前报错。
  const reserve = createServer()
  await new Promise<void>((r, j) => { reserve.once('error', j); reserve.listen(9437, '127.0.0.1', r) })
  await new Promise<void>((r) => reserve.close(() => r()))
  const server = createServer(async (request, response) => {
    try {
      const file = resolve(ROOT, 'web/dist', '.' + new URL(request.url ?? '/', APP).pathname.replace(/\/$/, '/index.html'))
      assert(file.startsWith(resolve(ROOT, 'web/dist') + sep))
      const body = await fs.readFile(file)
      const type: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' }
      response.setHeader('Content-Type', type[extname(file)] ?? 'application/octet-stream')
      response.end(body)
    } catch { response.statusCode = 404; response.end() }
  })
  await new Promise<void>((r, j) => { server.once('error', j); server.listen(4293, '127.0.0.1', r) })
  const profile = await fs.mkdtemp(join(tmpdir(), 'whale-c02-browser-'))
  const child = spawn(process.env.WHALE_EDGE_EXE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9437',
    '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  const pages: Page[] = []
  let launchError: Error | null = null
  child.on('error', (err) => { launchError = err })
  try {
    let alive = false
    for (let i = 0; i < 80; i++) { try { alive = (await fetch(CDP + '/json/version')).ok } catch {} if (alive) break; await sleep(100) }
    if (launchError) throw launchError
    assert(alive && child.exitCode === null)
    const first = await newPage(), page = first.page
    pages.push(page)
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      window.__permission='granted';
      FileSystemFileHandle.prototype.queryPermission=async()=>window.__permission;
      FileSystemFileHandle.prototype.requestPermission=async()=>{window.__permission='granted';return 'granted'};
      window.showSaveFilePicker=async()=>{const root=await navigator.storage.getDirectory();return await root.getFileHandle('synthetic.json',{create:true})};
      if(!localStorage.getItem('whale:idle:save')) localStorage.setItem('whale:idle:save',${JSON.stringify(text)});
      localStorage.setItem('whale-idle:locale','zh');
    })()` })
    await page.send('Page.navigate', { url: APP })
    await page.until(`!!document.querySelector('.app-root')`)
    assert(await page.js(click('设置')))
    await page.until(`!!document.querySelector('.app-settings-modal')`)
    assert(await page.js(click('绑定本地存档文件')))
    await page.until(`document.body.textContent.includes('synthetic.json · 已连接')`)
    const bound = await page.js<string>(readFile)
    assert(JSON.parse(bound).state.wallet.isk === 111111111)
    // 在真实 OPFS 写入另一份有效进度并模拟失权；重连不能覆盖它。
    await page.js(`(async()=>{const h=await (await navigator.storage.getDirectory()).getFileHandle('synthetic.json');const raw=JSON.parse(localStorage.getItem('whale:idle:save'));raw.state.wallet.isk=222222222;raw.savedAtWallMs=Date.now();const w=await h.createWritable();await w.write(JSON.stringify(raw));await w.close();window.__permission='prompt'})()`)
    assert(await page.js(click('保存')))
    await page.until(`document.body.textContent.includes('本地文件')`)
    // 设置挂载时刷状态，关闭再打开触发真实查询。
    assert(await page.js(`(()=>{const b=document.querySelector('.app-settings-foot button.is-primary');if(!b)return false;b.click();return true})()`))
    assert(await page.js(click('设置')))
    await page.until(`!![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='重新连接存档文件')`)
    assert(await page.js(click('重新连接存档文件')))
    await page.until(`!!document.querySelector('[aria-labelledby="save-reconnect-title"]')`)
    assert.equal(JSON.parse(await page.js<string>(readFile)).state.wallet.isk, 222222222)
    assert(await page.js(click('取消')))
    assert(await page.js(click('保存')))
    assert.equal(JSON.parse(await page.js<string>(readFile)).state.wallet.isk, 222222222)
    assert(await page.js(click('重新连接存档文件')))
    await page.until(`!!document.querySelector('[aria-labelledby="save-reconnect-title"]')`)
    assert(await page.js(click('载入文件进度')))
    await page.until(`!document.querySelector('[aria-labelledby="save-reconnect-title"]')`)
    assert.equal(await page.js<number>(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wallet.isk`), 222222222)
    // 再次失权后保留当前档，检查焦点与新文件变化都走真实 UI。
    await page.js(`(async()=>{const h=await (await navigator.storage.getDirectory()).getFileHandle('synthetic.json');const raw=JSON.parse(localStorage.getItem('whale:idle:save'));raw.state.wallet.isk=333333333;const w=await h.createWritable();await w.write(JSON.stringify(raw));await w.close();window.__permission='prompt'})()`)
    assert(await page.js(click('保存')))
    await page.js(`document.querySelector('.app-settings-foot button.is-primary').click()`)
    assert(await page.js(click('设置')))
    await page.until(`!![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='重新连接存档文件')`)
    assert(await page.js(click('重新连接存档文件')))
    await page.until(`!!document.querySelector('[aria-labelledby="save-reconnect-title"]')`)
    assert.equal(await page.js<string>('document.activeElement.textContent.trim()'), '取消')
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
    assert.equal(await page.js<string>('document.activeElement.textContent.trim()'), '载入文件进度')
    await page.js(`(async()=>{const h=await (await navigator.storage.getDirectory()).getFileHandle('synthetic.json');const raw=JSON.parse(localStorage.getItem('whale:idle:save'));raw.state.wallet.isk=444444444;const w=await h.createWritable();await w.write(JSON.stringify(raw));await w.close()})()`)
    assert(await page.js(click('保留当前并覆盖文件')))
    await page.until(`document.body.textContent.includes('文件内容已改变，请重新选择。')`)
    assert.equal(JSON.parse(await page.js<string>(readFile)).state.wallet.isk, 444444444)
    assert(await page.js(click('保留当前并覆盖文件')))
    await page.until(`!document.querySelector('[aria-labelledby="save-reconnect-title"]')`)
    assert.equal(JSON.parse(await page.js<string>(readFile)).state.wallet.isk, 222222222)
    // 无效文件与刷新后的未解决保护不能导致新档覆盖。
    await page.js(`(async()=>{const h=await (await navigator.storage.getDirectory()).getFileHandle('synthetic.json');const w=await h.createWritable();await w.write('INVALID');await w.close();window.__permission='prompt'})()`)
    assert(await page.js(click('保存')))
    await page.js(`document.querySelector('.app-settings-foot button.is-primary').click()`)
    assert(await page.js(click('设置')))
    await page.until(`!![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='重新连接存档文件')`)
    assert(await page.js(click('重新连接存档文件')))
    await page.until(`document.body.textContent.includes('无法解析为本游戏存档')`)
    assert.equal(await page.js<string>(readFile), 'INVALID')
    await page.send('Page.reload')
    await page.until(`!!document.querySelector('.app-root')`)
    assert.equal(await page.js<string>(readFile), 'INVALID')
    const second = await newPage()
    pages.push(second.page)
    await second.page.send('Page.navigate', { url: APP })
    await second.page.until(`document.body.textContent.includes('另一个页面正在保存进度')`)
    assert.equal(await second.page.js<boolean>(`!!document.querySelector('.app-root')`), false)
    assert(await second.page.js(click('重新载入')))
    await second.page.until(`document.body.textContent.includes('另一个页面正在保存进度')`)
    page.ws.close()
    await fetch(CDP + '/json/close/' + first.id)
    await sleep(300)
    assert(await second.page.js(click('重新载入')))
    await second.page.until(`!!document.querySelector('.app-root')`)
    assert.equal(await second.page.js<number>(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wallet.isk`), 222222222)
    const third = await newPage()
    pages.push(third.page)
    await third.page.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator,'locks',{value:undefined})` })
    await third.page.send('Page.navigate', { url: APP })
    await third.page.until(`document.body.textContent.includes('当前浏览器无法独占存档写入')`)
    assert.equal(await third.page.js<boolean>(`!!document.querySelector('.app-root')`), false)
    assert.equal(await third.page.js<number>(`JSON.parse(localStorage.getItem('whale:idle:save')).state.wallet.isk`), 222222222)
    console.log(JSON.stringify({ ok: true, edgePid: child.pid, target: '零号最新 web/dist',
      real: ['Web Locks', 'OPFS', 'IndexedDB', '重连选择 UI', '单写者页面'],
      simulated: ['系统文件选择器', '文件权限返回'], protectedUntilChoice: true, cancelProtected: true,
      loadChosen: true, currentChosen: true, changedFileReconfirmed: true, invalidProtectedAcrossReload: true,
      focusLoop: true, secondPageReadOnly: true, reloadAfterOwnerClosed: true, unsupportedLocksReadOnly: true }))
  } finally {
    for (const page of pages) page.ws.close()
    child.kill()
    await new Promise<void>((r) => server.close(() => r()))
    const absolute = resolve(profile)
    assert(absolute.startsWith(resolve(tmpdir()) + sep) && absolute.includes('whale-c02-browser-'))
    await sleep(300)
    await fs.rm(absolute, { recursive: true, force: true }).catch(() => console.log('隔离配置待清理：' + absolute))
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1 })
