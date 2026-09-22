/**
 * **英文语境残留中文扫描 · 无头直驱**（正式入库，2026-09-22 由临时探针 `_l10n-en-scan.ts` 转正）。
 *
 * 为什么需要它（**船长 2026-09-22 报障**：「之前关于筛选选项的文案和标签页的文案，还未完成吧？
 * 我这边发现有遗漏」）：静态工具 `npm run l10n:check` **只认源码里的字符串字面量**，下面三类它全看不见 ——
 * ① **模板串拼出来的档**（`label: `${s.label}蓝图``：没有字面量可扫，英文下却整句中文）；
 * ② **直接渲染 `.label` 而没走 `subText`** 的筛选档（字面量在别处、渲染处无字面量）；
 * ③ **半译句**（前缀走 `tr(id)`、尾巴是字面量拼上去，静态看两边都"合规"）。
 * 只有**真渲染一遍**才算数，所以本工具用无头 Chrome 在 `locale=en` 下逐页（并逐页签）把含中日韩字符的
 * 可见文本节点摊出来，连类名一起报，便于回代码定位。
 *
 * 前置（外部先起好，本工具不启动也不关闭任何进程）：
 *   1) `npm --prefix web run build` 后由本地服务托管 `web/dist`；
 *      ⚠ 本机 Windows 上 `vite preview` **只监听 IPv6** ⇒ 地址用 `http://[::1]:端口/`；
 *   2) 无头 Chrome 带远程调试（默认 `http://127.0.0.1:9333`）。
 *
 * 用法：`npx tsx tools/l10n-en-scan.ts`（等价 `npm run l10n:scan`）
 *   - `L10N_SAVE=<存档路径>` 换夹具（默认船长的真档 `docs/test-saves/user-backup-20260920-102449.json`：
 *     仓库/工业/市场里东西多，筛选档才现得出来）；
 *   - `L10N_MAX_PER_PAGE=<n>` 每处最多报几行（默认 40）。
 *
 * 输出：stdout —— 逐页/逐页签打印「残留中文 N 处」+ 每处的 `[类名] <标签> 文本`，末尾合计。
 * ⚠ **读数不等于结论**：玩家数据（船名、舰长名、自定名）与刻意保留的中文本来就不该译，
 * 报出来只作**复查线索**，是否要译由船长定。不写任何文件。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v31**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-22**（当日核对：10 个导航页 + 各页页签，逐页扫可见中文）
 *   - 本工具最后跑过：**2026-09-22**
 *   - 判据：`CURRENT_STATE_VERSION − v31 ≥ 2` ⇒ **必须重跑核对**；此外页面结构改动
 *     （导航项 `NAV_ITEMS` 增删、页签类名 `.app-tasktab` 改名、`.app-page-content` 换壳）⇒ 也须重跑。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP = process.env.UI_APP_URL ?? 'http://[::1]:4174/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'
const SAVE_KEY = 'whale:idle:save'
const LOCALE_KEY = 'whale-idle:locale'
const SAVE_FILE = process.env.L10N_SAVE ?? join(process.cwd(), 'docs', 'test-saves', 'user-backup-20260920-102449.json')
const MAX_PER_PAGE = Number(process.env.L10N_MAX_PER_PAGE ?? 40)
/** 导航顺序 = `App.tsx` 的 `NAV_ITEMS`（英文语境下按序号点，不靠文案匹配） */
const PAGES = ['map', 'ship', 'fit', 'items', 'market', 'industry', 'skills', 'task', 'achieve', 'comms']

function say(line: string): void {
  process.stdout.write(`${line}\n`)
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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
    if (res.exceptionDetails) throw new Error(`页面脚本报错：${JSON.stringify(res.exceptionDetails).slice(0, 1200)}`)
    return res.result?.value as T
  }
}

async function waitFor(cdp: Cdp, expr: string, what: string, timeoutMs = 20_000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await cdp.evalJS<boolean>(`!!(${expr})`)) return true
    await wait(250)
  }
  say(`    [!] 等不到：${what}`)
  return false
}

/**
 * 扫当前内容区里含中日韩字符的**可见**文本节点（跳过 display:none / 零尺寸 / 纯空白）。
 * 每处给「最近的有类名祖先 :: 文本」，按 `类名 + 文本` 去重。
 */
const SCAN = `(() => {
  const CJK = /[\\u3400-\\u9fff\\u3040-\\u30ff]/
  const root = document.querySelector('.app-page-content') || document.body
  const out = []
  const seen = new Set()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    const t = (n.nodeValue || '').replace(/\\s+/g, ' ').trim()
    if (!t || !CJK.test(t)) continue
    const el = n.parentElement
    if (!el) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    let host = el
    while (host && host !== root && !(host.className && String(host.className).trim())) host = host.parentElement
    const cls = host ? String(host.className).split(' ').slice(0, 3).join('.') : '(无类名)'
    const key = cls + ' ' + t
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ cls, tag: el.tagName.toLowerCase(), text: t.slice(0, 70) })
    if (out.length >= 400) break
  }
  return out
})()`

interface Hit {
  cls: string
  tag: string
  text: string
}

async function scan(cdp: Cdp, label: string): Promise<number> {
  const hits = await cdp.evalJS<Hit[]>(SCAN)
  if (hits.length === 0) return 0
  say(`\n─── ${label}：残留中文 ${hits.length} 处 ───`)
  for (const h of hits.slice(0, MAX_PER_PAGE)) say(`   [${h.cls}] <${h.tag}> ${h.text}`)
  if (hits.length > MAX_PER_PAGE) say(`   …（另有 ${hits.length - MAX_PER_PAGE} 处，未逐条列出）`)
  return hits.length
}

async function main(): Promise<void> {
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.querySelector('.app-nav-side')`, '首次进入应用的源', 30_000)
  const text = readFileSync(SAVE_FILE, 'utf8').replace(/\\/g, '\\\\').replace(/`/g, '\\`')
  await cdp.evalJS(
    `localStorage.setItem(${JSON.stringify(LOCALE_KEY)}, 'en'); localStorage.setItem(${JSON.stringify(SAVE_KEY)}, \`${text}\`); 1`,
  )
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.querySelector('.app-nav-side')`, '英文语境主界面')
  const lang = await cdp.evalJS<string>(`document.documentElement.lang || '(未设)'`)
  const navText = await cdp.evalJS<string>(
    `[...document.querySelectorAll('.app-nav-side .app-nav-item')].map((b) => (b.textContent||'').trim()).join(' / ')`,
  )
  say(`═══ 英文语境残留中文扫描（locale=en）═══\n· html lang=${lang}\n· 导航项：${navText}`)
  let total = 0
  for (let i = 0; i < PAGES.length; i++) {
    const clicked = await cdp.evalJS<string>(`(() => {
      const items = [...document.querySelectorAll('.app-nav-side .app-nav-item')]
      const b = items[${i}]
      if (!b) return ''
      b.click(); return (b.textContent || '').trim()
    })()`)
    if (!clicked) {
      say(`\n─── 第 ${i + 1} 页（${PAGES[i]}）：没找到导航项 ───`)
      continue
    }
    await wait(900)
    total += await scan(cdp, `第 ${i + 1} 页（${PAGES[i]} · 导航文案「${clicked}」）`)
    /**
     * **逐页签再扫一遍**：筛选档与标签页常在二级/三级页签里（例：工业页的 `.app-subtabs`
     * 精炼炉 / 蓝图书架 / 组装机 / **造船厂**——造船厂的「学会：/子类：/图纸：」三行筛选只在那个页签下渲染），
     * 只扫默认页签会整批漏掉。
     * ⚠ 选择器含**两族**页签类名：`.app-tasktab`（任务/筛选行）与 `.app-subtab`（页面级功能标签页）；
     * 仓库/工业页的页面级切换正是后者（2026-09-22 首版只认前者 ⇒ 造船厂整页漏扫，实测踩到）。
     */
    const tabN = await cdp.evalJS<number>(`document.querySelectorAll('.app-tasktab, .app-subtab').length`)
    for (let k = 0; k < tabN; k++) {
      const tabText = await cdp.evalJS<string>(`(() => {
        const b = document.querySelectorAll('.app-tasktab, .app-subtab')[${k}]
        if (!b) return ''
        b.click(); return (b.textContent || '').trim()
      })()`)
      if (!tabText) continue
      await wait(700)
      total += await scan(cdp, `  ↳ ${PAGES[i]} 页签「${tabText}」`)
    }
  }
  say(`\n═══ 合计残留中文 ${total} 处 ═══`)
  say('（读数不等于结论：船名/舰长名等玩家数据与刻意保留的中文不该译，逐条判由船长定）')
}

void main().finally(() => process.exit(0))
