/**
 * **英文界面词典体检**（2026-09-19 加入；船长当日令「希望对游戏进行英语本地化处理」，本工具是那条口子的
 * 第一道护栏）。
 *
 * 背景：界面字符串是内联中文（≈3,500 条），key 化重构面太大 ⇒ P1 采用**以中文源串为 key** 的词典
 * （`apps/desktop/src/renderer/src/i18n/dict.en.ts`），调用点只多一层 `t('装配')`；缺词条回退中文。
 * 这套办法的代价是两条：① 中文原文一改，词典 key 就成了**死 key**；② 中英**占位符**（`{n}`）容易写歪
 * ——两者静态可查，故立此工具。
 *
 * 判据（四条，报错即红）：
 *   ① **死 key**：词典的 key 必须在渲染层源码里**仍作为字符串字面量出现**（改过中文原文 ⇒ 点名）；
 *   ② **占位符对齐**：key 与 value 的 `{名字}` 集合必须**逐个相同**（缺/多都红）；
 *   ③ **英文值禁残留中日韩字符**（白名单见 `CJK_ALLOW`：语言名一类需要原样显示的除外）；
 *   ④ 值非空、且首尾无空白。
 *
 * 另出**进度读数**（不红，供分批推进时看还差多少）：词条数 · `t()`/`tr()` 调用点 · 渲染层仍含中日韩的
 * 字符串字面量（按文件 Top 10）。
 *
 * 用法：`npm run l10n:check`（或 `npx tsx tools/l10n-check.ts`）· **只读**，不写任何文件。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v29**（`packages/core/src/state.ts` 的 `CURRENT_STATE_VERSION`）
 *   - 本工具最后跑过：**2026-09-19**（首次入库；P1 骨架批）
 *   - 本工具最后核对：**2026-09-19**（词条 116 条 · 调用点与未译读数见运行输出）
 *   - 判据：词典文件改名 / 语言键改名 / 词条 key 不再用「中文源串」这套口径 ⇒ 必须重跑核对
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { EN } from '../apps/desktop/src/renderer/src/i18n/dict.en'

const ROOT = join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src')
/** 词典自身不参与「源码里是否还有这个中文串」的判定 */
const DICT_FILE = join(ROOT, 'i18n', 'dict.en.ts')
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
/** 允许英文值里保留中日韩字符的白名单（key = 词条的 key） */
const CJK_ALLOW = new Set<string>([])

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
  /** 文件里出现过的所有字符串字面量（含模板串无插值的那部分） */
  literals: Set<string>
  /** 仍含中日韩的字符串字面量个数 */
  cjkLiterals: number
  /** `t(...)` / `tr(...)` 调用点个数 */
  calls: number
}

function scanFile(file: string): FileScan {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const literals = new Set<string>()
  let cjkLiterals = 0
  let calls = 0
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
      if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) literals.add(arg0.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { rel: relative(process.cwd(), file).split('\\').join('/'), literals, cjkLiterals, calls }
}

/** 从 key/value 里抽 `{名字}` 占位符集合 */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
}

const files = walk(ROOT).filter((p) => p !== DICT_FILE)
const scans = files.map(scanFile)
const allLiterals = new Set<string>()
let cjkTotal = 0
let callTotal = 0
for (const s of scans) {
  for (const l of s.literals) allLiterals.add(l)
  cjkTotal += s.cjkLiterals
  callTotal += s.calls
}

const entries = Object.entries(EN)

// ① 死 key：源码里再也找不到这个中文串（多半是中文原文被改过而词典没跟上）
const dead = entries.filter(([key]) => !allLiterals.has(key)).map(([key]) => key)
check(dead.length === 0, `死 key ${dead.length} 条（源码里已无此中文串，改中文原文后须同步改词典）：${dead.slice(0, 12).map((k) => `「${k}」`).join(' ')}${dead.length > 12 ? ' …' : ''}`)

// ② 占位符对齐 + ③ 英文值残留中日韩 + ④ 值非空/无首尾空白
const badPh: string[] = []
const badCjk: string[] = []
const badShape: string[] = []
for (const [key, value] of entries) {
  const a = placeholders(key)
  const b = placeholders(value)
  if (a.join('|') !== b.join('|')) badPh.push(`「${key}」→「${value}」（中 ${a.join(',') || '无'} / 英 ${b.join(',') || '无'}）`)
  if (CJK.test(value) && !CJK_ALLOW.has(key)) badCjk.push(`「${key}」→「${value}」`)
  if (value.trim() === '' || value !== value.trim()) badShape.push(`「${key}」→「${value}」`)
}
check(badPh.length === 0, `占位符不对齐 ${badPh.length} 条：${badPh.slice(0, 6).join(' · ')}${badPh.length > 6 ? ' …' : ''}`)
check(badCjk.length === 0, `英文值残留中日韩字符 ${badCjk.length} 条：${badCjk.slice(0, 6).join(' · ')}${badCjk.length > 6 ? ' …' : ''}`)
check(badShape.length === 0, `英文值为空或含首尾空白 ${badShape.length} 条：${badShape.slice(0, 6).join(' · ')}${badShape.length > 6 ? ' …' : ''}`)

// 进度读数（不红）：还差多少
const top = [...scans].sort((x, y) => y.cjkLiterals - x.cjkLiterals).slice(0, 10)

console.log(`· 词典：**${entries.length}** 条英文词条（` + `apps/desktop/src/renderer/src/i18n/dict.en.ts` + '）')
console.log(`· 接线：渲染层 \`t()\`/\`tr()\` 调用点 **${callTotal}** 处 · 扫描 ${scans.length} 个源文件`)
console.log(`· 未译读数：渲染层仍含中日韩的字符串字面量 **${cjkTotal}** 条（**报告口径，不阻断**——P3 界面批逐页消化）`)
console.log('· 未译最多的文件（Top 10）：')
for (const s of top) console.log(`    ${String(s.cjkLiterals).padStart(4)}  ${s.rel}`)

if (errors.length > 0) {
  console.error('')
  for (const e of errors) console.error(`❌ ${e}`)
  console.error(`❌ 英文词典体检未通过：${errors.length} 类问题`)
  process.exit(1)
}
console.log('')
console.log('✅ 英文词典体检通过：无死 key · 占位符对齐 · 无残留中日韩字符 · 值形态合规。')
