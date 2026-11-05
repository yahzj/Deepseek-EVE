import staticDocument from '../static/market.json'
import type { DataDocument } from '../../../../tools/data-editor-contract'
import { staticDataGroup } from '../staticData'
import type { MarketGoodDef } from '@whale/core'
import { rarityTierOf } from '../rarityTier'
import { BLACK_MARKET_EXCLUSIVE_REFS } from '../blackMarketGoods'
import { MARKET_GOODS_RAW_0_TEXT_BINDINGS, MARKET_GOODS_0_TEXT_BINDINGS } from './bindings'
import { BM_MK3_KEYS } from './channels'
import { WRECK_BUY_GOODS } from './wreckGoods'
import { PLAYER_ONLY_GOODS } from './playerGoods'

export const MARKET_GOODS_RAW: readonly MarketGoodDef[] = [
  ...staticDataGroup<MarketGoodDef>(staticDocument as unknown as DataDocument, 'MARKET_GOODS_RAW_0', MARKET_GOODS_RAW_0_TEXT_BINDINGS),
]

const NPC_MARKET_GOODS: readonly MarketGoodDef[] = [
  ...MARKET_GOODS_RAW.map((g) => (BM_MK3_KEYS.has(g.key) ? { ...g, bmStanding: 11 } : g)),
  ...WRECK_BUY_GOODS,
  ...staticDataGroup<MarketGoodDef>(staticDocument as unknown as DataDocument, 'MARKET_GOODS_0', MARKET_GOODS_0_TEXT_BINDINGS),
]

// 已有条目仍读静态权威参数；只补齐原先没有市场定义的独占产物。
const npcKeys = new Set(NPC_MARKET_GOODS.map(good => good.key))
export const MARKET_GOODS: readonly MarketGoodDef[] = [
  ...NPC_MARKET_GOODS,
  ...PLAYER_ONLY_GOODS.filter(good => !npcKeys.has(good.key)),
]

/** 构建市场商品目录（数字稀有度按物品表 RARITY_TIER 填充——2026-09-09 船长拍板：
 * 稀有度入物品本体，市场调用；与渠道 rarity 分离，只驱动稀有订单渠道刷新权重）
 *
 * ⚠ **未上线商品在这里被挡掉**（2026-09-12 船长：「所有虫洞相关的内容需要等虫洞落地后才统一对玩家可见」）：
 * `unreleased: true` 的卡**不进本目录** ⇒ `ctx.marketGoods` 里没有它 ⇒ 市场页/挂单/订单/任务/事件
 * 一律看不到也交易不到；而它在 `MARKET_GOODS`（目录表）里，**契约照核**（`content:check` 用该表）。
 * 上线时把卡上的 `unreleased` 删掉即可。 */
export function buildMarketGoodsCatalog(): ReadonlyMap<string, MarketGoodDef> {
  return new Map(MARKET_GOODS.filter((g) => g.unreleased !== true).map((g) => [g.key, {
    ...g, rarityTier: rarityTierOf(g.refId),
    ...(g.playerBuyable === false && g.blackMarketBuyable !== false && BLACK_MARKET_EXCLUSIVE_REFS.has(g.refId) ? { blackMarketBuyable: true } : {}),
  }]))
}
