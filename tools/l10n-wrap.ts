/**
 * **界面串批量接线器（ID 制）**（2026-09-19 加入；船长令「英语本地化」的 P3 界面批工具）。
 *
 * 背景：渲染层有 ≈1,900 条含中文的字符串字面量，逐条手改太慢且易错（上一批踩过
 * `title="t('…')"` 把调用写进属性字符串的坑）。本工具用 TS AST 找出**安全可包**的位置，换成
 * `tr('ui.<文件短名>.<序号>')`（模块级翻译函数，见 `i18n/locale.tsx`），并**把中英两列追加进唯一表**
 * `packages/data/src/l10n/table.ts` —— 即「源码只留 id，文本只留一份表」这条船长口径的落地产。
 *
 * **只包三类位置**（其余一律不碰，避免把逻辑串/类名/id 也包进去）：
 *   ① JSX **文本子节点**（`<span>文字</span>` ⇒ `<span>{tr('ui.X.001')}</span>`）；
 *   ② JSX **展示类属性**的字符串初值（`title` / `placeholder` / `label` / `hint` / `note` / `tip` / `alt` / `desc`）
 *      ⇒ `title="文字"` 变 `title={tr('ui.X.001')}`（正是上一批踩坑的形态）；
 *   ③ JSX 表达式容器里的**三元/逻辑表达式中的字符串字面量**（`{ok ? '甲' : '乙'}`）。
 * 跳过：已包 `t(`/`tr(` 的、纯空白、注释、不含中日韩的、以及 `i18n/` 自身。
 *
 * ⚠ **已知边界（第⑤类的坑）**：少数中文字面量是**类型的字面量联合 key**（如 `CraftOption.group:
 * '装备蓝图' | '舰船蓝图' | '消耗品蓝图'`），它们同时被当文案显示——包成 `tr(...)` 会让类型对不上
 * （`typecheck` 报 TS2322）。**正确做法**：key 保持中文字面量，改在**渲染处**按 id 取译名
 * （例：`pages/ShipPage.tsx` 的 `CRAFT_GROUPS`）。工具认不出这种，交给 typecheck 兜。
 *
 * **英文从哪来**：`--en=<json>` 给一张 `{ "中文": "English" }` 映射（P3 逐页翻译时先出这张表）。
 * **映射里没有的中文串一律不包、不改**（宁可少包，绝不产出 `en: ''` 的半成品让闸门变红）；
 * 干跑会把这些串列出来，方便补完再跑一次。
 *
 * **去重**：同一个中文串**在表里已有条目就直接复用那个 id**（不新造）——保证「一条文本一个 id」，
 * 也避免同一句中文在表里出现两遍各自跑偏。
 *
 * **id 规则**：`<域>.<文件短名>.<三位序号>`。域当前固定 `ui`（界面批）；短名 = 源文件去扩展名的
 * 文件名（保持文件自身大小写）；序号 = 该「域.短名」段**现有最大号 +1** 递增。
 *
 * 用法：
 *   npx tsx tools/l10n-wrap.ts                              # 干跑：按文件列出可包条数 + 缺译清单
 *   npx tsx tools/l10n-wrap.ts --list                       # 顺带逐条列出待包的中文串（做 `--en` 用）
 *   npx tsx tools/l10n-wrap.ts --en=tools/_l10n-en.json --only=pages/ShipPage.tsx --write
 *
 * ⚠ **版本自检**
 *   - 游戏版本：**v0.1.0** · 存档结构：**v29**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后跑过：**2026-09-19**（ID 制改版：造 id + 写表 + `l10n-keep` 豁免标记）
 *   - 本工具最后核对：**2026-09-19**（表 938 条 · 界面批 1~6 · 幂等自检：连跑两次第 2 次 0 处改动）
 *   - 判据：`i18n/locale.tsx` 的导出改名（`tr`）/ 表文件路径或导出名（`L10N`）改动 / App 不再订阅引擎
 *     `notify` ⇒ 必须重跑核对
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src')
const I18N_DIR = join(ROOT, 'i18n')
const TABLE = join(process.cwd(), 'packages', 'data', 'src', 'l10n', 'table.ts')
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
/** 展示类属性（初值是字符串时包成表达式） */
const DISPLAY_ATTRS = new Set(['title', 'placeholder', 'label', 'hint', 'note', 'tip', 'alt', 'desc'])
/** 表里的域前缀（新造 id 只允许落在这些域；`ui` = 界面批） */
const DOMAINS = ['ui', 'ship', 'mod', 'item', 'skill', 'ano', 'gal', 'bp', 'wreck', 'station', 'faction', 'travel', 'matter', 'core']
const WRITE = process.argv.includes('--write')
const LIST = process.argv.includes('--list')
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const only = onlyArg ? onlyArg.slice('--only='.length) : null
const enArg = process.argv.find((a) => a.startsWith('--en='))
const enPath = enArg ? enArg.slice('--en='.length) : null

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if ((p.endsWith('.tsx') || p.endsWith('.ts')) && !p.startsWith(I18N_DIR)) out.push(p)
  }
  return out
}

/** 该节点是否已经在 `t(...)` / `tr(...)` 里（父链上找调用表达式） */
function insideTranslateCall(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent
  while (cur) {
    if (ts.isCallExpression(cur) && ts.isIdentifier(cur.expression) && (cur.expression.text === 't' || cur.expression.text === 'tr')) return true
    cur = cur.parent
  }
  return false
}

/** 文件主行尾（工作树是 CRLF，主树工作文件是 LF ⇒ 一律照原样保留，别把整文件换行改掉） */
function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

// ── 表：读进来 → 内存里增补 → 需要时按 (域, 短名, 序号) 排序重写 ────────────────────────────────
interface Row {
  id: string
  zh: string
  en: string
}
const tableText = readFileSync(TABLE, 'utf8')
const TABLE_EOL = eolOf(tableText)
const ROW_RE = /^\s*"([^"]+)":\s*\{\s*zh:\s*("(?:[^"\\]|\\.)*"),\s*en:\s*("(?:[^"\\]|\\.)*")\s*\},?\s*$/
const tableLines = tableText.split(/\r?\n/)
const openIdx = tableLines.findIndex((l) => l.includes('export const L10N'))
const closeIdx = tableLines.findLastIndex((l) => l.trim() === '}')
if (openIdx < 0 || closeIdx <= openIdx) throw new Error('table.ts 结构不认识：找不到 L10N 对象边界')
const rows: Row[] = []
for (let i = openIdx + 1; i < closeIdx; i++) {
  const m = ROW_RE.exec(tableLines[i]!)
  if (!m) {
    // 表是**生成件**：解析时跳过注释行与空行（重写时不保留注释）
    if (tableLines[i]!.trim() === '' || tableLines[i]!.trimStart().startsWith('//')) continue
    throw new Error(`table.ts 第 ${i + 1} 行不像条目标目：${tableLines[i]!}`)
  }
  rows.push({ id: m[1]!, zh: JSON.parse(m[2]!) as string, en: JSON.parse(m[3]!) as string })
}
const byZh = new Map<string, Row>()
for (const r of rows) if (!byZh.has(r.zh)) byZh.set(r.zh, r)
/** 「域.短名」段的当前最大序号（新 id 从这里往上加） */
const maxSeq = new Map<string, number>()
for (const r of rows) {
  const parts = r.id.split('.')
  const n = Number(parts[parts.length - 1])
  const stem = parts.slice(0, -1).join('.')
  if (Number.isFinite(n)) maxSeq.set(stem, Math.max(maxSeq.get(stem) ?? 0, n))
}
/** 本次新造的 id（报告用） */
const minted: string[] = []
/** 复用既有条目 / 新造条目的接线处数（报告用） */
let reusedSites = 0
let newSites = 0
function mintId(stem: string): string {
  const key = `ui.${stem}`
  const next = (maxSeq.get(key) ?? 0) + 1
  maxSeq.set(key, next)
  const id = `${key}.${String(next).padStart(3, '0')}`
  minted.push(id)
  return id
}

// ── 英文映射（本批翻译稿）────────────────────────────────────────────────────────────────
const enMap: Record<string, string> = {}
if (enPath) {
  if (!existsSync(enPath)) throw new Error(`--en 指定的映射文件不存在：${enPath}`)
  Object.assign(enMap, JSON.parse(readFileSync(enPath, 'utf8')) as Record<string, string>)
}

/** 中文串 → id（复用表里已有的；没有则按来源文件造新 id，并把英文列补上；缺译返回 null） */
function idFor(zh: string, stem: string): string | null {
  const hit = byZh.get(zh)
  if (hit) return hit.id
  const en = enMap[zh]
  if (en === undefined) return null
  // 形态：非空 · 不许制表/换行 · 首尾**至多一个空格**（JSX 文本片段与相邻 `{表达式}` 之间要靠这个空格
  // 排版，如 `{n}（结构 500）` ⇒ `{n} (structure 500)`；多余空白仍是错的）
  if (en.trim() === '' || /[\r\n\t]/.test(en) || /^ {2,}| {2,}$/.test(en)) throw new Error(`英文值形态不合规（空/含制表换行/首尾多余空白）：「${zh}」→「${en}」`)
  // 中日韩字符：只有**语言自称**一类允许原样保留（en === zh，如「中文」）
  if (CJK.test(en) && en !== zh) throw new Error(`英文值残留中日韩字符：「${zh}」→「${en}」`)
  const id = mintId(stem)
  const row: Row = { id, zh, en }
  rows.push(row)
  byZh.set(zh, row)
  return id
}

interface Edit {
  start: number
  end: number
  text: string
}

const report: Array<{ rel: string; n: number; missing: Set<string>; manual: Set<string> }> = []

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split('\\').join('/')
  if (only && !rel.includes(only)) continue
  const text = readFileSync(file, 'utf8')
  const EOL = eolOf(text)
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const stem = rel.split('/').pop()!.replace(/\.tsx?$/, '')
  const edits: Edit[] = []
  const missing = new Set<string>()
  const wrapped = new Set<string>()
  /** 命中但**故意不包**（需人工拆句）的跨行碎片（报告用） */
  const manual = new Set<string>()
  /** 待包位置（先收集，最后统一按中文串换 id —— 同串多次出现只造一个 id） */
  const sites: Array<{
    node: ts.Node
    zh: string
    form: 'jsx-text' | 'attr' | 'expr' | 'arg' | 'template'
    lead?: string
    tail?: string
    /** 模板字面量的插值参数（`{name}` 占位符 ↔ 原表达式文本） */
    params?: Array<{ name: string; text: string }>
  }> = []
  /** 同一节点别被两条判据重复认领（否则会被包两层） */
  const claimed = new Set<number>()
  /** 打了 `l10n-keep` 标记（同行或上一行）而**故意不包**的字面量（报告用） */
  const kept = new Set<string>()
  const sourceLines = text.split(/\r?\n/)
  const addSite = (
    node: ts.Node,
    zh: string,
    form: 'jsx-text' | 'attr' | 'expr' | 'arg' | 'template',
    lead?: string,
    tail?: string,
    params?: Array<{ name: string; text: string }>,
  ): void => {
    const at = node.getStart(sf)
    if (claimed.has(at)) return
    // 纯空白（含全角空格）不是文案，永远不包
    if (zh.trim() === '') return
    // 人工标记：这一格不是文案（如类型的字面量联合 key）⇒ 源码里写 `l10n-keep` 让工具绕开
    const line = sf.getLineAndCharacterOfPosition(at).line
    if ((sourceLines[line] ?? '').includes('l10n-keep') || (sourceLines[line - 1] ?? '').includes('l10n-keep')) {
      kept.add(zh)
      return
    }
    claimed.add(at)
    sites.push({ node, zh, form, lead, tail, params })
  }
  const visit = (node: ts.Node): void => {
    // ① JSX 文本子节点
    if (ts.isJsxText(node)) {
      const raw = node.getText(sf)
      const trimmed = raw.trim()
      if (trimmed.length > 0 && CJK.test(trimmed) && !insideTranslateCall(node)) {
        // 跨行 / 只剩一两个字的碎片 = 正文与 `{表达式}` 交错的断片：整段包成一条译文会把句子切碎
        // （英文语序多半对不上），**留人工按整句重写**（脚本不猜）
        if (/[\r\n]/.test(trimmed) || trimmed.length < 2 || /^[%·）)、，。：；]|%$/.test(trimmed)) {
          manual.add(trimmed)
        } else {
          addSite(node, trimmed, 'jsx-text', raw.slice(0, raw.indexOf(trimmed)), raw.slice(raw.indexOf(trimmed) + trimmed.length))
        }
      }
    }
    // ② 展示类属性的字符串初值
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && ts.isIdentifier(node.name)) {
      const val = node.initializer.text
      if (DISPLAY_ATTRS.has(node.name.text) && CJK.test(val) && !insideTranslateCall(node)) addSite(node.initializer, val, 'attr')
    }
    // ③ JSX 表达式容器里的三元/逻辑分支字符串
    if (ts.isStringLiteral(node) && CJK.test(node.text) && !insideTranslateCall(node)) {
      const p = node.parent
      const inJsx = p !== undefined && (ts.isConditionalExpression(p) || ts.isBinaryExpression(p) || ts.isParenthesizedExpression(p))
      if (inJsx && ts.isJsxExpression(p.parent ?? p)) addSite(node, node.text, 'expr')
    }
    // ④ 旧写法残留：`t('中文')` / `tr('中文')`（词典时代「中文串当 key」，中文串只换了 id 的位置）
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 't' || node.expression.text === 'tr')) {
      const arg0 = node.arguments[0]
      if (arg0 && ts.isStringLiteral(arg0) && CJK.test(arg0.text)) addSite(arg0, arg0.text, 'arg')
    }
    // ⑤ 写死的中文展示文案：对象字面量的属性值 / 数组元素 / 三元分支 / 变量初值 / 返回值
    //    （渲染层里带中文的裸字面量基本都是文案：标签表、状态词表、提示语；比较用的中文串不在此列——
    //     `=== '中文'` 的父节点是 BinaryExpression，不在下面这五类里）
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && CJK.test(node.text) && !insideTranslateCall(node)) {
      const p = node.parent
      const displaySpot =
        (ts.isPropertyAssignment(p) && p.initializer === node) ||
        ts.isArrayLiteralExpression(p) ||
        (ts.isConditionalExpression(p) && (p.whenTrue === node || p.whenFalse === node)) ||
        (ts.isVariableDeclaration(p) && p.initializer === node) ||
        (ts.isReturnStatement(p) && p.expression === node)
      if (displaySpot) addSite(node, node.text, 'expr')
    }
    // ⑥ 调用实参里的中文串（`addLog('已卸下装备。')` / `toast('…')` 一类"直接显示"的实参）
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : ''
      if (callee !== 't' && callee !== 'tr') {
        for (const arg of node.arguments) {
          if ((ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) && CJK.test(arg.text) && !insideTranslateCall(arg)) {
            addSite(arg, arg.text, 'expr')
          }
        }
      }
    }
    // ⑦ 无插值模板字面量（`` `装备已卸下。` ``）——比照普通字符串处理
    // ⑧ **带插值的模板**（`` `已售出 ${n} 单位` ``）⇒ `tr('id', { n })`；中文片段里的 `${…}` 记为 `{名字}`
    //    占位符名取表达式文本（简单标识符才用原名，其余用 `pN`；重名自动加序号）——这样译文里读写都直观
    if (ts.isTemplateExpression(node) && !insideTranslateCall(node)) {
      const raw = node.getText(sf)
      if (CJK.test(raw)) {
        if (/[\r\n]/.test(raw)) {
          manual.add(raw.replace(/\s+/g, ' ').slice(0, 90))
        } else {
          const used = new Map<string, number>()
          const params = node.templateSpans.map((span, i) => {
            const exprText = span.expression.getText(sf)
            const base = /^[A-Za-z_$][\w$]*$/.test(exprText) ? exprText : `p${i + 1}`
            const seen = used.get(base) ?? 0
            used.set(base, seen + 1)
            return { name: seen === 0 ? base : `${base}${seen + 1}`, text: exprText }
          })
          const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)]
          const zh = parts.map((part, i) => (i === 0 ? part : `{${params[i - 1]!.name}}${part}`)).join('')
          addSite(node, zh, 'template', undefined, undefined, params)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  for (const s of sites) {
    const preexisting = byZh.has(s.zh)
    const id = idFor(s.zh, stem)
    if (id === null) {
      missing.add(s.zh)
      continue
    }
    wrapped.add(s.zh)
    if (preexisting) reusedSites += 1
    else newSites += 1
    if (s.form === 'jsx-text') edits.push({ start: s.node.getStart(sf), end: s.node.getEnd(), text: `${s.lead}{tr(${JSON.stringify(id)})}${s.tail}` })
    else if (s.form === 'attr') edits.push({ start: s.node.getStart(sf), end: s.node.getEnd(), text: `{tr(${JSON.stringify(id)})}` })
    // 旧写法：调用点外层已经是 `t(...)`，这里**只把参数换成 id**（不能再套一层 tr）
    else if (s.form === 'arg') edits.push({ start: s.node.getStart(sf), end: s.node.getEnd(), text: JSON.stringify(id) })
    else if (s.form === 'template') {
      const args = (s.params ?? []).map((p) => `${p.name}: ${p.text}`).join(', ')
      edits.push({ start: s.node.getStart(sf), end: s.node.getEnd(), text: `tr(${JSON.stringify(id)}, { ${args} })` })
    } else edits.push({ start: s.node.getStart(sf), end: s.node.getEnd(), text: `tr(${JSON.stringify(id)})` })
  }
  if (edits.length === 0) {
    if (missing.size > 0 || manual.size > 0) report.push({ rel, n: 0, missing, manual })
    continue
  }
  report.push({ rel, n: edits.length, missing, manual })
  if (!WRITE) continue
  // 从后往前替换，避免偏移错位
  edits.sort((a, b) => b.start - a.start)
  let out = text
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  // 补 import（相对路径按文件深度算；已有 `tr` 导入则不重复插）
  // ⚠ 插入点必须取**最后一条 import 语句的结束位置**——按行找「以 import 开头」会插进多行 import 块中间
  if (!/import\s*\{[^}]*\btr\b[^}]*\}\s*from/.test(out)) {
    const depth = rel.split('/').length - 1
    const up = depth === 0 ? './' : '../'.repeat(depth)
    const importLine = `import { tr } from '${up}i18n/locale'`
    const lastImport = sf.statements.filter((st) => ts.isImportDeclaration(st)).pop()
    const lines = out.split(/\r?\n/)
    let insertAt = 1
    if (lastImport) {
      const endLine = sf.getLineAndCharacterOfPosition(lastImport.getEnd()).line
      insertAt = Math.min(endLine + 1, lines.length)
    }
    lines.splice(insertAt, 0, importLine)
    out = lines.join(EOL)
  }
  writeFileSync(file, out, 'utf8')
}

// ── 表落盘：按 (域, 短名, 序号) 排序写回，便于人工查阅与 diff ────────────────────────────────
const sortKey = (id: string): [number, string, number] => {
  const parts = id.split('.')
  const n = Number(parts[parts.length - 1])
  return [DOMAINS.indexOf(parts[0]!), parts.slice(0, -1).join('.'), Number.isFinite(n) ? n : 0]
}
if (WRITE) {
  const sorted = [...rows].sort((a, b) => {
    const ka = sortKey(a.id)
    const kb = sortKey(b.id)
    return ka[0] - kb[0] || ka[1].localeCompare(kb[1]) || ka[2] - kb[2]
  })
  const body = sorted.map((r) => `  ${JSON.stringify(r.id)}: { zh: ${JSON.stringify(r.zh)}, en: ${JSON.stringify(r.en)} },`)
  const head = tableLines.slice(0, openIdx + 1)
  const tail = tableLines.slice(closeIdx)
  writeFileSync(TABLE, [...head, ...body, ...tail].join(TABLE_EOL), 'utf8')
}

report.sort((a, b) => b.n - a.n)
console.log(`· 批量接线${WRITE ? '（已落盘）' : '（干跑，未改文件）'}：${report.length} 个文件 · 共 ${report.reduce((s, r) => s + r.n, 0)} 处`)
for (const r of report.slice(0, 25)) console.log(`    ${String(r.n).padStart(4)}  ${r.rel}${r.missing.size > 0 ? `（缺译 ${r.missing.size}）` : ''}${r.manual.size > 0 ? `（需人工 ${r.manual.size}）` : ''}`)
console.log(`· 表：${rows.length} 条 · 接线处复用既有条目 ${reusedSites} 处 / 新造 id ${minted.length} 条（${newSites} 处）`)
const missingAll = new Set<string>()
const manualAll = new Set<string>()
for (const r of report) {
  for (const m of r.missing) missingAll.add(m)
  for (const m of r.manual) manualAll.add(m)
}
if (manualAll.size > 0) {
  console.log(`\n· **需人工拆句** ${manualAll.size} 条（跨行或标点断片：正文与 JSX 表达式交错，工具不猜）：`)
  for (const m of [...manualAll].sort()) console.log(`    ${JSON.stringify(m)}`)
}
if (missingAll.size > 0) {
  console.log(`\n· **缺译未包** ${missingAll.size} 条中文串（补进 --en 映射后重跑）：`)
  for (const m of [...missingAll].sort()) console.log(`    ${m}`)
}
if (LIST) {
  console.log('\n· `--list`：逐文件候选：')
  for (const r of report) console.log(`    ${r.rel}：${r.n} 处`)
}
