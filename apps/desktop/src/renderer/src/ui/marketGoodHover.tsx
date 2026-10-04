import type { ReactNode } from 'react'
import { aiCoreGoodNameId, goodName } from '@whale/core'
import type { BlueprintDef, ShipBlueprintDef, MarketGoodDef, SimContext } from '@whale/core'
import { InfoHover, ItemHover, ModuleHover, ShipHover, itemInfoLines, moduleInfoLines, shipInfoLines } from './shipInfo'
import type { InfoLine } from './shipInfo'
import { tr } from '../i18n/locale'
import { fmtDuration } from '../i18n/fmt'

export function marketGoodDisplayName(ctx: SimContext, key: string): string {
  const good = ctx.marketGoods.get(key)
  const id = good?.kind === 'aicore' ? aiCoreGoodNameId(good.refId) : undefined
  return id ? tr(id) : goodName(ctx, key)
}

/** 蓝图悬停沿用市场产物、材料与工期行；两个交易入口共用。 */
export function blueprintHoverLines(ctx: SimContext, bp: BlueprintDef | ShipBlueprintDef): { title: string; lines: InfoLine[]; note: string } {
  const def = bp as BlueprintDef
  const item = 'itemId' in bp ? ctx.items.get(def.itemId!) : undefined
  const mod = 'moduleId' in bp ? ctx.modules.get(def.moduleId!) : undefined
  const ship = 'shipId' in bp ? ctx.ships.get(bp.shipId) : undefined
  const productName = item?.name ?? mod?.name ?? ship?.name ?? def.itemId ?? def.moduleId ?? (bp as ShipBlueprintDef).shipId
  const prodLines = item ? itemInfoLines(item, (id) => ctx.items.get(id)?.name) : mod ? moduleInfoLines(mod) : ship ? shipInfoLines(ship) : []
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

export function MarketGoodHover({ ctx, good, children, as = 'div', className }: {
  ctx: SimContext; good: MarketGoodDef; children: ReactNode; as?: 'div' | 'li'; className?: string
}) {
  const props = { as, className }
  if (good.kind === 'item') {
    const item = ctx.items.get(good.refId)
    if (item) return <ItemHover {...props} item={item} nameOf={(id) => ctx.items.get(id)?.name}>{children}</ItemHover>
  }
  if (good.kind === 'module') {
    const mod = ctx.modules.get(good.refId)
    if (mod) return <ModuleHover {...props} mod={mod}>{children}</ModuleHover>
  }
  if (good.kind === 'ship') {
    const ship = ctx.ships.get(good.refId)
    if (ship) return <ShipHover {...props} ship={ship} note={ship.description}>{children}</ShipHover>
  }
  if (good.kind === 'blueprint') {
    const bp = ctx.blueprints.get(good.refId) ?? ctx.shipBlueprints.get(good.refId)
    if (bp) return <InfoHover {...props} {...blueprintHoverLines(ctx, bp)}>{children}</InfoHover>
  }
  const tier = good.refId === 'basic' ? tr('ui.MarketPage.020') : good.refId === 'gamma' ? tr('ui.MarketPage.013') : good.refId === 'beta' ? tr('ui.MarketPage.014') : tr('ui.MarketPage.015')
  const eff = Math.round((ctx.balance.aiCore.efficiency[good.refId as never] ?? 1) * 100)
  return <InfoHover {...props} title={marketGoodDisplayName(ctx, good.key)} lines={good.kind === 'aicore' ? [
    { k: tr('ui.MarketPage.002'), v: tier },
    { k: tr('ui.MarketPage.021'), v: tr('ui.MarketPage.138', { eff }) },
  ] : []} note={tr(good.kind === 'aicore' ? 'ui.MarketPage.022' : 'ui.MarketPage.171')}>{children}</InfoHover>
}
