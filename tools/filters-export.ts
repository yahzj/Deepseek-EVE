/**
 * **筛选 / 子筛选清单导出（Excel）** —— 船长 2026-09-23：
 * 「你能否将现有的所有筛选导出到excel表格，我打算重新排布所有的筛选和子筛选，
 *   包括添加新的筛选和调整筛选父级」。
 *
 * 两路取证、合成一本 xlsx：
 *  A. **界面现场**（跑起来的应用 · **只读注入真档**）：逐个左侧导航页 → 逐个页签点开 →
 *     把当前可见的**筛选栏与控件**按文档顺序抄下来（栏标签 / 层级 / 顺序 / 文案 / 类名 / 是否选中）
 *     ⇒ 这就是"玩家现在看到的筛选层级"，重新排布时以此为准。
 *  B. **代码定义表**：直接 import `ui/itemSubs.ts` 的筛选表（全仓**唯一实现**），
 *     再用 `packages/data/src/l10n/table.ts` 把 `id` 解成**中英双语**
 *     ⇒ 键值 ↔ 文案 ↔ 使用处 的对应关系（改完结构回接实现时按"键"落码）。
 *
 * 用法：`npx tsx tools/filters-export.ts [输出路径]`
 *   缺省输出 `docs/exports/筛选清单-<stamp>.xlsx`。
 * 环境变量：`UI_APP_URL`（缺省 `http://[::1]:4174/`）· `UI_CDP_URL`（缺省 `http://127.0.0.1:9333`）·
 *   `FILTERS_SAVE`（缺省 = 真档 `%APPDATA%\whale-idle\save.json`，**只读**）。
 *
 * 运行前提前量：web 已构建并在跑（`npm run build --prefix web` → `npx vite preview --port 4174 --strictPort`，
 *   ⚠ 本机只监听 IPv6 ⇒ 地址 `http://[::1]:4174/`）＋ 无头 Chrome `--remote-debugging-port=9333`。
 *
 * ⚠ 版本自检：页面/页签类名（`.app-subtab` / `.app-tasktab` / `.app-subtabs` / `.app-hand-*`）一变就要重跑核对；
 *   本工具最后跑过 **2026-09-23**（存档结构 v31 · 游戏 v0.1.0）。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ExcelJS from 'exceljs'
import { L10N } from '../packages/data/src/l10n/table'
import * as subs from '../apps/desktop/src/renderer/src/ui/itemSubs'

const APP = process.env.UI_APP_URL ?? 'http://[::1]:4174/'
const CDP = process.env.UI_CDP_URL ?? 'http://127.0.0.1:9333'
const SAVE_PATH = process.env.FILTERS_SAVE ?? join(process.env.APPDATA ?? '', 'whale-idle', 'save.json')

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
type Res = Record<string, unknown>

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

class Cdp {
  private seq = 0
  private readonly waiting = new Map<number, { res: (v: Res) => void; rej: (e: Error) => void }>()
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; error?: unknown; result?: Res }
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
  send(method: string, params: Res = {}): Promise<Res> {
    this.seq += 1
    const id = this.seq
    return new Promise<Res>((res, rej) => {
      this.waiting.set(id, { res, rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evalJS<T>(expr: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return (r as { result?: { value?: T } }).result?.value as T
  }
}

async function waitFor(cdp: Cdp, expr: string, what: string, timeoutMs = 25_000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await cdp.evalJS<boolean>(`!!(${expr})`)) return
    await wait(250)
  }
  throw new Error(`等不到：${what}`)
}

/* ═══════════ A 路：界面现场 ═══════════ */

interface Ctrl {
  bar: string
  label: string
  idx: number
  text: string
  active: string
  kind: string
}
interface Snap {
  page: string
  tab: string
  bars: Ctrl[]
}

/**
 * 抄当前页可见的筛选控件（文档顺序）。
 * - 认两族页签：`.app-subtab`（页面级功能标签）/ `.app-tasktab`（任务·筛选行）；
 * - 另抄 `select` 与 `input`（下拉/搜索这类非页签筛选控件）；
 * - 跳过隐藏与零尺寸；**栏标签**取栏前面的兄弟文本（如造船厂那三行的「学会：/子类：/图纸：」）。
 */
const SNAP = `(() => {
  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width >= 1 && r.height >= 1
  }
  const out = []
  const barSel = '.app-subtabs, .app-tasktabs, .app-fleet-tabs, .app-task-tabs'
  for (const bar of document.querySelectorAll(barSel)) {
    if (!visible(bar)) continue
    const items = [...bar.querySelectorAll('.app-subtab, .app-tasktab')].filter((b) => b.closest(barSel) === bar)
    if (items.length === 0) continue
    const prev = bar.previousElementSibling
    const label = prev ? (prev.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 28) : ''
    items.forEach((b, i) => {
      if (!visible(b)) return
      out.push({
        bar: String(bar.className).split(' ').slice(0, 2).join('.'),
        label,
        idx: i + 1,
        text: (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
        active: b.className.includes('is-active') ? '●' : '',
        kind: '页签',
      })
    })
  }
  for (const el of document.querySelectorAll('input[type="search"], select')) {
    if (!visible(el)) continue
    const host = el.closest('.app-page-content, .app-modal, .app-hand-modal')
    if (!host) continue
    const lbl = el.getAttribute('placeholder') || el.getAttribute('aria-label') || (el.textContent || '').trim()
    out.push({
      bar: el.tagName === 'SELECT' ? '下拉' : '搜索框',
      label: '',
      idx: 0,
      text: lbl.replace(/\\s+/g, ' ').trim().slice(0, 40),
      active: '',
      kind: el.tagName === 'SELECT' ? '下拉' : '输入框',
    })
  }
  return out
})()`

async function collectUi(cdp: Cdp): Promise<Snap[]> {
  const snaps: Snap[] = []
  const navN = await cdp.evalJS<number>(`document.querySelectorAll('.app-nav-side .app-nav-item').length`)
  for (let p = 0; p < navN; p += 1) {
    const navText = await cdp.evalJS<string>(`(() => {
      const b = document.querySelectorAll('.app-nav-side .app-nav-item')[${p}]
      if (!b) return ''
      b.click(); return (b.textContent || '').trim()
    })()`)
    if (!navText) continue
    await wait(1000)
    snaps.push({ page: navText, tab: '（页面默认）', bars: await cdp.evalJS<Ctrl[]>(SNAP) })
    // 逐个页签点开再抄一遍（二级/三级筛选常只在某个页签下渲染）
    const tabN = await cdp.evalJS<number>(`document.querySelectorAll('.app-tasktab, .app-subtab').length`)
    for (let k = 0; k < tabN; k += 1) {
      const tabText = await cdp.evalJS<string>(`(() => {
        const b = document.querySelectorAll('.app-tasktab, .app-subtab')[${k}]
        if (!b) return ''
        b.click(); return (b.textContent || '').replace(/\\s+/g, ' ').trim()
      })()`)
      if (!tabText) continue
      await wait(700)
      snaps.push({ page: navText, tab: tabText, bars: await cdp.evalJS<Ctrl[]>(SNAP) })
    }
    console.log(`  · ${navText}：抄到 ${snaps.filter((s) => s.page === navText).length} 个视图`)
  }
  // 手册（弹层，不在导航页里）：找「手册」入口点开，再逐个大类看
  const opened = await cdp.evalJS<boolean>(`(() => {
    const b = [...document.querySelectorAll('button, .app-btn, .app-nav-item')].find((x) => (x.textContent || '').includes('手册'))
    if (!b) return false
    b.click(); return true
  })()`)
  if (opened) {
    await wait(900)
    const has = await cdp.evalJS<boolean>(`!!document.querySelector('.app-hand-modal')`)
    if (has) {
      snaps.push({ page: '手册（弹层）', tab: '（默认）', bars: await cdp.evalJS<Ctrl[]>(SNAP) })
      const groupN = await cdp.evalJS<number>(`document.querySelectorAll('.app-hand-nav .app-hand-navitem').length`)
      for (let g = 0; g < groupN; g += 1) {
        const t = await cdp.evalJS<string>(`(() => {
          const b = document.querySelectorAll('.app-hand-nav .app-hand-navitem')[${g}]
          if (!b) return ''
          b.click(); return (b.textContent || '').replace(/\\s+/g, ' ').trim()
        })()`)
        if (!t) continue
        await wait(700)
        snaps.push({ page: '手册（弹层）', tab: t, bars: await cdp.evalJS<Ctrl[]>(SNAP) })
      }
      console.log(`  · 手册（弹层）：抄到 ${snaps.filter((s) => s.page.startsWith('手册')).length} 个视图`)
    } else {
      console.log('  · 手册：点了入口但没出现 .app-hand-modal（跳过）')
    }
  }
  return snaps
}

/* ═══════════ B 路：代码定义表 ═══════════ */

interface DefRow {
  表: string
  用途: string
  键: string
  中文: string
  English: string
  id: string
  id参数: string
}

/** 表名 → [用途, 表本体]（用途一列是给重排看的：这张表管哪一处筛选） */
function defTables(): Array<[string, string, Array<{ key: string; label: string; id?: string; idParam?: string }>]> {
  return [
    ['ITEM_SUBS', '货物（原矿/原材料/气体/冰矿/奢侈品…）二级子分类', subs.ITEM_SUBS],
    ['CONSUME_SUBS', '消耗品二级子分类（弹药/修理组件/无人机）', subs.CONSUME_SUBS],
    ['CONTAINER_SUBS', '货柜二级子分类', subs.CONTAINER_SUBS],
    ['WRECK_SUBS', '残骸二级子分类（普通/稀有）', subs.WRECK_SUBS],
    ['PART_SUBS', '零件二级子分类（基础/高级）', subs.PART_SUBS],
    ['MODULE_SUBS', '装备功能分组（九组）', subs.MODULE_SUBS],
    ['SHIP_SUBS', '舰船角色筛选', subs.SHIP_SUBS],
    ['SHIP_TIER_SUBS', '舰船级别筛选（T1~T5）', subs.SHIP_TIER_SUBS],
    ['BLUEPRINT_SUBS', '蓝图二级子分类（高/中/低槽装备 · T1~T5 舰船 · 消耗品）', subs.BLUEPRINT_SUBS],
    ['CORE_SUBS', 'AI 核心二级子分类', subs.CORE_SUBS],
    ['RACK_SUBS', '装备槽类（高/中/低槽装备）', subs.RACK_SUBS],
    ['FLEET_STATE_TABS', '舰船页·舰队状态筛选', subs.FLEET_STATE_TABS],
    ['STORE_OWN_TABS', '舰船仓库·拥有筛选', subs.STORE_OWN_TABS],
    ['MANU_TABS', '组装机·一级标签（全部/蓝图门类）', subs.MANU_TABS],
    ['MANU_TABS_CRAFT', '组装机·制造页签', subs.MANU_TABS_CRAFT],
    ['BLUEPRINT_USE_TABS', '蓝图书架·图纸用途筛选', subs.BLUEPRINT_USE_TABS],
    ['BLUEPRINT_LEARN_TABS', '造船厂/蓝图书架·学会筛选', subs.BLUEPRINT_LEARN_TABS],
  ]
}

/** `id` → 中英（带 `{p1}` 模板的按 idParam 填） */
function textOf(id: string | undefined, fallback: string, idParam?: string): { zh: string; en: string } {
  if (!id) return { zh: fallback, en: '(未接线)' }
  const e = L10N[id]
  if (!e) return { zh: fallback, en: `(缺 ${id})` }
  const sub = (s: string): string => (idParam ? s.replace('{p1}', idParam) : s)
  return { zh: sub(e.zh), en: sub(e.en) }
}

function defRows(): DefRow[] {
  const rows: DefRow[] = []
  for (const [name, use, table] of defTables()) {
    for (const o of table) {
      const t = textOf(o.id, o.label, o.idParam)
      rows.push({ 表: name, 用途: use, 键: o.key, 中文: t.zh, English: t.en, id: o.id ?? '', id参数: o.idParam ?? '' })
    }
  }
  // 「类型 → 子分类」的挂接关系（哪张子表挂在哪个一级类型下）
  for (const [kind, table] of Object.entries(subs.SUBS_OF_KIND)) {
    for (const o of table) {
      const t = textOf(o.id, o.label, o.idParam)
      rows.push({ 表: `SUBS_OF_KIND.${kind}`, 用途: `一级类型「${kind}」下挂的子分类`, 键: o.key, 中文: t.zh, English: t.en, id: o.id ?? '', id参数: o.idParam ?? '' })
    }
  }
  return rows
}

/* ═══════════ 合成 xlsx ═══════════ */

async function main(): Promise<void> {
  const out = process.argv[2] ?? join('docs', 'exports', `筛选清单-${stamp()}.xlsx`)
  const save = readFileSync(SAVE_PATH, 'utf8')
  console.log(`真档（只读注入）：${SAVE_PATH}`)
  const cdp = await Cdp.connect(CDP)
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '启动')
  await cdp.evalJS(`localStorage.setItem('whale:idle:save', ${JSON.stringify(save)}); localStorage.setItem('whale-idle:locale','zh'); 1`)
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(cdp, `document.querySelector('.app-nav-side') && !document.querySelector('.app-loading')`, '载档启动')
  console.log('A 路：抄界面现场…')
  const snaps = await collectUi(cdp)

  const wb = new ExcelJS.Workbook()
  wb.creator = '大鲸鱼-深空放置 · 三号'
  wb.created = new Date()

  /* ① 说明 */
  const info = wb.addWorksheet('说明')
  info.columns = [
    { header: '项', key: 'k', width: 18 },
    { header: '内容', key: 'v', width: 110 },
  ]
  const rows: Array<[string, string]> = [
    ['用途', '船长 2026-09-23：「将现有的所有筛选导出到 excel 表格，我打算重新排布所有的筛选和子筛选，包括添加新的筛选和调整筛选父级」'],
    ['表 1「筛选汇总（去重）」', '一条筛选一行（同一条筛选出现在多个视图里就合成一行，附"出现在几个视图"）＝重排时的总清单。'],
    ['表 2「按视图明细」', '跑起来的应用里**逐页逐页签**抄下来的现场（文档顺序）＝玩家现在看到的层级与顺序，用来核对"哪条筛选挂在哪一级下面"。'],
    ['表 3「筛选定义表」', '代码里的筛选表（全仓唯一实现 `apps/desktop/src/renderer/src/ui/itemSubs.ts`）＋ 中英双语文案（`packages/data/src/l10n/table.ts`）＝改完结构回接实现时的"键"。'],
    ['层级怎么看', '「栏/行标签」= 这一行筛选栏前面的说明文字（例：造船厂的「学会：/子类：/图纸：」）；「顺序」= 该栏内的从左到右次序；「当前选中」● = 打开该视图时默认选中的那一项。'],
    ['页面级页签的键名', '左侧导航页与页面级标签（如 `MAP_TABS` 的 star/mine/bounty/salvage/haul/whscan、`SHIP_TABS` 的 fleet/ai/store）在代码里带键；本表按界面顺序给文案，回接实现时按顺序对键。'],
    ['没覆盖到的', '① 手册弹层的**搜索框**与图鉴筛选行已按大类各抄一遍；② 纯展示类筛选（无交互的徽标/读数）不算筛选，未收录；③ 弹窗内的临时筛选（如丢弃确认条）未收录。'],
    ['再生成', `npx tsx tools/filters-export.ts（或 npm run filters:export）· 本次跑于 ${new Date().toLocaleString('zh-CN')}`],
    ['取证方式', 'B 路＝代码单点直读（不是从界面猜键）；A 路＝无头 Chrome 真档只读注入，locale=zh。'],
  ]
  for (const [k, v] of rows) info.addRow({ k, v })
  info.getRow(1).font = { bold: true }
  info.getColumn('v').alignment = { wrapText: true, vertical: 'top' }
  info.eachRow((r) => {
    r.alignment = { vertical: 'top', wrapText: true }
  })

  /* ② 筛选汇总（**去重**：同一条筛选在多个视图里重复出现 ⇒ 合成一行，附"出现在哪些视图"） */
  const sumSheet = wb.addWorksheet('筛选汇总（去重）', { views: [{ state: 'frozen', ySplit: 1 }] })
  sumSheet.columns = [
    { header: '页面', key: 'page', width: 16 },
    { header: '栏/行标签', key: 'label', width: 16 },
    { header: '控件族', key: 'bar', width: 20 },
    { header: '顺序', key: 'idx', width: 7 },
    { header: '筛选文案', key: 'text', width: 34 },
    { header: '默认选中', key: 'active', width: 10 },
    { header: '控件类型', key: 'kind', width: 10 },
    { header: '出现在几个视图', key: 'n', width: 14 },
    { header: '视图举例', key: 'views', width: 46 },
  ]
  const agg = new Map<string, { row: Ctrl & { page: string }; views: Set<string> }>()
  for (const s of snaps) {
    for (const c of s.bars) {
      const key = [s.page, c.bar, c.label, c.idx, c.text, c.kind].join('|')
      const hit = agg.get(key)
      if (hit) hit.views.add(s.tab)
      else agg.set(key, { row: { ...c, page: s.page }, views: new Set([s.tab]) })
    }
  }
  for (const { row, views } of agg.values()) {
    sumSheet.addRow({
      page: row.page, label: row.label, bar: row.bar, idx: row.idx, text: row.text,
      active: row.active, kind: row.kind, n: views.size, views: [...views].slice(0, 4).join(' / '),
    })
  }
  sumSheet.getRow(1).font = { bold: true }
  sumSheet.autoFilter = { from: 'A1', to: 'I1' }

  /* ③ 按视图明细（逐页逐页签，保留层级现场） */
  const uiSheet = wb.addWorksheet('按视图明细', { views: [{ state: 'frozen', ySplit: 1 }] })
  uiSheet.columns = [
    { header: '页面', key: 'page', width: 16 },
    { header: '视图（打开的页签）', key: 'tab', width: 26 },
    { header: '栏/行标签', key: 'label', width: 16 },
    { header: '控件族', key: 'bar', width: 20 },
    { header: '顺序', key: 'idx', width: 7 },
    { header: '筛选文案', key: 'text', width: 34 },
    { header: '当前选中', key: 'active', width: 10 },
    { header: '控件类型', key: 'kind', width: 10 },
  ]
  let n = 0
  const seenRow = new Set<string>()
  for (const s of snaps) {
    for (const c of s.bars) {
      const key = [s.page, s.tab, c.bar, c.label, c.idx, c.text].join('|')
      if (seenRow.has(key)) continue
      seenRow.add(key)
      uiSheet.addRow({ page: s.page, tab: s.tab, label: c.label, bar: c.bar, idx: c.idx, text: c.text, active: c.active, kind: c.kind })
      n += 1
    }
  }
  uiSheet.getRow(1).font = { bold: true }
  uiSheet.autoFilter = { from: 'A1', to: 'H1' }

  /* ④ 筛选定义表 */
  const defSheet = wb.addWorksheet('筛选定义表', { views: [{ state: 'frozen', ySplit: 1 }] })
  defSheet.columns = [
    { header: '表（代码单点）', key: '表', width: 26 },
    { header: '管哪一处筛选', key: '用途', width: 46 },
    { header: '键', key: '键', width: 22 },
    { header: '中文', key: '中文', width: 26 },
    { header: 'English', key: 'English', width: 34 },
    { header: 'l10n id', key: 'id', width: 24 },
    { header: 'id 参数', key: 'id参数', width: 10 },
  ]
  for (const r of defRows()) defSheet.addRow(r)
  defSheet.getRow(1).font = { bold: true }
  defSheet.autoFilter = { from: 'A1', to: 'G1' }

  mkdirSync(dirname(out), { recursive: true })
  await wb.xlsx.writeFile(out)
  console.log(`\n✅ 已导出：${out}`)
  console.log(`   · 筛选汇总（去重）：${agg.size} 行`)
  console.log(`   · 按视图明细：${n} 行（${snaps.length} 个视图）`)
  console.log(`   · 筛选定义表：${defRows().length} 行`)
  // 顺带落一份纯文本清单，便于 diff 与检索
  const txt = out.replace(/\.xlsx$/, '.txt')
  const lines = [
    `# 筛选清单（界面现场）· ${new Date().toLocaleString('zh-CN')}`,
    ...snaps.flatMap((s) => [
      ``,
      `【${s.page}】${s.tab}`,
      ...s.bars.map((c) => `  ${c.label ? `[${c.label}] ` : ''}${c.idx ? `${c.idx}. ` : ''}${c.text}${c.active} (${c.bar})`),
    ]),
  ]
  writeFileSync(txt, lines.join('\n'), 'utf8')
  console.log(`   · 纯文本清单（便于 diff/检索）：${txt}`)
  process.exit(0)
}

main().catch((e: unknown) => {
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
