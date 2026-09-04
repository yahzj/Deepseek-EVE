/**
 * V18B-1 导弹架专项测试：
 * - 装配与战斗条目（explosive 键、同 id ×N 合并齐射）；
 * - 性格差异：无视近盲（minRange 0）+ 命中不随距离衰减（falloff 1，追踪制）；
 * - 旧高爆炮 1:1 无损迁移（fitted 装配件 + 装备库库存）；
 * - 主弹装载：第一武器为导弹架 → playerAmmoType = explosive；
 * - 爆炸系伤害稳定器（+%）加成导弹单发（与动能炮同理按系加算）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { createPlayerSpec, hitChance, inRange, loadAmmo, playerAmmoType } from '../src/combat'
import { fitModule, repairDeprecatedModules } from '../src/equipment'
import type { ShipDef } from '../src/types'
import { makeTestCtx, moduleDef, ship } from './helpers'

function makeBedCtx(mods: ReturnType<typeof moduleDef>[]) {
  const bed = ship('bed', {
    cpu: 400,
    slots: { high: 6, mid: 2, low: 2 },
    droneBayM3: 0,
    powerBonus: 0,
  })
  return { bed, ctx: makeTestCtx({ ships: [bed], modules: mods }) }
}

function missileDef(id: string, mk: number, reloadMs: number, dmgMult: number): ReturnType<typeof moduleDef> {
  return moduleDef(id, 'missile', 0, {
    rack: 'high',
    damageType: 'explosive',
    ammoPerEngagement: 24,
    maxRangeM: 5000 + mk * 1000,
    minRangeM: mk === 1 ? 500 : mk === 2 ? 900 : 1400, // V18B-2 修正：近盲安全射距（防自爆）
    hitRate: 0.92,
    falloff: 1,
    reloadMs,
    dmgMult,
    cpuUse: mk === 1 ? 10 : 28,
  })
}

describe('V18B-1 导弹架', () => {
  it('装配合法：导弹架入高槽；spec 生成 gun 条目（爆破导弹 explosive 键）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const { bed, ctx } = makeBedCtx([missileDef('mod-missile-1', 1, 2600, 1.25)])
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-missile-1'] = 1
    expect(fitModule(state, 'mod-missile-1', ctx).ok).toBe(true)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const gun = spec.weapons.find((w) => w.kind === 'gun' && w.shotsByType?.explosive !== undefined)
    expect(gun).toBeDefined()
    // 弹 7（爆破导弹）× dmgMult 1.25 × 1 = 8.75 → round 9
    expect(gun!.shotsByType!.explosive).toBe(Math.round(7 * 1.25))
    expect(gun!.minRangeM).toBe(500) // V18B-2 修正：近盲安全射距（太近会炸到自己）
    expect(gun!.falloff).toBe(1) // 追踪制
  })

  it('同 id 两架 → ×N 合并齐射（标签 ×2、值 ×2）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 2 })
    const { bed, ctx } = makeBedCtx([missileDef('mod-missile-2', 2, 4000, 3.66)])
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-missile-2'] = 2
    expect(fitModule(state, 'mod-missile-2', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-missile-2', ctx).ok).toBe(true)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const gun = spec.weapons.find((w) => w.kind === 'gun' && w.shotsByType?.explosive !== undefined)!
    expect(gun.label).toContain('×2')
    expect(gun.shotsByType!.explosive).toBe(Math.round(7 * 3.66) * 2)
  })

  it('性格：近盲安全射距（带内才可发射）+ 命中不随距离衰减（远端命中率 = 近端）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const { bed, ctx } = makeBedCtx([missileDef('mod-missile-1', 1, 2600, 1.25)])
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-missile-1'] = 1
    expect(fitModule(state, 'mod-missile-1', ctx).ok).toBe(true)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const missile = spec.weapons.find((w) => w.kind === 'gun')!
    const bal = ctx.balance.battle
    const foe = { evasion: 0, signatureM: undefined }
    const me = { hitBonus: 0, scanResMm: undefined }
    // 近盲带内（< 500 m）不可发射——贴近了会炸到自己
    expect(inRange(300, missile)).toBe(false)
    expect(inRange(0, missile)).toBe(false)
    // 导弹命中率近端 = 远端（falloff 1 → distFactor 恒 1；带内 800 vs 5900）
    const near = hitChance(missile, me, foe, 800, bal)
    const far = hitChance(missile, me, foe, 5900, bal) // 5900/6000 ≈ 98% 处
    expect(near).toBeCloseTo(far, 9)
    // 命中 = (0.92 + 0) × 1 − 0 = 0.92
    expect(near).toBeCloseTo(Math.min(bal.hitMax, Math.max(bal.hitMin, 0.92)), 9)
    // 对照：动能炮（falloff 0.3）远端命中显著低于近端
    const kin = moduleDef('mod-gun', 'turret', 0, {
      rack: 'high',
      damageType: 'kinetic',
      maxRangeM: 4600,
      minRangeM: 250,
      hitRate: 0.8,
      falloff: 0.3,
      reloadMs: 2200,
      dmgMult: 1.25,
      cpuUse: 10,
    })
    const kinNear = hitChance(kin as never, me, foe, 300, bal)
    const kinFar = hitChance(kin as never, me, foe, 4500, bal)
    expect(kinFar).toBeLessThan(kinNear)
  })

  it('迁移：旧高爆炮（装配 + 装备库）1:1 → 同档导弹架', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 4 })
    const { bed, ctx } = makeBedCtx([missileDef('mod-missile-1', 1, 2600, 1.25), missileDef('mod-missile-2', 2, 4000, 3.66)])
    state.fleet[state.shipId]!.defId = 'bed'
    // 旧档现场：fitted 里装着高爆炮 MK1（目录外 id），装备库有 MK2 ×2
    state.fleet[state.shipId]!.fitted.high = ['mod-turret-exp-1', null, null, null, null, null]
    state.moduleBay['mod-turret-exp-2'] = 2
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[state.shipId]!.fitted.high[0]).toBe('mod-missile-1')
    expect(state.moduleBay['mod-missile-2']).toBe(2)
    expect(state.moduleBay['mod-turret-exp-2']).toBeUndefined()
    // repair 幂等
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[state.shipId]!.fitted.high[0]).toBe('mod-missile-1')
  })

  it('主弹装载：第一武器为导弹架 → explosive 键（爆破导弹）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const { bed, ctx } = makeBedCtx([missileDef('mod-missile-1', 1, 2600, 1.25)])
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-missile-1'] = 1
    expect(fitModule(state, 'mod-missile-1', ctx).ok).toBe(true)
    expect(playerAmmoType(state, ctx, state.shipId)).toBe('explosive')
    state.warehouse.items['ammo-explosive-l'] = 100
    const loaded = loadAmmo(state, ctx, 'explosive', 50)
    expect(loaded.exp).toBe(50)
    expect(loaded.kin).toBe(0)
    expect(loaded.pla).toBe(0)
  })

  it('爆炸系伤害稳定器按系加成导弹单发（与动能炮同池逻辑）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 6 })
    const { bed, ctx } = makeBedCtx([
      missileDef('mod-missile-1', 1, 2600, 1.25),
      moduleDef('mod-stab-exp', 'support', 0, { rack: 'low', damageTypeBonusPct: { explosive: 0.1 }, cpuUse: 5 }),
    ])
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-missile-1'] = 1
    state.moduleBay['mod-stab-exp'] = 1
    expect(fitModule(state, 'mod-missile-1', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-stab-exp', ctx).ok).toBe(true)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const gun = spec.weapons.find((w) => w.kind === 'gun' && w.shotsByType?.explosive !== undefined)!
    expect(gun.shotsByType!.explosive).toBe(Math.round(Math.round(7 * 1.25) * 1.1))
  })
})

export {}
