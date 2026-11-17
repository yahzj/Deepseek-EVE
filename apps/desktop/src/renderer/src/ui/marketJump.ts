import { marketGoodOf, marketTradingGoods } from '@whale/core'
import type { MarketGoodKind, SimContext } from '@whale/core'

export function handMarketKeyOf(ctx: SimContext, tab: string, key: string): string | null {
  const kind: MarketGoodKind | null =
    tab === 'items'
      ? 'item'
      : tab === 'modules'
        ? 'module'
        : tab === 'ships'
          ? 'ship'
          : tab === 'blueprints'
            ? 'blueprint'
            : null
  if (kind === null) return null
  const good = marketGoodOf(ctx, kind, key)
  return good && marketTradingGoods(ctx).some(row => row.key === good.key) ? good.key : null
}
