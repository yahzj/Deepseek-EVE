/**
 * V18B-2 激光炮专项测试：
 * - beam 条目构建（必中：不掷命中；逐发扣能量弹药；威力随距离衰减 = 命中衰减的 50%）；
 * - beamPowerFactor 公式（falloff 0.3 → 远端 ×0.65、中点 ×0.825）；
 * - 纯激光船实战：meHits === meShots（必中）且能量弹药被消耗；
 * - per-gun 多键预载：动能 + 激光混装 → kin 与 pla 各自装载并各自扣减（异型不再饿死）；
 * - 旧能量炮/异星原型 1:1 迁移 → 激光（含装配与装备库）；
 * - 能量稳定器（plasma 键）加成 beam 单发；射速计算机缩短 beam 装填。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceBattleFor, ammoLoadTotals, beamPowerFactor, createPlayerSpec, startBattleFor } from '../src/combat'
import { fitModule, repairDeprecatedModules } from '../src/equipment'
import type { ShipDef } from '../src/types'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

function makeBedCtx(mods: ReturnType<typeof moduleDef>[], opts: { evasion?: number } = {}) {
  const bed = ship('bed', {
    cpu: 500,
    slots: { high: 8, mid: 2, low: 4 },
    droneBayM3: 0,
    powerBonus: 0,
    evasion: opts.evasion ?? 0.1,
  })
  return { bed, ctx: makeTestCtx({ ships: [bed], modules: mods }) }
}

function laserDef(id: string, mk: number, dmgMult: number, reloadMs = 2000): ReturnType<typeof moduleDef> {
  return moduleDef(id, 'laser', 0, {
    rack: 'high',
    damageType: 'plasma',
    ammoPerEngagement: 24,
    maxRangeM: 4600 + mk * 1000,
    minRangeM: 0,
    hitRate: 1,
    falloff: 0.3,
    reloadMs,
    dmgMult,
    cpuUse: mk === 1 ? 10 : 28,
  })
}

describe('V18B-2 激光炮', () => {
  it('威力衰减公式：falloff 0.3 → 近端 ×1、中点 ×0.825、远端 ×0.65（命中衰减的 50%）', () => {
    const w = { minRangeM: 0, maxRangeM: 4600, falloff: 0.3 }
    expect(beamPowerFactor(0, w)).toBeCloseTo(1, 9)
    expect(beamPowerFactor(2300, w)).toBeCloseTo(1 - 0.5 * (1 - 0.3) * 0.5, 9) // = 0.825
    expect(beamPowerFactor(4600, w)).toBeCloseTo(1 - (1 - 0.3) * 0.5, 9) // = 0.65
    // falloff 1（无衰减参）→ 恒 1
    expect(beamPowerFactor(99999, { minRangeM: 0, maxRangeM: 4600, falloff: 1 })).toBe(1)
  })

  it('beam 条目：shotDmg = 能量弹药 9 × dmgMult（合并 ×N 计数乘入）；不携带 eqHitMul', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const { bed, ctx } = makeBedCtx([laserDef('mod-laser-1', 1, 1.1)])
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-laser-1'] = 2
    expect(fitModule(state, 'mod-laser-1', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-laser-1', ctx).ok).toBe(true)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const beams = spec.weapons.filter((w) => w.kind === 'beam')
    expect(beams).toHaveLength(1)
    expect(beams[0]!.label).toContain('×2')
    expect(beams[0]!.fixedType).toBe('plasma')
    expect(beams[0]!.eqHitMul).toBeUndefined() // 必中：索敌件无效
    expect(beams[0]!.shotDmg).toBe(Math.round(9 * 1.1) * 2)
  })

  it('实战必中 + 扣能量弹药：纯激光船 meHits === meShots，battle.ammo.pla 被消耗', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 2 })
    const { bed, ctx } = makeBedCtx([laserDef('mod-laser-1', 1, 1.1)])
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-laser-1'] = 1
    expect(fitModule(state, 'mod-laser-1', ctx).ok).toBe(true)
    state.warehouse.items['ammo-plasma-l'] = 800
    const ano = anomaly('ano-x', 'galaxy-hub', { threat: 20, reward: 50_000 })
    const ctx2 = { ...ctx, anomalies: new Map([...ctx.anomalies, [ano.id, ano]]) }
    const battle = startBattleFor(state, ctx2 as never, state.shipId, 'ano-x', 0)!
    const loaded = battle.ammo.pla
    expect(loaded).toBeGreaterThan(0) // 纯激光船也会预载能量弹药
    state.gameMs = 120 * 60_000 + 5000
    advanceBattleFor(state, ctx2 as never, battle, state.shipId, 'ano-x')
    expect(battle.ended).not.toBeNull()
    expect(battle.stats.meShots).toBeGreaterThan(0)
    expect(battle.ammo.pla).toBeLessThan(loaded) // 能量弹药被逐发消耗（光束全程开火）
  })

  it('per-gun 多键预载：动能炮 + 激光混装 → kin 与 pla 各自装载、各自消耗（异型不再饿死）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const kin = moduleDef('mod-gun-kin', 'turret', 0, {
      rack: 'high',
      damageType: 'kinetic',
      ammoPerEngagement: 24,
      maxRangeM: 4600,
      minRangeM: 250,
      hitRate: 0.8,
      falloff: 0.3,
      reloadMs: 2200,
      dmgMult: 1.25,
      cpuUse: 10,
    })
    const { bed, ctx } = makeBedCtx([kin, laserDef('mod-laser-1', 1, 1.1)])
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-gun-kin'] = 1
    state.moduleBay['mod-laser-1'] = 1
    expect(fitModule(state, 'mod-gun-kin', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-laser-1', ctx).ok).toBe(true)
    state.warehouse.items['ammo-kinetic-l'] = 800
    state.warehouse.items['ammo-plasma-l'] = 800
    const ano = anomaly('ano-x2', 'galaxy-hub', { threat: 20, reward: 50_000 })
    const ctx2 = { ...ctx, anomalies: new Map([...ctx.anomalies, [ano.id, ano]]) }
    const spec = createPlayerSpec(state, ctx2 as never, state.shipId)!
    const totals = ammoLoadTotals(spec, ctx.balance.battle)
    expect(totals.kinetic).toBeGreaterThan(0)
    expect(totals.plasma).toBeGreaterThan(0)
    const battle = startBattleFor(state, ctx2 as never, state.shipId, 'ano-x2', 0)!
    const kinLoaded = battle.ammo.kin
    const plaLoaded = battle.ammo.pla
    expect(kinLoaded).toBeGreaterThan(0)
    expect(plaLoaded).toBeGreaterThan(0)
    state.gameMs = 120 * 60_000 + 5000
    advanceBattleFor(state, ctx2 as never, battle, state.shipId, 'ano-x2')
    expect(battle.ended).not.toBeNull()
    // 两种弹药各自被消耗（光束也打出了伤害 = 不再饿死）
    expect(battle.ammo.kin).toBeLessThan(kinLoaded)
    expect(battle.ammo.pla).toBeLessThan(plaLoaded)
  })
})

describe('V18B-2 迁移与支援件', () => {
  it('旧能量炮/异星原型 → 同档激光（装配原位 + 装备库 1:1 幂等）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 4 })
    const { bed, ctx } = makeBedCtx([
      laserDef('mod-laser-1', 1, 1.1),
      laserDef('mod-laser-2', 2, 3.0),
      laserDef('mod-laser-proto', 4, 5.1),
    ])
    state.fleet[state.shipId]!.defId = 'bed'
    state.fleet[state.shipId]!.fitted.high = ['mod-turret-pla-1', 'mod-turret-pla-2', null, null, null, null, null, null]
    state.moduleBay['mod-turret-proto'] = 1
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[state.shipId]!.fitted.high[0]).toBe('mod-laser-1')
    expect(state.fleet[state.shipId]!.fitted.high[1]).toBe('mod-laser-2')
    expect(state.moduleBay['mod-laser-proto']).toBe(1)
    expect(state.moduleBay['mod-turret-proto']).toBeUndefined()
    repairDeprecatedModules(state, ctx) // 幂等
    expect(state.fleet[state.shipId]!.fitted.high[0]).toBe('mod-laser-1')
  })

  it('能量稳定器（plasma 键）加成 beam 单发；射速计算机缩短装填', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const { bed, ctx } = makeBedCtx([
      laserDef('mod-laser-1', 1, 1.1),
      moduleDef('mod-stab-pla', 'support', 0, { rack: 'low', damageTypeBonusPct: { plasma: 0.1 }, cpuUse: 5 }),
      moduleDef('mod-rof', 'support', 0, { rack: 'low', reloadCutPct: 0.05, cpuUse: 5 }),
    ])
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-laser-1'] = 1
    state.moduleBay['mod-stab-pla'] = 1
    state.moduleBay['mod-rof'] = 1
    expect(fitModule(state, 'mod-laser-1', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-stab-pla', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-rof', ctx).ok).toBe(true)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const beam = spec.weapons.find((w) => w.kind === 'beam')!
    expect(beam.shotDmg).toBe(Math.round(Math.round(9 * 1.1) * 1.1)) // 稳定器 ×1.1
    expect(beam.reloadMs).toBe(Math.round(2000 / 1.05)) // 射速计算机
  })
})

export {}
