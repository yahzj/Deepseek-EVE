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
    const run = await probeRunPage(cdp, w, h)
    results[`${w}x${h}`] = { ...read, 点到入口: clicked, 探索页: run }
    console.log(`\n══════ 窗口 ${w}×${h} ══════`)
    console.log(JSON.stringify({ ...read, 点到入口: clicked }, null, 1))
    console.log('── 探索页（进洞后）──')
    console.log(JSON.stringify(run, null, 1))
  }
  writeFileSync(join(SHOT_DIR, 'prep-geom.json'), JSON.stringify(results, null, 2), 'utf8')
  cdp.close()
  console.log(`\n截屏与读数：${SHOT_DIR}`)
}

/* ── 第二阶段：真的进洞，量探索页（页签 / 舰影动效 / 扫描波 / 作业按钮在扫描下方） ── */

const READ_RUN = `(() => {
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const body = document.querySelector('.app-modal-body')
  const ship = document.querySelector('.app-wh-ship-here')
  const tabs = [...document.querySelectorAll('.app-wh-tab')]
  return {
    弹层纵向溢出: (() => { const m = document.querySelector('.app-wh-modal'); return m ? m.scrollHeight - m.clientHeight : null })(),
    页体溢出: body ? body.scrollHeight - body.clientHeight : null,
    页签名: tabs.map((t) => (t.querySelector('.app-wh-tab-label')?.textContent || '').trim()),
    页签副读数: tabs.map((t) => (t.querySelector('.app-wh-tab-sub')?.textContent || '').trim()),
    页签矩形: rect('.app-wh-tab'),
    扫描按钮: rect('.app-wh-scan-big'),
    作业按钮: rect('.app-wh-work'),
    舰影: rect('.app-wh-ship-here'),
    舰影色: ship ? getComputedStyle(ship).color : null,
    舰影动画: ship ? getComputedStyle(ship).animationName : null,
    舰影动画时长: ship ? getComputedStyle(ship).animationDuration : null,
    光晕: !!document.querySelector('.app-wh-ship-here .app-wh-ship-halo'),
    扫描波: document.querySelectorAll('.app-wh-scan-wave').length,
    新亮格数: document.querySelectorAll('.app-wh-hex.is-just-scanned').length,
  }
})()`

async function probeRunPage(cdp: Cdp, w: number, h: number): Promise<Record<string, unknown>> {
  // 准备页点「进入虫洞」（编队默认已含驾驶船；忙/超重时按钮是禁用的，那就如实报出来）
  const entered = await cdp.evalJS<boolean>(`(() => {
    const b = document.querySelector('.app-wh-modal .app-wh-enter')
    if (!b || b.disabled) return false
    b.click()
    return true
  })()`)
  if (!entered) return { 进洞: '按钮不可用（编队忙 / 超重 / 已在洞里）' }
  await waitFor(cdp, `!!document.querySelector('.app-wh-tabbar .app-wh-tab')`, '探索页页签')
  const inFlight = await cdp.evalJS<Record<string, unknown>>(READ_RUN)
  const shotIn = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string }
  if (shotIn.data) writeFileSync(join(SHOT_DIR, `run-flyin-${w}x${h}.png`), Buffer.from(shotIn.data, 'base64'))
  await sleep(1200) // 等飞入动画播完 + 交还操作
  const settled = await cdp.evalJS<Record<string, unknown>>(READ_RUN)
  // 扫描一次，抓"扫描波 + 逐格点亮"的当场读数
  const scanned = await cdp.evalJS<boolean>(`(() => {
    const b = document.querySelector('.app-wh-scan-big')
    if (!b || b.disabled) return false
    b.click()
    return true
  })()`)
  await sleep(180)
  const scanRead = await cdp.evalJS<Record<string, unknown>>(READ_RUN)
  const shotScan = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string }
  if (shotScan.data) writeFileSync(join(SHOT_DIR, `run-scan-${w}x${h}.png`), Buffer.from(shotScan.data, 'base64'))
  /**
   * **作业按钮的版式**（船长：「激活等按钮可以放在扫描下方」）：真档的编队未必带打捞器/采集器，
   * 作业按钮"只在能干活的格子才渲染"⇒ 靠走格子碰运气不可靠。这里改成**样式核对**：
   * 临时往左列塞一个同 class 的按钮，量它与扫描按钮是否**同宽、正下方**，量完即摘掉。
   */
  const workGeom = await cdp.evalJS<Record<string, unknown>>(`(() => {
    const left = document.querySelector('.app-wh-workspace-left')
    const scan = document.querySelector('.app-wh-scan-big')
    if (!left || !scan) return { 左列: !!left, 扫描: !!scan }
    const probe = document.createElement('button')
    probe.className = 'app-btn is-primary app-wh-work'
    probe.textContent = '探针'
    left.appendChild(probe)
    const a = scan.getBoundingClientRect()
    const b = probe.getBoundingClientRect()
    const cs = getComputedStyle(probe)
    probe.remove()
    return {
      扫描宽: Math.round(a.width), 作业宽: Math.round(b.width),
      横向偏差: Math.round(b.x - a.x),
      纵向间距: Math.round(b.y - (a.y + a.height)),
      左列方向: getComputedStyle(left).flexDirection,
    }
  })()`)
  // 撤离（第 1 层免拦截战 ⇒ 直接出结算单）⇒ 量结算界面是否居中 + 逐条弹出
  const extracted = await cdp.evalJS<boolean>(`(() => {
    const b = [...document.querySelectorAll('.app-wh-actions button')].find((x) => (x.textContent || '').trim() === '撤离')
    if (!b || b.disabled) return false
    b.click()
    return true
  })()`)
  let settleRead: Record<string, unknown> | null = null
  if (extracted) {
    await waitFor(cdp, `!!document.querySelector('.app-wh-settle')`, '结算界面')
    /** 逐条弹出的判据：最后一条此刻还**没到它那一拍**（`animation-delay` 未到 ⇒ opacity 0），900ms 后应为 1 */
    const early = await cdp.evalJS<Record<string, unknown>>(`(() => {
      const pops = [...document.querySelectorAll('.app-wh-settle .is-pop')]
      const last = pops[pops.length - 1]
      const first = pops[0]
      return {
        条数: pops.length,
        首条透明度: first ? getComputedStyle(first).opacity : null,
        末条透明度: last ? getComputedStyle(last).opacity : null,
        末条延迟: last ? getComputedStyle(last).animationDelay : null,
      }
    })()`)
    await sleep(900) // 等逐条弹完 + 跳数跑完
    settleRead = await cdp.evalJS<Record<string, unknown>>(`(() => {
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
      const body = document.querySelector('.app-modal-body')
      const s = document.querySelector('.app-wh-settle')
      const br = body ? body.getBoundingClientRect() : null
      const sr = s ? s.getBoundingClientRect() : null
      return {
        结算块: box(s),
        页体: box(body),
        居中偏差左: br && sr ? Math.round(sr.x - br.x - (br.width - sr.width) / 2) : null,
        逐条弹出元素数: document.querySelectorAll('.app-wh-settle .is-pop').length,
        合计文本: (document.querySelector('.app-wh-settle-total')?.textContent || '').trim(),
        明细文案: [...document.querySelectorAll('.app-wh-settle-cell')].map((c) => (c.textContent || '').trim()),
      }
    })()`)
    const shotSettle = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string }
    if (shotSettle.data) writeFileSync(join(SHOT_DIR, `settle-${w}x${h}.png`), Buffer.from(shotSettle.data, 'base64'))
    // 记下"刚出结算/900ms 后"两条读数：末条透明度应从 0 变 1（证明确实逐条弹，而不是一起出现）
    settleRead = {
      ...settleRead,
      刚出结算: early,
      弹完后末条透明度: await cdp.evalJS<string>(
        `getComputedStyle([...document.querySelectorAll('.app-wh-settle .is-pop')].pop()).opacity`,
      ),
    }
  }
  return { 进洞: 'ok', 飞入中: inFlight, 落定: settled, 点了扫描: scanned, 扫描后: scanRead, 作业按钮版式: workGeom, 点了撤离: extracted, 结算: settleRead }
}

main().catch((e: unknown) => {
  console.error(`探针失败：${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
