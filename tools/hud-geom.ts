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
  [1340, 900],
  [1440, 900],
  [1600, 1000],
  [1920, 1080],
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
