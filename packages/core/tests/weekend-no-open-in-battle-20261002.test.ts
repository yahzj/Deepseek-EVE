/**
 * **「还在打那一场 ⇒ 不开新场」硬闸**（**2026-10-02 补闸 · 一号 · 船长令「按你推荐来」**）。
 *
 * ## 这道闸挡的是什么
 *
 * 入侵的收场与开局原本是两套判据：**收场**那三条路都已被"还有没打完的旗舰战 ⇒ 顺延"闸住
 * （船长 2026-09-27 裁定「要一起闸」，见 `weekendTick` ③④ 与 `weekendClaimOctopus` 的调用门）；
 * 但**开局**这边只看"上一场结束了没有"——
 *
 * - **玩家亲手击沉旗舰 ⇒ 那一场当场收场**（`weekendNoteFlagshipKilled`），而玩家**还停在那一场
 *   旗舰战的战斗画面里**（遭遇槽里那场 `battle` 还在）⇒ 旧代码在**同一拍/下一拍**就给他开一场新的：
 *   新场随即拿到**旧战斗的结算**（伤害记进新场的池子、`flagshipKilled` 让新场当场封盘、黑匣/残骸
 *   算到新场头上）——正是报障那类「打完了入侵却还在 / 旗舰血条不对」的温床；
 * - 补偿补场的开局器（`openWeekendMakeupIfDue`）同样只看"手上那场结束了没有"⇒ 同一道缺口。
 *
 * 修法 = **开局侧也过同一把闸**：判据一律走单点 `weekendFlagshipBattleActive`（与战斗界面、
 * 章鱼削血闸同源，**不新造第二份判据**）：
 * - `weekendTick(..., flagshipBattleActive = true)` ⇒ 本拍**不开新场**（战斗收场后下一拍照常开）；
 * - `openWeekendMakeupIfDue` ⇒ 有旗舰战在地时**本拍不开**。
 *
 * 本文件钉四件事：① 战斗在地时 `weekendTick` 不开新场（且场次号不动）；② 同一拍把闸放开 ⇒ 照开
 * （证明挡住它的正是这道闸，不是别的门）；③ 补场开局器同样被闸住、收场后照开；④ 战斗一收场
 * （遭遇槽清空）⇒ 下一拍照常开（延迟 ≤ 一拍，不漏场）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  weekendCoreCandidates,
  weekendNoteFlagshipKilled,
  weekendTick,
} from '../src/weekendEvent'
import { weekendFlagshipSpecOf } from '../src/weekendBattle'
import { weekendFlagshipBattleActive, weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { openWeekendMakeupIfDue, WEEKEND_MAKEUP_FIRST_WALL_MS } from '../src/weekendCompensation'

const ctx = buildSimContext()
const H = 3_600_000
const T0 = new Date(2026, 9, 2, 20, 0, 0, 0).getTime()
const NOW = T0 + H
/** 补场暗期里的一个时刻（周三 20:00 开、周五 20:00 收 ⇒ 取周四中午） */
const DARK = WEEKEND_MAKEUP_FIRST_WALL_MS + 16 * H

/**
 * 造一档：调试模式（结束 +1h 就能再开场 ⇒ 被测的那道闸才是唯一挡住它的东西）＋ 一场**核心已满**的
 * 光环入侵（旗舰已在场、池子只剩 400）。
 */
function world(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
  s.debugQuick = true
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.standingsEarned = { ...(s.standingsEarned ?? {}), dsi: 100 }
  s.standings = { ...s.standings, dsi: 100 }
  const core = weekendCoreCandidates(s, ctx)[0]!
  s.weekendEvent = {
    seq: 1,
    startedAtWallMs: T0,
    coreId: core,
    peripheryIds: [],
    family: 'R',
    contributed: { [core]: 1 },
    flagshipHpMax: WEEKEND_FLAGSHIP_POOL_HP,
    flagshipHpDone: WEEKEND_FLAGSHIP_POOL_HP - 400,
  }
  return s
}

/** 真开一场旗舰战并把它挂进**遭遇槽**（照桌面引擎 `challengeWeekendFlagship` 那 9 个字段逐字摆） */
function intoFlagshipBattle(s: GameState): void {
  const ev = s.weekendEvent!
  const spec = weekendFlagshipSpecOf(s, ctx, NOW)!
  const battle = weekendStartFlagshipBattle(s, ctx, NOW, [s.shipId])!
  s.encounter = {
    active: true,
    shipId: s.shipId,
    galaxyId: ev.coreId,
    name: spec.name,
    threat: spec.threat,
    anomalyId: spec.cardId,
    origin: '（用例）挑战入侵旗舰',
    invitedAtGameMs: s.gameMs,
    deadlineGameMs: s.gameMs + 60_000,
    battle,
  }
  expect(weekendFlagshipBattleActive(s), '遭遇槽里挂着旗舰战 ⇒ 在打').toBe(true)
}

describe('硬闸：还有没打完的旗舰战 ⇒ 不开新场（2026-10-02 补闸）', () => {
  it('① 玩家击沉旗舰（那一场已收场）但人还在战斗里 ⇒ `weekendTick` **本拍不开新场**', () => {
    const s = world()
    intoFlagshipBattle(s)
    /** 玩家亲手击沉 ⇒ 那一场**当场收场**（这就是"已结束却还在打"的那种状态） */
    expect(weekendNoteFlagshipKilled(s, NOW), '核心已满 ⇒ 击杀成立').toBe(true)
    expect(s.weekendEvent!.endedAtWallMs, '旧场已收场').toBe(NOW)
    /** 调试档：结束满 1 小时就够开下一场了 —— 但人在战斗里 ⇒ 必须挡住 */
    const r = weekendTick(s, ctx, NOW + H + 1, NOW, true)
    expect(r.started, '**没开新场**（改前这里 = true）').toBe(false)
    expect(s.weekendEvent!.seq, '手上还是旧场（场次号不动）').toBe(1)
    console.log(`  [读数] 战斗在地：started=${r.started} · seq=${s.weekendEvent!.seq}`)
  })

  it('② 同一拍把闸放开 ⇒ 照开（挡住它的正是这道闸，不是别的门）', () => {
    const s = world()
    intoFlagshipBattle(s)
    weekendNoteFlagshipKilled(s, NOW)
    const r = weekendTick(s, ctx, NOW + H + 1, NOW, false)
    expect(r.started, '闸一放开 ⇒ 照常开新场').toBe(true)
    expect(s.weekendEvent!.seq, '新场 = 下一号').toBe(2)
  })

  it('③ 补场开局器：有旗舰战在地 ⇒ 不开；收场后 ⇒ 照开（对照）', () => {
    const s = world()
    intoFlagshipBattle(s)
    weekendNoteFlagshipKilled(s, NOW)
    /** 判成"受影响"那条路（补场），且本期没出过光环 */
    s.weekendCompensation = { track: 'makeup', decidedAtWallMs: NOW }
    expect(openWeekendMakeupIfDue(s, ctx, DARK), '**人在战斗里 ⇒ 不开补场**（改前这里 = true）').toBe(false)
    expect(s.weekendCompensation.makeupServedAtWallMs, '没落"已开"标记 ⇒ 之后还能补开').toBeUndefined()
    /** 对照：战斗收场（遭遇槽清空）⇒ 同一时刻照开 —— 证明挡住它的正是这道闸，不是别的门 */
    s.encounter = { ...s.encounter, active: false, battle: null }
    expect(openWeekendMakeupIfDue(s, ctx, DARK), '收场后 ⇒ 照开').toBe(true)
    expect(s.weekendEvent?.family, '补场 = 光环科技（R）').toBe('R')
    expect(s.weekendCompensation.makeupServedAtWallMs, '落"已开"标记').toBe(DARK)
  })

  it('④ 战斗一收场（遭遇槽清空）⇒ 下一拍照常开，不漏场', () => {
    const s = world()
    intoFlagshipBattle(s)
    weekendNoteFlagshipKilled(s, NOW)
    expect(weekendTick(s, ctx, NOW + H + 1, NOW, true).started, '还在打 ⇒ 不开').toBe(false)
    /** 战斗收场：遭遇槽清空（真引擎走 `settleFight` 的 `clearEncounter`） */
    s.encounter = { ...s.encounter, active: false, battle: null }
    expect(weekendFlagshipBattleActive(s), '收场后判据回落').toBe(false)
    expect(weekendTick(s, ctx, NOW + H + 2, NOW, false).started, '下一拍就开（延迟 ≤ 一拍）').toBe(true)
    expect(s.weekendEvent!.seq).toBe(2)
    console.log(`  [读数] 收场后：started=true · seq=${s.weekendEvent!.seq}`)
  })
})
