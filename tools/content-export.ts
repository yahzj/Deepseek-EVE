/**
 * 内容工作台 · 导出（Phase A，2026-09-05 船长确认；列契约同源 tools/content-schema.ts）：
 * 把 data 包七张内容表导出为 UTF-8 + BOM 的 CSV（Excel/WPS 双击即开、中文不乱码），
 * 供船长快速浏览/筛选/排序，并在 Excel 中修改后由 tools/content-import.ts 安全回写。
 *
 * 用法：npm run content:export [输出目录]   （默认 content-csv/，已 gitignore）
 *
 * 输出约定（与 import 端一致，见 content-schema.ts 头注）：
 * - 每表一个文件，第一列 = 主键 id/key（导入匹配键，只读）；
 * - 全部列为"引擎原值"：小数原值（0.2 = 20%）、枚举英文原值、时长毫秒/秒原值；
 * - 嵌套结构压成紧凑字符串（| 分隔）：精炼配方 `矿物id×单位数|…`、复合产出 `物品id×权重|…`；
 * - 空单元格 = 该字段未填（引擎缺省生效）；布尔列：是/否/空。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ANOMALIES, BELTS, ITEMS, MARKET_GOODS, MODULES, SHIPS, SKILLS } from '@whale/data'
import { tableOf, type ColSpec } from './content-schema'

const CATALOGS: Record<string, readonly unknown[]> = {
  skills: SKILLS,
  items: ITEMS,
  modules: MODULES,
  ships: SHIPS,
  anomalies: ANOMALIES,
  belts: BELTS,
  market: MARKET_GOODS,
}

const outDir = process.argv[2] ?? 'content-csv'

type Row = Record<string, unknown>

function esc(v: unknown): string {
  if (v === undefined || v === null) return ''
  const s = typeof v === 'boolean' ? (v ? '是' : '否') : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s
}

/** obj 列取值：p = 'root.key' */
function objVal(row: Row, col: ColSpec): unknown {
  const [root, key] = col.p.split('.')
  const o = row[root] as Row | undefined
  return o?.[key]
}

/** list 列取值：紧凑 `id×值|…` */
function listVal(row: Row, col: ColSpec): string {
  const arr = row[col.p]
  if (!Array.isArray(arr)) return ''
  return arr
    .map((x) => `${(x as Row)[col.itemKey!]}×${(x as Row)[col.valKey!]}`)
    .join('|')
}

function cellOf(row: Row, col: ColSpec): unknown {
  switch (col.k) {
    case 'obj':
      return objVal(row, col)
    case 'list':
      return listVal(row, col)
    default:
      return row[col.p]
  }
}

function rowsToCsv(cols: readonly ColSpec[], rows: readonly unknown[]): string {
  const heads = cols.map((c) => c.head)
  const body = rows.map((r) => cols.map((c) => esc(cellOf(r as Row, c))))
  return [heads, ...body].map((r) => r.join(',')).join('\r\n') + '\r\n'
}

mkdirSync(outDir, { recursive: true })
let total = 0
for (const name of Object.keys(CATALOGS)) {
  const spec = tableOf(name)!
  const rows = CATALOGS[name]
  const path = join(outDir, `${name}.csv`)
  writeFileSync(path, '\uFEFF' + rowsToCsv(spec.cols, rows), 'utf8')
  console.log(`· ${name}.csv  ${rows.length} 行（${spec.cols.length} 列）`)
  total += rows.length
}
console.log(`✅ 已导出到 ${outDir}/（7 张表共 ${total} 条；UTF-8+BOM，Excel/WPS 可直接打开编辑）`)
console.log('编辑后回写：npm run content:import <表名> <csv文件>（见 docs/content-workbench.md）')
