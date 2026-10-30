import { marketQuote } from '@whale/core'
import type { MarketGoodDef } from '@whale/core'
import type { PageProps } from '../../pages/common'
import { pinMarked } from '../../ui/marks'

/** 有货冒泡上浮（供应簿有现货的排前面）；其余保持目录稳定顺序。
 *  2026-09-10 船长定：默认排序下已标记（收藏）的商品置顶——两栏与搜索结果都是这一套默认口径。 */
export function stockedFirst(engine: PageProps['engine'], goods: MarketGoodDef[]): MarketGoodDef[] {
  const hasStock = new Map(goods.map((g) => [g.key, marketQuote(engine.state, engine.ctx, g.key).sell !== undefined]))
  const rows = [...goods].sort((a, b) => Number(hasStock.get(b.key)) - Number(hasStock.get(a.key)))
  return pinMarked(engine.state, 'goods', rows, (g) => g.key)
}

/** 稀有档列排序（稀有订单与限定奇货两个标签共用；2026-09-08 船长定：优先置顶"有货的限定奇货"）：
 * ① 有货奇货 → ② 其余有货 → ③ 无货奇货 → ④ 其余无货；组内保持目录稳定顺序；
 * 2026-09-10 起：已标记商品再置顶一层（本列无用户可选排序，仍属默认口径） */
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
