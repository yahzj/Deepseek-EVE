/**
 * **T3/T4/T5 的一次性舰船蓝图**（2026-09-13 船长三条裁定 · 二号 · d2）
 *
 * 船长原话（照抄）：
 * - 「**T4T5舰船都出一张一次性蓝图，价格按照舰船价格的100%算。**」
 * - 「**给T3船也添加一次性蓝图**」
 * - 「**还是有惩罚吧，按50%算**」（权重：普通蓝图 ×0.05，一次性 ×0.5）
 * - 渠道划分：「**将T3巡洋舰的一次性蓝图下放到稀有**」·「**蝠鲼现货和蓝图上调至奇货，一次性蓝图保留在稀有**」·
 *   「**剑鱼的一次性蓝图也下放稀有**」·「**玳瑁现货和蓝图上调至奇货**」
 *
 * ⚠ **2026-09-14 船长改判价格口径（原话照抄）**：「**将一次性蓝图的价格下调到舰船的0.5倍**」⇒
 * 上面第一条里的「价格按照舰船价格的100%算」**作废**，改为 **= 该舰市场行价 × 0.5**。
 *
 * 本件钉四件事：
 * ① **每艘 T3/T4/T5 有价舰都有一张一次性蓝图**（`singleUse: true`），
 *    **价格 = 该舰市场行价 × 0.5**（不是永久图纸的 ×3/×4），**材料与工期与永久蓝图逐字相同**；
 * ② **权重**：`blueprintWeight` 对一次性舰船蓝图 = **×0.5**（`balance.market.singleUseBlueprintWeight`），
 *    普通蓝图仍 ×0.05，非蓝图行 = 1；
 * ③ **渠道**：T3 十张 + 剑鱼/蝠鲼 = 稀有订单层（数字 3）；玄武/巨齿鲨/皇带鱼 = 奇货（数字 4）；
 * ④ **语义**：`isSingleUseBlueprint` = true（造一艘吃一张；不进碎片逆向表，由 content:check 守）。
 *
 * ⚠ 用**目录表 `MARKET_GOODS` + `RARITY_TIER`** 而不是 `ctx.marketGoods`：后者按闸门过滤掉了
 * `unreleased` 的行（鹦鹉螺级那张就是），会漏检。本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { MARKET_GOODS, RARITY_TIER, SHIPS, SHIP_BLUEPRINTS, buildSimContext } from '@whale/data'
import { blueprintWeight } from '../src/market'
import { isSingleUseBlueprint } from '../src/manufacturing'
import {
  WORMHOLE_DILUTION_MIN_DEPTH,
  WORMHOLE_DILUTION_SHARE,
  WORMHOLE_FAMILIES,
  wormholeDilutionPoolOf,
  wormholeFamilyPoolOf,
  wormholeLootShares,
} from '../src/index'

const ctx = buildSimContext()
const ONCE = SHIP_BLUEPRINTS.filter((b) => b.singleUse === true && b.id.startsWith('sbp-once-'))
const goodOf = (kind: 'ship' | 'blueprint', refId: string) => MARKET_GOODS.find((g) => g.kind === kind && g.refId === refId)
const shipPrice = (shipId: string) => goodOf('ship', shipId)?.basePrice ?? 0

describe('T3/T4/T5 一次性舰船蓝图（2026-09-13）', () => {
  it('① 每艘 T3/T4/T5 有价舰都有一张；价格 = 行价 ×0.5（2026-09-14 改判）；材料与工期与永久蓝图相同', () => {
    /**
     * ⚠ **2026-09-14 收窄判据**：本节只数"**同时有永久蓝图**"的那 15 张（`sbp-once-*`：T3 十 + T4 四 + T5 一）。
     * 洞内定制舰船（`sh-wh-*`）如今也有市场行（只收不卖，2026-09-14「允许玩家挂卖」批），
     * 但它们**没有永久蓝图**（只有一次性图纸 `sbp-wh-*`，价格同样 = 舰价 ×0.5）——
     * 那 15 张由 `tests/exclusive-market.test.ts` ② 单独钉。
     */
    const withPrice = SHIPS.filter(
      (s) => s.tier >= 3 && shipPrice(s.id) > 0 && SHIP_BLUEPRINTS.some((b) => b.shipId === s.id && b.singleUse !== true),
    )
    expect(withPrice.length).toBe(17) // T3 十 + T4 六（2026-09-26 +虎鲸/旋齿鲨）+ T5 一
    for (const s of withPrice) {
      const once = SHIP_BLUEPRINTS.find((b) => b.shipId === s.id && b.singleUse === true)
      expect(once, `${s.name}（${s.id}）缺一次性蓝图`).toBeTruthy()
      // 2026-09-14 船长：「将一次性蓝图的价格下调到舰船的0.5倍」（原 ×100% 作废）
      expect(once!.priceIsk, `${once!.id} 价格应为行价 ×0.5`).toBe(Math.round(shipPrice(s.id) * 0.5))
      const perm = SHIP_BLUEPRINTS.find((b) => b.shipId === s.id && b.singleUse !== true)
      expect(perm, `${s.name} 应有永久蓝图作为对照`).toBeTruthy()
      expect(once!.materials).toEqual(perm!.materials) // 材料与永久蓝图逐字相同
      expect(once!.buildSeconds).toBe(perm!.buildSeconds)
      expect(isSingleUseBlueprint(ctx, once!.id)).toBe(true)
      expect(isSingleUseBlueprint(ctx, perm!.id)).toBe(false)
    }
    // 壳体（邓氏鱼）不出一次性图纸
    expect(SHIP_BLUEPRINTS.some((b) => b.shipId === 'sh-dunkleosteus')).toBe(false)
    expect(ONCE.length).toBe(17)
  })

  it('② 权重白盒：一次性 ×0.5 · 普通蓝图 ×0.05 · 非蓝图 1（旋钮可调）', () => {
    for (const b of ONCE) {
      expect(blueprintWeight(goodOf('blueprint', b.id)!, ctx), `${b.id} 应 ×0.5`).toBe(0.5)
    }
    expect(blueprintWeight(goodOf('blueprint', 'sbp-sailfish')!, ctx)).toBe(0.05) // 永久（可学）蓝图
    expect(blueprintWeight(goodOf('blueprint', 'sbp-megalodon')!, ctx)).toBe(0.05)
    expect(blueprintWeight(goodOf('ship', 'sh-sailfish')!, ctx)).toBe(1) // 非蓝图行
    const tuned = { ...ctx, balance: { ...ctx.balance, market: { ...ctx.balance.market, singleUseBlueprintWeight: 0.25 } } }
    expect(blueprintWeight(goodOf('blueprint', 'sbp-once-sailfish')!, tuned)).toBe(0.25)
  })

  it('③ 渠道与数字稀有度：T3 十张 + 剑鱼/蝠鲼 = rare+3；玄武/巨齿鲨/皇带鱼 = exotic+4', () => {
    const rare = ONCE.filter((b) => goodOf('blueprint', b.id)?.rarity === 'rare').map((b) => b.id)
    const exotic = ONCE.filter((b) => goodOf('blueprint', b.id)?.rarity === 'exotic').map((b) => b.id)
    expect(rare.length).toBe(12)
    expect(exotic.length).toBe(5) // 2026-09-26：+sbp-once-orca / sbp-once-helicoprion
    for (const id of rare) expect(RARITY_TIER[id], `${id} 数字档`).toBe(3)
    for (const id of exotic) expect(RARITY_TIER[id], `${id} 数字档`).toBe(4)
    expect(rare).toContain('sbp-once-swordfish') // 船长：剑鱼下放稀有
    expect(rare).toContain('sbp-once-bowhead') // 船长：蝠鲼一次性保留稀有
    expect(exotic.sort()).toEqual(['sbp-once-colossal', 'sbp-once-helicoprion', 'sbp-once-megalodon', 'sbp-once-orca', 'sbp-once-xuanwu'])
    // 玳瑁/蝠鲼的**现货与永久蓝图**同步升奇货（船长两条裁定）+ 数字档随渠道到 4
    for (const ref of ['sh-hawksbill', 'sbp-hawksbill', 'sh-bowhead', 'sbp-bowhead']) {
      expect(goodOf(ref.startsWith('sh-') ? 'ship' : 'blueprint', ref)?.rarity, `${ref} 渠道`).toBe('exotic')
      expect(RARITY_TIER[ref], `${ref} 数字档`).toBe(4)
    }
    // 鹦鹉螺那张的闸门已随虫洞上线删除（✅ 2026-09-14「与虫洞同批」放开）
    expect(goodOf('blueprint', 'sbp-once-nautilus')?.unreleased).toBeUndefined()
  })

  it('④ 稀释池（船长：「放入虫洞的专属奖池内作为稀释」）：70:30 口径**已停用但留档** + 按层分档 + 与族池互斥', () => {
    // ⚠ 2026-09-14：船长新增「图纸货柜」并裁定「与安全货柜并列」⇒ 安全货柜改 **100% 族专属池**，
    //   原 70:30 的稀释池分支已收回 ⇒ 下面两条只是**留档断言**（常量保留、值不变，但无运行时读取方）。
    expect(wormholeLootShares()).toEqual({ family: 0.7, dilution: 0.3 })
    expect(WORMHOLE_DILUTION_SHARE).toBe(0.3)
    // 层分档：T3 层 2 起 / T4 层 3 起 / T5 层 5 起（船长「T4 降到 3 层，T5 降到 5 层」）
    expect(WORMHOLE_DILUTION_MIN_DEPTH).toEqual({ 3: 2, 4: 3, 5: 5 })
    const tierOf = (bpId: string) => ctx.ships.get(ctx.shipBlueprints.get(bpId)!.shipId)!.tier
    // 层 1：遗迹恒不出 ⇒ 池为空
    expect(wormholeDilutionPoolOf(ctx, 1)).toEqual([])
    // 层 2：只有 T3 十张
    const d2 = wormholeDilutionPoolOf(ctx, 2)
    expect(d2.length).toBe(10)
    expect(d2.every((id) => tierOf(id) === 3)).toBe(true)
    // 层 3：加 T4 四张
    const d3 = wormholeDilutionPoolOf(ctx, 3)
    expect(d3.length).toBe(16) // 2026-09-26：新两艘 T4（虎鲸/旋齿鲨）各带一张一次性图纸 ⇒ 14 → 16
    expect(d3).toContain('sbp-once-swordfish')
    expect(d3.filter((id) => tierOf(id) === 4).length).toBe(6)
    // 层 5：加 T5 一张（皇带鱼）
    const d5 = wormholeDilutionPoolOf(ctx, 5)
    expect(d5.length).toBe(17)
    expect(d5).toContain('sbp-once-colossal')
    // 池里只许一次性舰船蓝图
    for (const id of d5) {
      expect(id.startsWith('sbp-once-'), `${id} 前缀`).toBe(true)
      expect(ctx.shipBlueprints.get(id)?.singleUse, `${id} singleUse`).toBe(true)
    }
    // 与族专属池互斥（稀释池不该混进族专属件）
    const familyAll = WORMHOLE_FAMILIES.flatMap((f) => {
      const p = wormholeFamilyPoolOf(ctx, f)
      return [...p.modules, ...p.moduleBlueprints, ...p.shipBlueprints, ...p.drones]
    })
    expect(d5.filter((id) => familyAll.includes(id))).toEqual([])
  })
})
