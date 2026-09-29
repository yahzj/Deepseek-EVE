/**
 * **遭遇战里被打沉的船 ⇒ 真丢**（**2026-09-28 玩家报障**：
 * 「**玩家在入侵的旗舰战中沉船后撤退，沉船会被复活带出并且能够修理，这是BUG**」）。
 *
 * ## 病根
 * 旗舰战是**编队战**、**承载在遭遇槽**（`state.encounter.battle`，见 `weekendLaunch` 的"战斗宿主"注），
 * 而遭遇战的收场路径**只落盘承伤、从不判沉船**：
 * `persistFleetHullDamage` 如实写出 `durability = 0`，可那一格**在别处没有任何"已沉"语义**
 * （全仓只有 `< 0.5` 的自动修理/返港判据）⇒ 0% 的船以"活着但残血"被带回港、花钱就能修好。
 * 虫洞那条同口径的路是**判沉船并 `loseShip`**（`wormholeBattle` 的 `settleWormholeBattle`）——
 * 设计稿（`weekend-invasion.md`）第 243 行要求三个战斗宿主在「逐舰承伤与机群战损」上同口径，
 * **遭遇战这一宿主漏了这一环**。
 *
 * ## 修法
 * 收场（**撤退 / 自动脱离** · **分胜负**）时按单点 `combat.sunkShipIdsOfBattle`（三层血合计 ≤ 0）
 * 判沉船 ⇒ `loseShip`：正常星系沉船**留残骸**（2026-09-26 船长令）· `cause: 'encounter-lost'`。
 *
 * ## 本文件钉四件事
 * ① 撤退时沉船**真丢**（不在舰队里了）· ② 残骸与沉船记录都对 ·
 * ③ 同场**没沉**的船照旧带伤回家（不误伤）· ④ **分胜负**那条路同样判（不是只管撤退）。
 *
 * ⚠ 夹具用**普通编队遭遇战**（`startFleetBattleFor` + 手搭遭遇槽）——它与旗舰战**走同一条收场路径**
 * （`retreatEncounterBattle` → `settleEscape` / `advanceEncounterWatch` → `settleFight`），
 * 且不必凑"核心条满 + 旗舰现身"那一整套入侵前置。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { startFleetBattleFor } from '../src/combat'
import { advanceEncounterWatch, retreatEncounterBattle } from '../src/encounters'
import { wreckLogRowsOf } from '../src/shipWrecks'

const ctx = buildSimContext()
const CARD = 'ink-harass'
const GALAXY = 'galaxy-kor'

/** 两艘船的编队遭遇战：把 `battle` 挂进遭遇槽（旗舰战同款承载方式） */
function world(seed = 11): { state: GameState; main: string; ally: string } {
  const state = createInitialState({ nowWallMs: 0, seed })
  const main = state.shipId
  const ally = addShipToFleet(state, 'sh-sentinel')
  const battle = startFleetBattleFor(state, ctx, [main, ally], CARD, 0)
  expect(battle, '开战成功').not.toBeNull()
  state.encounter = {
    active: true,
    shipId: main,
    galaxyId: GALAXY,
    name: '测试遭遇',
    threat: 40,
    anomalyId: CARD,
    origin: '测试',
    invitedAtGameMs: state.gameMs,
    deadlineGameMs: state.gameMs + 60_000,
    battle,
  }
  return { state, main, ally }
}

/** 把某艘船在本场战斗里的单位打成"三层血全 0"（＝沉船判据命中的那一格） */
function sinkUnit(state: GameState, uid: string): void {
  const battle = state.encounter.battle!
  const tag = battle.myFleet?.find((e) => e.shipId === uid)?.tag
  expect(tag, `编队里能找到 ${uid}`).toBeDefined()
  battle.units[tag!]!.hp = { s: 0, a: 0, h: 0 }
}

/** 把某艘船在本场战斗里的单位留成"还剩一点结构"（不该被判沉船） */
function damageUnit(state: GameState, uid: string, hullLeft: number, armorLeft = 0): void {
  const battle = state.encounter.battle!
  const tag = battle.myFleet?.find((e) => e.shipId === uid)?.tag
  const unit = battle.units[tag!]!
  /** 血条分母在 `hpMax`（缺省 ⇒ 拿开战满血兜底，与界面同源） */
  const max = unit.hpMax ?? unit.hp
  unit.hp = { s: 0, a: Math.round(max.a * armorLeft), h: Math.round(max.h * hullLeft) }
}

describe('遭遇战沉船 ⇒ 真丢（2026-09-28 玩家报障）', () => {
  it('① **撤退时沉船真丢**：船不在舰队里了，且沉船记录 + 残骸都对', () => {
    const { state, main, ally } = world()
    sinkUnit(state, ally)
    expect(retreatEncounterBattle(state, ctx).ok, '撤退成功').toBe(true)

    expect(state.fleet[ally], '打沉的僚舰已经不在舰队里').toBeUndefined()
    expect(state.fleet[main], '主控船还在').toBeDefined()

    const log = state.wreckLog ?? []
    expect(log.length, '记了一条沉船记录').toBe(1)
    expect(log[0]!.shipId).toBe(ally)
    expect(log[0]!.cause, '原因是"遭遇战中被击沉"').toBe('encounter-lost')
    expect(log[0]!.wreckGalaxyId, '残骸落在打这一场的星系').toBe(GALAXY)

    const row = wreckLogRowsOf(state, ctx)[0]!
    expect(row.wreck, '残骸留在星系里 ⇒ 可打捞（不是"无残骸"）').toBe('salvageable')
  })

  it('② **没沉的船照旧带伤回家**（不误伤）：结构残余按战斗里的实况落盘', () => {
    const { state, main, ally } = world(12)
    sinkUnit(state, ally)
    damageUnit(state, main, 0.4, 0.25)
    expect(retreatEncounterBattle(state, ctx).ok).toBe(true)
    expect(state.fleet[ally], '僚舰丢了').toBeUndefined()
    const kept = state.fleet[main]!
    expect(kept.durability, '主控结构 ≈ 40%').toBeCloseTo(0.4, 1)
    expect(kept.armorPct, '主控装甲 ≈ 25%').toBeCloseTo(0.25, 1)
  })

  it('③ **只差一点没沉 ⇒ 不丢**（判据是"三层血合计 ≤ 0"，不是"很惨"）', () => {
    const { state, main, ally } = world(13)
    damageUnit(state, ally, 0.05) // 结构剩 5%
    expect(retreatEncounterBattle(state, ctx).ok).toBe(true)
    expect(state.fleet[ally], '还剩 5% 结构的船照旧带回家').toBeDefined()
    expect(state.wreckLog ?? [], '没有沉船记录').toHaveLength(0)
    expect(state.fleet[main]).toBeDefined()
  })

  it('④ **分胜负那条路同样判**（不是只管撤退）：战斗已结束 ⇒ 收场时沉船一样丢', () => {
    const { state, main, ally } = world(14)
    sinkUnit(state, ally)
    state.encounter.battle!.ended = 'me' // 我方全歼敌群 ⇒ 走 settleFight 那一支
    advanceEncounterWatch(state, ctx, 0)
    expect(state.fleet[ally], '结算时同样把沉掉的船扣掉').toBeUndefined()
    expect(state.fleet[main]).toBeDefined()
    expect((state.wreckLog ?? [])[0]?.cause).toBe('encounter-lost')
  })
})
