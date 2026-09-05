/**
 * 内容工作台 · 导出（Phase A+B，2026-09-05 船长确认；列契约同源 tools/content-schema.ts）：
 * 把 data 包七张内容表导出为内容工作簿：
 *   - content-csv/content-workbench.xlsx —— 主格式（.xlsx 原生 Excel：一个文件 7 张 sheet，
 *     编辑/保存零编码坑，2026-09-05 船长拍板升级）
 *   - content-csv/*.csv —— 兼容格式（UTF-8 + BOM；旧习惯/程序处理仍可用）
 *
 * 用法：npm run content:export [输出目录]   （默认 content-csv/，已 gitignore）
 *
 * 列约定（与 import 端一致，见 content-schema.ts 头注）：首列主键只读；空单元格 = 不改该字段；
 * 可选字段填 '-' = 删除；数值 = 引擎原值（0.2 = 20%）；枚举 = 英文原值；布尔 = 是/否/空。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
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

async function writeXlsx(colsList: readonly (readonly ColSpec[])[], rowSets: readonly (readonly unknown[])[]): Promise<void> {
  const wb = new ExcelJS.Workbook()
  for (let t = 0; t < colsList.length; t++) {
    const cols = colsList[t]!
    const rows = rowSets[t]!
    const ws = wb.addWorksheet(['skills', 'items', 'modules', 'ships', 'anomalies', 'belts', 'market'][t]!)
    ws.columns = cols.map((c, i) => ({
      width: c.head.startsWith('描述') || c.head.includes('描述(') ? 80 : c.head.length > 30 ? 34 : Math.max(10, c.head.length * 1.6 + 4),
    }))
    const headRow = ws.addRow(cols.map((c) => c.head))
    headRow.font = { bold: true }
    for (const r of rows) {
      ws.addRow(
        cols.map((c) => {
          const v = cellOf(r as Row, c)
          if (v === undefined || v === null || v === '') return null
          return v as string | number
        }),
      )
    }
  }
  await wb.xlsx.writeFile(join(outDir, 'content-workbench.xlsx'))
}

mkdirSync(outDir, { recursive: true })
let total = 0
const rowSets: readonly unknown[][] = []
for (const name of Object.keys(CATALOGS)) {
  const spec = tableOf(name)!
  const rows = CATALOGS[name]
  rowSets.push(rows as unknown[])
  const path = join(outDir, `${name}.csv`)
  writeFileSync(path, '\uFEFF' + rowsToCsv(spec.cols, rows), 'utf8')
  console.log(`· ${name}.csv  ${rows.length} 行（${spec.cols.length} 列）`)
  total += rows.length
}
writeXlsx(
  Object.keys(CATALOGS).map((n) => tableOf(n)!.cols),
  rowSets,
).then(() => {
  console.log(`✅ 已导出到 ${outDir}/（7 张表共 ${total} 条）`)
  console.log('  · content-workbench.xlsx —— 主格式：一个文件 7 张 sheet（底部标签切换），Excel 保存零编码坑')
  console.log('  · *.csv —— 兼容格式（UTF-8+BOM）')
  console.log('回写：npm run content:import <表名> <xlsx或csv>（见 docs/content-workbench.md）')
})
