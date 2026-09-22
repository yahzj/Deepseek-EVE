/**
 * **新手任务文案工作台 · 导出**（2026-09-21 船长令：「**将任务文本输出到excel表，我打算进行修改**」）。
 *
 * 干什么：把「第一次」任务链路上**玩家可见的全部文案**导出成一份原生 Excel（一张工作簿五张表）
 * ＋ 每表一份 UTF-8(BOM) CSV：
 *   - `第一次任务`：13 条的 **标题 / 一句话（brief）/ 正文（detail）/ 奖励行 / 链名 / 计数口径**；
 *   - `第一次情报信`：13 封通讯的 **主题 / 正文各行 / 前往提示 / 前往页签**；
 *   - `里程碑链`：13 条链的 **链名 / 计数口径 / 各档阈值**；
 *   - `本轮新文案`：**上一次导出之后新增/改写的玩家可见文案**（日志 / 提示 / 报错 / 按钮门槛这类不在上面
 *     三张表里的字；**值直接读 `L10N` 与 core 常量 ⇒ 永远与代码一致**，只有"落点/备注"两列是手写的）；
 *   - `说明`：编辑约定（照抄内容工作台那套：**首列 id 只读 · 空单元格 = 不改 · 可选字段填 `-` = 删除**）。
 *
 * 用法：`npm run tasks:export [输出目录]`（默认 `content-csv/`，**已 gitignore** ⇒ 它是给你改的工作件，
 * 不是仓库内容；改完发回来我按 id 回写 `core/src/firstTasks.ts` 与 `data/src/firstTaskMessages.ts`，
 * 并同步中英表 `data/src/l10n/table.ts`）。
 *
 * ⚠ **它是导出侧的单点，不反向写仓库**：仓库里既有的内容工作台（`content:export` / `content:import`）
 * 只覆盖 7 张内容表（skills/items/modules/ships/anomalies/belts/market），**任务文本不在其中** ⇒
 * 本工具先把"要改的东西"摆到表里；等你这轮改完，回写那一步我按实际改动做（届时再决定要不要给
 * `content:import` 加一张 `firstTasks` 表）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v31** · 最后核对 2026-09-22 · 最后跑过 2026-09-22
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { buildSimContext, L10N } from '@whale/data'
import { CHAIN_TIERS, FIRST_TASKS } from '../packages/core/src/firstTasks'
import { HALT_COST, KIND_LABEL } from '../packages/core/src/activityGate'
import { FIRST_TASK_MESSAGES } from '../packages/data/src/firstTaskMessages'

const outDir = process.argv[2] ?? 'content-csv'
mkdirSync(outDir, { recursive: true })
const ctx = buildSimContext()

/** 链计数口径（与 `panels/MilestoneTasks.tsx` 的 CHAIN_UNITS 同源；改那边记得改这里） */
const CHAIN_UNITS: Readonly<Record<string, string>> = {
  scan: '星系',
  mineUnits: '单位',
  salvageRuns: '次',
  bountyWins: '场',
  repairs: '次',
  refineBatches: '批',
  produceUnits: '件',
  marketIncome: '信用点',
  ships: '艘',
  skills: '级',
  aiAssigns: '次',
  haulTrips: '趟',
  wormholeRuns: '趟',
}

/** 奖励行文案（与任务卡的拼法同源：名字取自内容表，缺表则回落 id） */
function rewardText(def: (typeof FIRST_TASKS)[number]): string {
  const r = def.reward
  if (!r) return '（无实物奖励）'
  const parts: string[] = []
  for (const m of r.modules ?? []) parts.push(`${ctx.modules.get(m.moduleId)?.name ?? m.moduleId} ×${m.units}`)
  for (const w of r.ware ?? []) parts.push(`${ctx.items.get(w.itemId)?.name ?? w.itemId} ×${w.units}`)
  for (const b of r.blueprints ?? []) {
    const nm = ctx.blueprints.get(b.blueprintId)?.name ?? ctx.shipBlueprints.get(b.blueprintId)?.name
    parts.push(`${nm ?? b.blueprintId} ×${b.units}`)
  }
  for (const s of r.ships ?? []) parts.push(`${ctx.ships.get(s.defId)?.name ?? s.defId} ×${s.units}`)
  for (const c of r.aiCores ?? []) parts.push(`基础 AI 核心 ×${c.units}`)
  if (r.wormholeStock) parts.push(`未探索虫洞 ×${r.wormholeStock}`)
  if (r.isk) parts.push(`${r.isk.toLocaleString('zh-CN')} 信用点`)
  return parts.join('、') || '（无实物奖励）'
}

/** **起手道具**一行（任务开始时给的东西；与奖励行分开写——2026-09-21 船长令新增的功能） */
function startText(def: (typeof FIRST_TASKS)[number]): string {
  const r = def.startReward
  if (!r) return '（无）'
  const parts: string[] = []
  for (const m of r.modules ?? []) parts.push(`${ctx.modules.get(m.moduleId)?.name ?? m.moduleId} ×${m.units}`)
  for (const w of r.ware ?? []) parts.push(`${ctx.items.get(w.itemId)?.name ?? w.itemId} ×${w.units}`)
  for (const b of r.blueprints ?? []) {
    const nm = ctx.blueprints.get(b.blueprintId)?.name ?? ctx.shipBlueprints.get(b.blueprintId)?.name
    parts.push(`${nm ?? b.blueprintId} ×${b.units}`)
  }
  for (const s of r.ships ?? []) parts.push(`${ctx.ships.get(s.defId)?.name ?? s.defId} ×${s.units}`)
  for (const c of r.aiCores ?? []) parts.push(`基础 AI 核心 ×${c.units}`)
  if (r.wormholeStock) parts.push(`未探索虫洞 ×${r.wormholeStock}`)
  if (r.isk) parts.push(`${r.isk.toLocaleString('zh-CN')} 信用点`)
  return parts.join('、') || '（无）'
}

type Sheet = { name: string; head: string[]; rows: Array<Array<string | number>>; wide: number[] }

const taskSheet: Sheet = {
  name: '第一次任务',
  head: ['序号', 'id（只读）', '标题', '一句话（brief）', '正文（detail）', '奖励行', '开始即给', '链名', '计数口径'],
  rows: FIRST_TASKS.map((d, i) => [
    i + 1,
    d.id,
    d.title,
    d.brief,
    d.detail,
    rewardText(d),
    startText(d),
    d.chain?.name ?? '—',
    d.chain ? (CHAIN_UNITS[d.chain.stat] ?? d.chain.stat) : '—',
  ]),
  wide: [0, 0, 18, 24, 90, 30, 26, 14, 10],
}

const mailSheet: Sheet = {
  name: '第一次情报信',
  head: ['序号', '任务 id（只读）', '主题', '正文 1', '正文 2', '正文 3', '前往提示', '前往页'],
  rows: FIRST_TASKS.map((d, i) => {
    const m = FIRST_TASK_MESSAGES.find((x) => x.trigger.kind === 'firstTask' && x.trigger.taskId === d.id)
    const body = m?.body ?? []
    return [i + 1, d.id, m?.subject ?? '（缺）', body[0] ?? '', body[1] ?? '', body[2] ?? '', m?.hint?.text ?? '', m?.hint?.page ?? '']
  }),
  wide: [0, 0, 22, 60, 60, 60, 30, 10],
}

const chainSheet: Sheet = {
  name: '里程碑链',
  head: ['序号', '链 id（只读）', '链名', '计数口径', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'],
  rows: FIRST_TASKS.filter((d) => d.chain).map((d, i) => {
    const c = d.chain!
    const tiers = (CHAIN_TIERS as Record<string, readonly number[]>)[c.tierKey] ?? []
    return [i + 1, c.id, c.name, CHAIN_UNITS[c.stat] ?? c.stat, ...Array.from({ length: 10 }, (_, k) => tiers[k] ?? '')]
  }),
  wide: [0, 0, 14, 10, ...Array.from({ length: 10 }, () => 12)],
}

/**
 * **本轮新文案**（2026-09-22 船长令：「**新建的任务文本同步到 excel 我再看看**」）——
 * 上面三张表只管「第一次」任务链本身；**建站交付、活动切换、报错与日志这类不在表里的新字**没地方过目
 * ⇒ 单开一张：**中文 / English 两列直接读码**（`L10N` 词条或 core 常量，绝不手抄 ⇒ 不会与代码漂移），
 * 只有「落点」「备注」是手写的。
 *
 * ⚠ **维护约定**：每次导出前，把"自上次导出以来新写/改写的玩家可见文案"补进下面这张清单（一行一条）；
 * 清单会一直累积展示，方便你回头比对——看完觉得哪条要改，按 id 说一声即可（大多是一句话改一处）。
 */
const RECENT_TEXTS: Array<{ id: string; kind: string; where: string; note: string }> = [
  {
    id: 'core.onboarding.001',
    kind: '改写',
    where: 'core/src/onboarding.ts（「寻找人类」发布日志）',
    note: '2026-09-22 船长裁定 1甲：发布点在前 11 条之后，旧文案是"刚落地"口吻',
  },
  {
    id: 'core.ai.008',
    kind: '改写',
    where: 'core/src/ai.ts（给副船派打捞被拒）',
    note: '2026-09-22 船长裁定 5甲：补「装配」页指路（主控那条早有）',
  },
  {
    id: 'ui.Expedition.345',
    kind: '改写',
    where: 'renderer panels/Expedition.tsx（建站交付按钮置灰的理由）',
    note: '2026-09-22 建站交付批：旧文案列的是已删掉的忙态名单',
  },
  {
    id: 'core.location.020',
    kind: '改写',
    where: 'core/src/location.ts（货仓没空位，发不了交付）',
    note: '2026-09-22 建站交付批：补「物品页『全部卸入仓库』」指路',
  },
  {
    id: 'activityGate.KIND_LABEL.siteDeliver',
    kind: '新增（core 常量）',
    where: 'core/src/activityGate.ts（统一自动停机日志的活动名）',
    note: '2026-09-22 建站交付批：写进「已自动停止「…」」那条日志',
  },
  {
    id: 'activityGate.HALT_COST.siteDeliver',
    kind: '新增（core 常量）',
    where: 'core/src/activityGate.ts（同上，停机代价那半句）',
    note: '⚠ 这两条是 core 中文字面量（未接 id）⇒ 英文界面下这半句仍显示中文',
  },
]

const recentSheet: Sheet = {
  name: '本轮新文案',
  head: ['序号', 'id / 常量（只读）', '类型', '中文', 'English', '落点', '备注'],
  rows: RECENT_TEXTS.map((r, i) => {
    const entry = (L10N as Record<string, { zh: string; en: string } | undefined>)[r.id]
    /** core 常量那两条不在 `L10N` 里 ⇒ 直接读常量（值与代码同源） */
    const constZh =
      r.id === 'activityGate.KIND_LABEL.siteDeliver'
        ? KIND_LABEL.siteDeliver
        : r.id === 'activityGate.HALT_COST.siteDeliver'
          ? HALT_COST.siteDeliver
          : undefined
    return [
      i + 1,
      r.id,
      r.kind,
      entry?.zh ?? constZh ?? '（未找到：id 是否写错？）',
      entry?.en ?? (constZh !== undefined ? '（未接 id：英文界面下仍显示中文）' : '（未找到）'),
      r.where,
      r.note,
    ]
  }),
  wide: [0, 32, 16, 70, 70, 40, 46],
}

const helpSheet: Sheet = {
  name: '说明',
  head: ['项', '内容'],
  rows: [
    ['本表是什么', '「第一次」任务链路（13 条任务 ＋ 13 封情报信 ＋ 13 条里程碑链）的玩家可见文案，导出给你直接改。'],
    ['谁来改', '你。改完把这份 xlsx（或对应的 csv）发回来，我按 id 回写到 core/src/firstTasks.ts 与 data/src/firstTaskMessages.ts，并同步中英表 data/src/l10n/table.ts。'],
    ['id 列', '只读：它是回写的锚（任务 id / 链 id），不要改、不要删行、不要加行。'],
    ['改文案', '直接改单元格。**空单元格 = 不改这个字段**（与内容工作台同一套约定）。'],
    ['正文行数', '情报信的正文现在最多 3 行：**留空一行 = 该行不要**；要加第 4 行请单独说一声（要改代码结构）。'],
    ['奖励行 / 计数口径', '这两列是**读数**（由奖励表与链阈值表算出来），改它不会生效——要改奖励/阈值请单独提。'],
    ['重新生成', 'npm run tasks:export —— 会覆盖本文件；你手上的改动请先发我。'],
    [
      '「本轮新文案」表',
      '上面三张表只管"第一次"任务链；这张表列的是**上一次导出之后新写/改写的玩家可见文案**（建站交付、活动切换、报错与日志这类）。中英两列直读代码，落点与备注是手写的；要改哪条按 id 说一声即可。',
    ],
  ],
  wide: [16, 120],
}

const SHEETS: Sheet[] = [taskSheet, mailSheet, chainSheet, recentSheet, helpSheet]

function esc(v: unknown): string {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s
}

/**
 * 写盘 + 读回自检（`tsx` 下 tools 走 CJS ⇒ **不能用顶层 await**，故包一层 `main()`）。
 * 读回 = 真开一遍刚写的文件，防止"写了个打不开的 xlsx"。
 */
async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook()
  /** 被占用而没写成的 CSV（末尾一起报） */
  const skipped: string[] = []
  for (const sh of SHEETS) {
    const ws = wb.addWorksheet(sh.name)
    ws.columns = sh.head.map((h, i) => ({ width: sh.wide[i] || Math.max(10, h.length * 1.8 + 4) }))
    const headRow = ws.addRow(sh.head)
    headRow.font = { bold: true }
    for (const r of sh.rows) {
      const row = ws.addRow(r)
      // 长文本列（正文/说明）开自动换行 + 顶端对齐，免得一格撑出天际
      row.eachCell((cell, col) => {
        if (sh.wide[col - 1] >= 50) {
          cell.alignment = { wrapText: true, vertical: 'top' }
        }
      })
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    /**
     * CSV 是**附带格式**：船长正在 Excel/WPS 里开着某张 CSV 时会锁文件（`EBUSY`）——
     * 那种情况**不该把整次导出弄挂**（xlsx 才是主交付）⇒ 逐张 best-effort，失败的记下来最后一起报。
     */
    try {
      writeFileSync(
        join(outDir, `tasks-${sh.name}.csv`),
        '\uFEFF' + [sh.head, ...sh.rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n',
        'utf8',
      )
    } catch {
      skipped.push(`tasks-${sh.name}.csv`)
    }
  }
  const xlsxPath = join(outDir, 'tasks-workbench.xlsx')
  await wb.xlsx.writeFile(xlsxPath)

  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(xlsxPath)
  console.log(`✅ 已写 ${xlsxPath}`)
  for (const ws of back.worksheets) console.log(`   · 表「${ws.name}」：${Math.max(0, ws.rowCount - 1)} 行 × ${ws.columnCount} 列`)
  if (skipped.length === 0) {
    console.log(`✅ 同时写了 CSV（UTF-8 + BOM，Excel/WPS 可直接开）：${SHEETS.map((s) => `tasks-${s.name}.csv`).join(' · ')}`)
  } else {
    console.log(`⚠ 这几张 CSV 没写成（多半是正被 Excel/WPS 打开 ⇒ 关掉再跑一次即可）：${skipped.join(' · ')}`)
    console.log('   （xlsx 已更新 ✓，不受影响）')
  }
  console.log(`\n改完把 ${xlsxPath} 发回来即可（id 列只读；空单元格 = 不改）。`)
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
