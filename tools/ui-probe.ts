/**
 * **装配页 CPU 显示 · 无头渲染核对**（正式入库；原临时探针 `H:\大鲸鱼\_ui-probe.mjs` 按工具纪律转正）。
 *
 * 背景（船长 2026-09-12 裁定「甲」）：装配页 CPU 剩余**允许为负**——超载 ⇒ 卡片「CPU 剩 11→−9（差 9）」红 +
 * 顶条「−15 / 130 · 超 15」红；**刚好装满（=0）**琥珀、不再算红。本工具把「四档状态 × 顶条 × 候选卡差异段」
 * 的**实际渲染结果**（文本 / class / 计算色）一次打出来，用于改样式前后对照，也用于回答"到底哪一档变红了"。
 *
 * **运行前置**（三件，缺一会明确报错）：
 *   1) 网页版已构建并在跑：`npm run build --prefix web` 后由本地服务托管（默认 `http://localhost:4173/`）；
 *   2) 无头 Chrome 带远程调试：`chrome --headless=new --remote-debugging-port=9222`（默认 CDP `127.0.0.1:9222`）；
 *   3) 输入档就位：`--make-saves` 会打印需要的四份档与该目录。
 *
 * 用法：
 *   npx tsx tools/ui-probe.ts                 # 对四份档各做一遍：注入 → 重载 → 装配页 → 读顶条/候选卡 → 截屏
 *   npx tsx tools/ui-probe.ts --make-saves    # 只打印"输入档约定"与目录（不连浏览器）
 *   npm run ui:probe                          # 等价（见 package.json）
 *
 * 输入 / 输出：
 *   - 输入：`tools/_ui-artifacts/saves/{a-room,b-nearfull,c-exactfull,d-over}.json`
 *     （**可从主页面「存档管理 → 导出」另存得到**；CPU 四档状态靠配装/技能造出，属一次性夹具）
 *   - 输出：`tools/_ui-artifacts/shots/*.png` 与 `readings.json`（**均可重建，不入库**）
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v24**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-12**（当日核对：装配页 CPU 显示「甲案」四档 + 一级页不滚）
 *   - 本工具最后跑过：**2026-09-12**
 *   - 判据：`CURRENT_STATE_VERSION − v24 ≥ 2` ⇒ **必须重跑核对**（存档结构跨了一个大版本，注入档与选择器都可能失效）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 产物与输入档都放仓库内 `tools/_ui-artifacts/` 下（**可重建、不入库**：见文件头"输入 / 输出"） */
const ARTIFACT_DIR = join(process.cwd(), 'tools', '_ui-artifacts')
const SAVE_DIR = join(ARTIFACT_DIR, 'saves')
const SHOT_DIR = join(ARTIFACT_DIR, 'shots')
const APP = process.env.UI_APP_URL ?? 'http://localhost:4173/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9222'
const SAVE_NAMES = ['a-room', 'b-nearfull', 'c-exactfull', 'd-over'] as const

/** 第一次运行就建好目录（并说明输入档从哪来），免得"文件找不到"变成谜题 */
function ensureDirs(): void {
  mkdirSync(SAVE_DIR, { recursive: true })
  mkdirSync(SHOT_DIR, { recursive: true })
}

function printSaveContract(): void {
  ensureDirs()
  console.log('输入档约定（四份，缺哪份就造哪份）：')
  console.log(`  目录：${SAVE_DIR}`)
  for (const n of SAVE_NAMES) {
    const p = join(SAVE_DIR, `${n}.json`)
    console.log(`  - ${n}.json ${existsSync(p) ? '✓ 已就位' : '✗ 缺失'}——${SAVE_MEANING[n]}`)
  }
  console.log('\n造法：游戏内「存档管理 → 导出」另存为对应名字（CPU 四档状态靠配装/技能造出）。')
  console.log('用途：装配页 CPU 条的四档渲染（空余 / 将满 / 刚好装满 / 超载）各一份，供对照核对。')
  console.log(`\n产物目录（可重建、不入库）：${SHOT_DIR}`)
}

const SAVE_MEANING: Record<(typeof SAVE_NAMES)[number], string> = {
  'a-room': 'CPU 余量充裕（常态绿）',
  'b-nearfull': '接近装满但未满（琥珀预警档）',
  'c-exactfull': '刚好装满 = 0（琥珀、不算红）',
  'd-over': '超载（剩余为负、差 N、标红）',
}

/* ── CDP 小工具（无类型依赖：Node 自带 fetch / WebSocket） ── */
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

async function waitFor(cdp: Cdp, expr: string, label: string, timeoutMs = 15_000): Promise<void> {
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

const READ_STRIP = `(() => {
  const s = document.querySelector('.app-fit-cpustrip')
  if (!s) return null
  const q = (sel) => s.querySelector(sel)
  return {
    cls: s.className,
    label: q('.app-fit-cpustrip-label')?.textContent,
    num: q('.app-fit-cpustrip-num')?.textContent?.trim(),
    tail: q('.app-fit-cpustrip-pct')?.textContent?.trim(),
    tailColor: getComputedStyle(q('.app-fit-cpustrip-pct')).color,
    borderColor: getComputedStyle(s).borderColor,
    trackBg: getComputedStyle(q('.app-fit-cpustrip-track i')).backgroundImage?.slice(0, 60),
    title: s.getAttribute('title'),
  }
})()`

const READ_CARDS = `(() => {
  const cards = [...document.querySelectorAll('.app-fit-pick-item')]
  return cards.map((b) => ({
    name: b.querySelector('.app-fit-pick-name')?.textContent,
    sub: b.querySelector('.app-fit-pick-subtext')?.textContent?.trim(),
    segs: [...b.querySelectorAll('.dseg')].map((x) => ({ t: x.textContent, cls: x.className, color: getComputedStyle(x).color })),
  }))
})()`

async function main(): Promise<void> {
  if (process.argv.includes('--make-saves')) {
    printSaveContract()
    return
  }
  ensureDirs()
  const missing = SAVE_NAMES.filter((n) => !existsSync(join(SAVE_DIR, `${n}.json`)))
  if (missing.length > 0) {
    console.error(`缺少输入档：${missing.join('、')}`)
    printSaveContract()
    process.exitCode = 1
    return
  }

  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const results: Record<string, unknown> = {}
  for (const name of SAVE_NAMES) {
    const save = readFileSync(join(SAVE_DIR, `${name}.json`), 'utf8')
    await cdp.send('Page.navigate', { url: APP })
    await waitFor(cdp, `document.readyState === 'complete' && !!window.localStorage`, '首次加载')
    await cdp.evalJS(`localStorage.setItem('whale:idle:save', ${JSON.stringify(save)}); 'ok'`)
    await cdp.send('Page.reload')
    await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, `${name} 启动`)
    await cdp.evalJS(
      `(() => { const n = [...document.querySelectorAll('.app-nav-item')].find((b) => b.textContent.includes('装配')); n && n.click(); return !!n })()`,
    )
    await waitFor(cdp, `!!document.querySelector('.app-fit-cpustrip')`, `${name} 装配页`)
    const strip = await cdp.evalJS<unknown>(READ_STRIP)
    const bayClick = await cdp.evalJS<{ racks: number; bays: number; clicked: boolean }>(`(() => {
      const r = document.querySelectorAll('.app-fit-rack')[2]
      const b = r && r.querySelectorAll('.app-fit-slot-icon')[1]
      if (b) b.click()
      return { racks: document.querySelectorAll('.app-fit-rack').length, bays: r ? r.querySelectorAll('.app-fit-slot-icon').length : -1, clicked: !!b }
    })()`)
    await waitFor(cdp, `!!document.querySelector('.app-fit-pick-item')`, `${name} 候选卡`)
    const cards = await cdp.evalJS<Array<{ name?: string; segs: Array<{ t: string; cls: string; color: string }> }>>(READ_CARDS)
    const note = await cdp.evalJS<string | null>(`document.querySelector('.app-fit-modal .app-note')?.textContent ?? null`)
    const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data?: string }
    if (shot.data) writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(shot.data, 'base64'))
    await cdp.evalJS(
      `(() => { const b = [...document.querySelectorAll('.app-fit-modal-head button')].find((x) => x.textContent.includes('关闭')); b && b.click(); return true })()`,
    )
    results[name] = {
      顶部条: strip,
      点低槽第2位: bayClick,
      候选卡: cards.filter((c) => c.segs.some((s) => s.t.includes('CPU'))).map((c) => ({
        名称: c.name,
        段: c.segs.map((s) => `${s.t} [${s.cls} ${s.color}]`),
      })),
      浮层说明: note,
    }
    console.log(`\n══════ ${name} ══════`)
    console.log(JSON.stringify(results[name], null, 1))
  }
  writeFileSync(join(SHOT_DIR, 'readings.json'), JSON.stringify(results, null, 2), 'utf8')
  console.log(`\n截屏与读数：${SHOT_DIR}`)
  cdp.close()
}

main().catch((e: unknown) => {
  console.error(`ui-probe 失败：${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
