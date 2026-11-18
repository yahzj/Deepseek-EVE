import type { MarketGoodDef } from '@whale/core'
import { wreckItemIdOf, WRECK_GROUPS } from '@whale/core'

const WRECK_BUY_PRICE = { common: 30, risky: 40, dire: 50 } as const

export const WRECK_BUY_GOODS: readonly MarketGoodDef[] = WRECK_GROUPS.filter((g) => g.region !== 'wh').map((g) => {
  const id = wreckItemIdOf(g.key)
  return {
    key: id,
    kind: 'item',
    refId: id,
    rarity: 'common',
    basePrice: WRECK_BUY_PRICE[g.tier],
    poolTarget: 30_000,
    supplyFlow: 500,
    playerBuyable: false,
  }
})
