/**
 * **组装机卡片排序**（2026-09-14 船长 · 三号 · verify）
 *
 * 船长原话（照抄）：「**一次性图纸应该和原图纸放在一起，很抱歉是我说错了**」
 * ——上一条「将组装机的卡牌重新按照价值排序，现在完全是乱序的」由船长本人当场作废，本件只钉"成组相邻"。
 *
 * 口径（`manufacturing.ts` 的 `sortManuRows` 段注释是正文，本件是钉子）：
 * ① 2026-09-08 船长定：类型（装备→舰船→消耗品）→ **蓝图价格升序** → 名称；无市场价沉底；
 * ② 2026-09-14 船长改定：**同产物（同 `productKey`）的图纸相邻**，组内**原图纸在前、一次性图纸紧随**，
 *    **组位次仍按原图纸的书价** ⇒ **非一次性卡的相对位次与 09-08 口径逐格一致**（本件第 ② 条钉这条）。
 *
 * ⚠ 放在 core 的原因与 `battleVerdictOf` 同款：**渲染层没有测试运行器**，而排序口径漂移只会表现为
 * "看着乱"、不会报错（本次报障就是这么来的）。
 * ⚠ 用**目录表 `MARKET_GOODS`** 取书价（与 `once-ship-blueprints.test.ts` 同款理由：`ctx.marketGoods`
 * 会按闸门滤掉 `unreleased` 行）；蓝图目录则按 `itemReleased` 滤（= 组装机可见目录同口径）。
 * 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, MARKET_GOODS, SHIP_BLUEPRINTS } from '@whale/data'
import { itemReleased } from '../src/inventory'
import { MANU_KIND_ORDER, sortManuRows, type ManuOrderRow } from '../src/manufacturing'

/** 书价（市场目录 basePrice；无行 = 0 ⇒ 沉底） */
const bookPriceOf = (bpId: string): number =>
  MARKET_GOODS.find((g) => g.kind === 'blueprint' && g.refId === bpId)?.basePrice ?? 0

/** 组装机可见目录（= 渲染层 `engine.shipBlueprints` / `engine.blueprints` 的过滤口径） */
function visibleRows(): ManuOrderRow[] {
  const rows: ManuOrderRow[] = []
  for (const sbp of SHIP_BLUEPRINTS) {
    if (!itemReleased(sbp)) continue
    rows.push({
      kindLabel: '舰船',
      name: sbp.name,
      bookPrice: bookPriceOf(sbp.id),
      productKey: `ship:${sbp.shipId}`,
      singleUse: sbp.singleUse === true,
    })
  }
  for (const bp of BLUEPRINTS) {
    if (!itemReleased(bp)) continue
    if (bp.itemId === undefined) {
      rows.push({
        kindLabel: '装备',
        name: bp.name,
        bookPrice: bookPriceOf(bp.id),
        productKey: `module:${bp.moduleId}`,
        singleUse: bp.singleUse === true,
      })
    } else {
      rows.push({
        kindLabel: '消耗品',
        name: bp.name,
        bookPrice: bookPriceOf(bp.id),
        productKey: `item:${bp.itemId}`,
        singleUse: bp.singleUse === true,
      })
    }
  }
  return rows
}

/** **2026-09-08 旧口径**（本件当基线用：非一次性卡的相对位次不得被新口径改动） */
function legacyOrder(rows: readonly ManuOrderRow[]): ManuOrderRow[] {
  const rank = (v: number): number => (v > 0 ? v : Number.MAX_SAFE_INTEGER)
  return [...rows].sort(
    (a, b) =>
      (MANU_KIND_ORDER[a.kindLabel] ?? 9) - (MANU_KIND_ORDER[b.kindLabel] ?? 9) ||
      rank(a.bookPrice) - rank(b.bookPrice) ||
      a.name.localeCompare(b.name, 'zh-Hans-CN'),
  )
}

/** 成对相邻数：同产物两张图（一张原图纸 + 一张一次性）在结果里是否紧邻
 *  `total` = 目录里全部一次性图纸（含"只有一次性、没有原图纸"的洞内掉落专属图纸，它们进不了紧邻计数）；
 *  `adjacent` = 其中**确有原图纸且紧邻**的张数（判据只对能配对的那些成立） */
function adjacentPairs(order: readonly ManuOrderRow[]): { total: number; adjacent: number } {
  const once = order.filter((r) => r.singleUse)
  let adjacent = 0
  for (const o of once) {
    const mate = order.findIndex((r) => !r.singleUse && r.productKey === o.productKey)
    if (mate >= 0 && Math.abs(order.findIndex((r) => r === o) - mate) === 1) adjacent += 1
  }
  return { total: once.length, adjacent }
}

describe('组装机卡片排序（2026-09-14 船长：一次性图纸和原图纸放在一起）', () => {
  it('① 真实目录：一次性舰船图纸**全部**紧邻各自原图纸（旧口径 0 对相邻）', () => {
    const rows = visibleRows()
    const legacy = legacyOrder(rows)
    const next = sortManuRows(rows)
    // 61 = 原 14（T3 十 + T4 三 + T5 一）+ 虫洞上线新增 43（五族专属装备图纸 28 + 舰船图纸 15）
    //      + 鹦鹉螺级 1（2026-09-14 随虫洞上线放开 `unreleased` 后进了可见目录）
    //      + 3 张专属无人机一次性图纸（2026-09-14 船长「专属无人机出一次性蓝图」，每次 50 架）
    // + 2 = 2026-09-20「护盾充能力场装置」MK2/MK3 的一次性图纸（同样是"只有一次性、没有原图纸"）
    expect(adjacentPairs(next).total).toBe(65) // 2026-09-26：+虎鲸/旋齿鲨两对（永久 + 一次性）
    expect(adjacentPairs(legacy).adjacent).toBe(0) // 旧口径：一对都不相邻（这就是船长看到的"散落"）
    /**
     * ⚠ **虫洞那 43 张是"只有一次性、没有原图纸"的掉落专属图纸**（一次到手即用，不存在可反复买的原图纸）
     * ⇒ 它们的 `mate` 找不到，本就进不了"紧邻"计数；能配对的 **15** 张（原 14 + 鹦鹉螺级，
     * 它同时有永久图纸 `sbp-nautilus`）照旧必须全部紧邻。
     */
    expect(adjacentPairs(next).adjacent).toBe(17) // 2026-09-26：17 = 原 15 + 两艘新 T4
  })

  it('② 真实目录：**非一次性卡**的相对位次与 09-08 口径逐格一致（新口径只搬一次性卡）', () => {
    const rows = visibleRows()
    const keep = (list: readonly ManuOrderRow[], kind: string): string[] =>
      list.filter((r) => r.kindLabel === kind && !r.singleUse).map((r) => r.name)
    const legacy = legacyOrder(rows)
    const next = sortManuRows(rows)
    for (const kind of ['装备', '舰船', '消耗品']) {
      expect(keep(next, kind)).toEqual(keep(legacy, kind))
    }
  })

  it('③ 组位次按**原图纸**书价：一次性图比原图纸便宜得多，仍紧随其后（不被价格带挤走）', () => {
    const rows: ManuOrderRow[] = [
      { kindLabel: '舰船', name: '乙级舰船蓝图（一次性）', bookPrice: 1, productKey: 'ship:b', singleUse: true },
      { kindLabel: '舰船', name: '甲级舰船蓝图', bookPrice: 50, productKey: 'ship:a', singleUse: false },
      { kindLabel: '舰船', name: '乙级舰船蓝图', bookPrice: 200, productKey: 'ship:b', singleUse: false },
      { kindLabel: '舰船', name: '丙级舰船蓝图', bookPrice: 900, productKey: 'ship:c', singleUse: false },
    ]
    // 组位次按原图纸书价升序 ⇒ 甲(50) → 乙(200，含那张 1 价的一次性) → 丙(900)
    expect(sortManuRows(rows).map((r) => r.name)).toEqual([
      '甲级舰船蓝图',
      '乙级舰船蓝图',
      '乙级舰船蓝图（一次性）',
      '丙级舰船蓝图',
    ])
  })

  it('④ 没有原图纸的一次性图纸（洞内定制船/装备）按**自身**书价排，不贴到别人后面', () => {
    const rows: ManuOrderRow[] = [
      { kindLabel: '装备', name: '定制炮图纸（一次性）', bookPrice: 0, productKey: 'module:x1', singleUse: false },
      { kindLabel: '装备', name: '普通炮图纸', bookPrice: 300, productKey: 'module:x2', singleUse: false },
    ]
    // 把上面第一条改成一次性：无原图纸 ⇒ 守自身书价（0 ⇒ 沉底），不会被拉到 300 那张后面当"配对"
    const once: ManuOrderRow[] = [{ ...rows[0]!, singleUse: true }, rows[1]!]
    expect(sortManuRows(once).map((r) => r.name)).toEqual(['普通炮图纸', '定制炮图纸（一次性）'])
  })

  it('⑤ 无市场价（书价 0）沉底：连同其一次性图纸一起沉底，且组内原图纸在前', () => {
    const rows: ManuOrderRow[] = [
      { kindLabel: '装备', name: '有价装备图纸', bookPrice: 10, productKey: 'module:a', singleUse: false },
      { kindLabel: '装备', name: '无价装备图纸（一次性）', bookPrice: 0, productKey: 'module:b', singleUse: true },
      { kindLabel: '装备', name: '无价装备图纸', bookPrice: 0, productKey: 'module:b', singleUse: false },
    ]
    expect(sortManuRows(rows).map((r) => r.name)).toEqual([
      '有价装备图纸',
      '无价装备图纸',
      '无价装备图纸（一次性）',
    ])
  })

  it('⑥ 分类序与兜底：装备 → 舰船 → 消耗品；表外分类排最后；不改入参', () => {
    const rows: ManuOrderRow[] = [
      { kindLabel: '消耗品', name: '弹药图纸', bookPrice: 1, productKey: 'item:a', singleUse: false },
      { kindLabel: '表外', name: '别的图纸', bookPrice: 1, productKey: 'x:a', singleUse: false },
      { kindLabel: '舰船', name: '船图纸', bookPrice: 1, productKey: 'ship:a', singleUse: false },
      { kindLabel: '装备', name: '装备图纸', bookPrice: 1, productKey: 'module:a', singleUse: false },
    ]
    const snapshot = rows.map((r) => r.name)
    expect(sortManuRows(rows).map((r) => r.kindLabel)).toEqual(['装备', '舰船', '消耗品', '表外'])
    expect(rows.map((r) => r.name)).toEqual(snapshot) // 入参未被就地排序
  })
})
