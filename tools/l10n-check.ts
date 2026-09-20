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

/**
 * **扫描根**（2026-09-20 扩容）：原来只有渲染层，导致 `main/` 与 `preload/` 是**盲区**——
 * 主进程的窗口标题与"导入/导出"系统对话框文案扫不到（三号实测有 10 处）。
 * 现在扫 `apps/desktop/src` 整个（含 main / preload / renderer），两处口径一致。
 */
const ROOT = join(process.cwd(), 'apps', 'desktop', 'src')
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
/**
 * **纯标点/空白**不算"未译"（2026-09-20 三号收尾）：
 * 全角空格 `　`、直角引号 `」`、句号 `。` 这类**语言中立**——中英都这么排版，
 * 没有"翻不翻"的问题。判据：去掉 CJK 标点与空白后**一个汉字/假名都不剩** ⇒ 跳过。
 * （否则这类会一直挂在"未译读数"里，把真实进度搅浑。）
 */
const isPunctuationOnly = (s: string): boolean => !/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(s)
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
  /**
   * 其中**已声明"不是文案"**的个数（2026-09-20 船长裁「乙」）：
   * 源码里带 `l10n-keep` 标记的行上的中文串——类型联合 key / 形状槽键 / 键表 `label` /
   * 开发探针 console 串 / i18n 实现自身的中文分支。
   * 口径：**声明过就不算未译**（读数归零可核），但**仍逐条点名**，便于复核声明是否成立。
   */
  cjkKept: number
  /** `t(...)` / `tr(...)` 调用点个数 */
  calls: number
  /** 调用点第一参数是字符串字面量时的取值（文件:行 一并记下，便于点名） */
  refs: Array<{ id: string; at: string }>
  /** 文件里出现过的所有字符串字面量（动态传 id 的取值由此认领，见 `used` 的算法） */
  literals: Set<string>
  /** 被 `l10n-keep` 声明掉的条目（`文件:行 文本`，报告里点名用） */
  kept: string[]
  /** **未声明**的中文串（`文件:行 文本`）——`--list-untranslated` 逐条打它，收尾核对靠这个 */
  untranslated: string[]
}

function scanFile(file: string): FileScan {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const rel = relative(process.cwd(), file).split('\\').join('/')
  const lines = text.split('\n')
  /**
   * 某一行（1-based）是否被声明"不是文案"：
   * ① 行内或**其前 6 行内**有 `l10n-keep`（适合单条/就近声明）；
   * ② 落在 `l10n-keep-start` … `l10n-keep-end` **区间**内（适合整张键表：
   *    中文 label 分散几十行，逐条加标记太脆——区间表达更准确）。
   */
  const keepRanges: Array<[number, number]> = []
  {
    let start = -1
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!
      if (l.includes('l10n-keep-start')) start = i + 1
      if (l.includes('l10n-keep-end') && start > 0) {
        keepRanges.push([start, i + 1])
        start = -1
      }
    }
  }
  const isKeptLine = (lineNo: number): boolean => {
    if (keepRanges.some(([a, b]) => lineNo >= a && lineNo <= b)) return true
    // 同行（`… , // l10n-keep`）与**前 6 行**（注释块写在键表上方）都算声明
    const from = Math.max(0, lineNo - 7)
    const to = Math.min(lines.length - 1, lineNo)
    for (let i = from; i <= to; i++) if (lines[i]!.includes('l10n-keep')) return true
    return false
  }
  let cjkLiterals = 0
  let cjkWrapped = 0
  let cjkKept = 0
  let calls = 0
  const refs: Array<{ id: string; at: string }> = []
  const kept: string[] = []
  const untranslated: string[] = []
  /** 文件里出现过的所有字符串字面量（导航标签、`KIND_EMPTY` 一类**动态传 id**的取值靠它认领） */
  const literals = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.add(node.text)
      // 纯全角标点/空白（`　` 当分隔符用）语言中立 ⇒ 不算文案
      if (CJK.test(node.text) && !isPunctuationOnly(node.text)) {
        cjkLiterals += 1
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        // 声明过"不是文案"的（`l10n-keep`）⇒ 从"未译"里划走，但仍点名登记，便于复核声明是否成立
        if (isKeptLine(line)) {
          cjkKept += 1
          kept.push(`${rel}:${line} 「${node.text.slice(0, 40)}」`)
        } else {
          untranslated.push(`${rel}:${line} 「${node.text.slice(0, 40)}」`)
        }
      }
    }
    // ⚠ JSX **文本节点**也要算进未译读数（2026-09-19 补：此前只数字符串字面量，读数偏低——
    //    界面里大量中文是 `<span>中文</span>` 这种文本节点，不是字符串字面量）
    if (ts.isJsxText(node)) {
      const t = node.getText().trim()
      // 纯全角空白（`　`）在 JSX 里只是排版空白 ⇒ JSX 会把它折成空格，不算文案
      if (t !== '' && /\S/.test(t) && CJK.test(t) && !isPunctuationOnly(t)) {
        cjkLiterals += 1
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        if (isKeptLine(line)) {
          cjkKept += 1
          kept.push(`${rel}:${line} 「${t.slice(0, 40)}」`)
        } else {
          untranslated.push(`${rel}:${line} 「${t.slice(0, 40)}」`)
        }
      }
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
  return { rel, cjkLiterals, cjkWrapped, cjkKept, calls, refs, literals, kept, untranslated }
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
let cjkKeptTotal = 0
const keptAll: string[] = []
for (const s of scans) {
  callTotal += s.calls
  cjkTotal += s.cjkLiterals
  cjkWrappedTotal += s.cjkWrapped
  cjkKeptTotal += s.cjkKept
  keptAll.push(...s.kept)
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

/**
 * **core 侧引用核对（甲案 · 2026-09-20 起）**：
 * `packages/core/src` 里的文案 id 是**手写字符串**——它出现在两种位置：
 * ① `addLog(...)` 的**第 4 个实参** `textId`；② `CommandResult` 的 `errorId`。
 * 打错一个字，界面就把 id 原样显示给玩家（与渲染层的死引用同一个坑）。
 * 所以这里按**字面量**扫：core 源码里出现的一切 `'core.*'` 串都必须是表里存在的合规 id。
 * （id 只会来自本表，源码里不存在"值恰好长这样"的业务字符串 ⇒ 该判据无误伤。）
 *
 * ⚠ 本段**不做**"未译读数"：core 还在按文件迁移中，中文原串是过渡期的正常状态。
 */
const CORE_ROOT = join(process.cwd(), 'packages', 'core', 'src')
const coreRefs: Array<{ id: string; at: string }> = []
for (const file of walk(CORE_ROOT)) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/'(core\.[A-Za-z][A-Za-z0-9]*\.\d{3})'/g)) {
    const line = text.slice(0, m.index).split('\n').length
    coreRefs.push({ id: m[1]!, at: `${relative(process.cwd(), file)}:${line}` })
  }
}
const coreBad: string[] = []
for (const r of coreRefs) {
  used.add(r.id) // 算"已接线"⇒ 不会误报未接线条目
  if (!ID_RE.test(r.id)) coreBad.push(`${r.at} → 「${r.id}」形态不合规`)
  else if (!ids.has(r.id)) coreBad.push(`${r.at} → 「${r.id}」表里没有（界面会显示 id）`)
}
check(coreBad.length === 0, `core 侧文案 id 有问题 ${coreBad.length} 处：${coreBad.slice(0, 8).join(' · ')}${coreBad.length > 8 ? ' …' : ''}`)

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
console.log(`· core 文案 id（甲案）：**${coreRefs.length}** 处引用（\`textId\` / \`errorId\`）——全部在表内、形态合规`)
console.log(
  `· 未译读数：渲染层含中日韩的字符串字面量 **${cjkTotal - cjkKeptTotal}** 条` +
    `（其中**旧写法已包 t()** ${cjkWrappedTotal} 条 · **已声明不译 l10n-keep** ${cjkKeptTotal} 条）` +
    '（**报告口径，不阻断**——P3 界面批逐页消化）',
)
if (keptAll.length > 0) {
  console.log(
    `· 已声明不译的 ${keptAll.length} 条（l10n-keep：类型联合 key / 形状槽键 / 键表 label / 开发探针 / i18n 实现自身）——**声明过就不算未译**，仍逐条点名便于复核：`,
  )
  for (const k of keptAll.slice(0, 12)) console.log(`    ${k}`)
  if (keptAll.length > 12) console.log(`    …（其余 ${keptAll.length - 12} 条见 npm run l10n:list）`)
}
/**
 * `--list-untranslated`：逐条列出**未声明**的中文串（即真正"还没处理"的）。
 * 为什么需要：上面的 Top 表是**总命中数**（含已声明项），看不出"还剩哪些没声明"——
 * 收尾核对时得精确知道还剩几条、在哪一行。
 */
if (process.argv.includes('--list-untranslated')) {
  console.log('· 未声明的中文串（逐条）：')
  for (const s of scans) {
    for (const item of s.untranslated) console.log(`    ${item}`)
  }
}
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
