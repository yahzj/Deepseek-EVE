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
 * 5. **H 势力装备进残骸**（船长「H族已经添加势力装备，可以放入残骸内」＋「甲2」，**同日第二批改混池**）：
 *    三件走**高级箱专属支**（绝境档 10%）；🔴 船长后续令「**将H族稀有残骸按照其他族
 *    那样混池**」⇒ 组主题件由"H 三件"改为通用 MK2 一件（照 D 高安组同款 `mod-shield-pla-2`）
 *    ⇒ 未命中那 90% 出通用件（改前两支同池 ⇒ 稀有箱必出 H 件）。
 *    🔴 ⟪**2026-10-03（船长改口径）**⟫：船长原话「**光环残骸的普通残骸卡牌的特色掉落只有基础的MK2系列，
 *    包括墨潮帮的普通残骸也一样**」→ 追问后定「**普通残骸有10%概率出特色掉落，特色掉落里，MK2和势力装备
 *    混在一起。稀有残骸必定出特色掉落**」⇒ **捕获网 `mod-lair-web-h` 从专属池移出、改挂 `themeGear`
 *    特色池**（每批 10% 掷中 · 族专属件 : 家族 MK2 = 1 : 20）⇒ 专属池 3 → **2 件**、
 *    本组 `theme` 保持为空（不再走会把整条直出链压垮的老机制）。
 * 6. **联动读数**：高级箱专属件命中率随组档位升到危档 10%（H 5% → 10% · G 8% → 10%）；
 *    残骸收购价随组档位 30/40 → 50（该行的价格契约在 `content:check`，本文件只锁档位来源）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  RARE_BOX_GEAR_CHANCE,
  RECYCLE_POOL_AVG_ISK,
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
const H_GEAR = ['mod-lair-ecm-h', 'drone-ink-heavy']

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

  it('全表仍 15 组 · 高安 3 / 低安 5 / 虫洞 5 / 入侵 2', () => {
    const tally = { hi: 0, lo: 0, wh: 0, inv: 0 }
    for (const g of WRECK_GROUPS) tally[g.region] += 1
    expect(WRECK_GROUPS.length).toBe(15)
    expect(tally).toEqual({ hi: 3, lo: 5, wh: 5, inv: 2 })
  })
})

describe('G/H 提价：两轴同时齐平 D 族（船长令「按你推荐来」）', () => {
  it('H 组池 = D 高安组同款（钛钢 40 · 星髓晶 34 · 重钨合金 26）⇒ 池均价与保底收益逐值相等', () => {
    const h = WRECK_GROUP_BY_KEY.get('h-hi')!
    expect(h.pool).toEqual([['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]])
    expect(meanOf(h.pool)).toBeCloseTo(109.9, 4)
    expect(perM3Of('h-hi')).toBeCloseTo(101.88, 2) // 2026-09-28 三档 1:2:3：危档 Y 0.62 → 0.927 ⇒ 0.927 × 109.9
    // 「和 D 族差不多」的硬读数：与 D 族高安组（d-hi）**逐值相等**
    expect(perM3Of('h-hi')).toBeCloseTo(perM3Of('d-hi'), 6)
    expect(meanOf(h.pool)).toBeCloseTo(meanOf(WRECK_GROUP_BY_KEY.get('d-hi')!.pool), 6)
  })

  it('G 低安组池 = D 低安组同款（钛钢 40 · 冥铁合金 19 · 同位聚晶 41）⇒ 保底收益落在 D 低安组 ±2% 内', () => {
    const g = WRECK_GROUP_BY_KEY.get('g-lo')!
    expect(g.tier).toBe('dire') // 险档 → 危档
    expect(g.pool).toEqual([['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]])
    expect(meanOf(g.pool)).toBeCloseTo(173.95, 4)
    expect(perM3Of('g-lo')).toBeCloseTo(161.25, 2) // 2026-09-28 三档 1:2:3：0.927 × 173.95
    // D 低安组三张卡池均价 173.95 / 173.95 / 169.00 ⇒ 加权 106.6（差 1.2%）
    expect(Math.abs(perM3Of('g-lo') / perM3Of('d-lo') - 1)).toBeLessThan(0.02)
  })

  it('提价前后对照（可复算的读数）：H 28.62 → 101.88 · G 76.20 → 161.25 ISK/m³', () => {
    // 改前 = 常档基础池（H）/ 险档 + 三卡旧池（G）——按"卡级池 × 卡级档位当量"的旧口径复算
    const beforeH = RECYCLE_YIELD_PER_M3.common * RECYCLE_POOLS_COMMON_MEAN()
    expect(beforeH).toBeCloseTo(28.616, 2) // 2026-09-28：常档 Y 5.8 → 2.92
    expect(perM3Of('h-hi')).toBeGreaterThan(beforeH)
    // G 改前：三卡 (66.35 + 68.80 + 88.27) 按体量 42/52/66 加权 = 76.20
    const beforeG = (66.35 * 42 + 68.8 * 52 + 88.27 * 66) / (42 + 52 + 66)
    expect(beforeG).toBeCloseTo(76.2, 1) // 旧险/危档口径的加权值（历史留档，算式不变）
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

describe('H 势力装备进残骸（2026-09-26 两批 ＋ 2026-10-03 改「特色池」）', () => {
  it('`h-hi` 组 `theme` 为空、族专属件挂在 `themeGear` —— **与专属池不是同一批**', () => {
    const h = WRECK_GROUP_BY_KEY.get('h-hi')!
    // ⟪2026-10-03⟫ 走 `themeGear` 特色池（每批 10% 掷中、族专属件 : 家族 MK2 = 1 : 20）；
    // `theme` 保持为空（那条老机制会把整条直出链的出件率压低 ×0.031）
    expect(h.theme.modules ?? []).toEqual([])
    expect(h.theme.mk2 ?? []).toEqual([])
    expect(h.themeGear).toEqual(['mod-lair-web-h'])
    // ⟪2026-10-03⟫ 捕获网**已从专属池移出** ⇒ 它只该在特色池里；专属池剩两件
    expect(H_GEAR).not.toContain('mod-lair-web-h')
    for (const id of H_GEAR) expect(h.themeGear ?? [], `${id} 不该在特色池里`).not.toContain(id)
    // 对照：守墓者仍是"通用 MK2 主题追加件"那条老机制（本批没碰它）
    expect(WRECK_GROUP_BY_KEY.get('d-hi')!.theme.modules).toEqual(['mod-shield-pla-2'])
    expect(WRECK_GROUP_BY_KEY.get('d-hi')!.themeGear).toBeUndefined()
  })

  it('普通 H 残骸的特色池 = 族内具名件 ＋ 家族 MK2（不再是默认池那 8 件）', () => {
    const p = recycleProfileOf(ctx, 'wreck-h-hi')!
    expect(p.themeGear).toEqual(['mod-lair-web-h'])
    expect(p.themeGearMk2?.length ?? 0).toBeGreaterThan(0)
    // ⚠ 特色池只收**模块**（`rollRecycleLoot` 的 ①★ 支按 `ctx.modules` 过滤）⇒ 两件都必须是模块
    expect(ctx.modules.has('mod-lair-web-h')).toBe(true)
    expect(ctx.modules.get('mod-lair-web-h')!.slot).toBe('support') // 非武器（B3.1「武器移出主题」契约）
    for (const id of p.themeGearMk2 ?? []) expect(ctx.modules.has(id), `${id} 是模块`).toBe(true)
    // 仍在专属池的那两件**不在特色池里** ⇒ 普通残骸不出它们
    for (const id of H_GEAR) expect(p.themeGear ?? [], `${id} 不该出`).not.toContain(id)
    expect(ctx.items.get('drone-ink-heavy')?.kind).toBe('drone')
  })

  it('稀有 H 残骸高级箱 = **两段式**：专属支 10% 出 H 两件 · 未命中出主题件（通用 MK2 兜底）', () => {
    const rare = recycleProfileOf(ctx, 'wreck-rare-h-hi')!
    expect(rare.rare).toBe(true)
    expect(rare.lairGear).toEqual(H_GEAR) // ① 专属支（绝境档 10%）：电子舱 ＋ 重袭无人机
    // ② 未命中的兜底支：本组 `theme` 为空 ⇒ `rareBoxThemePoolOf` 返回回落池（洞外 = 空 ⇒ 跳过）
    expect(rareBoxThemePoolOf(rare)).toEqual([])
    // 两条支路**不重叠**
    for (const id of H_GEAR) expect(rareBoxThemePoolOf(rare), `${id} 不该在兜底支里`).not.toContain(id)
  })
})

describe('联动读数：高级箱命中率（组档位派生）', () => {
  it('H 5% → 10% · G 8% → 10%（危档）', () => {
    expect(RARE_BOX_GEAR_CHANCE.dire).toBe(0.1)
    expect(RARE_BOX_GEAR_CHANCE[recycleProfileOf(ctx, 'wreck-h-hi')!.tier]).toBe(0.1)
    expect(RARE_BOX_GEAR_CHANCE[recycleProfileOf(ctx, 'wreck-g-lo')!.tier]).toBe(0.1)
  })
})

/** 常档基础池均价（H 改前用）——直接读档基数常量，不借组池做代理
 *  ⚠ 2026-09-30 改：原先借 `a-wh` 组池当代理（当时"洞内组池 = 常档基础池"成立）；
 *  该口径随船长令「虫洞残骸也调整到危级别」失效 ⇒ 改读 `RECYCLE_POOL_AVG_ISK.common`（单点、不漂移）。 */
function RECYCLE_POOLS_COMMON_MEAN(): number {
  return RECYCLE_POOL_AVG_ISK.common
}
