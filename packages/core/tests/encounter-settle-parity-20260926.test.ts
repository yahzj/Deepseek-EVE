/**
 * **遭遇战收尾的两条支路必须同源**（2026-09-26 修 · 船长报障
 * 「他用无人机成功近乎满血击杀了入侵母舰，但是报告中显示他未击杀」）。
 *
 * 病根：`encounters.advanceEncounterWatch` 原先有两条"战斗已结束"的支路 ——
 * 「进函数时 `enc.battle.ended` 已置位」那一支**只调 `settleFight` 就返回**，
 * 而入侵结算（`weekendApplyBattleOutcome`：母舰伤害记账 / 击沉判定 / 黑匣与残骸）只写在
 * 「本拍推进后分出胜负」那一支里 ⇒ 前一支上一场旗舰战**白打**：伤害不记、进度不给、
 * 黑匣不发、结算面板永远显示「未击沉」。
 *
 * 本用例钉住：**同一起点状态，走哪条支路读数都必须一样**（探针读数的固化版）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/index'
import { advanceEncounterWatch } from '../src/encounters'
import { weekendFlagshipSpecOf } from '../src/weekendBattle'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { weekendNoteContribution, WEEKEND_FLAGSHIP_SHIP_ID } from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'

const ctx = buildSimContext()
const GID = 'galaxy-alkali'
const CORE = 'galaxy-kor'

type S = ReturnType<typeof createInitialState>
type B = NonNullable<ReturnType<typeof weekendStartFlagshipBattle>>

function invaded(seed = 21): S {
  const s = createInitialState({ nowWallMs: 0, seed })
  s.debugQuick = true
  const ev: WeekendEventState = {
    seq: 9,
    startedAtWallMs: Date.now(),
    coreId: CORE,
    peripheryIds: [GID],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  return s
}

/** 核心条满 ⇒ 开一场旗舰战并写进遭遇槽（与 apps 引擎 `challengeWeekendFlagship` 同形） */
function openFlagship(s: S): B {
  const now = Date.now()
  weekendNoteContribution(s.weekendEvent!, GID, 1)
  weekendNoteContribution(s.weekendEvent!, CORE, 1)
  const spec = weekendFlagshipSpecOf(s, ctx, now)!
  const battle = weekendStartFlagshipBattle(s, ctx, now, [s.shipId])!
  s.encounter = {
    active: true,
    shipId: s.shipId,
    galaxyId: CORE,
    name: spec.name,
    threat: spec.threat,
    anomalyId: spec.cardId,
    origin: '用例',
    invitedAtGameMs: 0,
    deadlineGameMs: 0,
    battle,
  }
  return battle
}

/**
 * 把场上敌人逐波打光（= 玩家/无人机清场，我方几乎不挨打），直到母舰那一波出场。
 * 200ms 一拍是为了让波次之间的"演出窗口"照常走完（大步长会让我方在波隙里被下一波打沉）。
 */
function clearWavesUntilBoss(s: S, battle: B): void {
  for (let i = 0; i < 4_000; i += 1) {
    if (battle.ended || s.encounter.battle === null) return
    const bossHere = Object.values(battle.units).some((u) => u.side === 'foe' && u.foeShipId === WEEKEND_FLAGSHIP_SHIP_ID)
    if (bossHere) return
    for (const u of Object.values(battle.units)) if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
    s.gameMs += 200
    advanceEncounterWatch(s, ctx, 200)
  }
}

function boxOf(s: S): number {
  return (s.warehouse.items['blackbox-h'] ?? 0) + (s.fleet[s.shipId]?.cargo?.['blackbox-h'] ?? 0)
}

describe('遭遇战收尾 · 两条支路同源（2026-09-26）', () => {
  it('母舰击沉：走"本拍推进后分出胜负" ⇒ 伤害入池 · 判定击沉 · 黑匣到手', () => {
    const s = invaded()
    const battle = openFlagship(s)
    clearWavesUntilBoss(s, battle)
    expect(battle.ended, '母舰那一波出场时还没分出胜负').toBeNull()
    for (const u of Object.values(battle.units)) if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
    s.gameMs += 200
    advanceEncounterWatch(s, ctx, 200)
    expect(battle.ended, '敌全灭 ⇒ 我方胜').toBe('me')
    expect(s.weekendEvent!.flagshipHpDone, '伤害真入池（= 池子剩余）').toBeGreaterThan(0)
    expect(s.weekendEvent!.flagshipDown, '判定为玩家击沉').toBe('player')
    expect(boxOf(s), '黑匣到手').toBe(1)
  })

  it('母舰击沉：`ended` 在引擎看到之前就已置位 ⇒ 读数必须与上面那条**完全一致**', () => {
    const s = invaded()
    const battle = openFlagship(s)
    clearWavesUntilBoss(s, battle)
    for (const u of Object.values(battle.units)) if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
    /** 关键差别：不等引擎推进，直接把胜负写进战斗（"引擎看到时已经结束"那一支） */
    battle.ended = 'me'
    advanceEncounterWatch(s, ctx, 1_000)
    expect(s.weekendEvent!.flagshipHpDone, '伤害照样入池（改前 = 0）').toBeGreaterThan(0)
    expect(s.weekendEvent!.flagshipDown, '照样判玩家击沉（改前 undefined）').toBe('player')
    expect(boxOf(s), '黑匣照样到手（改前 0）').toBe(1)
  })
})
