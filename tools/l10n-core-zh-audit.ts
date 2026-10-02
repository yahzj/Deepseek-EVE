/**
 * **core 侧裸中文上屏体检**（`npm run l10n:core-zh`）—— 2026-10-02 由三号的一次性探针转正（船长「按你推荐来」）。
 *
 * 为什么要有它：本地化 = **id 映射制**（约定 §十一之三）——玩家可见文案在 core 侧一律
 * **中文原串照写 ＋ 另给 `errorId`/`textId`**（`CommandResult` / `CoreBlockReason` / `addLog` 第 4 参），
 * 界面拿到 id 才能按当前语言渲染。**没给 id 的地方，英文界面只能显示中文原串**。
 * 这类缺口静态闸门（`l10n:check`）看不见——它只扫源码字面量与 `table.ts`；
 * 而"这个中文串会不会上屏"要看**返回值去了哪**，所以要单独一体检。
 *
 * 覆盖三类漏口（第三类是本工具第一版探针漏掉、补上的）：
 *   ① `return` 型：返回值是中文串（**含 `if (…) return …` 行内形态**）
 *   ② `addLog` 型：`addLog(state, kind, 文本, textId?)` 第 4 参缺失（括号配平取实参表）
 *   ③ `state.<字段> = 中文串` 型：随档提示串（界面弹窗会读）
 *
 * 判据与读数口径（与 2026-10-02 那次盘点一致）：
 *   - 只认**字符串字面量里的中文**（剔除"中文只在注释/比较里"的假阳性）——
 *     **2026-10-02 补**：三条判据现在统一在**剥注释后的源码**上跑（`stripComments`），
 *     此前 `addLog` 那条会把 JSDoc 里的示例也报出来（本工具转正当天就踩到）；
 *   - 同处三行内出现 `errorId`/`textId` 的算**合规**（甲案），不计入缺口；
 *   - 对每条再查**渲染层是否引用该函数**（`[渲染层引用]` / `[仅core/测试]`）——
 *     只有前者才"可能上屏"，后者多半是工具/测试/内部账本。
 *
 * 用法：
 *   npm run l10n:core-zh              # 全仓（packages/core/src ＋ 渲染层 game/）
 *   npm run l10n:core-zh -- shipyard  # 只看路径含该关键字的文件（本批舰船域就是这么取的）
 *   npm run l10n:core-zh -- --quiet   # 只打汇总，不打逐条
 *
 * ⚠ 本工具**只报不改**：它是盘点读数，不是护栏（要不要给某处补 id 由人判——有些中文串是
 * 内部值/工具用，补 id 反而多一层）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
// 2026-10-02：剥注释与 id 抠取改用共用件（与 `l10n:check` 同一份实现）
import { stripComments } from './text-scan'

const args = process.argv.slice(2)
const quiet = args.includes('--quiet')
const filter = args.find((a) => !a.startsWith('--')) ?? ''

const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

const CJK = /[\u4e00-\u9fff]/
/** 首个引号（' " `）之后出现中文 ⇒ 中文在字符串字面量里 */
const cjkInLiteral = (s: string): boolean => {
  const q = s.search(/['"`]/)
  return q >= 0 && CJK.test(s.slice(q))
}
/** 该行是否有 id（`core.x.y` / `ui.x.y` 形态，或 errorId/textId 字段） */
const hasId = (win: string): boolean => /errorId|textId/.test(win) || /['"`](core|ui)\.[A-Za-z0-9_.]+['"`]/.test(win)


const coreFiles = walk('packages/core/src').filter((f) => f.includes(filter))
const rendererFiles = walk('apps/desktop/src/renderer/src')
const rendererSrc = rendererFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const rendererGame = walk('apps/desktop/src/renderer/src/game').filter((f) => f.includes(filter))

type Row = { kind: string; file: string; line: number; fn: string; ret: string; text: string; used: boolean }
const rows: Row[] = []

/** 找该行所属函数（往上扫 150 行） */
const ownerOf = (lines: string[], i: number): { fn: string; ret: string } => {
  for (let k = i; k >= Math.max(0, i - 150); k--) {
    const m = lines[k].match(/^(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/)
    if (m) {
      const t = lines[k].match(/\)\s*:\s*([^{]+)\{/)
      return { fn: m[3], ret: t ? t[1].trim() : '' }
    }
    const c = lines[k].match(/^(export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\(/)
    if (c) {
      const t = lines[k].match(/\)\s*:\s*([^=]+)=>/)
      return { fn: c[2], ret: t ? t[1].trim() : '' }
    }
  }
  return { fn: '（模块级/匿名）', ret: '' }
}
const isUsedInRenderer = (fn: string): boolean =>
  fn !== '（模块级/匿名）' && new RegExp(`\\b${fn.replace(/\$/g, '\\$')}\\b`).test(rendererSrc)

for (const f of [...coreFiles, ...rendererGame]) {
  const raw = readFileSync(f, 'utf8')
  /** 三条判据统一在**剥注释后**的源码上跑（行号与字符串内容保持不变，见 `stripComments` 头注） */
  const src = stripComments(raw)
  const lines = src.split(/\r?\n/)

  /* ① return 型（含行内 `if (…) return …`） */
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!
    if (!/\breturn\b/.test(t)) continue
    if (!cjkInLiteral(t)) continue
    if (hasId(lines.slice(i, i + 3).join(' '))) continue
    const { fn, ret } = ownerOf(lines, i)
    rows.push({ kind: 'return', file: f, line: i + 1, fn, ret, text: t.trim(), used: isUsedInRenderer(fn) })
  }

  /* ② addLog 型（括号配平取实参表） */
  let idx = 0
  while ((idx = src.indexOf('addLog(', idx)) >= 0) {
    let depth = 0
    let j = idx + 'addLog'.length
    let end = j
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++
      else if (src[j] === ')') {
        depth--
        if (depth === 0) { end = j; break }
      }
    }
    const a = src.slice(idx + 'addLog('.length, end)
    if (!hasId(a) && CJK.test(a)) {
      const line = src.slice(0, idx).split('\n').length
      const { fn, ret } = ownerOf(lines, line - 1)
      rows.push({ kind: 'addLog', file: f, line, fn, ret, text: `addLog(… ${a.replace(/\s+/g, ' ').trim().slice(0, 120)}`, used: isUsedInRenderer(fn) })
    }
    idx = end
  }

  /* ③ state 赋值型 */
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!
    if (!/state\.\w+\s*=\s*[`'"]/.test(t)) continue
    if (/==|!=|===|!==/.test(t)) continue
    if (!cjkInLiteral(t)) continue
    const { fn, ret } = ownerOf(lines, i)
    rows.push({ kind: 'assign', file: f, line: i + 1, fn, ret, text: t.trim(), used: isUsedInRenderer(fn) })
  }
}

/* ── 汇总 ── */
const byKind: Record<string, number> = {}
const byFile: Record<string, number> = {}
let usedN = 0
for (const r of rows) {
  byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
  byFile[r.file] = (byFile[r.file] ?? 0) + 1
  if (r.used) usedN += 1
}
console.log(`core 侧裸中文上屏体检${filter ? `（只扫路径含「${filter}」的文件）` : ''}`)
console.log(`合计 **${rows.length}** 处 · return 型 ${byKind.return ?? 0} · addLog 型 ${byKind.addLog ?? 0} · state 赋值型 ${byKind.assign ?? 0}`)
console.log(`其中**渲染层引用了该函数**的 ${usedN} 处（这些才可能上屏；其余多半是工具/测试/内部用）\n`)
console.log('按文件：')
for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${f}`)

if (!quiet) {
  console.log('\n逐条：')
  for (const r of rows) {
    console.log(`${r.used ? '[渲染层引用]' : '[仅core/测试]'} [${r.kind}] ${r.file}:${r.line} · ${r.fn}${r.ret ? ` → ${r.ret}` : ''}`)
    console.log(`    ${r.text.slice(0, 180)}`)
  }
}
