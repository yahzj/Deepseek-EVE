/**
 * 批二「18 条 R4/R5 上位技能」回归（**2026-09-27 船长令**：效果是现有技能的上位补充、效果较低，集中在工业与战斗）。
 *
 * 口径：**每级 = 父技能每级 ÷ 3**；与父技能**同乘区乘算**；前置只要父技能 Lv1；
 * 「同轴合计不超过父的 1.5 倍」按「上位满级 ≤ 父满级的三分之一」执行。
 * 本文件逐条钉住 18 条的每级值与乘算关系，并核对"零级不动任何读数"。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { makeTestCtx } from './helpers'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/shipyard'
import { calcBuildDurationMs } from '../src/manufacturing'
import { refineRate, refineRunViews, startRecycleRun, startRefineRun } from '../src/industry'
import { recycleRefiningMultiplier } from '../src/salvage'
import { salvagerCyclesOf } from '../src/salvaging'
import { aiServicingUpgradeMult } from '../src/ai'
import {
  damageUpgradeMult,
  droneReloadUpgradeMult,
  familyUpgradeMult,
  familyUpgradeSkillIdOf,
  hitUpgradeMult,
  reloadUpgradeMult,
} from '../src/combat'
import { SKILLS } from '@whale/data'

const mk = (seed = 27): { state: GameState; ctx: SimContext } => ({
  state: createInitialState({ nowWallMs: 0, seed }),
  ctx: makeTestCtx(),
})

/** 起一台精炼炉并读它的视图（原料放货仓；料足即可开） */
async function refineViewOf(state: GameState, ctx: SimContext, units = 200): Promise<{ batchUnits: number; cycleMs: number }> {
  state.fleet[state.shipId]!.cargo['ore-a'] = units
  const r = startRefineRun(state, 'ore-a', 'pilot', ctx)
  expect(r.ok, r.ok ? '' : r.error).toBe(true)
  const v = refineRunViews(state, ctx)[0]!
  return { batchUnits: v.batchUnits, cycleMs: v.cycleMs }
}

describe('批二上位技能 · 工业侧 10 条', () => {
  it('零件成型统合学：基础零件制造时间每级再 −2.5%（满级 ×0.875）', () => {
    const { state, ctx } = mk(1)
    const spec = { materials: [], buildSeconds: 100, buildCostIsk: 0, partTier: 'basic' } as const
    expect(calcBuildDurationMs(state, ctx, spec)).toBe(100_000)
    state.skills.trained['part-forming-integration'] = 5
    expect(calcBuildDurationMs(state, ctx, spec)).toBe(87_500)
  })

  it('精密装配统合学：高级零件制造时间每级再 −2.5%（满级 ×0.875）', () => {
    const { state, ctx } = mk(2)
    const spec = { materials: [], buildSeconds: 100, buildCostIsk: 0, partTier: 'advanced' } as const
    expect(calcBuildDurationMs(state, ctx, spec)).toBe(100_000)
    state.skills.trained['precision-assembly-integration'] = 5
    expect(calcBuildDurationMs(state, ctx, spec)).toBe(87_500)
  })

  it('流水线统合学：蓝图制造时间每级再 −1.5%（满级 ×0.925）', () => {
    const { state, ctx } = mk(3)
    const spec = { materials: [], buildSeconds: 100, buildCostIsk: 0 } as const
    expect(calcBuildDurationMs(state, ctx, spec)).toBe(100_000)
    state.skills.trained['industry-integration'] = 5
    expect(calcBuildDurationMs(state, ctx, spec)).toBe(92_500)
  })

  it('熔炉精通学：精炼产出倍率相加 +1%/级（满级 1.20 → 1.25）', () => {
    const { state, ctx } = mk(4)
    expect(refineRate(state, ctx)).toBeCloseTo(1.2, 10)
    state.skills.trained['smelting-mastery'] = 5
    expect(refineRate(state, ctx)).toBeCloseTo(1.25, 10)
    // 与父技能同轴：高级回收处理满级 = 1.35，再加上位 = 1.40（相加口径）
    state.skills.trained['reprocessing'] = 5
    expect(refineRate(state, ctx)).toBeCloseTo(1.4, 10)
  })

  it('残骸精炼学：保底产出乘数 ×(1+2.5%/级)，与残骸提纯学乘算（满级 1.4 × 1.125 = 1.575）', () => {
    const { state } = mk(5)
    expect(recycleRefiningMultiplier(state)).toBeCloseTo(1, 10)
    state.skills.trained['wreck-refining'] = 5
    expect(recycleRefiningMultiplier(state)).toBeCloseTo(1.125, 10)
    state.skills.trained['salvage-refining'] = 5
    expect(recycleRefiningMultiplier(state)).toBeCloseTo(1.575, 10)
  })

  it('炉膛倍增学：精炼批容 ×(1+4%/级)（满级再 +20%，与炉膛扩容学乘算）——2026-09-29 船长令 2%→4%', async () => {
    const a = mk(6)
    const base = await refineViewOf(a.state, a.ctx)
    const b = mk(7)
    b.state.skills.trained['furnace-amplification'] = 5
    const withUp = await refineViewOf(b.state, b.ctx)
    expect(withUp.batchUnits).toBe(Math.round(base.batchUnits * 1.2))
  })

  it('恒温炉控学：精炼单批周期 ×(1−1.5%/级)（满级 ×0.925）', async () => {
    const a = mk(8)
    const base = await refineViewOf(a.state, a.ctx)
    const b = mk(9)
    b.state.skills.trained['furnace-thermal-control'] = 5
    const withUp = await refineViewOf(b.state, b.ctx)
    expect(withUp.cycleMs).toBe(Math.round(base.cycleMs * 0.925))
  })

  it('残骸流水线学：回收批周期 ×(1−1.5%/级)（满级 ×0.925）', () => {
    const read = (up: number): number => {
      const { state, ctx } = mk(10 + up)
      const wreckId = [...ctx.items.values()].find((d) => d.kind === 'wreck')!.id
      state.warehouse.items[wreckId] = 500
      state.skills.trained['salvage-recycling-integration'] = up
      const r = startRecycleRun(state, wreckId, 'pilot', ctx)
      expect(r.ok, r.ok ? '' : r.error).toBe(true)
      return refineRunViews(state, ctx)[0]!.cycleMs
    }
    const base = read(0)
    expect(read(5)).toBe(Math.round(base * 0.925))
  })

  it('打捞器超频学：打捞器单轮周期 ×(1−1%/级)，与打捞装置整备学乘算（满级 8075ms）', () => {
    const cycles = (rig: number, up: number): number[] => {
      // ⚠ 本用例要用**真目录**：`makeTestCtx()` 的模块表是测试替身，查不到「打捞器 MK1」⇒ 会静默返回空表
      const state = createInitialState({ nowWallMs: 0, seed: 20 + rig + up })
      const ctx = buildSimContext()
      const uid = addShipToFleet(state, 'sandcat')
      state.shipId = uid
      state.fleet[uid]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
      state.skills.trained['salvage-rigging'] = rig
      state.skills.trained['salvager-overclock'] = up
      return salvagerCyclesOf(state, ctx, uid)
    }
    expect(cycles(0, 0)).toEqual([10_000])
    expect(cycles(0, 5)).toEqual([9_500]) // 10_000 × 0.95（每级 −1% ⇒ 满级 −5%）
    expect(cycles(5, 5)).toEqual([8_075]) // 10_000 × 0.85 × 0.95
  })

  it('副船统合整备学：副船采矿循环乘数 ×(1−1%/级)（满级 ×0.95）', () => {
    const { state } = mk(30)
    expect(aiServicingUpgradeMult(state)).toBeCloseTo(1, 10)
    state.skills.trained['ai-servicing-integration'] = 5
    expect(aiServicingUpgradeMult(state)).toBeCloseTo(0.95, 10)
  })
})

describe('批二上位技能 · 战斗侧 8 条', () => {
  it('高级炮术学：单发伤害 ×(1+1.5%/级)（满级 ×1.075）', () => {
    const { state } = mk(41)
    expect(damageUpgradeMult(state)).toBeCloseTo(1, 10)
    state.skills.trained['advanced-gunnery'] = 5
    expect(damageUpgradeMult(state)).toBeCloseTo(1.075, 10)
  })

  it('武器族上位：动能射击学 / 导弹制导学 / 光束聚焦学各挂一族，每级 +1.5%', () => {
    expect(familyUpgradeSkillIdOf('turret')).toBe('kinetic-ballistics')
    expect(familyUpgradeSkillIdOf('missile')).toBe('missile-guidance')
    expect(familyUpgradeSkillIdOf('laser')).toBe('beam-focusing')
    const { state } = mk(43)
    expect(familyUpgradeMult(state, 'turret')).toBeCloseTo(1, 10)
    expect(familyUpgradeMult(state, null), '基础舰炮无族 = 不吃').toBeCloseTo(1, 10)
    state.skills.trained['kinetic-ballistics'] = 5
    expect(familyUpgradeMult(state, 'turret')).toBeCloseTo(1.075, 10)
    expect(familyUpgradeMult(state, 'missile'), '族与族互不串乘').toBeCloseTo(1, 10)
    state.skills.trained['missile-guidance'] = 5
    state.skills.trained['beam-focusing'] = 5
    expect(familyUpgradeMult(state, 'missile')).toBeCloseTo(1.075, 10)
    expect(familyUpgradeMult(state, 'laser')).toBeCloseTo(1.075, 10)
  })

  it('火控统合学：命中 ×(1+1%/级)（满级 ×1.05）', () => {
    const { state } = mk(44)
    expect(hitUpgradeMult(state)).toBeCloseTo(1, 10)
    state.skills.trained['fire-control-integration'] = 5
    expect(hitUpgradeMult(state)).toBeCloseTo(1.05, 10)
  })

  it('速射装填学：装填 ×(1−1.5%/级)（满级 ×0.925）', () => {
    const { state } = mk(45)
    expect(reloadUpgradeMult(state)).toBeCloseTo(1, 10)
    state.skills.trained['rapid-reload'] = 5
    expect(reloadUpgradeMult(state)).toBeCloseTo(0.925, 10)
  })

  it('无人机整备统合学：无人机装填 ×(1−1.5%/级)（满级 ×0.925）', () => {
    const { state } = mk(46)
    expect(droneReloadUpgradeMult(state)).toBeCloseTo(1, 10)
    state.skills.trained['drone-servicing-integration'] = 5
    expect(droneReloadUpgradeMult(state)).toBeCloseTo(0.925, 10)
  })
})

describe('批二上位技能 · 名单与树契约', () => {
  const NEW = [
    'furnace-amplification',
    'furnace-thermal-control',
    'smelting-mastery',
    'part-forming-integration',
    'precision-assembly-integration',
    'industry-integration',
    'salvager-overclock',
    'wreck-refining',
    'salvage-recycling-integration',
    'ai-servicing-integration',
    'advanced-gunnery',
    'kinetic-ballistics',
    'missile-guidance',
    'beam-focusing',
    'fire-control-integration',
    'rapid-reload',
    'drone-servicing-integration',
  ]

  it('17 条全部在表里、rank ∈ {4,5}、只挂工业与战斗（不含矿业）', () => {
    const byId = new Map(SKILLS.map((s) => [s.id, s]))
    expect(NEW.length).toBe(17)
    for (const id of NEW) {
      const def = byId.get(id)
      expect(def, id).toBeTruthy()
      expect([4, 5], id).toContain(def!.rank)
      expect(['工业', '战斗'], id).toContain(def!.group)
      expect((def!.prereq ?? []).length, id).toBe(1)
      expect(def!.prereqLevel, `${id} 门槛按船长令只要 Lv1（不填 prereqLevel）`).toBeUndefined()
    }
    // 2026-09-29 船长令：本表仍是 2026-09-27 那批的 17 条（新批的 3 条不在 NEW 里）；总数与工业条数随新批更新
    // 2026-09-30 船长令（燃料上限批）：再加 4 条实验室书技能（上限 ×2 / 节拍 / 收率）⇒ 总 108 → 112、工业 34 → 38
    expect(SKILLS.length).toBe(115)
    expect(SKILLS.filter((s) => s.group === '工业').length).toBe(38)
    expect(SKILLS.filter((s) => s.group === '战斗').length).toBe(27)
  })

  it('树契约：父 rank ≤ 子 rank，且父技能真实存在', () => {
    const byId = new Map(SKILLS.map((s) => [s.id, s]))
    for (const id of NEW) {
      const child = byId.get(id)!
      const parent = byId.get(child.prereq![0]!)!
      expect(parent, `${id} 的父技能`).toBeTruthy()
      expect(parent.rank, `${id} 的父 rank 应 ≤ 子 rank`).toBeLessThanOrEqual(child.rank)
    }
  })
})
