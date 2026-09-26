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
 * Check 2 · **本地化「直读」契约**（2026-09-26 加；船长报障「**部分遗漏未本地化的文本（舰船类型，
 * 高中低槽位数量的文本）**」）：
 *
 * 病根：core/data 里有一族**纯中文名表/函数**（`RACK_LABELS` '高槽/中槽/低槽' · `SLOT_LABELS` ·
 * `shipCategoryLabelOf` · `shipSizeLabel` …），渲染层**直读**它们 ⇒ 英文界面下漏出中文。
 * 渲染层本该走 `ui/labelsText.ts` 的本地化单点（`rackText` / `slotText` / `shipRoleText` / `shipTierText` …）。
 * 实测：本次报障命中 5 处（船卡「槽位布局」行 · 装备「槽位 / 类型」行 · 装配台槽位组标题与换装 toast ·
 * 舰船页/远征卡的角色名 · 虫洞舰卡舰级名），另有 15 处同族（已同批修：仓库/物品/货仓的槽位名等）。
 *
 * 判据：渲染层文件里出现**清单内的 core 中文标签符号**即报红（注释里的提及不算）。
 * 豁免 = `ALLOW_RAW_LABEL`（逐条写理由；新增豁免必须说明"为什么这里直读是对的"）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）
 *   - 本工具最后核对：**2026-09-26**（当日读数：26 张带 `key` 的选项表无重复项 · 直读命中 0 处）
 *   - 判据：选项表的写法改成非字面量 `key`（如键从函数来）⇒ 本工具会漏检，必须重核判据；
 *     新增 core 中文标签表时**同步登记进 `RAW_LABEL_SYMBOLS`**，否则它照样能悄悄漏中文
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

/* ═══════════ Check 2 · 本地化「直读」契约（2026-09-26 船长报障「部分遗漏未本地化的文本」） ═══════════ */

/** core/data 侧的**纯中文标签符号**：渲染层不得直读（该走 `ui/labelsText.ts` 的本地化单点） */
const RAW_LABEL_SYMBOLS: Record<string, string> = {
  RACK_LABELS: 'core 纯中文槽类表（高槽/中槽/低槽）→ 用 `rackText()`',
  rackLabel: 'core 纯中文槽类函数 → 用 `rackText()`',
  SLOT_LABELS: 'core 纯中文槽位表 → 用 `slotText()`',
  itemKindLabel: 'core 纯中文物品大类函数 → 用 `kindText()` / `kindTextOfItem()`',
  DRONE_CLASS_LABELS: 'core 纯中文机型表 → 用 `droneClassText` 一族（labelsText）',
  SHIP_ROLE_LABELS: 'core 纯中文角色表 → 用 `shipRoleText()`',
  SHIP_SIZE_CLASS: 'core 纯中文舰级表 → 用 `shipTierText()`',
  shipRoleLabel: 'core 纯中文角色函数 → 用 `shipRoleText()`',
  shipCategoryLabelOf: 'core 纯中文类别函数 → 用 `shipRoleText(shipCategoryKeyOf(ship))`',
  shipSizeLabel: 'core 纯中文舰级函数 → 用 `shipTierText()`',
  KIND_LABEL: 'core 纯中文作业种类表（活动栏）→ 需登记 id（未做，见工作文档）',
  LAIR_TIER_LABELS: 'core 纯中文窝点档（外围/核心/深层）→ 需登记 id（未做）',
  WORMHOLE_PLACE_TEXT: 'core 纯中文虫洞地点文本 → 需登记 id（未做）',
  WORMHOLE_ARCHETYPE_LABELS: 'core 纯中文虫洞原型名 → 需登记 id（未做）',
  HULL_CLASS_NAME: 'data 纯中文舰级表 → 需登记 id（未做）',
}

/** 豁免：这些文件里出现上面的符号是**对的**（逐条写理由；渲染层其它文件一律不许） */
const ALLOW_RAW_LABEL: Record<string, string> = {
  'ui/labelsText.ts': '本地化单点实现本身 —— 它就是要读 core 的中文表/键，再映射到 l10n id',
  'App.tsx': '`KIND_LABEL` 是本文件**自定义**的日志分类名表（不是 core 导出的那张），与本地化无关',
  'ui/itemSubs.ts': '本文件自己定义 `RACK_LABELS`（键→l10n id，**已本地化**）；' +
    '`SHIP_TIER_SUBS.label` 里的 core `shipSizeLabel` 只是**中文兜底**（渲染一律走 `subText(id)` → `shipTierText`）',
  // ── 以下两张表**尚无本地化版**：本批按"待登记"记账放行，**不放宽闸门**（要收口就得登记 id） ──
  'panels/Wormhole.tsx': '⛔ `WORMHOLE_PLACE_TEXT`（7 条地点名）尚未登记 id —— 见 docs/design/l10n-leak-sweep-20260926.md §四',
  'panels/WormholeScan.tsx': '⛔ `WORMHOLE_ARCHETYPE_LABELS`（5 条原型名）尚未登记 id —— 同上',
  // ── 以下三张表**尚无本地化版**：本批按"待登记"记账放行，**不放宽闸门**（要收口就得登记 id） ──
}

/** 去掉注释（块注释 + 行注释），避免"注释里提到符号名"被误判 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '')
}

/**
 * 本文件**从 `@whale/core` / `@whale/data` 具名导入**的符号集合。
 * ⚠ 判据必须只看"从 core/data 导入的那些"：渲染层自己也有**同名但已本地化**的表
 * （`ui/itemSubs.ts` 的 `RACK_LABELS` 就是——市场页 `import { RACK_LABELS } from '../ui/itemSubs'`
 * 是**对的**，早先只按符号名扫会把它误报成直读）。
 */
function importedFromCoreData(src: string): Set<string> {
  const out = new Set<string>()
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@whale\/(?:core|data)['"]/g
  for (const m of src.matchAll(re)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0]?.trim()
      if (name) out.add(name)
    }
  }
  return out
}

type RawHit = { file: string; line: number; sym: string; hint: string; code: string }
const rawHits: RawHit[] = []
const RENDERER_ROOT = join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src')

for (const file of walk(RENDERER_ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/').replace('apps/desktop/src/renderer/src/', '')
  if (ALLOW_RAW_LABEL[rel] !== undefined) continue
  const src = readFileSync(file, 'utf8')
  const fromCore = importedFromCoreData(src)
  const managed = Object.keys(RAW_LABEL_SYMBOLS).filter((s) => fromCore.has(s))
  if (managed.length === 0) continue // 没从 core/data 导入受管符号 ⇒ 不可能是直读
  const stripped = stripComments(src)
  stripped.split('\n').forEach((line, i) => {
    for (const sym of managed) {
      if (new RegExp(`\\b${sym}\\b`).test(line)) {
        rawHits.push({ file: rel, line: i + 1, sym, hint: RAW_LABEL_SYMBOLS[sym], code: line.trim().slice(0, 90) })
      }
    }
  })
}

console.log(`筛选/选项表体检：扫描 ${tableCount} 张带 \`key\` 的表` +
  `（label 写法：tr(id) ${styleCount.get('id') ?? 0} 处 · 字面量 ${styleCount.get('literal') ?? 0} 处）`)

if (problems.length === 0) {
  console.log('✅ 重复项：每张表内 `key` / `label` / `id` 各自唯一')
} else {
  console.log(`❌ 发现 ${problems.length} 处重复项（同一张表里同名两次 ⇒ 界面会出现两颗同名胶囊、React 撞 key）：`)
  for (const p of problems) {
    console.log(`  · ${p.file}:${p.line}  ${p.table} 的 ${p.kind} 重复：${p.detail}`)
  }
  console.log('  修法：删掉重复项；若两处写法不同，应保留与判定口径一致的那一条。')
}

console.log(`\n本地化直读体检：渲染层引用 core/data 标签符号的模块已扫（共 ${Object.keys(RAW_LABEL_SYMBOLS).length} 个受管符号）`)
if (rawHits.length === 0) {
  console.log('✅ 直读：渲染层无"直读 core 中文标签表/函数"的代码（豁免：' +
    Object.keys(ALLOW_RAW_LABEL).join(' · ') + '）')
} else {
  console.log(`❌ 发现 ${rawHits.length} 处直读（英文界面下会漏中文）：`)
  for (const h of rawHits) {
    console.log(`  · ${h.file}:${h.line}  ${h.sym} —— ${h.hint}`)
    console.log(`      ${h.code}`)
  }
  console.log('  修法：改走 `ui/labelsText.ts` 的本地化单点；若该表尚无本地化版，先在 labelsText 里登记 id。')
}

process.exit(problems.length === 0 && rawHits.length === 0 ? 0 : 1)
