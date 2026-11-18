import type { MarketGoodDef } from '@whale/core'
import type { PageProps } from '../../pages/common'
import { DOMAIN_ALL, DOMAIN_ITEM, DOMAIN_SHIP, MARKET_DOMAIN_TABS, rackDimKeyOf, marketDomainPasses } from '../../ui/itemSubs'
import { tr } from '../../i18n/locale'
import { kindTextOfItem, rackText } from '../../ui/labelsText'

export type KindFilter = typeof DOMAIN_ALL | typeof DOMAIN_ITEM | typeof DOMAIN_SHIP

export const KIND_OPTIONS: readonly KindFilter[] = [DOMAIN_ALL, ...MARKET_DOMAIN_TABS.map((t) => t.key as KindFilter)]

function itemDefOf(ctx: PageProps['engine']['ctx'], good: MarketGoodDef) {
  return good.kind === 'item' ? ctx.items.get(good.refId) : undefined
}

export function kindTextOf(ctx: PageProps['engine']['ctx'], good: MarketGoodDef): string {
  const it = itemDefOf(ctx, good)
  if (it) return it.kind === 'wreck' ? tr("ui.MarketPage.009") : kindTextOfItem(it)
  if (good.kind === 'module') {
    const mod = ctx.modules.get(good.refId)
    return mod ? rackText(rackDimKeyOf(mod)) : tr('ui.MarketPage.178')
  }
  if (good.kind === 'ship') return tr('ui.App.002')
  if (good.kind === 'blueprint') return tr('ui.MarketPage.004')
  if (good.kind === 'aicore') return tr('ui.MarketPage.008')
  return good.kind
}

export function domainPasses(ctx: PageProps['engine']['ctx'], good: MarketGoodDef, domain: KindFilter, sub: string): boolean {
  return marketDomainPasses(ctx, good, domain, sub)
}
