/**
 * **周末入侵 · 板面与进度巡检**（正式工具 · **2026-09-25 入库**）。
 *
 * 用途：读**真档**（`%APPDATA%\whale-idle\save.json`，**只读**）回答三类问题 ——
 * ① 被占星系的常驻悬赏**逐槽位替换结果**（哪个槽位换成了哪张入侵卡）；
 * ② **去重后的板面**（2026-09-25 船长裁决「甲」：同一被占星系只出一条；算式 = `weekendBoardRowsOf`）；
 * ③ **进度账**：台账 `contributed` / NPC 铺底 / 外围门禁 / **每场胜利给多少** /
 *    **活动栏（`WeekendInvasionLog`）同源读数**在连打几场后到底动没动。
 *
 * 背景（两件玩家报障 · 2026-09-25）：
 * - 「常驻悬赏里红环航道有 2 条入侵悬赏」⇒ 本工具 ①② 段给出逐槽位与去重后的对照；
 * - 「从常驻悬赏重复清缴不加进度条」⇒ ③ 段复现：外围每场 **+10%**（台账照记），
 *   但**活动栏三块读数**（外围夺回 X/3 · 核心 % · 已夺回 N/M）在单场胜利后**一个都不动**
 *   （前两块"满 100% 才 +1"、核心那格被门禁锁死）⇒ 玩家看不到自己在推进。
 *
 * 用法：`npm run weekend:board`（可用 `WEEKEND_SAVE=<路径>` 指定别的档）
 * **只读**：绝不写回存档；③ 段的模拟只在内存里改（进程退出即丢）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31（`CURRENT_STATE_VERSION`）· 最后核对 2026-09-25 · 最后跑过 2026-09-25
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import {
  loadSaveFile,
  WEEKEND_GAIN_CORE_WIN,
  WEEKEND_GAIN_PERIPHERY_WIN,
  weekendAssaultDrawOf,
  weekendBoardRowsOf,
  weekendBountyCardsOf,
  weekendCoreProgressAt,
  weekendGarrisonFoeCardId,
  weekendOccupiedLiveAt,
  weekendPeripheryAverageOf,
  weekendPeripheryClearedAt,
  weekendPeripheryLeadOf,
  weekendPlayerContribution,
  weekendProgressAt,
  weekendResolveBattle,
} from '@whale/core'
import { weekendApplyBattleOutcome } from '../packages/core/src/weekendBattle'
import type { GameState } from '@whale/core/src/state'

const SAVE = process.env.WEEKEND_SAVE ?? join(process.env.APPDATA ?? '', 'whale-idle', 'save.json')
const { state } = loadSaveFile(readFileSync(SAVE, 'utf8')) as { state: GameState }
const ctx = buildSimContext()
const now = Date.now()
const ev = state.weekendEvent

console.log(`存档：${SAVE}`)
if (!ev) {
  console.log('活动：无 weekendEvent ⇒ 不做任何替换')
  process.exit(0)
}
const systems = [ev.coreId, ...ev.peripheryIds]
console.log(
  `活动：族 ${ev.family} · 核心 ${ev.coreId} · 外围 ${ev.peripheryIds.join('/')} · ` +
    `开始 ${new Date(ev.startedAtWallMs).toISOString()} · 结束 ${ev.endedAtWallMs === undefined ? '未结束' : new Date(ev.endedAtWallMs).toISOString()}`,
)

/* ── ① 逐槽位替换 ── */
console.log('\n=== ① 逐槽位替换（未去重） ===')
let slots = 0
for (const gid of systems) {
  const name = ctx.galaxies.get(gid)?.name ?? gid
  const base = [...ctx.anomalies.values()].filter((a) => !a.hidden && a.galaxyId === gid)
  const replaced = weekendBountyCardsOf(state, ctx, base, gid, now)
  slots += base.length
  console.log(
    `  ${name}（${gid}）进度 ${(weekendProgressAt(state, ev, gid, now) * 100).toFixed(1)}% · ` +
      `活的占领区=${weekendOccupiedLiveAt(state, gid, now)} · 槽位 ${base.length} · 驻留抽签卡=${weekendGarrisonFoeCardId(state, ev, gid) ?? '（无）'}`,
  )
  base.forEach((a, i) => {
    const r = replaced[i] ?? a
    console.log(`     槽${i + 1}：${a.id}（威胁 ${a.threat}）→ ${r.id}（${r.name} · 威胁 ${r.threat} · 奖励 ${r.rewardIsk}）`)
  })
}

/* ── ② 去重后的板面（引擎同款算式） ── */
console.log('\n=== ② 去重后的板面（`weekendBoardRowsOf` 同款算式） ===')
let kept = 0
for (const gid of systems) {
  const name = ctx.galaxies.get(gid)?.name ?? gid
  const base = [...ctx.anomalies.values()].filter((a) => !a.hidden && a.galaxyId === gid)
  const rows = weekendBoardRowsOf(
    weekendBountyCardsOf(state, ctx, base, gid, now),
    (g) => weekendOccupiedLiveAt(state, g, now),
  )
  kept += rows.length
  console.log(
    `  ${name}：${base.length} 槽位 → 板面 ${rows.length} 条 = ${rows.map((r) => `${r.id}（${r.name}）`).join(' / ')}`,
  )
}
console.log(`  合计：板面 ${slots} 条 → ${kept} 条`)

/* ── ③ 进度账与"清缴之后读数动没动" ── */
console.log('\n=== ③ 进度账现状 ===')
console.log(`  台账 contributed = ${JSON.stringify(ev.contributed)}`)
console.log(
  `  玩家投入合计 ${(weekendPlayerContribution(ev) * 100).toFixed(1)}% · 外围是否清完 = ${weekendPeripheryClearedAt(state, ev, now)} · ` +
    `单价：外围胜 +${WEEKEND_GAIN_PERIPHERY_WIN * 100}% / 核心胜 +${WEEKEND_GAIN_CORE_WIN * 100}%`,
)
const banner = (): string => {
  const perTotal = ev.peripheryIds.length
  const perDone = ev.peripheryIds.filter((id) => weekendProgressAt(state, ev, id, now) >= 1).length
  const corePct = Math.round(weekendCoreProgressAt(state, ev, now) * 100)
  const occupied = [ev.coreId, ...ev.peripheryIds]
  const reclaimed = occupied.filter((id) => weekendProgressAt(state, ev, id, now) >= 1).length
  /** 2026-09-25 船长批「乙」后活动栏多的一行（随单场胜利增长的两条读数） */
  const lead = weekendPeripheryLeadOf(state, ev, now)
  const avg = Math.round(weekendPeripheryAverageOf(state, ev, now) * 100)
  const leadTxt =
    lead === null
      ? ''
      : ` · 外围平均 ${avg}% · 最高 ${Math.round(lead.progress * 100)}%（${ctx.galaxies.get(lead.galaxyId)?.name ?? lead.galaxyId}）`
  return `外围夺回 ${perDone}/${perTotal} · 核心 ${corePct}% · 已夺回 ${reclaimed}/${occupied.length} 处${leadTxt}`
}
console.log(`  活动栏读数：${banner()}`)

console.log('\n=== ③-a 核心层：每个星系连打两场"主动胜利" ===')
for (const gid of systems) {
  const name = ctx.galaxies.get(gid)?.name ?? gid
  const p0 = weekendProgressAt(state, ev, gid, now)
  const r1 = weekendResolveBattle(state, ctx, { galaxyId: gid, kind: 'assault' }, 'win', now)
  const p1 = weekendProgressAt(state, ev, gid, now)
  const r2 = weekendResolveBattle(state, ctx, { galaxyId: gid, kind: 'assault' }, 'win', now)
  const p2 = weekendProgressAt(state, ev, gid, now)
  console.log(
    `  ${name}：${(p0 * 100).toFixed(1)}% →(+${(r1.progressGain * 100).toFixed(1)}%) ${(p1 * 100).toFixed(1)}%` +
      ` →(+${(r2.progressGain * 100).toFixed(1)}%) ${(p2 * 100).toFixed(1)}%`,
  )
}

/**
 * ③-b 走**引擎真实结算路径**（`weekendApplyBattleOutcome` 不传 hint ⇒ 靠 `expedition.foeGalaxyId` 反推归属），
 * 并逐场打印**活动栏读数**——这就是"玩家清缴完觉得进度条没动"的现场复现。
 */
console.log('\n=== ③-b 结算路径 ＋ 活动栏读数（模拟引擎出发落盘） ===')
const probeSystem = ev.peripheryIds[0] ?? ev.coreId
const probeName = ctx.galaxies.get(probeSystem)?.name ?? probeSystem
const drawn = weekendAssaultDrawOf(state, ctx, probeSystem, now)
if (drawn === null) {
  console.log(`  ${probeName}：抽签返回 null（非占领区 / 活动已结束）⇒ 跳过`)
} else {
  console.log(`  ${probeName}：本场抽到 ${drawn.cardId}`)
  console.log(`    打之前：${banner()} ｜ ${probeName} 自己的进度 ${(weekendProgressAt(state, ev, probeSystem, now) * 100).toFixed(1)}%`)
  for (let i = 1; i <= 3; i += 1) {
    state.expedition.foeGalaxyId = probeSystem
    state.expedition.anomalyId = drawn.cardId
    const res = weekendApplyBattleOutcome(state, ctx, drawn.cardId, true, now, null)
    console.log(
      `    第 ${i} 场打赢：gain=${res ? (res.gain * 100).toFixed(1) + '%' : 'null（判为与入侵无关）'}` +
        ` ｜ ${banner()} ｜ ${probeName} 自己的进度 ${(weekendProgressAt(state, ev, probeSystem, now) * 100).toFixed(1)}%`,
    )
  }
}
