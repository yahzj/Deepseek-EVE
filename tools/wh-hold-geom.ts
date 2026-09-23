/**
 * **虫洞货仓格区几何核对**（正式入库）：把"格区滚不滚、格子有没有被压扁、物品块有没有跟格子错位"这三条
 * 只能眼睛看的口径变成**可复跑的读数**。
 *
 * 背景（船长 2026-09-23）：「**还是压缩了高度**」——上一版把 `max-height` + `overflow-y` 写在了**格板**上，
 * 而格板里有一层 `position:absolute; inset:0` 的**物品块层**（`.app-wh-hold-figures`）；绝对定位元素的
 * 包含块 = 最近定位祖先的 **padding box** ⇒ 块层被截成可视高（520px），十几行物品块全被压进 520px、
 * 与下面的格子错开（实测最大错位 **350.3px**）。现在滚动窗口是格板外层的 `.app-wh-hold-scroll`。
 *
 * **运行前提前量**（三件套缺一不可）：
 *   1) 网页版已构建并在跑：`npm run build --prefix web` → `npx vite preview --port 4174 --strictPort`
 *      （⚠ 本机 Windows 上 `vite preview` **只监听 IPv6** ⇒ 地址用 `http://[::1]:4174/`）；
 *   2) 无头 Chrome 带远程调试：`chrome --headless=new --remote-debugging-port=9333`
 *      （默认 CDP `127.0.0.1:9333`，接法同 `tools/l10n-en-scan.ts`）；
 *   3) 输入 = **「塞满货仓背包」测试档**（`test-save-wh-holdfull-*.json`，取最新一份；可用
 *      `WH_HOLD_SAVE=<路径>` 指定）：只把文本注入 `localStorage`，**不写回任何档**。
 *      没有就先跑 `npm run save:whfullhold` 生成一份。
 *
 * 用法：`npx tsx tools/wh-hold-geom.ts`（等价 `npm run ui:whhold`）；环境变量
 *   `UI_APP_URL` / `UI_CDP_URL` / `WH_HOLD_SAVE` 可覆盖三个输入。
 *
 * 读什么（两块格板各一遍 + 一组 A/B 对照）：
 *   - `滚动`：`clientHeight` vs `scrollHeight` ⇒ 出没出格区自己的滚动条；
 *   - `首格`/`行模板首值`：格子是不是正方形、有没有被压扁；
 *   - `块层与格板高差`、**`块与格子最大错位px`**：块层有没有被截（0 = 对齐；>0 就是船长报的那种"压缩"）；
 *   - **对照**：把旧写法（封顶 + 滚动写在格板上）当场打回去再量一次 ⇒ 证明因果，不是"看着像好了"。
 *
 * ⚠ **版本自检**（旧读数不可靠）：游戏版本 **v0.1.0** · 存档结构 **v31**（`CURRENT_STATE_VERSION`）；
 *   本工具最后跑过：**2026-09-23**（读数：货仓 520/906 出滚动条 · 行高 65.5px · 错位 0px；对照错位 350.3px）。
 *   判据：格区容器/块层的类名或 `CURRENT_STATE_VERSION` 变了 ⇒ 必须重跑核对。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP = process.env.UI_APP_URL ?? 'http://[::1]:4174/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'
const SAVE_DIR = join(process.cwd(), 'docs', 'test-saves')

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
type Res = Record<string, unknown>

/** 取最新的「塞满货仓背包」档（不给就用 `WH_HOLD_SAVE`） */
function pickSave(): string {
  const env = process.env.WH_HOLD_SAVE
  if (env && env.length > 0) return env
  const cands = readdirSync(SAVE_DIR)
    .filter((n) => n.startsWith('test-save-wh-holdfull-') && n.endsWith('.json'))
    .map((n) => join(SAVE_DIR, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (cands.length === 0) throw new Error('没有 test-save-wh-holdfull-*.json —— 先跑 `npm run save:whfullhold`')
  return cands[0]!
}

class Cdp {
  private seq = 0
  private readonly waiting = new Map<number, { res: (v: Res) => void; rej: (e: Error) => void }>()
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; error?: unknown; result?: Res }
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
  send(method: string, params: Res = {}): Promise<Res> {
    this.seq += 1
    const id = this.seq
    return new Promise<Res>((res, rej) => {
      this.waiting.set(id, { res, rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evalJS<T>(expr: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return (r as { result?: { value?: T } }).result?.value as T
  }
}

async function waitFor(cdp: Cdp, expr: string, what: string, timeoutMs = 25_000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await cdp.evalJS<boolean>(expr)) return
    await wait(250)
  }
  throw new Error(`等不到：${what}`)
}

/** 几何读数（两块格板各一遍；在页面里跑） */
const READ = `(() => {
  const board = (sel) => {
    const scroll = document.querySelector('.app-wh-hold-scroll' + (sel === 'temp' ? '.is-temp' : ':not(.is-temp)'))
    const grid = document.querySelector('.app-wh-hold-grid.is-' + sel)
    if (!scroll || !grid) return { err: sel + ' 没渲染' }
    const figs = grid.querySelector('.app-wh-hold-figures')
    const cells = [...grid.querySelectorAll('.app-wh-hold-cell')]
    const figsArr = [...grid.querySelectorAll('.app-wh-hold-fig')]
    const R = (el) => el ? { top: +el.getBoundingClientRect().top.toFixed(1), h: +el.getBoundingClientRect().height.toFixed(1), w: +el.getBoundingClientRect().width.toFixed(1) } : null
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length
    let maxCellDelta = 0
    for (const f of figsArr) {
      const cs = getComputedStyle(f)
      const col = parseInt(cs.gridColumnStart, 10) - 1
      const row = parseInt(cs.gridRowStart, 10) - 1
      const c = cells[row * cols + col]
      if (c) maxCellDelta = Math.max(maxCellDelta, Math.abs(f.getBoundingClientRect().top - c.getBoundingClientRect().top))
    }
    return {
      滚动: { clientH: scroll.clientHeight, scrollH: scroll.scrollHeight, 出滚动条: scroll.scrollHeight > scroll.clientHeight + 1 },
      格板: R(grid), 列数: cols, 行模板首值: getComputedStyle(grid).gridTemplateRows.split(' ')[0],
      首格: R(cells[0]), 块层高: R(figs)?.h,
      块层与格板高差: figs ? +(figs.getBoundingClientRect().height - grid.getBoundingClientRect().height).toFixed(1) : null,
      块数: figsArr.length, 块与格子最大错位px: +maxCellDelta.toFixed(1),
    }
  }
  return {
    货仓: board('hold'),
    临时空间: board('temp'),
    /** ① 残骸分色（船长 2026-09-22）：块描边色应随物品色调走 —— 稀有残骸 ≠ 普通残骸 */
    残骸分色: (() => {
      const figs = [...document.querySelectorAll('.app-wh-hold-grid.is-hold .app-wh-hold-fig.is-cargo')]
      const t = (f) => getComputedStyle(f).borderTopColor
      const titled = (f) => f.getAttribute('title') || ''
      const rare = figs.filter((f) => /稀有/.test(titled(f))).map(t)
      const common = figs.filter((f) => /残骸/.test(titled(f)) && !/稀有/.test(titled(f))).map(t)
      return {
        稀有块数: rare.length, 普通残骸块数: common.length,
        稀有取色: rare[0] ?? null, 普通取色: common[0] ?? null,
        两色不同: rare.length > 0 && common.length > 0 && rare[0] !== common[0],
      }
    })(),
    /** ④ 清单类型分隔线（船长 2026-09-22）：大类一变的那一行应带 is-group-start */
    清单分组: (() => {
      const rows = [...document.querySelectorAll('.app-wh-piece')]
      const starts = rows.filter((r) => r.classList.contains('is-group-start'))
      const cs = starts[0] ? getComputedStyle(starts[0]) : null
      return { 行数: rows.length, 分组起首行数: starts.length, 首条分隔线: cs ? cs.borderTopWidth + ' ' + cs.borderTopStyle : null }
    })(),
  }
})()`

async function main(): Promise<void> {
  const savePath = pickSave()
  const save = readFileSync(savePath, 'utf8')
  console.log(`档（只读注入）：${savePath}`)
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '启动')
  await cdp.evalJS(
    `localStorage.setItem('whale:idle:save', ${JSON.stringify(save)}); localStorage.setItem('whale-idle:locale','zh'); 1`,
  )
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '载档启动')
  // 洞内在途 ⇒ 顶部活动栏那一条（「虫洞探索 · 第 N 层」）点开就是虫洞面板
  await cdp.evalJS(
    `(() => { const el = document.querySelector('.app-activitybar-label'); const b = el && (el.closest('.app-activitybar-item') || el.closest('button') || el); if (b) b.click(); return !!b })()`,
  )
  await waitFor(cdp, `!!document.querySelector('.app-wh-modal')`, '虫洞面板')
  const tabs = await cdp.evalJS<string[]>(`[...document.querySelectorAll('.app-wh-tab')].map(t => (t.textContent||'').trim())`)
  console.log(`虫洞页签：${tabs.join(' | ')}`)
  const clicked = await cdp.evalJS<boolean>(
    `(() => { const t = [...document.querySelectorAll('.app-wh-tab')].find(x => /货仓|背包/.test(x.textContent||'')); if (!t) return false; t.click(); return true })()`,
  )
  if (!clicked) throw new Error('没有「货仓」页签（面板结构变了 ⇒ 按现状改选择器）')
  await waitFor(cdp, `!!document.querySelector('.app-wh-hold-scroll')`, '货仓格区')
  await wait(500)

  console.log('\n═══ 现行（滚动在格板外层 .app-wh-hold-scroll）═══')
  console.log(JSON.stringify(await cdp.evalJS<Res>(READ), null, 1))

  // A/B 对照：把旧写法（封顶 + 滚动写在格板上）当场打回去
  await cdp.evalJS(`(() => {
    const scroll = document.querySelector('.app-wh-hold-scroll')
    const grid = document.querySelector('.app-wh-hold-grid.is-hold')
    grid.style.maxHeight = '520px'; grid.style.overflowY = 'auto'; grid.style.overflowX = 'hidden'
    scroll.style.maxHeight = 'none'; scroll.style.overflowY = 'visible'
    return true
  })()`)
  await wait(400)
  console.log('\n═══ 对照（封顶/滚动写在格板上 = 报障写法；错位应显著 > 0）═══')
  console.log(JSON.stringify(await cdp.evalJS<Res>(READ), null, 1))
  process.exit(0)
}

main().catch((e: unknown) => {
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
