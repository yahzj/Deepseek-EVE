/**
 * **窗口几何读数核实 · 无头直驱**（正式入库；原临时探针 `tools/_activity-win-probe.ts` 用完转正）。
 *
 * 背景（2026-09-20 船长令）：战斗窗口由全屏覆盖层改成**非全屏可最小化窗口**，并照它新增
 * **主控活动窗口**（`ui/WinBox.tsx` 一处实现两处消费）。改完必须回答的是**事实类问题**——
 * "到底是不是非全屏、有没有居中、有没有把页面挤出可视区"——**看代码判不了**，
 * 属约定第九章允许的两类例外之一（读数型问题）。本工具**只出读数**，**不是观感结论**：
 * 好不好看归船长判。
 *
 * 前置（外部先起好，本工具不启动也不关闭任何进程）：
 *   1) `npm --prefix web run build` 后由本地服务托管 `web/dist`；
 *      ⚠ 本机 Windows 上 `vite preview` **只监听 IPv6** ⇒ 地址要用 `http://[::1]:端口/`
 *      （`http://127.0.0.1:端口/` 连不上，别据此判断"服务没起"）；
 *   2) 无头 Chrome 带远程调试（默认 `http://127.0.0.1:9333`）。
 *
 * ⚠ **主控活动窗口有可见开关**（2026-09-20 船长令「只有开启调试模式才能看到」）：
 * `localStorage['whale-idle:debug'] === '1'`（与顶栏「⇄ 调试」同一个开关）。本工具**自动**处理：
 * 先测一节"**开关关掉时窗口与浮动标都不存在**"（那才是玩家侧形态），随后各节打开开关再测。
 * 手工验收同理——DevTools 里 `localStorage.setItem('whale-idle:debug','1')` 后刷新即可看到本窗口。
 *
 * 用法：`npx tsx tools/activity-win-probe.ts`（等价 `npm run ui:actwin`）
 *   可用 `UI_APP_URL` / `UI_CDP_URL` 覆盖两个地址。
 *
 * 输出：stdout —— 逐视口打印①四个活动态的真档实测（窗口尺寸 / 位置 / 居中 / 非全屏 / 文档溢出）
 * 与②两个窗口壳的几何（战斗壳用**同构元素**量，见下方"取证边界"）。不写任何文件。
 *
 * ⚠ **演出层读数（2026-09-21 加）**：除几何外还逐场景打印
 *   - **该动却在不在动**：只对 `MUST_ANIMATE` 里的类报"没有动画"（星野 / 矿岩 / 航标本就是静态层，
 *     它们的动来自外层 float / bob 组——一律报缺陷会把正常情况报成红的）；
 *   - **美术层证据**：真实舰形节点数（`.app-wh-ship-shape` = `ShipSpriteShape` 产物）、星点数、
 *     漂浮物数、进度层元件数；
 *   - **节拍挂钩**：舞台上的 `--act-cycle` / `--act-delay` 与进度层动画实际生效的 `animation-duration`；
 *   - **画布几何**：舰 / 作业光带 / 作业对象三者的包围盒，用来判"光带接到对象上了没、光带是不是从舰体内射出、
 *     舰与对象有没有叠在一起"。
 *
 * ⚠ **量画布几何时别用 `getBBox()`**（2026-09-21 首测踩坑）：它给的是**元素自己那一层的局部坐标**
 *   （不含自身与祖先的 transform），"舰（自带 scale/translate）"与"光带（画在画布绝对坐标）"两边的数
 *   根本不可比——首测把舰报成 `x20~238`，看着像跑到画布左上角，其实是未缩放的原始路径坐标。
 *   本工具改用 `getScreenCTM()` 逆变换回画布用户单位，且与**实际渲染**（含浮动位移）一致。
 *
 * ⚠ **取证边界（如实标注，别把它读成"实弹交火也验过了"）**：
 *   - **战斗壳量的是同构元素**（生产类名 `app-winbox is-battle` + 壳内两层）：仓里没有
 *     `phase === 'battle'` 的档，且 `combatView` 由引擎在真交火时给出、伪造不出来。
 *     量的确是真 CSS 的尺寸与居中，但**"真交火时窗口里的内容是否正常"未取证**。
 *   - **采掘夹具是现场改档造的**（点开一份可载入的 v30 真档的采矿作业）：仓里的采掘档是 v1x 老档，
 *     `loadSaveFile` 判失败会回落全新档，测不到"采掘中"。
 *   - **老档载入会先跑一大段离线结算**：窗口要等渲染完才出现 ⇒ 等窗口上限设 8s，
 *     并在失败时打印游戏时钟，用来区分"窗口有问题"与"夹具没载进去"（时钟 0 秒 = 后者）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v30**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-21**（当日核对：活动窗口四态演出细节 + 画布几何 + 节拍挂钩，三种视口）
 *   - 本工具最后跑过：**2026-09-21**
 *   - 判据：`CURRENT_STATE_VERSION − v30 ≥ 2` ⇒ **必须重跑核对**；此外
 *     `ui/WinBox.tsx` 或 `styles.css` 的 `.app-winbox*` / `.app-float-chip` 一旦改动 ⇒ **必须重跑**；
 *     `ui/activityArt.tsx` 的道具位 / 舰体尺寸一旦改动 ⇒ 也须重跑（画布几何那几行是量它的）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP = process.env.UI_APP_URL ?? 'http://[::1]:4174/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'
const SAVE_DIR = join(process.cwd(), 'docs', 'test-saves')
const LOCALE_KEY = 'whale-idle:locale'
const SAVE_KEY = 'whale:idle:save'
/**
 * 主控活动窗口的**可见开关**：`localStorage['whale-idle:debug'] === '1'`（与顶栏「⇄ 调试」同一个
 * 开关，见 `ui/ActivityScreen.tsx` 的 `activityWinEnabled()`）。探针要测这个窗口，必须先打开它；
 * 同时探针**专测一节"关掉时不可见"**——那才是玩家侧的真实形态。
 */
const DEBUG_KEY = 'whale-idle:debug'

/**
 * **该动的类**（2026-09-21 补）：探针只对这些类报"没有动画"。
 * 其余 `app-act-*`（星野、矿岩、航标、货柜、吊索、残骸）本就是**静态层**——它们的动来自外层
 * `app-act-float` / `app-act-bob` 组，一律报"无动画"会把正常情况报成缺陷。
 */
const MUST_ANIMATE = [
  'app-act-drift', 'app-act-float', 'app-act-bob',
  'app-act-beam', 'app-act-chip', 'app-act-cone',
  'app-act-trail', 'app-act-array', 'app-act-wave', 'app-act-echo', 'app-act-wh',
  'app-act-tick',
]

/** 逐行直写（管道里 `console.log` 会攒着不吐，长跑探针看不到进展） */
function say(line: string): void {
  process.stdout.write(`${line}\n`)
}

/**
 * 夹具：每份给出"期望弹哪种窗口"。
 *
 * ⚠ **两份要现场改档**（`patch`）——不是为了省事，是因为**老测试档载不进当前版本**：
 * `test-save-b1-*` 是 v1x 的老档，`loadSaveFile` 会判失败、回落全新档（实测时钟"在线 0 秒"），
 * 于是测不到"采掘中"。故用**能载入的 v30 真档**（王富贵那份）现场点开采矿作业。
 * 交火同理：仓里没有 `phase==='battle'` 的档，用一份带虫洞运行的 v30 真档直接改 phase。
 */
interface Case {
  name: string
  file: string
  expect: string
  note?: string
  /** 等窗口出现的上限（默认 8s）。离线结算量大的档渲染晚；交火档要等引擎推进到 battle */
  waitMs?: number
  patch?: (s: Record<string, unknown>) => void
}

const CASES: Case[] = [
  {
    name: 'mining',
    file: 'user-backup-20260920-102449.json',
    expect: '.app-winbox.is-activity',
    note: '现场点开采矿作业（该档停在母港、可载入）',
    patch: (s) => {
      const m = s.mining as Record<string, unknown>
      m.active = true
      m.beltId = 'belt-fortune'
      m.phase = 'mining'
      m.cycleAccMs = 21_000
      m.phaseAccMs = 0
      m.tripUnits = 1_234
      m.originGalaxy = 'galaxy-hub'
    },
  },
  {
    name: 'salvage',
    file: 'user-backup-20260920-102449.json',
    expect: '.app-winbox.is-activity',
    note: '现场点开打捞作业（该档的 colossal 装了 2 台打捞器，周期各 6000ms）',
    patch: (s) => {
      s.shipId = 'sh-colossal'
      const sv = s.salvaging as Record<string, unknown>
      sv.active = true
      sv.galaxyId = 'galaxy-hub'
      sv.phase = 'salvaging'
      sv.phaseAccMs = 0
      sv.cycleAccMs = 4_000 // 步长 6000ms ⇒ 进度条应约 67%
      sv.tripM3 = 1_240
      sv.deviceAccMs = {}
    },
  },
  { name: 'haul-legs2', file: 'test-save-wh-all-20260914-122105.json', expect: '.app-winbox.is-activity', note: '承运段' },
  {
    name: 'haul-legs1',
    file: 'test-save-wh-layer4-20260914-084953.json',
    expect: '.app-winbox.is-activity',
    note: '就位段（修前落 travel ⇒ 不弹窗，本批已改）',
  },
  { name: 'scan-wh', file: 'save-20260920-164822.json.json', expect: '.app-winbox.is-activity', note: '扫描虫洞（真档）' },
]

type CdpResult = Record<string, unknown>

class Cdp {
  private seq = 0
  private readonly waiting = new Map<number, { res: (v: CdpResult) => void; rej: (e: Error) => void }>()
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String((ev as MessageEvent).data)) as { id?: number; error?: unknown; result?: CdpResult }
      if (msg.id === undefined) return
      const w = this.waiting.get(msg.id)
      if (!w) return
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
    return new Promise<CdpResult>((res, rej) => {
      this.waiting.set(id, { res, rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evalJS<T>(expr: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    const res = r as { result?: { value?: T }; exceptionDetails?: unknown }
    if (res.exceptionDetails) throw new Error(`页面脚本报错：${JSON.stringify(res.exceptionDetails).slice(0, 1500)}`)
    return res.result?.value as T
  }
}

async function waitFor(cdp: Cdp, expr: string, what: string, timeoutMs = 20000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await cdp.evalJS<boolean>(`!!(${expr})`)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  say(`    [!] 等不到：${what}`)
  return false
}

interface Reading {  sel: string
  found: boolean
  w: number
  h: number
  left: number
  top: number
  position: string
  docScrollW: number
  docScrollH: number
  overflowW: boolean
  overflowH: boolean
  title: string
  /** 演出层诊断：SVG 在不在、动画元件几个、关键动画类的 animation-name（`none` = 没跑起来） */
  fx: { svg: boolean; nodes: number; animated: string[]; dead: string[]; staticN: number }
  /** 进度条：宽度百分比 + 文案（没有进度条时为 null） */
  bar: string | null
  /** 底栏读数原文（真相在读数与进度条，动画只管动感） */
  lines: string[]
  /** 节拍挂钩：舞台上的 `--act-cycle` / `--act-delay`（真实作业周期与已走毫秒，见 beatStyle） */
  beat: { cycle: string; delay: string; tickDur: string }
  /** 美术层证据：真实舰形节点数（`.app-wh-ship-shape` = ShipSpriteShape 产物）、星点数、漂浮物数 */
  art: { ship: number; stars: number; drift: number; tick: number }
  /**
   * **画布坐标几何**（`getScreenCTM()` 逆变换回 SVG 用户单位，与屏幕缩放无关）：
   * 舰 / 作业光带 / 作业对象（矿岩 / 残骸 / 航标 / 虫洞候选）三者的包围盒。
   * 用来回答"光带到底有没有接到作业对象上、舰与对象有没有叠在一起"——看代码判不了的那类读数。
   */
  bbox: { ship: number[] | null; beam: number[] | null; work: number[] | null }
}

/**
 * 画布坐标几何：把元素**实际渲染**的屏幕矩形经 `getScreenCTM()` 逆变换回 SVG 用户单位。
 *
 * ⚠ 不用 `getBBox()`：它给的是**元素自己那一层的局部坐标**（不含自身与祖先的 transform），
 * 于是"舰（自带 scale/translate）"与"光带（画在画布绝对坐标）"两边的数不可比——
 * 2026-09-21 首测就踩了这个坑（舰报 x20~238，看着像跑到画布左上角，其实是未缩放的原始路径坐标）。
 * 经 CTM 逆变换后，所有元素都落在同一套画布坐标里，且**与实际渲染（含浮动/动画位移）一致**。
 */
const BBOX_OF = (root: string, sel: string): string => `(() => {
  const win = document.querySelector(${JSON.stringify(root)})
  const svg = win && win.querySelector('.app-act-svg')
  const n = win && win.querySelector(${JSON.stringify(sel)})
  if (!svg || !n || !n.getBoundingClientRect) return null
  const inv = svg.getScreenCTM().inverse()
  const a = new DOMPoint(n.getBoundingClientRect().left, n.getBoundingClientRect().top).matrixTransform(inv)
  const b = new DOMPoint(n.getBoundingClientRect().right, n.getBoundingClientRect().bottom).matrixTransform(inv)
  return [a.x, a.y, b.x - a.x, b.y - a.y].map((v) => Math.round(v))
})()`

async function read(cdp: Cdp, sel: string): Promise<Reading> {
  return cdp.evalJS<Reading>(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    const de = document.documentElement
    const empty = { sel: ${JSON.stringify(sel)}, found: false, w:0,h:0,left:0,top:0,position:'',docScrollW:de.scrollWidth,docScrollH:de.scrollHeight,overflowW:false,overflowH:false,title:'',fx:{svg:false,nodes:0,animated:[],dead:[],staticN:0},bar:null,lines:[],beat:{cycle:'',delay:'',tickDur:''},art:{ship:0,stars:0,drift:0,tick:0},bbox:{ship:null,beam:null,work:null} }
    if (!el) return empty
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const t = el.querySelector('.app-winbox-title')
    /**
     * 演出层：逐类查 computed animation-name。
     * ⚠ 只有**该动**的类（MUST_ANIMATE）没动画才算异常——星野 / 矿岩 / 航标本就是静态层
     * （它们的动是外层 float / bob 组带出来的），一律报"无动画"会把正常情况报成缺陷。
     */
    const MUST = ${JSON.stringify(MUST_ANIMATE)}
    const nodes = [...el.querySelectorAll('[class*="app-act-"]')]
    const skip = ['app-act-svg','app-act-stage','app-act-dock','app-act-line','app-act-progress','app-act-bar','app-act-pct']
    const animated = [], dead = []
    let staticN = 0
    for (const n of nodes) {
      const cls = [...n.classList].find((c) => c.startsWith('app-act-') && !skip.includes(c))
      if (!cls) continue
      const an = getComputedStyle(n).animationName
      const live = an && an !== 'none'
      if (live) animated.push(cls)
      else if (MUST.includes(cls)) dead.push(cls)
      else staticN++
    }
    const barEl = el.querySelector('.app-act-bar')
    const stage = el.querySelector('.app-act-stage')
    const tickEl = el.querySelector('.app-act-tick')
    const shipEl = el.querySelector('.app-wh-ship-shape')
    return {
      sel: ${JSON.stringify(sel)}, found: true,
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), top: Math.round(r.top),
      position: cs.position,
      docScrollW: de.scrollWidth, docScrollH: de.scrollHeight,
      overflowW: de.scrollWidth > window.innerWidth + 1,
      overflowH: de.scrollHeight > window.innerHeight + 1,
      title: t ? t.textContent : '',
      fx: { svg: !!el.querySelector('.app-act-svg'), nodes: nodes.length, animated: [...new Set(animated)], dead: [...new Set(dead)], staticN },
      bar: barEl ? (barEl.style.width || '0%') : null,
      lines: [...el.querySelectorAll('.app-act-line')].map((n) => n.textContent || ''),
      beat: stage ? {
        cycle: stage.style.getPropertyValue('--act-cycle') || '(未设)',
        delay: stage.style.getPropertyValue('--act-delay') || '(未设)',
        tickDur: tickEl ? getComputedStyle(tickEl).animationDuration : '',
      } : { cycle: '', delay: '', tickDur: '' },
      art: {
        ship: shipEl ? shipEl.querySelectorAll('path,rect,circle,ellipse,polygon,line').length : 0,
        stars: el.querySelectorAll('.app-act-stars circle').length,
        drift: el.querySelectorAll('.app-act-drift').length,
        tick: el.querySelectorAll('.app-act-tick').length,
      },
      bbox: {
        ship: ${BBOX_OF('.app-winbox.is-activity', '.app-wh-ship-shape')},
        beam: ${BBOX_OF('.app-winbox.is-activity', '.app-act-beam')},
        work: ${BBOX_OF('.app-winbox.is-activity', '.app-act-rock, .app-act-wreck-a, .app-act-gate, .app-act-wh')},
      },
    }
  })()`)
}

function line(tag: string, r: Reading, vw: number, vh: number): string {
  if (!r.found) return `  ${tag.padEnd(12)} ✗ 没找到 ${r.sel}`
  const centered = Math.abs(r.left - (vw - r.w) / 2) <= 2 && Math.abs(r.top - (vh - r.h) / 2) <= 2
  const notFull = r.w < vw - 8 && r.h < vh - 8
  return (
    `  ${tag.padEnd(12)} ${r.w}×${r.h} @(${r.left},${r.top})  position=${r.position}` +
    `  居中=${centered ? '是' : '否'}  非全屏=${notFull ? '是' : '否'}` +
    `  文档溢出=${r.overflowW || r.overflowH ? `宽${r.overflowW}/高${r.overflowH}` : '无'}` +
    (r.title ? `  标题="${r.title}"` : '')
  )
}

async function main(): Promise<void> {
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  // 先落到目标源一次：about:blank 是不透明源，localStorage 会抛 SecurityError
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.querySelector('.app-nav-side')`, '首次进入应用的源', 30000)

  // A0. **调试开关关掉时**（= 玩家侧的真实形态）：活动窗口与浮动还原标都**不该存在**
  await cdp.evalJS(`localStorage.removeItem(${JSON.stringify(DEBUG_KEY)}); 1`)
  for (const c of CASES.filter((x) => x.name === 'mining')) {
    let t = readFileSync(join(SAVE_DIR, c.file), 'utf8')
    if (c.patch) {
      const obj = JSON.parse(t) as Record<string, unknown>
      c.patch((obj.state ?? obj) as Record<string, unknown>)
      t = JSON.stringify(obj)
    }
    t = t.replace(/\\/g, '\\\\').replace(/`/g, '\\`')
    await cdp.evalJS(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, \`${t}\`); 1`)
    await cdp.send('Page.navigate', { url: APP })
    await waitFor(cdp, `document.querySelector('.app-nav-side')`, '主界面（调试关）')
    // 主控确实在采矿（状态窗应显示 is-work-mine）——用来证明"不是没活动，而是窗口被开关挡住了"
    const shipCls = await cdp.evalJS<string>(`((document.querySelector('.app-shipwin')||{}).className) || ''`)
    const win = await read(cdp, '.app-winbox.is-activity')
    const chip = await read(cdp, '.app-float-chip')
    say(
      `  ${'调试关'.padEnd(12)} 状态窗="${shipCls}"（应含 is-work-mine ⇒ 主控确实在作业）` +
        ` · 活动窗口存在=${win.found ? '是（不该）' : '否（对）'} · 浮动还原标=${chip.found ? '是（不该）' : '否（对）'}`,
    )
  }
  // 之后各节一律**打开**调试开关（本窗口的可见前提）
  await cdp.evalJS(`localStorage.setItem(${JSON.stringify(DEBUG_KEY)}, '1'); 1`)

  for (const vp of [{ w: 1440, h: 900 }, { w: 1280, h: 800 }, { w: 1024, h: 768 }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false,
    })
    say(`\n═══ 视口 ${vp.w}×${vp.h} ═══`)

    // A. 无活动（空档）：不该有活动窗口
    await cdp.evalJS(`localStorage.setItem(${JSON.stringify(LOCALE_KEY)}, 'zh'); localStorage.removeItem(${JSON.stringify(SAVE_KEY)}); 1`)
    await cdp.send('Page.navigate', { url: APP })
    await waitFor(cdp, `document.querySelector('.app-nav-side')`, '主界面就绪')
    const idle = await read(cdp, '.app-winbox.is-activity')
    say(`  ${'空档'.padEnd(12)} 活动窗口存在=${idle.found ? '是（不该）' : '否（对）'}`)

    // B. 逐份夹具：注入存档 → 重载 → 读活动窗口 + 战斗窗口 + 浮动标
    for (const c of CASES) {
      let text = readFileSync(join(SAVE_DIR, c.file), 'utf8')
      if (c.patch) {
        const obj = JSON.parse(text) as Record<string, unknown>
        const inner = (obj.state ?? obj) as Record<string, unknown>
        c.patch(inner)
        text = JSON.stringify(obj)
      }
      text = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`')
      await cdp.evalJS(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, \`${text}\`); 1`)
      await cdp.send('Page.navigate', { url: APP })
      await waitFor(cdp, `document.querySelector('.app-nav-side')`, `${c.name} 主界面`)
      const ok = await waitFor(cdp, `document.querySelector(${JSON.stringify(c.expect)})`, `${c.name} 的活动窗口`, c.waitMs ?? 8000)
      if (!ok) {
        const anyWin = await read(cdp, '.app-winbox')
        // 诊断：区分"窗口有问题"与"夹具没载进去"——游戏时钟（新档 = 0 天；老档 = 第 N 天）
        const clock = await cdp.evalJS<string>(`(document.querySelector('.app-clock')||{}).textContent || ''`)
        say(`  ${c.name.padEnd(12)} ✗ 期望 ${c.expect}；.app-winbox found=${anyWin.found}  时钟="${clock}"（新档=夹具没载进去）`)
        continue
      }
      const act = await read(cdp, c.expect)
      const battle = await read(cdp, '.app-winbox.is-battle')
      const chip = await read(cdp, '.app-float-chip')
      say(line(c.name, act, vp.w, vp.h))
      // 演出诊断：SVG 在不在、动画元件数、哪些类真的跑着动画、哪些类没接上 CSS、进度条宽度
      say(
        `  ${''.padEnd(12)} 演出 SVG=${act.fx.svg ? '有' : '无'} · 元件 ${act.fx.nodes} 个` +
          ` · 动画中 [${act.fx.animated.join(', ')}]` +
          (act.fx.dead.length > 0 ? ` · ⚠ 该动却没动 [${act.fx.dead.join(', ')}]` : '') +
          ` · 静态层 ${act.fx.staticN} 个 · 进度条=${act.bar ?? '(无)'}`,
      )
      // 美术层证据（2026-09-21 补细节）：真实舰形节点数 / 星点 / 漂浮物 / 进度层元件
      say(
        `  ${''.padEnd(12)} 舰形=${act.art.ship > 3 ? `资产形(${act.art.ship} 节点)` : `⚠ 疑似回退剪影(${act.art.ship} 节点)`}` +
          ` · 星点=${act.art.stars} 个 · 漂浮物=${act.art.drift} 个 · 进度层元件=${act.art.tick} 个`,
      )
      // 节拍挂钩证据：真实周期与已走毫秒（`--act-*`）＋进度层动画实际生效的 duration
      say(
        `  ${''.padEnd(12)} 节拍 --act-cycle=${act.beat.cycle} --act-delay=${act.beat.delay}` +
          ` · 进度层 duration=${act.beat.tickDur || '(无)'}`,
      )
      // 画布坐标几何（逆 CTM 回画布用户单位）：舰 / 光带 / 作业对象是否接得上、叠不叠
      const [sb, bb, wb] = [act.bbox.ship, act.bbox.beam, act.bbox.work]
      const fmt = (b: number[] | null): string => (b ? `x${b[0]}~${b[0]! + b[2]!} y${b[1]}~${b[1]! + b[3]!}` : '(无)')
      const gap = sb && wb ? wb[0]! - (sb[0]! + sb[2]!) : null
      const touch = bb && wb ? bb[0]! + bb[2]! - wb[0]! : null
      const anchored = bb && sb ? bb[0]! - (sb[0]! + sb[2]!) : null
      const inside = sb && wb ? (sb[0]! + sb[2]! <= wb[0]! ? '不叠（舰在左，对象在右）' : '⚠ 舰与对象重叠') : ''
      say(
        `  ${''.padEnd(12)} 画布几何 舰[${fmt(sb)}] 作业对象[${fmt(wb)}] 光带[${fmt(bb)}]` +
          ` · 舰与对象间距=${gap ?? '—'} ${inside}` +
          (touch === null ? '' : ` · 光带抵达对象=${touch >= -6 ? `是(深入 ${touch})` : `否(差 ${-touch})`}`) +
          (anchored === null ? '' : ` · 光带起于舰内=${anchored <= 0 ? '是' : `否(离舰 ${anchored})`}`),
      )
      say(`  ${''.padEnd(12)} 读数 [${act.lines.join(' | ')}]`)
      say(`  ${''.padEnd(12)} 战斗窗口存在=${battle.found ? '是' : '否'}  浮动还原标存在=${chip.found ? '是' : '否'}`)
    }
    /**
     * C. **两个窗口壳的几何**：活动壳已由上面真档实测；战斗壳仓里没有 `phase==='battle'` 的档、
     *    也伪造不出 `combatView`（引擎只在真交火时给）⇒ 量**同构元素**（生产类名 + 壳内两层）。
     *    量的是真 CSS，但**不是实弹交火**——读数表里标注。
     */
    const shells = await cdp.evalJS<Record<string, { w: number; h: number; left: number; top: number }>>(`(() => {
      const mk = (cls) => {
        const layer = document.createElement('div'); layer.className = 'app-winbox-layer'
        const box = document.createElement('div'); box.className = cls
        const head = document.createElement('div'); head.className = 'app-winbox-head'
        const body = document.createElement('div'); body.className = 'app-winbox-body'
        box.append(head, body); layer.append(box); document.body.append(layer)
        const r = box.getBoundingClientRect(); layer.remove()
        return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) }
      }
      return { battle: mk('app-winbox is-battle'), activity: mk('app-winbox is-activity') }
    })()`)
    for (const [k, label] of [['battle', '战斗壳(同构)'], ['activity', '活动壳(同构)']] as const) {
      const o = shells[k]!
      const centered = Math.abs(o.left - (vp.w - o.w) / 2) <= 2 && Math.abs(o.top - (vp.h - o.h) / 2) <= 2
      const notFull = o.w < vp.w - 8 && o.h < vp.h - 8
      say(`  ${label.padEnd(12)} ${o.w}×${o.h} @(${o.left},${o.top})  居中=${centered ? '是' : '否'}  非全屏=${notFull ? '是' : '否'}`)
    }
  }
  say('\n（以上均为读数；观感结论由船长判）')
}

void main()

