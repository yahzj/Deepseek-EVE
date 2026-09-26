/**
 * **协处理器蓝图稀有度 · 比产物高一级**（**2026-09-26 船长令**：
 * 「**协处理器 MK1和MK2新增蓝图，稀有度比产品高一个级别**」）。
 *
 * 背景读数（本轮实测）：`bp-cpu-1` / `bp-cpu-2` **本就在库里**（`blueprints.ts` 有定义、
 * `marketCatalog` 有稀有订单行、可学习可制造），只是稀有度档与产物**同档**（2 / 3）；
 * 全仓惯例也是"蓝图与产物同档"（129 张装备蓝图里 121 张差 0）。船长这条令 ⇒ 把这两张图各**上调一级**。
 *
 * 本文件钉四件事：
 * 1. **档位关系**：`bp-cpu-1` = 产物档 + 1 = **3** · `bp-cpu-2` = 产物档 + 1 = **4**；
 * 2. **有意偏离惯例**：全仓 121/129 张同档，这两张是**白名单例外**（连同类既有 6 张差 1 / 2 张差 −1 一起留痕）；
 * 3. **渠道不动**（船长 2026-09-20「渠道归属不动」＋ 2026-09-16 五艘巡洋舰「数字档与渠道分离」先例）：
 *    两张图仍走**稀有订单**（`rarity: 'rare'`），只是稀有订单内的刷新权重按新档位变稀有
 *    （档 3 ×0.5 / 档 4 ×0.2，见 `market.ts` 的 `rareTierWeight`）；
 * 4. **价与料不动**：书价仍 = 产物价 ×(MK1 2 / MK2 2.5)（776,000 / 4,850,000），材料不动。
 */
import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, MARKET_GOODS, MODULES, RARITY_TIER } from '@whale/data'

const tierOf = (id: string): number => (RARITY_TIER as Record<string, number>)[id]!
const bpOf = (id: string) => BLUEPRINTS.find((b) => b.id === id)!
const modOf = (id: string) => MODULES.find((m) => m.id === id)!
const goodOf = (id: string) => MARKET_GOODS.find((g) => g.key === id)!

describe('协处理器 MK1/MK2 蓝图：稀有度比产物高一级（2026-09-26 船长令）', () => {
  it('两张蓝图都在（可学习、产物 = 协处理器 MK1/MK2），且档位 = 产物档 + 1', () => {
    expect(bpOf('bp-cpu-1').moduleId).toBe('mod-cpu-1')
    expect(bpOf('bp-cpu-2').moduleId).toBe('mod-cpu-2')
    expect(bpOf('bp-cpu-1').singleUse ?? false).toBe(false)
    expect(bpOf('bp-cpu-2').singleUse ?? false).toBe(false)
    expect(modOf('mod-cpu-1').name).toBe('协处理器 MK1')
    expect(modOf('mod-cpu-2').name).toBe('协处理器 MK2')

    expect(tierOf('mod-cpu-1')).toBe(2)
    expect(tierOf('bp-cpu-1')).toBe(tierOf('mod-cpu-1') + 1) // 2 → 3
    expect(tierOf('mod-cpu-2')).toBe(3)
    expect(tierOf('bp-cpu-2')).toBe(tierOf('mod-cpu-2') + 1) // 3 → 4
  })

  it('渠道照旧（两张图都在稀有订单）· 价格与材料不动', () => {
    for (const id of ['bp-cpu-1', 'bp-cpu-2']) {
      expect(goodOf(id).rarity, `${id} 渠道`).toBe('rare')
      expect(goodOf(id).basePrice, `${id} 市场行价须与定义同值`).toBe(bpOf(id).priceIsk)
    }
    // 书价仍 = 产物价 × 档位系数（MK1 ×2 / MK2 ×2.5）
    expect(bpOf('bp-cpu-1').priceIsk).toBe(goodOf('mod-cpu-1').basePrice * 2)
    expect(bpOf('bp-cpu-2').priceIsk).toBe(goodOf('mod-cpu-2').basePrice * 2.5)
    expect(bpOf('bp-cpu-1').materials?.length ?? 0).toBeGreaterThan(0)
    expect(bpOf('bp-cpu-2').materials?.length ?? 0).toBeGreaterThan(0)
  })

  it('全仓「蓝图 vs 产物」档位惯例：同档 119/129，差 1 = 8 张（含本次这两张）——留痕防误改', () => {
    const rows = BLUEPRINTS.filter((b) => (b as { moduleId?: string }).moduleId).map((b) => ({
      bp: b.id,
      mod: (b as { moduleId?: string }).moduleId!,
    }))
    const diffs = rows.map((r) => tierOf(r.bp) - tierOf(r.mod))
    expect(rows.length).toBeGreaterThanOrEqual(129)
    // 改前同档 121 张；本次协处理器两张上调一级 ⇒ 119 张
    expect(diffs.filter((d) => d === 0).length).toBeGreaterThanOrEqual(119)
    // 差 +1 的 8 张：武器线 MK2 三张 · 稳定器三张 · 协处理器两张（本次）
    const plus1 = rows.filter((r) => tierOf(r.bp) - tierOf(r.mod) === 1).map((r) => r.bp).sort()
    expect(plus1).toEqual(
      ['bp-cpu-1', 'bp-cpu-2', 'bp-laser-2', 'bp-missile-2', 'bp-stab-exp-2', 'bp-stab-kin-2', 'bp-stab-pla-2', 'bp-turret-2'].sort(),
    )
    // 差 −1 的两张是既有的"书价漂移预警"户（与本次无关，留痕）
    const minus1 = rows.filter((r) => tierOf(r.bp) - tierOf(r.mod) === -1).map((r) => r.bp).sort()
    expect(minus1).toEqual(['bp-hullrep-1', 'bp-shieldchg-2'])
  })
})
