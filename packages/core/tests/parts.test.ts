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
  /* ── 2026-09-20 船长追加裁定「调整专属舰船和装备使用零件的比例，需要提高」：
   *   价值占比口径 · 专属 = 基础 45% + 高级 30% + 矿物 25% · T4 与 T5 = 基础 75% + 矿物 25%（非专属不用高级件）
   *   · **等值替换**（总价分文不变）· 允许删原材料（每张至多留 4 行矿物）。 */
  const BASIC_IDS = new Set(['part-frame', 'part-armor-plate', 'part-cable', 'part-circuit', 'part-coolant'])
  /** 全部 7 种基础件（上图那 5 种是"专属篮子"用的子集；层级规则要认全） */
  const ALL_BASIC_IDS = new Set([...BASIC_IDS, 'part-gyro', 'part-lens'])
  const ADV_IDS = new Set(['part-keel', 'part-qchip', 'part-fire-control', 'part-grav-comp', 'part-jet-array', 'part-shield-gen', 'part-drone-neural'])
  const shares = (mats: readonly { itemId: string; count: number }[]): { basic: number; adv: number; raw: number } => {
    let basic = 0
    let adv = 0
    let raw = 0
    for (const m of mats) {
      const v = (ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0) * m.count
      if (BASIC_IDS.has(m.itemId)) basic += v
      else if (ADV_IDS.has(m.itemId)) adv += v
      else raw += v
    }
    const total = basic + adv + raw
    return { basic: basic / total, adv: adv / total, raw: raw / total }
  }
  const T4_IDS = ['sbp-swordfish', 'sbp-bowhead', 'sbp-xuanwu', 'sbp-megalodon']

  it('④ 专属装备：总价不变（+50% 口径保留）· 占比 = 基础 45% / 高级 30% / 矿物 25% · 书价不变', () => {
    const bp = BLUEPRINTS.find((b) => b.id === 'bp-wh-a-frag')!
    expect(matValue(bp.materials)).toBe(1_181_970) // 改造前定稿值（等值替换 ⇒ 分文不变）
    expect(bp.priceIsk).toBe(5_244_500) // 书价不变
    const s = shares(bp.materials)
    expect(s.basic).toBeCloseTo(0.45, 1)
    expect(s.adv).toBeCloseTo(0.3, 1)
    expect(s.raw).toBeCloseTo(0.25, 1)
    // 全部 30 张专属装备/无人机同口径（±2 个百分点，取整余量）
    for (const b of BLUEPRINTS.filter((x) => x.id.startsWith('bp-wh-'))) {
      const k = shares(b.materials)
      expect(k.basic, `${b.id} 基础件占比`).toBeGreaterThan(0.43)
      expect(k.basic, `${b.id} 基础件占比`).toBeLessThan(0.47)
      expect(k.adv, `${b.id} 高级件占比`).toBeGreaterThan(0.28)
      expect(k.adv, `${b.id} 高级件占比`).toBeLessThan(0.32)
    }
  })
  it('⑤ 专属舰船：总价不变 · 占比同口径（45/30/25）· 工期 ÷5', () => {
    const sbp = SHIP_BLUEPRINTS.find((b) => b.id === 'sbp-wh-a-frigate')!
    expect(matValue(sbp.materials)).toBe(510_280) // 改造前定稿值（等值替换）
    expect(sbp.buildSeconds).toBe(240) // 1200 ÷ 5
    for (const b of SHIP_BLUEPRINTS.filter((x) => x.id.startsWith('sbp-wh-'))) {
      const k = shares(b.materials)
      expect(k.basic, `${b.id} 基础件占比`).toBeGreaterThan(0.43)
      expect(k.adv, `${b.id} 高级件占比`).toBeGreaterThan(0.28)
      expect(k.raw, `${b.id} 矿物占比`).toBeGreaterThan(0.23)
    }
  })
  it('⑥ 皇带鱼：总价分文不变 · **只用基础零件**（非专属不吃高级件）· 占比 75/25 · **虚空晶留在配方** · 工期 ÷5', () => {
    const sbp = SHIP_BLUEPRINTS.find((b) => b.id === 'sbp-colossal')!
    expect(matValue(sbp.materials)).toBe(307_106_000) // 原总价（8 种矿物口径）⇒ 替换后逐分不变
    expect(sbp.buildSeconds).toBe(32_400) // 162,000 ÷ 5
    expect(sbp.materials.some((m) => m.itemId === 'part-frame')).toBe(true)
    // 2026-09-20 船长追加：「让虚空晶留在旗舰配方」⇒ 虫洞特产仍是旗舰的招牌料（**原量 10,320**）
    expect(sbp.materials.find((m) => m.itemId === 'min-voidcrystal')?.count).toBe(10_320)
    const once = SHIP_BLUEPRINTS.find((b) => b.id === 'sbp-once-colossal')!
    expect(once.materials).toEqual(sbp.materials) // 一次性孪生同料同价
    for (const m of sbp.materials) expect(ADV_IDS.has(m.itemId), `${m.itemId} 不该出现在非专属配方里`).toBe(false)
    const s = shares(sbp.materials)
    expect(s.basic).toBeCloseTo(0.75, 1)
    expect(s.raw).toBeCloseTo(0.25, 1)
  })
  it('⑥c T4 舰船（含一次性孪生共 8 张）：纳入改造 · 只用基础件 · 占比 75/25 · 总价与孪生一致', () => {
    const T4_TOTALS: Record<string, number> = {
      'sbp-swordfish': 10_800_000,
      'sbp-bowhead': 30_340_000,
      'sbp-xuanwu': 40_450_000,
      'sbp-megalodon': 101_250_000,
    }
    for (const id of T4_IDS) {
      const bp = SHIP_BLUEPRINTS.find((b) => b.id === id)!
      const once = SHIP_BLUEPRINTS.find((b) => b.id === `sbp-once-${id.replace('sbp-', '')}`)!
      expect(matValue(bp.materials), `${id} 总价应保持改造前`).toBe(T4_TOTALS[id])
      expect(matValue(once.materials), `一次性孪生 ${once.id} 与本体同料同价`).toBe(T4_TOTALS[id])
      for (const b of [bp, once]) {
        const s = shares(b.materials)
        expect(s.basic, `${b.id} 基础件占比`).toBeCloseTo(0.75, 1)
        expect(s.raw, `${b.id} 矿物占比`).toBeCloseTo(0.25, 1)
        for (const m of b.materials) expect(ADV_IDS.has(m.itemId), `${b.id} 不该含高级件`).toBe(false)
      }
    }
  })
  /**
   * **零件配方的层级规则**（船长 2026-09-20：「**高级零件允许使用多个普通零件，但是不许使用同级别高级零件**」）。
   *
   * 出处：原提案把 `军规火控计算机 = 量子协处理器芯 ×1`、`引力子补偿器 = 舰用龙骨组件 ×1` 写成了
   * 高级件吃高级件（`git show 31582577` 即如此），船长发现后定此规 ⇒ 两条按**等值替换**改造
   * （料价分文不变：11,100 / 50,000），把那一行换成**多个基础件 + 矿物**。
   */
  it('⑧ 层级规则：高级件可以吃多个基础件，但不得以任何高级件为料；基础件只吃矿物', () => {
    const partIds = BLUEPRINTS.filter((b) => b.id.startsWith('bp-part-'))
    expect(partIds.length).toBe(14) // 7 基础（隐式）+ 7 高级
    for (const bp of partIds) {
      const parts = bp.materials.filter((m) => ctx.items.get(m.itemId)?.kind === 'part').map((m) => m.itemId)
      if (bp.partTier === 'advanced') {
        for (const id of parts) expect(ADV_IDS.has(id), `${bp.id} 以高级件 ${id} 为料`).toBe(false)
        for (const id of parts) expect(ALL_BASIC_IDS.has(id), `${bp.id} 的零件成分 ${id} 不是基础件`).toBe(true)
      } else {
        expect(parts, `${bp.id}（基础件）不该以任何零件为料`).toEqual([])
      }
    }
    // 两条历史配方：等值替换后料价分文不变，且原来那行高级件已移除、基础件变多
    const fc = BLUEPRINTS.find((b) => b.id === 'bp-part-fire-control')!
    expect(matValue(fc.materials)).toBe(11_100)
    expect(fc.materials.some((m) => m.itemId === 'part-qchip')).toBe(false)
    expect(fc.materials.filter((m) => ALL_BASIC_IDS.has(m.itemId)).length).toBeGreaterThanOrEqual(2)
    const gc = BLUEPRINTS.find((b) => b.id === 'bp-part-grav-comp')!
    expect(matValue(gc.materials)).toBe(50_000)
    expect(gc.materials.some((m) => m.itemId === 'part-keel')).toBe(false)
    expect(gc.materials.filter((m) => ALL_BASIC_IDS.has(m.itemId)).length).toBe(4)
    // 冥铁合金仍在（2026-09-20 材料覆盖那条裁定不许被这次替换弄丢）
    expect(gc.materials.some((m) => m.itemId === 'min-darkiron')).toBe(true)
  })

  it('⑥d 范围边界：T1~T3 普通舰船与 T5 之外的常规蓝图**不进零件体系**（保持 0 零件）', () => {
    const touched = new Set<string>([
      ...T4_IDS,
      ...T4_IDS.map((id) => `sbp-once-${id.replace('sbp-', '')}`),
      'sbp-colossal',
      'sbp-once-colossal',
    ])
    for (const b of SHIP_BLUEPRINTS) {
      if (b.id.startsWith('sbp-wh-') || touched.has(b.id)) continue
      expect(b.materials.some((m) => ctx.items.get(m.itemId)?.kind === 'part'), `${b.id} 不该有零件`).toBe(false)
    }
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
