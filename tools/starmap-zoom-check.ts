/**
 * **星图缩放与星系判定范围** ＋ **旧版活动栏最小化** 的验收读数（正式入库；原临时探针用完转正）。
 *
 * 背景（**2026-10-02 船长令**两件）：
 *   ① 「玩家还反应，手机端，星图界面各个星系判定范围过小（尤其是未探索的星系），几乎点不中/点了没反应。
 *      建议星图和虫洞探索一样允许放大。并扩大判定范围。」
 *   ② 「给旧版界面的活动窗口添加个最小化的按钮，点击后活动窗口高度缩小，只显示标题（写着活动的那一行）」
 * 口径见 `docs/design/starmap-zoom-20261002.md`；活动栏收起按钮那批见 `docs/roadmap.md` 2026-10-02 条
 * （其工作文档已按 §八归档删除）。
 *
 * **为什么必须量**（两件都是"看代码判不了"的）：判定圆是不是真比圆点大、放大后是否跟着变大、
 * 拖动平移在**旋转后的坐标系**里方向对不对；活动栏收起后是不是真矮了、有没有把主内容区挤动。
 * 本工具**只出读数**（观感归船长审，§6），但**判据不过就非零退出**，可以当检查跑。
 *
 * 前置（与 `tools/wh-mobile-check.ts` 同一套，缺一不可）：
 *   1) `npm run build --prefix web` ⇒ `npx vite preview --port 4174 --strictPort`
 *      （⚠ 本机 Windows 上 `vite preview` 只监听 IPv6 ⇒ 地址用 `http://[::1]:4174/`）；
 *   2) 无头 Chrome `--headless=new --remote-debugging-port=9333`；
 *   3) 输入 = 任一测试档（默认取最新的 `test-save-wh-holdfull-*.json`；`WH_HOLD_SAVE` 可指定）。
 *
 * 用法：`npx tsx tools/starmap-zoom-check.ts`（等价 `npm run ui:starmap`）；
 *   `UI_APP_URL` / `UI_CDP_URL` / `WH_HOLD_SAVE` 可覆盖三个输入。
 *
 * ⚠ **两个踩过的坑，改本工具前必读**：
 *   ① **注档必须赶在 App 起跑之前**（`Page.enable` + `addScriptToEvaluateOnNewDocument`）：
 *      先在页面上跑一遍再 reload，第一份"新游戏"会在 `beforeunload` 里把档写回去、盖掉注入的那份。
 *      启动时还可能有模态（铁人模式 / 公告）盖在最上层 ⇒ 本工具先关掉它再量。
 *   ② **旋转空间里几何要按旋转轴换算**：`.app-root` 是 `rotate(-90deg) scale(s)` ⇒
 *      元素的 `getBoundingClientRect()` **width 对应逻辑高、height 对应逻辑宽**。
 *      （本条先踩过：不换轴会把活动栏读成"高 647"，其实那是宽。）
 *
 * ⚠ **版本自检**（旧读数不可靠）：游戏版本 **v0.1.0** · 存档结构 **v31**（`CURRENT_STATE_VERSION`）；
 *   本工具最后跑过：**2026-10-02**（读数：星图 svg 621×200 逻辑 · 判定圆直径 19.8 / 圆点 13.6 ·
 *   放大两档 150% 后判定圆 29.7 且平移生效 · 复位归位；活动栏 647×141 → 647×40 · 分组 2→0 ·
 *   主内容区 651×477.5 未变）。判据：`.app-map-*` / `.app-activitybar*` 的类名或旋转取尺寸口径变了 ⇒ 必须重跑。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP = process.env.UI_APP_URL ?? 'http://[::1]:4174/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'
const SAVE_DIR = join(process.cwd(), 'docs', 'test-saves')
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
type Res = Record<string, unknown>

function pickSave(): string {
  const env = process.env.WH_HOLD_SAVE
  if (env && env.length > 0) return env
  const c = readdirSync(SAVE_DIR)
    .filter((n) => n.startsWith('test-save-wh-holdfull-') && n.endsWith('.json'))
    .map((n) => join(SAVE_DIR, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (c.length === 0) throw new Error('没有 test-save-wh-holdfull-*.json')
  return c[0]!
}

class Cdp {
  private seq = 0
  private readonly w = new Map<number, { res: (v: Res) => void; rej: (e: Error) => void }>()
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      const m = JSON.parse(String(ev.data)) as { id?: number; error?: unknown; result?: Res }
      const p = m.id !== undefined ? this.w.get(m.id) : undefined
      if (!p || m.id === undefined) return
      this.w.delete(m.id)
      if (m.error) p.rej(new Error(JSON.stringify(m.error)))
      else p.res(m.result ?? {})
    })
  }
  static async connect(url: string): Promise<Cdp> {
    const list = (await (await fetch(`${url}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = list.find((t) => t.type === 'page')
    if (!page) throw new Error(`没有可用页面（CDP ${url}）`)
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
      this.w.set(id, { res, rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async js<T>(expr: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return (r as { result?: { value?: T } }).result?.value as T
  }
  async touch(type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number): Promise<void> {
    await this.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
  }
}
async function waitFor(cdp: Cdp, expr: string, what: string, ms = 30_000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await cdp.js<boolean>(expr)) return
    await wait(250)
  }
  throw new Error(`等不到：${what}`)
}

/** 星图读数（几何一律换算成旋转后的**逻辑空间**尺寸；`viewBox` 直接读属性） */
const READ_MAP = `(() => {
  const root = document.querySelector('.app-root')
  const cs = getComputedStyle(root)
  const s = parseFloat(cs.getPropertyValue('--mob-scale')) || 1
  const svg = document.querySelector('.app-starmap')
  if (!svg) return { err: '没有 .app-starmap' }
  const hits = [...svg.querySelectorAll('.app-map-hit')]
  const dots = [...svg.querySelectorAll('.app-map-dot')]
  const nodes = [...svg.querySelectorAll('.app-map-node')]
  /** ⚠ 旋转空间：逻辑宽 = rect.height/s、逻辑高 = rect.width/s（不换轴会把两轴读反） */
  const R = (el) => { const r = el.getBoundingClientRect(); return { 宽: +(r.height / s).toFixed(1), 高: +(r.width / s).toFixed(1) } }
  return {
    viewBox: svg.getAttribute('viewBox'),
    svg框: R(svg),
    节点数: nodes.length,
    命中圆数: hits.length,
    圆点数: dots.length,
    判定圆直径: hits[0] ? R(hits[0]).宽 : null,
    圆点直径: dots[0] ? R(dots[0]).宽 : null,
    判定圆_attrs: hits[0] ? { r: hits[0].getAttribute('r'), fill: getComputedStyle(hits[0]).fill, pe: getComputedStyle(hits[0]).pointerEvents } : null,
    缩放控件: !!document.querySelector('.app-map-zoom'),
    当前倍数文本: document.querySelector('.app-map-zoom-val')?.textContent ?? null,
    可拖光标: svg.classList.contains('is-zoomed'),
    首个命中圆: hits[0] ? R(hits[0]) : null,
  }
})()`

const READ_BAR = `(() => {
  const root = document.querySelector('.app-root')
  const cs = getComputedStyle(root)
  const s = parseFloat(cs.getPropertyValue('--mob-scale')) || 1
  const bar = document.querySelector('.app-activitybar')
  if (!bar) return { err: '没有 .app-activitybar' }
  const main = document.querySelector('.app-page-main')
  /** ⚠ 旋转空间：逻辑宽 = rect.height/s、逻辑高 = rect.width/s */
  const R = (el) => { const r = el.getBoundingClientRect(); return { 宽: +(r.height / s).toFixed(1), 高: +(r.width / s).toFixed(1) } }
  return {
    收起态: bar.classList.contains('is-collapsed'),
    活动栏: R(bar),
    分组数: bar.querySelectorAll('.app-activitybar-group').length,
    标题还在: !!bar.querySelector('.app-activitybar-title'),
    标题文本: bar.querySelector('.app-activitybar-title')?.textContent ?? null,
    最小化按钮: !!bar.querySelector('.app-activitybar-min'),
    按钮文本: bar.querySelector('.app-activitybar-min')?.textContent ?? null,
    徽标数: bar.querySelectorAll('.app-activitybar-ai').length,
    主内容区: main ? R(main) : null,
  }
})()`

async function main(): Promise<void> {
  const save = readFileSync(pickSave(), 'utf8')
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp.send('Page.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('whale:idle:save', ${JSON.stringify(save)}); localStorage.setItem('whale-idle:locale','zh') } catch (e) {}`,
  })
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '载档启动')
  await waitFor(cdp, `document.querySelector('.app-root')?.classList.contains('is-mobile-rot') === true`, '进旋转模式')
  await wait(600)
  // 启动模态（铁人模式 / 公告）会盖住一切 ⇒ 先关掉
  if (await cdp.js<boolean>(`!!document.querySelector('.app-modal-mask')`)) {
    await cdp.js(`(() => { const m = document.querySelector('.app-modal-mask')?.firstElementChild; if (!m) return false; const bs=[...m.querySelectorAll('button')]; const b=bs.find(x=>/确定|确认|知道|关闭|好的|继续|开始|明白/.test(x.textContent||'')) ?? bs[bs.length-1]; if (b) b.click(); return true })()`)
    await wait(800)
  }

  /* ── ① 星图 ── */
  await cdp.js(`(() => { const n = [...document.querySelectorAll('.app-nav-item')].find(x => /出港|星图|Starmap/.test(x.textContent||'')); if (n) n.click(); return !!n })()`)
  await wait(600)
  if (!(await cdp.js<boolean>(`!!document.querySelector('.app-starmap')`))) {
    await cdp.js(`(() => { const t = [...document.querySelectorAll('.app-subtab, .app-tasktab, .app-tab')].find(x => /星图/.test(x.textContent||'')); if (t) t.click(); return !!t })()`)
  }
  await waitFor(cdp, `!!document.querySelector('.app-starmap')`, '星图')
  await wait(500)
  console.log('═══ ① 星图：判定范围 ＋ 缩放（逻辑空间尺寸，CSS px）═══')
  const map0 = await cdp.js<Res>(READ_MAP)
  console.log(JSON.stringify(map0, null, 1))

  const baseVb = await cdp.js<string>(`document.querySelector('.app-starmap').getAttribute('viewBox')`)
  // ＋ 两下
  await cdp.js(`(() => { const bs=[...document.querySelectorAll('.app-map-zoom-btn')]; const plus=bs[1]; plus.click(); plus.click(); return true })()`)
  await wait(400)
  const zoomVb = await cdp.js<string>(`document.querySelector('.app-starmap').getAttribute('viewBox')`)
  const map1 = await cdp.js<Res>(READ_MAP)
  console.log('\n放大两档后：' + JSON.stringify(map1, null, 1))

  // 拖图平移（真触摸链）
  const box = await cdp.js<{ cx: number; cy: number }>(`(() => { const r=document.querySelector('.app-starmap').getBoundingClientRect(); return { cx: r.left + r.width/2, cy: r.top + r.height/2 } })()`)
  await cdp.touch('touchStart', box.cx, box.cy)
  for (let i = 1; i <= 5; i++) {
    await cdp.touch('touchMove', box.cx + i * 14, box.cy + i * 6)
    await wait(70)
  }
  const panVb = await cdp.js<string>(`document.querySelector('.app-starmap').getAttribute('viewBox')`)
  await cdp.touch('touchEnd', box.cx + 70, box.cy + 30)
  await wait(300)
  console.log('\n平移：放大后 ' + zoomVb + ' → 拖动后 ' + panVb)

  // 复位
  await cdp.js(`(() => { const bs=[...document.querySelectorAll('.app-map-zoom-btn')]; bs[bs.length-1].click(); return true })()`)
  await wait(400)
  console.log('复位后：' + (await cdp.js<string>(`document.querySelector('.app-starmap').getAttribute('viewBox')`)))

  /* ── ② 旧版活动栏最小化 ── */
  console.log('\n═══ ② 旧版活动栏：最小化前后（逻辑空间尺寸）═══')
  const before = await cdp.js<Res>(READ_BAR)
  console.log('收起前：' + JSON.stringify(before, null, 1))
  await cdp.js(`(() => { const b = document.querySelector('.app-activitybar-min'); if (b) b.click(); return !!b })()`)
  await wait(400)
  const after = await cdp.js<Res>(READ_BAR)
  console.log('收起后：' + JSON.stringify(after, null, 1))
  await cdp.js(`(() => { const b = document.querySelector('.app-activitybar-min'); if (b) b.click(); return !!b })()`)
  await wait(400)
  const again = await cdp.js<Res>(READ_BAR)
  console.log('再展开：' + JSON.stringify(again, null, 1))

  /* ── 判据（不过就非零退出）── */
  type M = { 节点数: number; 命中圆数: number; 判定圆直径: number | null; 圆点直径: number | null; 缩放控件: boolean; viewBox: string }
  type B = { 活动栏: { 宽: number; 高: number }; 分组数: number; 标题还在: boolean; 主内容区: { 宽: number; 高: number } | null }
  const m0 = map0 as unknown as M
  const m1 = map1 as unknown as M
  const b0 = before as unknown as B
  const b1 = after as unknown as B
  const b2 = again as unknown as B
  const vbW = (s: string): number => Number(s.split(/\s+/)[2])
  const fails: string[] = []
  if (m0.命中圆数 !== m0.节点数) fails.push(`命中圆数 ${m0.命中圆数} ≠ 节点数 ${m0.节点数}（每个星系都该有一枚判定圆）`)
  if (!(m0.判定圆直径 !== null && m0.圆点直径 !== null && m0.判定圆直径 > m0.圆点直径)) fails.push(`判定圆没有比圆点大（${m0.判定圆直径} vs ${m0.圆点直径}）`)
  if (!m0.缩放控件) fails.push('没有缩放控件')
  if (!(vbW(m1.viewBox) < vbW(m0.viewBox))) fails.push(`放大后 viewBox 没变小（${m0.viewBox} → ${m1.viewBox}）`)
  if (!(m1.判定圆直径 !== null && m0.判定圆直径 !== null && m1.判定圆直径 > m0.判定圆直径)) fails.push(`放大后判定圆没跟着变大（${m0.判定圆直径} → ${m1.判定圆直径}）`)
  if (panVb === zoomVb) fails.push(`拖动没有平移（前后都是 ${panVb}）`)
  if ((await cdp.js<string>(`document.querySelector('.app-starmap').getAttribute('viewBox')`)) !== baseVb) fails.push('复位没有回到基准 viewBox')
  if (b1.分组数 !== 0) fails.push(`收起后仍有 ${b1.分组数} 个分组（应整块不渲染）`)
  if (!b1.标题还在) fails.push('收起后标题行没了')
  if (!(b1.活动栏.高 < b0.活动栏.高 / 2)) fails.push(`收起后高度没缩下来（${b0.活动栏.高} → ${b1.活动栏.高}）`)
  if (b1.活动栏.宽 !== b0.活动栏.宽) fails.push(`收起后宽度变了（${b0.活动栏.宽} → ${b1.活动栏.宽}）`)
  if (b1.主内容区 !== null && b0.主内容区 !== null && (b1.主内容区.高 !== b0.主内容区.高 || b1.主内容区.宽 !== b0.主内容区.宽)) {
    fails.push('收起活动栏把主内容区挤动了')
  }
  if (b2.分组数 !== b0.分组数 || b2.活动栏.高 !== b0.活动栏.高) fails.push('再展开没有还原')
  if (fails.length > 0) {
    console.error('\n❌ ' + fails.join('；'))
    process.exit(1)
  }
  console.log('\n✅ 全部判据通过：判定圆 > 圆点 · 放大生效且判定圆跟着变大 · 拖动平移生效 · 复位归位 · 活动栏收起只留标题行且不动主内容区')
  process.exit(0)
}
main().catch((e: unknown) => {
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
