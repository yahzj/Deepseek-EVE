import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, buildSimContext, EN_SKILLS, ITEMS, MARKET_GOODS, rarityTierOf, SKILL_BRANCHES, SKILLS } from '@whale/data'
import { countWare, itemReleased, visibleItemDefs } from '../src/inventory'
import {
  advanceManufacturing,
  calcBuildDurationMs,
  canStartBlueprint,
  cancelManufacturing,
  materialFactor,
  matNeedCount,
  missingMaterials,
  setManufacturingLoop,
  startManufacturing,
} from '../src/manufacturing'
import {
  DEEP_SPACE_PROBE_BLUEPRINT_ID,
  DEEP_SPACE_SKILL_IDS,
  PROBE_MATERIAL_PER_LEVEL,
  probeManufacturingUnlocked,
  probeMaterialFactor,
} from '../src/probeManufacturing'
import { createInitialState, haltActivityForSwitch } from '../src/state'
import type { GameState } from '../src/state'
import { skillLockMissing } from '../src/skillQueue'
import { skillLicensePriceOf } from '../src/skillLicense'
import { DEEP_SPACE_PROBE_ID } from '../src/stellarSearch'
import { skipFirstSkillReward } from './helpers'

const ctx = buildSimContext()
const bpId = DEEP_SPACE_PROBE_BLUEPRINT_ID
const bp = ctx.blueprints.get(bpId)!
const baseMaterials = [
  { itemId: 'part-frame', count: 800 },
  { itemId: 'part-circuit', count: 800 },
  { itemId: 'part-lens', count: 700 },
  { itemId: 'part-coolant', count: 200 },
  { itemId: 'part-drone-neural', count: 400 },
  { itemId: 'part-qchip', count: 400 },
]

function world(): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  skipFirstSkillReward(state)
  state.planetary = { runtimeVersion: 1, planets: {} }
  return state
}

function needs(state: GameState): { itemId: string; count: number }[] {
  return bp.materials.map(m => ({ itemId: m.itemId, count: matNeedCount(state, m.count, bpId) }))
}

function stock(state: GameState, batches = 1): void {
  for (const m of needs(state)) state.warehouse.items[m.itemId] = m.count * batches
}

function valueOf(materials: readonly { itemId: string; count: number }[]): number {
  return materials.reduce((sum, m) => sum + m.count * ctx.items.get(m.itemId)!.baseSellPriceIsk, 0)
}

describe('深空探测机数据与独立技能（2026-10-07）', () => {
  it('一次性探索道具为 R4、10m3，不进入公开物品、蓝图或市场目录', () => {
    const probe = ctx.items.get(DEEP_SPACE_PROBE_ID)!
    expect(probe).toMatchObject({ kind: 'consumable', unitM3: 10, baseSellPriceIsk: 1_000_000, unreleased: true })
    expect(probe.droneClass).toBeUndefined()
    expect(rarityTierOf(probe.id)).toBe(4)
    expect(rarityTierOf(bpId)).toBe(4)
    expect(itemReleased(probe)).toBe(false)
    expect(visibleItemDefs(ctx).some(item => item.id === probe.id)).toBe(false)
    expect(BLUEPRINTS.filter(itemReleased).some(def => def.id === bpId)).toBe(false)
    expect(MARKET_GOODS.some(g => g.refId === probe.id || g.refId === bpId)).toBe(false)
    expect([...ctx.marketGoods.values()].some(g => g.refId === probe.id || g.refId === bpId)).toBe(false)
  })

  it('配方仅用合法基础与高级零件，未应用技能的单架材料价值为百万', () => {
    expect(bp).toMatchObject({ itemId: DEEP_SPACE_PROBE_ID, outputUnits: 1, buildSeconds: 3_600,
      buildCostIsk: 0, priceIsk: 0, learnless: true, unreleased: true })
    expect(bp.singleUse).not.toBe(true)
    expect(bp.partTier).toBeUndefined()
    expect(bp.materials).toEqual(baseMaterials)
    expect(valueOf(bp.materials)).toBe(1_000_000)
    for (const [i, m] of bp.materials.entries()) {
      expect(ctx.items.get(m.itemId)?.kind).toBe('part')
      expect(ITEMS.some(item => item.id === m.itemId)).toBe(true)
      expect([...ctx.blueprints.values()].find(def => def.itemId === m.itemId)?.partTier).toBe(i < 4 ? 'basic' : 'advanced')
      const good = [...ctx.marketGoods.values()].find(g => g.kind === 'item' && g.refId === m.itemId)!
      expect(good.basePrice).toBe(ctx.items.get(m.itemId)!.baseSellPriceIsk)
    }
    expect(bp.materials.some(m => m.itemId === 'min-voidcrystal')).toBe(false)
    expect(calcBuildDurationMs(world(), ctx, bp)).toBe(3_600_000)
  })

  it('四技能的 rank、技能书、Lv1 前置与双语数值成对，档案学不强连搜索链', () => {
    expect(DEEP_SPACE_SKILL_IDS).toEqual(['deep-space-probing', 'advanced-deep-space-probing', 'stellar-archive', 'probe-assembly'])
    const expected = [
      ['deep-space-probing', 3, '探索', 'b-deep-space'],
      ['advanced-deep-space-probing', 4, '探索', 'b-deep-space'],
      ['stellar-archive', 4, '探索', 'b-deep-space'],
      ['probe-assembly', 3, '工业', 'b-probe-assembly'],
    ] as const
    for (const [id, rank, group, branch] of expected) {
      const def = ctx.skills.get(id)!
      expect(def).toMatchObject({ rank, group, branch })
      expect(SKILL_BRANCHES).toContainEqual({ id: branch, group })
      expect(SKILLS.filter(skill => skill.id === id)).toHaveLength(1)
      expect(EN_SKILLS[id]!.description?.match(/⟦[^⟧]*⟧/g)).toEqual(def.description.match(/⟦[^⟧]*⟧/g))
      expect(EN_SKILLS[id]!.description).not.toMatch(/[\u3400-\u9fff]/)
      expect(skillLicensePriceOf(def)).toBe(rank === 4 ? 500_000 : null)
      if (id !== 'advanced-deep-space-probing') expect(def.prereq ?? []).toEqual([])
    }
    const advanced = ctx.skills.get('advanced-deep-space-probing')!
    expect(advanced.prereq).toEqual(['deep-space-probing'])
    const state = world()
    expect(skillLockMissing(state, advanced, ctx.skills).map(g => [g.def.id, g.needLevel])).toEqual([['deep-space-probing', 1]])
    state.skills.trained['deep-space-probing'] = 1
    expect(skillLockMissing(state, advanced, ctx.skills)).toEqual([])
  })
})

describe('探测机制造需求与退料账', () => {
  it('未解锁时连已学配方与调试模式也不能开工，拒绝无副作用', () => {
    const state = world()
    stock(state)
    state.learnedRecipes.push(bpId)
    state.debugQuick = true
    for (const planetary of [undefined, { planets: {} }]) {
      state.planetary = planetary
      const before = structuredClone(state)
      expect(probeManufacturingUnlocked(state)).toBe(false)
      expect(canStartBlueprint(state, ctx, bpId)).toBe(false)
      expect(startManufacturing(state, bpId, 'pilot', ctx)).toMatchObject({ ok: false, errorId: 'core.probeManufacturing.001' })
      expect(state).toEqual(before)
    }
    state.planetary = { runtimeVersion: 1, planets: {} }
    expect(canStartBlueprint(state, ctx, bpId)).toBe(true)
    expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(true)
    expect(state.manufacturingRuns[0]!.durationMs).toBe(1_000)
  })

  it('专属技能全部等级按每级4%降本，三项材料技能全组合只取整一次', () => {
    const state = world()
    expect(PROBE_MATERIAL_PER_LEVEL).toBe(0.04)
    for (let materials = 0; materials <= 5; materials++) {
      for (let standardization = 0; standardization <= 5; standardization++) {
        for (let assembly = 0; assembly <= 5; assembly++) {
          state.skills.trained = { materials, 'component-standardization': standardization, 'probe-assembly': assembly }
          expect(probeMaterialFactor(state)).toBeCloseTo(1 - 0.04 * assembly)
          for (const m of baseMaterials) {
            expect(matNeedCount(state, m.count, bpId)).toBe(Math.max(1, Math.floor(m.count * (1 - 0.015 * materials) * (1 - 0.008 * standardization) * (1 - 0.04 * assembly))))
            expect(matNeedCount(state, m.count)).toBe(Math.max(1, Math.floor(m.count * materialFactor(state))))
          }
          expect(matNeedCount(state, 1, bpId)).toBe(1)
        }
      }
    }
    expect(needs(state).map(m => m.count)).toEqual([568, 568, 497, 142, 284, 284])
    expect(valueOf(needs(state))).toBe(710_000)
    state.skills.trained['probe-assembly'] = 99
    expect(probeMaterialFactor(state)).toBeCloseTo(0.8)
    state.skills.trained['probe-assembly'] = -1
    expect(probeMaterialFactor(state)).toBe(1)
  })

  it('每个专属技能等级均能按预览实扣、实造一架，无蓝图书与制造费消耗', () => {
    for (let level = 0; level <= 5; level++) {
      const state = world()
      state.skills.trained['probe-assembly'] = level
      stock(state)
      const expected = needs(state)
      const wallet = state.wallet.isk
      expect(missingMaterials(state, ctx, bp, bpId)).toEqual([])
      expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(true)
      expect(state.manufacturingRuns[0]!.spentMaterials).toEqual(expected)
      for (const m of expected) expect(countWare(state, m.itemId)).toBe(0)
      expect(state.learnedRecipes).not.toContain(bpId)
      expect(state.blueprintStock[bpId]).toBeUndefined()
      expect(state.wallet.isk).toBe(wallet)
      state.gameMs = state.manufacturingRuns[0]!.finishAtGameMs
      advanceManufacturing(state, ctx)
      expect(countWare(state, DEEP_SPACE_PROBE_ID)).toBe(1)
      expect(state.manufacturingRuns).toHaveLength(0)
    }
  })

  it('全技能仍使用通用制造工期，百万基配方按满级需求710000实扣', () => {
    const state = world()
    for (const skill of SKILLS) state.skills.trained[skill.id] = 5
    stock(state)
    const expected = needs(state)
    expect(valueOf(expected)).toBe(710_000)
    expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(true)
    expect(state.manufacturingRuns[0]!.spentMaterials).toEqual(expected)
    expect(state.manufacturingRuns[0]!.durationMs).toBe(Math.round(calcBuildDurationMs(state, ctx, bp) * 0.75))
    state.gameMs = state.manufacturingRuns[0]!.finishAtGameMs
    advanceManufacturing(state, ctx)
    expect(countWare(state, DEEP_SPACE_PROBE_ID)).toBe(1)
  })

  it('任一材料缺一件即拒绝，不扣其它料、钱包或核心', () => {
    for (const missing of baseMaterials) {
      const state = world()
      state.skills.trained['probe-assembly'] = 5
      state.skills.trained['ai-expert'] = 5
      state.aiCores.basic = 1
      stock(state)
      state.warehouse.items[missing.itemId]!--
      const before = structuredClone(state)
      expect(missingMaterials(state, ctx, bp, bpId)).toHaveLength(1)
      expect(startManufacturing(state, bpId, 'basic', ctx).ok).toBe(false)
      expect(state).toEqual(before)
    }
  })

  it('取消与自动停机退实际账，训练中改变等级不改变退款', () => {
    for (const stop of ['cancel', 'halt'] as const) {
      const state = world()
      state.skills.trained = { materials: 5, 'component-standardization': 5, 'probe-assembly': 5 }
      stock(state)
      const expected = needs(state)
      expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(true)
      state.skills.trained = {}
      if (stop === 'cancel') expect(cancelManufacturing(state, ctx, state.manufacturingRuns[0]!.id).ok).toBe(true)
      else haltActivityForSwitch(state, 'manufacturing')
      for (const m of expected) expect(countWare(state, m.itemId)).toBe(m.count)
      expect(countWare(state, DEEP_SPACE_PROBE_ID)).toBe(0)
      expect(valueOf(expected)).toBe(710_000)
    }
  })

  it('连续生产按当前技能续扣，账只记在跑一架，取消不退已交付材料', () => {
    const state = world()
    stock(state, 3)
    expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(true)
    expect(setManufacturingLoop(state, bpId, true).ok).toBe(true)
    state.skills.trained = { materials: 5, 'component-standardization': 5, 'probe-assembly': 5 }
    const next = needs(state)
    state.gameMs = state.manufacturingRuns[0]!.finishAtGameMs
    advanceManufacturing(state, ctx)
    expect(countWare(state, DEEP_SPACE_PROBE_ID)).toBe(1)
    expect(state.manufacturingRuns[0]!.spentMaterials).toEqual(next)
    for (const m of baseMaterials) expect(countWare(state, m.itemId)).toBe(m.count * 2 - matNeedCount(state, m.count, bpId))
    expect(cancelManufacturing(state, ctx, state.manufacturingRuns[0]!.id).ok).toBe(true)
    for (const m of baseMaterials) expect(countWare(state, m.itemId)).toBe(m.count * 2)
    expect(countWare(state, DEEP_SPACE_PROBE_ID)).toBe(1)
  })

  it('大步推进连续产出到目标即止，料尽或失去运行许可不续扣', () => {
    for (const mode of ['goal', 'empty', 'locked'] as const) {
      const state = world()
      state.skills.trained = { materials: 5, 'component-standardization': 5, 'probe-assembly': 5 }
      stock(state, mode === 'empty' ? 1 : 3)
      expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(true)
      expect(setManufacturingLoop(state, bpId, true, mode === 'goal' ? 3 : undefined).ok).toBe(true)
      if (mode === 'locked') state.planetary = undefined
      state.gameMs = 3 * state.manufacturingRuns[0]!.durationMs
      advanceManufacturing(state, ctx)
      expect(countWare(state, DEEP_SPACE_PROBE_ID)).toBe(mode === 'goal' ? 3 : 1)
      for (const m of needs(state)) expect(countWare(state, m.itemId)).toBe(mode === 'locked' ? m.count * 2 : 0)
      expect(state.manufacturingRuns).toHaveLength(0)
      expect(state.manufacturingLoops[bpId]!.on).toBe(false)
    }
  })

  it('没有材料账的旧线退款兜底也带蓝图id', () => {
    const state = world()
    state.skills.trained = { materials: 5, 'component-standardization': 5, 'probe-assembly': 5 }
    stock(state)
    const expected = needs(state)
    expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(true)
    delete state.manufacturingRuns[0]!.spentMaterials
    expect(cancelManufacturing(state, ctx, state.manufacturingRuns[0]!.id).ok).toBe(true)
    for (const m of expected) expect(countWare(state, m.itemId)).toBe(m.count)
  })

  it('普通隐式蓝图不吃专属降本、不受星系解锁影响，实扣与退款不变', () => {
    const state = world()
    state.planetary = undefined
    state.skills.trained = { materials: 5, 'component-standardization': 5, 'probe-assembly': 5 }
    const ordinary = ctx.blueprints.get('bp-part-frame')!
    const expected = ordinary.materials.map(m => ({ itemId: m.itemId, count: matNeedCount(state, m.count) }))
    for (const m of ordinary.materials) expect(matNeedCount(state, m.count, ordinary.id)).toBe(matNeedCount(state, m.count))
    for (const m of expected) state.warehouse.items[m.itemId] = m.count
    expect(canStartBlueprint(state, ctx, ordinary.id)).toBe(true)
    expect(startManufacturing(state, ordinary.id, 'pilot', ctx).ok).toBe(true)
    expect(state.manufacturingRuns[0]!.spentMaterials).toEqual(expected)
    expect(cancelManufacturing(state, ctx, state.manufacturingRuns[0]!.id).ok).toBe(true)
    for (const m of expected) expect(countWare(state, m.itemId)).toBe(m.count)
  })
})
