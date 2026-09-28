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
 *   - `UI_APP_URL`：被测地址（默认 `http://[::1]:4174/`；`web` 的 `vite preview` 在部分机器上
 *     只监听 IPv6，本机实测 `127.0.0.1` 也通 ⇒ 传 `http://127.0.0.1:4174/` 更稳）；
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
 *   - 本工具最后核对：**2026-09-27**（当日核对：修 4 处 DOM 假设后重跑，英文口径 **433 处**；
 *     修前同一档的旧读数是 474 —— 差额主要来自"按序号点导航会点错页"与"图标页签被跳过"）
 *   - 本工具最后跑过：**2026-09-27**
 *   - 判据：`CURRENT_STATE_VERSION − v31 ≥ 2` ⇒ **必须重跑核对**；此外页面结构改动
 *     （导航项 `NAV_ITEMS` 增删、内容区 `.app-page-content` 的 `data-page` 属性被删、
 *     页签类名 `.app-tasktab` / `.app-subtab` 改名）⇒ 也须重跑。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP = process.env.UI_APP_URL ?? 'http://[::1]:4174/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'
const SAVE_KEY = 'whale:idle:save'
const LOCALE_KEY = 'whale-idle:locale'
const SAVE_FILE = process.env.L10N_SAVE ?? join(process.cwd(), 'docs', 'test-saves', 'user-backup-20260920-102449.json')
const MAX_PER_PAGE = Number(process.env.L10N_MAX_PER_PAGE ?? 40)
/**
 * 要扫的页 = `App.tsx` 的 `NAV_ITEMS` 键 + **它在英文界面下的导航文案**。
 *
 * ⚠ **为什么不能按下标点**（2026-09-27 三号修第一处工具缺陷）：导航项在 DOM 里**不是数组顺序**——
 * `AppShell` 把"出港"单独摘出居中、其余按数量对半分成左右两组（见那段注释），
 * 所以 DOM 顺序 = [Ships, Fitting, Items, Market, Industry] + [Undock] + [Skills, Task Center,
 * Achievements, Comms]。旧写法按 `items[0]` 取第一项 ⇒ 扫"星图"时实际点的是**舰船页**，
 * 全表整体错位（实测读数第 1 页标签写着 map、导航文案却是「Ships」）。
 * ⇒ 现在按**导航文案**找（语言与顺序都无关），找不到才回落到下标并在读数里点名。
 */
const PAGES: ReadonlyArray<{ key: string; nav: string }> = [
  { key: 'map', nav: 'Undock' },
  { key: 'ship', nav: 'Ships' },
  { key: 'fit', nav: 'Fitting' },
  { key: 'items', nav: 'Items' },
  { key: 'market', nav: 'Market' },
  { key: 'industry', nav: 'Industry' },
  { key: 'skills', nav: 'Skills' },
  { key: 'task', nav: 'Task Center' },
  { key: 'achieve', nav: 'Achievements' },
  { key: 'comms', nav: 'Comms' },
]

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
  /**
   * **在本 target 的每个新文档里、页面脚本之前**执行一段脚本（CDP `Page.addScriptToEvaluateOnNewDocument`）。
   *
   * 为什么必须用它：应用**在 bundle 执行时**就把存档与语言读进内存了 ⇒ 先导航、再用
   * `Runtime.evaluate` 写 `localStorage`，那一次载入**已经读到空档**（实测：全新 profile 的
   * 首屏表现为"钱包 0 · 导航 8 项"＝新档，第二次导航才对）——那 119KB 存档白写。
   * 改成本函数注入 ⇒ **首个文档就是目标档 + 目标语言**。
   */
  async addStartScript(source: string): Promise<string> {
    const r = (await this.send('Page.addScriptToEvaluateOnNewDocument', { source })) as { identifier?: string }
    return r.identifier ?? ''
  }
  /** 收回注入（跑完必调：脚本会**累积**，留着会在后续文档里再执行一遍、把语言/存档顶掉） */
  async removeStartScript(identifier: string): Promise<void> {
    if (identifier === '') return
    await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
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
 * 扫某个根节点里含中日韩字符的**可见**文本节点（跳过 display:none / 零尺寸 / 纯空白）。
 * 每处给「最近的有类名祖先 :: 文本」，按 `类名 + 文本` 去重。
 * ⚠ 默认根 = `.app-page-content`（导航页）；**手册一类弹层不在这个根里**，要显式传选择器。
 */
const scanExpr = (rootSel: string): string => `(() => {
  const CJK = /[\\u3400-\\u9fff\\u3040-\\u30ff]/
  const root = document.querySelector(${JSON.stringify(rootSel)}) || document.body
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

async function scan(cdp: Cdp, label: string, rootSel = '.app-page-content'): Promise<number> {
  /**
   * **读数自检**（2026-09-27 补）：先数"含中日韩的文本节点总数"（不加可见性判据），
   * 再数"筛掉不可见后的命中数"。两者差太多时把数报出来 —— 免得再把"没扫到"
   * 与"扫到了但被过滤掉"当成同一件事（本轮查工具时正是靠这个分清病根的）。
   */
  const raw = await cdp.evalJS<number>(`(() => {
    const CJK = /[\\u3400-\\u9fff\\u3040-\\u30ff]/
    const root = document.querySelector(${JSON.stringify(rootSel)}) || document.body
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let n = 0
    let node
    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || '').replace(/\\s+/g, ' ').trim()
      if (t && CJK.test(t)) n += 1
      if (n > 2000) break
    }
    return n
  })()`)
  const hits = await cdp.evalJS<Hit[]>(scanExpr(rootSel))
  if (hits.length === 0) {
    if (raw > 0) say(`\n─── ${label}：残留中文 0 处（原文节点 ${raw} 条，全被判为不可见）───`)
    return 0
  }
  say(`\n─── ${label}：残留中文 ${hits.length} 处${raw > hits.length ? `（原文节点 ${raw} 条）` : ''} ───`)
  for (const h of hits.slice(0, MAX_PER_PAGE)) say(`   [${h.cls}] <${h.tag}> ${h.text}`)
  if (hits.length > MAX_PER_PAGE) say(`   …（另有 ${hits.length - MAX_PER_PAGE} 处，未逐条列出）`)
  return hits.length
}

/**
 * **页签的取法**（2026-09-27 修）：**只在当前页的容器里**取，不许全局取。
 *
 * 病根（实测）：`.app-tasktab` / `.app-subtab` 这两族类名**不止导航页在用** ——
 * 手册是弹层（`.app-hand-modal`），里面「我的舰队」筛选行也是 `.app-tasktab`
 * （实测 9 个：All / Ships / Industry / …）。全局取的话，一旦页面上还留着弹层，
 * 这些**别的组件的页签**就会被当成"本页的页签"逐个点开，读数张冠李戴
 * （实测：通讯页冒出「Standing bounty 53 处」这种不可能的组合）。
 */
const PAGE_TABS = `.app-page-content .app-tasktab:not(.app-hand-modal *), .app-page-content .app-subtab:not(.app-hand-modal *)`

/**
 * 点一个页签（两族类名：任务/筛选行 `.app-tasktab`、页面级功能标签页 `.app-subtab`；范围 = 当前页）。
 *
 * ⚠ 返回 `{ ok, label }` 而**不是一个字符串**（2026-09-27 再修）：星图页那一排页签是**图标式**
 * （`<button>` 里只有图标，`textContent` 是空串）⇒ 旧写法用"文案非空"当"点到了"的判据，
 * 于是那几个页签被 `continue` 悄悄跳过、**内容整页漏扫**（实测：第 1 页一行读数都没有）。
 * 现在"点到没点到"与"有没有文案"分开判；没有文案就用序号当标签。
 */
async function clickTab(cdp: Cdp, index: number): Promise<{ ok: boolean; label: string }> {
  const r = await cdp.evalJS<{ ok: boolean; label: string }>(`(() => {
    const b = document.querySelectorAll(${JSON.stringify(PAGE_TABS)})[${index}]
    if (!b) return { ok: false, label: '' }
    b.click()
    const label = (b.getAttribute('title') || b.textContent || '').trim()
    return { ok: true, label: label || '#' + ${index} }
  })()`)
  return r ?? { ok: false, label: '' }
}
const tabCount = (cdp: Cdp): Promise<number> =>
  cdp.evalJS<number>(`document.querySelectorAll(${JSON.stringify(PAGE_TABS)}).length`)

async function main(): Promise<void> {
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.enable')
  /**
   * **第一步只为了拿 origin**：`localStorage` 是按 origin 分的，脚本要在这个 origin 的文档里才写得进去。
   * 这一趟载入的是空档（随即被下一步覆盖），**不参与任何读数**。
   */
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.querySelector('.app-nav-side')`, '首次进入应用的源', 30_000)
  /**
   * **存档与语言改在"页面脚本之前"注入**（2026-09-27 三号修第三处工具缺陷）。
   *
   * 旧写法：`Page.navigate` → 等主界面 → `Runtime.evaluate` 写 `localStorage` → 再 `navigate`。
   * 病根：应用**在 bundle 里就把存档读进内存**，所以"第二次导航"确实能读到新档 ——
   * **但全新 profile 的首个文档**上，`localStorage` 是那之后才写进去的、首屏读到的还是空档；
   * 任何一步时序偏一点（例如首屏慢、或后续代码不再重载）就整轮扫的是新档。
   * 实测读数：写入 118,935 字节仍表现为「钱包 0 · 导航 8 项」＝新档（基数被悄悄换掉）。
   * 现在用 `Page.addScriptToEvaluateOnNewDocument` ⇒ **本文档一开始就是目标档 + 目标语言**。
   *
   * ⚠ 写 `layout` 两键是**刻意的**：不写 ⇒ `readLayoutPref()` 一律回落 **classic**
   *   （`App.tsx`：没在设置里选过就是旧界面）⇒ 侧栏中段一大块装不下而被裁（实测可点 8 项，
   *   而 `PAGES` 有 10 项）。写 `modern` 只影响本次扫描用的这个浏览器实例，
   *   不动玩家的既有偏好（`web` 版与桌面的存储互相独立）。
   *
   * ⚠ 把存档里的 `page` 改成 `map`（**2026-09-27 再修**）：船长真档记着他**上次停留的页**，
   *   应用会直接落在那一页 ⇒ 第一页的目标页**恰好**就是当前页时，`changePage` 同值提前返回、
   *   页签不重置，"第 1 页"的读数与页签序列就不可复现（实测过这种失真）。
   *   钉死起始页 ⇒ 每页的读数都从同一状态出发（只动 `page`，其余字段原样）。
   */
  const text = readFileSync(SAVE_FILE, 'utf8').replace(/\\/g, '\\\\').replace(/`/g, '\\`')
  const scriptId = await cdp.addStartScript(
    `try {` +
      ` localStorage.setItem(${JSON.stringify(LOCALE_KEY)}, 'en');` +
      ` const raw = \`${text}\`;` +
      ` let save = null;` +
      ` try { save = JSON.parse(raw); } catch (e) { save = null }` +
      ` if (save && typeof save === 'object') save.page = 'map';` +
      ` localStorage.setItem(${JSON.stringify(SAVE_KEY)}, save ? JSON.stringify(save) : raw);` +
      ` localStorage.setItem('whale-idle:layout', 'modern');` +
      ` localStorage.setItem('whale-idle:layout-set', '1');` +
      ` } catch (e) {}`,
  )
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.querySelector('.app-nav-side')`, '英文语境主界面')
  const lang = await cdp.evalJS<string>(`document.documentElement.lang || '(未设)'`)
  const navText = await cdp.evalJS<string>(
    `[...document.querySelectorAll('.app-nav-side .app-nav-item')].map((b) => (b.textContent||'').replace(/^\\d+/,'').trim()).join(' / ')`,
  )
  const navCount = await cdp.evalJS<number>(`document.querySelectorAll('.app-nav-side .app-nav-item').length`)
  /**
   * **载入自检**（读数型）：导航项数 + 钱包 + 页面数。旧写法正是在这里被"新档"骗过 ——
   * 报出来才看得见"这一轮扫的是哪个档、哪套布局"。
   */
  const isk = await cdp.evalJS<string>(`(document.querySelector('.app-wallet')?.textContent || '').trim().slice(0, 24)`)
  say(
    `═══ 英文语境残留中文扫描（locale=en）═══\n· html lang=${lang}\n· 导航项 ${navCount}/10：${navText}\n· 钱包读数：${isk || '(未取到)'}`,
  )
  if (navCount < PAGES.length) {
    say(`    [!] 导航项 ${navCount} < 扫描表 ${PAGES.length} 项 ⇒ 按序号点会点错页，本轮读数不可信`)
  }
  /**
   * **每次切页后核对"高亮项 = 想去的页"**（2026-09-27 补第三处工具缺陷的护栏）。
   *
   * 为什么需要：船长真档里 `state.page` 记着**他上次停留的页**，应用载入后可能直接落在那儿；
   * 此时点一个**与当前页相同**的导航项，React 的 `changePage` 因同值提前返回（`App.tsx`
   * 里"同页直接 return"那条）⇒ 页签**不重置**，工具却以为"切过去了"，接着按页签下标点，
   * 读到的是另一页的内容（实测：第 1 页「map」整段缺失，页签读数跑到了别的页）。
   * 修法：点完等一拍，若该项没拿到 `is-active` ⇒ **刷新重来**（刷新后当前页即目标页，
   * 页签回到默认态），再继续。
   */
  const ensurePage = async (nav: string, idx: number): Promise<string> => {
    /**
     * ⚠ **导航文案要按"去掉徽标"再比**：有未读时按钮文案前面会多一个数字
     * （徽标 `<i class="app-nav-badge">` 嵌在标签那个 `<span>` 里 ⇒ 整个按钮的
     * `textContent` 实测是「5Task Center」「1Comms」）⇒ 精确等值匹配会**找不到该项**，
     * 于是回落到下标、点到别的页 —— 这正是"任务页/通讯页整段读数缺失、星图页读数在好几个
     * 页名下重复出现"那批错位读数的由来。
     * 判据：**去掉开头的徽标数字**再比（导航文案本身不以数字开头）。
     */
    const click = `(() => {
      const want = ${JSON.stringify(nav)}
      const labelOf = (x) => (x.textContent || '').replace(/^\\d+/, '').trim()
      const items = [...document.querySelectorAll('.app-nav-side .app-nav-item')]
      const b = items.find((x) => labelOf(x) === want) || items[${idx}]
      if (!b) return ''
      b.click()
      return labelOf(b)
    })()`
    /** 生效判据 = 该导航项拿到 `is-active` **且** 内容区真的上屏（弹层盖住时 `.is-win-hidden` ⇒ `display:none`） */
    const activeNow = `(() => {
      const a = document.querySelector('.app-nav-side .app-nav-item.is-active')
      const c = document.querySelector('.app-page-content')
      const visible = !!c && getComputedStyle(c).display !== 'none'
      return (visible && a ? (a.textContent || '').replace(/^\\d+/, '').trim() : '')
    })()`
    const clicked = await cdp.evalJS<string>(click)
    if (!clicked) return ''
    for (let attempt = 0; attempt < 2; attempt++) {
      await wait(700)
      if ((await cdp.evalJS<string>(activeNow)) === clicked) return clicked
      /** 没切过去（同页提前 return / 被弹层挡住）⇒ 刷新重来；刷新后当前页就是目标页、页签回默认态 */
      await cdp.send('Page.reload')
      await waitFor(cdp, `document.querySelector('.app-nav-side')`, `${nav} 刷新后主界面`)
      await wait(600)
    }
    return clicked
  }
  let total = 0
  for (let i = 0; i < PAGES.length; i++) {
    const page = PAGES[i]!
    /**
     * 按**导航文案**点（顺序无关；见 `PAGES` 头注），并核对**高亮项**（见 `ensurePage` 头注）。
     * 找不到同名项才回落到下标，并在读数里点名 —— 静默点错页正是上一版读数失真的原因。
     */
    const clicked = await ensurePage(page.nav, i)
    if (!clicked) {
      say(`\n─── 第 ${i + 1} 页（${page.key}）：没找到导航项 ───`)
      continue
    }
    if (clicked !== page.nav) {
      say(`    [!] 第 ${i + 1} 页本应点「${page.nav}」，实点到「${clicked}」（按文案没找到 ⇒ 回落了下标）`)
    }
    /**
     * **等"这页真的上屏"**（`App.tsx` 给内容区挂了 `data-page`，见那里的注释）：
     * 固定等待 + 猜是上一版读数失真的根；现在等的是"内容区的 `data-page` = 想扫的那一页"，
     * 到位了再扫；迟迟不到位就报出来（**宁可报不确定，也不许把上一页的内容算成本页的**）。
     */
    const reached = await waitFor(
      cdp,
      `document.querySelector('.app-page-content')?.dataset.page === ${JSON.stringify(page.key)}`,
      `第 ${i + 1} 页（${page.key}）上屏`,
      6_000,
    )
    if (!reached) {
      say(`    [!] 第 ${i + 1} 页（${page.key}）没能确认上屏，本轮该页读数不可信`)
    }
    await wait(500)
    total += await scan(cdp, `第 ${i + 1} 页（${page.key} · 导航文案「${clicked}」）`)
    /**
     * **逐页签再扫一遍**：筛选档与标签页常在二级/三级页签里（例：工业页的 `.app-subtabs`
     * 精炼炉 / 蓝图书架 / 组装机 / **造船厂**——造船厂的「学会：/子类：/图纸：」三行筛选只在那个页签下渲染），
     * 只扫默认页签会整批漏掉。
     * ⚠ 选择器含**两族**页签类名：`.app-tasktab`（任务/筛选行）与 `.app-subtab`（页面级功能标签页）；
     * 仓库/工业页的页面级切换正是后者（2026-09-22 首版只认前者 ⇒ 造船厂整页漏扫，实测踩到）。
     */
    const tabN = await tabCount(cdp)
    for (let k = 0; k < tabN; k++) {
      const tab = await clickTab(cdp, k)
      if (!tab.ok) continue
      await wait(700)
      total += await scan(cdp, `  ↳ ${page.key} 页签「${tab.label}」`)
    }
  }
  /**
   * **手册（弹层）专项**（2026-09-22 船长令：「先进行手册的本地化」）。
   *
   * 手册不在 `.app-page-content` 里（它是弹层，挂在 `.app-root` 下），**逐页扫描永远扫不到它** ⇒
   * 这里单独开一遍：点顶栏那颗入口 → 逐页签（一级「玩法说明 / 图鉴」，二级类型与子类）扫一遍。
   */
  const opened = await cdp.evalJS<boolean>(`(() => {
    const b = [...document.querySelectorAll('.app-header .app-btn')].find((x) => {
      const t = (x.getAttribute('title') || '') + (x.textContent || '')
      return t.includes('手册') || t.includes('玩法说明') || /handbook|manual|guide|compendium/i.test(t)
    })
    if (!b) return false
    b.click(); return true
  })()`)
  say(`\n═══ 手册面板（入口点开=${opened ? '成' : '没找到'}）═══`)
  if (opened) {
    await wait(900)
    /**
     * ⚠ 根选择器用**手册自己的模态** `.app-hand-modal`：`.app-modal` 在文档里可能先命中别的弹层；
     * 页签也要**限定在手册内**（`.app-hand-nav` / `.app-hand-subnav`）——手册打开时页面在它后面，
     * 全局点 `.app-tasktab` 会点到后面那些页签上，手册反而一页没扫（首版就是这么误报 0 的）。
     */
    const HAND = '.app-hand-modal'
    total += await scan(cdp, '手册 · 默认页', HAND)
    const mainN = await cdp.evalJS<number>(`document.querySelectorAll('.app-hand-nav .app-hand-navitem').length`)
    for (let k = 0; k < mainN; k++) {
      const t = await cdp.evalJS<string>(`(() => {
        const b = document.querySelectorAll('.app-hand-nav .app-hand-navitem')[${k}]
        if (!b) return ''
        b.click(); return (b.textContent || '').trim()
      })()`)
      if (!t) continue
      await wait(700)
      total += await scan(cdp, `  手册一级页「${t}」`, HAND)
      const subN = await cdp.evalJS<number>(`document.querySelectorAll('.app-hand-subnav .app-hand-subitem').length`)
      for (let j = 0; j < subN; j++) {
        const s = await cdp.evalJS<string>(`(() => {
          const b = document.querySelectorAll('.app-hand-subnav .app-hand-subitem')[${j}]
          if (!b) return ''
          b.click(); return (b.textContent || '').trim()
        })()`)
        if (!s) continue
        await wait(600)
        total += await scan(cdp, `    手册二级「${t} › ${s}」`, HAND)
      }
    }
  }
  /**
   * **通讯逐封点开扫**（2026-09-22 补）：列表页只显示主题/发件人/时间，**正文要选中才渲染** ——
   * 只扫默认那一封会漏掉其余信件（通讯正文共 97 行，分四批译）。这里逐条点开左栏、扫右栏正文。
   */
  const openedComms = await cdp.evalJS<boolean>(`(() => {
    const items = [...document.querySelectorAll('.app-nav-side .app-nav-item')]
    const b = items.find((x) => ((x.textContent || '').trim() === 'Comms'))
    if (!b) return false
    b.click(); return true
  })()`)
  if (openedComms) {
    await wait(900)
    const rows = await cdp.evalJS<number>(`document.querySelectorAll('.app-comms-item').length`)
    say(`\n═══ 通讯逐封（共 ${rows} 封；扫右栏正文）═══`)
    for (let k = 0; k < rows; k++) {
      const subj = await cdp.evalJS<string>(`(() => {
        const b = document.querySelectorAll('.app-comms-item')[${k}]
        if (!b) return ''
        b.click()
        const s = b.querySelector('.app-comms-subject')
        return s ? s.textContent || '' : ''
      })()`)
      if (!subj) continue
      await wait(400)
      total += await scan(cdp, `  ✉ ${subj.trim().slice(0, 42)}`)
    }
  }
  say(`\n═══ 合计残留中文 ${total} 处 ═══`)
  say('（读数不等于结论：船名/舰长名等玩家数据与刻意保留的中文不该译，逐条判由船长定）')
  /**
   * **收尾：把注入的启动脚本收回来**（2026-09-27 补的纪律）。
   * 不收回的后果是实测过的：注入会**累积**，下一轮（哪怕换成中文口径）载入时，
   * 上一轮那段"清语言 + 写存档"会再执行一遍 ⇒ 把后来者设好的语言与存档顶掉。
   */
  await cdp.removeStartScript(scriptId)
  say('· 已收回本轮注入的启动脚本（Page.removeScriptToEvaluateOnNewDocument）')
}

void main().finally(() => process.exit(0))
