/**
 * **入侵补偿批：查档 · 演算 · 发放**（**船长 2026-10-02 令**：「**……并准备对应的工具。**」）
 *
 * 背景与口径（**同一批的唯一权威 = `packages/core/src/weekendCompensation.ts`**；归档见
 * `docs/glossary.md`「入侵补偿批」词条 ＋ `docs/roadmap.md` 2026-10-02 条）：
 * - **受影响档**（"这一期还是墨潮帮"）⇒ **下周三 20:00 起**开一场**光环科技**补场（只一场、打完即止、
 *   到下一期 T0 自然收场）；
 * - **其余档**（含新档）⇒ 入仓 **1 枚信号发射器** ＋ 一条系统日志。
 *
 * ## 三个模式
 * - `--inspect <存档>`（**只读**）：打印判定读数 —— 手上那场 / 留档快照 / 判成哪条路 / 标记现状 /
 *   补场窗口此刻开不开 / 仓库里信号发射器几枚；
 * - `--grant <存档> [--out <新路径> | --in-place]`（**会写盘**）：对**玩家导出的存档文件**执行同一套
 *   判定与发放（GM 手工用；游戏内那条路是自动的，见 `engine.pumpWeekendAt`）。
 *   默认**另写新文件** `<存档>.compensated.json`，不动原档；`--in-place` 才写回，且先备份到
 *   `<存档>.<stamp>.bak.json`；
 * - 不带参数：扫 `docs/test-saves/*.json` 与默认真档（`%APPDATA%\whale-idle\save.json`，若在）
 *   出**一行一份**的读数（只读）。
 *
 * 通用参数：`--now <ISO 或 ms>` 覆盖"现在"（演算补场窗口用；默认 `Date.now()`）。
 *
 * 用法：
 *   npx tsx tools/weekend-compensation.ts                       # 扫 test-saves 与真档
 *   npx tsx tools/weekend-compensation.ts --inspect 某档.json
 *   npx tsx tools/weekend-compensation.ts --inspect 某档.json --now 2026-10-07T20:30:00+08:00
 *   npx tsx tools/weekend-compensation.ts --grant 某档.json --out 某档.补偿后.json
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GameState } from '@whale/core'
import { loadSaveFile, serializeSaveFile } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { INVASION_BEACON_ITEM_ID } from '../packages/core/src/consumables'
import {
  WEEKEND_COMPENSATION_T0_WALL_MS,
  WEEKEND_MAKEUP_FAMILY,
  WEEKEND_MAKEUP_FIRST_END_WALL_MS,
  WEEKEND_MAKEUP_FIRST_WALL_MS,
  applyWeekendCompensation,
  openWeekendMakeupIfDue,
  weekendCompensationGotRThisPeriod,
  weekendCompensationTrackOf,
  weekendMakeupWindowOf,
} from '../packages/core/src/weekendCompensation'

const ctx = buildSimContext()

const argv = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name: string): boolean => argv.includes(name)

/** `--now` 覆盖（认 ISO 与毫秒） */
const nowWallMs = ((): number => {
  const raw = argOf('--now')
  if (raw === undefined) return Date.now()
  const asNum = Number(raw)
  const ms = Number.isFinite(asNum) && raw.trim() !== '' ? asNum : Date.parse(raw)
  if (!Number.isFinite(ms)) {
    console.error(`❌ --now 读不出时刻：${raw}`)
    process.exit(1)
  }
  return ms
})()

/** 本地墙钟写法（人读） */
const at = (ms: number | undefined): string => {
  if (ms === undefined) return '—'
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]!
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}（${wd}）`
}

const trackText = (t: 'makeup' | 'beacon'): string =>
  t === 'makeup'
    ? `**受影响**：下周三年 20:00 起开一场${WEEKEND_MAKEUP_FAMILY}（光环科技）补场`
    : '**其余玩家**：入仓 1 枚信号发射器'

function readState(path: string): GameState {
  const text = readFileSync(path, 'utf8')
  return loadSaveFile(text).state
}

/** 一行式读数（扫档用） */
function inspectLine(path: string): void {
  let state: GameState
  try {
    state = readState(path)
  } catch (e) {
    console.log(`  ${path}\n    ⚠ 读不了（${(e as Error).message}）`)
    return
  }
  const ev = state.weekendEvent
  const snap = state.weekendLastResult
  const track = weekendCompensationTrackOf(state)
  const comp = state.weekendCompensation
  const win = weekendMakeupWindowOf(nowWallMs)
  console.log(`  ${path}`)
  console.log(
    `    手上那场：${ev === undefined ? '无' : `${ev.family} · T0 ${at(ev.startedAtWallMs)} · ${ev.endedAtWallMs === undefined ? '**未结束**' : `结束 ${at(ev.endedAtWallMs)}`}`}`,
  )
  console.log(
    `    留档快照：${snap === undefined ? '无' : `${snap.family} · 结束 ${at(snap.endedAtWallMs)}`} · 仓库信号发射器 ${state.warehouse.items[INVASION_BEACON_ITEM_ID] ?? 0} 枚`,
  )
  console.log(
    `    判定：${trackText(track)} · 标记：${comp === undefined ? '未判定' : `${comp.track}（判于 ${at(comp.decidedAtWallMs)}${comp.beaconGrantedAtWallMs !== undefined ? ` · 已发 ${at(comp.beaconGrantedAtWallMs)}` : ''}${comp.makeupServedAtWallMs !== undefined ? ` · 补场已开 ${at(comp.makeupServedAtWallMs)}` : ''}${comp.makeupSkippedAtWallMs !== undefined ? ` · 已跳过补场（乙）${at(comp.makeupSkippedAtWallMs)}` : ''}）`}`,
  )
  console.log(
    `    乙判据：本期（10-02 20:00 ~ 10-07 20:00）已出过光环 = ${weekendCompensationGotRThisPeriod(state) ? '**是**（有补场也不开、改发信号发射器）' : '否'}`,
  )
  console.log(
    `    补场窗口：现在（${at(nowWallMs)}）${win.open ? '**在暗期内**' : '不在暗期内'} · 本暗期 ${at(win.startWallMs)} ~ ${at(win.endWallMs)}`,
  )
}

/** 详细读数（`--inspect`） */
function inspect(path: string): void {
  if (!existsSync(path)) {
    console.error(`❌ 找不到存档：${path}`)
    process.exit(1)
  }
  console.log('═══ 入侵补偿批 · 查档（只读） ═══')
  console.log(`存档：${path}`)
  console.log(`现在：${at(nowWallMs)}`)
  console.log('')
  console.log(`判据锚（上一期 T0）：${at(WEEKEND_COMPENSATION_T0_WALL_MS)}`)
  console.log(`补场首场暗期　　　：${at(WEEKEND_MAKEUP_FIRST_WALL_MS)} ~ ${at(WEEKEND_MAKEUP_FIRST_END_WALL_MS)}`)
  console.log(`补场族　　　　　　：${WEEKEND_MAKEUP_FAMILY}（光环科技）`)
  console.log('')
  inspectLine(path)
}

/** 真发放（`--grant`）：与引擎同一条路（判定 → 发道具 / 开补场），再写盘 */
function grant(path: string): void {
  if (!existsSync(path)) {
    console.error(`❌ 找不到存档：${path}`)
    process.exit(1)
  }
  const text = readFileSync(path, 'utf8')
  const { state } = loadSaveFile(text)
  console.log('═══ 入侵补偿批 · 发放 ═══')
  console.log(`存档：${path}`)
  console.log(`现在：${at(nowWallMs)}`)
  const before = {
    beacon: state.warehouse.items[INVASION_BEACON_ITEM_ID] ?? 0,
    comp: state.weekendCompensation === undefined ? '未判定' : JSON.stringify(state.weekendCompensation),
    fam: state.weekendEvent?.family ?? '无场',
  }
  const decided = applyWeekendCompensation(state, nowWallMs)
  const served = openWeekendMakeupIfDue(state, ctx, nowWallMs)
  const after = {
    beacon: state.warehouse.items[INVASION_BEACON_ITEM_ID] ?? 0,
    comp: state.weekendCompensation === undefined ? '未判定' : JSON.stringify(state.weekendCompensation),
    fam: state.weekendEvent?.family ?? '无场',
  }
  console.log('')
  console.log(`判定/发放：${decided ? '本次有落地' : '本次无动作（已判过 / 还没到判定起点）'}`)
  console.log(`补场　　　：${served ? '**本次开出了一场补场**' : '本次未开（未判成 makeup / 不在暗期 / 手上还有场）'}`)
  console.log(`信号发射器：${before.beacon} → ${after.beacon}`)
  console.log(`补偿标记　：${before.comp}\n          → ${after.comp}`)
  console.log(`本场族　　：${before.fam} → ${after.fam}`)
  if (!decided && !served) {
    console.log('\nℹ 没有变化 ⇒ **不写盘**（保持原档一字不动）。')
    return
  }
  const out = argOf('--out') ?? (has('--in-place') ? path : `${path}.compensated.json`)
  if (has('--in-place')) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const bak = `${path}.${stamp}.bak.json`
    copyFileSync(path, bak)
    console.log(`\n⚠ --in-place：已先备份到 ${bak}`)
  }
  writeFileSync(out, serializeSaveFile(state, nowWallMs), 'utf8')
  console.log(`\n✅ 已写出：${out}`)
  console.log('   ⚠ 若这份档是**正在玩的真档**：先关游戏再覆盖，否则下一次自动保存会把本次改写盖掉。')
}

/* ── 入口 ── */
const target = argOf('--inspect') ?? argOf('--grant')
if (has('--help') || has('-h')) {
  console.log(
    [
      '入侵补偿批工具（船长 2026-10-02 令）',
      '  --inspect <存档>               只读：出判定读数',
      '  --grant <存档> [--out <路径>]  执行发放（默认另写 <存档>.compensated.json）',
      '  --grant <存档> --in-place      写回原档（先备份）',
      '  --now <ISO|ms>                 覆盖"现在"（演算用）',
      '  不带参数                        扫 docs/test-saves 与默认真档',
    ].join('\n'),
  )
} else if (target !== undefined && has('--grant')) {
  grant(target)
} else if (target !== undefined) {
  inspect(target)
} else {
  console.log(`═══ 入侵补偿批 · 扫档读数（只读 · 现在 ${at(nowWallMs)}）═══`)
  const dir = join(process.cwd(), 'docs', 'test-saves')
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)) : []
  const real = join(process.env.APPDATA ?? '', 'whale-idle', 'save.json')
  if (existsSync(real)) files.push(real)
  if (files.length === 0) console.log('  （没找到任何存档：docs/test-saves 为空、默认真档也不在）')
  for (const f of files) inspectLine(f)
}
