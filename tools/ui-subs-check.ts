/**
 * **筛选/选项表「重复项」体检**（2026-09-26 加入；起因＝船长报障「手册蓝图图鉴的筛选不消失」）。
 *
 * 背景（真实缺陷，一行定位）：手册 `panels/Handbook.tsx` 的 `BP_MAIN`（蓝图图鉴一级筛选表）里
 * `equip` / `ship` / `consume` **三个键各重复一次**（数组 7 项、只有 4 个不同键）——2026-09-26 那次合并
 * 解冲突时把同一段数组粘了两遍留下的。后果：筛选胶囊用 `key={o.key}` 渲染 ⇒ 前三个键各出两颗，
 * **React 撞 key**；玩家点**第二颗**同名胶囊时 `mainKey` 照样成立（二级栏照常出现），但高亮落在第一颗上
 * ⇒ 观感是「选中那颗一直还在、筛不掉」，即船长报的原话「**蓝图的筛选不会消失**」。
 *
 * 为什么既有闸门全查不出来：数组合法、类型合法、判定按**值**比对（`main === 'equip'`）⇒
 * `typecheck` 不报、单测不渲染 UI、`ui:rot-check` 只管物理单位、`ui:theme-check` 只管颜色 token、
 * `l10n:check` 只管未译字面量。**"同一张表里同一个键出现两次"这件事本身没人管**——本工具补这一格。
 *
 * 判据（三条，全部只读源码文本、不需要跑浏览器）：
 *   ① **`key` 不得重复** —— 同一张表里同一个 `key` 出现两次＝两颗同名胶囊共用一把尺（本次的缺陷形态）；
 *   ② **`label` 不得重复** —— 同一栏出现两颗同名胶囊，玩家分不清点的是哪颗；
 *   ③ **`id` 不得重复**（有 `id` 的表）—— `id` 是本地化键，重复＝两处共用一条文案，多半也是复制粘贴残留。
 *
 * 覆盖范围：`apps/desktop/src/renderer/src` 与 `packages/ui/src` 下**所有模块级对象数组**
 * （含非导出的 `const`，如 `BP_MAIN`——它正是本次的肇事者，只扫 `export` 会漏掉）。
 * 表形状约定：数组元素是 `{ key: '…', label: … }`（可带 `id` / `idParam`）；`key` 来自变量/表达式
 * （如 `SHIP_TIER_KEYS.map(...)`）的元素**跳过**（静态读不出，不猜）。
 *
 * 用法：`npm run ui:subs-check`（或 `npx tsx tools/ui-subs-check.ts`）——**已挂进 `ui:rot-check` 链**。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）
 *   - 本工具最后核对：**2026-09-26**（当日读数：29 张带 `key` 的选项表，有重复的只有 `BP_MAIN` 一张，已修）
 *   - 判据：选项表的写法改成非字面量 `key`（如键从函数来）⇒ 本工具会漏检，必须重核判据
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
/** 扫描根：渲染层（界面里所有筛选/页签表）＋ 共用件包 */
const ROOTS = [
  join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src'),
  join(ROOT, 'packages', 'ui', 'src'),
]
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.git'])

/** 模块级对象数组的开始：`const NAME = [`（可带类型标注；`export` 可有可无） */
const TABLE_START = /^[ \t]*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*(?::[^=\n]+)?=\s*\[/gm
/** 元素里的字面量字段（`key: 'x'` / `label: tr("id")` 两种写法都收） */
const KEY_FIELD = /\bkey:\s*['"]([^'"]+)['"]/g
const LABEL_LITERAL = /\blabel:\s*['"]([^'"]+)['"]/g
const LABEL_ID = /\blabel:\s*tr\(\s*['"]([^'"]+)['"]/g
const ID_FIELD = /\bid:\s*['"]([^'"]+)['"]/g

type Problem = { file: string; line: number; table: string; kind: string; detail: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** 从 `[` 处配平到配对的 `]`（字符串/模板串内的括号不计数——本仓表里没有嵌套数组字面量，够用） */
function arrayBody(src: string, openIdx: number): { body: string; end: number } | null {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return { body: src.slice(openIdx, i + 1), end: i }
    }
  }
  return null
}

function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split('\n').length
}

function dupes(values: string[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const v of values) {
    if (seen.has(v)) dup.add(v)
    seen.add(v)
  }
  return [...dup].sort()
}

function collect(values: string[]): Map<string, number[]> {
  const m = new Map<string, number[]>()
  values.forEach((v, i) => {
    const arr = m.get(v) ?? []
    arr.push(i)
    m.set(v, arr)
  })
  return m
}

const problems: Problem[] = []
let tableCount = 0
const styleCount = new Map<string, number>() // label 写法分布（key / tr(id)）

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    for (const m of src.matchAll(TABLE_START)) {
      const name = m[1]
      const openIdx = (m.index ?? 0) + m[0].length - 1
      const span = arrayBody(src, openIdx)
      if (span === null) continue
      const { body } = span
      const keys = [...body.matchAll(KEY_FIELD)].map((x) => x[1])
      if (keys.length === 0) continue // 不是"选项表"（普通数组 / 对象数组）
      tableCount++
      const labels = [
        ...body.matchAll(LABEL_LITERAL).map((x) => ({ v: x[1], kind: 'literal' })),
        ...body.matchAll(LABEL_ID).map((x) => ({ v: x[1], kind: 'id' })),
      ]
      for (const l of labels) styleCount.set(l.kind, (styleCount.get(l.kind) ?? 0) + 1)
      const ids = [...body.matchAll(ID_FIELD)].map((x) => x[1])

      for (const [kind, values] of [
        ['key', keys],
        ['label', labels.map((l) => l.v)],
        ['id', ids],
      ] as const) {
        if (values.length < 2) continue
        for (const d of dupes(values)) {
          const rows = collect(values).get(d) ?? []
          // 元素序号 → 源码行号：取该次出现的字符位置（近似到元素所在行）
          const where: number[] = []
          for (const re of kind === 'key' ? [KEY_FIELD] : kind === 'label' ? [LABEL_LITERAL, LABEL_ID] : [ID_FIELD]) {
            for (const x of body.matchAll(re)) {
              if (x[1] === d && x.index !== undefined) where.push(lineOf(src, openIdx + x.index))
            }
          }
          problems.push({
            file: rel,
            line: where[0] ?? lineOf(src, openIdx),
            table: name,
            kind,
            detail: `\`${d}\` 出现 ${rows.length} 次（第 ${where.join(' / ')} 行；数组共 ${values.length} 项）`,
          })
        }
      }
    }
  }
}

console.log(`筛选/选项表体检：扫描 ${tableCount} 张带 \`key\` 的表` +
  `（label 写法：tr(id) ${styleCount.get('id') ?? 0} 处 · 字面量 ${styleCount.get('literal') ?? 0} 处）`)

if (problems.length === 0) {
  console.log('✅ 无重复项：每张表内 `key` / `label` / `id` 各自唯一')
  process.exit(0)
}

console.log(`\n❌ 发现 ${problems.length} 处重复项（同一张表里同名两次 ⇒ 界面会出现两颗同名胶囊、React 撞 key）：`)
for (const p of problems) {
  console.log(`  · ${p.file}:${p.line}  ${p.table} 的 ${p.kind} 重复：${p.detail}`)
}
console.log('\n修法：删掉重复项；若两处写法不同，应保留与判定口径一致的那一条。')
process.exit(1)
