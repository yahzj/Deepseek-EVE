/**
 * **技能树坐标工作台 · 导出**（**2026-09-22 船长令**：「**能否将测试中的技能页面放入EXCEL中，将其位置转换成
 * 坐标。我来手动调整图标位置？**」）。
 *
 * 干什么：把**当前技能树页每一格节点的坐标**导出成一份原生 Excel（一张工作簿两张表）＋ 每表一份 UTF-8(BOM) CSV：
 *   - `技能节点坐标`：82 行 = 82 个技能，列 = 序号 / **技能 id（只读）** / 名称 / 技能书 / 大类 / rank /
 *     `行`·`列`（**读数**：由坐标反推的格位，方便你对齐成网格）/ **`x`·`y`（可改）** / 前置（读数） / 链长（读数）；
 *   - `说明`：编辑约定（**只改 x/y**；**空单元格 = 该节点不动**；坐标是**每本技能书自己的局部坐标系**；
 *     网格参考：一格 = 116 × 102 px，第 0 行/列中心 = (36, 52)）。
 *
 * 用法：`npm run skilltree:export [输出目录]`（默认 `content-csv/`，**已 gitignore** ⇒ 它是给你改的工作件）。
 * 改完**说一声**，我按 id 回写 `packages/data/src/skillTreePositions.ts`（没改的节点不写 ⇒ 继续走算法自动排），
 * 再跑 `npm run skilltree:layout-check`（不越界 / 同行不重叠 / 子在前置正下方）把冲突点出来。
 *
 * ⚠ **坐标来源 = 页面用的那同一份算法**（`apps/desktop/src/renderer/src/ui/skillTreeLayout.ts`）＋ 现有覆盖表
 *   ⇒ 表里的数就是**你现在页面上看到的位置**，不是另算一套。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-09-22 · 最后跑过 2026-09-22
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { SKILLS, SKILL_BRANCHES, SKILL_TREE_POSITIONS } from '@whale/data'
import {
  CELL_H,
  CELL_W,
  ORIGIN_X,
  ORIGIN_Y,
  layoutBook,
} from '../apps/desktop/src/renderer/src/ui/skillTreeLayout'

const outDir = process.argv[2] ?? 'content-csv'
mkdirSync(outDir, { recursive: true })

const branchName = new Map(SKILL_BRANCHES.map((b) => [b.id, b]))
const skillById = new Map(SKILLS.map((s) => [s.id, s]))

/** 每个节点的最终坐标（与页面同源：算法 ＋ 覆盖表） */
type Row = {
  seq: number
  id: string
  name: string
  branch: string
  group: string
  rank: number
  col: number
  row: number
  x: number
  y: number
  prereq: string
  chain: number
}
const rows: Row[] = []
let seq = 0
for (const br of SKILL_BRANCHES) {
  const defs = SKILLS.filter((s) => s.branch === br.id)
  const lay = layoutBook(br.id, defs, SKILL_TREE_POSITIONS)
  /** 链长 = 该节点所在连通片的节点数（≥2 = 有连线；1 = 孤立点） */
  const linked = new Set<string>()
  for (const e of lay.edges) linked.add(`${e.x1},${e.y1}`)
  const sizeOf = new Map<string, number>()
  for (const n of lay.nodes) {
    const key = `${n.x},${n.y}`
    sizeOf.set(n.def.id, linked.has(key) ? 2 : 1)
  }
  for (const n of lay.nodes) {
    seq += 1
    const ov = SKILL_TREE_POSITIONS[n.def.id]
    rows.push({
      seq,
      id: n.def.id,
      name: n.def.name,
      branch: br.id,
      group: br.group,
      rank: n.def.rank,
      /** 反推格位（读数）：`ORIGIN` 起、每格 116 × 102；覆盖过的坐标也照算，便于你判断挪了多少 */
      col: Math.round((n.x - ORIGIN_X) / CELL_W),
      row: Math.round((n.y - ORIGIN_Y) / CELL_H),
      x: n.x,
      y: n.y,
      prereq: (n.def.prereq ?? []).map((p) => skillById.get(p)?.name ?? p).join('、') || '（根）',
      chain: sizeOf.get(n.def.id) ?? 1,
      // 覆盖表命中标记放在备注列（读数）
      ...(ov ? { note: '已手调' } : {}),
    })
  }
}

type Sheet = { name: string; head: string[]; data: Array<Array<string | number>>; wide: number[] }

const coordSheet: Sheet = {
  name: '技能节点坐标',
  head: ['序号', '技能 id（只读）', '名称', '技能书', '大类', 'rank', '行（读数）', '列（读数）', 'x（可改）', 'y（可改）', '前置（读数）', '链（读数）', '备注'],
  data: rows.map((r) => [
    r.seq,
    r.id,
    r.name,
    branchName.get(r.branch)?.id === undefined ? r.branch : r.branch,
    r.group,
    r.rank,
    r.row,
    r.col,
    r.x,
    r.y,
    r.prereq,
    r.chain,
    (r as { note?: string }).note ?? '',
  ]),
  wide: [0, 30, 18, 14, 10, 6, 10, 10, 10, 10, 30, 8, 10],
}

const helpSheet: Sheet = {
  name: '说明',
  head: ['项', '内容'],
  data: [
    ['本表是什么', '技能测试页（导航「技能测试」）上每一格节点的坐标——82 个技能逐行列出，坐标与页面同源（同一份排布算法）。'],
    ['只改哪两列', '**只改 `x（可改）` 与 `y（可改）`**（整数，单位 = 像素）。其余列都是读数：`行/列` 由坐标反推、`前置/链` 是关系读数。'],
    ['空单元格', '**留空 = 该节点不动**（继续走算法自动排）。只想挪几个就只填那几个。'],
    ['坐标系', '**每本技能书自己的局部坐标系**（原点 = 该图左上角）⇒ 同一个坐标在不同书里位置不同，不要跨书搬。'],
    ['网格参考', `一格 = ${CELL_W} × ${CELL_H} 像素；第 0 行/列的格子中心 = (${ORIGIN_X}, ${ORIGIN_Y}) ⇒ 第 n 列中心 x = ${ORIGIN_X} + ${CELL_W}×n，第 m 行中心 y = ${ORIGIN_Y} + ${CELL_H}×m。想"对齐成网格"就照这个填；想错开半格就填中间值。`],
    ['改完怎么办', '说一声即可：我按 id 回写 `packages/data/src/skillTreePositions.ts`（只写你改过的那几个），再跑 `npm run skilltree:layout-check` 把"越界 / 同行重叠 / 子没落在前置正下方"点出来给你看。'],
    ['重新生成', '`npm run skilltree:export` —— 会覆盖本文件；你手上的改动请先发我或先说一声。'],
    ['为什么要逐本', '每本技能书是一张独立小图（`viewBox` 各自一份）⇒ 「全部」档里几本书是并排画的，各自用自己那套坐标。'],
  ],
  wide: [16, 120],
}

const SHEETS: Sheet[] = [coordSheet, helpSheet]

function esc(v: unknown): string {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s
}

/** 写盘 + 读回自检（`tsx` 下 tools 走 CJS ⇒ 不能用顶层 await，故包一层 `main()`） */
async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const skipped: string[] = []
  for (const sh of SHEETS) {
    const ws = wb.addWorksheet(sh.name)
    ws.columns = sh.head.map((h, i) => ({ width: sh.wide[i] || Math.max(10, h.length * 1.8 + 4) }))
    const head = ws.addRow(sh.head)
    head.font = { bold: true }
    for (const r of sh.data) ws.addRow(r)
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    try {
      writeFileSync(
        join(outDir, `skilltree-${sh.name}.csv`),
        '\uFEFF' + [sh.head, ...sh.data].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n',
        'utf8',
      )
    } catch {
      skipped.push(`skilltree-${sh.name}.csv`)
    }
  }
  const xlsxPath = join(outDir, 'skilltree-workbench.xlsx')
  await wb.xlsx.writeFile(xlsxPath)

  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(xlsxPath)
  console.log(`✅ 已写 ${xlsxPath}`)
  for (const ws of back.worksheets) console.log(`   · 表「${ws.name}」：${Math.max(0, ws.rowCount - 1)} 行 × ${ws.columnCount} 列`)
  console.log(
    skipped.length === 0
      ? `✅ 同时写了 CSV（UTF-8 + BOM）：${SHEETS.map((s) => `skilltree-${s.name}.csv`).join(' · ')}`
      : `⚠ 这几张 CSV 没写成（多半正被 Excel/WPS 打开）：${skipped.join(' · ')}（xlsx 已更新 ✓）`,
  )
  console.log(`\n改完说一声：我按 id 回写坐标覆盖表，并跑 layout-check 体检。`)
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
