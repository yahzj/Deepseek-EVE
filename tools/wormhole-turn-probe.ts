/**
 * **虫洞回合账本 · 真流程复核探针**（`npm run wh:turn`）
 *
 * **用途**：船长 2026-09-22 报障「虫洞内玩家将谜质时序来回拖动会重复加回合。」
 * 这条 bug 有两半，都在 core 侧修掉了，本探针在**真界面**里把整条链路再走一遍：
 *   ① `wormholeSyncMatterTurns` 的"单边夹紧"改成"已花费守恒"（单测 `wormhole-matter.test.ts ⑤b` 钉住）；
 *   ② `save.ts` 的洞内趟是**逐字段重建**的，`turnsBase` / `turnsTechBonus` 曾漏登记
 *      ⇒ 每读一次档就丢一次账本锚（单测 ⑤c 钉住）。
 *
 * 走法：装档 → 出港 → 扫描虫洞 → 返回虫洞 → 货仓页 → **点选 + 落格**（与拖拽同一条
 * `dropAt → wormholeBoardTransfer` 路径）把「时序核心」在货仓 ↔ 临时空间之间来回搬 3 趟，
 * 每趟读**界面上的回合行**与 localStorage 存档两处读数。
 * 判据：**上限与剩余每趟都必须回到起始那一对值**（出仓 −10、回仓 +10，净零）。
 *
 * **前置**（三件，缺一会明确报错）：
 *   1) `npm run build --prefix web` 后由本地服务托管（默认 `http://localhost:4173/`）；
 *   2) 无头 Chrome 带远程调试（**非默认端口**，默认 CDP `127.0.0.1:9334`）；
 *   3) 一份**在洞内、且货仓里带「时序核心」**的档（默认用 `docs/test-saves/test-save-wh-all-20260914-122105.json`）。
 *
 * 用法：`npx tsx tools/wormhole-turn-probe.ts` · `--diag` 只打印洞内页签与现场（排查选择器用）
 * 环境变量：`UI_APP_URL` / `UI_CDP_URL` / `UI_SAVE`
 *
 * ⚠ 读数型工具（约定 §6 例外①）：只报"回合数对不对"，界面好不好看归船长。
 */
import { readFileSync } from 'node:fs'

const APP = process.env.UI_APP_URL ?? 'http://localhost:4173/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9334'
const SAVE = process.env.UI_SAVE ?? 'docs/test-saves/test-save-wh-all-20260914-122105.json'

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

async function waitFor(cdp: Cdp, expr: string, label: string, timeoutMs = 20_000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      if (await cdp.evalJS<boolean>(expr)) return
    } catch {
      /* 页面切换中 */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`等不到：${label}`)
    await sleep(120)
  }
}

/** 点一下元素（真鼠标事件：走输入管线，与玩家点的一样） */
async function clickSel(cdp: Cdp, sel: string, label: string): Promise<void> {
  const box = await cdp.evalJS<{ x: number; y: number; title: string } | null>(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), title: (el.getAttribute('title') || '').slice(0, 40) }
  })()`)
  if (!box) throw new Error(`找不到元素：${label}（${sel}）`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none' })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await sleep(450)
}

/** 回合读数：**界面上的那一行**（玩家看到的就是它）＋ localStorage 存档（命令后异步落盘，可能滞后） */
async function readTurns(cdp: Cdp): Promise<{ left: number; total: number; hold: string[]; temp: string[]; 屏: string }> {
  const 屏 = await cdp.evalJS<string>(`((document.body.innerText.match(/回合\\s*\\d+\\s*\\/\\s*\\d+/) || ['（界面没找到回合行）'])[0])`)
  const raw = await cdp.evalJS<string | null>(`localStorage.getItem('whale:idle:save')`)
  if (!raw) throw new Error('localStorage 里没有存档')
  const j = JSON.parse(raw) as { state?: { wormhole?: { run?: { turnsLeft?: number; turnsTotal?: number; turnsBase?: number; hold?: { placements?: Array<{ itemId: string }> }; tempGrid?: { placements?: Array<{ itemId: string }> } } } } }
  const run = (j.state ?? (j as unknown as { wormhole?: unknown })).wormhole?.run
  if (!run) throw new Error('存档里没有在途的虫洞趟')
  return {
    left: run.turnsLeft ?? -1,
    total: run.turnsTotal ?? -1,
    hold: (run.hold?.placements ?? []).map((p) => p.itemId),
    temp: (run.tempGrid?.placements ?? []).map((p) => p.itemId),
    屏,
  }
}

const CELL_OF = (board: 'hold' | 'temp', text: string): string =>
  `.app-wh-hold-grid.is-${board} .app-wh-hold-cell[title*=${JSON.stringify(text)}]`
const FREE_CELL = (board: 'hold' | 'temp'): string => `.app-wh-hold-grid.is-${board} .app-wh-hold-cell.is-free`

async function main(): Promise<void> {
  const saveText = readFileSync(SAVE, 'utf8')
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.readyState === 'complete' && !!window.localStorage`, '首次加载')
  await cdp.evalJS(`localStorage.setItem('whale:idle:save', ${JSON.stringify(saveText)}); 'ok'`)
  await cdp.send('Page.reload')
  await waitFor(cdp, `!!document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '游戏启动')
  console.log(`存档：${SAVE}`)

  // 出港 → 扫描虫洞 → 货仓
  await cdp.evalJS(`(() => { const n = [...document.querySelectorAll('.app-nav-item')].find((b) => (b.textContent||'').includes('出港')); n && n.click(); return !!n })()`)
  await sleep(1200)
  await cdp.evalJS(`(() => { const t = [...document.querySelectorAll('.app-subtab, .app-tasktab, button')].find((b) => (b.textContent||'').trim() === '扫描虫洞'); t && t.click(); return !!t })()`)
  await sleep(1500)
  // 已有在途的趟 ⇒ 扫描页给的是「返回虫洞」，先回到洞内视图
  await cdp.evalJS(`(() => { const t = [...document.querySelectorAll('button')].find((b) => (b.textContent||'').trim() === '返回虫洞'); t && t.click(); return !!t })()`)
  await sleep(1500)
  const opened = await cdp.evalJS<string[]>(`[...document.querySelectorAll('.app-subtab, .app-tasktab')].map((b) => (b.textContent||'').trim())`)
  console.log(`洞内可见标签：${[...new Set(opened)].join(' / ')}`)
  if (process.argv.includes('--diag')) {
    const d = await cdp.evalJS<Record<string, unknown>>(`(() => ({
      虫洞类: [...new Set([...document.querySelectorAll('[class*="app-wh-"]')].map((e) => String(e.className).split(' ')[0]))].slice(0, 26),
      洞内页签: [...document.querySelectorAll('[class*="app-wh-tab"]')].map((e) => ((e.textContent||'').trim().slice(0, 8) + '|' + String(e.className))),
      回合文本: (document.body.innerText.match(/回合[^\\n]{0,20}/g) || []).slice(0, 4),
    }))()`)
    console.log('\n──── 返回虫洞之后 ────')
    console.log(JSON.stringify(d, null, 1))
    cdp.close()
    process.exit(0)
  }
  // 洞内页签（自定义 `app-wh-tab`）：切到「货仓」
  await cdp.evalJS(`(() => { const t = [...document.querySelectorAll('.app-wh-tab')].find((b) => (b.textContent||'').includes('货仓')); t && t.click(); return !!t })()`)
  await waitFor(cdp, `!!document.querySelector('.app-wh-hold-grid.is-hold')`, '货仓格板')
  console.log(`两块格板就位：货仓 ${await cdp.evalJS<number>(`document.querySelectorAll('.app-wh-hold-grid.is-hold .app-wh-hold-cell').length`)} 格 · 临时空间 ${await cdp.evalJS<number>(`document.querySelectorAll('.app-wh-hold-grid.is-temp .app-wh-hold-cell').length`)} 格`)

  const start = await readTurns(cdp)
  console.log(`\n起始：界面「${start.屏}」· 存档 ${start.left}/${start.total} · 货仓[${start.hold.join(',')}] · 临时[${start.temp.join(',')}]`)
  if (!start.hold.includes('mat-chrono')) throw new Error('这份档的货仓里没有时序核心，换一份存档')

  console.log('\n══ 来回拖 3 个来回（点击 = 选中 → 落到对面空格，与拖拽同一条 core 路径）══')
  let bad = 0
  let firstNet: number | null = null
  for (let i = 1; i <= 3; i++) {
    // 出仓：货仓 → 临时空间
    await clickSel(cdp, CELL_OF('hold', '时序核心'), '货仓里的时序核心')
    await clickSel(cdp, FREE_CELL('temp'), '临时空间空格')
    await sleep(500)
    const out = await readTurns(cdp)
    // 回仓：临时空间 → 货仓
    await clickSel(cdp, CELL_OF('temp', '时序核心'), '临时空间里的时序核心')
    await clickSel(cdp, FREE_CELL('hold'), '货仓空格')
    await sleep(500)
    const back = await readTurns(cdp)
    if (firstNet === null) firstNet = back.left - start.left
    // 判据：**第 1 趟之后不再增长**（第 1 趟的差额是老档反推的一次性口径，与"重复加"无关）
    const ok = i === 1 || back.left === (firstNet + start.left)
    if (!ok) bad++
    console.log(
      `  第 ${i} 趟：出仓 界面「${out.屏}」存档 ${out.left}/${out.total} → 回仓 界面「${back.屏}」存档 ${back.left}/${back.total}` +
        `（相对起始 ${back.left - start.left >= 0 ? '+' : ''}${back.left - start.left}）${ok ? ' ✅' : ' ❌ 又涨了'}`,
    )
    console.log(`         装置：货仓 ${back.hold.filter((s) => s === 'mat-chrono').length} 台 · 临时[${back.temp.join(',') || '空'}]`)
  }
  console.log(
    `\n结论：${bad === 0 ? '✅ 第 1 趟之后不再增长 —— 来回拖不刷回合' : `❌ 有 ${bad} 趟仍在增长（刷回合）`}` +
      `（第 1 趟一次性差额 ${firstNet === null ? '—' : firstNet >= 0 ? '+' + firstNet : String(firstNet)} 回合，属老档反推口径，见文档）`,
  )
  cdp.close()
  if (bad > 0) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(`_wh-turn-probe 失败：${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
