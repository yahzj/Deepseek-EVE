/**
 * **残骸「入侵」新类别 ＋ G/H 提价批（船长 2026-09-26 逐条裁定）** —— 本文件钉六件事：
 *
 * 1. **新地区类别 `inv`（入侵）**：船长原话「**H族残骸不分高安低安，统一为入侵残骸**（原先的是高安，低安，
 *    虫洞。新增一个类别）」⇒ H 组 `region = 'inv'`、组名 `墨潮帮残骸（入侵）`；组 key **故意不改**
 *    （`wreck-h-hi` 物品 id 已进玩家档 ⇒ 不改名零迁移风险）。
 * 2. **H 四张入侵卡**同步写 `region: 'inv'`（卡级覆写，不再借"高安"的展示口径）。
 * 3. **提价（口径②：两轴同时齐平 D 族）**：船长令「**将G族和H族残骸价格提高到和D族差不多的位置**」＋
 *    「按你推荐来」⇒ H 对标 **D 高安组**（池均价 109.90 · 保底 68.14 ISK/m³）、G 低安组对标
 *    **D 低安组**（池均价 173.95 · 保底 107.85 ISK/m³）。
 *    ⚠ 保底收益 = **档位当量 × 组池均价**（`salvage.recycleBatchValueIsk` 的口径）——本文件按此复算，
 *    与 `content:check` 的「残骸组契约·保值 ±3%」互补：那边查"组池对不对得上卡级加权目标"，
 *    这边查"落地后的价格读数是不是 D 族水平"。
 * 4. **卡级回收档覆写**（新机制 · 单点 `salvage.wreckCardTierOf`）：卡级 `wreckTier` 优先，缺省仍按
 *    星系基础密度现算 ⇒ **没写覆写的卡行为零变化**（本文件用 D 族卡反证缺省路径）。
 * 5. **H 势力装备进残骸**（船长「H族已经添加势力装备，可以放入残骸内」＋「甲2」）：三件
 *    （`FOE_LAIR_GEAR.H`）挂成 `h-hi` 组主题件 ⇒ ① 普通残骸的直出池追加它们
 *    ② 稀有残骸高级箱**未命中专属件时**由它们兜底（改前池空 ⇒ 那 95% 是掉空的）。
 * 6. **联动读数**：高级箱专属件命中率随组档位升到危档 10%（H 5% → 10% · G 8% → 10%）；
 *    残骸收购价随组档位 30/40 → 50（该行的价格契约在 `content:check`，本文件只锁档位来源）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  RARE_BOX_GEAR_CHANCE,
  RECYCLE_YIELD_PER_M3,
  rareBoxThemePoolOf,
  recyclePoolMeanIsk,
  recycleProfileOf,
  recycleTierOf,
  wreckBaseDensity,
  wreckCardTierOf,
  wreckItemIdOf,
  rareWreckItemIdOf,
} from '../src/salvage'
import { WRECK_GROUP_BY_KEY, WRECK_GROUPS, WRECK_REGION_LABELS } from '../src/wreckGroups'

const ctx = buildSimContext()
const priceOf = (id: string): number => ctx.items.get(id)?.baseSellPriceIsk ?? 0
const meanOf = (pool: ReadonlyArray<readonly [string, number]>): number => recyclePoolMeanIsk(pool, priceOf)
/** 保底收益（ISK/m³）= 档位当量 × 池均价 —— 与引擎 `recycleBatchValueIsk` 同口径 */
const perM3Of = (groupId: string): number => {
  const g = WRECK_GROUP_BY_KEY.get(groupId)!
  return RECYCLE_YIELD_PER_M3[g.tier] * meanOf(g.pool)
}

const H_CARDS = ['ink-harass', 'ink-raid', 'ink-main', 'ink-flagship']
const G_LO_CARDS = ['ano-cinder-siege', 'ano-echo-haunt', 'ano-nadir-static']
const H_GEAR = ['mod-lair-ecm-h', 'mod-lair-web-h', 'drone-ink-heavy']

describe('残骸新类别「入侵」（2026-09-26 船长令）', () => {
  it('地区标签表多一档 `inv`，其余三档逐字不变', () => {
    expect(WRECK_REGION_LABELS).toEqual({ hi: '高安', lo: '低安', wh: '虫洞', inv: '入侵' })
  })

  it('H 组 = 入侵类：region/tier/组名/物品 id 都对上（组 key 不改 ⇒ 旧档零迁移）', () => {
    const h = WRECK_GROUP_BY_KEY.get('h-hi')!
    expect(h.region).toBe('inv')
    expect(h.tier).toBe('dire') // 提价令：常档 → 危档
    expect(h.name).toBe('墨潮帮残骸（入侵）')
    expect(h.rareName).toBe('墨潮帮稀有残骸（入侵）')
    expect(h.threat).toBe(124) // 组代表威胁 = 回收口径体量平均（本批不动）
    // 物品 id 不变（组 key 故意保留 `h-hi`）：玩家档里已有的 `wreck-h-hi` 仍解析到本组
    expect(wreckItemIdOf(h.key)).toBe('wreck-h-hi')
    expect(rareWreckItemIdOf(h.key)).toBe('wreck-rare-h-hi')
  })

  it('H 四张入侵卡的卡级地区改 `inv`（不再借高安的展示口径）', () => {
    for (const id of H_CARDS) expect(ctx.anomalies.get(id)?.region, id).toBe('inv')
  })

  it('全表仍 14 组 · 高安 3 / 低安 5 / 虫洞 5 / 入侵 1', () => {
    const tally = { hi: 0, lo: 0, wh: 0, inv: 0 }
    for (const g of WRECK_GROUPS) tally[g.region] += 1
    expect(WRECK_GROUPS.length).toBe(14)
    expect(tally).toEqual({ hi: 3, lo: 5, wh: 5, inv: 1 })
  })
})

describe('G/H 提价：两轴同时齐平 D 族（船长令「按你推荐来」）', () => {
  it('H 组池 = D 高安组同款（钛钢 40 · 星髓晶 34 · 重钨合金 26）⇒ 池均价与保底收益逐值相等', () => {
    const h = WRECK_GROUP_BY_KEY.get('h-hi')!
    expect(h.pool).toEqual([['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]])
    expect(meanOf(h.pool)).toBeCloseTo(109.9, 4)
    expect(perM3Of('h-hi')).toBeCloseTo(68.14, 2)
    // 「和 D 族差不多」的硬读数：与 D 族高安组（d-hi）**逐值相等**
    expect(perM3Of('h-hi')).toBeCloseTo(perM3Of('d-hi'), 6)
    expect(meanOf(h.pool)).toBeCloseTo(meanOf(WRECK_GROUP_BY_KEY.get('d-hi')!.pool), 6)
  })

  it('G 低安组池 = D 低安组同款（钛钢 40 · 冥铁合金 19 · 同位聚晶 41）⇒ 保底收益落在 D 低安组 ±2% 内', () => {
    const g = WRECK_GROUP_BY_KEY.get('g-lo')!
    expect(g.tier).toBe('dire') // 险档 → 危档
    expect(g.pool).toEqual([['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]])
    expect(meanOf(g.pool)).toBeCloseTo(173.95, 4)
    expect(perM3Of('g-lo')).toBeCloseTo(107.85, 2)
    // D 低安组三张卡池均价 173.95 / 173.95 / 169.00 ⇒ 加权 106.6（差 1.2%）
    expect(Math.abs(perM3Of('g-lo') / perM3Of('d-lo') - 1)).toBeLessThan(0.02)
  })

  it('提价前后对照（可复算的读数）：H 56.84 → 68.14 · G 76.20 → 107.85 ISK/m³', () => {
    // 改前 = 常档基础池（H）/ 险档 + 三卡旧池（G）——按"卡级池 × 卡级档位当量"的旧口径复算
    const beforeH = RECYCLE_YIELD_PER_M3.common * RECYCLE_POOLS_COMMON_MEAN()
    expect(beforeH).toBeCloseTo(56.84, 2)
    expect(perM3Of('h-hi')).toBeGreaterThan(beforeH)
    // G 改前：三卡 (66.35 + 68.80 + 88.27) 按体量 42/52/66 加权 = 76.20
    const beforeG = (66.35 * 42 + 68.8 * 52 + 88.27 * 66) / (42 + 52 + 66)
    expect(beforeG).toBeCloseTo(76.2, 1)
    expect(perM3Of('g-lo')).toBeGreaterThan(beforeG)
  })

  it('卡级覆写优先、缺省路径零变化（D 族卡没写覆写 ⇒ 仍按星系基础密度现算）', () => {
    for (const id of H_CARDS) expect(ctx.anomalies.get(id)?.wreckTier, id).toBe('dire')
    for (const id of G_LO_CARDS) expect(ctx.anomalies.get(id)?.wreckTier, id).toBe('dire')
    // 缺省路径：没写 `wreckTier` 的卡 ⇒ 单点回落到"星系基础密度 → 档位"（与 2026-09-19 合并后口径逐值一致）
    const dCard = ctx.anomalies.get('ano-gravekeeper')!
    expect(dCard.wreckTier).toBeUndefined()
    expect(wreckCardTierOf(dCard, ctx)).toBe(recycleTierOf(wreckBaseDensity(dCard.galaxyId, ctx)))
    expect(wreckCardTierOf(dCard, ctx)).toBe('dire')
  })
})

describe('H 势力装备进残骸（船长「可以放入残骸内」＋「甲2」）', () => {
  it('三件 H 势力装备挂成 `h-hi` 组主题件（= `FOE_LAIR_GEAR.H`）', () => {
    const h = WRECK_GROUP_BY_KEY.get('h-hi')!
    expect(h.theme.modules).toEqual(H_GEAR)
    expect(h.theme.mk2 ?? []).toEqual([])
  })

  it('普通 H 残骸的直出池追加这三件（改前池空 ⇒ 普通残骸不出主题件）', () => {
    const p = recycleProfileOf(ctx, 'wreck-h-hi')!
    expect(p.theme?.modules).toEqual(H_GEAR)
    // 「追加」语义：默认直出池一件不少，只是把主题件并进池子
    // ⚠ 直出池（`rollRecycleLoot` 的 base 支）只收**模块**（`ctx.modules`）⇒ 三件里那架无人机
    //    （`drone-ink-heavy`，物品类）**不会**从普通残骸直出；它只走稀有高级箱（专属 10% 支或主题兜底支）。
    //    这条不是漏配，是"直出池 = 模块池"的既有口径（内容侧由 `content:check` 的警告提示提醒）。
    expect(ctx.modules.has('mod-lair-ecm-h')).toBe(true)
    expect(ctx.modules.has('mod-lair-web-h')).toBe(true)
    expect(ctx.modules.has('drone-ink-heavy')).toBe(false)
    expect(ctx.items.get('drone-ink-heavy')?.kind).toBe('drone')
  })

  it('稀有 H 残骸高级箱「未命中专属件 ⇒ 必给主题件」这一支不再掉空（洞外组回落池为空 ⇒ 走组主题件）', () => {
    const rare = recycleProfileOf(ctx, 'wreck-rare-h-hi')!
    expect(rare.rare).toBe(true)
    expect(rare.lairGear).toEqual(H_GEAR) // 专属池（5%→10% 那一支）
    expect(rareBoxThemePoolOf(rare)).toEqual(H_GEAR) // 未命中的兜底支（改前 = 空数组）
  })
})

describe('联动读数：高级箱命中率（组档位派生）', () => {
  it('H 5% → 10% · G 8% → 10%（危档）', () => {
    expect(RARE_BOX_GEAR_CHANCE.dire).toBe(0.1)
    expect(RARE_BOX_GEAR_CHANCE[recycleProfileOf(ctx, 'wreck-h-hi')!.tier]).toBe(0.1)
    expect(RARE_BOX_GEAR_CHANCE[recycleProfileOf(ctx, 'wreck-g-lo')!.tier]).toBe(0.1)
  })
})

/** 常档基础池均价（H 改前用）——从常驻档池现算，不手抄常量 */
function RECYCLE_POOLS_COMMON_MEAN(): number {
  const g = WRECK_GROUP_BY_KEY.get('a-wh')! // 洞内组池 = 常档基础池（与 `RECYCLE_POOLS.common` 同值）
  return meanOf(g.pool)
}
