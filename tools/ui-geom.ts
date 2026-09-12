/**
 * **装配页 CPU 条 · 无头几何核对**（正式入库；原临时探针 `H:\大鲸鱼\_ui-geom.mjs` 按工具纪律转正）。
 *
 * 背景（2026-09-12）：CPU 条文字变长（「刚好装满」/「超 15」/ 负数）之后，**三档窗口宽度**下顶条会不会
 * 溢出、一级页（装配页）会不会冒出滚动条——"一级页不滚"是船长的红线，本工具把它变成可复跑的读数。
 *
 * **运行前置**（与 `ui-probe.ts` 同款）：网页版在跑（默认 `http://localhost:4173/`）+ 无头 Chrome
 * 带 `--remote-debugging-port=9222` + 输入档就位（`npm run ui:probe -- --make-saves` 会打印约定）。
 *
 * 用法：
 *   npx tsx tools/ui-geom.ts       # 两份档 × 三档窗口（1600×1000 / 1366×768 / 1024×768）× 有/无浮层
 *   npm run ui:geom                # 等价（见 package.json）
 *
 * 输入 / 输出：
 *   - 输入：`tools/_ui-artifacts/saves/{c-exactfull,d-over}.json`（四档说明见 `ui-probe.ts`）
 *   - 输出：`tools/_ui-artifacts/shots/geometry.json`（**可重建，不入库**）
 *
 * 读数列义：`页面纵向滚动` / `页面横向滚动` ＝ 一级页是否出现滚动条（**应为 false**）；
 *   `条内溢出` ＝ 顶条内容超出自身宽度；`尾字是否超条右边` ＝ 末段文字是否压出条外；
 *   `浮层.纵向内滚` ＝ 二级窗内部滚动（**允许 true**，滚动只进二级窗）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v24**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-12**（当日核对：CPU 条三档窗口宽度不溢出、装配页无滚动条）
 *   - 本工具最后跑过：**2026-09-12**
 *   - 判据：`CURRENT_STATE_VERSION − v24 ≥ 2` ⇒ **必须重跑核对**（存档结构跨了一个大版本）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ARTIFACT_DIR = join(process.cwd(), 'tools', '_ui-artifacts')
const SAVE_DIR = join(ARTIFACT_DIR, 'saves')
const SHOT_DIR = join(ARTIFACT_DIR, 'shots')
const APP = process.env.UI_APP_URL ?? 'http://localhost:4173/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9222'
/** 只量"临界两档"：刚好装满（琥珀）与超载（红）——文字最长的两档最容易溢出 */
const SAVE_NAMES = ['c-exactfull', 'd-over'] as const
const SIZES: ReadonlyArray<readonly [number, number]> = [
  [1600, 1000],
  [1366, 768],
  [1024, 768],
]

type CdpResult = Record<string, unknown>
class Cdp {
  private seq = 0
  private readonly waiting = new Map<number, { res: (v: CdpResult) => void; rej: (e: Error) => void }>()
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; error?: unknown; result?: CdpResult }
      const w = msg.id !== undefined ? this.waiting.get(msg.id) : undefined
      if (!w || msg.id === undefined) return
      this.waiting.delete(msg.id)
      if (msg.error) w.rej(new Error(JSON.stringify(msg.error)))
      else w.res(msg.result ?? {})
    })
  }
  static async connect(url: string): Promise<Cdp> {
    const list = (await (await fetch(`${url}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = list.find((t) => t.type === 'page')
    if (!page) throw new Error(`没有可用的页面 target（CDP ${url}）：先按头部注释启动无头 Chrome。`)
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res(), { once: true })
      ws.addEventListener('error', () => rej(new Error(`连不上 CDP：${url}`)), { once: true })
    })
    return new Cdp(ws)
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise<CdpResult>((res, rej) => this.waiting.set(id, { res, rej }))
  }
  async evalJS<T>(expr: string): Promise<T> {
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

async function waitFor(cdp: Cdp, expr: string, label: string, timeoutMs = 15_000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      if (await cdp.evalJS<boolean>(expr)) return
    } catch {
      /* 页面切换中 */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`等不到：${label}（${APP} 是否在跑？）`)
    await sleep(120)
  }
}

const MEASURE = `(() => {
  const r = (el) => el ? { w: Math.round(el.getBoundingClientRect().width), l: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right), scrollW: el.scrollWidth, clientW: el.clientWidth, overflowX: getComputedStyle(el).overflowX } : null
  const strip = document.querySelector('.app-fit-cpustrip')
  const col = document.querySelector('.app-fit-col-right')
  const racks = document.querySelector('.app-fit-racks')
  const modal = document.querySelector('.app-fit-modal')
  return {
    inner: [window.innerWidth, window.innerHeight],
    页面纵向滚动: document.documentElement.scrollHeight > window.innerHeight + 1,
    页面横向滚动: document.documentElement.scrollWidth > window.innerWidth + 1,
    strip: r(strip),
    stripNum: r(strip?.querySelector('.app-fit-cpustrip-num')),
    stripTail: r(strip?.querySelector('.app-fit-cpustrip-pct')),
    stripTailText: strip?.querySelector('.app-fit-cpustrip-pct')?.textContent,
    条内溢出: strip ? strip.scrollWidth > strip.clientWidth + 1 : null,
    尾字是否超条右边: (() => { const s = strip?.getBoundingClientRect(); const t = strip?.querySelector('.app-fit-cpustrip-pct')?.getBoundingClientRect(); return s && t ? t.right > s.right + 0.5 : null })(),
    colRight: r(col),
    槽位区溢出: racks ? racks.scrollWidth > racks.clientWidth + 1 : null,
    modal: modal ? { ...r(modal), scrollH: modal.scrollHeight, clientH: modal.clientHeight, 纵向内滚: modal.scrollHeight > modal.clientHeight + 1 } : null,
  }
})()`

async function main(): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true })
  const missing = SAVE_NAMES.filter((n) => !existsSync(join(SAVE_DIR, `${n}.json`)))
  if (missing.length > 0) {
    console.error(`缺少输入档：${missing.map((n) => `${n}.json`).join('、')}`)
    console.error(`目录：${SAVE_DIR}`)
    console.error('先跑 `npm run ui:probe -- --make-saves` 看输入档约定（四档说明见 tools/ui-probe.ts 头部）。')
    process.exitCode = 1
    return
  }

  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const out: Record<string, unknown> = {}
  for (const name of SAVE_NAMES) {
    const save = readFileSync(join(SAVE_DIR, `${name}.json`), 'utf8')
    await cdp.send('Page.navigate', { url: APP })
    await waitFor(cdp, `document.readyState === 'complete' && !!window.localStorage`, '加载')
    await cdp.evalJS(`localStorage.setItem('whale:idle:save', ${JSON.stringify(save)}); 'ok'`)
    await cdp.send('Page.reload')
    await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '启动')
    await cdp.evalJS(
      `[...document.querySelectorAll('.app-nav-item')].find((b) => b.textContent.includes('装配')).click()`,
    )
    await waitFor(cdp, `!!document.querySelector('.app-fit-cpustrip')`, '装配页')
    const perSave: Record<string, unknown> = {}
    for (const [w, h] of SIZES) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await sleep(400)
      const page1 = await cdp.evalJS<unknown>(MEASURE)
      // 打开候选浮层再量一次（浮层是二级窗口，允许内部滚动）
      await cdp.evalJS(
        `(() => { const b = document.querySelectorAll('.app-fit-rack')[2]?.querySelectorAll('.app-fit-slot-icon')[1]; b && b.click(); return !!b })()`,
      )
      await waitFor(cdp, `!!document.querySelector('.app-fit-modal')`, '浮层')
      await sleep(300)
      const withModal = await cdp.evalJS<unknown>(`(() => {
        const s = document.querySelector('.app-fit-cpustrip'); const m = document.querySelector('.app-fit-modal')
        const t = s?.querySelector('.app-fit-cpustrip-pct')?.getBoundingClientRect(); const sb = s?.getBoundingClientRect()
        return {
          条内溢出: s ? s.scrollWidth > s.clientWidth + 1 : null,
          尾字超右: t && sb ? t.right > sb.right + 0.5 : null,
          浮层: m ? { w: Math.round(m.getBoundingClientRect().width), h: Math.round(m.getBoundingClientRect().height), scrollH: m.scrollHeight, clientH: m.clientHeight, 内滚: m.scrollHeight > m.clientHeight + 1 } : null,
          浮层网格内滚: (() => { const g = document.querySelector('.app-fit-pickgrid'); return g ? g.scrollHeight > g.clientHeight + 1 : null })(),
        }
      })()`)
      await cdp.evalJS(
        `(() => { const b = [...document.querySelectorAll('.app-fit-modal-head button')].find((x) => x.textContent.includes('关闭')); b && b.click(); return true })()`,
      )
      await sleep(200)
      perSave[`${w}x${h}`] = { 无浮层: page1, 有浮层: withModal }
      console.log(`\n══ ${name} @ ${w}x${h} ══`)
      console.log(JSON.stringify(perSave[`${w}x${h}`], null, 1))
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    out[name] = perSave
  }
  writeFileSync(join(SHOT_DIR, 'geometry.json'), JSON.stringify(out, null, 2), 'utf8')
  console.log(`\n几何读数：${join(SHOT_DIR, 'geometry.json')}`)
  cdp.close()
}

main().catch((e: unknown) => {
  console.error(`ui-geom 失败：${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
