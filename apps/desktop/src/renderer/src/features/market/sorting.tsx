import { marketQuote } from '@whale/core'
import type { MarketGoodDef } from '@whale/core'
import type { PageProps } from '../../pages/common'
import { pinMarked } from '../../ui/marks'

export function stockedFirst(engine: PageProps['engine'], goods: MarketGoodDef[]): MarketGoodDef[] {
  const hasStock = new Map(goods.map((g) => [g.key, marketQuote(engine.state, engine.ctx, g.key).sell !== undefined]))
  const rows = [...goods].sort((a, b) => Number(hasStock.get(b.key)) - Number(hasStock.get(a.key)))
  return pinMarked(engine.state, 'goods', rows, (g) => g.key)
}

export function rareOrderRows(engine: PageProps['engine'], goods: MarketGoodDef[]): MarketGoodDef[] {
  const hasStock = new Map(goods.map((g) => [g.key, marketQuote(engine.state, engine.ctx, g.key).sell !== undefined]))
  const tier = (g: MarketGoodDef): number => {
    const stocked = hasStock.get(g.key) === true
    if (stocked && g.rarity === 'exotic') return 0
    if (stocked) return 1
    return g.rarity === 'exotic' ? 2 : 3
  }
  const rows = [...goods].sort((a, b) => tier(a) - tier(b))
  return pinMarked(engine.state, 'goods', rows, (g) => g.key)
}
