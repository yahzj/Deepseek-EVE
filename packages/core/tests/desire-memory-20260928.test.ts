/**
 * **期望距离的"记忆"**（**2026-09-28 玩家报障**：「**入侵和旗舰战，并不会记忆玩家选择的期望距离**」）。
 *
 * 口径（**船长 2026-09-11**）：「玩家每个星系设定的目标距离独立保存」——写入端 `setBattleDesire`
 * 战斗内拖条/战术切换 ⇒ `setDesirePrefOf(该星系)`；读取端 = 下次在**同一星系**开战时沿用它。
 *
 * 取证结论（三套宿主逐条实测，探针读数见工作文档）：
 * - **遇袭 / 遭遇**：`fightEncounter` 显式传 `desirePrefOf(state, enc.galaxyId)` ✅ 本来就通；
 * - **远征 / 入侵主动出击**：开战恒传 `undefined`，但 `startBattleFor` 自己会回落
 *   `desirePrefOf(state, anomaly.galaxyId)`，而**目标卡自带被占星系** ⇒ 与写入端同源 ✅ 本来就通
 *   （⚠ 本文件用例②就是防"日后有人在这儿再补一次"的——那会变成两处读同一份偏好）；
 * - **旗舰战**（编队战 · 承载遭遇槽）：原先也传 `undefined` ⇒ 引擎回落按**卡自带星系**读，
 *   而**旗舰卡是隐藏卡、母港是 `galaxy-hub`** ⇒ **永远读不到核心星系那一份** ⇒「不记忆」❌
 *   ⇒ 修法 = `weekendStartFlagshipBattle` **显式**传 `desirePrefOf(state, ev.coreId)`
 *   （与写入端 `state.encounter.galaxyId` 逐字同源）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { desirePrefOf, setDesirePrefOf, startBattleFor } from '../src/combat'
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
/** 引擎缺省档（主武器射程中点）——本例里第一场开出来的就是它 */
const DEFAULT_DESIRE = 2_000
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

describe('期望距离的按星系记忆（2026-09-28 玩家报障）', () => {
  it('① **旗舰战**：核心星系记下的目标距离 ⇒ 下一场开战就按它站（不再回默认档）', () => {
    const { s, ev } = bossWorld()
    const first = weekendStartFlagshipBattle(s, ctx, NOW)
    expect(first, '第一场开得起来').not.toBeNull()
    expect(first!.myDesireM, '头一场没设过 ⇒ 引擎缺省档').toBe(DEFAULT_DESIRE)

    /** 模拟"玩家在战斗里把距离条拖到 3000"：写入端写的就是**核心星系**这一格 */
    setDesirePrefOf(s, ev.coreId, PLAYER_DESIRE)
    expect(desirePrefOf(s, ev.coreId)).toBe(PLAYER_DESIRE)

    const second = weekendStartFlagshipBattle(s, ctx, NOW)
    expect(second, '第二场也开得起来').not.toBeNull()
    expect(second!.myDesireM, '**记住了**（修前这里是 2000）').toBe(PLAYER_DESIRE)
  })

  it('② 读的是**核心星系**那一份，不是旗舰卡自带的母港（隐藏卡的坑）', () => {
    const { s, ev } = bossWorld()
    /** 只往"卡自带星系"写（旗舰卡的母港 = galaxy-hub）：那一份**不该**影响旗舰战 */
    setDesirePrefOf(s, 'galaxy-hub', PLAYER_DESIRE)
    const b = weekendStartFlagshipBattle(s, ctx, NOW)
    expect(b!.myDesireM, '核心星系没设过 ⇒ 仍是缺省档').toBe(DEFAULT_DESIRE)
    /** 再写核心星系那一份 ⇒ 立刻按它站 */
    setDesirePrefOf(s, ev.coreId, PLAYER_DESIRE)
    expect(weekendStartFlagshipBattle(s, ctx, NOW)!.myDesireM).toBe(PLAYER_DESIRE)
  })

  it('③ **远征 / 入侵主动出击**：引擎自带回落（写卡的星系 ⇒ 开战读回）——这条不许被"再补一次读取"动到', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 7 })
    s.debugQuick = true
    const uid = addShipToFleet(s, 'sh-sentinel')
    s.shipId = uid
    const cardId = 'ink-harass'
    const card = ctx.anomalies.get(cardId)!
    setDesirePrefOf(s, card.galaxyId, PLAYER_DESIRE)
    const b = startBattleFor(s, ctx, uid, cardId, 0, undefined)
    expect(b, '开得起来').not.toBeNull()
    expect(b!.myDesireM, '引擎回落读到该星系偏好').toBe(PLAYER_DESIRE)
  })
})
