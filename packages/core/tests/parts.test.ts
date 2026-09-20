/**
 * **零件体系**（2026-09-20 船长：组装机新增零件分页 · 造船厂拆分）
 *
 * 钉住四件事：
 * ① 基础零件 = 隐式蓝图（learnless）：无需学习即可开工；蓝图书架不列、学会维度视为已学会；
 * ② 高级零件 = 正常蓝图：未学会不能开工；
 * ③ 两个零件技能：零件成型工艺学（基础 −8%/级）· 精密装配学（高级 −8%/级）——制造时间吃技能；
 * ④ 配方改造：专属装备/舰船材料总价 +50%（按基础收价口径）；皇带鱼等值替换总价不变；空间站各档等值替换总价不变。
 */
import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, ITEMS, SHIP_BLUEPRINTS, STATION_SITES, buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { advanceGame } from '../src/engine'
import { startManufacturing, canStartBlueprint, calcBuildDurationMs } from '../src/manufacturing'
import { addWare, countWare } from '../src/inventory'
import { makeTestCtx } from './helpers'

const ctx = buildSimContext() as SimContext
/** 材料总价（按物品基础收价 baseSellPriceIsk 口径——与 content:check 的料/价同源） */
function matValue(mats: readonly { itemId: string; count: number }[]): number {
  let v = 0
  for (const m of mats) v += (ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0) * m.count
  return v
}

function freshState(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 21 })
  // ⚠ 只备「电路基板」蓝图的料（qchip 蓝图材料里也含 part-circuit ×2，一起备会把初始库存弄混）
  for (const m of BLUEPRINTS.find((b) => b.id === 'bp-part-circuit')!.materials) addWare(s, m.itemId, m.count)
  return s
}

describe('零件体系：基础/高级零件与隐式蓝图（2026-09-20）', () => {
  it('① 基础零件隐式蓝图：无需学习即可开工，且产出入库', () => {
    const s = freshState()
    expect(canStartBlueprint(s, ctx, 'bp-part-circuit')).toBe(true)
    expect(startManufacturing(s, 'bp-part-circuit', 'pilot', ctx).ok).toBe(true)
    advanceGame(s, 46_000, ctx)
    expect(countWare(s, 'part-circuit')).toBe(1)
  })
  it('② 高级零件蓝图：未学会不能开工，学会后可以', () => {
    const s = freshState()
    for (const m of BLUEPRINTS.find((b) => b.id === 'bp-part-qchip')!.materials) addWare(s, m.itemId, m.count)
    expect(canStartBlueprint(s, ctx, 'bp-part-qchip')).toBe(false)
    expect(startManufacturing(s, 'bp-part-qchip', 'pilot', ctx).ok).toBe(false)
    s.learnedRecipes = ['bp-part-qchip']
    expect(canStartBlueprint(s, ctx, 'bp-part-qchip')).toBe(true)
    expect(startManufacturing(s, 'bp-part-qchip', 'pilot', ctx).ok).toBe(true)
  })
  it('③ 零件技能：基础吃「零件成型工艺学」−8%/级 · 高级吃「精密装配学」−8%/级（乘在工业/批量之上）', () => {
    const s = freshState()
    const basicSpec = { materials: BLUEPRINTS.find((b) => b.id === 'bp-part-circuit')!.materials, buildSeconds: 45, buildCostIsk: 0, partTier: 'basic' as const }
    const advSpec = { materials: BLUEPRINTS.find((b) => b.id === 'bp-part-qchip')!.materials, buildSeconds: 240, buildCostIsk: 0, partTier: 'advanced' as const }
    const base = calcBuildDurationMs(s, ctx, basicSpec)
    const adv = calcBuildDurationMs(s, ctx, advSpec)
    s.skills.trained['part-forming'] = 5
    expect(calcBuildDurationMs(s, ctx, basicSpec)).toBe(Math.round(base * 0.6)) // 满级 −40%
    s.skills.trained['part-forming'] = 0
    s.skills.trained['precision-assembly'] = 5
    expect(calcBuildDurationMs(s, ctx, advSpec)).toBe(Math.round(adv * 0.6)) // 满级 −40%
  })
})

describe('零件体系：配方改造（2026-09-20）', () => {
  it('④ 专属装备材料总价 +50%（含零件）· 书价不变', () => {
    const bp = BLUEPRINTS.find((b) => b.id === 'bp-wh-a-frag')!
    const hasPart = bp.materials.some((m) => ctx.items.get(m.itemId)?.kind === 'part')
    expect(hasPart).toBe(true)
    // 原矿物总价 788,000（26,000×8＋7,000×12＋5,000×20＋110×3,600）→ +50% ≈ 1,182,000
    const total = matValue(bp.materials)
    expect(total).toBeGreaterThanOrEqual(788_000 * 1.45)
    expect(total).toBeLessThanOrEqual(788_000 * 1.55)
    expect(bp.priceIsk).toBe(5_244_500) // 书价不变
  })
  it('⑤ 专属舰船材料 +50% · 工期 ÷5', () => {
    const sbp = SHIP_BLUEPRINTS.find((b) => b.id === 'sbp-wh-a-frigate')!
    const hasKeel = sbp.materials.some((m) => m.itemId === 'part-keel')
    expect(hasKeel).toBe(true)
    const total = matValue(sbp.materials)
    expect(total).toBeGreaterThanOrEqual(340_400 * 1.45)
    expect(total).toBeLessThanOrEqual(340_400 * 1.55)
    expect(sbp.buildSeconds).toBe(240) // 1200 ÷ 5
  })
  it('⑥ 皇带鱼：零件等值替换 ⇒ 总价分文不变 · 工期 ÷5', () => {
    const sbp = SHIP_BLUEPRINTS.find((b) => b.id === 'sbp-colossal')!
    // 原总价 307,106,000（8 种矿物按 baseSell）——替换后必须逐分不变
    expect(matValue(sbp.materials)).toBe(307_106_000)
    expect(sbp.materials.some((m) => m.itemId === 'part-keel')).toBe(true)
    expect(sbp.materials.some((m) => m.itemId === 'part-grav-comp')).toBe(true)
    expect(sbp.buildSeconds).toBe(32_400) // 162,000 ÷ 5
  })
  it('⑦ 空间站 6 档：零件等值替换 ⇒ 每档总价不变', () => {
    for (const site of STATION_SITES) {
      for (const tier of site.tiers) {
        const total = matValue(tier.bill)
        const hasPart = tier.bill.some((m) => ctx.items.get(m.itemId)?.kind === 'part')
        expect(hasPart).toBe(true)
        // 原档总价（替换前）：红环 奠基 28,000 / 完善 130,000 / 建成 262,000；烬火 奠基 84,000 / 完善 365,000 / 建成 2,050,000
        const expected: Record<string, number> = {
          'site-redring:奠基': 28_000,
          'site-redring:完善': 130_000,
          'site-redring:建成': 262_000,
          'site-cinder:奠基': 84_000,
          'site-cinder:完善': 365_000,
          'site-cinder:建成': 2_050_000,
        }
        expect(total, `${site.id} ${tier.name} 档总价漂了`).toBe(expected[`${site.id}:${tier.name}`])
      }
    }
  })
})
