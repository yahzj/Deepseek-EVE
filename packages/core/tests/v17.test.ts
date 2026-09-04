/**
 * V17 装备参数结构化测试：EVE 式缺口抗性合成、加力推进进战斗、CPU 装配校验、
 * calcPower 不再吃装备百分比、旧"通用全系"增强器迁移、敌方主伤害类型导出。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { createPlayerSpec, foeMainDamageType, hitChance, mergeResist } from '../src/combat'
import { addModule, fitModule, repairDeprecatedModules, unfitSlot } from '../src/equipment'
import { calcPower } from '../src/expedition'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

describe('V17.1：抗性缺口合成（EVE 式乘入未抗部分）', () => {
  it('mergeResist：0 基础 = 面板直接加；基础越高同系模块收益越低；上限 0.9', () => {
    expect(mergeResist(undefined, { kinetic: 0.5 }).kinetic).toBeCloseTo(0.5, 10)
    expect(mergeResist({ kinetic: 0.25 }, { kinetic: 0.5 }).kinetic).toBeCloseTo(0.625, 10) // 0.25 + 0.75×0.5
    expect(mergeResist({ kinetic: 0.5 }, { kinetic: 0.5 }).kinetic).toBeCloseTo(0.75, 10) // 0.5 + 0.5×0.5
    // 异系模块不串扰
    expect(mergeResist({ kinetic: 0.25 }, { explosive: 0.5 }).kinetic).toBeCloseTo(0.25, 10)
    // 上限 0.9
    expect(mergeResist({ kinetic: 0.5 }, { kinetic: 0.9 }).kinetic).toBe(0.9)
  })

  it('抗性件（纯抗）：只改抗性不动血量——分系缺口合进单位抗性（与胜率推演同源）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const sc = ship('sandcat', { shieldHp: 100, armorHp: 60, hullHp: 40, cpu: 200, maxSpeedMps: 300 })
    sc.shieldResist = { kinetic: 0.25 }
    const ctx = makeTestCtx({
      ships: [sc],
      modules: [moduleDef('mod-sh-kin2', 'shield', 0, { shieldResistAdd: { kinetic: 0.25 }, cpuUse: 15 })],
    })
    const before = createPlayerSpec(state, ctx, 'sandcat')!
    expect(before.hp.s).toBe(100)
    expect(before.resists.shield?.kinetic).toBeCloseTo(0.25, 10)

    state.moduleBay['mod-sh-kin2'] = 1
    expect(fitModule(state, 'mod-sh-kin2', ctx).ok).toBe(true)
    const after = createPlayerSpec(state, ctx, 'sandcat')!
    expect(after.hp.s).toBeCloseTo(100, 6) // 纯抗性件不携带容量
    expect(after.resists.shield?.kinetic).toBeCloseTo(1 - (1 - 0.25) * (1 - 0.25), 10) // ≈0.4375
    expect(after.resists.shield?.explosive).toBe(0) // 分系：非本系不受影响
  })

  it('容量件（纯容量）：只放大血量——抗性与船体基础一致', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const sc = ship('sandcat', { shieldHp: 100, armorHp: 60, hullHp: 40, cpu: 200 })
    sc.shieldResist = { kinetic: 0.25 }
    const ctx = makeTestCtx({
      ships: [sc],
      modules: [moduleDef('mod-sh-ext', 'shield', 0, { shieldHpBonus: 0.35, cpuUse: 15 })],
    })
    state.moduleBay['mod-sh-ext'] = 1
    expect(fitModule(state, 'mod-sh-ext', ctx).ok).toBe(true)
    const after = createPlayerSpec(state, ctx, 'sandcat')!
    expect(after.hp.s).toBeCloseTo(135, 6) // 100 × 1.35
    expect(after.resists.shield?.kinetic).toBeCloseTo(0.25, 10) // 无抗性字段 → 不动
  })

  it('敌方主伤害类型导出：dmgMix 最高权重，缺省 = 动能（悬赏卡换装依据同源）', () => {
    const a1 = anomaly('ano-a', 'galaxy-hub', {})
    expect(foeMainDamageType(a1)).toBe('kinetic')
    const a2 = { ...anomaly('ano-b', 'galaxy-hub', {}), dmgMix: { explosive: 2, plasma: 0.5 } }
    expect(foeMainDamageType(a2)).toBe('explosive')
    const a3 = { ...anomaly('ano-c', 'galaxy-hub', {}), dmgMix: { plasma: 3 } }
    expect(foeMainDamageType(a3)).toBe('plasma')
  })
})

describe('V17.1：矢量推进器 = 加力推进（速度 + 常驻命中代价）', () => {
  it('装推进器：单位速度 ×(1+speedBonusPct)，命中乘子 = 1−hitPenalty', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = makeTestCtx({
      modules: [moduleDef('mod-prop-x2', 'propulsion', 0, { speedBonusPct: 0.3, hitPenalty: 0.12, cpuUse: 15 })],
    })
    const plain = createPlayerSpec(state, ctx, 'sandcat')!
    expect(plain.speedMps).toBeCloseTo(260, 6) // helpers.ship 默认 maxSpeedMps 260
    expect(plain.hitMul).toBe(1) // 无推进器不失稳
    state.moduleBay['mod-prop-x2'] = 1
    expect(fitModule(state, 'mod-prop-x2', ctx).ok).toBe(true)
    const boosted = createPlayerSpec(state, ctx, 'sandcat')!
    expect(boosted.speedMps).toBeCloseTo(260 * 1.3, 6)
    expect(boosted.hitMul).toBeCloseTo(0.88, 10)
  })

  it('命中惩罚乘入 hitChance（×hitMul）——胜率预估同源，敌方不受影响', () => {
    const bal = makeTestCtx().balance.battle
    const w = { hitRate: 0.8, minRangeM: 0, maxRangeM: 4000, falloff: 0.3 }
    const atkBase = { hitBonus: 0.1, scanResMm: 600 }
    const def = { evasion: 0.05, signatureM: 60 }
    const base = hitChance(w, atkBase, def, 500, bal)
    const drifted = hitChance(w, { ...atkBase, hitMul: 0.8 }, def, 500, bal)
    expect(drifted).toBeCloseTo(base * 0.8, 10)
    // 敌方单位无 hitMul → 不变
    const foe = hitChance(w, { ...atkBase, hitMul: 1 }, def, 500, bal)
    expect(foe).toBeCloseTo(base, 10)
  })
})

describe('V17：CPU 装配校验（合计不超过船体上限）', () => {
  let state: GameState
  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 3 })
  })

  it('超载拒绝装配：装备留在库中、槽位不变', () => {
    const heavy = moduleDef('mod-heavy', 'shield', 0, { shieldHpBonus: 0.5, cpuUse: 250 })
    const ctx = makeTestCtx({ modules: [heavy] })
    state.moduleBay['mod-heavy'] = 1
    const r = fitModule(state, 'mod-heavy', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('超载')
    expect(state.fleet[state.shipId].fitted.shield).toBeNull()
    expect(state.moduleBay['mod-heavy']).toBe(1)
  })

  it('上限内允许：多件合计 ≤ 船体 cpu', () => {
    const m1 = moduleDef('mod-cpu-a', 'shield', 0, { cpuUse: 70 })
    const m2 = moduleDef('mod-cpu-b', 'armor', 0, { cpuUse: 50 })
    const ctx = makeTestCtx({ modules: [m1, m2] }) // sandcat cpu = 120
    state.moduleBay['mod-cpu-a'] = 1
    state.moduleBay['mod-cpu-b'] = 1
    expect(fitModule(state, 'mod-cpu-a', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-cpu-b', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-cpu-a', ctx).ok).toBe(false) // 已装重复件仍被拒（老逻辑）
  })
})

describe('V17：calcPower 不再乘装备百分比（炮台战力走 battleWinPreview）', () => {
  it('火力指数 = 基础 + 炮术 + 船加成；装配炮台不改变指数', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({ modules: [moduleDef('mod-t', 'turret', 0.6)] })
    expect(calcPower(state, ctx)).toBe(10)
    state.moduleBay['mod-t'] = 1
    fitModule(state, 'mod-t', ctx)
    expect(calcPower(state, ctx)).toBe(10)
    expect(state.fleet[state.shipId].fitted.turret).toBe('mod-t') // 装配本身照常生效（战斗内火力另算）
  })
})

describe('V17：旧"通用全系"增强器存档迁移', () => {
  it('fitted 原位替换为动能款；装备库计数并入新款；悬空无映射件退回不丢', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const ctx = makeTestCtx({
      modules: [moduleDef('mod-shield-kin-1', 'shield', 0, { shieldHpBonus: 0.15, shieldResistAdd: { kinetic: 0.15 } })],
    })
    // 模拟旧存档：装的是已下架的 mod-shield-1（全系通用款）
    state.fleet[state.shipId].fitted.shield = 'mod-shield-1'
    state.fleet[state.shipId].fitted.cargo = 'mod-ghost' // 未来可能出现的无迁移下架件
    state.moduleBay['mod-shield-1'] = 2
    state.moduleBay['mod-ghost'] = 1

    repairDeprecatedModules(state, ctx)

    expect(state.fleet[state.shipId].fitted.shield).toBe('mod-shield-kin-1') // 原位迁移
    expect(state.fleet[state.shipId].fitted.cargo).toBeNull() // 无迁移 → 卸下
    expect(state.moduleBay['mod-shield-kin-1']).toBe(2) // 装备库计数并入
    expect('mod-shield-1' in state.moduleBay).toBe(false) // 旧键清除
    expect(state.moduleBay['mod-ghost']).toBe(2) // 退回装备库（1 + 悬空 1），不丢资产
  })

  it('幂等：重复调用不重复迁移、不再改动', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const ctx = makeTestCtx({})
    state.moduleBay['mod-shield-1'] = 1
    repairDeprecatedModules(state, ctx)
    repairDeprecatedModules(state, ctx)
    expect(state.moduleBay['mod-shield-1']).toBe(1) // 无迁移目标：原样保留（幂等）
  })

  it('迁移后卸下可正常回流装备库', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const ctx = makeTestCtx({
      modules: [moduleDef('mod-shield-kin-1', 'shield', 0, { shieldHpBonus: 0.15, shieldResistAdd: { kinetic: 0.15 }, cpuUse: 6 })],
    })
    state.fleet[state.shipId].fitted.shield = 'mod-shield-1'
    repairDeprecatedModules(state, ctx)
    expect(unfitSlot(state, 'shield')).toBe(true)
    expect(state.moduleBay['mod-shield-kin-1']).toBe(1)
  })
})
