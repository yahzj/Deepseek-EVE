/**
 * **手机旋转模式 · 虫洞探索界面「全屏 ＋ 左地图 / 右操作区」＋ 货仓触摸拖拽**的验收读数（正式入库）。
 *
 * 背景（**2026-10-02 船长令**，原话）：「手机模式下，虫洞探索的界面有问题，探索地图下方的操作界面
 * 过于狭窄，导致无法进行操作，货仓背包无法对背包内的物品进行拖动等行为。建议操作手机模式下，
 * 虫洞探索界面放大到全屏，操作界面挪到右侧。」口径见工作文档 `docs/design/mobile-wormhole-20261002.md`。
 *
 * **为什么要有这个工具**（两条只能靠真机/真视口才看得出来的事实）：
 *   ① 面板尺寸在旋转模式下必须按**逻辑空间**取（`--mob-w` / `--mob-h`）；用 `100vh` 会量到手机竖屏高
 *      ⇒ 面板只有 804px、左右各白扔约 198px（"操作界面过于狭窄"的直接来源）。这条只有量才看得见。
 *   ② 货仓搬运原先只接了 HTML5 拖放，**触屏根本不触发** ⇒ 手机上拖不动。判"拖得动"必须发**真触摸事件**。
 *
 * **运行前提前量**（三件套缺一不可）：
 *   1) `npm run build --prefix web` ⇒ `npx vite preview --port 4174 --strictPort`
 *      （⚠ 本机 Windows 上 `vite preview` **只监听 IPv6** ⇒ 地址用 `http://[::1]:4174/`）；
 *   2) 无头 Chrome 带远程调试：`chrome --headless=new --remote-debugging-port=9333`
 *      （接法同 `tools/wh-hold-geom.ts` / `tools/l10n-en-scan.ts`）；
 *   3) 输入 = 带**在途虫洞 run ＋ 塞满货仓**的档（`test-save-wh-holdfull-*.json`，取最新一份；
 *      `WH_HOLD_SAVE=<路径>` 可指定）。只把文本注入 `localStorage`，**不写回任何档**。
 *
 * 用法：`npx tsx tools/wh-mobile-check.ts`（等价 `npm run ui:whmobile`）；环境变量
 *   `UI_APP_URL` / `UI_CDP_URL` / `WH_HOLD_SAVE` 可覆盖三个输入。
 *
 * 读什么：① 有没有真进 `is-mobile-rot`、逻辑空间多大；② 面板/地图栏/右操作栏的**逻辑尺寸**与两栏是否并排；
 * ③ 面板与右栏出没出滚动条；④ 一次**真触摸事件链**（touchStart → 多次 touchMove → touchEnd）之后，
 * 两件 1×1 有没有真的互换（这就是"拖得动"的判据）；⑤ 事件链本身（`pointerdown:touch` 之类）。
 * **判据失败以非零退出**（可当检查跑）。
 *
 * ⚠ **两个踩过的坑，改本工具前必读**：
 *   ① **注档必须赶在 App 起跑之前**（`Page.addScriptToEvaluateOnNewDocument`，且先 `Page.enable`）。
 *      先跑一遍页面再 reload 的话，第一份"新游戏"会在 `beforeunload` 里把档写回去、盖掉刚注入的那份
 *      （实测：那样注完再刷新，档仍是 124 KB 的新档、角色名「深空学徒」——全程看的其实是新游戏，
 *      表现为"虫洞面板打不开"）。
 *   ② **旋转空间里几何要按旋转轴换算**：`.app-root` 是 `rotate(-90deg) scale(s)`，
 *      逻辑点 (x,y) → 视口 (mobX + y·s, mobY − x·s)。所以元素的 `getBoundingClientRect()`
 *      **width 对应逻辑高、height 对应逻辑宽**（直接拿 width 当"宽"会把两轴读反、得出"面板 532 宽"的假读数）。
 *   另：启动时可能有模态（铁人模式 / 公告）盖在最上层，本工具会先关掉它再量。
 *
 * ⚠ **版本自检**（旧读数不可靠）：游戏版本 **v0.1.0** · 存档结构 **v31**（`CURRENT_STATE_VERSION`）；
 *   本工具最后跑过：**2026-10-02**（读数：逻辑空间 1200×554.5 · scale 0.7033 · 面板 1178×532.5 ·
 *   地图栏 742 宽 · 右栏 400 宽 · 两栏并排 ✓ · 面板与右栏都不出滚动条 · 触摸拖拽两件互换成功）。
 *   判据：`.app-wh-*` 的类名、`is-mobile-rot` 的取尺寸口径、或 `CURRENT_STATE_VERSION` 变了 ⇒ 必须重跑核对。
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
  /** 一次真触摸事件（`id` 固定 1；坐标 = 视口 CSS 像素） */
  async touch(type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number): Promise<void> {
    await this.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
  }
}

async function waitFor(cdp: Cdp, expr: string, what: string, timeoutMs = 30_000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await cdp.evalJS<boolean>(expr)) return
    await wait(250)
  }
  throw new Error(`等不到：${what}`)
}

/** 一段：旋转模式与两栏几何（**按旋转轴**换算成逻辑空间尺寸，见文件头坑②） */
const READ_LAYOUT = `(() => {
  const root = document.querySelector('.app-root')
  if (!root) return { err: '没有 .app-root' }
  const cs = getComputedStyle(root)
  const s = parseFloat(cs.getPropertyValue('--mob-scale')) || 1
  const mobX = parseFloat(cs.getPropertyValue('--mob-x')) || 0
  const mobY = parseFloat(cs.getPropertyValue('--mob-y')) || 0
  const L = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const left = (mobY - r.bottom) / s
    const right = (mobY - r.top) / s
    const top = (r.left - mobX) / s
    const bottom = (r.right - mobX) / s
    return { 宽: +(right - left).toFixed(1), 高: +(bottom - top).toFixed(1), 左: +left.toFixed(1), 上: +top.toFixed(1), 右: +right.toFixed(1) }
  }
  const body = document.querySelector('.app-wh-body')
  const ops = document.querySelector('.app-wh-ops')
  const map = L('.app-wh-maprow')
  const o = L('.app-wh-ops')
  return {
    手机旋转模式: root.classList.contains('is-mobile-rot'),
    逻辑空间: { w: cs.getPropertyValue('--mob-w').trim(), h: +(parseFloat(cs.getPropertyValue('--mob-h')) || 0).toFixed(1), scale: +s.toFixed(4) },
    视口物理: { w: innerWidth, h: innerHeight },
    面板: L('.app-wh-modal'),
    探索容器: L('.app-wh-explore'),
    地图行: map,
    地图框: L('.app-wh-mapbox'),
    右操作栏: o,
    缩放控件: L('.app-wh-zoom'),
    两栏并排: !!(map && o && o.左 >= map.右 - 1),
    右栏子块数: ops ? ops.children.length : null,
    右栏出滚动条: ops ? ops.scrollHeight > ops.clientHeight + 1 : null,
    面板体出滚动条: body ? body.scrollHeight > body.clientHeight + 1 : null,
  }
})()`

/** 一段：货仓格板上的块（含中心点坐标与"中心点能不能点到自己"） */
const READ_FIGS = `(() => {
  const grid = document.querySelector('.app-wh-hold-grid.is-hold')
  if (!grid) return { err: '没有货仓格板' }
  const figs = [...grid.querySelectorAll('.app-wh-hold-fig')]
  const cells = [...grid.querySelectorAll('.app-wh-hold-cell')]
  const one = (f) => /span 1$/.test(f.style.gridColumn.trim()) && /span 1$/.test(f.style.gridRow.trim())
  const title = (f) => (f.getAttribute('title') || '').split('（')[0].trim()
  const names = figs.map(title)
  return {
    块数: figs.length,
    空格数: cells.filter((c) => c.classList.contains('is-free') && !c.classList.contains('is-locked')).length,
    高亮格数: cells.filter((c) => c.classList.contains('is-touch-hover')).length,
    被拖块数: figs.filter((f) => f.classList.contains('is-touch-drag')).length,
    块: figs.map((f, i) => {
      const r = f.getBoundingClientRect()
      const cx = +(r.left + r.width / 2).toFixed(1)
      const cy = +(r.top + r.height / 2).toFixed(1)
      const at = document.elementFromPoint(cx, cy)
      return {
        i,
        名: title(f).slice(0, 18),
        名唯一: names.filter((x) => x === title(f)).length === 1,
        格位: f.style.gridColumn + ' / ' + f.style.gridRow,
        单格: one(f),
        cx,
        cy,
        命中自己: !!at && (at === f || f.contains(at) || (at.closest && at.closest('.app-wh-hold-fig') === f)),
        命中的是: at ? String(at.className).slice(0, 40) : null,
      }
    }),
    提示条: [...document.querySelectorAll('.app-toast, .app-event-toast')].map((t) => (t.textContent || '').trim().slice(0, 30)),
  }
})()`
type Figs = {
  块数: number
  空格数: number
  高亮格数: number
  被拖块数: number
  块: Array<{
    i: number
    名: string
    名唯一: boolean
    格位: string
    单格: boolean
    cx: number
    cy: number
    命中自己: boolean
    命中的是: string | null
  }>
  提示条: string[]
}

async function main(): Promise<void> {
  const savePath = pickSave()
  const save = readFileSync(savePath, 'utf8')
  console.log(`档（只读注入）：${savePath}`)
  const cdp = await Cdp.connect(CDP)

  /* 手机视口 + 触摸模拟（让 App 自己进 is-mobile-rot） */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

  /* 注档赶在 App 起跑之前（见文件头坑①） */
  await cdp.send('Page.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('whale:idle:save', ${JSON.stringify(save)}); localStorage.setItem('whale-idle:locale', 'zh'); localStorage.setItem('dsh-whmobile-marker', '1') } catch (e) {}`,
  })
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '载档启动')
  await waitFor(cdp, `document.querySelector('.app-root')?.classList.contains('is-mobile-rot') === true`, '进旋转模式')
  await wait(600)

  const diag = await cdp.evalJS<Res>(`(() => {
    let name = null, whRun = false
    try { const s = JSON.parse(localStorage.getItem('whale:idle:save') || '{}'); name = s?.state?.character?.name ?? null; whRun = !!s?.state?.wormhole?.run } catch {}
    return { 档角色名: name, 档有虫洞run: whRun, 注档标记: localStorage.getItem('dsh-whmobile-marker') }
  })()`)
  console.log('档检查：' + JSON.stringify(diag))

  /* 启动时可能有模态（铁人模式 / 公告）盖在最上层 ⇒ 先关掉，否则底下什么都点不到 */
  const modal = await cdp.evalJS<{ 有: boolean; 类: string | null; 按钮: string[] }>(`(() => {
    const m = document.querySelector('.app-modal-mask')?.firstElementChild ?? document.querySelector('.app-pro-mode')
    if (!m) return { 有: false, 类: null, 按钮: [] }
    return { 有: true, 类: String(m.className), 按钮: [...m.querySelectorAll('button')].map((b) => (b.textContent || '').trim().slice(0, 14)) }
  })()`)
  if (modal.有) {
    console.log('启动模态（已尝试关闭）：' + JSON.stringify(modal))
    await cdp.evalJS<boolean>(`(() => {
      const m = document.querySelector('.app-modal-mask')?.firstElementChild ?? document.querySelector('.app-pro-mode')
      if (!m) return false
      const bs = [...m.querySelectorAll('button')]
      const b = bs.find((x) => /确定|确认|知道|关闭|好的|继续|开始|明白/.test(x.textContent || '')) ?? bs[bs.length - 1]
      if (!b) return false
      b.click()
      return true
    })()`)
    await wait(700)
  }

  /* 洞内在途 ⇒ 顶部活动栏那一条点开就是虫洞面板（与 wh-hold-geom 同一入口） */
  await cdp.evalJS(
    `(() => { const el = document.querySelector('.app-activitybar-label'); const b = el && (el.closest('.app-activitybar-item') || el.closest('button') || el); if (b) b.click(); return !!b })()`,
  )
  await waitFor(cdp, `!!document.querySelector('.app-wh-modal')`, '虫洞面板')
  await wait(500)

  console.log('\n═══ ① 探索视图：旋转模式 ＋ 全屏 ＋ 左地图 / 右操作区（逻辑空间）═══')
  const layout = await cdp.evalJS<Res>(READ_LAYOUT)
  console.log(JSON.stringify(layout, null, 1))

  /* 切「货仓」页签 → 真触摸拖拽（该档货仓是**塞满**的 ⇒ 用"两件互换"，同为 1×1） */
  const clicked = await cdp.evalJS<boolean>(
    `(() => { const t = [...document.querySelectorAll('.app-wh-tab')].find(x => /货仓|背包/.test(x.textContent||'')); if (!t) return false; t.click(); return true })()`,
  )
  if (!clicked) throw new Error('没有「货仓」页签（面板结构变了 ⇒ 按现状改选择器）')
  await waitFor(cdp, `!!document.querySelector('.app-wh-hold-scroll')`, '货仓格区')
  await wait(500)

  const before = await cdp.evalJS<Figs>(READ_FIGS)
  const blocked = before.块.filter((f) => !f.命中自己)
  console.log(
    `\n块可点性：${before.块.length} 块中 ${before.块.length - blocked.length} 块中心可点` +
      (blocked.length > 0 ? `；其余被浮层/滚动裁剪盖住（盖它的是：${[...new Set(blocked.map((b) => b.命中的是))].join(' / ')}）` : ''),
  )
  const uniq1x1 = before.块.filter((f) => f.单格 && f.名唯一 && f.命中自己)
  if (uniq1x1.length < 2) throw new Error(`需要两件"名字唯一、1×1 且中心可点"的块才能做互换（现 ${uniq1x1.length} 件）`)
  const src = uniq1x1[0]!
  const dst = uniq1x1
    .map((f) => ({ ...f, d: Math.hypot(f.cx - src.cx, f.cy - src.cy) }))
    .filter((f) => f.i !== src.i)
    .sort((a, b) => a.d - b.d)[0]!
  console.log(`拖拽（互换）：把「${src.名}」${src.格位} ⇄ 「${dst.名}」${dst.格位}`)

  /* 给这一块挂个事件记录（证明走的是**指针**路径，而不是别的什么） */
  await cdp.evalJS(`(() => {
    window.__ev = []
    const fig = [...document.querySelectorAll('.app-wh-hold-grid.is-hold .app-wh-hold-fig')].find((f) => (f.getAttribute('title') || '').startsWith(${JSON.stringify(src.名)}))
    if (fig) ['touchstart','pointerdown','pointermove','touchend','pointerup','click'].forEach((t) => fig.addEventListener(t, (e) => window.__ev.push(t + ':' + (e.pointerType || '-')), true))
    return !!fig
  })()`)

  await cdp.touch('touchStart', src.cx, src.cy)
  const STEPS = 6
  for (let i = 1; i <= STEPS; i++) {
    await cdp.touch('touchMove', src.cx + ((dst.cx - src.cx) * i) / STEPS, src.cy + ((dst.cy - src.cy) * i) / STEPS)
    await wait(80)
  }
  const mid = await cdp.evalJS<Figs>(READ_FIGS)
  const evs = await cdp.evalJS<string[]>(`window.__ev`)
  await cdp.touch('touchEnd', dst.cx, dst.cy)
  await wait(800)
  const after = await cdp.evalJS<Figs>(READ_FIGS)

  const srcAfter = after.块.find((f) => f.名 === src.名)
  const dstAfter = after.块.find((f) => f.名 === dst.名)
  const swapped = srcAfter?.格位 === dst.格位 && dstAfter?.格位 === src.格位
  console.log('\n═══ ② 触摸拖拽（真事件链）═══')
  console.log(
    JSON.stringify(
      {
        事件链: evs,
        拖动中: { 落点高亮格数: mid.高亮格数, 被拖块数: mid.被拖块数 },
        互换结果: {
          [`${src.名}_原`]: src.格位,
          [`${src.名}_现`]: srcAfter?.格位 ?? null,
          [`${dst.名}_原`]: dst.格位,
          [`${dst.名}_现`]: dstAfter?.格位 ?? null,
          真的互换了: swapped,
        },
        收尾后残留高亮: after.高亮格数,
        收尾后残留被拖标记: after.被拖块数,
        提示条: after.提示条,
      },
      null,
      1,
    ),
  )

  /* 判据（可当检查跑） */
  const L = layout as { 手机旋转模式?: boolean; 两栏并排?: boolean; 面板?: { 宽: number; 高: number }; 右操作栏?: { 宽: number } }
  const fails: string[] = []
  if (L.手机旋转模式 !== true) fails.push('没进 is-mobile-rot（手机视口下应当自动旋转）')
  if (L.两栏并排 !== true) fails.push('地图栏与右操作栏没有并排（两栏版式没生效）')
  if (!L.面板 || L.面板.宽 < 1100) fails.push(`面板逻辑宽 ${L.面板?.宽} < 1100（应铺满逻辑空间：1200 − 24）`)
  if (!swapped) fails.push('触摸拖拽没有真的互换（指针路径没生效）')
  if (fails.length > 0) {
    console.error('\n❌ ' + fails.join('；'))
    process.exit(1)
  }
  console.log('\n✅ 全部判据通过：旋转模式 · 面板铺满 · 两栏并排 · 触摸拖拽真互换')
  process.exit(0)
}

main().catch((e: unknown) => {
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
