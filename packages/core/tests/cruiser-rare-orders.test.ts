/**
 * **官方五艘巡洋舰进稀有订单**（**2026-09-16 船长裁定「甲」＋「乙」** · 一号 · main）。
 *
 * 船长原话（照抄）：「**将目前官方的几艘巡洋舰舰船和一次性蓝图在稀有度不变的前提下，放到稀有订单里，
 * 所需声望降低为8。其他不变。**」⇒ 摆出现状与 §5.2 冲突（旧口径「T3 巡洋入奇货」2026-09-09 ·
 * 「T3 门槛统一 12」2026-09-13 · 契约「rare 只能 2/3」）＋ 甲/乙/丙三案后，船长两答：
 * **范围 = 甲**（名字带「巡洋舰」的 5 艘：长尾鲨 / 电鳐 / 锤头鲨 / 牛鲨 / 鹦鹉螺）·
 * **数字档 = 乙**（**保持 4 不动**，只把渠道挪进稀有订单）。
 *
 * 本件钉四件事：
 * ① **5 艘现货**：渠道 `exotic → rare`、`standingReq 12 → 8`、**数字档保持 4**（乙）；
 * ② **5 张一次性图纸**：渠道本就 `rare`、`standingReq 15 → 8`、数字档 3 不动；
 * ③ **"其他不变"逐值对照**：基价 / `demandMultiplier` 一字未动；同批**没被点名**的
 *    T3 一次性图纸（座头鲸/王鲭/玳瑁/旗鱼/鲸王）仍 15；**非一次性**图纸（`sbp-nautilus` 等）仍奇货 15；
 *    T4/T5 舰体与图纸、鲸王/王鲭/玳瑁/大白鲨现货一律未动；
 * ④ **奇货段不再有这 5 艘**（它们只在稀有订单里挂一次，不会两处并存）。
 *
 * ✅ 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { MARKET_GOODS, RARITY_TIER, buildSimContext } from '@whale/data'

const ctx = buildSimContext()

/** 甲案点名的 5 艘（名字带「巡洋舰」的官方舰）与其一次性图纸 */
const CRUISERS = ['sh-thresher', 'sh-electricray', 'sh-hammerhead', 'sh-bullshark', 'sh-nautilus'] as const
const ONCE_BPS = [
  'sbp-once-thresher',
  'sbp-once-electricray',
  'sbp-once-hammerhead',
  'sbp-once-bullshark',
  'sbp-once-nautilus',
] as const
/** 每艘的（基价、收购倍率）——"其他不变"的逐值锚 */
const PRICE_ANCHOR: Readonly<Record<string, [number, number]>> = {
  'sh-thresher': [9_000_000, 1.0],
  'sh-electricray': [15_000_000, 1.0],
  'sh-hammerhead': [11_000_000, 1.0],
  'sh-bullshark': [13_000_000, 1.0],
  'sh-nautilus': [9_000_000, 1.0],
}

const goodOf = (refId: string) => MARKET_GOODS.find((g) => g.refId === refId)

describe('官方五艘巡洋舰进稀有订单（2026-09-16 船长「甲＋乙」）', () => {
  it('① 5 艘现货：稀有订单 ＋ 声望 8 ＋ **数字档保持 4**（乙）', () => {
    for (const id of CRUISERS) {
      const g = goodOf(id)
      expect(g, `市场卡里应有 ${id}`).toBeTruthy()
      expect(g!.kind).toBe('ship')
      expect(g!.rarity, `${id} 应在稀有订单`).toBe('rare')
      expect(g!.standingReq, `${id} 声望应为 8`).toBe(8)
      expect(RARITY_TIER[id], `${id} 数字档按「乙」保持 4`).toBe(4)
      const [price, mul] = PRICE_ANCHOR[id]!
      expect(g!.basePrice, `${id} 基价不该变`).toBe(price)
      expect(g!.demandMultiplier, `${id} 收购倍率不该变`).toBe(mul)
    }
  })

  it('② 5 张一次性图纸：稀有订单 ＋ 声望 15 → 8（数字档 3 不动）', () => {
    for (const id of ONCE_BPS) {
      const g = goodOf(id)
      expect(g, `市场卡里应有 ${id}`).toBeTruthy()
      expect(g!.kind).toBe('blueprint')
      expect(g!.rarity, `${id} 应在稀有订单`).toBe('rare')
      expect(g!.standingReq, `${id} 声望应为 8`).toBe(8)
      expect(RARITY_TIER[id], `${id} 数字档仍 3`).toBe(3)
    }
  })

  it('③ "其他不变"：没被点名的同批行一律没动', () => {
    // 同批 T3 一次性图纸（座头鲸/王鲭/玳瑁/旗鱼/鲸王）仍 15
    for (const id of ['sbp-once-humpback', 'sbp-once-sentinel', 'sbp-once-hawksbill', 'sbp-once-sailfish', 'sbp-once-whale-king']) {
      expect(goodOf(id)?.standingReq, `${id} 不该被这次改动碰到`).toBe(15)
    }
    // 非一次性 T3 图纸仍奇货 15（"一次性蓝图"才是这次的点名对象）
    for (const id of ['sbp-nautilus', 'sbp-thresher', 'sbp-electricray', 'sbp-hammerhead', 'sbp-bullshark']) {
      expect(goodOf(id)?.rarity, `${id} 应仍留奇货`).toBe('exotic')
      expect(goodOf(id)?.standingReq, `${id} 声望应仍 15`).toBe(15)
    }
    // T3 里没被点名的现货（座头鲸矿舰/旗鱼货舰/鲸王采矿艇/王鲭母舰/玳瑁重装巡舰）渠道与声望不动
    expect(goodOf('sh-humpback')?.rarity).toBe('rare')
    expect(goodOf('sh-humpback')?.standingReq).toBe(12)
    expect(goodOf('sh-sailfish')?.rarity).toBe('rare')
    expect(goodOf('sh-sailfish')?.standingReq).toBe(12)
    for (const id of ['whale-king', 'sh-sentinel', 'sh-hawksbill']) {
      expect(goodOf(id)?.rarity, `${id} 应仍奇货`).toBe('exotic')
      expect(goodOf(id)?.standingReq, `${id} 声望应仍 12`).toBe(12)
    }
    // T4/T5 舰体与图纸未动
    expect(goodOf('sh-xuanwu')?.standingReq).toBe(20)
    expect(goodOf('sh-colossal')?.standingReq).toBe(35)
    expect(goodOf('sbp-xuanwu')?.standingReq).toBe(25)
    expect(goodOf('sbp-once-colossal')?.standingReq).toBe(40)
  })

  it('④ 奇货段不再挂这 5 艘（不会两处并存）；玩家可见目录里仍在', () => {
    const exoticShips = MARKET_GOODS.filter((g) => g.kind === 'ship' && g.rarity === 'exotic').map((g) => g.refId)
    for (const id of CRUISERS) {
      expect(exoticShips, `${id} 不该还在奇货里`).not.toContain(id)
      expect(ctx.marketGoods.has(`ship-${id.replace(/^sh-/, '')}`) || ctx.marketGoods.has(id), `${id} 仍应在玩家可见目录`).toBe(true)
    }
    // 稀有渠道抽取的可见性前提：`playerBuyable !== false`（这 5 行本就可买 ⇒ 会进稀有供给抽取）
    for (const id of CRUISERS) expect(goodOf(id)?.playerBuyable).not.toBe(false)
  })
})
