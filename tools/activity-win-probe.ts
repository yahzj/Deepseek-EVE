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
 * 用法：`npx tsx tools/activity-win-probe.ts`（等价 `npm run ui:actwin`）
 *   可用 `UI_APP_URL` / `UI_CDP_URL` 覆盖两个地址。
 *
 * 输出：stdout —— 逐视口打印①四个活动态的真档实测（窗口尺寸 / 位置 / 居中 / 非全屏 / 文档溢出）
 * 与②两个窗口壳的几何（战斗壳用**同构元素**量，见下方"取证边界"）。不写任何文件。
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
 *   - 本工具最后核对：**2026-09-20**（当日核对：活动窗口四态 + 两壳几何，四种视口）
 *   - 本工具最后跑过：**2026-09-20**
 *   - 判据：`CURRENT_STATE_VERSION − v30 ≥ 2` ⇒ **必须重跑核对**；此外
 *     `ui/WinBox.tsx` 或 `styles.css` 的 `.app-winbox*` / `.app-float-chip` 一旦改动 ⇒ **必须重跑**。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP = process.env.UI_APP_URL ?? 'http://[::1]:4174/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'
const SAVE_DIR = join(process.cwd(), 'docs', 'test-saves')
const LOCALE_KEY = 'whale-idle:locale'
const SAVE_KEY = 'whale:idle:save'

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
    if (res.exceptionDetails) throw new Error(`页面脚本报错：${JSON.stringify(res.exceptionDetails).slice(0, 200)}`)
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

interface Reading {
  sel: string
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
}

async function read(cdp: Cdp, sel: string): Promise<Reading> {
  return cdp.evalJS<Reading>(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    const de = document.documentElement
    if (!el) return { sel: ${JSON.stringify(sel)}, found: false, w:0,h:0,left:0,top:0,position:'',docScrollW:de.scrollWidth,docScrollH:de.scrollHeight,overflowW:false,overflowH:false,title:'' }
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const t = el.querySelector('.app-winbox-title')
    return {
      sel: ${JSON.stringify(sel)}, found: true,
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), top: Math.round(r.top),
      position: cs.position,
      docScrollW: de.scrollWidth, docScrollH: de.scrollHeight,
      overflowW: de.scrollWidth > window.innerWidth + 1,
      overflowH: de.scrollHeight > window.innerHeight + 1,
      title: t ? t.textContent : '',
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

