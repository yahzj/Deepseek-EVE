/**
 * **虫洞面板几何核对**（正式入库）：把「准备页」那些**只能眼睛看**的口径变成可复跑的读数 ——
 * ① 「进入虫洞」按钮是不是**正方形**、字号多大；② **外层虫洞界面有没有出现滚动条**
 * （`页体溢出` 应为 0；滚动只许发生在卡网格内部）；③ 卡网格与准备页各自 client / scroll。
 *
 * 背景（船长 2026-09-13）：「**进入虫洞的按钮再放大一些，并保持正方形。舰船选择界面高度可以适当缩减，
 * 让上一层的虫洞界面不要有滚动条**」——这类"溢出不溢出"的读数按约定（§一 验证证据标注）要拿数说话。
 *
 * **运行前提前量**（三件套缺一不可）：
 *   1) 网页版已构建并在跑：`npm run build --prefix web` → `npm run preview --prefix web -- --port 4173`；
 *   2) 无头 Chrome 带远程调试：`chrome --headless=new --remote-debugging-port=9222`
 *      （默认 CDP `127.0.0.1:9222`，见 `tools/ui-probe.ts` 头注释的同一套接法）；
 *   3) 输入 = **船长真档只读**（`%APPDATA%\whale-idle\save.json`）：只把文本注入 `localStorage`，**不写回**；
 *      调试开关 `whale-idle:debug` 一并置 1（虫洞入口只在调试模式下渲染）。
 *
 * 用法：
 *   npx tsx tools/wh-ui-check.ts        # 两档窗口（1600×1000 / 1366×768）各读一遍 + 截屏
 *   npm run wh:ui                       # 等价
 *
 * 输出：`tools/_ui-artifacts/wormhole/prep-check-<宽>x<高>.png` 与 `prep-geom.json`（**可重建，不入库**）。
 *
 * ⚠ **版本自检**（口径同「旧读数不可靠」）：存档结构跨大版本必须重跑核对。
 *   - 游戏版本 **v0.1.0**（`package.json`）· 存档结构 **v25**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后跑过：**2026-09-13**（当时读数：页体溢出 0 / 按钮 112×112 / 卡网格 344 vs 696）
 *   - 判据：`CURRENT_STATE_VERSION − v25 ≥ 2` ⇒ 必须重跑核对。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const APP = process.env.UI_APP_URL ?? 'http://localhost:4173/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9222'
const SHOT_DIR = join(process.cwd(), 'tools', '_ui-artifacts', 'wormhole')
const SAVE_PATH = join(process.env.APPDATA ?? '', 'whale-idle', 'save.json')
const SIZES: ReadonlyArray<readonly [number, number]> = [
  [1600, 1000],
  [1366, 768],
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
    if (!page) throw new Error(`没有可用的页面 target（CDP ${url}）`)
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
    return new Promise<CdpResult>((res, rej) => {
      // 每条 CDP 调用都带兜底超时：卡住时报出"卡在哪一步"，别把整支探针拖死
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        rej(new Error(`CDP 超时：${method}`))
      }, 8000)
      this.waiting.set(id, {
        res: (v) => {
          clearTimeout(timer)
          res(v)
        },
        rej: (e) => {
          clearTimeout(timer)
          rej(e)
        },
      })
    })
  }
  async evalJS<T>(expr: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })) as {
      exceptionDetails?: { text?: string; exception?: { description?: string } }
      result?: { value?: unknown }
    }
    if (r.exceptionDetails) throw new Error(`页面报错：${r.exceptionDetails.text ?? ''} ${r.exceptionDetails.exception?.description ?? ''}`)
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
    if (Date.now() - t0 > timeoutMs) throw new Error(`等不到：${label}`)
    await sleep(120)
  }
}

const READ = `(() => {
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } }
  const body = document.querySelector('.app-modal-body')
  const modal = document.querySelector('.app-wh-modal')
  const btn = document.querySelector('.app-wh-enter')
  const cards = document.querySelector('.app-wh-cards')
  const prep = document.querySelector('.app-wh-prep')
  const cs = body ? getComputedStyle(body) : null
  return {
    窗口: { w: window.innerWidth, h: window.innerHeight },
    弹层: rect(modal),
    弹层纵向溢出: modal ? modal.scrollHeight - modal.clientHeight : null,
    页体: body ? { client: body.clientHeight, scroll: body.scrollHeight, 溢出: body.scrollHeight - body.clientHeight, overflowY: cs.overflowY } : null,
    准备页: prep ? { client: prep.clientHeight, scroll: prep.scrollHeight, 溢出: prep.scrollHeight - prep.clientHeight } : null,
    进入按钮: rect(btn),
    进入按钮字号: btn ? getComputedStyle(btn).fontSize : null,
    卡网格: cards ? { client: cards.clientHeight, scroll: cards.scrollHeight, 内滚: cards.scrollHeight - cards.clientHeight, overflowY: getComputedStyle(cards).overflowY } : null,
    卡片数: cards ? cards.children.length : 0,
    页面滚动条: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }
})()`

async function main(): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true })
  const save = readFileSync(SAVE_PATH, 'utf8')
  console.log(`读真档（只读）：${SAVE_PATH}`)
  const cdp = await Cdp.connect(CDP)
  console.log('CDP 已连上')
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  const results: Record<string, unknown> = {}
  for (const [w, h] of SIZES) {
    console.log(`── 窗口 ${w}×${h} ──`)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.navigate', { url: APP })
    await waitFor(cdp, `document.readyState === 'complete' && !!window.localStorage`, '首次加载')
    console.log('  首次加载完成 → 注入存档与调试开关')
    await cdp.evalJS(
      `localStorage.setItem('whale:idle:save', ${JSON.stringify(save)});` +
        `localStorage.setItem('whale-idle:debug','1'); 'ok'`,
    )
    await cdp.send('Page.reload')
    await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '启动')
    console.log('  游戏启动完成 → 点「出港」（星图页）')
    await cdp.evalJS<boolean>(`(() => {
      const b = [...document.querySelectorAll('.app-nav-item')].find((x) => (x.textContent || '').includes('出港'))
      if (b) b.click()
      return !!b
    })()`)
    await waitFor(cdp, `!!document.querySelector('.app-starmap')`, '星图页')
    // 星图要先**选中一个星系**，右侧「前往星系 · 行动」面板（虫洞调试入口在里面）才渲染
    const picked = await cdp.evalJS<number>(`(() => {
      const nodes = [...document.querySelectorAll('.app-map-node')]
      let n = 0
      for (const node of nodes) {
        const hit = node.querySelector('circle') || node
        hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        n += 1
        if (document.querySelector('.app-galaxy-actions')) break
      }
      return n
    })()`)
    console.log(`  点了 ${picked} 个星系节点 → 等行动面板`)
    await waitFor(cdp, `!!document.querySelector('.app-galaxy-actions')`, '行动面板')
    console.log('  行动面板出现 → 点虫洞调试入口')
    const clicked = await cdp.evalJS<{ nav: boolean; entry: boolean }>(`(() => {
      const row = [...document.querySelectorAll('.app-ga-row')].find((r) => (r.textContent || '').includes('虫洞'))
      const b = row && row.querySelector('button')
      if (b) b.click()
      return { nav: true, entry: !!b }
    })()`)
    console.log(`  出击页 ok（导航=${clicked.nav} 虫洞入口=${clicked.entry}）→ 等准备页`)
    await waitFor(cdp, `!!document.querySelector('.app-wh-modal .app-wh-enter')`, '虫洞准备页')
    await sleep(400) // 让 CSS 过渡/字体落定
    const read = await cdp.evalJS<Record<string, unknown>>(READ)
    const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string }
    if (shot.data) writeFileSync(join(SHOT_DIR, `prep-check-${w}x${h}.png`), Buffer.from(shot.data, 'base64'))
    results[`${w}x${h}`] = { ...read, 点到入口: clicked }
    console.log(`\n══════ 窗口 ${w}×${h} ══════`)
    console.log(JSON.stringify(results[`${w}x${h}`], null, 1))
  }
  writeFileSync(join(SHOT_DIR, 'prep-geom.json'), JSON.stringify(results, null, 2), 'utf8')
  cdp.close()
  console.log(`\n截屏与读数：${SHOT_DIR}`)
}

main().catch((e: unknown) => {
  console.error(`探针失败：${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
