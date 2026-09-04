/**
 * 技能补全效果测试（2026-09-04）：材料学 / 工业自动化 / 深空采集学 / 信号分析学 /
 * 舰船操控学 / 深空物流学——六个接线点的行为锁定（零级 = 无影响，满级 = 预期值）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import type { ItemDef, SimContext } from '../src/types'
import { belt, makeTestCtx } from './helpers'
import { fleetDefOf } from '../src/instances'
import { travelTimeFactor } from '../src/travel'
import { calcBuildDurationMs, matNeedCount, missingMaterials } from '../src/manufacturing'
import { scanWindowMsOf } from '../src/explore'
import { getMiningParams, richVeinFactor } from '../src/mining'
import { cargoCapacityM3Of } from '../src/inventory'
import { startRefineRun, stopRefineRun } from '../src/industry'
import { repairCostIsk } from '../src/shipyard'
import { bountyRewardFactor } from '../src/expedition'
import { simulateOffline } from '../src/simulation'
import { enqueueSkill, HIDDEN_SKILL_IDS } from '../src/engine'
import { marketSellSkillMult } from '../src/market'
import { lootFactor } from '../src/expedition'

const GAS_X: ItemDef = {
  id: 'gas-x',
  name: '试制气体',
  kind: 'gas',
  unitM3: 1,
  baseSellPriceIsk: 40,
  description: '测试用气体',
}

describe('技能补全：舰船操控学（航行时间每级 −2%）', () => {
  it('零级不变；与导航族乘算叠加', () => {
    const base = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx()
    base.skills.trained['navigation'] = 5 // 0.8
    const fNav5 = travelTimeFactor(base, ctx)
    base.skills.trained['spaceship-command'] = 5 // 再 ×0.9
    const fBoth = travelTimeFactor(base, ctx)
    expect(fNav5).toBeCloseTo(0.8, 10)
    expect(fBoth).toBeCloseTo(0.72, 10)
  })
})

describe('技能补全：材料学（制造消耗每级 −2%）', () => {
  it('满级 matNeedCount = ×0.9 向下取整（至少 1）；缺口预览同口径', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 2 })
    const ctx = makeTestCtx()
    expect(matNeedCount(state, 100)).toBe(100) // 零级
    state.skills.trained['materials'] = 5
    expect(matNeedCount(state, 100)).toBe(90)
    expect(matNeedCount(state, 1)).toBe(1) // 保底 1
    // 缺料预览：100 → 折扣后 90，仓库 90 够、89 差 1
    const spec = { materials: [{ itemId: 'ore-a', count: 100 }], buildSeconds: 60, buildCostIsk: 1000 } as const
    state.warehouse.items['ore-a'] = 90
    expect(missingMaterials(state, ctx, spec)).toEqual([])
    state.warehouse.items['ore-a'] = 89
    const miss = missingMaterials(state, ctx, spec)
    expect(miss.length).toBe(1)
    expect(miss[0]).toContain('还差 1')
  })
})

describe('技能补全：工业自动化（AI 精炼炉周期每级 −5%）', () => {
  it('基础核心 + 自动化满级：6000/0.4 → ×0.75 = 11250ms；手动运转不受影响', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const ctx = makeTestCtx()
    state.aiCores['basic'] = 1
    state.warehouse.items['ore-a'] = 60
    state.skills.trained['industrial-automation'] = 5
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(state.refineRun.cycleMs).toBe(11_250) // 6000 ÷ 0.4 × 0.75
    expect(stopRefineRun(state, ctx).ok).toBe(true)
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
    expect(state.refineRun.cycleMs).toBe(6_000) // 手动 = 原始周期
    expect(stopRefineRun(state, ctx).ok).toBe(true)
  })
})

describe('技能补全：深空采集学（气体/冰矿产量每级 +5%）', () => {
  it('气体矿带满级 = ×1.25；普通矿石不受影响', () => {
    const mk = (): { state: GameState; ctx: SimContext } => {
      const state = createInitialState({ nowWallMs: 0, seed: 4 })
      const ctx = makeTestCtx({ items: [GAS_X], belts: [belt('belt-g', 'gas-x')] })
      return { state, ctx }
    }
    const a = mk()
    const b = mk()
    b.state.skills.trained['deep-space-harvesting'] = 5
    const p0 = getMiningParams(a.state, a.ctx, { shipId: a.state.shipId, beltId: 'belt-g' })!
    const p5 = getMiningParams(b.state, b.ctx, { shipId: b.state.shipId, beltId: 'belt-g' })!
    expect(p0.unitsPerCycle).toBeGreaterThan(0)
    expect(p5.unitsPerCycle).toBe(Math.max(1, Math.floor(p0.unitsPerCycle * 1.25)))
    // 普通矿石带不受影响（默认 ctx 的 belt-fortune 类由 helpers 提供 ore belt 场景用 ore-a）
    const c = mk()
    c.state.skills.trained['deep-space-harvesting'] = 5
    const ctxOre = makeTestCtx({ belts: [belt('belt-o', 'ore-a')] })
    const stOre = createInitialState({ nowWallMs: 0, seed: 4 })
    const pOre = getMiningParams(stOre, ctxOre, { shipId: stOre.shipId, beltId: 'belt-o' })!
    expect(pOre.unitsPerCycle).toBeGreaterThan(0)
    const stOre5 = createInitialState({ nowWallMs: 0, seed: 4 })
    stOre5.skills.trained['deep-space-harvesting'] = 5
    const pOre5 = getMiningParams(stOre5, ctxOre, { shipId: stOre5.shipId, beltId: 'belt-o' })!
    expect(pOre5.unitsPerCycle).toBe(pOre.unitsPerCycle)
  })
})

describe('技能补全：信号分析学（扫描窗口每级 −8%）', () => {
  it('窗口 10 分钟 → 满级 6 分钟（×0.6）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    expect(scanWindowMsOf(state)).toBe(600_000)
    state.skills.trained['signal-analysis'] = 5
    expect(scanWindowMsOf(state)).toBe(360_000)
  })
})

describe('技能补全：深空物流学（货仓容量每级 +4%）', () => {
  it('满级 = 基础容量 ×1.2', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 6 })
    const ctx = makeTestCtx()
    const base = fleetDefOf(state, ctx, state.shipId)!.cargoM3
    expect(cargoCapacityM3Of(state, ctx, state.shipId)).toBe(Math.round(base))
    state.skills.trained['deep-space-logistics'] = 5
    expect(cargoCapacityM3Of(state, ctx, state.shipId)).toBe(Math.round(base * 1.2))
  })
})

describe('技能补全：维修工程学（维修费每级 −10%）', () => {
  it('满级维修费降至 ~半价', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = makeTestCtx()
    state.fleet[state.shipId].durability = 0.4
    const cost0 = repairCostIsk(state, state.shipId, ctx)
    expect(cost0).toBeGreaterThan(0)
    state.skills.trained['repair-engineering'] = 5
    const cost5 = repairCostIsk(state, state.shipId, ctx)
    expect(cost5).toBeLessThan(cost0)
    expect(cost5).toBeLessThanOrEqual(Math.ceil(cost0 * 0.5) + 1) // ~半价（ceil 舍入容差）
    expect(cost5).toBeGreaterThanOrEqual(Math.floor(cost0 * 0.4))
  })
})

describe('技能补全：赏金猎手学（悬赏奖金每级 +8%）', () => {
  it('零级 ×1；满级 ×1.4', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 8 })
    expect(bountyRewardFactor(state)).toBe(1)
    state.skills.trained['bounty-hunting'] = 5
    expect(bountyRewardFactor(state)).toBe(1.4)
  })
})

describe('战斗线占位技能：隐藏 + 禁训', () => {
  it('护盾/能量/船体加固在隐藏清单中，且不被加入训练队列', () => {
    expect(HIDDEN_SKILL_IDS).toEqual(['shield-operation', 'energy-management', 'hull-upgrades'])
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const ctx = makeTestCtx()
    // helpers 的测试技能目录不含这三条（真实目录含之，enqueueSkill 对隐藏技能返回"暂不可训练"）；
    // 无论目录命中与否，训练入口都必须拒绝且不产生队列项
    const r = enqueueSkill(state, 'shield-operation', 1, ctx.skills)
    expect(r.ok).toBe(false)
    expect(state.skills.queue).toHaveLength(0)
  })
})

describe('技能补全 P1：矿业三技（星质地质学/深井爆破学/富矿勘探学）', () => {
  const mkOre = (price: number): ItemDef => ({
    id: `ore-p${price}`,
    name: `试矿${price}`,
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: price,
    description: '',
  })
  it('星质地质学全矿 +4%/级；深井爆破学只作用于低品级矿（卖价 ≤55）', () => {
    const low = mkOre(12)
    const high = mkOre(300)
    const baseState = (): GameState => createInitialState({ nowWallMs: 0, seed: 10 })
    const base = fleetDefOf(baseState(), makeTestCtx(), 'sandcat')!.oreUnitsPerCycle
    const run = (ore: ItemDef, skills: Record<string, number>): number => {
      const state = createInitialState({ nowWallMs: 0, seed: 10 })
      for (const [id, lv] of Object.entries(skills)) state.skills.trained[id] = lv
      const ctx = makeTestCtx({ items: [ore], belts: [belt(`belt-${ore.id}`, ore.id)] })
      return getMiningParams(state, ctx, { shipId: state.shipId, beltId: `belt-${ore.id}` })!.unitsPerCycle
    }
    // 星质 5 级：×1.2（高低品都生效）
    expect(run(low, { 'astro-geology': 5 })).toBe(Math.max(1, Math.floor(base * 1.2)))
    expect(run(high, { 'astro-geology': 5 })).toBe(Math.max(1, Math.floor(base * 1.2)))
    // 深井 5 级：低品 ×1.3 再叠；高品无效
    expect(run(low, { 'astro-geology': 5, 'deep-hole-blasting': 5 })).toBe(
      Math.max(1, Math.floor(base * 1.2 * 1.3)),
    )
    expect(run(high, { 'deep-hole-blasting': 5 })).toBe(Math.max(1, Math.floor(base)))
    // 富矿系数：满级 ×2（基础 1% → 2%）
    const s = createInitialState({ nowWallMs: 0, seed: 10 })
    expect(richVeinFactor(s)).toBe(1)
    s.skills.trained['rich-vein-prospecting'] = 5
    expect(richVeinFactor(s)).toBe(2)
  })
})

describe('技能补全 P1：制造双技（批量生产学/组件标准化）', () => {
  it('制造时间与工业理论乘算；材料与材料学乘算', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ctx = makeTestCtx()
    const spec = { materials: [{ itemId: 'ore-a', count: 100 }], buildSeconds: 100, buildCostIsk: 0 } as const
    const t0 = calcBuildDurationMs(state, ctx, spec)
    state.skills.trained['batch-production'] = 5
    const t5 = calcBuildDurationMs(state, ctx, spec)
    expect(t5).toBe(Math.round(t0 * 0.8)) // −4%×5
    // 组件标准化满级：材料学基础上再 −5%（总 ×0.95）
    expect(matNeedCount(state, 100)).toBe(100)
    state.skills.trained['component-standardization'] = 5
    expect(matNeedCount(state, 100)).toBe(95)
  })
})

describe('技能补全 P1：手动精炼双技（炉心熔炼学/炉膛扩容学）与 AI 隔离', () => {
  it('主控手动：周期 −4%/级、批容 +6%/级；AI 核心驱动不受两技能影响', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 12 })
    const ctx = makeTestCtx()
    state.warehouse.items['ore-a'] = 200
    state.skills.trained['core-smelting'] = 5
    state.skills.trained['furnace-expansion'] = 5
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
    expect(state.refineRun.cycleMs).toBe(4_800) // 6000 ×0.8
    expect(state.refineRun.batchUnits).toBe(13) // 10 ×1.3
    expect(stopRefineRun(state, ctx).ok).toBe(true)
    // AI 驱动：不吃手动双技（无 core-smelting/expansion 加成）
    state.aiCores['basic'] = 1
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(state.refineRun.cycleMs).toBe(15_000) // 6000 ÷ 0.4
    expect(state.refineRun.batchUnits).toBe(10)
    expect(stopRefineRun(state, ctx).ok).toBe(true)
  })
})

describe('技能补全 P1：离线作业管理学（结算上限 +8%/级）', () => {
  it('满级 12 小时离线结算 ≈ 11.2 小时（基础 8 小时 ×1.4）', () => {
    const now = 2_000_000_000_000
    const mk = (): GameState => createInitialState({ nowWallMs: now - 12 * 3_600_000, seed: 13 })
    const s0 = mk()
    simulateOffline(s0, now - 12 * 3_600_000, now, makeTestCtx())
    expect(s0.gameMs).toBe(8 * 3_600_000) // lv0：cap 8h
    const s5 = mk()
    s5.skills.trained['offline-ops'] = 5
    simulateOffline(s5, now - 12 * 3_600_000, now, makeTestCtx())
    expect(s5.gameMs).toBe(Math.round(8 * 3_600_000 * 1.4)) // lv5：cap ≈ 11.2h
  })
})

describe('技能补全 P2：市场/远征/扫描系数', () => {
  it('营销学卖出乘数与二手市场蓝图乘数（独立于声望）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 14 })
    expect(marketSellSkillMult(state, 'item')).toBe(1)
    state.skills.trained['marketing'] = 5
    expect(marketSellSkillMult(state, 'item')).toBeCloseTo(1.06, 10)
    state.skills.trained['secondhand-market'] = 5
    expect(marketSellSkillMult(state, 'blueprint')).toBeCloseTo(1.06 * 1.4, 10)
    expect(marketSellSkillMult(state, 'item')).toBeCloseTo(1.06, 10) // 非蓝图不乘二手
  })
  it('漂流物打捞学：远征缴获乘数（满级 ×1.6）；信号过滤学与信号分析乘算（双满窗口 42%）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 15 })
    expect(lootFactor(state)).toBe(1)
    state.skills.trained['salvage-diving'] = 5
    expect(lootFactor(state)).toBe(1.6)
    state.skills.trained['signal-analysis'] = 5
    state.skills.trained['signal-filtering'] = 5
    expect(scanWindowMsOf(state)).toBe(Math.round(600_000 * 0.6 * 0.7)) // 252000
  })
})
