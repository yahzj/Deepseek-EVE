/**
 * **通讯文案工作台 · 回写**（**2026-10-01 入库**；与 `tools/comms-export.ts` 对称的那一半）。
 *
 * 干什么：把船长改完发回的 `comms-通讯一览.csv` **按 id 回写**到数据表。
 * 上游 = `tools/comms-export.ts`（导出侧单点）⇒ 船长在 Excel/WPS 里挨个改 ⇒ 发回 CSV ⇒ 本工具回写。
 *
 * 用法：`npm run comms:import <船长改后的.csv> [--baseline <原值.csv>] [--skip id1,id2]`
 *   · 不给 `--baseline` 时**从源码现读原值**（`COMMS_MESSAGES`）⇒ 直接对比出"哪些格真的改了"；
 *     给了就用那份（老档对比 / 复核用）；
 *   · `--skip` 让指定 id **暂缓回写**（例：那条新文案与某契约冲突、等船长裁决时先跳过它，
 *     其余照常落地 —— 用它在报告里点名，比手工回退干净）。
 *
 * ## 编辑约定（与 `comms-说明.csv` 同一套，回写时按它判）
 * - `id` 只读（回写锚）；**空单元格 = 不改这个字段**；要删字段填 `-`；
 * - **正文整篇替换**语义：正文里**空行分段**（一个空行 = 一段），段内换行原样保留；
 * - 只读列（`段数` / `英文覆盖` / `前往页签` / `触发时机`）**一律不读**：它们改不动任何东西。
 *
 * ## 🔴 编码：Excel 会把它存成 GB18030（本条是踩过的坑）
 * 导出侧写的是 **UTF-8 + BOM**，但船长用 Excel「另存为 CSV」后文件变成 **GBK/GB18030 无 BOM**
 * （2026-10-01 实障：`read` 直接读报 `invalid UTF-8`；且**非 GBK 字符会被写成 `?`** ——
 * 实测 `1,000 m³` → `1,000 m?`、只读列的 `✓/✗` → `?`）。
 * ⇒ 本工具**自动探测编码**（BOM → UTF-8 / 否则 UTF-8 试解、见替换字符则按 GB18030 解），
 * 并对 `?` 做**降级还原**：只有当"原值把某个字符换成 `?` 就等于新值"时才还原（保守，不乱猜）。
 *
 * ## 当前接线范围（诚实标注）
 * **只回写 `正文` 列**。其余可写列（`主题` / `前往提示` / `前往页` / `染色段号`）**会报出来但不动手** ——
 * 它们各自要改 `subject` / `hint.text` / `hint.page` / `highlight`，接线与验证另开一批；
 * 报出来是为了"不要静默吞掉船长的改动"。
 *
 * ⚠ **只读**：除目标数据表外不写任何文件；`content-csv/` 里的工作件**一个字都不碰**。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 首次落码 2026-10-01
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { COMMS_MESSAGES } from '../packages/data/src/messages'
import { FIRST_TASK_MESSAGES } from '../packages/data/src/firstTaskMessages'

/* ───────────────────────── 参数 ───────────────────────── */

const args = process.argv.slice(2)
/** 位置参数 = 去掉 `--flag value`（连带它的值）与独立 `--flag` 之后剩下的第一个 */
const positional = ((): string[] => {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--baseline' || a === '--skip') {
      i++ // 跳过它的值
      continue
    }
    if (a.startsWith('--')) continue
    out.push(a)
  }
  return out
})()
const capFile = positional[0]
if (capFile === undefined) {
  console.error('用法：npm run comms:import <船长改后的.csv> [--baseline <原值.csv>] [--skip id1,id2]')
  process.exit(1)
}
const baselineArg = args[args.indexOf('--baseline') + 1]
const baselineFile = args.includes('--baseline') ? baselineArg : undefined
/** `--skip id1,id2`：这些 id 暂缓回写（报告里点名，其余照常落地） */
const SKIP_IDS = new Set(
  (args.includes('--skip') ? (args[args.indexOf('--skip') + 1] ?? '') : '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== ''),
)

/* ───────────────────────── 编码探测 ───────────────────────── */

/**
 * 读 CSV：**自动探测编码**（返回 { text, encoding, bom }）。
 * 判据：① `EF BB BF` ⇒ UTF-8(BOM)；② `FF FE` / `FE FF` ⇒ UTF-16；③ 其余按 UTF-8 试解，
 * 出现替换字符 `U+FFFD` 就重按 **GB18030** 解（Excel 另存 CSV 的落点）。
 */
function readCsvSmart(path: string): { text: string; encoding: string } {
  const buf = readFileSync(path)
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buf.subarray(3)), encoding: 'utf-8 (BOM)' }
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf), encoding: 'utf-16le' }
  }
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('\uFFFD')) return { text: utf8, encoding: 'utf-8' }
  return { text: new TextDecoder('gb18030').decode(buf), encoding: 'gb18030 (Excel 另存)' }
}

/* ───────────────────────── CSV 解析（支持引号内换行） ───────────────────────── */

function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQ = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 只读列（改了不生效，回写时跳过；列名照 `comms-说明.csv` 的表头） */
const READONLY_COLS = new Set([
  '序号', 'id（只读）', '来源', '发件方', '类型', '段数', '英文覆盖', '前往页签 / 动作', '触发时机',
])
/** 本工具**已接线**的可写列（当前只有正文） */
const WIRED_COLS = new Set(['正文（整篇 · 段与段之间空一行）'])
/* 其余可写列（主题 / 前往提示 / 前往页）**尚未接线**：只报出差异、不动手（见文件头注"当前接线范围"） */

/* ───────────────────────── 数据侧：id → 源文件与当前正文 ───────────────────────── */

const firstIds = new Set(FIRST_TASK_MESSAGES.map((m) => m.id))
const fileOf = (id: string): string =>
  firstIds.has(id) ? 'packages/data/src/firstTaskMessages.ts' : 'packages/data/src/messages.ts'

/** 段数组 → CSV 的"整篇"文本（段间空一行） */
const bodyToText = (body: readonly string[]): string => body.join('\n\n')

/** "整篇"文本 → 段数组（空行分段；段内换行保留） */
function textToBody(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^\n+|\n+$/g, '')
    .split(/\n[ \t]*\n/)
    .map((s) => s.replace(/^\n+|\n+$/g, ''))
    .filter((s) => s.trim() !== '')
}

/* ───────────────────────── 编码降级还原 ───────────────────────── */

/**
 * **把新值里的 `?` 还原成原值里的字符**（保守）：只有当"原值把某个字符换成 `?` 就等于新值"
 * 时才还原（用 `?` 前后各 4 个非空白字符做锚在原值里定位）。
 * 为什么需要：Excel 另存 CSV(GBK) 会把非 GBK 字符写成 `?`（实测 `1,000 m³` → `1,000 m?`）——
 * 那不是船长的改动，直接回写就把游戏文案写坏了。
 */
function restoreDegraded(nextText: string, oldText: string): { text: string; fixed: string[] } {
  if (!nextText.includes('?')) return { text: nextText, fixed: [] }
  const oldNoWs = oldText.replace(/\s+/g, '')
  const fixed: string[] = []
  let out = nextText
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== '?') continue
    const before = out.slice(Math.max(0, i - 4), i).replace(/\s+/g, '')
    const after = out.slice(i + 1, i + 5).replace(/\s+/g, '')
    const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(esc(before) + '(.)' + esc(after)).exec(oldNoWs)
    if (m === null || m[1] === '?') continue
    out = out.slice(0, i) + m[1]! + out.slice(i + 1)
    fixed.push(`${m[1]}（原值）→ 还原`)
  }
  return { text: out, fixed }
}

/* ───────────────────────── 源码级替换：某 id 的 body 数组 ───────────────────────── */

const tsString = (s: string): string =>
  "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"

/**
 * 替换 `id: '<id>'` 之后第一个 `body: [...]` 块。
 * ⚠ 保留原有的**元素缩进 / 结尾缩进 / 尾逗号**（首版硬编码缩进且重复加了尾逗号 ⇒ `],,` 语法错，见 git 历史）。
 */
function replaceBody(src: string, id: string, segs: readonly string[]): { src: string; ok: boolean; why: string } {
  const idIdx = src.indexOf(`id: '${id}',`)
  if (idIdx < 0) return { src, ok: false, why: '源码里找不到该 id' }
  const bIdx = src.indexOf('body: [', idIdx)
  if (bIdx < 0) return { src, ok: false, why: '该 id 之后找不到 body 数组' }
  let i = bIdx + 'body: ['.length
  while (i < src.length) {
    const c = src[i]!
    if (c === "'") {
      i++
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === ']') break
    i++
  }
  if (i >= src.length) return { src, ok: false, why: 'body 数组没有闭合' }
  const oldBlock = src.slice(bIdx, i + 1)
  const elemIndent = /\n( +)'/.exec(oldBlock)?.[1] ?? '      '
  const closeIndent = /\n( *)\]\s*$/.exec(oldBlock)?.[1] ?? '    '
  const inner = segs.map((s) => elemIndent + tsString(s) + ',').join('\n')
  const next = src.slice(0, bIdx) + 'body: [\n' + inner + '\n' + closeIndent + ']' + src.slice(i + 1)
  return { src: next, ok: true, why: '' }
}

/* ───────────────────────── 主流程 ───────────────────────── */

const cap = parseCsv(readCsvSmart(capFile).text)
const head = cap[0] ?? []
const col = (name: string): number => head.findIndex((h) => h.startsWith(name))
const COL = { id: col('id'), body: col('正文'), subject: col('主题') }
if (COL.id < 0 || COL.body < 0) {
  console.error(`❌ 表头缺列（id / 正文）：${head.slice(0, 4).join(' | ')}…`)
  process.exit(1)
}

/** 原值侧（**从源码现读**）：id → 各可写列的当前值（正文 / 主题 / 前往提示 / 前往页） */
const baselineSrc = new Map(
  COMMS_MESSAGES.map((m) => [
    m.id,
    {
      body: bodyToText(m.body),
      subject: m.subject,
      hintText: m.hint?.text ?? '',
      hintPage: m.hint?.page ?? '',
    },
  ]),
)

const baseline = ((): Map<string, string> => {
  if (baselineFile === undefined) {
    return new Map([...baselineSrc].map(([id, v]) => [id, v.body]))
  }
  const rows = parseCsv(readCsvSmart(baselineFile).text)
  const i = rows[0]?.findIndex((h) => h.startsWith('正文')) ?? -1
  return new Map(rows.slice(1).map((r) => [(r[1] ?? '').trim(), r[i] ?? '']))
})()

const edits = new Map<string, { segs: string[]; fixed: string[]; from: number }>()
const reportOnly: string[] = []
const skipped: string[] = []
const problems: string[] = []
let scanned = 0

for (const r of cap.slice(1)) {
  const id = (r[COL.id] ?? '').trim()
  if (id === '') continue
  scanned++
  const oldText = baseline.get(id)
  const newText = r[COL.body] ?? ''
  if (oldText === undefined) {
    problems.push(`⚠ [${id}] 原值里没有这条（新增？本工具不管新增）`)
    continue
  }
  /**
   * 未接线列：**只在"你写的 ≠ 源码现值"时报**（不是"非空就报" —— 那些列本来就填着值）。
   * 约定同正文：**空 = 不改**；`-` = 删字段。
   */
  const src0 = baselineSrc.get(id)
  if (src0 !== undefined) {
    for (let i = 0; i < head.length; i++) {
      const name = head[i]!
      if (READONLY_COLS.has(name) || WIRED_COLS.has(name)) continue
      const cur =
        name.startsWith('主题') ? src0.subject
        : name.startsWith('前往提示') ? src0.hintText
        : name.startsWith('前往页') ? src0.hintPage
        : undefined
      if (cur === undefined) continue
      const v = (r[i] ?? '').trim()
      if (v === '' || v === cur.trim()) continue // 空 = 不改
      /**
       * `-` = **删字段**（约定）；源码现值本来就是空 ⇒ 无动作、不报。
       * ⚠ 船长实际可能写成 `—` / `–`（Excel 自动替换），这里三种破折号都认。
       */
      if (/^[-—–]+$/.test(v) && cur.trim() === '') continue
      reportOnly.push(`[${id}] ${name}：源码现值「${cur.trim().slice(0, 34)}」→ 你写的「${v.slice(0, 34)}」`)
    }
  }
  if (newText.trim() === '' || newText.trim() === oldText.trim()) continue // 空 = 不改
  if (SKIP_IDS.has(id)) {
    skipped.push(`[${id}] 按 --skip 暂缓回写（其余条目照常落地）`)
    continue
  }
  const { text, fixed } = restoreDegraded(newText, oldText)
  edits.set(id, { segs: textToBody(text), fixed, from: textToBody(oldText).length })
}

/* 按文件分组回写 */
const byFile = new Map<string, string>()
for (const id of edits.keys()) {
  const f = fileOf(id)
  if (!byFile.has(f)) byFile.set(f, readFileSync(f, 'utf8'))
}
for (const [id, e] of edits) {
  const f = fileOf(id)
  const r = replaceBody(byFile.get(f)!, id, e.segs)
  if (!r.ok) {
    problems.push(`❌ [${id}] ${r.why}`)
    continue
  }
  byFile.set(f, r.src)
}
for (const [f, src] of byFile) writeFileSync(f, src, 'utf8')

/* ───────────────────────── 报告 ───────────────────────── */

const enc = readCsvSmart(capFile).encoding
console.log(`\n通讯回写（${capFile}）`)
console.log(`  编码识别：${enc} · 扫描 ${scanned} 条 · 命中改动 ${edits.size} 条`)
for (const [id, e] of edits) {
  console.log(
    `  ✅ [${id}] ${e.from} 段 → ${e.segs.length} 段${e.fixed.length > 0 ? ` ⚠ ${e.fixed.join('；')}` : ''}`,
  )
}
if (edits.size === 0) console.log('  （没有需要回写的改动 —— 空单元格 = 不改）')
if (skipped.length > 0) {
  console.log('\n  ⏸ 按 --skip 暂缓（**没落地**，等裁决后去掉该参数再跑一次即可）：')
  for (const line of skipped) console.log(`     · ${line}`)
}
if (reportOnly.length > 0) {
  console.log(`\n  ⏸ 下列列**尚未接线**，已报出但未回写（要改请单独提，接线与验证另开一批）：`)
  for (const line of reportOnly) console.log(`     · ${line}`)
}
if (problems.length > 0) {
  console.log('\n  问题：')
  for (const p of problems) console.log(`     ${p}`)
}
console.log('\n  回写后请跑：content:check · l10n:check · l10n:params · typecheck · core 全量 · 桌面构建')
console.log('  ⚠ `content-csv/` 里的工作件一个字都没动。\n')
