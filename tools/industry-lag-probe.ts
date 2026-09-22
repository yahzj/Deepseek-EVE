/**
 * 工业页子页切换卡顿 · **浏览器读数**探针（`npm run industry:lag`）
 *
 * **用途**：玩家报障「点击工业内的不同子页面，会出现数秒的卡顿后才会切换页面」。
 * 姊妹工具 `tools/industry-perf-probe.ts`（`npm run industry:perf`）已证伪「引擎计算慢」（< 0.1 ms），
 * 本工具补上**浏览器侧读数**——切换到底等多久、这段时间主线程在干什么、拆成三段：
 *
 *   | 读数 | 含义 |
 *   |---|---|
 *   | `输入排队` = 事件处理器开跑 − 浏览器给输入打的时间戳 | 主线程被占住、玩家的点击排在队里等多久 |
 *   | `提交` = 新面板进入 DOM − 事件处理器开跑 | React 重算 + 提交 + 布局这一下花多久 |
 *   | `端到端` = `输入排队` + `提交` | 玩家真实感受到的「点了到换过去」 |
 *
 * 另有两类辅助读数：
 *   - **每次切换后的 5 秒空闲窗**：`Performance.getMetrics` 的 `TaskDuration` / `ScriptDuration` /
 *     `LayoutDuration` 增量 ⇒ **主线程占用率**（挂机不动时，每秒被游戏心跳的重渲染吃掉多少）。
 *   - **长任务 / 帧间隔**：`PerformanceObserver('longtask')` + `requestAnimationFrame` 采样
 *     ⇒ 掉帧与卡顿尖峰（对应船长快照里的 `long` max 171 ms、`fps min 5.75`）。
 *
 * **`--cpu N`（关键）**：用 CDP `Emulation.setCPUThrottlingRate` 把 CPU 降速 N 倍。
 * 报障玩家「配置不清楚」、船长 32 核复现不出来 ⇒ **弱机复现**靠这个：同一份代码在 6 倍降速下
 * 才现出「数秒」。对比优化前后**必须用同一个 N**。
 *
 * **运行前置**（三件，缺一会明确报错）：
 *   1) 网页版已构建并在跑：`npm run build --prefix web` 后 `npm run preview --prefix web -- --port 4173`；
 *   2) 无头 Chrome 带远程调试（**用非默认端口**，例：`--remote-debugging-port=9334`）；
 *   3) 一份后期真档（默认取 `docs/test-saves/` 里最大的那份，可用 `--save` 指定）。
 *
 * **用法**：
 *   npx tsx tools/industry-lag-probe.ts --label before            # 优化前读数
 *   npx tsx tools/industry-lag-probe.ts --label after             # 优化后读数（同端口、同档、同 N）
 *   npx tsx tools/industry-lag-probe.ts --cpu 6 --label before-6x # 弱机复现（6 倍降速）
 *   npx tsx tools/industry-lag-probe.ts --explore                 # 只打印工业页 DOM 结构，不测
 *   npm run industry:lag -- --label before
 *
 * **环境变量**：`UI_APP_URL`（默认 `http://localhost:4173/`）· `UI_CDP_URL`（默认 `http://127.0.0.1:9334`）
 * · `UI_SAVE`（默认自动挑最大的后期档）
 *
 * **产物**：`tools/_ui-artifacts/industry-lag/<label>.json`（读数，可重建、不入库）
 *
 * ⚠ **这是读数，不是观感结论**（约定 §6）：本工具只说"点了多久换过去、主线程占用多少"，
 * 「还卡不卡」由船长实测判定。
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = process.cwd()
const OUT_DIR = join(REPO, 'tools', '_ui-artifacts', 'industry-lag')
const APP = process.env.UI_APP_URL ?? 'http://localhost:4173/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9334'
/** 空闲观测窗长度：每次切到一个子页后，静置这么久再读主线程占用增量 */
const IDLE_WINDOW_MS = 5_000
/** 切换序列：按这个顺序轮着点（下标对应 `.app-subtab` 顺序：精炼炉 / 组装机 / 造船厂 / 蓝图书架） */
const SWITCH_ORDER = [0, 1, 2, 3, 1, 2, 3, 0]
/** 对照组页面（导航项文本）：用来分辨"工业页特别重"还是"所有页都这样" */
const PAGES = ['工业', '技能']

/* ── CDP 小工具（与 tools/ui-probe.ts 同款实现；无第三方依赖：Node 自带 fetch / WebSocket） ── */
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
    if (!page) throw new Error(`没有可用的页面 target（CDP ${url}）：先按头部注释启动无头 Chrome。`)
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
    return new Promise<CdpResult>((res, rej) => this.waiting.set(id, { res, rej }))
  }
  async evalJS<T>(expr: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })) as {
      exceptionDetails?: { text?: string; exception?: { description?: string } }
      result?: { value?: unknown }
    }
    if (r.exceptionDetails) {
      throw new Error(`页面报错：${r.exceptionDetails.text ?? ''} ${r.exceptionDetails.exception?.description ?? ''}`)
    }
    return r.result?.value as T
  }
  close(): void {
    this.ws.close()
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(cdp: Cdp, expr: string, label: string, timeoutMs = 20_000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      if (await cdp.evalJS<boolean>(expr)) return
    } catch {
      /* 页面切换中 */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`等不到：${label}（${APP} 是否在跑？）`)
    await sleep(120)
  }
}

/* ── 页面内埋点：一次性安装 `window.__IL`（长任务 / 帧采样 / 切换计时） ── */
const INSTALL = `(() => {
  if (window.__IL) return 'already'
  const IL = {
    lt: [], frames: [], obs: null, rafOn: false, sw: null, clickHooked: false,
    perf: {
      start() {
        this.lt = []; this.frames = []
        try {
          this.obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) this.lt.push({ s: e.startTime, d: e.duration }) })
          this.obs.observe({ entryTypes: ['longtask'] })
        } catch (e) { this.obs = null }
        this.rafOn = true
        this.startCommits()
        const loop = (t) => { if (!this.rafOn) return; this.frames.push(t); requestAnimationFrame(loop) }
        requestAnimationFrame(loop)
      },
      stop() { this.rafOn = false; if (this.obs) { this.obs.disconnect(); this.obs = null } },
      /** 提交计数：MutationObserver 每次回调 ≈ React 的一次提交（用来量"每秒被整树重渲染几次"） */
      startCommits() {
        this.commits = 0
        if (this.mo) this.mo.disconnect()
        const root = document.getElementById('root') || document.body
        this.mo = new MutationObserver(() => { this.commits++ })
        this.mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })
      },
      /** 背景层候选（星野/星云/氛围光）：用来分辨"挂机烧的主线程"是心跳重渲染还是背景动画 */
      bgCandidates() {
        const sel = 'canvas, [class*="star"], [class*="nebula"], [class*="sky"], [class*="bg-"], [class*="glow"], [class*="aurora"]'
        const hits = [...document.querySelectorAll(sel)].filter((e) => !e.closest('.page-stack'))
        return hits.map((e) => ({
          tag: e.tagName,
          cls: String(e.className).slice(0, 70),
          id: e.id || '',
          父: e.parentElement ? String(e.parentElement.className).slice(0, 50) : '',
          nodes: e.querySelectorAll('*').length,
          开头: e.outerHTML.slice(0, 120),
        }))
      },
      setBgHidden(hidden) {
        const sel = 'canvas, [class*="star"], [class*="nebula"], [class*="sky"], [class*="bg-"], [class*="glow"], [class*="aurora"]'
        const hits = [...document.querySelectorAll(sel)].filter((e) => !e.closest('.page-stack'))
        for (const e of hits) e.style.visibility = hidden ? 'hidden' : ''
        return hits.length
      },
      stats() {
        const f = this.frames, gaps = []
        for (let i = 1; i < f.length; i++) gaps.push(f[i] - f[i - 1])
        const sorted = [...gaps].sort((a, b) => a - b)
        const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : 0)
        const lt = this.lt.map((x) => x.d)
        return {
          帧数: f.length,
          帧间隔中位: +q(0.5).toFixed(1),
          帧间隔p95: +q(0.95).toFixed(1),
          帧间隔最大: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : 0,
          长任务数: lt.length,
          长任务合计: +lt.reduce((a, b) => a + b, 0).toFixed(1),
          长任务最长: lt.length ? +Math.max(...lt).toFixed(1) : 0,
          提交次数: this.commits || 0,
        }
      },
    },
    /** 面板快照：page-stack 的**最后一个元素子节点** = 当前子页面板 */
    panel() {
      const root = document.querySelector('.page-stack')
      if (!root) return null
      const p = root.children[root.children.length - 1]
      return p ? { nodes: p.querySelectorAll('*').length, text: (p.textContent || '').length, cls: String(p.className) } : null
    },
    activeTab() {
      return [...document.querySelectorAll('.app-subtabs .app-subtab')].findIndex((b) => b.classList.contains('is-active'))
    },
    /**
     * 备好一次切换计时：记下「切前」的面板指纹，等目标子页激活**且**面板指纹变了 ⇒ 判定切换完成。
     * sw.t0 取浏览器给这次输入打的 timeStamp（含主线程排队），sw.tRaw 取事件处理器开跑时刻。
     */
    armSwitch(wantIdx) {
      const p = this.panel()
      this.sw = { wantIdx, prevNodes: p ? p.nodes : -1, prevText: p ? p.text : -1, t0: null, tRaw: null, t1: null, done: false, nodes: p ? p.nodes : -1, text: p ? p.text : -1 }
      if (!this.clickHooked) {
        this.clickHooked = true
        document.addEventListener('click', (e) => {
          const s = window.__IL.sw
          if (!s || s.t0 !== null) return
          s.t0 = e.timeStamp; s.tRaw = performance.now()
        }, true)
      }
      const self = this
      const poll = () => {
        const s = self.sw
        if (!s || s.done) return
        const now = self.panel()
        const nodes = now ? now.nodes : -1
        const text = now ? now.text : -1
        if (self.activeTab() === s.wantIdx && (nodes !== s.prevNodes || text !== s.prevText)) {
          s.t1 = performance.now(); s.nodes = nodes; s.text = text; s.done = true; return
        }
        requestAnimationFrame(poll)
      }
      requestAnimationFrame(poll)
      return this.sw.prevNodes
    },
    readSwitch() {
      const s = this.sw
      if (!s) return null
      return { ...s, active: this.activeTab() }
    },
    /** 面板全文快照（按行）：用来判"这块界面还活着吗"——两次快照比行差即可 */
    textLines() {
      const root = document.querySelector('.page-stack')
      const p = root ? root.children[root.children.length - 1] : null
      return p ? (p.innerText || '').split('\\n') : []
    },
    /** 两次快照的差异：返回变化行数 + 前几例（**冻结检测**：签名 gate 写漏了 ⇒ 这里会变成 0） */
    textDiff(a, b) {
      const n = Math.max(a.length, b.length)
      const changed = []
      let count = 0
      for (let i = 0; i < n; i++) {
        const x = (a[i] ?? '').trim(), y = (b[i] ?? '').trim()
        if (x === y) continue
        count++
        if (changed.length < 6) changed.push({ 行: i, 前: x.slice(0, 48), 后: y.slice(0, 48) })
      }
      return { 原行数: a.length, 现行数: b.length, 变化行数: count, 例: changed }
    },
  }
  window.__IL = IL
  IL.perf.start()
  return 'ok'
})()`

/* ── 表单：目标元素中心点（真实鼠标事件要视口坐标） ── */
const TAB_CENTER = (i: number): string => `(() => {
  const b = document.querySelectorAll('.app-subtabs .app-subtab')[${i}]
  if (!b) return null
  const r = b.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (b.textContent || '').trim() }
})()`

const METRIC_KEYS = [
  'TaskDuration',
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
  'LayoutCount',
  'RecalcStyleCount',
  'Nodes',
  'JSHeapUsedSize',
] as const

async function readMetrics(cdp: Cdp): Promise<Record<string, number>> {
  const r = (await cdp.send('Performance.getMetrics')) as { metrics?: Array<{ name: string; value: number }> }
  const out: Record<string, number> = {}
  for (const m of r.metrics ?? []) if ((METRIC_KEYS as readonly string[]).includes(m.name)) out[m.name] = m.value
  return out
}

function diffMetrics(a: Record<string, number>, b: Record<string, number>, seconds: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of METRIC_KEYS) {
    const d = (b[k] ?? 0) - (a[k] ?? 0)
    if (k.endsWith('Duration')) out[`${k}ms`] = +(d * 1000).toFixed(0)
    else if (k === 'Nodes' || k === 'JSHeapUsedSize') out[k] = +(b[k] ?? 0) // 存量仪表：记绝对值，不做差
    else out[k] = d
  }
  // 主线程占用率 = 任务时长 / 墙钟时长（越多越忙）
  out['主线程占用%'] = +(((b.TaskDuration ?? 0) - (a.TaskDuration ?? 0)) / seconds * 100).toFixed(1)
  return out
}

/** 挑默认存档：`docs/test-saves` 里最大的那份 `.json`（后期档，蓝图/物品最全） */
function pickDefaultSave(): string {
  const dir = join(REPO, 'docs', 'test-saves')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('README'))
  const best = files
    .map((f) => ({ f, size: statSync(join(dir, f)).size }))
    .sort((a, b) => b.size - a.size)[0]
  if (!best) throw new Error('docs/test-saves 里没有可用存档')
  return join(dir, best.f)
}

/* ── 主流程 ── */
interface SwitchReading {
  从: string
  到: string
  端到端ms: number
  输入排队ms: number
  提交ms: number
  节点数: number
  文本量: number
  完成: boolean
  /** 这一次切换窗口内的主线程任务增量（说明这 100~2000 ms 花在哪儿：脚本 / 布局 / 样式 / 其它） */
  切换耗能?: Record<string, number>
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const argOf = (name: string, dflt?: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : dflt
  }
  const label = argOf('label', 'run') as string
  const cpuRate = Number(argOf('cpu', '1'))
  const savePath = process.env.UI_SAVE ?? argOf('save') ?? pickDefaultSave()
  const explore = argv.includes('--explore')
  /** `--bg`：隔离"背景动画"与"心跳重渲染"各占多少主线程（只量事实，不改产品代码） */
  const bgIsolate = argv.includes('--bg')

  mkdirSync(OUT_DIR, { recursive: true })
  const saveText = readFileSync(savePath, 'utf8')
  console.log(`存档：${savePath}（${(saveText.length / 1024).toFixed(0)} KB）`)
  console.log(`页面：${APP}   CDP：${CDP}   CPU 降速：×${cpuRate}   标签：${label}`)

  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Performance.enable')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })

  // 干净启动：注入存档 → 重载（与 tools/ui-probe.ts 同口径）
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.readyState === 'complete' && !!window.localStorage`, '首次加载')
  await cdp.evalJS(`localStorage.setItem('whale:idle:save', ${JSON.stringify(saveText)}); 'ok'`)
  await cdp.send('Page.reload')
  await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '游戏启动')
  console.log(`埋点安装：${await cdp.evalJS<string>(INSTALL)}`)

  const navLabels = await cdp.evalJS<string[]>(`[...document.querySelectorAll('.app-nav-item')].map(b => (b.textContent||'').trim())`)
  console.log(`导航项：${navLabels.join(' / ')}`)

  const report: Record<string, unknown> = { 标签: label, 存档: savePath, CPU降速: cpuRate, 页面: {} }

  /**
   * `--bg` 模式：同一页面、同一存档，先量 5 秒基线，再把**背景层**（星野/星云/氛围光/canvas，
   * 且不在 `.page-stack` 内的）临时设为 `visibility:hidden` 再量 5 秒。
   * 两者之差 = 背景动画吃掉的主线程；剩余 = 心跳整树重渲染吃掉的主线程。
   * ⚠ 这是**读数**，不是观感结论；用完立刻还原，不改任何产品代码。
   */
  if (bgIsolate) {
    const page = argOf('page', '技能') as string
    await cdp.evalJS(`(() => { const n = [...document.querySelectorAll('.app-nav-item')].find((b) => (b.textContent||'').includes(${JSON.stringify(page)})); n && n.click(); return !!n })()`)
    await sleep(1200)
    await cdp.evalJS(INSTALL)
    const cands = await cdp.evalJS<Array<{ tag: string; cls: string; nodes: number }>>(`window.__IL.perf.bgCandidates()`)
    console.log(`\n背景层候选（${cands.length} 个，已排除 .page-stack 内的）：`)
    for (const c of cands.slice(0, 20)) console.log(`  ${c.tag} .${c.cls} #${c.id}（父 .${c.父} · 内含 ${c.nodes} 节点）`)

    const measure = async (tag: string): Promise<Record<string, unknown>> => {
      await cdp.evalJS(`window.__IL.perf.start(); 'ok'`)
      const m0 = await readMetrics(cdp)
      await sleep(IDLE_WINDOW_MS)
      const m1 = await readMetrics(cdp)
      const perf = await cdp.evalJS<Record<string, number>>(`window.__IL.perf.stats()`)
      const d = diffMetrics(m0, m1, IDLE_WINDOW_MS / 1000)
      const sec = IDLE_WINDOW_MS / 1000
      const row = {
        情形: tag,
        主线程占用: d['主线程占用%'],
        每秒提交: +((perf['提交次数'] ?? 0) / sec).toFixed(1),
        任务合计ms: d['TaskDurationms'],
        脚本ms: d['ScriptDurationms'],
        布局ms: d['LayoutDurationms'],
        样式ms: d['RecalcStyleDurationms'],
        长任务数: perf['长任务数'],
        长任务最长: perf['长任务最长'],
      }
      console.log(
        `  ${tag.padEnd(10)} 主线程占用 ${String(row.主线程占用).padStart(6)}% · 每秒提交 ${String(row.每秒提交).padStart(5)} 次 · ` +
          `任务 ${row.任务合计ms} ms（脚本 ${row.脚本ms} / 布局 ${row.布局ms} / 样式 ${row.样式ms}）· 长任务 ${row.长任务数}（最长 ${row.长任务最长}）`,
      )
      return row
    }

    const rows: Array<Record<string, unknown>> = []
    // A/B/A/B 四窗：隐藏 → 显示 → 隐藏 → 显示，交叉对照排除"越跑越热/越跑越冷"的漂移
    for (const hide of [false, true, false, true]) {
      await cdp.evalJS(`window.__IL.perf.setBgHidden(${hide}); 'ok'`)
      await sleep(400)
      rows.push(await measure(hide ? '背景已隐藏' : '背景显示'))
    }
    await cdp.evalJS(`window.__IL.perf.setBgHidden(false); 'ok'`)
    report.背景隔离 = { 背景层候选: cands, 四窗: rows }
    const out = join(OUT_DIR, `${label}.json`)
    writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\n读数已写入：${out}`)
    cdp.close()
    return
  }

  /**
   * `--cv` 模式：**先试后改**——把候选 CSS（`content-visibility: auto`）在页面里临时注入，
   * 同一轮里前后各跑一次切换序列，看这一条 CSS 究竟能省多少。**不改产品代码**，读数说话。
   */
  if (argv.includes('--cv')) {
    const page = argOf('page', '工业') as string
    const intrinsic = argOf('cv-size', 'auto 300px') as string
    await cdp.evalJS(
      `(() => { const n = [...document.querySelectorAll('.app-nav-item')].find((b) => (b.textContent||'').includes(${JSON.stringify(page)})); n && n.click(); return !!n })()`,
    )
    await sleep(1500)
    await cdp.evalJS(INSTALL)
    const tabs = await cdp.evalJS<Array<{ x: number; y: number; label: string } | null>>(
      `[0,1,2,3].map((i) => { const b = document.querySelectorAll('.app-subtabs .app-subtab')[i]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), label: (b.textContent||'').trim() } })`,
    )
    const tabNames = tabs.map((t) => (t ? t.label : '—'))

    const series = async (tag: string): Promise<{ rows: SwitchReading[]; 端到端中位: number; 端到端最大: number }> => {
      const rows: SwitchReading[] = []
      await cdp.evalJS(`window.__IL.perf.start(); 'ok'`)
      for (const want of SWITCH_ORDER) {
        const t = tabs[want]
        if (!t) continue
        const from = await cdp.evalJS<number>(`window.__IL.activeTab()`)
        const ms0 = await readMetrics(cdp)
        await cdp.evalJS(`window.__IL.armSwitch(${want}); 'ok'`)
        await realClick(cdp, t.x, t.y)
        const sw = await pollSwitch(cdp)
        const ms1 = await readMetrics(cdp)
        if (!sw) continue
        rows.push({
          从: tabNames[from] ?? `#${from}`,
          到: tabNames[want] ?? `#${want}`,
          端到端ms: +sw.端到端ms.toFixed(1),
          输入排队ms: +sw.输入排队ms.toFixed(1),
          提交ms: +sw.提交ms.toFixed(1),
          节点数: sw.节点数,
          文本量: sw.文本量,
          完成: sw.完成,
          切换耗能: diffMetrics(ms0, ms1, Math.max(0.001, sw.端到端ms / 1000)),
        })
        await sleep(250)
      }
      const byTarget = new Map<string, number[]>()
      for (const r of rows) {
        const arr = byTarget.get(r.到) ?? []
        arr.push(r.端到端ms)
        byTarget.set(r.到, arr)
      }
      const all = rows.map((r) => r.端到端ms).sort((a, b) => a - b)
      const med = all.length ? +all[Math.floor(all.length / 2)].toFixed(1) : 0
      const max = all.length ? +all[all.length - 1].toFixed(1) : 0
      console.log(`  【${tag}】各子页平均：`)
      for (const [name, arr] of byTarget) {
        console.log(`      → ${name.padEnd(8)} ${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)} ms（${arr.length} 次）`)
      }
      console.log(`      合计 中位 ${med} ms · 最大 ${max} ms`)
      return { rows, 端到端中位: med, 端到端最大: max }
    }

    console.log(`\n══ 候选 CSS 试跑（${page} · content-visibility: auto / contain-intrinsic-size: ${intrinsic}）══`)
    /** 滚动几何读数：注入后必须与注入前一致，否则"不卡了但滚动条变了"（观感仍归船长，这里只给数） */
    const SCROLL_GEOM = `(() => {
      const g = document.querySelector('.app-belt-grid')
      const b = document.querySelector('.win-fixed-body .app-win-body') || document.querySelector('.app-win-body')
      const cards = [...document.querySelectorAll('.app-belt-card.is-assembler')]
      return {
        卡片网格: g ? { 内容高: g.scrollHeight, 可视高: g.clientHeight, 可滚: g.scrollHeight > g.clientHeight } : null,
        窗口体: b ? { 内容高: b.scrollHeight, 可视高: b.clientHeight, 可滚: b.scrollHeight > b.clientHeight } : null,
        卡片数: cards.length,
        /** 高度分布：占位高度取值要贴近真实卡高，否则滚动条会跳（这正是 content-visibility 的风险点） */
        卡高: {
          首张: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : -1,
          前12张: cards.slice(0, 12).map((c) => Math.round(c.getBoundingClientRect().height)),
          中位: cards.length ? Math.round([...cards].map((c) => c.getBoundingClientRect().height).sort((a, b) => a - b)[Math.floor(cards.length / 2)]) : -1,
        },
      }
    })()`
    const gotoAssembler = async (): Promise<void> => {
      await cdp.evalJS(`(() => { const b = document.querySelectorAll('.app-subtabs .app-subtab')[1]; b && b.click(); return true })()`)
      await sleep(900)
    }
    await gotoAssembler()
    const geomBefore = await cdp.evalJS<unknown>(SCROLL_GEOM)
    const plain = await series('未注入（现状）')
    await cdp.evalJS(
      `(() => { const old = document.getElementById('__cv-probe'); if (old) old.remove(); const s = document.createElement('style'); s.id = '__cv-probe'; s.textContent = '.app-belt-card.is-assembler{content-visibility:auto;contain-intrinsic-size:${intrinsic}}'; document.head.appendChild(s); return s.textContent })()`,
    )
    await sleep(400)
    await gotoAssembler()
    const geomCold = await cdp.evalJS<unknown>(SCROLL_GEOM)
    const withCv = await series('已注入 content-visibility')
    await gotoAssembler()
    const geomAfter = await cdp.evalJS<unknown>(SCROLL_GEOM)
    await cdp.evalJS(`(() => { const s = document.getElementById('__cv-probe'); if (s) s.remove(); return true })()`)
    console.log('  滚动几何：')
    console.log(`      注入前 ${JSON.stringify(geomBefore)}`)
    console.log(`      刚注入 ${JSON.stringify(geomCold)}`)
    console.log(`      跑完序 ${JSON.stringify(geomAfter)}`)
    report.候选CSS试跑 = {
      CSS: `.app-belt-card.is-assembler{content-visibility:auto;contain-intrinsic-size:${intrinsic}}`,
      未注入: plain,
      已注入: withCv,
      滚动几何: { 注入前: geomBefore, 刚注入: geomCold, 跑完序列: geomAfter },
    }
    const out = join(OUT_DIR, `${label}.json`)
    writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\n读数已写入：${out}`)
    cdp.close()
    return
  }

  for (const page of PAGES) {
    const ok = await cdp.evalJS<boolean>(`(() => {
      const n = [...document.querySelectorAll('.app-nav-item')].find((b) => (b.textContent||'').includes(${JSON.stringify(page)}))
      if (n) n.click()
      return !!n
    })()`)
    if (!ok) {
      console.log(`（跳过页面「${page}」：导航里没有）`)
      continue
    }
    await sleep(1200)
    await cdp.evalJS(INSTALL)

    if (explore) {
      const nTabs = await cdp.evalJS<number>(`document.querySelectorAll('.app-subtabs .app-subtab').length`)
      const rounds = nTabs > 0 ? nTabs : 1
      for (let i = 0; i < rounds; i++) {
        if (nTabs > 0) {
          await cdp.evalJS(`(() => { const b = document.querySelectorAll('.app-subtabs .app-subtab')[${i}]; b && b.click(); return true })()`)
          await sleep(900)
        }
        const kids = await cdp.evalJS<unknown>(`(() => {
          const root = document.querySelector('.page-stack')
          const panel = root ? root.children[root.children.length - 1] : null
          /** 按 class 归并统计节点数：一眼看出"节点都堆在谁身上" */
          const byClass = {}
          if (panel) for (const el of panel.querySelectorAll('*')) {
            const k = String(el.className || el.tagName).split(/\\s+/).filter(Boolean).slice(0, 2).join('.')
            byClass[k] = (byClass[k] || 0) + 1
          }
          const top = Object.entries(byClass).sort((a, b) => b[1] - a[1]).slice(0, 18)
          return {
            pageStack: !!root,
            kids: root ? [...root.children].map((k) => ({ cls: String(k.className), nodes: k.querySelectorAll('*').length, head: (k.textContent||'').trim().slice(0, 40) })) : [],
            bodyNodes: document.querySelectorAll('*').length,
            面板节点: panel ? panel.querySelectorAll('*').length : -1,
            按类归并_前18: Object.fromEntries(top),
            /** 单张卡片的节点数（取第一张，看看"一张卡多少钱"） */
            单卡节点: panel ? (panel.querySelector('.app-belt-card')?.querySelectorAll('*').length ?? -1) : -1,
            卡片数: panel ? panel.querySelectorAll('.app-belt-card').length : -1,          }
        })()`)
        const label = nTabs > 0 ? await cdp.evalJS<string>(`(document.querySelectorAll('.app-subtabs .app-subtab')[${i}].textContent||'').trim()`) : page
        console.log(`\n══ 探索「${page} · ${label}」══`)
        console.log(JSON.stringify(kids, null, 1))
      }
      continue
    }

    const tabs = await cdp.evalJS<Array<{ x: number; y: number; label: string } | null>>(
      `[0,1,2,3].map((i) => { const b = document.querySelectorAll('.app-subtabs .app-subtab')[i]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), label: (b.textContent||'').trim() } })`,
    )
    const tabNames = tabs.map((t) => (t ? t.label : '—'))
    console.log(`\n══ 页面「${page}」子页：${tabNames.filter((t) => t !== '—').join(' / ')} ══`)

    const perSub: Record<string, unknown> = {}
    const switches: SwitchReading[] = []

    if (tabs.every((t) => !t)) {
      // 没有子标签的页面（对照组）：只取一次静置观测窗，量"这一页在挂机时烧多少主线程"
      await cdp.evalJS(`window.__IL.perf.start(); 'ok'`)
      const m0 = await readMetrics(cdp)
      await cdp.evalJS(`window.__IL.__t0txt = window.__IL.textLines(); window.__IL.perf.start(); 'ok'`)
      await sleep(IDLE_WINDOW_MS)
      const m1 = await readMetrics(cdp)
      const perf = await cdp.evalJS<Record<string, number>>(`window.__IL.perf.stats()`)
      const panel = await cdp.evalJS<{ nodes: number; text: number; cls: string } | null>(`window.__IL.panel()`)
      const live = await cdp.evalJS<Record<string, unknown>>(`window.__IL.textDiff(window.__IL.__t0txt, window.__IL.textLines())`)
      const d = diffMetrics(m0, m1, IDLE_WINDOW_MS / 1000)
      perSub['（无子标签）'] = { 节点数: panel ? panel.nodes : -1, 文本量: panel ? panel.text : -1, [`静置${IDLE_WINDOW_MS / 1000}秒`]: d, 观测窗: perf, 活值: live }
      console.log(
        `  （无子标签·对照组）节点 ${panel ? panel.nodes : -1} · 主线程占用 ${d['主线程占用%']}% · ` +
          `脚本 ${d['ScriptDurationms']} ms · 布局 ${d['LayoutDurationms']} ms（${d['LayoutCount']} 次）· 长任务 ${perf['长任务数']}（最长 ${perf['长任务最长']} ms）· 活值变化 ${live['变化行数']} 行`,
      )
    }

    // ① 逐个子页：真实点击切过去 → 静置观测窗（主线程占用 / 长任务 / 帧）
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i]
      if (!t) continue
      const before = await cdp.evalJS<{ x: number; y: number; label: string } | null>(TAB_CENTER(i))
      if (!before) continue
      await cdp.evalJS(`window.__IL.perf.start(); window.__IL.armSwitch(${i}); 'ok'`)
      await realClick(cdp, before.x, before.y)
      const sw = await pollSwitch(cdp)
      const m0 = await readMetrics(cdp)
      await cdp.evalJS(`window.__IL.__t0txt = window.__IL.textLines(); window.__IL.perf.start(); 'ok'`)
      await sleep(IDLE_WINDOW_MS)
      const m1 = await readMetrics(cdp)
      const perf = await cdp.evalJS<Record<string, number>>(`window.__IL.perf.stats()`)
      const panel = await cdp.evalJS<{ nodes: number; text: number; cls: string } | null>(`window.__IL.panel()`)
      const live = await cdp.evalJS<Record<string, unknown>>(`window.__IL.textDiff(window.__IL.__t0txt, window.__IL.textLines())`)
      const d = diffMetrics(m0, m1, IDLE_WINDOW_MS / 1000)
      perSub[tabNames[i] || `#${i}`] = {
        首次切换: sw,
        节点数: panel ? panel.nodes : -1,
        文本量: panel ? panel.text : -1,
        [`静置${IDLE_WINDOW_MS / 1000}秒`]: d,
        观测窗: perf,
        活值: live,
      }
      console.log(
        `  ${(tabNames[i] || `#${i}`).padEnd(8)} 节点 ${String(panel ? panel.nodes : -1).padStart(5)} · ` +
          `首次切换 端到端 ${fmt(sw?.端到端ms)} / 提交 ${fmt(sw?.提交ms)} · ` +
          `主线程占用 ${String(d['主线程占用%']).padStart(5)}% · ` +
          `（脚本 ${d['ScriptDurationms']} / 布局 ${d['LayoutDurationms']} ms）· ` +
          `长任务 ${perf['长任务数']}（最长 ${perf['长任务最长']} ms）· 活值变化 ${live['变化行数']} 行`,
      )
    }

    // ② 切换序列：连点，取端到端 / 排队 / 提交的分布（这才是玩家"点几下"的真实体验）
    await cdp.evalJS(`window.__IL.perf.start(); 'ok'`)
    for (const want of SWITCH_ORDER) {
      const t = tabs[want]
      if (!t) continue
      const from = await cdp.evalJS<number>(`window.__IL.activeTab()`)
      const ms0 = await readMetrics(cdp)
      await cdp.evalJS(`window.__IL.armSwitch(${want}); 'ok'`)
      await realClick(cdp, t.x, t.y)
      const sw = await pollSwitch(cdp)
      const ms1 = await readMetrics(cdp)
      if (sw) {
        switches.push({
          从: tabNames[from] ?? `#${from}`,
          到: tabNames[want] ?? `#${want}`,
          端到端ms: +sw.端到端ms.toFixed(1),
          输入排队ms: +sw.输入排队ms.toFixed(1),
          提交ms: +sw.提交ms.toFixed(1),
          节点数: sw.节点数,
          文本量: sw.文本量,
          完成: sw.完成,
          切换耗能: diffMetrics(ms0, ms1, Math.max(0.001, sw.端到端ms / 1000)),
        })
      }
      await sleep(250)
    }
    const seriesPerf = await cdp.evalJS<Record<string, number>>(`window.__IL.perf.stats()`)

    const stat = (key: keyof SwitchReading): { 中位: number; p95: number; 最大: number } => {
      const v = switches.map((s) => Number(s[key])).sort((a, b) => a - b)
      if (v.length === 0) return { 中位: 0, p95: 0, 最大: 0 }
      return {
        中位: +v[Math.floor(v.length / 2)].toFixed(1),
        p95: +v[Math.min(v.length - 1, Math.floor(v.length * 0.95))].toFixed(1),
        最大: +v[v.length - 1].toFixed(1),
      }
    }
    const summary = {
      次数: switches.length,
      全部完成: switches.every((s) => s.完成),
      端到端: stat('端到端ms'),
      输入排队: stat('输入排队ms'),
      提交: stat('提交ms'),
    }
    const worst = [...switches].sort((a, b) => b.端到端ms - a.端到端ms)[0]
    console.log(
      `  ── 切换序列（${switches.length} 次）：端到端 中位 ${summary.端到端.中位} / 最大 ${summary.端到端.最大} ms · ` +
        `其中 输入排队 中位 ${summary.输入排队.中位} / 最大 ${summary.输入排队.最大} ms · ` +
        `提交 中位 ${summary.提交.中位} / 最大 ${summary.提交.最大} ms · ` +
        `长任务最长 ${seriesPerf['长任务最长']} ms · 帧间隔最大 ${seriesPerf['帧间隔最大']} ms`,
    )
    if (worst) {
      const e = worst.切换耗能 ?? {}
      console.log(
        `     最慢一次：${worst.从} → ${worst.到} ${worst.端到端ms} ms（挂载后节点 ${worst.节点数}）⇒ ` +
          `脚本 ${e['ScriptDurationms']} ms · 布局 ${e['LayoutDurationms']} ms（${e['LayoutCount']} 次）· ` +
          `样式 ${e['RecalcStyleDurationms']} ms（${e['RecalcStyleCount']} 次）· 主线程合计 ${e['TaskDurationms']} ms`,
      )
    }
    ;(report.页面 as Record<string, unknown>)[page] = { 子页: perSub, 切换明细: switches, 切换汇总: summary, 切换序列观测窗: seriesPerf }
  }

  if (!explore) {
    const out = join(OUT_DIR, `${label}.json`)
    writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\n读数已写入：${out}`)
  }
  cdp.close()
}

const fmt = (v: number | undefined): string => (v === undefined ? '—' : `${v.toFixed(1)}ms`)

/** 发一次**真实**鼠标点击（走浏览器输入管线，不是 JS `.click()`——才会带上排队延迟） */
async function realClick(cdp: Cdp, x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

interface RawSwitch {
  wantIdx: number
  prevNodes: number
  prevText: number
  t0: number | null
  tRaw: number | null
  t1: number | null
  done: boolean
  nodes: number
  text: number
  active: number
}
interface SwitchTiming {
  端到端ms: number
  输入排队ms: number
  提交ms: number
  节点数: number
  文本量: number
  完成: boolean
}

/** 等这一次切换落地（页面内 rAF 轮询已在跑），并拆出三段耗时 */
async function pollSwitch(cdp: Cdp, timeoutMs = 30_000): Promise<SwitchTiming | null> {
  const t0 = Date.now()
  for (;;) {
    const s = await cdp.evalJS<RawSwitch | null>(`window.__IL.readSwitch()`)
    if (s && (s.done || Date.now() - t0 > timeoutMs)) {
      const t0v = s.t0 ?? s.tRaw ?? 0
      const t1v = s.t1 ?? s.tRaw ?? 0
      const tRaw = s.tRaw ?? t0v
      return {
        端到端ms: Math.max(0, t1v - t0v),
        输入排队ms: Math.max(0, tRaw - t0v),
        提交ms: Math.max(0, t1v - tRaw),
        节点数: s.nodes,
        文本量: s.text,
        完成: s.done,
      }
    }
    await sleep(60)
  }
}

main().catch((e: unknown) => {
  console.error(`industry-lag-probe 失败：${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
