/**
 * **每场入侵战斗的进度反馈**（**2026-09-25 船长批「甲」**）＋ **外围领先读数**（同日批「乙」）。
 *
 * 起因（船长转述玩家报障）：「**从常驻悬赏进行重复清缴，不会增加进度条**」。
 * 真档实测的真相：进度**每场照加**（外围 +10%），但主动出击胜利**原来一句日志都没有**
 * （`expedition.ts` 丢弃 `weekendApplyBattleOutcome` 的返回值），而活动栏那三块读数
 * 全是"满 100% 才 +1 的计数" ⇒ 玩家看不到任何反馈。
 *
 * 本用例锁四条：
 * 1. 外围胜利 ⇒ 写一条「✦ <星系>：夺回进度 a% → b%」（`core.weekend.035`）；
 * 2. 核心门禁未解时打赢 ⇒ 写「外围未清完，本次不计夺回进度」（`core.weekend.036`），且台账不动；
 * 3. 战败 ⇒ 不写进度行（进度没动，别放噪声）；夺回那一场 ⇒ 只留既有的「✦ 夺回…」行；
 * 4. `weekendPeripheryLeadOf` = 外围里进度最高的一处（全满 ⇒ null）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { weekendPeripheryAverageOf, weekendPeripheryLeadOf } from '../src/weekendEvent'
import { weekendNoteContribution } from '../src/weekendEvent'
import { weekendAssaultSpecOf, weekendResolveBattle } from '../src/weekendBattle'
import type { WeekendBattleSpec } from '../src/weekendBattle'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const T = 1_000_000
/** 用**真实星系 id**（船长真档里那一场：外围红环航道 · 核心深渊之门）⇒ 日志读数是玩家看得懂的名字 */
const PER = 'galaxy-redring'
const CORE = 'galaxy-abyss'

function setup(): { s: GameState; ev: WeekendEventState } {
  const s = createInitialState({ nowWallMs: 0, seed: 11 })
  // 关闭调试模式 ⇒ 主动胜利 = 外围 +10% / 核心 +5%（调试模式是 +50%）
  s.debugQuick = false
  const ev: WeekendEventState = {
    seq: 1,
    startedAtWallMs: 0,
    coreId: CORE,
    peripheryIds: [PER],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  return { s, ev }
}

/** 本场新写的日志（textId + 正文） */
function newLogs(s: GameState, before: number): { textId?: string; text: string }[] {
  return s.logs.slice(before).map((l) => ({ ...(l.textId !== undefined ? { textId: l.textId } : {}), text: l.text }))
}

/** 该星系的"主动出击"战 spec（引擎走的同一个构造口 ⇒ 字段齐全） */
function specOf(s: GameState, galaxyId: string): WeekendBattleSpec {
  const spec = weekendAssaultSpecOf(s, ctx, galaxyId)
  expect(spec, `取不到「${galaxyId}」的出击 spec（用例前提）`).not.toBeNull()
  return spec!
}

describe('入侵战斗的进度反馈（船长批甲）', () => {
  it('外围打赢 ⇒ 写「夺回进度 a% → b%」，台账 +10%', () => {
    const { s, ev } = setup()
    const n = s.logs.length
    const r = weekendResolveBattle(s, ctx, specOf(s, PER), 'win', T)
    expect(r.progressGain).toBeCloseTo(0.1, 10)
    expect(ev.contributed[PER]).toBeCloseTo(0.1, 10)
    const logs = newLogs(s, n)
    const line = logs.find((l) => l.textId === 'core.weekend.035')
    expect(line, '应有进度反馈行').toBeDefined()
    expect(line!.text).toMatch(/夺回进度 \d+% → \d+%/)
    console.log(`  [读数] 外围胜利日志 = ${line!.text}`)
  })

  it('核心门禁未解 ⇒ 写「外围未清完，本次不计夺回进度」，台账不动', () => {
    const { s, ev } = setup()
    const n = s.logs.length
    const r = weekendResolveBattle(s, ctx, specOf(s, CORE), 'win', T)
    expect(r.progressGain).toBe(0)
    expect(ev.contributed[CORE] ?? 0).toBe(0)
    const line = newLogs(s, n).find((l) => l.textId === 'core.weekend.036')
    expect(line, '应有"本次不计进度"行').toBeDefined()
    console.log(`  [读数] 核心门禁日志 = ${line!.text}`)
  })

  it('战败不写进度行；夺回那一场只留既有的「夺回」行', () => {
    const { s, ev } = setup()
    // 战败
    const n1 = s.logs.length
    const l = weekendResolveBattle(s, ctx, specOf(s, PER), 'loss', T)
    expect(l.progressGain).toBe(0)
    expect(
      newLogs(s, n1).some((x) => x.textId === 'core.weekend.035' || x.textId === 'core.weekend.036'),
      '战败不该有进度行',
    ).toBe(false)
    // 夺回：把该处推到 95%，再打赢一场（越过 100%）
    weekendNoteContribution(ev, PER, 0.95)
    const n2 = s.logs.length
    const r = weekendResolveBattle(s, ctx, specOf(s, PER), 'win', T)
    expect(r.reclaimed, '这一场应判为夺回').toBeDefined()
    const logs2 = newLogs(s, n2)
    expect(logs2.some((x) => x.textId === 'core.weekend.035'), '夺回那场不再补进度行').toBe(false)
    // ⚠「✦ 夺回…」那条日志由**上一层**写（`weekendApplyBattleOutcome`；本函数只把 `reclaimed` 标出来）
    expect(r.note, '夺回那一场的结果指向"夺回"').toContain('夺回')
  })
})

describe('活动栏的外围领先读数（船长批乙）', () => {
  it('外围里进度最高的一处；全满 ⇒ null', () => {
    const { s, ev } = setup()
    ev.peripheryIds = ['galaxy-grave', PER, 'galaxy-voidedge']
    weekendNoteContribution(ev, 'galaxy-grave', 0.2)
    weekendNoteContribution(ev, PER, 0.6)
    const lead = weekendPeripheryLeadOf(s, ev, T)
    expect(lead?.galaxyId).toBe(PER)
    expect(lead!.progress).toBeGreaterThan(0.6)
    console.log(`  [读数] 领先处 = ${lead!.galaxyId} ${(lead!.progress * 100).toFixed(1)}%`)
    // 平均：**清非领先的那一处也动**（这就是补它的理由——"最高"在那种场合一动不动）
    const avgBefore = weekendPeripheryAverageOf(s, ev, T)
    weekendNoteContribution(ev, 'galaxy-grave', 0.1)
    const avgAfter = weekendPeripheryAverageOf(s, ev, T)
    expect(avgAfter).toBeGreaterThan(avgBefore)
    expect(weekendPeripheryLeadOf(s, ev, T)!.galaxyId, '"最高"仍是红环（清坟场不改它）').toBe(PER)
    console.log(`  [读数] 清坟场 +10%：平均 ${(avgBefore * 100).toFixed(1)}% → ${(avgAfter * 100).toFixed(1)}%，最高不动`)
    // 全部夺回 ⇒ null（那时"外围夺回 X/Y"本身已经在报满）
    weekendNoteContribution(ev, 'galaxy-grave', 1)
    weekendNoteContribution(ev, PER, 1)
    weekendNoteContribution(ev, 'galaxy-voidedge', 1)
    expect(weekendPeripheryLeadOf(s, ev, T)).toBeNull()
  })
})
