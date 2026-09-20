/**
 * **图标模式稀有度小标签**（2026-09-20 船长：「希望给每个物品的图标模式右上角添加物品稀有度
 * 展示的小标签（采用 R1 表示 1 级稀有度，并以此类推）」）。
 *
 * 这一组钉**查档单点** `itemRarityTierOf` 的口径——都是 2026-09-20 实测出来的，
 * 且**只看代码看不出来**（键形不同但都合法）：
 * ① AI 核心：物品 id `ai-core-<t>` **本来就在主表**（档 1，与"洞内实物形态"同档）；
 *    ⚠ 市场里另有一条**可交易**的 `core-<t>` 行（refId `gamma` 等、档 4）——**那是另一回事**，
 *    绝不能把市场短名套到物品 id 上（会把洞内核心错标成 R4；这条是实测踩出来的）；
 * ② 舰船：多数键与物品 id 同形，**只有鲸王是历史遗留的无前缀键** `whale-king`；
 * ③ 残骸/碎片：**根本没有市场行**，但档位就在**同一张表**里（2026-09-20 船长：
 *    「两个稀有度表没有区别就合并，并删除多余的表」⇒ 原先拆出去的 `OFF_MARKET_RARITY_TIER` 已并入）。
 *
 * 另钉一条设计口径：**查不到档就不显示标签**（返回 `undefined`），不硬塞 R1——
 * 沙猫级、零件蓝图这类"船长明令不上市场"的东西本来就不该被标成"常驻档"。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext, itemRarityTierOf, RARITY_TIER } from '@whale/data'

const ctx = buildSimContext()
/** 键是否真的在表里（⚠ 不能用 `T[k] ?? 缺省` 判——值为 0/false 时会被误判成"没有"） */
const inTable = (k: string): boolean => Object.prototype.hasOwnProperty.call(RARITY_TIER, k)

describe('稀有度查档单点（图标模式小标签用）', () => {
  it('装备与蓝图：id 与市场 refId 同形，直接命中', () => {
    expect(itemRarityTierOf('mod-turret-kin-2')).toBe(RARITY_TIER['mod-turret-kin-2'])
    expect(itemRarityTierOf('bp-pd-e-3')).toBe(RARITY_TIER['bp-pd-e-3'])
    expect(itemRarityTierOf('sbp-nautilus')).toBe(RARITY_TIER['sbp-nautilus'])
  })

  it('① AI 核心：物品 id 本来就在主表（档 1）；不得误套市场短名（那是可交易的那条行）', () => {
    expect(inTable('ai-core-gamma')).toBe(true)
    expect(itemRarityTierOf('ai-core-gamma')).toBe(RARITY_TIER['ai-core-gamma'])
    expect(itemRarityTierOf('ai-core-beta')).toBe(RARITY_TIER['ai-core-beta'])
    expect(itemRarityTierOf('ai-core-alpha')).toBe(RARITY_TIER['ai-core-alpha'])
    // ⚠ 市场短名 `gamma`（可交易核心 · 档 4）与物品 `ai-core-gamma`（洞内实物 · 档 1）**是两回事**
    expect(RARITY_TIER['gamma']).toBeGreaterThan(RARITY_TIER['ai-core-gamma']!)
    expect(itemRarityTierOf('ai-core-gamma')).not.toBe(RARITY_TIER['gamma'])
  })

  it('② 舰船：多数键与物品 id 同形；鲸王是历史遗留的无前缀键', () => {
    expect(inTable('sh-thresher')).toBe(true)
    expect(itemRarityTierOf('sh-thresher')).toBe(RARITY_TIER['sh-thresher'])
    expect(itemRarityTierOf('sh-wh-e-frigate')).toBe(RARITY_TIER['sh-wh-e-frigate'])
    /**
     * ⚠ **鲸王三个名字各不相同**（实测）：物品 id `sh-whale-king` · 主表键 **`whale-king`**（无前缀）·
     * 市场行 refId `ship-whale-king`。只试"直接命中"会落空 ⇒ 去掉 `sh-` 再试一把才解得开。
     */
    expect(inTable('sh-whale-king')).toBe(false)
    expect(inTable('whale-king')).toBe(true)
    expect(itemRarityTierOf('sh-whale-king')).toBe(RARITY_TIER['whale-king'])
  })

  it('③ 残骸/碎片：无市场行，但档位就在**同一张表**里；稀有残骸档次高于普通残骸', () => {
    // 合并后：残骸/碎片的键与市场商品**同表同语义**（不再有第二张表）
    expect(inTable('wreck-rare-a-wh')).toBe(true)
    expect(inTable('frag-mod-miner-3')).toBe(true)
    expect(itemRarityTierOf('wreck-rare-a-wh')).toBe(RARITY_TIER['wreck-rare-a-wh'])
    expect(itemRarityTierOf('frag-mod-miner-3')).toBe(RARITY_TIER['frag-mod-miner-3'])
    const rare = itemRarityTierOf('wreck-rare-a-wh')!
    const plain = itemRarityTierOf('wreck-a-wh')!
    expect(rare).toBeGreaterThan(plain)
    // MK3 碎片高于 MK2（档随产物档次）
    expect(itemRarityTierOf('frag-mod-miner-3')!).toBeGreaterThan(itemRarityTierOf('frag-mod-miner-2')!)
  })

  it('查不到档 ⇒ undefined（界面不显示标签，不硬塞 R1）', () => {
    expect(itemRarityTierOf('sandcat')).toBeUndefined() // 沙猫级：船长定市场价 0、不上市场
    expect(itemRarityTierOf('sbp-sandcat')).toBeUndefined()
    expect(itemRarityTierOf('不存在的东西')).toBeUndefined()
  })

  it('覆盖率：**上市场的**物品/装备/舰船/蓝图全部查得到（查不到的只剩不上市场那几件）', () => {
    const missingItems = [...ctx.items.keys()].filter((id) => itemRarityTierOf(id) === undefined)
    expect(missingItems, '物品应全部有档').toEqual([])
    const missingMods = [...ctx.modules.keys()].filter((id) => itemRarityTierOf(id) === undefined)
    expect(missingMods, '装备应全部有档').toEqual([])
    // 舰船只剩"船长明令不上市场"的沙猫与邓氏鱼
    expect([...ctx.ships.keys()].filter((id) => itemRarityTierOf(id) === undefined).sort()).toEqual([
      'sandcat',
      'sh-dunkleosteus',
    ])
    // 蓝图只剩零件蓝图（2026-09-20 一号的零件体系，明确不上市场）＋沙猫蓝图
    const missingBp = [...ctx.blueprints.keys(), ...ctx.shipBlueprints.keys()].filter(
      (id) => itemRarityTierOf(id) === undefined,
    )
    expect(missingBp.every((id) => id.startsWith('bp-part-') || id === 'sbp-sandcat')).toBe(true)
  })

  it('档位值域：**唯一一张表**里全部为 1~5 整数（合并后不再有第二张表可对不上）', () => {
    for (const [k, v] of Object.entries(RARITY_TIER)) {
      expect(Number.isInteger(v) && v >= 1 && v <= 5, `${k} 越界：${v}`).toBe(true)
    }
  })

  it('合并核对：市场外物品（残骸/碎片）的 24 条键都在表里，且与市场 refId 无冲突', () => {
    const offMarket = [
      'wreck-rare-a-hi',
      'wreck-rare-a-lo',
      'wreck-rare-a-wh',
      'wreck-a-wh',
      'wreck-g-wh',
      'frag-mod-miner-2',
      'frag-mod-turret-kin-3',
    ]
    for (const k of offMarket) expect(inTable(k), `${k} 应在（唯一）稀有度表里`).toBe(true)
    // 市场 refId 集合里不该出现这些键（它们没有市场行）——这正是"合并进同表"的前提
    const refIds = new Set([...ctx.marketGoods.values()].map((g) => g.refId))
    for (const k of offMarket) expect(refIds.has(k), `${k} 不该有市场行`).toBe(false)
  })
})
