import type { ReactNode } from 'react'
import { blueprintProducingItem, UNIVERSAL_BLACKBOX_ITEM_ID, visibleItemDefs } from '@whale/core'
import { tr } from '../i18n/locale'
import type { GameEngine } from '../game/engine'

export function refineSourcesOf(engine: GameEngine, mineralId: string): string[] {
  const out: string[] = []
  for (const def of visibleItemDefs(engine.ctx)) {
    if (def.kind === 'wreck') continue
    if ((def.refine ?? []).some((r) => r.mineralId === mineralId)) out.push(def.id)
  }
  return out
}

export function MatSourceLink({
  engine,
  itemId,
  matName,
  groupIds,
  onNeedMineral,
  onGotoPlugExchange,
}: {
  engine: GameEngine
  itemId: string
  matName: string
  groupIds: readonly string[]
  onNeedMineral?: (itemId: string) => void
  onGotoPlugExchange?: () => void
}): ReactNode {
  if (onNeedMineral === undefined) return null
  const fromShop = groupIds.includes(UNIVERSAL_BLACKBOX_ITEM_ID)
  const srcs = refineSourcesOf(engine, itemId)
  const srcName = (id: string): string => engine.ctx.items.get(id)?.name ?? id
  const madeBy = fromShop ? undefined : blueprintProducingItem(engine.ctx, itemId)
  const title = fromShop
    ? tr('ui.Industry.158', { matName })
    : srcs.length > 0
      ? tr('ui.Industry.109', { matName, p2: srcs.map(srcName).join(tr('ui.MatterTechTab.017')) })
      : madeBy
        ? tr('ui.Industry.155', { matName, p2: madeBy.name })
        : tr('ui.Industry.110', { matName })
  return (
    <span
      className="app-bp-mat-act"
      role="button"
      tabIndex={0}
      title={title}
      onClick={() => (fromShop ? onGotoPlugExchange?.() : onNeedMineral(itemId))}
    >
      {fromShop
        ? tr('ui.Industry.159')
        : srcs.length > 0
          ? tr('ui.Industry.047')
          : madeBy
            ? tr('ui.Industry.154')
            : tr('ui.Industry.048')}
    </span>
  )
}
