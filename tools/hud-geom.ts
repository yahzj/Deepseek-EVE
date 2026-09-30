/**
 * **工业 HUD 页 · 跨窗口几何读数**（正式入库；原临时探针 `tools/_hud-geom.ts` 按工具纪律转正）。
 *
 * 背景（2026-09-30 船长 ④ 号报障）：「**精炼炉左侧使用的是固定宽度、不随窗口缩放**」——
 * 根因是 HUD 的嵌套 `.hud-grid` 没写 `minmax(0, 1fr)`（隐式 `auto` 轨道的下限 = 内容最小宽），
 * 列里的面板/表格被按"内容最小宽 690px"排版 ⇒ 列不跟窗口、超出的部分被邻列盖住。
 * 本工具把这件事变成**可复跑的读数**：四个页签 × 五档窗口，逐列量"谁越出了列"。
 *
 * 判据（代码内是硬的）：
 *   ① 两栏时 左列 : 右列 = 1.5 : 1（页面区宽 × 0.6 / × 0.4）；折列档下两列等宽（单列回落）；
 *   ② 列里的**表格不得越出列**（`scrollWidth ≤ clientWidth` 且表右边 ≤ 列右边）；
 *   ③ 列里的**面板不得越出列**；
 *   ④ `.hud-body` 不得出现横向滚动条。
 * **只出读数，不做观感结论**（观感归船长）。
 *
 * 运行前置（与 `ui-probe.ts` 同款）：
 *   1) 桌面端渲染产物已构建并被本地服务托管：`npm run build -w @whale/desktop` 后
 *      把 `apps/desktop/out/renderer` 挂到 `http://localhost:4173/`（任一静态服务器均可）；
 *   2) 无头 Chrome 带远程调试（默认 CDP `127.0.0.1:9333`，探针端口用非默认值、先探占用）；
 *   3) 输入档：`docs/test-saves/save-20260928-181547.json.json`（中后期真档，精炼炉有 25 条工位）。
 *
 * 用法：
 *   npx tsx tools/hud-geom.ts        # 4 页签 × 5 档窗口；顺带把精炼炉每档截到 `_ui-artifacts/shots/`
 *   npm run ui:hud-geom              # 等价（见 package.json）
 *   UI_SAVE=<档路径> npx tsx tools/hud-geom.ts   # 换输入档
 *
 * 输出：控制台逐行读数（`✅ 全在列内` / `❌ 越出 +Npx`）＋ `tools/_ui-artifacts/shots/hud-refine-<宽>x<高>.png`
 *   （**可重建、不入库**）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v31**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-30**（当日核对：四页签 × 五档窗口无越出、无页内横滚；
 *     1600/1920 两栏 60:40，1280/1340/1440 单列回落）
 *   - 本工具最后跑过：**2026-09-30**
 *   - 判据：`CURRENT_STATE_VERSION − v31 ≥ 2` ⇒ **必须重跑核对**（存档结构跨了一个大版本，
 *     注入档与页面结构都可能失效）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SHOT_DIR = join(process.cwd(), 'tools', '_ui-artifacts', 'shots')

const APP = process.env.UI_APP_URL ?? 'http://localhost:4173/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'
const SAVE = process.env.UI_SAVE ?? 'docs/test-saves/save-20260928-181547.json.json'
const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [1280, 860],
  [1400, 900],
  [1440, 900],
  [1460, 900],
  [1600, 1000],
]
const TABS = ['精炼炉', '组装机', '造船厂', '实验室'] as const

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
    if (!page) throw new Error('没找到 page 目标')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res())
      ws.addEventListener('error', () => rej(new Error('CDP 连接失败')))
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

async function waitFor(cdp: Cdp, expr: string, what: string, timeoutMs = 20000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      if (await cdp.evalJS<boolean>(`!!(${expr})`)) return
    } catch {
      /* 页面切换中 */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时：${what}`)
    await sleep(150)
  }
}

interface Col {
  宽: number
  面板越出: number
  表: Array<{ 宽: number; 溢出: number; 右边越出: number }>
}
interface Grid {
  宽: number
  列: Col[]
}
interface Read {
  视口: number
  页面区宽: number
  页内横滚: number
  网格: Grid[]
}

/** 工位面板 · 折叠 ＋ 动图读数（**2026-09-30 船长令**：工位可最小化成标题栏 ＋ 最左列换精炼动图） */
const READ_STATION = `(() => {
  const R = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height) } }
  const panels = [...document.querySelectorAll('.hud-body .hud-panel')]
  const head = document.querySelector('[aria-controls="hud-station-body"]')
  const panel = head ? head.closest('.hud-panel') : null
  const tr = document.querySelector('.hud-table.is-station tbody tr')
  const b = document.querySelector('.hud-body')
  return {
    折叠按钮: head !== null,
    ariaExpanded: head ? head.getAttribute('aria-expanded') : null,
    无障碍名: head ? head.getAttribute('aria-label') : null,
    工位面板: panel ? R(panel) : null,
    正文在否: document.getElementById('hud-station-body') !== null,
    动图槽数: document.querySelectorAll('.hud-fx-cell .app-inv-fx').length,
    动图种类: [...new Set([...document.querySelectorAll('.hud-fx-cell .app-inv-fx')].map((e) => [...e.classList].find((c) => c.startsWith('is-'))))],
    运行中动画数: document.getAnimations ? document.getAnimations().filter((a) => a.playState === 'running').length : -1,
    下一面板top: panels[1] ? R(panels[1]).top : null,
    工位行高: tr ? Math.round(tr.getBoundingClientRect().height) : null,
    页内横滚: b ? Math.round(b.scrollWidth - b.clientWidth) : null,
    表溢出: (() => { const t = document.querySelector('.hud-table.is-station'); return t ? Math.round(t.scrollWidth - t.clientWidth) : null })(),
  }
})()`

/** 帧率采样（2 秒 rAF 计数）——用来回答船长「逐行都动有什么性能压力」 */
const FPS = `new Promise((res) => {
  let n = 0
  const t0 = performance.now()
  const step = () => {
    n += 1
    const dt = performance.now() - t0
    if (dt < 2000) requestAnimationFrame(step)
    else res({ fps: Math.round(n / (dt / 1000)), frames: n, ms: Math.round(dt) })
  }
  requestAnimationFrame(step)
})`

/** 页面侧读数：两列网格的列宽 / 面板越出 / 表格溢出与越出 */
const READ = `(() => {
  const R = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), right: Math.round(b.right) } }
  const body = document.querySelector('.hud-body')
  const out = { 视口: window.innerWidth, 页面区宽: body ? Math.round(body.clientWidth) : null, 页内横滚: body ? Math.round(body.scrollWidth - body.clientWidth) : null, 网格: [] }
  if (!body) return out
  for (const g of body.querySelectorAll('.hud-grid.two')) {
    const gr = R(g)
    const 列 = [...g.children].map((c) => {
      const cr = R(c)
      const 面板 = [...c.querySelectorAll('.hud-panel')].map((p) => Math.round(R(p).right - cr.right))
      const 表 = [...c.querySelectorAll('table')].map((t) => ({
        宽: Math.round(R(t).width),
        溢出: Math.round(t.scrollWidth - t.clientWidth),
        右边越出: Math.round(R(t).right - cr.right),
      }))
      return { 宽: cr.w, 面板越出: 面板.length ? Math.max(...面板) : 0, 表 }
    })
    out.网格.push({ 宽: gr.w, 列 })
  }
  return out
})()`

/**
 * **悬停卡抽查**（船长令：投料窗口内也要有那张卡，且要能用到组装机/造船厂）：
 * 真发 `Input.dispatchMouseEvent` 到第 `idx` 行的中部——全仓提示有 500ms 停驻延迟 ⇒ 等 900ms 再读 `.app-tip`。
 */
async function hoverRowTip(cdp: Cdp, label: string, selector: string, idx = 0): Promise<void> {
  const box = await cdp.evalJS<{ x: number; y: number } | null>(`(() => {
    const rows = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((t) => t.getBoundingClientRect().height > 0)
    const pick = rows[${idx}]
    if (!pick) return null
    const b = pick.getBoundingClientRect()
    return { x: Math.round(b.left + 24), y: Math.round(b.top + b.height / 2) }
  })()`)
  if (box === null) {
    console.log(`  悬停卡·${label}：行没找到`)
    return
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 })
  await sleep(900)
  const tip = await cdp.evalJS<string>(
    `(() => {
      const t = document.querySelector('.app-tip')
      if (t) {
        const b = t.getBoundingClientRect()
        /* 顺带量"盒宽"与"有没有行被折"（船长 2026-09-30：「悬浮窗建议加宽50~100px」）：
           scrollWidth 大于 clientWidth ＝ 有内容横向溢出。 */
        return '［盒 ' + Math.round(b.width) + '×' + Math.round(b.height) + ' · 横溢 ' + Math.round(t.scrollWidth - t.clientWidth) + '］ ' +
          t.innerText.replace(/\\s+/g, ' ').slice(0, 220)
      }
      const under = document.elementFromPoint(${box.x}, ${box.y})
      return '（无卡）落点=' + (under ? under.tagName + '.' + String(under.className).slice(0, 40) : 'null')
    })()`,
  )
  console.log(`  悬停卡·${label}：${tip}`)
}

async function main(): Promise<void> {
  const text = readFileSync(SAVE, 'utf8')
  const cdp = await Cdp.connect(CDP)
  try {
    /* ⚠ 注入必须**在应用脚本跑起来之前**完成：应用一启动就有自动存档（130+ 处 `persist()`），
       先加载页面再写 localStorage 会被它几百毫秒内覆盖回新档（本探针第一版就栽在这）。
       ⇒ 用 `Page.addScriptToEvaluateOnNewDocument`（每个新文档先于页面脚本执行）。 */
    await cdp.send('Page.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        `try { localStorage.setItem('whale:idle:save', ${JSON.stringify(text)});` +
        ` localStorage.setItem('whale-idle:debug', '1');` +
        ` localStorage.setItem('whale-idle:locale', 'zh'); } catch (e) {}`,
    })
    for (const [w, h] of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await cdp.send('Page.navigate', { url: APP })
      await waitFor(cdp, `!!document.querySelector('.app-nav, nav, .app-root')`, '应用外壳')
      await sleep(1400)
      const ok = await cdp.evalJS<boolean>(`(() => {
        const b = [...document.querySelectorAll('button, a')].find((x) => (x.textContent || '').includes('工业 HUD'))
        if (!b) return false
        b.click(); return true
      })()`)
      if (!ok) throw new Error('没找到「工业 HUD」导航项（调试模式没开？）')
      await waitFor(cdp, `!!document.querySelector('.hud')`, '工业 HUD 页')
      for (const tab of TABS) {
        await cdp.evalJS<boolean>(`(() => {
          const t = [...document.querySelectorAll('.hud-tab')].find((x) => (x.textContent || '').includes(${JSON.stringify(tab)}))
          if (!t) return false
          t.click(); return true
        })()`)
        await sleep(800)
        const r = await cdp.evalJS<Read>(READ)
        if (tab === '精炼炉') {
          const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string }
          if (shot.data) writeFileSync(join(SHOT_DIR, `hud-refine-${w}x${h}.png`), Buffer.from(shot.data, 'base64'))
        }
        const 违规: string[] = []
        if (r.页内横滚 > 0) 违规.push(`页内横滚 +${r.页内横滚}`)
        for (const g of r.网格) {
          if (g.列.length === 2 && g.列[0]!.宽 < g.宽 - 1) {
            const [l, rt] = g.列 as [Col, Col]
            const 占比 = Math.round((l.宽 / (l.宽 + rt.宽)) * 100)
            if (占比 !== 60) 违规.push(`列占比 ${占比}%`)
            l.表.forEach((t) => {
              if (t.溢出 > 0 || t.右边越出 > 0) 违规.push(`左列表越出 +${Math.max(t.溢出, t.右边越出)}`)
            })
            rt.表.forEach((t) => {
              if (t.溢出 > 0 || t.右边越出 > 0) 违规.push(`右列表越出 +${Math.max(t.溢出, t.右边越出)}`)
            })
            if (l.面板越出 > 0) 违规.push(`左列面板越出 +${l.面板越出}`)
            if (rt.面板越出 > 0) 违规.push(`右列面板越出 +${rt.面板越出}`)
          } else {
            g.列.forEach((c, i) => {
              c.表.forEach((t) => {
                if (t.溢出 > 0 || t.右边越出 > 0) 违规.push(`单列[${i}]表越出 +${Math.max(t.溢出, t.右边越出)}`)
              })
            })
          }
        }
        const 列串 = r.网格.map((g) => g.列.map((c) => `${c.宽}(表${c.表.map((t) => t.宽).join('+') || '—'})`).join(' : ')).join(' ／ ')
        console.log(
          `视口 ${w} · ${tab}｜页面区 ${r.页面区宽}｜${r.网格.length} 组两列：${列串}｜页内横滚 ${r.页内横滚}｜` +
            (违规.length === 0 ? '✅ 全在列内' : `❌ ${违规.join(' · ')}`),
        )
        /* 工位面板专项：折叠前后 ＋ 动图槽 ＋（1600 档）帧率对照
           —— 船长问「动画密度如果逐行都动有什么性能压力吗」，读数分两档：
           ① 逐行动（默认）② `prefers-reduced-motion: reduce`（同一份代码、动画全停）⇒ 差值即动画成本。 */
        if (tab === '精炼炉') {
          const before = await cdp.evalJS<Record<string, unknown>>(READ_STATION)
          const folded = await cdp.evalJS<boolean>(`(() => {
            const b = document.querySelector('[aria-controls="hud-station-body"]')
            if (!b) return false
            b.click(); return true
          })()`)
          await sleep(300)
          const after = await cdp.evalJS<Record<string, unknown>>(READ_STATION)
          console.log(`  折叠前 ${JSON.stringify(before)}`)
          if (folded) console.log(`  折叠后 ${JSON.stringify(after)}`)
          await cdp.evalJS(`(() => { const b = document.querySelector('[aria-controls="hud-station-body"]'); if (b) b.click(); return true })()`)
          await sleep(300)
          if (w === 1600) {
            /* 帧率取样 3 次取中位数（单次 2 秒的抖动很大，报给船长的是中位数） */
            const sample = async (): Promise<number> => (await cdp.evalJS<{ fps: number }>(FPS)).fps
            const ani = [await sample(), await sample(), await sample()].sort((a, b) => a - b)
            await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
            const stat = [await sample(), await sample(), await sample()].sort((a, b) => a - b)
            const animsOff = await cdp.evalJS<number>(`document.getAnimations().filter((a) => a.playState === 'running').length`)
            await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
            console.log(
              `  帧率（3 次中位）：逐行动 ${ani[1]} fps（样本 ${ani.join('/')}）｜ 停动画 ${stat[1]} fps（样本 ${stat.join('/')}，停后运行中动画 ${animsOff} 条）`,
            )
            /* 悬停卡抽查：工位行（左列表）・投料行（右列表） */
            await hoverRowTip(cdp, '工位行', '.hud-table.is-station tbody tr', 2)
            await hoverRowTip(cdp, '投料行', '.hud-grid.two > .hud-grid:nth-child(2) table tbody tr')
          }
        }
        if (w === 1300 && tab === '精炼炉') {
          /* 逐列**最小宽度**拆解（把表的克隆放进 `width: min-content` 的离屏盒子量）——
             "右列表最小宽 332px"是哪一列顶出来的，靠这条读数定，而不是猜。 */
          const cols = await cdp.evalJS<string>(
            `(() => {
              const pick = (sel) => {
                const t = document.querySelector(sel)
                if (!t) return '没找到'
                const box = document.createElement('div')
                box.style.cssText = 'position:absolute;left:-9999px;top:0;width:min-content'
                const c = t.cloneNode(true)
                box.appendChild(c)
                document.body.appendChild(box)
                const total = Math.round(c.getBoundingClientRect().width)
                const row = c.querySelector('tbody tr')
                const cells = row ? [...row.children].map((td) => Math.round(td.getBoundingClientRect().width)) : []
                box.remove()
                return total + 'px（逐列 ' + cells.join(' / ') + '）'
              }
              return '投料表 ' + pick('.hud-grid.two > .hud-grid:nth-child(2) table') + '｜工位表 ' + pick('.hud-table.is-station')
            })()`,
          )
          console.log(`  最小宽拆解：${cols}`)
        }
        /* 组装机书架行 / 造船厂可造舰船行：同一张卡的另两个消费方（1600 档抽查） */
        if (w === 1600 && (tab === '组装机' || tab === '造船厂')) {
          await hoverRowTip(cdp, `${tab}行`, '.hud-grid.two .hud-table tbody tr', 2)
        }
      }
    }
  } finally {
    cdp.close()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
