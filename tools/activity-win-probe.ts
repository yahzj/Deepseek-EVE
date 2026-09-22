/**
 * **窗口几何读数核实 · 无头直驱**（正式入库；原临时探针 `tools/_activity-win-probe.ts` 用完转正）。
 *
 * 背景（2026-09-20 船长令）：新增**主控活动窗口**——挖矿 / 打捞 / 长途运输 / 扫描虫洞时
 * 在活动栏之下那块主内容区里播放主控正在做的活动（`ui/WinBox.tsx` 出窗口壳、`ui/ActivityScreen.tsx`
 * 出活动画面），可最小化到左上角小窗、点小窗还原。改完必须回答的是**事实类问题**——
 * "到底是不是嵌在主内容区里、有没有居中、有没有把页面挤出可视区、收得起还原得回吗"——**看代码判不了**，
 * 属约定第九章允许的两类例外之一（读数型问题）。本工具**只出读数**，**不是观感结论**：
 * 好不好看归船长判。
 *
 * ⚠ **本工具已不含战斗窗口**（2026-09-22 船长令「界面回滚，战斗界面回滚到全屏显示」）：
 * 战斗窗口曾与活动窗口共用这套窗口壳，回滚后战斗恢复全屏覆盖层 ⇒ 战斗壳几何那节与洞内战斗宿主那节
 * 一并删除。整体归档（回到嵌入形态的命令、当时读数）见 `docs/design/archived-window-embed-20260922.md`。
 *
 * 前置（外部先起好，本工具不启动也不关闭任何进程）：
 *   1) `npm --prefix web run build` 后由本地服务托管 `web/dist`；
 *      ⚠ 本机 Windows 上 `vite preview` **只监听 IPv6** ⇒ 地址要用 `http://[::1]:端口/`
 *      （`http://127.0.0.1:端口/` 连不上，别据此判断"服务没起"）；
 *   2) 无头 Chrome 带远程调试（默认 `http://127.0.0.1:9333`）。
 *
 * ⚠ **主控活动窗口有可见开关**（2026-09-20 船长令「只有开启调试模式才能看到」）：
 * `localStorage['whale-idle:debug'] === '1'`（与顶栏「⇄ 调试」同一个开关）。本工具**自动**处理：
 * 先测一节"**开关关掉时窗口与还原入口都不存在**"（那才是玩家侧形态），随后各节打开开关再测。
 * 手工验收同理——DevTools 里 `localStorage.setItem('whale-idle:debug','1')` 后刷新即可看到本窗口。
 *
 * 用法：`npx tsx tools/activity-win-probe.ts`（等价 `npm run ui:actwin`）
 *   可用 `UI_APP_URL` / `UI_CDP_URL` 覆盖两个地址。
 *
 * 输出：stdout —— 逐视口打印①各活动态的真档实测（窗口尺寸 / 位置 / **是否只在主内容区内** /
 * 文档溢出 / 演出层与画布几何读数），
 * 末尾再跑一节②**最小化 / 还原链**（CDP 真点按钮）。不写任何文件。
 *
 * ⚠ **覆盖范围读数（2026-09-21 船长令「改为覆盖在当前的主窗口上」）**：几何一律以
 * **主内容区 `.app-page-main`** 为基准（不是视口）——打印"区内居中 / 非全屏 / **不盖导航与顶栏**"。
 * 窗口组件必须挂在 `<main>` 里才成立（见 `App.tsx` 那段注释）；挪出去这三项立刻变红。
 *
 * ⚠ **演出层读数（2026-09-21 加）**：除几何外还逐场景打印
 *   - **该动却在不在动**：只对 `MUST_ANIMATE` 里的类报"没有动画"（星野 / 矿岩 / 航标本就是静态层，
 *     它们的动来自外层 float / bob 组——一律报缺陷会把正常情况报成红的）；
 *   - **美术层证据**：真实舰形节点数（`.app-wh-ship-shape` = `ShipSpriteShape` 产物）、星点数、
 *     漂浮物数、进度层元件数；
 *   - **节拍挂钩**：舞台上的 `--act-cycle` / `--act-delay` 与进度层动画实际生效的 `animation-duration`；
 *   - **画布几何**：舰 / 作业光带 / 作业对象三者的包围盒，用来判"光带接到对象上了没、光带是不是从舰体内射出、
 *     舰与对象有没有叠在一起"；
 *   - **漂浮物行程**：**声明（CSSOM 的 `@keyframes`）＋运行时多帧采样**两路证据，判"会不会半路消失"
 *     （船长 2026-09-21 报障）。只看采样不够：道具待在框外左侧的时间很短，采不到 ≠ 没出框。
 *
 * ⚠ **量画布几何时别用 `getBBox()`**（2026-09-21 首测踩坑）：它给的是**元素自己那一层的局部坐标**
 *   （不含自身与祖先的 transform），"舰（自带 scale/translate）"与"光带（画在画布绝对坐标）"两边的数
 *   根本不可比——首测把舰报成 `x20~238`，看着像跑到画布左上角，其实是未缩放的原始路径坐标。
 *   本工具改用 `getScreenCTM()` 逆变换回画布用户单位，且与**实际渲染**（含浮动位移）一致。
 *
 * ⚠ **取证边界（如实标注，别把它读成"所有活动都验过了"）**：
 *   - **采掘夹具是现场改档造的**（点开一份可载入的 v30 真档的采矿作业）：仓里的采掘档是 v1x 老档，
 *     `loadSaveFile` 判失败会回落全新档，测不到"采掘中"。
 *   - **老档载入会先跑一大段离线结算**：窗口要等渲染完才出现 ⇒ 等窗口上限设 8s，
 *     并在失败时打印游戏时钟，用来区分"窗口有问题"与"夹具没载进去"（时钟 0 秒 = 后者）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v31**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-22**（当日核对：战斗侧回滚后只剩活动窗口，删战斗壳 / 洞内宿主两节）
 *   - 本工具最后跑过：**2026-09-22**
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
 */
interface Case {
  name: string
  file: string
  expect: string
  note?: string
  /** 等窗口出现的上限（默认 8s）。离线结算量大的档渲染晚，窗口出现得慢 */
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
      const msg = JSON.parse(String((ev as MessageEvent).data)) as {
        id?: number
        error?: unknown
        result?: CdpResult
      }
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
  /**
   * **覆盖范围读数**（2026-09-21 船长令「改为覆盖在当前的主窗口上」）：
   * 窗口所在的**主内容区** `.app-page-main` 与左导航 / 顶栏的屏幕矩形（`[left, top, w, h]`）。
   * 用来判"到底盖没盖住左导航与顶栏、是不是居中在主内容区里"——这两条看代码判不了。
   */
  area: number[] | null
  nav: number[] | null
  header: number[] | null
  /** 活动栏（窗口该占的是它**下面**那块） */
  barRect: number[] | null
  /** 最小化后的还原入口（合并进左上角小窗）：小窗是不是还原按钮 + 角标文字 */
  restore: { isButton: boolean; badge: string; title: string }
  /** 主区那一页是否已让位（`display: none`）——嵌入形态的判据之一 */
  pageHidden: boolean
  /**
   * **嵌入形态读数**（2026-09-21 船长令「取消悬浮，直接嵌入主窗口」）：
   * `inline` = 窗口是不是文档流里的普通块（不是 fixed/absolute 浮层）；
   * `zIndex` = 计算值（浮层时代是 110；嵌入后应为 auto）。
   * ⚠ "浮层 vs 嵌入"看这两个就够：浮层的 `position` 一定是 fixed/absolute、且带 z-index。
   */
  embed: { position: string; zIndex: string }
}

/** 元素 → 屏幕矩形 `[left, top, w, h]`（取不到返回 null） */
const RECT_OF = (sel: string): string => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return null
  const r = el.getBoundingClientRect()
  return [r.left, r.top, r.width, r.height].map((v) => Math.round(v))
})()`

/** 还原入口读数：左上角小窗是不是被包成了还原按钮（`is-restore`）、角标写了什么、悬停说明是什么 */
const RESTORE_OF = `(() => {
  const w = document.querySelector('.app-shipwin-wrap')
  if (!w) return { isButton: false, badge: '', title: '' }
  const b = w.querySelector('.app-shipwin-badge')
  return {
    isButton: w.tagName === 'BUTTON' && w.classList.contains('is-restore') && !w.disabled,
    badge: b ? (b.textContent || '') : '',
    title: w.getAttribute('title') || '',
  }
})()`

/** 主区那一页是否已让位（嵌入形态下窗口上屏时它应该是 `display: none`） */
const PAGE_HIDDEN = `(() => {
  const p = document.querySelector('.app-page-content')
  return !!p && getComputedStyle(p).display === 'none'
})()`

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
    const empty = { sel: ${JSON.stringify(sel)}, found: false, w:0,h:0,left:0,top:0,position:'',docScrollW:de.scrollWidth,docScrollH:de.scrollHeight,overflowW:false,overflowH:false,title:'',fx:{svg:false,nodes:0,animated:[],dead:[],staticN:0},bar:null,lines:[],beat:{cycle:'',delay:'',tickDur:''},art:{ship:0,stars:0,drift:0,tick:0},bbox:{ship:null,beam:null,work:null},area:${RECT_OF('.app-page-main')},nav:${RECT_OF('.app-nav-side')},header:${RECT_OF('.app-header')},barRect:${RECT_OF('.app-activitybar')},restore:${RESTORE_OF},pageHidden:${PAGE_HIDDEN},embed:{position:'',zIndex:''} }
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
      area: ${RECT_OF('.app-page-main')},
      nav: ${RECT_OF('.app-nav-side')},
      header: ${RECT_OF('.app-header')},
      barRect: ${RECT_OF('.app-activitybar')},
      restore: ${RESTORE_OF},
      pageHidden: ${PAGE_HIDDEN},
      embed: { position: cs.position, zIndex: cs.zIndex },
    }
  })()`)
}

/**
 * 一行几何读数。**嵌入形态的口径**（2026-09-21 船长令「取消悬浮，直接嵌入主窗口」）：
 * - `嵌入=是`：窗口是文档流里的普通块（`position: static` 且无 z-index）——浮层时代这里是 `absolute` + `z-index 110`；
 * - `填满=是`：正好占住"**活动栏之下那块**"（不叠、不留缝、也不越界）；
 * - `页面让位=是`：主区那一页 `display: none`（嵌入形态靠"同一时刻只有一边上屏"实现，页面仍挂载）。
 */
function line(tag: string, r: Reading): string {
  if (!r.found) return `  ${tag.padEnd(12)} ✗ 没找到 ${r.sel}`
  const m = r.area
  const b = r.barRect
  const inline = r.embed.position === 'static' && (r.embed.zIndex === 'auto' || r.embed.zIndex === '0')
  let fillTxt = '(缺主区/活动栏读数)'
  if (m && b) {
    const barBottom = b[1]! + b[3]!
    const mainBottom = m[1]! + m[3]!
    /**
     * 「填满活动栏之下那块」的判据（不按"活动栏底边"硬算高度：活动栏自带 6px 下边距，硬算会误报）：
     * 左边与主区同列、宽 = 主区宽 − 4px（主区自带 4px 右内边距）、上边落在活动栏底边之下 10px 内、
     * 下边贴到主区底边 6px 内。
     */
    const leftOk = Math.abs(r.left - m[0]!) <= 2
    const widthOk = Math.abs(r.w - (m[2]! - 4)) <= 6
    const topOk = r.top >= barBottom - 1 && r.top <= barBottom + 10
    const bottomOk = Math.abs(r.top + r.h - mainBottom) <= 6
    fillTxt = leftOk && widthOk && topOk && bottomOk
      ? '是'
      : `否（左${leftOk ? 'ok' : '✗'} 宽${widthOk ? 'ok' : '✗'} 上${topOk ? 'ok' : `✗(活动栏底 ${Math.round(barBottom)} → 窗口 ${r.top})`} 下${bottomOk ? 'ok' : '✗'}）`
  }
  return (
    `  ${tag.padEnd(12)} ${r.w}×${r.h} @(${r.left},${r.top})  position=${r.embed.position} z=${r.embed.zIndex}` +
    `  嵌入=${inline ? '是' : '否 ⚠（还是浮层）'}  填满活动栏下那块=${fillTxt}` +
    `  页面让位=${r.pageHidden ? '是' : '否'}  标题="${r.title}"` +
    `  文档溢出=${r.overflowW || r.overflowH ? `宽${r.overflowW}/高${r.overflowH}` : '无'}`
  )
}

/** 还原入口一行读数（最小化后才该出现） */
function restoreLine(r: Reading): string {
  return r.restore.isButton
    ? `小窗已是还原按钮=是 · 角标「${r.restore.badge}」 · 悬停「${r.restore.title}」`
    : `小窗已是还原按钮=${r.restore.isButton ? '是' : '否'}`
}

/** 从 CSSOM 读漂移 keyframes 的声明（`0% { transform: translateX(620px) }` 那类） */
async function driftKeyframes(cdp: Cdp): Promise<Record<string, string[]>> {
  return cdp.evalJS<Record<string, string[]>>(`(() => {
    const out = {}
    for (const ss of document.styleSheets) {
      let rules
      try { rules = ss.cssRules } catch (e) { continue } // 跨源表读不到，跳过
      for (const r of rules) {
        if (r.type !== CSSRule.KEYFRAMES_RULE) continue
        if (r.name !== 'app-act-drift' && r.name !== 'app-act-drift-spin') continue
        out[r.name] = [...r.cssRules].map((k) => {
          const t = k.style.transform || ''
          const o = k.style.opacity ? '/op' + k.style.opacity : ''
          return k.keyText + ': ' + t + o
        })
      }
    }
    return out
  })()`)
}

/**
 * 从 `0%: translate(620px)` 这类帧文本里取出横向位移数值（取不到返回 null）。
 * ⚠ 正则要**同时认 `translateX(...)` 与 `translate(...)`**：CSSOM 会把 `translateX(620px)`
 * 规范成 `translate(620px)`（首版只认前者 ⇒ 明明读到了声明却判 null，白跑一轮）。
 */
function translateXOf(frame: string | undefined): number | null {
  if (!frame) return null
  const m = /(?:translateX|translate)\(\s*(-?[\d.]+)px/.exec(frame)
  return m ? Number(m[1]) : null
}

/**
 * 漂浮物行程：把 `.app-act-drift` 的实际渲染位置经 CTM 逆变换回画布坐标，**采 `frames` 帧取总范围**。
 * 多帧是必须的——单帧只反映那一瞬间各物的位置（见调用处注释）。
 */async function measureDriftSpan(cdp: Cdp, frames: number): Promise<[number, number] | null> {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < frames; i++) {
    const xs = await cdp.evalJS<number[][]>(`(() => {
      const svg = document.querySelector('.app-act-svg')
      if (!svg) return []
      const inv = svg.getScreenCTM().inverse()
      return [...document.querySelectorAll('.app-act-drift')].map((n) => {
        const r = n.getBoundingClientRect()
        const a = new DOMPoint(r.left, r.top).matrixTransform(inv)
        const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv)
        return [Math.round(a.x), Math.round(b.x)]
      })
    })()`)
    for (const [x0, x1] of xs) {
      lo = Math.min(lo, x0!)
      hi = Math.max(hi, x1!)
    }
    if (i < frames - 1) await new Promise((r) => setTimeout(r, 1100))
  }
  return Number.isFinite(lo) ? [lo, hi] : null
}

async function main(): Promise<void> {
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  // 先落到目标源一次：about:blank 是不透明源，localStorage 会抛 SecurityError
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.querySelector('.app-nav-side')`, '首次进入应用的源', 30000)

  // A0. **调试开关关掉时**（= 玩家侧的真实形态）：活动窗口与还原入口都**不该存在**
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
    say(
      `  ${'调试关'.padEnd(12)} 状态窗="${shipCls}"（应含 is-work-mine ⇒ 主控确实在作业）` +
        ` · 活动窗口存在=${win.found ? '是（不该）' : '否（对）'} · 还原入口=${win.restore.isButton ? '在（不该）' : '无（对）'}`,
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

    // B. 逐份夹具：注入存档 → 重载 → 读活动窗口 + 浮动标
    for (const c of CASES) {
      let text = readFileSync(join(SAVE_DIR, c.file), 'utf8')
      if (c.patch) {
        const obj = JSON.parse(text) as Record<string, unknown>
        c.patch((obj.state ?? obj) as Record<string, unknown>)
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
      say(line(c.name, act))
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
      /**
       * 漂浮物行程（船长 2026-09-21 报障「飞到窗口一半的位置就消失了」）：
       * 起点/终点都该在**画框外**（左端 < 0、右端 > 560），否则就会"半路消失"。
       *
       * ⚠ **两路证据缺一不可**：
       * ① **声明**（CSSOM 里的 `@keyframes`）——能确定地读出端点，这是判据；
       * ② **运行时采样**——证明样式确实生效（实测最右到 637~643 ≈ 起点 620 + 物宽），
       *    但**采不到最左端**：道具只在收尾 ~8% 的时间待在框外左侧，6 帧采样抓不到，
       *    所以不能拿"没采到 x<0"当缺陷（首测就这么误报过）。
       */
      const kf = await driftKeyframes(cdp)
      const span = await measureDriftSpan(cdp, vp.w === 1440 ? 6 : 1)
      for (const [name, frames] of Object.entries(kf)) {
        const f0 = frames.find((f) => f.startsWith('0%'))
        const f100 = frames.find((f) => f.startsWith('100%'))
        say(`  ${''.padEnd(12)} 漂浮物行程声明 ${name}：${f0 ?? '(缺 0%)'} → ${f100 ?? '(缺 100%)'}`)
      }
      if (span) {
        // 判据：0% 的 translateX ≥ 画布宽（起点在右框外）、100% 的 translateX + 物宽 ≤ 0（终点在左框外）
        const startX = kf['app-act-drift'] ? translateXOf(kf['app-act-drift'].find((f) => f.startsWith('0%'))) : null
        const endX = kf['app-act-drift'] ? translateXOf(kf['app-act-drift'].find((f) => f.startsWith('100%'))) : null
        const ok = startX !== null && endX !== null && startX >= 560 && endX + 26 <= 0
        say(
          `  ${''.padEnd(12)} 漂浮物横向范围实测 x${span[0]}~${span[1]}（画布 0~560·多帧采样）` +
            ` · 两端在画框外=${ok ? `是（起点 ${startX}、终点 ${endX}，均出框）` : `否 ⚠（起点 ${startX}、终点 ${endX}）`}`,
        )
      }
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
      say(`  ${''.padEnd(12)} 展开态还原入口=${act.restore.isButton ? '在（不该：窗口开着）' : '无（对）'}`)
    }
    /**
     * C. **收起链**（2026-09-21 船长令：「点击最小化或者切换导航栏之类的时候就隐藏并最小化」）：
     *    四个触发点全部**真点**核实——点最小化 / 切导航 / 开弹层 / 活动结束。
     *    ⚠ 全屏战斗时代两个窗口壳共用这套机制，回滚后只剩活动窗口一个消费方（机制同源，走一遍即可）。
     */
    if (vp.w === 1440) {
      await testCollapse(cdp)
    }
  }
  say('\n（以上均为读数；观感结论由船长判）')
}

/** D 节：最小化 → 小窗变还原按钮 → 点小窗还原（CDP 真点，不看 DOM 里"有没有元素"就算完） */
/** 载入活动夹具（采掘）并等窗口上屏 */
async function loadMiningCase(cdp: Cdp, what: string): Promise<boolean> {
  const c = CASES.find((x) => x.name === 'mining')!
  let text = readFileSync(join(SAVE_DIR, c.file), 'utf8')
  const obj = JSON.parse(text) as Record<string, unknown>
  c.patch?.((obj.state ?? obj) as Record<string, unknown>)
  text = JSON.stringify(obj).replace(/\\/g, '\\\\').replace(/`/g, '\\`')
  await cdp.evalJS(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, \`${text}\`); 1`)
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.querySelector('.app-nav-side')`, `${what}：主界面`)
  return waitFor(cdp, `document.querySelector('.app-winbox.is-activity')`, `${what}：活动窗口`)
}

/**
 * D 节：**收起链**四个触发点（CDP 真点，不看"DOM 里有没有元素"就算完）：
 * ① 点「← 最小化」→ 窗口消失 + 小窗变还原按钮；② 点小窗 → 窗口回来；
 * ③ 切导航页 → 窗口自动收起且页面回来；④ 开弹层（手册）→ 同样收起；
 * ⑤ 活动结束（用调试「⇧ 快进」把采掘这趟跑完）→ 窗口自动收起。
 */
async function testCollapse(cdp: Cdp): Promise<void> {
  if (!(await loadMiningCase(cdp, '收起链'))) return
  say('\n═══ 收起链（真点按钮 / 真切页 / 真开弹层）═══')
  const click = async (sel: string): Promise<boolean> =>
    cdp.evalJS<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`)
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  const before = await read(cdp, '.app-winbox.is-activity')
  say(`  ${'①初始'.padEnd(14)} 窗口=${before.found ? '在' : '不在'} · 页面让位=${before.pageHidden ? '是' : '否'} · ${restoreLine(before)}`)

  // ① 点顶栏那枚最小化按钮（活动窗口用壳自带的）
  if (!(await click('.app-winbox.is-activity .app-winbox-head button'))) {
    say('  ✗ 找不到最小化按钮')
    return
  }
  await wait(400)
  const min = await read(cdp, '.app-winbox.is-activity')
  say(`  ${'②点最小化后'.padEnd(14)} 窗口=${min.found ? '在（不该）' : '不在（对）'} · 页面让位=${min.pageHidden ? '是（不该）' : '否（对，页面回来了）'} · ${restoreLine(min)}`)

  // ② 点小窗（整块即还原按钮）
  if (!(await click('.app-shipwin-wrap.is-restore'))) {
    say('  ✗ 小窗不是还原按钮（点不到）')
    return
  }
  await wait(400)
  const back = await read(cdp, '.app-winbox.is-activity')
  say(`  ${'③点小窗后'.padEnd(14)} 窗口=${back.found ? '回来了（对）' : '没回来（✗）'} · ${restoreLine(back)}`)

  // ③ 切导航页（点第 2 个导航项：第 1 项是当前页的概率高，取不同的一项更稳）
  const navClicked = await cdp.evalJS<string>(`(() => {
    const items = [...document.querySelectorAll('.app-nav-side .app-nav-item')]
    const i = items.find((b) => !b.classList.contains('is-active')) || items[0]
    if (!i) return ''
    const label = (i.textContent || '').trim()
    i.click(); return label
  })()`)
  await wait(500)
  const afterNav = await read(cdp, '.app-winbox.is-activity')
  say(
    `  ${'④切导航后'.padEnd(14)} 点了「${navClicked || '(没找到导航项)'}」` +
      ` · 窗口=${afterNav.found ? '还在（✗ 该自动收起）' : '已自动收起（对）'}` +
      ` · 页面让位=${afterNav.pageHidden ? '是（✗）' : '否（对）'} · ${restoreLine(afterNav)}`,
  )

  // ④ 开弹层（手册）：先把窗口叫回来，再点顶栏那枚（文案「手册」/ 悬停「玩法说明与图鉴」）
  if (await click('.app-shipwin-wrap.is-restore')) await wait(400)
  const beforeModal = await read(cdp, '.app-winbox.is-activity')
  const hbClicked = await cdp.evalJS<boolean>(`(() => {
    const btns = [...document.querySelectorAll('.app-header .app-btn')]
    const b = btns.find((x) => {
      const t = (x.getAttribute('title') || '') + (x.textContent || '')
      return t.includes('手册') || t.includes('玩法说明与图鉴')
    })
    if (!b) return false
    b.click(); return true
  })()`)
  await wait(500)
  const afterModal = await read(cdp, '.app-winbox.is-activity')
  const modalOn = await cdp.evalJS<boolean>(`!!document.querySelector('.app-modal, .app-modal-mask')`)
  say(
    `  ${'⑤开弹层后'.padEnd(14)} 窗口开=${beforeModal.found ? '在' : '不在（前置不成立）'} · 点手册=${hbClicked ? '成' : '没找到按钮'}` +
      `（弹层出现=${modalOn ? '是' : '否'}） · 窗口=${afterModal.found ? '还在（✗ 该自动收起）' : '已自动收起（对）'}` +
      ` · 页面让位=${afterModal.pageHidden ? '是（✗）' : '否（对）'}`,
  )
  // 关掉手册，回到干净状态
  await cdp.evalJS(`(() => { const m = document.querySelector('.app-modal-mask'); if (m) m.click(); return 1 })()`)
  await wait(400)

  /**
   * ⑥ 主控活动结束 ⇒ 自动收起（船长令的第四个触发点）。
   *
   * 触发条件自己造出来：点**活动栏那一行右侧的「停止」**（`.app-activitybar .app-btn.is-warn`，
   * 采掘那行就是「停止采掘」）——这是玩家的真实操作，不是改内存。
   * ⚠ 用 MutationObserver **计数**"窗口不在 DOM 里的次数"：若该档开着循环作业，结束与重新拉起可能只隔一帧，
   * 800ms 轮询会漏掉（首测报成"没收起"）。
   */
  if (await click('.app-shipwin-wrap.is-restore')) await wait(400)
  await cdp.evalJS(`(() => {
    window.__actGone = 0
    window.__actWas = !!document.querySelector('.app-winbox.is-activity')
    // ⚠ 数**跃迁**（在 → 不在）而不是"每次不在的变动"：重渲染会让 observer 反复触发，
    // 按变动计数会得出"消失了 5 次"这种假读数（首测就是这么写的）。
    const ob = new MutationObserver(() => {
      const now = !!document.querySelector('.app-winbox.is-activity')
      if (window.__actWas && !now) window.__actGone++
      window.__actWas = now
    })
    ob.observe(document.body, { childList: true, subtree: true })
    return 1
  })()`)
  const stopClicked = await cdp.evalJS<string>(`(() => {
    const b = document.querySelector('.app-activitybar .app-btn.is-warn')
    if (!b) return ''
    const t = (b.textContent || '').trim()
    b.click(); return t || '(无文案)'
  })()`)
  let blink = 0
  for (let i = 0; i < 8; i++) {
    await wait(600)
    blink = await cdp.evalJS<number>(`window.__actGone || 0`)
    if (blink > 0) break
  }
  const afterEnd = await read(cdp, '.app-winbox.is-activity')
  say(
    `  ${'⑥活动结束后'.padEnd(14)} 点活动栏「${stopClicked || '没找到停止按钮'}」` +
      ` · 窗口曾消失=${blink > 0 ? `是（${blink} 次跃迁 ⇒ 活动结束即自动收起，对）` : '否（✗ 5s 内没等到）'}` +
      ` · 此刻窗口=${afterEnd.found ? '在（✗ 若活动确已结束）' : '不在（对）'} · 页面让位=${afterEnd.pageHidden ? '是（✗）' : '否（对）'}`,
  )
}

void main()

