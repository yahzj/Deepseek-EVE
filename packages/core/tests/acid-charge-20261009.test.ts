import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildSimContext, ALIEN_INVASION_CHARGE_MUL } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { advanceBattleFor, startBattleFor, createFoeSpecs } from '../src/combat'
import { FOE_MOUNT_IDS, resolveFoeMounts } from '../src/foeMounts'
import parameters from '../src/static/foeMounts.json'

const ctx = buildSimContext()
function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 611 })
  const uid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  const ship = ctx.foeShips!.get('foe-alien-acid-burster')!
  const card = { ...ctx.anomalies.get('alien-vanguard')!, id: 'acid-charge-test', waves: undefined, ships: [{ ship, count: 1 }] }
  const local = { ...ctx, anomalies: new Map([...ctx.anomalies, [card.id, card]]) }
  const battle = startBattleFor(state, local, uid, card.id, 0, 10000)!
  battle.distanceM = 10000
  for (const unit of Object.values(battle.units)) {
    delete unit.enteredAtMs
    unit.weapons = unit.weapons.map(() => 1e9)
  }
  return { state, uid, local, card, battle }
}

describe('爆虫专属冲锋减速', () => {
  it('静态挂件只调整爆虫倍率，其余挂件逐字段不变', () => {
    const before = JSON.parse(execFileSync('git', ['show', '22edc1ce:packages/core/src/static/foeMounts.json'], { encoding: 'utf8' }))
    before.groups.parameters.find((row: { id: string }) => row.id === FOE_MOUNT_IDS.acidCharge).charge_mul = 2.5
    expect(parameters).toEqual(before)
    expect(ALIEN_INVASION_CHARGE_MUL).toEqual({ 'foe-alien-acid-burster': 2.5, 'foe-alien-hiveback': 1.5, 'foe-alien-broodmother': 1.25 })
    expect(resolveFoeMounts([FOE_MOUNT_IDS.acidCharge])).toMatchObject({ foeChargeMul: 2.5, foeChargeCooldownMs: 10000, foeChargeWebImmune: true })
  })
  it('四张入侵卡实际规格同为714基础/1785冲锋，自爆参数与破盾乘区不变', () => {
    for (const id of ['alien-vanguard', 'alien-escort', 'alien-main', 'alien-broodmother']) {
      const card = ctx.anomalies.get(id)!
      const units = createFoeSpecs(card, ctx.balance.battle).filter(unit => unit.acidBurst)
      const withoutCharge = { ...card, ships: card.ships!.map(slot => slot.ship.acidBurst ? { ...slot, mounts: [FOE_MOUNT_IDS.acidShield] } : slot) }
      const unchanged = createFoeSpecs(withoutCharge, ctx.balance.battle).filter(unit => unit.acidBurst)
      expect(units.length).toBeGreaterThan(0)
      for (const unit of units) {
        expect(unit.speedMps).toBe(714)
        expect(unit.foeChargeMul).toBe(2.5)
        expect(unit.speedMps * unit.foeChargeMul!).toBe(1785)
        expect(unit.acidBurst).toMatchObject({ attackRangeM: 250, deathRangeM: 300, hitRate: .95, corrosionPct: .15, shieldDamageMul: 2 })
        expect(unit.acidBurst).toEqual(unchanged.find(other => other.tag === unit.tag)!.acidBurst)
      }
    }
    expect(ctx.foeShips!.get('foe-alien-acid-burster')!.acidBurst!.damage).toBe(300)
  })
  it('真实步进触发冲锋，界面同源速度为1785而不是旧3570', () => {
    const { state, uid, local, card, battle } = world()
    state.gameMs = 100
    advanceBattleFor(state, local, battle, uid, card.id)
    expect(battle.foeCharges?.['foe-0']?.on).toBe(true)
    expect(battle.foeSpeedMps).toBe(1785)
    expect(battle.distanceM).toBeLessThan(10000)
    expect(battle.acidBursts).toBeUndefined()
  })
  it('10秒冷却内回基础速度，到期可重新冲锋，不改变近距主动自爆', () => {
    const { state, uid, local, card, battle } = world()
    battle.foeCharges = { 'foe-0': { on: false, cdUntilMs: 10000 } }
    state.gameMs = 100
    advanceBattleFor(state, local, battle, uid, card.id)
    expect(battle.foeSpeedMps).toBe(714)
    expect(battle.foeCharges['foe-0']!.on).toBe(false)
    battle.distanceM = 10000
    battle.lastTickGameMs = 10000
    state.gameMs = 10010
    advanceBattleFor(state, local, battle, uid, card.id)
    expect(battle.foeSpeedMps).toBe(1785)
    battle.distanceM = 200
    state.gameMs += 100
    advanceBattleFor(state, local, battle, uid, card.id)
    expect(battle.acidBursts?.['foe-0']?.cause).toBe('attack')
    expect(battle.alienCorrosion).toBe(.15)
  })
})
