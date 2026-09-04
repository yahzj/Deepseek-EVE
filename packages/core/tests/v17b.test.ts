/**
 * V17.2/V18 武器测试：炮族制（炮台固定弹种单键、任意船可装任意 MK——口径限制已按船长
 * 指示移除：弹药每型单档、火力并入炮卡倍率；旧重弹 1:1 并入通用弹）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { createPlayerSpec, loadAmmo, playerAmmoType } from '../src/combat'
import { fitModule, migrateDeprecatedAmmo, repairDeprecatedModules } from '../src/equipment'
import { makeTestCtx, moduleDef } from './helpers'

/** 速造一门炮（无口径；type = 固定弹种；range 风格随参） */
function turret(
  id: string,
  type: 'kinetic' | 'explosive' | 'plasma',
  opts?: { cpuUse?: number; dmgMult?: number; maxRangeM?: number },
) {
  return moduleDef(id, 'turret', 0, {
    damageType: type,
    maxRangeM: opts?.maxRangeM ?? 4600,
    minRangeM: 250,
    hitRate: 0.8,
    falloff: 0.3,
    reloadMs: 2200,
    dmgMult: opts?.dmgMult ?? 1.25,
    cpuUse: opts?.cpuUse ?? 10,
  })
}

describe('炮族制：炮台固定弹种（口径取消后）', () => {
  it('createPlayerSpec：gun 只填弹种单键；换炮换型；playerAmmoType 同源', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({ modules: [turret('tur-kin', 'kinetic'), turret('tur-pla', 'plasma')] })
    expect(playerAmmoType(state, ctx, 'sandcat')).toBe('kinetic') // 无炮 = kinetic（不实际消耗）

    state.moduleBay['tur-kin'] = 1
    expect(fitModule(state, 'tur-kin', ctx).ok).toBe(true)
    expect(playerAmmoType(state, ctx, 'sandcat')).toBe('kinetic')
    const gunK = createPlayerSpec(state, ctx, 'sandcat')!.weapons.find((w) => w.kind === 'gun')!
    expect(Object.keys(gunK.shotsByType ?? {})).toEqual(['kinetic'])

    // 换能量炮：单键换型
    state.fleet[state.shipId].fitted.high[0] = null
    state.moduleBay['tur-pla'] = 1
    expect(fitModule(state, 'tur-pla', ctx).ok).toBe(true)
    expect(playerAmmoType(state, ctx, 'sandcat')).toBe('plasma')
    const gunP = createPlayerSpec(state, ctx, 'sandcat')!.weapons.find((w) => w.kind === 'gun')!
    expect(Object.keys(gunP.shotsByType ?? {})).toEqual(['plasma'])
  })

  it('无口径限制：轻型采矿船也能装高 MK 远程炮（只受 CPU/槽约束）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const heavy = turret('tur-mk3', 'explosive', { cpuUse: 52, dmgMult: 5.03, maxRangeM: 10_500 })
    const ctx = makeTestCtx({ modules: [heavy] })
    state.moduleBay['tur-mk3'] = 1
    // sandcat = industrial（旧口径制只适配轻型炮）——现在可直接装
    expect(fitModule(state, 'tur-mk3', ctx).ok).toBe(true)
    expect(state.fleet[state.shipId].fitted.high[0]).toBe('tur-mk3')
  })

  it('单型装载：只装固定弹种型（通用弹单档），其它型库存不碰', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    state.warehouse.items['ammo-kinetic-l'] = 50
    state.warehouse.items['ammo-explosive-l'] = 80
    const ctx = makeTestCtx()
    const loaded = loadAmmo(state, ctx, 'kinetic', 30)
    expect(loaded.kin).toBe(30)
    expect(loaded.exp).toBe(0)
    expect(state.warehouse.items['ammo-explosive-l']).toBe(80) // 非本型库存不动
  })
})

describe('口径取消：迁移（重弹并入通用弹；旧炮迁移动能款原位保留）', () => {
  it('migrateDeprecatedAmmo：-h 库存/货仓/escrow 1:1 并入 -l，挂单撤销', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.warehouse.items['ammo-kinetic-h'] = 50
    state.fleet[state.shipId].cargo['ammo-explosive-h'] = 20
    state.escrowItems['ammo-plasma-h'] = 30
    state.orders.push({
      id: 99,
      side: 'sell',
      good: 'ammo-plasma-h',
      price: 18,
      qty: 30,
      filled: 0,
      placedAtGameMs: 0,
    })
    migrateDeprecatedAmmo(state)
    // 初始档自带各型通用弹 60（createInitialState）
    expect(state.warehouse.items['ammo-kinetic-l']).toBe(110)
    expect(state.fleet[state.shipId].cargo['ammo-explosive-l']).toBe(20)
    expect(state.warehouse.items['ammo-plasma-l']).toBe(90) // 撤单退回仓库（60+30）
    expect('ammo-plasma-h' in state.escrowItems).toBe(false)
    expect(state.orders).toHaveLength(0)
    expect(state.logs.some((l) => l.text.includes('旧重型弹已按 1:1 并入通用弹'))).toBe(true)
  })

  it('旧炮迁移动能款：原位保留（无口径清退）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const ctx = makeTestCtx({
      modules: [turret('mod-turret-kin-2', 'kinetic', { cpuUse: 28, dmgMult: 3.73, maxRangeM: 8200 })],
    })
    state.fleet[state.shipId].fitted.high[0] = 'mod-turret-2' // 旧档历史装配（曾视为"轻型船超口径"）
    state.moduleBay['mod-turret-2'] = 3
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[state.shipId].fitted.high[0]).toBe('mod-turret-kin-2') // 原位迁移保留
    expect(state.moduleBay['mod-turret-kin-2']).toBe(3)
    expect('mod-turret-2' in state.moduleBay).toBe(false)
  })
})
