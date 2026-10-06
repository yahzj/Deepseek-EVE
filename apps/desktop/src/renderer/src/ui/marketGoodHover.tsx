import type { ReactNode } from 'react'
import { aiCoreGoodNameId, goodName, shipCategoryKeyOf } from '@whale/core'
import type { BlueprintDef, ShipBlueprintDef, MarketGoodDef, SimContext } from '@whale/core'
import { InfoHover, ShipHover, itemInfoLines, moduleInfoLines, shipInfoLines } from './shipInfo'
import type { InfoLine } from './shipInfo'
import { tr } from '../i18n/locale'
import { fmtDuration } from '../i18n/fmt'
import { itemGlyphName, inventoryItemTone, toneOf } from './Glyphs'
import { crestFamOf, kindTextOfItem, rackText, shipRoleText } from './labelsText'
import { rackDimKeyOf } from './itemSubs'

export function marketGoodDisplayName(ctx: SimContext, key: string): string {
  const good = ctx.marketGoods.get(key)
  const id = good?.kind === 'aicore' ? aiCoreGoodNameId(good.refId) : undefined
  return id ? tr(id) : goodName(ctx, key)
}

/** 蓝图悬停沿用市场产物、材料与工期行；两个交易入口共用。 */
export function blueprintHoverLines(ctx: SimContext, bp: BlueprintDef | ShipBlueprintDef, hidePrices = false): { title: string; lines: InfoLine[]; note: string } {
  const def = bp as BlueprintDef
  const item = 'itemId' in bp ? ctx.items.get(def.itemId!) : undefined
  const mod = 'moduleId' in bp ? ctx.modules.get(def.moduleId!) : undefined
  const ship = 'shipId' in bp ? ctx.ships.get(bp.shipId) : undefined
  const productName = item?.name ?? mod?.name ?? ship?.name ?? def.itemId ?? def.moduleId ?? (bp as ShipBlueprintDef).shipId
  const prodLines = item ? itemInfoLines(item, (id) => ctx.items.get(id)?.name, !hidePrices) : mod ? moduleInfoLines(mod) : ship ? shipInfoLines(ship) : []
  const materials = bp.materials.map((m) => `${ctx.items.get(m.itemId)?.name ?? m.itemId} ×${m.count}`).join('　')
  return {
    title: bp.name,
    lines: [
      { k: tr('ui.MarketPage.016'), v: productName },
      ...prodLines,
      ...(bp.description ? [{ k: tr('ui.MarketPage.017'), v: bp.description }] : []),
      { k: tr('ui.MarketPage.018'), v: materials },
      { k: tr('ui.MarketPage.019'), v: tr('ui.MarketPage.137', { p1: fmtDuration(bp.buildSeconds * 1000) }) },
    ],
    note: item?.description || mod?.description || ship?.description || bp.description,
  }
}

/** 卡面、悬停与主动详情共用仓库参数；参考价格只在黑市场景关闭。 */
export function marketGoodInfo(ctx: SimContext, good: MarketGoodDef, hidePrices = false): {
  title: string; lines: InfoLine[]; note: string; glyph: string; category: string; tone: string; crest?: string
} {
  const title = marketGoodDisplayName(ctx, good.key)
  if (good.kind === 'item') {
    const item = ctx.items.get(good.refId)
    if (item) return { title, lines: itemInfoLines(item, (id) => ctx.items.get(id)?.name, !hidePrices), note: item.description,
      glyph: itemGlyphName(item.id, item.kind), category: kindTextOfItem(item), tone: inventoryItemTone(item.id, item.kind), crest: crestFamOf(item.id) }
  }
  if (good.kind === 'module') {
    const mod = ctx.modules.get(good.refId)
    if (mod) return { title, lines: moduleInfoLines(mod), note: mod.description, glyph: mod.slot,
      category: rackText(rackDimKeyOf(mod)), tone: toneOf(mod.slot), crest: crestFamOf(mod.id) }
  }
  if (good.kind === 'ship') {
    const ship = ctx.ships.get(good.refId)
    if (ship) { const category = shipCategoryKeyOf(ship)
      return { title, lines: shipInfoLines(ship), note: ship.description, glyph: category,
        category: shipRoleText(category), tone: toneOf(category), crest: crestFamOf(ship.id) } }
  }
  if (good.kind === 'blueprint') {
    const bp = ctx.blueprints.get(good.refId) ?? ctx.shipBlueprints.get(good.refId)
    if (bp) return { ...blueprintHoverLines(ctx, bp, hidePrices), glyph: 'blueprint', category: tr('ui.MarketPage.004'),
      tone: toneOf('blueprint'), crest: crestFamOf('shipId' in bp ? bp.shipId : bp.moduleId ?? bp.itemId) }
  }
  const tier = good.refId === 'basic' ? tr('ui.MarketPage.020') : good.refId === 'gamma' ? tr('ui.MarketPage.013') : good.refId === 'beta' ? tr('ui.MarketPage.014') : tr('ui.MarketPage.015')
  const eff = Math.round((ctx.balance.aiCore.efficiency[good.refId as never] ?? 1) * 100)
  return { title, lines: good.kind === 'aicore' ? [
    { k: tr('ui.MarketPage.002'), v: tier },
    { k: tr('ui.MarketPage.021'), v: tr('ui.MarketPage.138', { eff }) },
  ] : [], note: tr(good.kind === 'aicore' ? 'ui.MarketPage.022' : 'ui.MarketPage.171'), glyph: 'ai-core',
    category: tr('ui.MarketPage.008'), tone: toneOf('ai-core') }
}

export function MarketGoodHover({ ctx, good, children, as = 'div', className, hidePrices = false }: {
  ctx: SimContext; good: MarketGoodDef; children: ReactNode; as?: 'div' | 'li'; className?: string; hidePrices?: boolean
}) {
  // 普通市场保留舰船血条悬停，黑市的主动详情与悬停统一为同一份参数表。
  const ship = good.kind === 'ship' && !hidePrices ? ctx.ships.get(good.refId) : undefined
  if (ship) return <ShipHover as={as} className={className} ship={ship} note={ship.description}>{children}</ShipHover>
  return <InfoHover as={as} className={className} {...marketGoodInfo(ctx, good, hidePrices)}>{children}</InfoHover>
}
