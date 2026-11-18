/** 旗舰距离报障回归：现读取编队默认，旧母港偏好仅兼容留存。 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createCommandReadyState as createInitialState } from './helpers/command-ready'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { setDesirePrefOf, startBattleFor, desiredRangeFor } from '../src/combat'
import { buildMyUnitSpecs } from '../src/combat/fleetSpecs'
import { setFleetDistance } from './helpers/fleet-range'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  weekendNoteContribution,
  weekendNoteFlagshipDamage,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'

const ctx = buildSimContext('zh')
const GID = 'galaxy-alkali'
const CORE = 'galaxy-kor'
const NOW = 1_800_000_000_000
/** 默认距离按本场电子战后的主武器计算，不把旧射程常量当记忆规则。 */
const defaultDesire = (s: GameState, battle: NonNullable<ReturnType<typeof weekendStartFlagshipBattle>>) =>
  desiredRangeFor(buildMyUnitSpecs(s, ctx, battle, s.shipId, 'ink-flagship')[0]!, 'mid', ctx.balance.battle)
/** 玩家在战斗里拖到的目标距离（写入端写的那个值） */
const PLAYER_DESIRE = 3_000

/** 一场"核心条满 ＋ 外围已清"的入侵（旗舰战开得起来的那种世界） */
function bossWorld(): { s: GameState; ev: WeekendEventState } {
  const s = createInitialState({ nowWallMs: 0, seed: 7 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.debugQuick = true
  const ev = {
    seq: 1,
    startedAtWallMs: 1_000,
    coreId: CORE,
    peripheryIds: [GID],
    family: 'H',
    contributed: {},
  } as unknown as WeekendEventState
  s.weekendEvent = ev
  weekendNoteContribution(ev, GID, 1)
  weekendNoteContribution(ev, CORE, 1)
  weekendNoteFlagshipDamage(ev, WEEKEND_FLAGSHIP_POOL_HP - 4_000)
  return { s, ev }
}

describe('旧记忆报障回归：旗舰战读取编队默认', () => {
  it('① 旗舰战读取当前编队距离，未设置时仍用默认档', () => {
    const { s } = bossWorld()
    // 两场使用独立的同状态存档，避免上一场的出发门禁干扰距离读取。
    const firstState = structuredClone(s)
    const first = weekendStartFlagshipBattle(firstState, ctx, NOW)
    expect(first, '第一场开得起来').not.toBeNull()
    expect(first!.myDesireM, '头一场没设过 ⇒ 引擎缺省档').toBe(defaultDesire(firstState, first!))

    setFleetDistance(s, ctx, PLAYER_DESIRE)
    expect(s.fleetRange?.desireM).toBe(PLAYER_DESIRE)

    const second = weekendStartFlagshipBattle(s, ctx, NOW)
    expect(second, '第二场也开得起来').not.toBeNull()
    expect(second!.myDesireM, '**记住了**（修前这里是 2000）').toBe(PLAYER_DESIRE)
  })

  it('② 旧母港偏好不影响旗舰卡的默认或记录距离', () => {
    const { s } = bossWorld()
    /** 只往"卡自带星系"写（旗舰卡的母港 = galaxy-hub）：那一份**不该**影响旗舰战 */
    setDesirePrefOf(s, 'galaxy-hub', PLAYER_DESIRE)
    const firstState = structuredClone(s)
    const b = weekendStartFlagshipBattle(firstState, ctx, NOW)
    expect(b, '旧母港偏好不妨碍开场').not.toBeNull()
    expect(b!.myDesireM, '旗舰卡没设过 ⇒ 仍是缺省档').toBe(defaultDesire(firstState, b!))
    /** 同状态存档写入旗舰卡距离，不受上一场的出发门禁影响。 */
    setFleetDistance(s, ctx, PLAYER_DESIRE)
    const second = weekendStartFlagshipBattle(s, ctx, NOW)
    expect(second, '记录距离后也开得起来').not.toBeNull()
    expect(second!.myDesireM).toBe(PLAYER_DESIRE)
  })

  it('③ 低层预览读取编队默认但不写回真实存档', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 7 })
    s.debugQuick = true
    const uid = addShipToFleet(s, 'sh-sentinel')
    s.shipId = uid
    const cardId = 'ink-harass'
    setFleetDistance(s, ctx, PLAYER_DESIRE)
    const before = structuredClone(s)
    const b = startBattleFor(s, ctx, uid, cardId, 0, undefined)
    expect(b, '开得起来').not.toBeNull()
    expect(b!.myDesireM, '引擎读取编队默认').toBe(PLAYER_DESIRE)
    expect(s.fleetRange).toEqual(before.fleetRange)
    expect(s.fleetPresets).toEqual(before.fleetPresets)
  })
})
