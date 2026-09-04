/**
 * V18.1 支援件与多件收敛专项测试：
 * - EVE 曲线权重（100/87/57/28）与 curveMult、缺口复合 gapCombine（2×20% → 36%，船长示例）；
 * - stackingOf 分组（flat/gap/curve）与同键计数；
 * - 战斗集成：命中件 eqHitMul（仅炮台）、闪避缺口复合（含船体基础）、伤害稳定器按系
 *   加算（只影响该系炮台、不动无人机/异系炮）、射速装填缩短、抗性同系多件缺口乘入、
 *   推进器多件（速度 EVE 曲线 + 命中代价只取最重一件）、CPU 装配约束仍在。
 * helpers 默认世界无支援件——本文件按用例自给。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { createPlayerSpec } from '../src/combat'
import { curveMult, fitModule, gapCombine, repairDeprecatedModules, sameKindCount, stackingOf, stackWeight } from '../src/equipment'
import type { ShipDef } from '../src/types'
import { makeTestCtx, moduleDef, ship } from './helpers'

const DRONE_SCOUT = {
  id: 'drone-scout',
  name: '蜂鸟侦察机',
  kind: 'drone' as const,
  unitM3: 1.5,
  baseSellPriceIsk: 60,
  description: '测试轻型无人机',
  damageType: 'kinetic' as const,
  dmg: 3,
  cpuUse: 4,
}

/** 测试床：槽位宽松（high 4 / mid 6 / low 6）+ 大 CPU + 无人机舱，方便叠装 */
function makeBed(slotsExtra: { evasion?: number } = {}): { shipDef: ShipDef } {
  return {
    shipDef: ship('bed', {
      cpu: 400,
      slots: { high: 4, mid: 6, low: 6 },
      droneBayM3: 40,
      evasion: slotsExtra.evasion ?? 0.1,
      powerBonus: 0,
    }),
  }
}

/** 造一艘动能炮（同参、伤害倍率 2.5 便于整除断言） */
function kinGun(id = 'mod-gun-kin', dmgMult = 2.5): ReturnType<typeof moduleDef> {
  return moduleDef(id, 'turret', 0, {
    damageType: 'kinetic',
    maxRangeM: 4600,
    minRangeM: 250,
    hitRate: 0.8,
    falloff: 0.3,
    reloadMs: 2000,
    dmgMult,
    cpuUse: 10,
  })
}
function expGun(id = 'mod-gun-exp'): ReturnType<typeof moduleDef> {
  return moduleDef(id, 'turret', 0, {
    damageType: 'explosive',
    maxRangeM: 4600,
    minRangeM: 250,
    hitRate: 0.8,
    falloff: 0.3,
    reloadMs: 2000,
    dmgMult: 2.0, // 弹 7 × 2.0 = 14（与动能 15 区分）
    cpuUse: 10,
  })
}

describe('V18.1 收敛机制（纯函数）', () => {
  it('EVE 曲线权重：第 1~5 件 ≈ 100% / 87% / 57% / 28% / 11%', () => {
    const expectW = (n: number, v: number): void => {
      const w = stackWeight(n)
      expect(Math.abs(w - v)).toBeLessThan(0.005)
    }
    expectW(1, 1.0)
    expectW(2, 0.8691)
    expectW(3, 0.5706)
    expectW(4, 0.283)
    expectW(5, 0.1057)
  })

  it('curveMult：两件 +20% → (1.2)×(1+0.2×0.8691) ≈ 1.409；单件 = 1.2；空 = 1', () => {
    expect(curveMult([])).toBe(1)
    expect(curveMult([0.2])).toBeCloseTo(1.2, 6)
    expect(curveMult([0.2, 0.2])).toBeCloseTo(1.2 * (1 + 0.2 * stackWeight(2)), 6)
    // 自动按强度排序（0.5 优先第 1 件拿满权重）
    expect(curveMult([0.2, 0.5])).toBeCloseTo(1.5 * (1 + 0.2 * stackWeight(2)), 6)
  })

  it('缺口复合：两件 +20% 无基础 → 36%（船长示例）；含船体基础参与', () => {
    expect(gapCombine([0.2, 0.2])).toBeCloseTo(0.36, 9)
    expect(gapCombine([0.2])).toBeCloseTo(0.2, 9)
    expect(gapCombine([], 0.1)).toBeCloseTo(0.1, 9)
    // 船体基础 0.1 + 一件 20% → 1−(0.9×0.8) = 0.28
    expect(gapCombine([0.2], 0.1)).toBeCloseTo(0.28, 9)
  })

  it('stackingOf 分组：稳定器/射速 = flat；索敌(命中) = curve；陀螺(闪避) = gap；推进 = curve/speed；盾抗 = gap/系键', () => {
    expect(stackingOf(moduleDef('s1', 'support', 0, { rack: 'low', damageTypeBonusPct: { kinetic: 0.1 } }))).toEqual({
      group: 'flat',
      kind: 'support',
    })
    expect(stackingOf(moduleDef('r1', 'support', 0, { rack: 'low', reloadCutPct: 0.05 })).group).toBe('flat')
    expect(stackingOf(moduleDef('t1', 'support', 0, { rack: 'mid', hitBonusPct: 0.08 }))).toEqual({ group: 'curve', kind: 'hit' })
    expect(stackingOf(moduleDef('g1', 'support', 0, { rack: 'mid', evasionGapPct: 0.1 }))).toEqual({ group: 'gap', kind: 'evasion' })
    expect(stackingOf(moduleDef('p1', 'propulsion', 0, { speedBonusPct: 0.15 }))).toEqual({ group: 'curve', kind: 'speed' })
    expect(stackingOf(moduleDef('sk1', 'shield', 0, { shieldResistAdd: { kinetic: 0.5 } })).kind).toBe('shield-kinetic')
  })
})

describe('V18.1 装配与战斗集成', () => {
  it('伤害稳定器按系加算：两件 +10% 动能 → 动能炮 ×1.2；高爆炮与无人机不受影响', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const { shipDef } = makeBed()
    const ctx = makeTestCtx({
      ships: [shipDef],
      items: [DRONE_SCOUT],
      modules: [
        kinGun(),
        expGun(),
        moduleDef('mod-stab-k1', 'support', 0, { rack: 'low', damageTypeBonusPct: { kinetic: 0.1 }, cpuUse: 5 }),
        moduleDef('mod-stab-k2', 'support', 0, { rack: 'low', damageTypeBonusPct: { kinetic: 0.1 }, cpuUse: 5 }),
      ],
    })
    state.fleet[state.shipId]!.defId = 'bed'
    state.fleet[state.shipId]!.cargo = { 'drone-scout': 2 }
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-gun-kin'] = 1
    state.moduleBay['mod-gun-exp'] = 1
    state.moduleBay['mod-stab-k1'] = 1
    state.moduleBay['mod-stab-k2'] = 1
    expect(fitModule(state, 'mod-gun-kin', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-gun-exp', ctx).ok).toBe(true)
    const spec0 = createPlayerSpec(state, ctx, state.shipId)!
    const kin0 = spec0.weapons.find((w) => w.kind === 'gun' && w.shotsByType?.kinetic !== undefined)!
    const exp0 = spec0.weapons.find((w) => w.kind === 'gun' && w.shotsByType?.explosive !== undefined)!
    expect(kin0.shotsByType!.kinetic).toBe(15) // 弹 6 × 2.5
    expect(exp0.shotsByType!.explosive).toBe(14) // 弹 7 × 2.0

    expect(fitModule(state, 'mod-stab-k1', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-stab-k2', ctx).ok).toBe(true)
    const spec1 = createPlayerSpec(state, ctx, state.shipId)!
    const kin1 = spec1.weapons.find((w) => w.kind === 'gun' && w.shotsByType?.kinetic !== undefined)!
    const exp1 = spec1.weapons.find((w) => w.kind === 'gun' && w.shotsByType?.explosive !== undefined)!
    expect(kin1.shotsByType!.kinetic).toBe(18) // 15 × 1.2（加算）
    expect(exp1.shotsByType!.explosive).toBe(14) // 高爆炮不受动能件影响
    // 无人机（动能）不吃炮台伤害件
    const drone = spec1.weapons.find((w) => w.label === DRONE_SCOUT.name)!
    expect(drone.shotDmg).toBe(3)
  })

  it('射速计算机加算：两件 −5% → 装填 ÷1.1', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 2 })
    const { shipDef } = makeBed()
    const ctx = makeTestCtx({
      ships: [shipDef],
      modules: [
        kinGun('mod-gun-k', 1.25),
        moduleDef('mod-rof-1', 'support', 0, { rack: 'low', reloadCutPct: 0.05, cpuUse: 5 }),
        moduleDef('mod-rof-2', 'support', 0, { rack: 'low', reloadCutPct: 0.05, cpuUse: 5 }),
      ],
    })
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-gun-k'] = 1
    state.moduleBay['mod-rof-1'] = 1
    state.moduleBay['mod-rof-2'] = 1
    expect(fitModule(state, 'mod-gun-k', ctx).ok).toBe(true)
    const before = createPlayerSpec(state, ctx, state.shipId)!.weapons.find((w) => w.kind === 'gun')!
    expect(before.reloadMs).toBe(2000)
    expect(fitModule(state, 'mod-rof-1', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-rof-2', ctx).ok).toBe(true)
    const after = createPlayerSpec(state, ctx, state.shipId)!.weapons.find((w) => w.kind === 'gun')!
    expect(after.reloadMs).toBe(Math.round(2000 / 1.1))
  })

  it('索敌阵列：炮台条目 eqHitMul 走 EVE 曲线（两件 +8% ≈ ×1.155），基础舰炮不带', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const { shipDef } = makeBed()
    const ctx = makeTestCtx({
      ships: [shipDef],
      modules: [
        kinGun(),
        moduleDef('mod-tr-1', 'support', 0, { rack: 'mid', hitBonusPct: 0.08, cpuUse: 5 }),
        moduleDef('mod-tr-2', 'support', 0, { rack: 'mid', hitBonusPct: 0.08, cpuUse: 5 }),
      ],
    })
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-gun-kin'] = 1
    state.moduleBay['mod-tr-1'] = 1
    state.moduleBay['mod-tr-2'] = 1
    expect(fitModule(state, 'mod-gun-kin', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-tr-1', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-tr-2', ctx).ok).toBe(true)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const gun = spec.weapons.find((w) => w.kind === 'gun')!
    expect(gun.eqHitMul).toBeCloseTo(1.08 * (1 + 0.08 * stackWeight(2)), 6)
    const base = spec.weapons.find((w) => w.label === '基础舰炮')!
    expect(base.eqHitMul).toBeUndefined()
  })

  it('姿态陀螺：回避缺口复合（船体 0.1 + 两件 20% → 0.1+36% 缺口 → 1−0.9×0.64 = 0.424）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 4 })
    const { shipDef } = makeBed()
    const ctx = makeTestCtx({
      ships: [shipDef],
      modules: [
        moduleDef('mod-gy-1', 'support', 0, { rack: 'mid', evasionGapPct: 0.2, cpuUse: 5 }),
        moduleDef('mod-gy-2', 'support', 0, { rack: 'mid', evasionGapPct: 0.2, cpuUse: 5 }),
      ],
    })
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    const noGyro = createPlayerSpec(state, ctx, state.shipId)!
    expect(noGyro.evasion).toBeCloseTo(0.1, 9)
    state.moduleBay['mod-gy-1'] = 1
    state.moduleBay['mod-gy-2'] = 1
    expect(fitModule(state, 'mod-gy-1', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-gy-2', ctx).ok).toBe(true)
    const withGyro = createPlayerSpec(state, ctx, state.shipId)!
    expect(withGyro.evasion).toBeCloseTo(1 - 0.9 * 0.64, 9)
  })

  it('同系抗性多件缺口乘入：两件动能增强 0.5（无基础）→ 0.75', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const { shipDef } = makeBed()
    const ctx = makeTestCtx({
      ships: [shipDef],
      modules: [
        moduleDef('mod-sk-1', 'shield', 0, { shieldResistAdd: { kinetic: 0.5 }, cpuUse: 5 }),
        moduleDef('mod-sk-2', 'shield', 0, { shieldResistAdd: { kinetic: 0.5 }, cpuUse: 5 }),
      ],
    })
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-sk-1'] = 1
    state.moduleBay['mod-sk-2'] = 1
    expect(fitModule(state, 'mod-sk-1', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-sk-2', ctx).ok).toBe(true)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    expect(spec.resists.shield?.kinetic).toBeCloseTo(0.75, 9)
  })

  it('推进器多件：速度 EVE 曲线（+15% 与 +50% → ×1.696），命中代价只取最重（×0.80）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 6 })
    const { shipDef } = makeBed()
    shipDef.maxSpeedMps = 300
    const ctx = makeTestCtx({
      ships: [shipDef],
      modules: [
        moduleDef('mod-p1', 'propulsion', 0, { speedBonusPct: 0.15, hitPenalty: 0.05, cpuUse: 5 }),
        moduleDef('mod-p3', 'propulsion', 0, { speedBonusPct: 0.5, hitPenalty: 0.2, cpuUse: 15 }),
      ],
    })
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-p1'] = 1
    state.moduleBay['mod-p3'] = 1
    expect(fitModule(state, 'mod-p1', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-p3', ctx).ok).toBe(true)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const expectSpeed = 300 * curveMult([0.5, 0.15])
    expect(spec.speedMps).toBeCloseTo(expectSpeed, 6)
    expect(spec.hitMul).toBeCloseTo(0.8, 9) // 最重代价 0.2，而非 0.95×0.8
  })

  it('sameKindCount：命中件第 2 件计数（装配提示用）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const { shipDef } = makeBed()
    const tr1 = moduleDef('mod-tr-1', 'support', 0, { rack: 'mid', hitBonusPct: 0.08, cpuUse: 5 })
    const tr2 = moduleDef('mod-tr-2', 'support', 0, { rack: 'mid', hitBonusPct: 0.08, cpuUse: 5 })
    const ctx = makeTestCtx({ ships: [shipDef], modules: [tr1, tr2] })
    state.fleet[state.shipId]!.defId = 'bed'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-tr-1'] = 1
    state.moduleBay['mod-tr-2'] = 1
    expect(fitModule(state, 'mod-tr-1', ctx).ok).toBe(true)
    // 已装 1 件同类 → 第 2 件安装前计数 = 1
    expect(sameKindCount(state.fleet[state.shipId]!.fitted, ctx, tr2)).toBe(1)
  })

  it('CPU 装配约束仍在（多装受船体 CPU 上限限制）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 8 })
    const tiny = ship('tinyship', { cpu: 8, slots: { high: 1, mid: 4, low: 4 } })
    const ctx = makeTestCtx({
      ships: [tiny],
      modules: [moduleDef('mod-tr-1', 'support', 0, { rack: 'mid', hitBonusPct: 0.08, cpuUse: 5 })],
    })
    state.fleet[state.shipId]!.defId = 'tinyship'
    repairDeprecatedModules(state, ctx)
    state.moduleBay['mod-tr-1'] = 2
    expect(fitModule(state, 'mod-tr-1', ctx).ok).toBe(true)
    const second = fitModule(state, 'mod-tr-1', ctx)
    expect(second.ok).toBe(false)
    expect(second.error).toContain('CPU')
  })
})

export {}
