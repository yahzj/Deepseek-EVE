/**
 * **本地化表体检（ID 制）**（2026-09-19 加入；船长当日令「希望对游戏进行英语本地化处理」，本工具是那条
 * 口子的第一道护栏；同日船长再定「所有本地化文本采用 ID 引用，只需一份表即可整体替换语言」⇒ 由
 * 「中文源串当 key 的词典」改判为**唯一表 `packages/data/src/l10n/table.ts`（id → {zh, en}）**）。
 *
 * 为什么必须静态可查：换成 id 之后，源码里**只剩 id、没有中文**——漏登记一个 id，中文界面会把它当作文本
 * 显示出来（`textOf` 缺 id 就回 id 本身），英文界面更是直接漏文。这类错只能靠工具钉住。
 *
 * 判据（报错即红）：
 *   ① **id 形态**：`<域>.<短名>.<三位序号>`（域见 `DOMAINS`），且调用点传给 `t()`/`tr()` 的必须是 id；
 *   ② **调用点不得再传中文**（旧「中文源串当 key」的写法已废，传了英文界面就漏中文）；
 *   ③ **死引用**：`t('id')` / `tr('id')` 用到的 id 必须能在表里查到；
 *   ④ **英文值禁残留中日韩字符**（唯一放行：**语言自称** `en === zh`，如「中文」；另有 `CJK_ALLOW` 白名单备用）；
 *   ⑤ **占位符对齐**：`zh` 与 `en` 的 `{名字}` 集合必须逐个相同（缺/多都红）；
 *   ⑥ **值形态**：两列非空、首尾无空白。
 *
 * 另出**报告读数**（不红，供分批推进时看还差多少）：
 *   · 未接线条目（表里有、源码还没用上——P3/P5 会逐步消化，也可能是改文案后的遗留）；
 *   · 未译读数（渲染层仍含中日韩的字符串字面量，按文件 Top 10）；
 *   · 同一中文串出现在多条目里（口径是「一条文本一个 id」，重复多为复制粘贴，需人工并条）。
 *
 * 用法：`npm run l10n:check`（或 `npx tsx tools/l10n-check.ts`）· **只读**，不写任何文件。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v29**（`packages/core/src/state.ts` 的 `CURRENT_STATE_VERSION`）
 *   - 本工具最后跑过：**2026-09-19**（ID 制改版）
 *   - 本工具最后核对：**2026-09-19**（表 938 条 · 引用 938 个 id · 接线 1,277 处 · 未译读数 1,209）
 *   - 判据：表文件路径 / 导出名（`L10N`）/ id 规则（`<域>.<短名>.<序号>`）/ `i18n/locale.tsx` 的 `t`/`tr`
 *     签名改动 ⇒ 必须重跑核对
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { L10N } from '../packages/data/src/l10n/table'

const ROOT = join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src')
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
/** 额外放行的白名单（条目 id）；常规情形不必用——**语言自称**（`en === zh`，如「中文」）已自动放行 */
const CJK_ALLOW = new Set<string>([])
/** id 允许的域前缀（与 `tools/l10n-wrap.ts` 的 DOMAINS 同源；加域两处一起加） */
const DOMAINS = ['ui', 'ship', 'mod', 'item', 'skill', 'ano', 'gal', 'bp', 'wreck', 'station', 'faction', 'travel', 'matter', 'core']
const ID_RE = new RegExp(`^(?:${DOMAINS.join('|')})\\.[A-Za-z][A-Za-z0-9]*\\.\\d{3}$`)

const errors: string[] = []
const check = (ok: boolean, msg: string): void => {
  if (!ok) errors.push(msg)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

interface FileScan {
  rel: string
  /** 仍含中日韩的字符串字面量个数（P3 进度用） */
  cjkLiterals: number
  /** 其中**已包进 `t()` / `tr()` 第一参数**的个数（旧写法残留，正常应为 0 ⇒ 判据②） */
  cjkWrapped: number
  /** `t(...)` / `tr(...)` 调用点个数 */
  calls: number
  /** 调用点第一参数是字符串字面量时的取值（文件:行 一并记下，便于点名） */
  refs: Array<{ id: string; at: string }>
  /** 文件里出现过的所有字符串字面量（动态传 id 的取值由此认领，见 `used` 的算法） */
  literals: Set<string>
}

function scanFile(file: string): FileScan {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const rel = relative(process.cwd(), file).split('\\').join('/')
  let cjkLiterals = 0
  let cjkWrapped = 0
  let calls = 0
  const refs: Array<{ id: string; at: string }> = []
  /** 文件里出现过的所有字符串字面量（导航标签、`KIND_EMPTY` 一类**动态传 id**的取值靠它认领） */
  const literals = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.add(node.text)
      if (CJK.test(node.text)) cjkLiterals += 1
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 't' || node.expression.text === 'tr')
    ) {
      calls += 1
      const arg0 = node.arguments[0]
      if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
        const line = sf.getLineAndCharacterOfPosition(arg0.getStart(sf)).line + 1
        refs.push({ id: arg0.text, at: `${rel}:${line}` })
        if (CJK.test(arg0.text)) cjkWrapped += 1
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { rel, cjkLiterals, cjkWrapped, calls, refs, literals }
}

/** 从文本里抽 `{名字}` 占位符集合 */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
}

const scans = walk(ROOT).map(scanFile)
const entries = Object.entries(L10N)
const ids = new Set(entries.map(([id]) => id))
const used = new Set<string>()
const badShapeRefs: string[] = []
const cjkRefs: string[] = []
let callTotal = 0
let cjkTotal = 0
let cjkWrappedTotal = 0
for (const s of scans) {
  callTotal += s.calls
  cjkTotal += s.cjkLiterals
  cjkWrappedTotal += s.cjkWrapped
  for (const r of s.refs) {
    used.add(r.id)
    if (CJK.test(r.id)) cjkRefs.push(`${r.at} → 「${r.id}」`)
    else if (!ID_RE.test(r.id)) badShapeRefs.push(`${r.at} → 「${r.id}」`)
  }
  // 动态传 id（`t(nav.label)` / `t(KIND_EMPTY[kind])`）：源码里出现过的 id 字面量一律算「已接线」
  for (const l of s.literals) if (ids.has(l)) used.add(l)
}

// ① id 形态 + ② 调用点不得再传中文
check(badShapeRefs.length === 0, `id 形态不合规 ${badShapeRefs.length} 处（应形如 \`ui.itemsPage.014\`）：${badShapeRefs.slice(0, 8).join(' · ')}${badShapeRefs.length > 8 ? ' …' : ''}`)
check(cjkRefs.length === 0, `调用点仍在传中文源串 ${cjkRefs.length} 处（旧词典写法已废，英文界面会漏中文）：${cjkRefs.slice(0, 8).join(' · ')}${cjkRefs.length > 8 ? ' …' : ''}`)

// ③ 死引用：源码用到的 id 必须在表里
const dangling = [...used].filter((id) => !ids.has(id))
check(dangling.length === 0, `死引用 ${dangling.length} 条（源码用了、表里没有 ⇒ 界面会直接把 id 显示出来）：${dangling.slice(0, 10).join(' · ')}${dangling.length > 10 ? ' …' : ''}`)

// ① 表里条目的 id 形态
const badIds = entries.map(([id]) => id).filter((id) => !ID_RE.test(id))
check(badIds.length === 0, `表内 id 形态不合规 ${badIds.length} 条：${badIds.slice(0, 8).join(' · ')}`)

// ④⑤⑥ 逐条查值
const badPh: string[] = []
const badCjk: string[] = []
const badShape: string[] = []
for (const [id, e] of entries) {
  const a = placeholders(e.zh)
  const b = placeholders(e.en)
  if (a.join('|') !== b.join('|')) badPh.push(`「${id}」中 ${a.join(',') || '无'} / 英 ${b.join(',') || '无'}`)
  if (CJK.test(e.en) && e.en !== e.zh && !CJK_ALLOW.has(id)) badCjk.push(`「${id}」→「${e.en}」`)
  // 形态：非空 · 不许制表符与 `\r` · 首尾**至多一个空格**（JSX 文本片段与相邻 `{表达式}` 之间要靠这个空格排版，
  // 如 `{n}（结构 500）` ⇒ `{n} (structure 500)`；多余空白仍是错的）。`\n` 放行（多行悬浮提示）。
  if (e.zh.trim() === '' || e.en.trim() === '' || /[\r\t]/.test(e.zh + e.en) || /^ {2,}| {2,}$/.test(e.zh) || /^ {2,}| {2,}$/.test(e.en)) badShape.push(`「${id}」`)
}
check(badPh.length === 0, `占位符不对齐 ${badPh.length} 条：${badPh.slice(0, 6).join(' · ')}${badPh.length > 6 ? ' …' : ''}`)
check(badCjk.length === 0, `英文值残留中日韩字符 ${badCjk.length} 条：${badCjk.slice(0, 6).join(' · ')}${badCjk.length > 6 ? ' …' : ''}`)
check(badShape.length === 0, `条目值为空或含首尾空白 ${badShape.length} 条：${badShape.slice(0, 6).join(' · ')}${badShape.length > 6 ? ' …' : ''}`)

// 报告读数（不红）
const unused = entries.map(([id]) => id).filter((id) => !used.has(id))
const byZh = new Map<string, string[]>()
for (const [id, e] of entries) byZh.set(e.zh, [...(byZh.get(e.zh) ?? []), id])
const dupZh = [...byZh.entries()].filter(([, list]) => list.length > 1)
const top = [...scans].sort((x, y) => y.cjkLiterals - x.cjkLiterals).slice(0, 10)
const byDomain = new Map<string, number>()
for (const [id] of entries) byDomain.set(id.split('.')[0]!, (byDomain.get(id.split('.')[0]!) ?? 0) + 1)

console.log(`· 表：**${entries.length}** 条（${[...byDomain].map(([d, n]) => `${d} ${n}`).join(' · ')}）· 源码引用 **${used.size}** 个 id`)
console.log(`· 接线：渲染层 \`t()\`/\`tr()\` 调用点 **${callTotal}** 处 · 扫描 ${scans.length} 个源文件`)
console.log(
  `· 未译读数：渲染层含中日韩的字符串字面量 **${cjkTotal}** 条` +
    `（其中**旧写法已包 t()** ${cjkWrappedTotal} 条 · **未包** ${cjkTotal - cjkWrappedTotal} 条）` +
    '（**报告口径，不阻断**——P3 界面批逐页消化）',
)
if (unused.length > 0) console.log(`· 未接线条目 **${unused.length}** 条（表里有、源码还没用上）：${unused.slice(0, 16).join(' ')}${unused.length > 16 ? ' …' : ''}`)
if (dupZh.length > 0) console.log(`· 同中文串多条目 **${dupZh.length}** 组（口径「一条文本一个 id」，多为复制粘贴，宜并条）：${dupZh.slice(0, 5).map(([zh, list]) => `「${zh}」=${list.join('/')}`).join(' · ')}${dupZh.length > 5 ? ' …' : ''}`)
console.log('· 未译最多的文件（Top 10）：')
for (const s of top) console.log(`    ${String(s.cjkLiterals).padStart(4)}  ${s.rel}`)

if (errors.length > 0) {
  console.error('')
  for (const e of errors) console.error(`❌ ${e}`)
  console.error(`❌ 本地化表体检未通过：${errors.length} 类问题`)
  process.exit(1)
}
console.log('')
console.log('✅ 本地化表体检通过：无死引用 · 无中文源串调用点 · 占位符对齐 · 无残留中日韩字符 · 值形态合规。')
