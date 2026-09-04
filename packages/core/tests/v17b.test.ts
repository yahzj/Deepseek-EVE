/**
 * V17.2 武器改造测试：炮族制（炮台固定弹种单键）、口径适配校验、旧炮迁移与超口径清退、
 * 单型弹药装载。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { createPlayerSpec, loadAmmo, playerAmmoSize, playerAmmoType } from '../src/combat'
import { fitModule, repairDeprecatedModules, shipMaxWeaponSize } from '../src/equipment'
import { makeTestCtx, moduleDef, ship } from './helpers'

/** 速造一门炮 */
function turret(id: string, size: 'light' | 'heavy', type: 'kinetic' | 'explosive' | 'plasma', cpuUse = 10) {
  return moduleDef(id, 'turret', 0, {
    weaponSize: size,
    damageType: type,
    maxRangeM: size === 'heavy' ? 8200 : 4600,
    minRangeM: size === 'heavy' ? 700 : 250,
    hitRate: size === 'heavy' ? 0.78 : 0.8,
    falloff: size === 'heavy' ? 0.28 : 0.3,
    reloadMs: size === 'heavy' ? 3400 : 2200,
    dmgMult: size === 'heavy' ? 1.6 : 1.25,
    cpuUse,
  })
}

describe('V17.2：炮族制——炮台固定弹种', () => {
  it('createPlayerSpec：gun 只填弹种单键；换炮换型；playerAmmoType 同源', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({ modules: [turret('tur-kin', 'light', 'kinetic'), turret('tur-pla', 'light', 'plasma')] })
    expect(playerAmmoSize(state, ctx, 'sandcat')).toBe('light')
    expect(playerAmmoType(state, ctx, 'sandcat')).toBe('kinetic') // 无炮 = kinetic（不实际消耗）

    state.moduleBay['tur-kin'] = 1
    expect(fitModule(state, 'tur-kin', ctx).ok).toBe(true)
    expect(playerAmmoType(state, ctx, 'sandcat')).toBe('kinetic')
    const gunK = createPlayerSpec(state, ctx, 'sandcat')!.weapons.find((w) => w.kind === 'gun')!
    expect(Object.keys(gunK.shotsByType ?? {})).toEqual(['kinetic'])

    // 换能量炮（同口径轻炮）：单键换型
    state.fleet[state.shipId].fitted.turret = null
    state.moduleBay['tur-pla'] = 1
    expect(fitModule(state, 'tur-pla', ctx).ok).toBe(true)
    expect(playerAmmoSize(state, ctx, 'sandcat')).toBe('light')
    expect(playerAmmoType(state, ctx, 'sandcat')).toBe('plasma')
    const gunP = createPlayerSpec(state, ctx, 'sandcat')!.weapons.find((w) => w.kind === 'gun')!
    expect(Object.keys(gunP.shotsByType ?? {})).toEqual(['plasma'])
  })

  it('单型装载：只装固定弹种型，其它库存不碰', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    delete state.warehouse.items['ammo-kinetic-h']
    delete state.warehouse.items['ammo-explosive-h']
    state.warehouse.items['ammo-kinetic-h'] = 50
    state.warehouse.items['ammo-explosive-h'] = 80
    const ctx = makeTestCtx()
    const loaded = loadAmmo(state, ctx, 'heavy', 'kinetic', 30)
    expect(loaded.kin).toBe(30)
    expect(loaded.exp).toBe(0)
    expect(state.warehouse.items['ammo-explosive-h']).toBe(80) // 非本型库存不动
  })
})

describe('V17.2：口径适配（light/heavy）', () => {
  it('轻型船（industrial）拒绝重型炮、可装轻型炮；武装舰可装重型炮', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const heavy = turret('tur-h', 'heavy', 'explosive', 28)
    const light = turret('tur-l', 'light', 'kinetic')
    const ctx = makeTestCtx({ modules: [heavy, light] })
    state.moduleBay['tur-h'] = 1
    state.moduleBay['tur-l'] = 1
    // sandcat = industrial → light 适配
    const rH = fitModule(state, 'tur-h', ctx)
    expect(rH.ok).toBe(false)
    expect(rH.error).toContain('口径')
    expect(state.fleet[state.shipId].fitted.turret).toBeNull()
    expect(state.moduleBay['tur-h']).toBe(1) // 未扣库
    expect(fitModule(state, 'tur-l', ctx).ok).toBe(true)

    // 换驾驶船为武装舰（defId 指向 warship）→ 重炮可装
    const war = ship('warship', { cpu: 300 })
    war.role = 'armed'
    const ctxW = makeTestCtx({ ships: [war], modules: [heavy] })
    state.fleet[state.shipId].defId = 'warship'
    state.fleet[state.shipId].fitted.turret = null
    expect(fitModule(state, 'tur-h', ctxW).ok).toBe(true)
    expect(state.fleet[state.shipId].fitted.turret).toBe('tur-h')
  })

  it('shipMaxWeaponSize：armed/armored → heavy；industrial/hauler → light；显式覆盖优先', () => {
    expect(shipMaxWeaponSize({ role: 'armed' })).toBe('heavy')
    expect(shipMaxWeaponSize({ role: 'armored' })).toBe('heavy')
    expect(shipMaxWeaponSize({ role: 'industrial' })).toBe('light')
    expect(shipMaxWeaponSize({ role: 'hauler' })).toBe('light')
    expect(shipMaxWeaponSize({ role: 'industrial', maxWeaponSize: 'heavy' })).toBe('heavy')
    expect(shipMaxWeaponSize({ role: 'armed', maxWeaponSize: 'light' })).toBe('light')
  })
})

describe('V17.2：旧炮迁移与超口径清退', () => {
  it('旧重炮迁移动能款：装在小船（light 适配）上的历史装配被卸下退回（不丢资产）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const ctx = makeTestCtx({ modules: [turret('mod-turret-kin-2', 'heavy', 'kinetic', 28)] })
    state.fleet[state.shipId].fitted.turret = 'mod-turret-2' // 旧档：轻型船装旧重炮
    state.moduleBay['mod-turret-2'] = 3
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[state.shipId].fitted.turret).toBeNull() // 超口径 → 卸下
    expect(state.moduleBay['mod-turret-kin-2']).toBe(4) // 装备库迁移 3 + 退回 1
    expect('mod-turret-2' in state.moduleBay).toBe(false)
  })

  it('重炮装武装舰：迁移后原位保留', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const war = ship('warship', { cpu: 300 })
    war.role = 'armed'
    const ctx = makeTestCtx({ ships: [war], modules: [turret('mod-turret-kin-2', 'heavy', 'kinetic', 28)] })
    state.fleet[state.shipId].defId = 'warship'
    state.fleet[state.shipId].fitted.turret = 'mod-turret-2'
    state.moduleBay['mod-turret-2'] = 2
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[state.shipId].fitted.turret).toBe('mod-turret-kin-2')
    expect(state.moduleBay['mod-turret-kin-2']).toBe(2)
    expect('mod-turret-2' in state.moduleBay).toBe(false)
  })
})
