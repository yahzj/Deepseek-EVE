/**
 * **通讯文案工作台 · 导出**（**2026-10-01 船长令**：「**你将所有通讯的标题，内容，和跳转输出到 excel
 * 我挨个编辑，之前已经有过相关工具**」——"之前那个"= `tools/tasks-export.ts`，本工具照它那套写）。
 *
 * 干什么：把**全部进入收件箱的通讯**导出成一份原生 Excel（一张工作簿三张表）＋ 每表一份 UTF-8(BOM) CSV：
 *   - `通讯一览`：46 条**表消息**（数据消息 33 ＋「第一次」情报信 13）的
 *     **主题 / 正文（整篇，段与段之间空一行） / 前往提示 / 前往页 / 前往页签**，
 *     外加三列**读数**（段数 · 染色段号 · 英文覆盖）与两张来源/触发读数列；
 *   - `剧本对白`：4 份**剧本**（收件箱里的对白镜像）的 **剧名 / 主题 / 逐行发言人与台词**；
 *   - `说明`：编辑约定（照抄内容工作台与 `tasks-export` 那套：**首列 id 只读 · 空单元格 = 不改 ·
 *     要删的字段填 `-`**）＋ 前往页的取值域 ＋ 交付方式。
 *
 * 用法：`npm run comms:export [输出目录]`（默认 `content-csv/`，**已 gitignore** ⇒ 它是给你改的工作件，
 * 不是仓库内容）。改完把 xlsx 发回来，我按 id 回写：
 *   表消息 ⇒ `packages/data/src/messages.ts` · `packages/data/src/firstTaskMessages.ts`
 *   ＋ 英文表 `apps/desktop/src/renderer/src/ui/commsText.ts`（`COMMS_SUBJECT_ID` / `COMMS_BODY_EN`）；
 *   剧本 ⇒ `packages/data/src/dialogues.ts`。
 *
 * ⚠ **它是导出侧的单点，不反向写仓库**（与 `tasks-export` 同一口径）：既有的内容工作台
 * （`content:export` / `content:import`）只覆盖内容表（skills/items/modules/ships/…），**通讯不在其中**。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 首次落码 2026-10-01
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { buildSimContext } from '@whale/data'
import { COMMS_MESSAGES } from '../packages/data/src/messages'
import { FIRST_TASK_MESSAGES } from '../packages/data/src/firstTaskMessages'
import { DIALOGUES } from '../packages/data/src/dialogues'
import { FIRST_TASKS } from '../packages/core/src/firstTasks'
import { weekendFamilyNameZh } from '../packages/core/src/weekendEvent'

const outDir = process.argv[2] ?? 'content-csv'
mkdirSync(outDir, { recursive: true })
const ctx = buildSimContext()

/* ───────── 读数：英文覆盖（文本层探针，如实标注口径） ───────── */

/**
 * `commsText.ts` 里两张英文表（`COMMS_SUBJECT_ID` / `COMMS_BODY_EN`）**在渲染层**（依赖 i18n 运行时），
 * 工具里 import 不动 ⇒ 这里按**文本层**取块查键，只作"有没有英译"的读数用（**不参与回写**）。
 */
const commsTextSrc = readFileSync(
  join(process.cwd(), 'apps/desktop/src/renderer/src/ui/commsText.ts'),
  'utf8',
)
function tableBlock(decl: string): string {
  const i = commsTextSrc.indexOf(decl)
  if (i < 0) return ''
  const j = commsTextSrc.indexOf('\nconst ', i + decl.length)
  return commsTextSrc.slice(i, j < 0 ? undefined : j)
}
const SUBJECT_EN_BLOCK = tableBlock('const COMMS_SUBJECT_ID: Record<string, string> = {')
const BODY_EN_BLOCK = tableBlock('const COMMS_BODY_EN: Record<string, readonly string[]> = {')
const hasEn = (block: string, id: string): boolean => block.includes(`'${id}':`)

/* ───────── 读数：发件方 / 触发时机（都从 ctx 与 trigger 现算，不手抄） ───────── */

/** 发件方写法：`势力名 · 部门名`（部门缺省 = 只写势力名；与 core `resolveCommsSender` 同口径） */
function senderOf(factionId: string, deptId?: string): string {
  const f = ctx.commsFactions.get(factionId)
  const name = f?.name ?? factionId
  if (deptId === undefined) return name
  const dept = f?.departments?.find((d) => d.id === deptId)
  return dept !== undefined ? `${name} · ${dept.name}` : name
}

/**
 * 触发时机一句话（**判据逐条照 `core/comms.ts` 的 `commsTriggerMet`**，不自己发明条件）。
 * 查不到名字的内容（技能/星系/站/敌舰）回落原文 id —— 宁可露 id，也不编一个像样的说法。
 */
function triggerText(t: (typeof COMMS_MESSAGES)[number]['trigger']): string {
  const g = (m: ReadonlyMap<string, { name: string }>, id: string): string => m.get(id)?.name ?? id
  switch (t.kind) {
    case 'start':
      return '开局（序章演出结束）'
    case 'firstTask':
      // ⚠ 箭头参数别再用 `t`（会遮蔽外层那个 trigger ⇒ 永远查不到，回落成 id；2026-10-01 首跑踩到）
      return `第一次任务「${FIRST_TASKS.find((x) => x.id === t.taskId)?.title ?? t.taskId}」完成`
    case 'labOpened':
      return '首次进入实验室页面'
    case 'day':
      return `开局满 ${t.days} 天`
    case 'explored':
      return `已探索星系达 ${t.count} 个`
    case 'galaxy':
      return `探明星系「${g(ctx.galaxies, t.galaxyId)}」`
    case 'skill':
      return `技能「${g(ctx.skills, t.skillId)}」达 ${t.level} 级`
    case 'isk':
      return `信用点达 ${t.amount.toLocaleString('zh-CN')}`
    case 'standing':
      return `${g(ctx.commsFactions, t.factionId)}累计声望达 ${t.min}`
    case 'siteBuilt':
      return `空间站「${g(ctx.stations, t.siteId)}」建成`
    case 'lowSec':
      return '首次探明低安星系'
    case 'foeFamily':
      /**
       * ⚠ **不印内部族代号**（船长两次同款报障：2026-09-24「'XX族'这类开发字眼」/ 2026-10-01
       * 「入侵的通讯应该采取更正式的名称，不应该直接用X族」）⇒ 走族名表的**唯一单点**
       * `weekendFamilyNameZh`（未知族回落「未知势力」），代号只放进括号里供你对照。
       */
      return `首次探明有「${weekendFamilyNameZh(t.family)}」（${t.family} 族）敌人的星系`
    case 'wormholeNebula':
      return '首次下到虫洞第 4 层'
    case 'wormholeSiege':
      return '首次下到虫洞第 7 层'
    case 'ambushRetreat':
      return '首次因低安袭击自动撤离'
    case 'shipBuilt':
      return '造出第一艘自造船'
    case 'foeShipSeen':
      return `首次遭遇敌舰「${t.shipId}」`
    case 'blackboxSeen':
      return '拿到第一个黑匣'
    default:
      return String((t as { kind: string }).kind)
  }
}

/** 表消息的三种"来源"标签（与回写落点一一对应） */
const SOURCE_OF = (id: string): string => (FIRST_TASK_MESSAGES.some((m) => m.id === id) ? '第一次任务' : '数据消息')

/** 跳转目标里的**内层落点**（`hint` 的四个可选字段；缺省 ⇒ `—`）——面板"前往页"之外的全部落点信息 */
function hintTargetText(h: (typeof COMMS_MESSAGES)[number]['hint']): string {
  if (h === undefined) return '—'
  const parts: string[] = []
  if (h.tab !== undefined) parts.push(`tab=${h.tab}`)
  if (h.taskTab !== undefined) parts.push(`taskTab=${h.taskTab}`)
  if (h.shipTab !== undefined) parts.push(`shipTab=${h.shipTab}`)
  if (h.action !== undefined) parts.push(`action=${h.action}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

type Sheet = { name: string; head: string[]; rows: Array<Array<string | number>>; wide: number[] }

/* ───────── 表 1：通讯一览 ───────── */

/**
 * ⚠ **不要再并 `FIRST_TASK_MESSAGES`**：`COMMS_MESSAGES` 的第一行就是 `...FIRST_TASK_MESSAGES`
 * （13 封"第一次"情报信已含在内）——并两次会让这 13 封在表里出现两遍（2026-10-01 首跑踩到）。
 * 来源列由 `SOURCE_OF` 按 id 判，不靠"从哪个数组来"。
 */
const ALL_MESSAGES = [...COMMS_MESSAGES]
const DATA_ONLY = COMMS_MESSAGES.length - FIRST_TASK_MESSAGES.length

const listSheet: Sheet = {
  name: '通讯一览',
  head: [
    '序号',
    'id（只读）',
    '来源',
    '发件方',
    '类型',
    '主题',
    '正文（整篇 · 段与段之间空一行）',
    '段数',
    '染色段号',
    '英文覆盖',
    '前往提示',
    '前往页',
    '前往页签 / 动作',
    '触发时机',
    '备注（你写）',
  ],
  rows: ALL_MESSAGES.map((m, i) => {
    const hl = m.highlight ?? []
    /** 染色段号：`highlight` 的每一条在 `body` 里的段号（1 起；查不到写 `?`） */
    const hlNo = hl.map((h) => {
      const k = m.body.indexOf(h)
      return k < 0 ? '?' : String(k + 1)
    })
    const subjEn = hasEn(SUBJECT_EN_BLOCK, m.id)
    const bodyEn = hasEn(BODY_EN_BLOCK, m.id)
    return [
      i + 1,
      m.id,
      SOURCE_OF(m.id),
      senderOf(m.factionId, m.deptId),
      m.kind,
      m.subject,
      m.body.join('\n\n'),
      m.body.length,
      hlNo.length > 0 ? hlNo.join('、') : '—',
      subjEn && bodyEn ? '主题 ✓ 正文 ✓' : subjEn ? '主题 ✓ 正文 ✗（英文界面回落中文）' : '主题 ✗ 正文 ✗（英文界面回落中文）',
      m.hint?.text ?? '—',
      m.hint?.page ?? '—',
      hintTargetText(m.hint),
      triggerText(m.trigger),
      '',
    ]
  }),
  wide: [6, 26, 12, 22, 8, 30, 96, 7, 9, 30, 34, 10, 12, 40, 24],
}

/* ───────── 表 2：剧本对白 ───────── */

type DialogueLine = { speaker: string; text: string }
const dialogueRows: Array<Array<string | number>> = []
let dSeq = 0
for (const d of DIALOGUES) {
  for (const [k, line] of (d.lines as readonly DialogueLine[]).entries()) {
    dialogueRows.push([
      ++dSeq,
      d.id,
      d.title ?? d.id,
      senderOf(d.commsFactionId ?? '', d.commsDeptId ?? undefined) + (d.commsSigner !== undefined ? ` · ${d.commsSigner}` : ''),
      d.subject ?? '（无主题）',
      k + 1,
      line.speaker,
      line.text,
      '',
    ])
  }
}

const dialogueSheet: Sheet = {
  name: '剧本对白',
  head: ['序号', '剧本 id（只读）', '剧名', '发件方', '主题', '行号', '发言人', '台词', '备注（你写）'],
  rows: dialogueRows,
  wide: [6, 24, 26, 24, 26, 6, 18, 96, 24],
}

/* ───────── 表 3：说明 ───────── */

const helpSheet: Sheet = {
  name: '说明',
  head: ['项', '内容'],
  rows: [
    ['本表是什么', '**全部通讯**的标题、正文与跳转，以及 4 份剧本的逐行台词，导出给你挨个改。'],
    [
      '覆盖范围',
      `表消息 ${ALL_MESSAGES.length} 条（协会/系统侧数据消息 ${DATA_ONLY} ＋「第一次」情报信 ${FIRST_TASK_MESSAGES.length}）＋ 剧本 ${DIALOGUES.length} 份（${dialogueRows.length} 行台词）。`,
    ],
    ['谁来改', '你。改完把 `comms-workbench.xlsx` 发回来，我按 id 回写数据表与英文表（见下"回写落点"）。'],
    ['id 列', '只读：它是回写的锚。不要改 id、不要删行、不要加行（要新增一条请单独说）。'],
    ['改文案', '直接改单元格。**空单元格 = 不改这个字段**（与内容工作台同一套约定）。'],
    [
      '要删掉某个字段',
      '填 `-`（半角减号）＝ 删除该字段（例：前往提示填 `-` ＝ 这封信不要跳转按钮；染色段号填 `-` ＝ 取消染色）。',
    ],
    [
      '正文那一格',
      '**整篇替换**语义：留空 = 不改；改了就以你写的为准。**段与段之间空一行**（一个空行 = 一段）。' +
        '要删掉某一段，就把那一段整段删掉（连同它后面那个空行）。段数会跟着变，代码侧按段数原样收。',
    ],
    ['「段数」列', '读数（只读）：当前正文有几段。你改完正文后这一列不会自动变，我回写时以你写的正文为准。'],
    ['「染色段号」列', '读数（只读）：正文里哪几段是**强调（染色）**的。要改染色：在这一列写段号（如 `2、5`），填 `-` 取消染色。'],
    ['英文覆盖列', '读数（只读）：该条在英文界面下是英文还是回落中文。标 ✗ 的，改完中文我会补英文；也想直接改英文的话说一声，我把英文也导一张表。'],
    ['前往页取值', '六档：`task`（任务中心）· `skills`（技能）· `map`（星图）· `fit`（装配）· `industry`（工业）· `ship`（舰船）。改别的值会跳空页。'],
    ['前往页签', '读数列（只读）：跳过去之后落在哪个内层标签或动作（`tab` 星图页签 / `taskTab` 任务中心内层 / `shipTab` 舰船页内层 / `action` 落地动作）。要改说一声，得同时确认那个落点存在。'],
    ['触发时机', '读数列（只读）：这封信什么时候发（判据逐条照 `core/comms.ts`）。要改触发条件请单独提，那不是文案。'],
    [
      '回写落点',
      '表消息 ⇒ `packages/data/src/messages.ts` 与 `packages/data/src/firstTaskMessages.ts`；' +
        '主题/正文英文 ⇒ `apps/desktop/src/renderer/src/ui/commsText.ts`；剧本 ⇒ `packages/data/src/dialogues.ts`。',
    ],
    ['重新生成', '`npm run comms:export` —— **会覆盖本文件**；你手上的改动请先发我。'],
  ],
  wide: [16, 120],
}

const SHEETS: Sheet[] = [listSheet, dialogueSheet, helpSheet]

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
  const skipped: string[] = []
  for (const sh of SHEETS) {
    const ws = wb.addWorksheet(sh.name)
    ws.columns = sh.head.map((h, i) => ({ width: sh.wide[i] || Math.max(10, h.length * 1.8 + 4) }))
    const headRow = ws.addRow(sh.head)
    headRow.font = { bold: true }
    for (const r of sh.rows) {
      const row = ws.addRow(r)
      // 长文本列（正文/台词/说明）开自动换行 + 顶端对齐，免得一格撑出天际
      row.eachCell((cell, col) => {
        if (sh.wide[col - 1] >= 50) cell.alignment = { wrapText: true, vertical: 'top' }
      })
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    /** CSV 是附带格式：Excel/WPS 开着某张 CSV 时会锁文件（EBUSY）——不该把整次导出弄挂（xlsx 才是主交付） */
    try {
      writeFileSync(
        join(outDir, `comms-${sh.name}.csv`),
        '\uFEFF' + [sh.head, ...sh.rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n',
        'utf8',
      )
    } catch {
      skipped.push(`comms-${sh.name}.csv`)
    }
  }
  const xlsxPath = join(outDir, 'comms-workbench.xlsx')
  await wb.xlsx.writeFile(xlsxPath)

  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(xlsxPath)
  console.log(`✅ 已写 ${xlsxPath}`)
  for (const ws of back.worksheets) console.log(`   · 表「${ws.name}」：${Math.max(0, ws.rowCount - 1)} 行 × ${ws.columnCount} 列`)
  if (skipped.length === 0) {
    console.log(`✅ 同时写了 CSV（UTF-8 + BOM，Excel/WPS 可直接开）：${SHEETS.map((s) => `comms-${s.name}.csv`).join(' · ')}`)
  } else {
    console.log(`⚠ 这几张 CSV 没写成（多半是正被 Excel/WPS 打开 ⇒ 关掉再跑一次即可）：${skipped.join(' · ')}`)
    console.log('   （xlsx 已更新 ✓，不受影响）')
  }
  console.log(`\n改完把 ${xlsxPath} 发回来即可（id 列只读；空单元格 = 不改；要删的字段填 -）。`)
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
