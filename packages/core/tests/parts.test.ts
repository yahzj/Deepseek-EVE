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
import { startManufacturing, canStartBlueprint, calcBuildDurationMs, sortManuRows } from '../src/manufacturing'
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
  it('① 基础零件隐式蓝图：无需学习即可开工，一次产 10 件、15 秒一轮、完成不写事件日志', () => {
    const s = freshState()
    expect(canStartBlueprint(s, ctx, 'bp-part-circuit')).toBe(true)
    expect(startManufacturing(s, 'bp-part-circuit', 'pilot', ctx).ok).toBe(true)
    const beforeLogs = s.logs.length
    advanceGame(s, 16_000, ctx)
    expect(countWare(s, 'part-circuit')).toBe(10) // 一次产 10 件
    // 2026-09-20 船长「零件的制造完成不需要发送事件日志」——推进期间可以有别的事件日志，但不该有"制造完成"
    expect(s.logs.slice(beforeLogs).some((l) => l.text.includes('制造完成'))).toBe(false)
  })
  it('② 高级零件蓝图：未学会不能开工，学会后可以（60 秒一轮、一次产 10 件）', () => {
    const s = freshState()
    for (const m of BLUEPRINTS.find((b) => b.id === 'bp-part-qchip')!.materials) addWare(s, m.itemId, m.count)
    expect(canStartBlueprint(s, ctx, 'bp-part-qchip')).toBe(false)
    expect(startManufacturing(s, 'bp-part-qchip', 'pilot', ctx).ok).toBe(false)
    s.learnedRecipes = ['bp-part-qchip']
    expect(canStartBlueprint(s, ctx, 'bp-part-qchip')).toBe(true)
    expect(startManufacturing(s, 'bp-part-qchip', 'pilot', ctx).ok).toBe(true)
    advanceGame(s, 61_000, ctx)
    expect(countWare(s, 'part-qchip')).toBe(10)
  })
  it('③ 零件技能：基础吃「零件成型工艺学」−8%/级 · 高级吃「精密装配学」−8%/级（乘在工业/批量之上）', () => {
    const s = freshState()
    const basicSpec = { materials: BLUEPRINTS.find((b) => b.id === 'bp-part-circuit')!.materials, buildSeconds: 15, buildCostIsk: 0, partTier: 'basic' as const }
    const advSpec = { materials: BLUEPRINTS.find((b) => b.id === 'bp-part-qchip')!.materials, buildSeconds: 55, buildCostIsk: 0, partTier: 'advanced' as const }
    const base = calcBuildDurationMs(s, ctx, basicSpec)
    const adv = calcBuildDurationMs(s, ctx, advSpec)
    s.skills.trained['part-forming'] = 5
    expect(calcBuildDurationMs(s, ctx, basicSpec)).toBe(Math.round(base * 0.6)) // 满级 −40%
    s.skills.trained['part-forming'] = 0
    s.skills.trained['precision-assembly'] = 5
    expect(calcBuildDurationMs(s, ctx, advSpec)).toBe(Math.round(adv * 0.6)) // 满级 −40%
  })
  it('③b 零件排序：基础零件默认在前、高级在后（sortManuRows 组内 partTier 优先）', () => {
    const rows = [
      { kindLabel: '零件', name: '引力子补偿器蓝图', bookPrice: 10_000_000, productKey: 'item:part-grav-comp', singleUse: false, partTier: 'advanced' as const },
      { kindLabel: '零件', name: '电路基板制造', bookPrice: 0, productKey: 'item:part-circuit', singleUse: false, partTier: 'basic' as const },
      { kindLabel: '零件', name: '量子协处理器芯蓝图', bookPrice: 10_000_000, productKey: 'item:part-qchip', singleUse: false, partTier: 'advanced' as const },
    ]
    const sorted = sortManuRows(rows)
    expect(sorted.map((r) => r.name)).toEqual(['电路基板制造', '量子协处理器芯蓝图', '引力子补偿器蓝图'])
  })
  it('③c 收益平衡（2026-09-20 船长「毛利率不变，靠工时把收益差收窄到 1.5 倍内」）：同级收益/秒 ≤1.5 倍', () => {
    // 收益/秒 = 每轮 10 件毛利 ÷ 轮时；毛利 = (定价 − 材料成本) × 10
    const rateOf = (bpId: string, price: number): number => {
      const bp = BLUEPRINTS.find((b) => b.id === bpId)!
      return (10 * (price - matValue(bp.materials))) / bp.buildSeconds
    }
    const basics: Array<[string, number]> = [
      ['bp-part-circuit', 95], ['bp-part-coolant', 115], ['bp-part-frame', 145], ['bp-part-cable', 155],
      ['bp-part-lens', 190], ['bp-part-armor-plate', 250], ['bp-part-gyro', 420],
    ]
    const advances: Array<[string, number]> = [
      ['bp-part-qchip', 700], ['bp-part-drone-neural', 930], ['bp-part-shield-gen', 1_010],
      ['bp-part-jet-array', 1_550], ['bp-part-fire-control', 1_670], ['bp-part-keel', 3_120], ['bp-part-grav-comp', 7_500],
    ]
    for (const group of [basics, advances]) {
      const rates = group.map(([id, price]) => rateOf(id, price))
      expect(Math.max(...rates) / Math.min(...rates)).toBeLessThanOrEqual(1.5)
    }
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
  it('⑥b 材料全覆盖（2026-09-20 船长问「材料是否覆盖了除虚空晶之外的所有材料」）：冥铁合金已进零件链 · 补偿器等值替换料价不变', () => {
    // 引力子补偿器补冥铁（等值替换：料价仍 50,000/轮 = 单件 5,000）
    const grav = BLUEPRINTS.find((b) => b.id === 'bp-part-grav-comp')!
    expect(grav.materials.some((m) => m.itemId === 'min-darkiron')).toBe(true)
    expect(matValue(grav.materials)).toBe(50_000)
    // 全 8 种原材料里，除虚空晶（虫洞特产）外全部被零件链用到
    const used = new Set<string>()
    for (const bp of BLUEPRINTS) {
      if (!bp.id.startsWith('bp-part-')) continue
      for (const m of bp.materials) if (m.itemId.startsWith('min-')) used.add(m.itemId)
    }
    for (const id of ['min-tritanium', 'min-pyerite', 'min-mexallon', 'min-nocxium', 'min-isotope', 'min-starcore', 'min-darkiron']) {
      expect(used.has(id), `${id} 没被任何零件用到`).toBe(true)
    }
    expect(used.has('min-voidcrystal')).toBe(false) // 虚空晶按船长排除（虫洞特产）
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
  it('⑧ 市场渠道（「所有零件及其蓝图都在常驻市场有出售」）：全部常驻 · 池总价值分档平滑递增 · 高级零件蓝图书价 1,000 万', () => {
    const partIds = [
      'part-circuit', 'part-armor-plate', 'part-frame', 'part-cable', 'part-coolant', 'part-gyro', 'part-lens',
      'part-drone-neural', 'part-shield-gen', 'part-jet-array', 'part-qchip', 'part-keel', 'part-fire-control', 'part-grav-comp',
    ]
    for (const partId of partIds) {
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'item' && x.refId === partId)
      expect(g, `${partId} 无市场行`).toBeTruthy()
      expect(g?.rarity).toBe('common')
    }
    // 2026-09-20 船长「池子更平滑 + 高级零件池总价值逐步上涨」：按价格升序，池总价值不降、池数量不增
    const sorted = partIds
      .map((id) => [...ctx.marketGoods.values()].find((x) => x.kind === 'item' && x.refId === id)!)
      .sort((a, b) => a.basePrice - b.basePrice)
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!
      const cur = sorted[i]!
      expect(
        (cur.poolTarget ?? 0) * cur.basePrice,
        `${cur.refId} 池总价值低于更便宜的 ${prev.refId}`,
      ).toBeGreaterThanOrEqual((prev.poolTarget ?? 0) * prev.basePrice)
      expect(cur.poolTarget ?? 0, `${cur.refId} 池数量高于更便宜的 ${prev.refId}`).toBeLessThanOrEqual(prev.poolTarget ?? 0)
    }
    for (const bpId of [
      'bp-part-drone-neural', 'bp-part-shield-gen', 'bp-part-jet-array', 'bp-part-qchip',
      'bp-part-keel', 'bp-part-fire-control', 'bp-part-grav-comp',
    ]) {
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'blueprint' && x.refId === bpId)
      expect(g, `${bpId} 无市场行`).toBeTruthy()
      expect(g?.rarity).toBe('common')
      expect(g?.basePrice).toBe(10_000_000)
      expect(BLUEPRINTS.find((b) => b.id === bpId)?.priceIsk).toBe(10_000_000) // 书价与市场行同值
    }
  })
})
