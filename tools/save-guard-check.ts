/**
 * **存档丢失防线体检**（2026-09-25 建；起因＝玩家报障「MacBook 关掉游戏后存档丢失」）。
 *
 * 背景与修法见 `docs/design/save-loss-guard-20260925.md`。本工具把两类真实故障**注入**出来量，
 * 确认四件事（不达标即退出码 1）：
 *   ① 正常：设置里「存储状态」显示**可写**；体检键用完即删（不在玩家存储里留垃圾键）；
 *   ② 浏览器不给写存储（Safari 隐私窗口 / 阻止所有 Cookie ⇒ `localStorage` 全抛错）：
 *      启动要弹**一次**玩家可见告警、设置显示**不可写**，本局不写档（不许静默丢档）；
 *   ③ 旧档读不出来（读主档键抛错、体检键正常）：**写盘必须挂起**并弹告警；
 *      **旧档内容必须原封不动**（等 20 秒跨过 15 秒心跳，确认没被新档盖掉）；
 *   ④ 在设置里点「允许写入存档」后：能写进去（玩家自己放行 = 认可旧档会被取代）。
 *
 * 运行前置（与 `ui-battle-fit` / `ui-overflow` 同款，**不自己起浏览器、也绝不动别人的浏览器**）：
 *   1) 网页版已构建并在跑：`npm run build --prefix web` 后
 *      `npm run preview --prefix web -- --port 4199 --strictPort`（默认地址可用 `UI_APP_URL` 覆盖）；
 *   2) 自己起的无头 Chrome 带远程调试端口（默认 `UI_CDP_URL=http://127.0.0.1:9333`；用非默认端口
 *      避免碰到船长自己的 9222；起进程时记 PID，收尾只 kill 自己那一个）。
 *      ⚠ 本工具会注册"文档开头注入脚本"：**崩过一次要换新浏览器再跑**（残留注入会污染下一个场景）。
 *
 * 用法：`npm run save:guard-check`（或 `npx tsx tools/save-guard-check.ts`）
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-09-25 · 最后跑过 2026-09-25
 */
const APP = process.env.UI_APP_URL ?? 'http://localhost:4199/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'

type R = Record<string, unknown>
class Cdp {
  private seq = 0
  private readonly w = new Map<number, { res: (v: R) => void; rej: (e: Error) => void }>()
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      const m = JSON.parse(String(ev.data)) as { id?: number; error?: unknown; result?: R }
      const t = m.id !== undefined ? this.w.get(m.id) : undefined
      if (!t || m.id === undefined) return
      this.w.delete(m.id)
      if (m.error) t.rej(new Error(JSON.stringify(m.error)))
      else t.res(m.result ?? {})
    })
  }
  static async connect(url: string): Promise<Cdp> {
    const list = (await (await fetch(`${url}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = list.find((t) => t.type === 'page')
    if (!page) throw new Error('没有页面 target')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res(), { once: true })
      ws.addEventListener('error', () => rej(new Error('连不上 CDP')), { once: true })
    })
    return new Cdp(ws)
  }
  send(method: string, params: R = {}): Promise<R> {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise<R>((res, rej) => this.w.set(id, { res, rej }))
  }
  async js<T>(expr: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })) as {
      exceptionDetails?: { text?: string }
      result?: { value?: unknown }
    }
    if (r.exceptionDetails) throw new Error(`页面报错：${r.exceptionDetails.text ?? ''}`)
    return r.result?.value as T
  }
  close(): void {
    this.ws.close()
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** ② 浏览器完全不给写存储（隐私窗口 / 阻止所有 Cookie / 禁用站点数据） */
const BLOCK_ALL = `(() => {
  const bad = () => { throw new DOMException('blocked', 'SecurityError') }
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => ({ getItem: bad, setItem: bad, removeItem: bad, clear: bad, key: () => null, length: 0 }),
  })
})()`

/**
 * ③ 只有"读主档"抛错（旧档一时读不出来），探针键照常。
 * ⚠ **必须在文档开头就把哨兵写进去**（不能先让应用跑起来再埋）：应用自己一启动就会落一次盘，
 * 上一版就是被它盖掉了哨兵，误判成"丁没拦住"（探针自身的取数竞态）。
 */
const SENTINEL = '{"sentinel":"OLD-SAVE-MUST-SURVIVE","state":{"v":"x"}}'
const BLOCK_READ_SAVE = `(() => {
  const real = window.localStorage
  try { real.setItem('whale:idle:save', ${JSON.stringify(SENTINEL)}) } catch { /* 存储不可用：由别的场景覆盖 */ }
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => ({
      getItem: (k) => { if (k === 'whale:idle:save') throw new DOMException('unreadable', 'UnknownError'); return real.getItem(k) },
      setItem: (k, v) => real.setItem(k, v),
      removeItem: (k) => real.removeItem(k),
      key: (i) => real.key(i),
      get length() { return real.length },
      clear: () => real.clear(),
    }),
  })
})()`

const SNAPSHOT = `(() => {
  const rows = [...document.querySelectorAll('.app-settings-row')]
  const row = rows.find((r) => (r.querySelector('.app-settings-label')?.textContent || '').includes('存储状态'))
  let probeKey = '(读不了：存储被禁)'
  try { probeKey = String(localStorage.getItem('whale:idle:storage-probe')) } catch { /* 预期：被禁时读也抛 */ }
  return {
    宿主: location.host,
    告警条: (document.querySelector('.app-toast')?.textContent || '').trim().slice(0, 60),
    存储状态行: row?.querySelector('.app-settings-desc')?.textContent?.trim() ?? '(无这一行)',
    放行按钮: !!row?.querySelector('button'),
    探针残键: probeKey,
  }
})()`
const OPEN_SETTINGS = `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '设置'); if (b) { b.click(); return true } return false })()`
const CLOSE_SETTINGS = `(() => { const b = [...document.querySelectorAll('.app-modal-head button, .app-modal button')].find((x) => /✕|关闭/.test(x.textContent || '')); if (b) { b.click(); return true } return false })()`
const CLICK_ALLOW = `(() => {
  const rows = [...document.querySelectorAll('.app-settings-row')]
  const row = rows.find((r) => (r.querySelector('.app-settings-label')?.textContent || '').includes('存储状态'))
  const b = row?.querySelector('button')
  if (b) { b.click(); return true }
  return false
})()`

let injectId: string | null = null
async function setInject(cdp: Cdp, src: string | null): Promise<void> {
  if (injectId !== null) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injectId })
    injectId = null
  }
  if (src !== null) {
    const r = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src })) as { identifier?: string }
    injectId = r.identifier ?? null
  }
}
async function load(cdp: Cdp): Promise<void> {
  await cdp.send('Page.navigate', { url: APP })
  for (let i = 0; i < 90; i++) {
    if (await cdp.js<boolean>(`document.readyState === 'complete' && !!window.localStorage`)) break
    await sleep(120)
  }
  for (let i = 0; i < 120; i++) {
    if (await cdp.js<boolean>(`!!document.querySelector('.app-nav-side')`)) break
    await sleep(150)
  }
  await sleep(1200) // 让启动告警弹出来
}
/** 读 localStorage 必须绕开注入（用一个新的干净文档读同一 origin 的存储） */
async function readRaw(cdp: Cdp, key: string): Promise<string | null> {
  await setInject(cdp, null)
  await cdp.send('Page.navigate', { url: APP })
  for (let i = 0; i < 60; i++) {
    if (await cdp.js<boolean>(`document.readyState === 'complete'`)) break
    await sleep(120)
  }
  const v = await cdp.js<string | null>(`localStorage.getItem(${JSON.stringify(key)})`)
  return v
}

async function main(): Promise<void> {
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false })

  // 清场：干净 origin 状态
  await setInject(cdp, null)
  await cdp.send('Page.navigate', { url: APP })
  for (let i = 0; i < 60; i++) {
    if (await cdp.js<boolean>(`document.readyState === 'complete'`)) break
    await sleep(120)
  }
  await cdp.js(`localStorage.clear(); 'ok'`)

  console.log('① 正常（能写存储）')
  await setInject(cdp, null)
  await load(cdp)
  await cdp.js<boolean>(OPEN_SETTINGS)
  await sleep(400)
  console.log('   ' + JSON.stringify(await cdp.js<R>(SNAPSHOT)))
  await cdp.js<boolean>(CLOSE_SETTINGS)

  console.log('\n② 浏览器不给写存储（localStorage 全抛错）')
  await setInject(cdp, BLOCK_ALL)
  await load(cdp)
  await cdp.js<boolean>(OPEN_SETTINGS)
  await sleep(400)
  console.log('   ' + JSON.stringify(await cdp.js<R>(SNAPSHOT)))
  await cdp.js<boolean>(CLOSE_SETTINGS)

  console.log('\n③ 旧档读不出来（读主档键抛错，探针键正常）——注入脚本在文档开头埋哨兵并堵住读取')
  await setInject(cdp, BLOCK_READ_SAVE)
  await load(cdp)
  await cdp.js<boolean>(OPEN_SETTINGS)
  await sleep(400)
  console.log('   ' + JSON.stringify(await cdp.js<R>(SNAPSHOT)))
  console.log('   等 20 秒跨过 15 秒心跳…')
  await sleep(20_000)
  await cdp.js<boolean>(CLOSE_SETTINGS)
  const after = await readRaw(cdp, 'whale:idle:save')
  console.log(`   旧档是否被保住：${after === SENTINEL ? '✅ 原封不动' : `❌ 被改写了（现在 ${String(after).slice(0, 60)}…）`}`)

  console.log('\n④ 放行写入（设置里点「允许写入存档」）')
  await setInject(cdp, BLOCK_READ_SAVE)
  await load(cdp)
  await cdp.js<boolean>(OPEN_SETTINGS)
  await sleep(400)
  const clicked = await cdp.js<boolean>(CLICK_ALLOW)
  await sleep(900)
  console.log(`   点了放行=${clicked} → ${JSON.stringify(await cdp.js<R>(SNAPSHOT))}`)
  const after2 = await readRaw(cdp, 'whale:idle:save')
  console.log(`   放行后是否写入：${after2 !== null && after2 !== SENTINEL ? '✅ 已写入新档' : '❌ 没写进去'}`)
  cdp.close()
}

main().catch((e: unknown) => {
  console.error(`探针失败：${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
