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
import { cargoCapacityM3Of, cargoUnitM3 } from '../src/inventory'
import { startRefineRun, stopRefineRun } from '../src/industry'
import { repairCostIsk, addShipToFleet } from '../src/shipyard'
import { bountyRewardFactor } from '../src/expedition'
import { simulateOffline } from '../src/simulation'
import { enqueueSkill, HIDDEN_SKILL_IDS } from '../src/engine'
import { trainingTimeFactor } from '../src/training'
import { marketSellSkillMult } from '../src/market'
import { lootFactor } from '../src/expedition'
import { blankShareFactorOf, wormholeEnter } from '../src/wormhole'
import { SKILLS, buildSimContext } from '@whale/data'

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

describe('技能补全：材料学（制造消耗每级 −1.5%，2026-09-08 技能加成下调约 20%）', () => {
  it('满级 matNeedCount = ×0.925 向下取整（至少 1）；缺口预览同口径', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 2 })
    const ctx = makeTestCtx()
    expect(matNeedCount(state, 100)).toBe(100) // 零级
    state.skills.trained['materials'] = 5
    expect(matNeedCount(state, 100)).toBe(92) // floor(100 × 0.925)
    expect(matNeedCount(state, 1)).toBe(1) // 保底 1
    // 缺料预览：100 → 折扣后 92，仓库 92 够、91 差 1
    const spec = { materials: [{ itemId: 'ore-a', count: 100 }], buildSeconds: 60, buildCostIsk: 1000 } as const
    state.warehouse.items['ore-a'] = 92
    expect(missingMaterials(state, ctx, spec)).toEqual([])
    state.warehouse.items['ore-a'] = 91
    const miss = missingMaterials(state, ctx, spec)
    expect(miss.length).toBe(1)
    expect(miss[0]).toContain('还差 1')
  })
})

describe('技能补全：工业自动化（手动与 AI 核心驱动同享，每级 −5% 周期）', () => {
  it('AI：6000÷0.4 → ×0.75 = 11250ms；手动同享 → 6000×0.75 = 4500ms（2026-09-08 方案①）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const ctx = makeTestCtx()
    state.aiCores['basic'] = 1
    state.skills.trained['ai-expert'] = 1 // 2026-09-08 AI 核心上限制
    state.warehouse.items['ore-a'] = 60
    state.skills.trained['industrial-automation'] = 5
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(state.refineRuns[0]!.cycleMs).toBe(11_250) // 6000 ÷ 0.4 × 0.75
    expect(stopRefineRun(state, ctx, state.refineRuns[0]!.id).ok).toBe(true)
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
    expect(state.refineRuns[0]!.cycleMs).toBe(4_500) // 手动 6000 ×0.75（2026-09-08 起同享）
    expect(stopRefineRun(state, ctx, state.refineRuns[0]!.id).ok).toBe(true)
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

describe('技能补全：星图测绘学接活到就地扫描窗口（船长 2026-09-11 裁决「乙」，每级 −6%）', () => {
  it('单技能满级 → 窗口 ×0.7（10 分钟 → 7 分钟）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    state.skills.trained['cartography'] = 5
    expect(scanWindowMsOf(state)).toBe(Math.round(600_000 * 0.7))
  })
  it('与信号分析学、信号过滤学乘算叠加：三技能满级 = 0.6 × 0.7 × 0.7 = 0.294', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 22 })
    state.skills.trained['signal-analysis'] = 5
    state.skills.trained['signal-filtering'] = 5
    state.skills.trained['cartography'] = 5
    expect(scanWindowMsOf(state)).toBe(Math.round(600_000 * 0.6 * 0.7 * 0.7)) // 176400
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

describe('战斗占位技能（2026-09-05 批次三后全部开放为真实技能）', () => {
  it('HIDDEN_SKILL_IDS 已清空', () => {
    expect(HIDDEN_SKILL_IDS).toEqual([])
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
    // 富矿系数：满级 ×2（基础 3%/分钟 → 6%/分钟，卷B2⑥）
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
    expect(t5).toBe(Math.round(t0 * 0.85)) // −3%×5
    // 组件标准化满级：材料学基础上再 −4%（总 ×0.96）
    expect(matNeedCount(state, 100)).toBe(100)
    state.skills.trained['component-standardization'] = 5
    expect(matNeedCount(state, 100)).toBe(96)
  })
})

describe('技能补全 P1：手动精炼双技（炉心熔炼学/炉膛扩容学）· 炉心熔炼学 2026-09-22 起对所有劳动者生效', () => {
  it('主控手动：周期 −4%/级、批容 +6%/级；AI 核心驱动**同享炉心熔炼学**（炉膛扩容学仍只对主控）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 12 })
    const ctx = makeTestCtx()
    state.warehouse.items['ore-a'] = 200
    state.skills.trained['core-smelting'] = 5
    state.skills.trained['furnace-expansion'] = 5
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
    expect(state.refineRuns[0]!.cycleMs).toBe(4_800) // 6000 ×0.8
    expect(state.refineRuns[0]!.batchUnits).toBe(13) // 10 ×1.3
    expect(stopRefineRun(state, ctx, state.refineRuns[0]!.id).ok).toBe(true)
    /**
     * AI 驱动：**炉心熔炼学照吃**（船长 2026-09-22：「炉心熔炼学好像只对主控生效？
     * 现在希望改成对所有都生效」）——先 ÷核心效率（basic Lv1 = 0.4 ⇒ 15000），再 ×0.8（满级 −20%）。
     * 炉膛扩容学**本次未动**，仍只对主控 ⇒ AI 线批容保持 10。
     */
    state.aiCores['basic'] = 1
    state.skills.trained['ai-expert'] = 1 // 2026-09-08 AI 核心上限制
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(state.refineRuns[0]!.cycleMs).toBe(12_000) // 15000 ×0.8
    expect(state.refineRuns[0]!.batchUnits).toBe(10)
    expect(stopRefineRun(state, ctx, state.refineRuns[0]!.id).ok).toBe(true)
  })
})

describe('技能补全 P1：离线作业管理学（结算时长 +20%/级）', () => {
  it('满级 20 小时离线结算 = 16 小时（基础 8 小时 ×2，2026-09-08 船长定）', () => {
    const now = 2_000_000_000_000
    const mk = (): GameState => createInitialState({ nowWallMs: now - 20 * 3_600_000, seed: 13 })
    const s0 = mk()
    simulateOffline(s0, now - 20 * 3_600_000, now, makeTestCtx())
    expect(s0.gameMs).toBe(8 * 3_600_000) // lv0：cap 8h
    const s5 = mk()
    s5.skills.trained['offline-ops'] = 5
    simulateOffline(s5, now - 20 * 3_600_000, now, makeTestCtx())
    expect(s5.gameMs).toBe(16 * 3_600_000) // lv5：cap 16h
  })
})

describe('技能补全：无人值守调度学（离线结算时长 +40%/级 · rank4 · 上位技能，2026-09-20 船长定）', () => {
  it('只练满上位：40 小时离线 = 24 小时（基础 8 小时 ×3）', () => {
    const now = 2_000_000_000_000
    const s = createInitialState({ nowWallMs: now - 40 * 3_600_000, seed: 13 })
    s.skills.trained['unattended-dispatch'] = 5
    simulateOffline(s, now - 40 * 3_600_000, now, makeTestCtx())
    expect(s.gameMs).toBe(24 * 3_600_000)
  })
  it('与离线作业管理学并存叠加：双满级 40 小时离线 = 32 小时（8h × (1+1.0+2.0)）', () => {
    const now = 2_000_000_000_000
    const s = createInitialState({ nowWallMs: now - 40 * 3_600_000, seed: 13 })
    s.skills.trained['offline-ops'] = 5
    s.skills.trained['unattended-dispatch'] = 5
    simulateOffline(s, now - 40 * 3_600_000, now, makeTestCtx())
    expect(s.gameMs).toBe(32 * 3_600_000)
  })
  it('加算口径：上位 L2 = 8h × (1 + 0.8) = 14.4 小时', () => {
    const now = 2_000_000_000_000
    const s = createInitialState({ nowWallMs: now - 20 * 3_600_000, seed: 13 })
    s.skills.trained['unattended-dispatch'] = 2
    simulateOffline(s, now - 20 * 3_600_000, now, makeTestCtx())
    expect(s.gameMs).toBe(14.4 * 3_600_000)
  })
})

describe('技能补全 P3b：高效学习法（训练时长 −4%/级）', () => {
  it('零级 ×1；满级 ×0.8', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 20 })
    expect(trainingTimeFactor(state)).toBe(1)
    state.skills.trained['accelerated-learning'] = 5
    expect(trainingTimeFactor(state)).toBe(0.8)
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

describe('技能补全 P3a：物流/容量/执照/维修', () => {
  it('压缩技术：矿/气/冰体积满级 ×0.7；矿物等不受影响', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 16 })
    const ctx = makeTestCtx()
    const ore = ctx.items.get('ore-a')!
    const mineral = ctx.items.get('min-a')!
    expect(cargoUnitM3(state, ore)).toBe(1)
    expect(cargoUnitM3(state, mineral)).toBeCloseTo(mineral.unitM3 ?? 0, 10)
    state.skills.trained['compression'] = 5
    expect(cargoUnitM3(state, ore)).toBeCloseTo(0.7, 10)
    expect(cargoUnitM3(state, mineral)).toBeCloseTo(mineral.unitM3 ?? 0, 10)
  })
  it('货舱管理学与深空物流学乘算：满级容量 ×1.15×1.2', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 17 })
    const ctx = makeTestCtx()
    const base = fleetDefOf(state, ctx, state.shipId)!.cargoM3
    state.skills.trained['hold-management'] = 5
    expect(cargoCapacityM3Of(state, ctx, state.shipId)).toBe(Math.round(base * 1.15))
    state.skills.trained['deep-space-logistics'] = 5
    expect(cargoCapacityM3Of(state, ctx, state.shipId)).toBe(Math.round(base * 1.15 * 1.2))
  })
  it('采矿舰操作（默认沙猫=industrial）：满级采矿产量 ×1.2', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 18 })
    const ctx = makeTestCtx({ belts: [belt('belt-io', 'ore-a')] })
    const base = fleetDefOf(state, ctx, state.shipId)!.oreUnitsPerCycle
    state.skills.trained['industrial-ops'] = 5
    const p = getMiningParams(state, ctx, { shipId: state.shipId, beltId: 'belt-io' })!
    expect(p.unitsPerCycle).toBe(Math.max(1, Math.floor(base * 1.2)))
  })
  it('维修双技（−10% × −5%/级）乘算：满级实付 ≈ ×0.375（2026-09-08 下限护栏已移除）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 19 })
    const ctx = makeTestCtx()
    state.fleet[state.shipId].durability = 0.4
    const cost0 = repairCostIsk(state, state.shipId, ctx)
    state.skills.trained['repair-engineering'] = 5
    state.skills.trained['station-protocol'] = 5
    const costFull = repairCostIsk(state, state.shipId, ctx)
    expect(costFull).toBeLessThanOrEqual(Math.ceil(cost0 * 0.375) + 1) // ×0.375（ceil 舍入容差）
    expect(costFull).toBeGreaterThanOrEqual(Math.floor(cost0 * 0.375))
  })
})

/**
 * **事件玄学**（2026-09-14 船长四条改判；`id` 仍是 `event-dividend`）。
 *
 * ① 分红部分**一字未动**（+15%/级，`events.ts` 本批无改动）② 新增「洞里出现空白地点的几率」
 * 相对削减（线性每级 −4%、rank 5 ⇒ 满级恰 −20%）③ 改名 / 移入「探索」组 / rank 2→5。
 */
describe('技能补全：事件玄学（event-dividend）', () => {
  it('技能目录：已改名 / 移入探索组 / rank 5；说明同时登记分红与空地点两个每级值', () => {
    const def = SKILLS.find((s) => s.id === 'event-dividend')
    expect(def).toBeDefined()
    expect(def!.name).toBe('事件玄学')
    expect(def!.group).toBe('探索')
    expect(def!.rank).toBe(5)
    expect(def!.description).toContain('15%') // 分红：+15%/级（未动）
    expect(def!.description).toContain('4%') // 空地点：每级相对 −4%
    expect(def!.description).toContain('20%') // 满级 −20%
  })

  it('系数：0 级 = 1（一字不变）· 3 级 = 0.88 · 满级 = 0.8 · 越界夹住（负数 / 超 5 级）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 31 })
    expect(blankShareFactorOf(state)).toBe(1)
    state.skills.trained['event-dividend'] = 3
    expect(blankShareFactorOf(state)).toBeCloseTo(0.88, 10)
    state.skills.trained['event-dividend'] = 5
    expect(blankShareFactorOf(state)).toBeCloseTo(0.8, 10)
    state.skills.trained['event-dividend'] = 99
    expect(blankShareFactorOf(state)).toBeCloseTo(0.8, 10) // 等级上限 5
    state.skills.trained['event-dividend'] = -3
    expect(blankShareFactorOf(state)).toBe(1) // 脏档不会反而放大空地点
  })

  it('接线：走真命令入洞，满级时首层盘面的空地点更少（同 seed 同编队）', () => {
    const ctx = buildSimContext()
    const emptyCountOf = (lv: number): number => {
      const state = createInitialState({ nowWallMs: 0, seed: 4242 })
      state.skills.trained['event-dividend'] = lv
      const uid = addShipToFleet(state, 'sh-thresher')
      expect(wormholeEnter(state, ctx, [uid], 4242).ok).toBe(true)
      return state.wormhole.run!.grid!.cells.filter((c) => c.place === 'empty').length
    }
    /**
     * 层 1：19 格、可分配池 18 ⇒ 0 级 ⌈18 × 50%⌉ = 9 格空 + 终点格本身也记 `empty` = **10**；
     * 满级 ×0.8 ⇒ ⌈18 × 40%⌉ = 8 + 终点 = **9**。
     */
    expect(emptyCountOf(0)).toBe(10)
    expect(emptyCountOf(5)).toBe(9)
  })
})

/**
 * **2026-09-16 船长两条技能改动**（照抄原话）：
 * ① 「**采矿护卫舰操作改名为采集器入门学。**」——`mining-frigate` 只改展示名与说明措辞，
 *    **id 与效果一字不动**（存档零迁移；效果仍是"每级缩短采集循环时间 3%"）。
 * ② 「**矢量机动操作，规避机动学，索敌统合改为rank3**」——三条由 r2 升到 **r3**
 *    （rank 只驱动训练时长：`training.ts` 的 `base × rank`，≈2.9h → ≈11.2h）。
 *    ⚠ 索敌统合与火控阵列学由此同为 r3：2026-09-08「相似效果错开级别」给它俩分档的理由，
 *    在 2026-09-14 船长把索敌统合也改成"炮台命中"口径时**就已作废**（现只靠 3% vs 2% 区分）。
 */
describe('技能改名与 rank 调整（船长 2026-09-16）', () => {
  const byId = (id: string) => SKILLS.find((s) => s.id === id)
  it('采矿护卫舰操作 → 采集器入门学 → 采矿舰入门学：改名不改 id，效果说明仍是每级 −3% 循环', () => {
    const def = byId('mining-frigate')
    expect(def).toBeDefined()
    // 2026-09-22 船长（技能树批 · Excel 坐标工作台回稿）在 09-16 的名字上**再改一次** ⇒ 以最新为准
    expect(def!.name).toBe('采矿舰入门学')
    expect(def!.description).toContain('3%')
    // id 是存档键（`skills.trained`）⇒ 不能动；两个旧名都不许在技能目录里复活
    expect(SKILLS.some((s) => s.name === '采矿护卫舰操作')).toBe(false)
    expect(SKILLS.some((s) => s.name === '采集器入门学')).toBe(false)
  })

  it('矢量机动操作 / 规避机动学 / 索敌统合 三条 rank = 3', () => {
    for (const id of ['vector-maneuvering', 'evasion-maneuvering', 'targeting-integration']) {
      expect(byId(id)?.rank, `${id} 的 rank`).toBe(3)
    }
  })
})

/**
 * **2026-09-22 第二轮回稿**（船长在坐标工作台 `content-csv/skilltree-workbench.xlsx` 里直接改的）：
 * - **改名两条**：`mining-frigate` 采集器入门学 → **采矿舰入门学** · `station-protocol` 空间站协议学 → **空间站维修协议**；
 * - **rank 三条**：动能炮术 1 → 2 · 导弹发射学 1 → 2 · 空间站维修协议 1 → 4；
 * - ⚠ `station-protocol` 升到 r4 后比维修工程学（r3）更深 ⇒ 那一对的**上下级方向翻转**
 *   （前置挂到维修工程学之下），否则违反树契约「父 rank ≤ 子 rank」（`content:check` 会拦）。
 */
describe('技能改名与 rank 调整（船长 2026-09-22 坐标工作台回稿）', () => {
  const byId = (id: string) => SKILLS.find((s) => s.id === id)
  it('两条改名：以最新名字为准，旧名不许复活', () => {
    expect(byId('mining-frigate')?.name).toBe('采矿舰入门学')
    expect(byId('station-protocol')?.name).toBe('空间站维修协议')
    expect(SKILLS.some((s) => s.name === '空间站协议学')).toBe(false)
  })

  it('三条 rank：动能炮术 / 导弹发射学 = 2 · 空间站维修协议 = 4', () => {
    expect(byId('kinetic-gunnery')?.rank).toBe(2)
    expect(byId('missile-launching')?.rank).toBe(2)
    expect(byId('station-protocol')?.rank).toBe(4)
  })

  it('rank 翻转后前置方向跟着翻：维修工程学 → 空间站维修协议（父不比子深）', () => {
    expect(byId('repair-engineering')?.prereq).toEqual(['hull-quick-repair'])
    expect(byId('station-protocol')?.prereq).toEqual(['repair-engineering'])
    for (const s of SKILLS) {
      for (const p of s.prereq ?? []) {
        const parent = byId(p)
        expect(parent, `${s.id} 的前置 ${p} 必须存在`).toBeDefined()
        expect(parent!.rank <= s.rank, `${s.id} 的前置 ${p} 不许更深`).toBe(true)
      }
    }
  })
})
