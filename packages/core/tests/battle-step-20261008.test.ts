import { describe, expect, it } from 'vitest'
import { advanceBattleFor, BATTLE_MAX_STEPS, BATTLE_STEP_MS, startBattleFor, steerStep } from '../src/combat'
import { createInitialState } from '../src/state'
import { anomaly, makeTestCtx, ship } from './helpers'
import type { FoeShipDef } from '../src/types'

function fixture() {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const enemy: FoeShipDef = { id: 'step-foe', name: '步进测试舰', family: 'A', hullClassTier: 1,
    hp: 1e9, split: { s: 0, a: 0, h: 1 }, speedRatio: 0, tactic: 'orbit',
    shotDmg: 180, rangeMinM: 0, rangeMaxM: 100000, reloadMs: 10000, hitRate: 1,
    falloff: 1, dmgMix: { plasma: 1 } }
  const card = { ...anomaly('step-card', 'galaxy-hub', { threat: 20 }),
    ships: [{ ship: enemy, count: 2 }] }
  const base = makeTestCtx({ ships: [ship('sandcat', { shieldHp: 0, armorHp: 0, hullHp: 100,
    maxSpeedMps: 0, evasion: 0 })], anomalies: [card] })
  const ctx = { ...base, balance: { ...base.balance, battle: { ...base.balance.battle,
    shieldRegenPerSec: 0, cannotEngageMs: 1e9, maxBattleMs: 600000 } } }
  const battle = startBattleFor(state, ctx, state.shipId, card.id, 0, 1000)!
  battle.distanceM = 1000
  const tick = (ms: number) => { state.gameMs = ms; advanceBattleFor(state, ctx, battle, state.shipId, card.id) }
  return { state, ctx, battle, tick }
}

describe('10ms步进配套语义', () => {
  it('零速度下限仍为5m/s，不随子步缩小而放大', () => {
    expect(BATTLE_STEP_MS).toBe(10)
    expect(BATTLE_MAX_STEPS * BATTLE_STEP_MS).toBe(4000000)
    for (const dt of [.01, .05, .1]) expect(steerStep(1000, 2000, 0, dt) / dt).toBe(5)
    expect(steerStep(1000, 1000, 100, .01)).toBe(0)
    expect(steerStep(1000, 1000.8, 100, .01)).toBeCloseTo(.8)
  })
  it('相差50ms的敌方两炮仍归同一100ms保险，下一窗口再重置', () => {
    const f = fixture()
    const enemies = Object.values(f.battle.units).filter(unit => unit.side === 'foe')
    expect(enemies).toHaveLength(2)
    enemies[0]!.weapons[0] = 0
    enemies[1]!.weapons[0] = 50
    f.tick(100)
    expect(f.battle.stats.foeShots).toBe(2)
    expect(f.battle.units.player!.hp.h).toBeCloseTo(20, 9)
    expect(f.battle.meVolleyDmg!.player).toBe(80)
    f.tick(110)
    expect(f.battle.meVolleyDmg).toEqual({})
    expect(f.battle.meVolleyWindow).toBe(1)
  })
  it('一次605秒补算能覆盖600秒战斗时限，不在400秒提前停算', () => {
    const f = fixture()
    for (const unit of Object.values(f.battle.units)) unit.weapons.fill(1e9)
    f.tick(605000)
    expect(f.battle.lastTickGameMs).toBe(600010)
    expect(f.battle.ended).toBe('foe')
    expect(f.battle.escapeReason).toBe('timeout')
  })
})
