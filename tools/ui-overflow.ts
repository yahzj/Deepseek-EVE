/**
 * **PDF-NO-SCROLL 逐页溢出读数**（P4 交付物 · 船长 2026-09-20 点名要）。
 *
 * 要回答的问题：船长 2026-09-08 定的红线「**一级页不滚**」（导航直系页整页无滚动条，
 * 且前提是"内容必须完整装下，禁止硬裁"）在**英文**下还成不成立——英文比中文长 30~60%。
 *
 * 判据（代码内是硬的）：`App.tsx` 的 `PAGE_NO_SCROLL` 收了 9 个一级页
 * （map / ship / fit / items / market / industry / skills / task / comms）⇒ 逐一量。
 *
 * **只出读数，不做观感结论**（观感归船长）：溢出多少 px、谁溢出、余量还剩多少。
 *
 * 运行前置（与 `ui-probe.ts` 同款）：
 *   1) 网页版已构建并在跑（默认 `http://localhost:4173/`）；
 *   2) 无头 Chrome 带远程调试（默认 CDP `127.0.0.1:9222`）。
 *
 * 用法：
 *   npx tsx tools/ui-overflow.ts            # 3 份档 × 2 语言 × 5 档窗口 × 9 页
 *   npm run ui:overflow                     # 等价
 *
 * 输入：`docs/test-saves/` 里的中后期真档（新档各页是空的，读数没意义）
 * 输出：`tools/_ui-artifacts/shots/overflow.json`（可重建、不入库）+ 控制台表格
 *
 * ⚠ 手机档（390×844）会触发**自动旋转**（`--mob-w: 1200px` 虚拟横屏）⇒ 逻辑空间是 1200 宽，
 *    读数按**旋转后的逻辑空间**判（否则会把"虚拟高度"误判成溢出）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { L10N } from '../packages/data/src/l10n/table'

const ARTIFACT_DIR = join(process.cwd(), 'tools', '_ui-artifacts')
const OUT_DIR = join(ARTIFACT_DIR, 'shots')
const SAVE_DIR = join(process.cwd(), 'docs', 'test-saves')
const APP = process.env.UI_APP_URL ?? 'http://localhost:4173/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9222'

/** 输入档：三份中后期真档（覆盖装备/工业/虫洞三大块内容，页面最满） */
const SAVES = [
  { name: 'fragments', file: 'test-save-fragments-20260919-141735.json', note: '碎片/蓝图线，物品·工业页最满' },
  { name: 'mt-lab', file: 'test-save-mt-lab-20260919-201207.json', note: '谜质科技实验档，技能·工业页最满' },
  { name: 'wh-all', file: 'test-save-wh-all-20260914-145912.json', note: '虫洞全解锁，任务·星图页最满' },
] as const

/** 窗口档：桌面三档 + 手机横竖屏（含窄窗） */
const VIEWPORTS: ReadonlyArray<{ label: string; w: number; h: number; mobile: boolean }> = [
  { label: '桌面 1600×1000', w: 1600, h: 1000, mobile: false },
  { label: '桌面 1366×768', w: 1366, h: 768, mobile: false },
  { label: '窄窗 1024×768', w: 1024, h: 768, mobile: false },
  { label: '手机竖屏 390×844', w: 390, h: 844, mobile: true },
  { label: '手机横屏 844×390', w: 844, h: 390, mobile: true },
]

/** 9 个一级页（与 `App.tsx` 的 PAGE_NO_SCROLL 同集合）；`nav` = `ui.App.00N`（导航标签 id） */
const PAGES: ReadonlyArray<{ key: string; nav: string }> = [
  { key: 'map', nav: 'ui.App.001' },
  { key: 'ship', nav: 'ui.App.002' },
  { key: 'fit', nav: 'ui.App.003' },
  { key: 'items', nav: 'ui.App.004' },
  { key: 'market', nav: 'ui.App.005' },
  { key: 'industry', nav: 'ui.App.006' },
  { key: 'skills', nav: 'ui.App.007' },
  { key: 'task', nav: 'ui.App.008' },
  { key: 'comms', nav: 'ui.App.009' },
]

/**
 * 导航按钮**没有 data 属性** ⇒ 按**可见标签文本**点（标签 id → 当前语言文本由 `L10N` 给出，
 * 比按 index 稳：将来加/减导航项不会点错）。索引作兜底。
 */
function navLabelOf(navId: string, locale: 'zh' | 'en'): string {
  const e = L10N[navId]
  return e ? (locale === 'zh' ? e.zh : e.en) : navId
}

/* ── CDP 小工具（与本仓其它探针同款，无类型依赖） ── */
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
    if (!page) throw new Error(`没有可用的页面 target（CDP ${url}）：先启动无头 Chrome 带 --remote-debugging-port=9222。`)
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
    if (r.exceptionDetails) throw new Error(`页面报错：${r.exceptionDetails.text ?? ''} ${r.exceptionDetails.exception?.description ?? ''}`)
    return r.result?.value as T
  }
  close(): void {
    this.ws.close()
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(cdp: Cdp, expr: string, what: string, timeoutMs = 15000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      if (await cdp.evalJS<boolean>(`!!(${expr})`)) return
    } catch {
      /* 页面切换中，继续等 */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时：${what}`)
    await sleep(120)
  }
}

/** 页面侧读数：整页溢出 / 强制滚动的元凶 / 最紧的板块 */
const READ_PAGE = `(() => {
  const de = document.documentElement
  const rot = de.classList.contains('is-mobile-rot') || !!document.querySelector('.is-mobile-rot')
  const pad = document.querySelector('.app-page, .app-main, .app-content')
  const out = {
    旋转: rot,
    逻辑宽: Math.round(de.scrollWidth),
    逻辑高: Math.round(de.scrollHeight),
    视口宽: Math.round(window.innerWidth),
    视口高: Math.round(window.innerHeight),
    纵向溢出: Math.round(de.scrollHeight - window.innerHeight),
    横向溢出: Math.round(de.scrollWidth - window.innerWidth),
    页面纵向滚动: de.scrollHeight > window.innerHeight + 1,
    // 一级页真正的滚动容器是 .app-page-content（overflow-y:auto）⇒ 单独量它是否在滚
    内容区滚动: (() => { const c = document.querySelector('.app-page-content'); return c ? c.scrollHeight > c.clientHeight + 1 : null })(),
    内容区溢出: (() => { const c = document.querySelector('.app-page-content'); return c ? Math.round(c.scrollHeight - c.clientHeight) : null })(),
    页面横向滚动: de.scrollWidth > window.innerWidth + 1,
    元凶: [],
    最紧: [],
  }
  const vh = window.innerHeight
  /**
   * 元凶 = 底边超出视口、且**自身不是"设计上可滚"的内部列表**的块。
   * 为什么要排除：页面内部有一批**故意可滚的列表/网格**（.app-ship-list、.app-inv-list、
   * overflow-y: auto 或类名带 scroll／列表语义的容器）——它们超出视口是**正常设计**（滚动只进二级区），
   * 报了会把"谁把整页顶下去"这个判据搅浑。
   */
  const innerScrollable = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      const oy = cs.overflowY
      if (oy === 'auto' || oy === 'scroll') return true
      const c = String(n.className || '')
      if (/scroll|app-.-list|app-.-grid/.test(c)) return true
    }
    return false
  }
  const all = [...document.querySelectorAll('main *')]
  const forcing = []
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.height < 8) continue
    if (innerScrollable(el)) continue
    if (el.parentElement && all.includes(el.parentElement) && el.parentElement.getBoundingClientRect().bottom >= r.bottom - 1) continue
    const over = Math.round(r.bottom - vh)
    if (over > 1) forcing.push({ cls: (el.className || el.tagName).toString().slice(0, 48), 超出: over, 高: Math.round(r.height) })
  }
  out.元凶 = forcing.sort((a, b) => b.超出 - a.超出).slice(0, 5)
  // 最紧的板块（余量最小的 5 个：块底距视口底 < 24px，或已超出）
  const tight = []
  for (const el of document.querySelectorAll('section, .app-card, .app-panel, .app-bay')) {
    const r = el.getBoundingClientRect()
    if (r.height < 24) continue
    tight.push({ cls: (el.className || el.tagName).toString().slice(0, 40), 余量: Math.round(vh - r.bottom) })
  }
  out.最紧 = tight.sort((a, b) => a.余量 - b.余量).slice(0, 5)
  return out
})()`

interface PageReading {
  旋转: boolean
  逻辑宽: number
  逻辑高: number
  视口宽: number
  视口高: number
  纵向溢出: number
  横向溢出: number
  页面纵向滚动: boolean
  页面横向滚动: boolean
  元凶: Array<{ cls: string; 超出: number; 高: number }>
  最紧: Array<{ cls: string; 余量: number }>
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  const cdp = await Cdp.connect(CDP)
  const results: Array<Record<string, unknown>> = []
  try {
    for (const save of SAVES) {
      const savePath = join(SAVE_DIR, save.file)
      const text = readFileSync(savePath, 'utf8')
      for (const vp of VIEWPORTS) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: vp.w,
          height: vp.h,
          deviceScaleFactor: 1,
          mobile: vp.mobile,
        })
        /**
         * 手机档要连 **UA / 触摸**一起模拟：只改视口不会让应用进入手机模式，
         * 而手机竖屏会自动旋转成 1200px 虚拟横屏（`--mob-w`）——不模拟就量到"没旋转"的假读数。
         */
        await cdp.send('Emulation.setUserAgentOverride', {
          userAgent: vp.mobile
            ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36'
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
          platform: vp.mobile ? 'Android' : 'Windows',
        })
        // ⚠ `maxTouchPoints` 必须 ≥1（给 0 会被 CDP 拒），非手机档直接不发这条
        if (vp.mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
        for (const locale of ['zh', 'en'] as const) {
          await cdp.send('Page.navigate', { url: APP })
          await waitFor(cdp, `document.readyState === 'complete' && !!window.localStorage`, '首次加载')
          await cdp.evalJS(
            `localStorage.setItem('whale:idle:save', ${JSON.stringify(text)});` +
              `localStorage.setItem('whale-idle:locale', ${JSON.stringify(locale)}); 'ok'`,
          )
          await cdp.send('Page.reload')
          await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, `${save.name}/${vp.label}/${locale} 启动`)
          /**
           * 浏览器里**没有主进程桥**（`window.whale` 只在 Electron 里存在）⇒ 切语言走渲染层暴露的
           * 探针钩子 `window.__setLocale`（见 `i18n/locale.tsx` 的 L10nProvider）。
           */
          const applied = await cdp.evalJS<boolean>(
            `(() => { const f = window.__setLocale; if (typeof f !== 'function') return false; f(${JSON.stringify(locale)}); return true })()`,
          )
          if (!applied) throw new Error('页面没有暴露 __setLocale 钩子（i18n/locale.tsx 被改过？）')
          await sleep(320) // 等整棵树按新语言重渲染
          for (const page of PAGES) {
            const label = navLabelOf(page.nav, locale)
            const clicked = await cdp.evalJS<boolean | { items: string[]; want: string }>(
              `(() => {
                 const items = [...document.querySelectorAll('.app-nav-item')]
                 const want = ${JSON.stringify(label)}
                 const norm = (s) => (s || '').replace(/\\s+/g, '').trim()
                 const exact = items.find((b) => norm(b.textContent) === norm(want))
                 const n = exact ?? items.find((b) => norm(b.textContent).includes(norm(want)))
                 if (n) { n.click(); return true }
                 // 点不到就把导航实测文本回传，便于一眼看出是标签变了还是结构变了
                 return { items: items.map((b) => norm(b.textContent)), want: norm(want) }
               })()`,
            )
            if (clicked !== true) {
              throw new Error(`点不到导航项「${label}」（${page.key}）：导航项实测 = ${JSON.stringify(clicked)}`)
            }
            await waitFor(cdp, `!!document.querySelector('main')`, `${page.key} 渲染`)
            await sleep(260) // 等布局稳定（图表/网格/异步块）
            const r = await cdp.evalJS<PageReading>(READ_PAGE)
            results.push({ 档: save.name, 窗口: vp.label, 语言: locale, 页: page.key, ...r })
            const flag = r.页面纵向滚动 ? '❌ 破红线' : r.内容区滚动 ? '⚠ 内容区在滚' : '✅ 不滚'
            console.log(
              `${flag}  ${save.name.padEnd(9)} ${vp.label.padEnd(14)} ${locale}  ${page.key.padEnd(9)}` +
                `纵溢 ${String(r.纵向溢出).padStart(5)}px  横溢 ${String(r.横向溢出).padStart(4)}px` +
                `  内容区 ${String(r.内容区溢出 ?? 0).padStart(5)}px  旋转=${r.旋转 ? 'Y' : 'n'}`,
            )
          }
        }
      }
    }
  } finally {
    cdp.close()
  }
  const out = join(OUT_DIR, 'overflow.json')
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8')
  const bad = results.filter((r) => r.页面纵向滚动 === true)
  console.log(`\n共 ${results.length} 组读数 · 破红线（一级页出现滚动条）**${bad.length}** 组`)
  console.log(`明细：${out}`)
}

main().catch((e: unknown) => {
  console.error(String(e instanceof Error ? e.message : e))
  process.exit(1)
})
