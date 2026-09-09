/**
 * 船体武器族加成（2026-09-09 船长拍板：四族巡洋分型 EVE 式族加成 +12% 强档）：
 * - 本族弹型的三族武器条目单发 ×(1+加成)；装别族武器 = 无加成但仍可用；
 * - 无人机 / 基础舰炮豁免（不在武器族内）；
 * - 引擎同源（createPlayerSpec）→ 手动/AI/胜率预估自动一致。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { createPlayerSpec } from '../src/combat'
import type { ItemDef, ModuleDef } from '../src/types'
import { makeTestCtx, moduleDef, ship } from './helpers'

function bedCtx(over: Record<string, unknown>, mods: ModuleDef[] = [], items: ItemDef[] = []) {
  const bed = { ...ship('bed', { cpu: 500, slots: { high: 8, mid: 2, low: 4 }, powerBonus: 0.2 }), ...over }
  return makeTestCtx({ ships: [bed], modules: mods, items })
}

function laserDef(id: string, dmgMult: number): ModuleDef {
  return moduleDef(id, 'laser', 0, { rack: 'high', damageType: 'plasma', maxRangeM: 3000, minRangeM: 0, hitRate: 1, falloff: 0.3, reloadMs: 2000, dmgMult, cpuUse: 10 })
}

function kinDef(id: string, dmgMult: number): ModuleDef {
  return moduleDef(id, 'turret', 0, { rack: 'high', damageType: 'kinetic', maxRangeM: 2000, minRangeM: 0, hitRate: 0.85, reloadMs: 1500, dmgMult, cpuUse: 10 })
}

function fitOne(state: ReturnType<typeof createInitialState>, modId: string): void {
  state.fleet[state.shipId]!.fitted.high[0] = modId
}

const LASER = laserDef('mod-laser-3', 5)
const KIN = kinDef('mod-kin-3', 5)
const DRONE: ItemDef = {
  id: 'drone-x',
  name: '测试机',
  kind: 'drone',
  unitM3: 3,
  baseSellPriceIsk: 1,
  description: 't',
  damageType: 'kinetic',
  dmg: 7,
  cpuUse: 5,
}

describe('船体武器族加成（2026-09-09）', () => {
  it('本族加成进单发：plasma +12% 船装激光 → shotDmg ≈ 无加成船 ×1.12', () => {
    const ctx = bedCtx({ weaponFamilyBonus: { plasma: 0.12 } }, [LASER])
    const ctx0 = bedCtx({}, [LASER])
    const a = createInitialState({ nowWallMs: 0, seed: 1 })
    a.fleet[a.shipId]!.defId = 'bed'
    a.moduleBay['mod-laser-3'] = 1
    fitOne(a, 'mod-laser-3')
    const beam = createPlayerSpec(a, ctx, a.shipId)!.weapons.find((w) => w.kind === 'beam')!
    const base = createInitialState({ nowWallMs: 0, seed: 1 })
    base.fleet[base.shipId]!.defId = 'bed'
    base.moduleBay['mod-laser-3'] = 1
    fitOne(base, 'mod-laser-3')
    const baseBeam = createPlayerSpec(base, ctx0, base.shipId)!.weapons.find((w) => w.kind === 'beam')!
    expect(beam.shotDmg!).toBeGreaterThan(baseBeam.shotDmg!)
    expect(beam.shotDmg! / baseBeam.shotDmg!).toBeCloseTo(1.12, 1)
  })

  it('跨族无加成：explosive +12% 船装激光 = 无加成船（仍可用）', () => {
    const ctx = bedCtx({ weaponFamilyBonus: { explosive: 0.12 } }, [LASER])
    const ctx0 = bedCtx({}, [LASER])
    const a = createInitialState({ nowWallMs: 0, seed: 1 })
    a.fleet[a.shipId]!.defId = 'bed'
    a.moduleBay['mod-laser-3'] = 1
    fitOne(a, 'mod-laser-3')
    const beam = createPlayerSpec(a, ctx, a.shipId)!.weapons.find((w) => w.kind === 'beam')!
    const base = createInitialState({ nowWallMs: 0, seed: 1 })
    base.fleet[base.shipId]!.defId = 'bed'
    base.moduleBay['mod-laser-3'] = 1
    fitOne(base, 'mod-laser-3')
    const baseBeam = createPlayerSpec(base, ctx0, base.shipId)!.weapons.find((w) => w.kind === 'beam')!
    expect(beam.shotDmg).toBe(baseBeam.shotDmg) // 爆炸加成不影响激光
  })

  it('动能族加成船装动能炮 → 加成进 shotsByType.kinetic', () => {
    const ctx = bedCtx({ weaponFamilyBonus: { kinetic: 0.12 } }, [KIN])
    const ctx0 = bedCtx({}, [KIN])
    const a = createInitialState({ nowWallMs: 0, seed: 1 })
    a.fleet[a.shipId]!.defId = 'bed'
    a.moduleBay['mod-kin-3'] = 1
    fitOne(a, 'mod-kin-3')
    const gun = createPlayerSpec(a, ctx, a.shipId)!.weapons.find((w) => w.kind === 'gun')!
    const base = createInitialState({ nowWallMs: 0, seed: 1 })
    base.fleet[base.shipId]!.defId = 'bed'
    base.moduleBay['mod-kin-3'] = 1
    fitOne(base, 'mod-kin-3')
    const baseGun = createPlayerSpec(base, ctx0, base.shipId)!.weapons.find((w) => w.kind === 'gun')!
    expect(gun.shotsByType?.['kinetic'] ?? 0).toBeGreaterThan(baseGun.shotsByType?.['kinetic'] ?? 0)
    expect((gun.shotsByType?.['kinetic'] ?? 0) / Math.max(1, baseGun.shotsByType?.['kinetic'] ?? 0)).toBeCloseTo(1.12, 1)
  })

  it('豁免：基础舰炮与无人机不受武器族加成（kinetic 加成船与无加成船同伤）', () => {
    // 基础舰炮（兜底炮，kinetic）
    const ctx = bedCtx({ weaponFamilyBonus: { kinetic: 0.12 } })
    const ctx0 = bedCtx({})
    const a = createInitialState({ nowWallMs: 0, seed: 1 })
    a.fleet[a.shipId]!.defId = 'bed'
    const baseGun = createPlayerSpec(a, ctx, a.shipId)!.weapons.find((w) => w.label === '基础舰炮')!
    const b = createInitialState({ nowWallMs: 0, seed: 1 })
    b.fleet[b.shipId]!.defId = 'bed'
    const baseGun0 = createPlayerSpec(b, ctx0, b.shipId)!.weapons.find((w) => w.label === '基础舰炮')!
    expect(baseGun.shotDmg).toBe(baseGun0.shotDmg)
    // 无人机（同 droneLoad、同机型）：kinetic 加成船 vs 无加成船 → 单发相等
    const droneCtx = bedCtx({ droneBayM3: 30, weaponFamilyBonus: { kinetic: 0.12 } }, [], [DRONE])
    const droneCtx0 = bedCtx({ droneBayM3: 30 }, [], [DRONE])
    const c = createInitialState({ nowWallMs: 0, seed: 1 })
    c.fleet[c.shipId]!.defId = 'bed'
    c.fleet[c.shipId]!.droneLoad = { 'drone-x': 2 }
    const droneWeapon = createPlayerSpec(c, droneCtx, c.shipId)!.weapons.find((w) => w.label.includes('测试机'))!
    const d = createInitialState({ nowWallMs: 0, seed: 1 })
    d.fleet[d.shipId]!.defId = 'bed'
    d.fleet[d.shipId]!.droneLoad = { 'drone-x': 2 }
    const droneWeapon0 = createPlayerSpec(d, droneCtx0, d.shipId)!.weapons.find((w) => w.label.includes('测试机'))!
    expect(droneWeapon.shotDmg).toBe(droneWeapon0.shotDmg)
  })
})
