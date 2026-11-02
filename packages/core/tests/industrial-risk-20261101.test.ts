import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { INDUSTRIAL_ENCOUNTER_DEFAULTS } from '../src/encounters/config'
import { industrialThreatOf, industrialFrequencyOf } from '../src/encounters/risk'
import { pirateFormationOf } from '../src/encounters/pirateFormation'
import { createFoeSpecs } from '../src/combat/foes/catalog'
import { foeStrengthOf } from '../src/combat/foes/catalog'
import { cleanPirateCard } from '../src/encounters/save'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { startBattleFor } from '../src/combat/startSingle'
import { advanceBattleFor } from '../src/combat/advance'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const config = INDUSTRIAL_ENCOUNTER_DEFAULTS

describe('工业遇袭统一威胁与旋钮', () => {
  it('默认公式、合法0与两活动参数独立', () => {
    const profiles = structuredClone(config.threat.profiles)
    expect(industrialThreatOf(60, 24_000_000, 10_000, profiles.mining).targetThreat).toBe(95)
    profiles.mining.cargoThreatWeight = 0
    expect(industrialThreatOf(60, 24_000_000, 10_000, profiles.mining).targetThreat).toBe(83)
    expect(industrialThreatOf(60, 24_000_000, 10_000, profiles.hauling).targetThreat).toBe(95)
    expect(() => industrialThreatOf(60, 0, 1, { ...profiles.hauling, cargoVolumeScaleM3: 0 })).toThrow()
    expect(() => industrialThreatOf(60, -1, 1, profiles.hauling)).toThrow()
    expect(() => industrialThreatOf(NaN, 0, 1, profiles.hauling)).toThrow()
  })

  it('护航只降频，且频率与威胁参数分离', () => {
    expect(industrialFrequencyOf(24_000_000, 20_000_000, config.frequency).escortMul).toBeCloseTo(0.65)
    expect(industrialFrequencyOf(0, 0, { ...config.frequency, escortChanceMaxReduction: 0, industrialChanceMaxBonus: 0 }).multiplier).toBe(1)
  })

  it.each([10, 30, 60, 100, 150])('目标威胁%s共用生成配置且不超预算', target => {
    for (const seed of [1, 2, 7, 111]) {
      const a = pirateFormationOf(target, seed, config.formation, ctx.foeShips!, ctx.balance.battle)
      const b = pirateFormationOf(target, seed, config.formation, ctx.foeShips!, ctx.balance.battle)
      expect(a).toEqual(b)
      if (!a) continue
      expect(a.realizedThreat).toBeLessThanOrEqual(target)
      expect(a.card.ships!.length).toBeLessThanOrEqual(36)
      expect(a.card.waves!.length).toBeLessThanOrEqual(3)
      expect(a.card.ships!.every(row => row.ship.family === 'A')).toBe(true)
      const specials = a.card.ships!.filter(row => row.ship.id === 'foe-pirate-raider').length
      expect(specials).toBeLessThanOrEqual(target < 60 ? 0 : target < 100 ? 1 : 2)
      const specs = a.card.waves!.flatMap((_, wave) => createFoeSpecs(a.card, ctx.balance.battle, { tagPrefix: wave ? `w${wave}-` : '' }))
      expect(new Set(specs.map(spec => spec.tag)).size).toBe(a.card.ships!.length)
      for (let wave = 0; wave < a.card.waves!.length; wave++) expect(a.card.ships!.filter(row => (row.wave ?? 0) === wave).length).toBeLessThanOrEqual(12)
    }
  })

  it('196威胁追加多波并有限增幅，三层规格随档且不二次放大', () => {
    const generated = pirateFormationOf(196, 59, config.formation, ctx.foeShips!, ctx.balance.battle)!
    expect(generated.card.waves!.length).toBe(3)
    expect(generated.realizedThreat).toBeLessThanOrEqual(196)
    expect(generated.card.pirateGeneration!.statMultiplier).toBeGreaterThan(1)
    expect(generated.card.pirateGeneration!.statMultiplier).toBeLessThanOrEqual(2)
    const restored = cleanPirateCard(JSON.parse(JSON.stringify(generated.card)))!
    expect(restored).toBeDefined()
    expect(foeStrengthOf(restored, ctx.balance.battle)).toEqual(foeStrengthOf(generated.card, ctx.balance.battle))
    for (let wave = 0; wave < 3; wave++) {
      const options = { tagPrefix: wave ? `w${wave}-` : '' }
      expect(createFoeSpecs(restored, ctx.balance.battle, options)).toEqual(createFoeSpecs(generated.card, ctx.balance.battle, options))
    }
  })

  it('波数1、增幅1可恢复旧单波规格，已抽首波船型不被替换', () => {
    const single = pirateFormationOf(196, 59, { ...config.formation, maxWaves: 1, maxStatMultiplier: 1 }, ctx.foeShips!, ctx.balance.battle)!
    const multiple = pirateFormationOf(196, 59, config.formation, ctx.foeShips!, ctx.balance.battle)!
    expect(multiple.card.ships!.slice(0, single.card.ships!.length).map(row => row.ship.id)).toEqual(single.card.ships!.map(row => row.ship.id))
    expect(single.card.waves).toHaveLength(1)
    for (const spec of createFoeSpecs(multiple.card, ctx.balance.battle)) {
      const old = createFoeSpecs(single.card, ctx.balance.battle).find(row => row.tag === spec.tag)!
      expect(spec.speedMps).toBe(old.speedMps)
      expect(spec.resists).toEqual(old.resists)
      expect(spec.weapons.map(w => [w.minRangeM, w.maxRangeM, w.hitRate, w.reloadMs])).toEqual(old.weapons.map(w => [w.minRangeM, w.maxRangeM, w.hitRate, w.reloadMs]))
    }
    const legacy = structuredClone(single.card)
    delete legacy.pirateGeneration
    expect(cleanPirateCard(JSON.parse(JSON.stringify(legacy)))).toBeDefined()
  })

  it('极高预算仍止于3波2倍，损坏波次与倍率不接受', () => {
    const generated = pirateFormationOf(1000, 59, config.formation, ctx.foeShips!, ctx.balance.battle)!
    expect(generated.card.ships).toHaveLength(36)
    expect(generated.card.pirateGeneration!.statMultiplier).toBe(2)
    expect(generated.unusedStrength).toBeGreaterThan(0)
    const bad = structuredClone(generated.card)
    bad.waves = [{ units: 36, hpShare: 1 }]
    expect(cleanPirateCard(bad)).toBeUndefined()
    expect(() => pirateFormationOf(196, 1, { ...config.formation, maxStatMultiplier: 3 }, ctx.foeShips!, ctx.balance.battle)).toThrow()
  })

  it('换波等待期间读档保留后续波，双方损伤和弹药不免费恢复', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 59 })
    state.shipId = addShipToFleet(state, 'sh-shrike')
    const generated = pirateFormationOf(196, 59, config.formation, ctx.foeShips!, ctx.balance.battle)!
    const battle = startBattleFor(state, ctx, state.shipId, generated.card.id, 0, undefined, { generatedCard: generated.card })!
    state.encounter = { ...state.encounter, active: true, shipId: state.shipId, galaxyId: 'galaxy-cinder',
      anomalyId: generated.card.id, name: generated.card.name, threat: generated.realizedThreat, battle }
    for (const unit of Object.values(battle.units)) {
      unit.weapons.fill(600_000)
      if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
    }
    battle.units.player!.hp.h = Math.floor(battle.units.player!.hp.h * 0.75)
    const playerHp = structuredClone(battle.units.player!.hp)
    const ammo = structuredClone(battle.ammo)
    state.gameMs = 100
    advanceBattleFor(state, ctx, battle, state.shipId, generated.card.id)
    expect(battle.waveIdx ?? 0).toBe(0)
    expect(battle.waveClearAt).toBeDefined()
    const restored = loadSaveFile(serializeSaveFile(state)).state
    expect(restored.encounter.battle!.foeOverride!.generatedCard).toBeDefined()
    for (const current of [state, restored]) {
      current.gameMs = 4000
      advanceBattleFor(current, ctx, current.encounter.battle!, current.shipId, generated.card.id)
      expect(current.encounter.battle!.waveIdx).toBe(1)
      expect(current.encounter.battle!.ended).toBeNull()
      expect(current.encounter.battle!.ammo).toEqual(ammo)
      expect(current.encounter.battle!.units.player!.hp).toEqual(playerHp)
      expect(Object.keys(current.encounter.battle!.units).filter(tag => tag.startsWith('w1-'))).toHaveLength(generated.card.waves![1]!.units)
    }
    expect(restored.encounter.battle!.units).toEqual(state.encounter.battle!.units)
  })
})
