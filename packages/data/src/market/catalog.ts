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

const npcKeys = new Set(NPC_MARKET_GOODS.map(good => good.key))
export const MARKET_GOODS: readonly MarketGoodDef[] = [
  ...NPC_MARKET_GOODS,
  ...PLAYER_ONLY_GOODS.filter(good => !npcKeys.has(good.key)),
]

export function buildMarketGoodsCatalog(): ReadonlyMap<string, MarketGoodDef> {
  return new Map(MARKET_GOODS.filter((g) => g.unreleased !== true).map((g) => [g.key, {
    ...g, rarityTier: rarityTierOf(g.refId),
    ...(g.playerBuyable === false && g.blackMarketBuyable !== false && BLACK_MARKET_EXCLUSIVE_REFS.has(g.refId) ? { blackMarketBuyable: true } : {}),
  }]))
}
