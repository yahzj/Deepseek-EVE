import { describe, expect, it } from 'vitest'
import { buildSimContext, FOE_SHIPS } from '@whale/data'
import { activeFoeSpecsOf, standbyShieldActiveOf, foeStandbyReadyOf, advanceBattleFor, battleArcsFor } from '../src/combat'
import { coronaFocusBonusOf, coronaFocusFalloffOf } from '../src/coronaFocus'
import { foeGunMaxRangeOf, foeGunPowerFactorOf } from '../src/foeRange'
import { pdShotOf, resolvePointDefense } from '../src/combatDrones'
import { createInitialState, type BattleState } from '../src/state'
import { addShipToFleet, startFleetBattleFor } from '../src/index'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const nexus = activeFoeSpecsOf(ctx.anomalies.get('corona-nexus')!, bal, 3)
  .find((f) => f.foeShipId === 'foe-r-corona-nexus')!
const dusk = activeFoeSpecsOf(ctx.anomalies.get('corona-converge')!, bal, 1)
  .find((f) => f.foeShipId === 'foe-r-corona-dusk')!

function clock(elapsedMs: number): BattleState {
  return { startedAtGameMs: 0, foeWaveStartMs: 10_000, lastTickGameMs: 10_000 + elapsedMs } as BattleState
}

describe('聚焦：波次同源、加算抵消', () => {
  it.each([0, 60_000, 120_000, 180_000])('t=%i 射程与防空同一曲线', (elapsed) => {
    const b = clock(elapsed)
    const progress = Math.min(1, elapsed / 120_000)
    const rangeBonus = coronaFocusBonusOf(b, nexus.foeFocusArray, 'rangeBonusPct')
    const antiDroneBonus = coronaFocusBonusOf(b, nexus.foeFocusArray, 'antiDroneBonusPct')
    expect(rangeBonus).toBe(2 * progress)
    expect(antiDroneBonus).toBe(rangeBonus)
    const w = nexus.weapons[0]!
    expect(foeGunMaxRangeOf(b, nexus, w)).toBe(Math.round(w.maxRangeM * (1 + rangeBonus)))
    expect(coronaFocusFalloffOf(w.falloff, 120_000, elapsed)).toBeCloseTo(0.2 + 0.8 * progress)
    b.meFoeRangeDebuff = 0.6
    expect(foeGunMaxRangeOf(b, nexus, w)).toBe(Math.round(w.maxRangeM * (1 + rangeBonus - 0.6)))
    const basePd = pdShotOf(bal, 'R', 5).dmg
    expect(pdShotOf(bal, 'R', 5, antiDroneBonus - 0.6).dmg).toBeCloseTo(basePd * (1 + antiDroneBonus - 0.6))
  })

  it('族加成与聚焦加算，不是乘算；换波清零、未挂件不增益', () => {
    const b = clock(120_000)
    const bonus = coronaFocusBonusOf(b, nexus.foeFocusArray, 'antiDroneBonusPct')
    expect(pdShotOf(bal, 'H', 1, bonus).dmg).toBe(bal.pdDmg * (1.5 + 2))
    b.foeGunRangeBuff = 1.5
    const extended = { ...nexus, foeGunRangeMulOnHit: 1.5 }
    expect(foeGunMaxRangeOf(b, extended, nexus.weapons[0]!)).toBe(Math.round(13_500 * (1.5 + 2)))
    b.foeWaveStartMs = b.lastTickGameMs
    expect(coronaFocusBonusOf(b, nexus.foeFocusArray, 'rangeBonusPct')).toBe(0)
    expect(coronaFocusBonusOf(b, nexus.foeFocusArray, 'antiDroneBonusPct')).toBe(0)
    expect(coronaFocusBonusOf(b, undefined, 'rangeBonusPct')).toBe(0)
    expect(foeGunMaxRangeOf(clock(120_000), {}, nexus.weapons[0]!)).toBe(nexus.weapons[0]!.maxRangeM)
  })

  it('满层扩展段能造成伤害，满层衰减 = 1；压制仍能抵消增程', () => {
    const b = clock(120_000)
    const w = { ...nexus.weapons[0]!, falloff: 1 }
    expect(foeGunMaxRangeOf(b, nexus, w)).toBe(40_500)
    expect(foeGunPowerFactorOf(b, nexus, w, 30_000)).toBe(1)
    b.meFoeRangeDebuff = 0.6
    expect(foeGunMaxRangeOf(b, nexus, w)).toBe(32_400)
  })

  it('真实近防入口：0/60/120 秒单发伤害为 1/2/3 倍，僚舰不获加成', () => {
    function damage(elapsed: number, focus = true): number {
      const state = createInitialState({ nowWallMs: 0, seed: 11 })
      const b = {
        ...clock(elapsed), distanceM: 1_000,
        units: { [nexus.tag]: { hp: { s: 1, a: 1, h: 1 } } },
        pdCd: [0], droneHitAt: { foe: 10_000 + elapsed },
        dronePools: { 'player:0': { s: 10_000, a: 0, h: 0, evasion: 0, alive: true, artId: 'drone-scout', owner: 'player' } },
      } as unknown as BattleState
      resolvePointDefense(state, b, [{ ...nexus, ...(focus ? {} : { foeFocusArray: undefined }) }], { ...bal, pdAcc: 1 }, 100)
      return 10_000 - b.dronePools!['player:0']!.s
    }
    const base = damage(0)
    expect(base).toBeGreaterThan(0)
    expect(damage(60_000)).toBeCloseTo(base * 2)
    expect(damage(120_000)).toBeCloseTo(base * 3)
    expect(damage(120_000, false)).toBe(base)
    console.log(`[读数] 中枢近防单发：0s=${base} 60s=${damage(60_000)} 120s=${damage(120_000)}`)
  })

  it('真实开火门与界面射程：原 13.5km 外、满层 40.5km 内可以开火', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ids = Array.from({ length: 4 }, () => addShipToFleet(state, 'sh-thresher'))
    state.shipId = ids[0]!
    const b = startFleetBattleFor(state, ctx, ids, 'corona-nexus', 0, null)!
    b.waveIdx = 3
    advanceBattleFor(state, ctx, b, ids[0]!, 'corona-nexus')
    b.foeWaveStartMs = b.lastTickGameMs - 120_000
    b.distanceM = 30_000
    const tag = Object.values(b.units).find((u) => u.foeShipId === 'foe-r-corona-nexus')!.tag
    b.units[tag]!.weapons[0] = 0
    const seq = b.fx.at(-1)?.seq ?? -1
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, ids[0]!, 'corona-nexus')
    const hits = b.fx.filter((fx) => fx.seq > seq && fx.tag === tag && (fx.dmg ?? 0) > 0)
    expect(hits.length, '聚焦扩展段中枢实际开火且造成伤害').toBeGreaterThan(0)
    const arcs = battleArcsFor(state, ctx, { battle: b, anomaly: ctx.anomalies.get('corona-nexus')!, leaderShipId: ids[0]! })!
    expect(arcs.foe.maxM, '界面与开火门共享动态射程').toBe(40_500)
  })
})

describe('垂暮：闪现后 2 秒护盾宽限', () => {
  it('触发前、触发当刻、1999ms、2000ms、冷却结束边界', () => {
    const readyAt = 13_000
    expect(standbyShieldActiveOf(dusk, undefined, 0)).toBe(true)
    expect(standbyShieldActiveOf(dusk, readyAt, 1_000)).toBe(true)
    expect(standbyShieldActiveOf(dusk, readyAt, 2_999)).toBe(true)
    expect(standbyShieldActiveOf(dusk, readyAt, 3_000)).toBe(false)
    expect(standbyShieldActiveOf(dusk, readyAt, 12_999)).toBe(false)
    expect(standbyShieldActiveOf(dusk, readyAt, 13_000)).toBe(true)
    expect(standbyShieldActiveOf({}, readyAt, 1_000)).toBe(false)
  })

  it('宽限结束同拍保持快照，下一拍重新计算', () => {
    const b = { lastTickGameMs: 2_999, foeBlinks: { [dusk.tag]: 13_000 } }
    expect(foeStandbyReadyOf(b, dusk)).toBe(true)
    b.foeBlinks[dusk.tag] = 12_999
    expect(foeStandbyReadyOf(b, dusk)).toBe(true)
    b.lastTickGameMs = 3_000
    expect(foeStandbyReadyOf(b, dusk)).toBe(false)
  })
})

it('叠光敌舰 4500ms 起步、步长 400ms；玩家武器不变', () => {
  expect(FOE_SHIPS.find((s) => s.id === 'foe-r-corona-overlay')!.reloadMs).toBe(4_500)
  expect(activeFoeSpecsOf(ctx.anomalies.get('corona-converge')!, bal, 1)
    .find((f) => f.foeShipId === 'foe-r-corona-overlay')!.foeOverlayDrive)
    .toEqual({ stepMs: 400, floorMs: 500, dmgMul: 0.3 })
  expect(ctx.modules.get('mod-lair-laser-r')!.overlayDrive).toEqual({ stepMs: 300, floorMs: 600 })
})
