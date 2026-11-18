import { ceilFinalQuantity, marketQuote, wreckGroupOfItemId } from '@whale/core'
import type { SimContext } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'

export type ToastFn = (text: string, warn?: boolean) => void

export type SettingsPageId = 'interface' | 'sound' | 'game' | 'account' | 'developer'

export interface PageProps {
  engine: GameEngine
  onToast: ToastFn
  onOpenSettings?: (page?: SettingsPageId) => void
}

export function isk(n: number): string {
  return ceilFinalQuantity(n).toLocaleString('zh-CN')
}

export const MONEY_GLYPH = '◆'

export function m3(n: number): string {
  return `${Math.floor(n).toLocaleString('zh-CN')} m³`
}



export function itemBuyQuote(engine: GameEngine, itemId: string): number | undefined {
  for (const good of engine.ctx.marketGoods.values()) {
    if (good.kind === 'item' && good.refId === itemId) {
      return marketQuote(engine.state, engine.ctx, good.key).buy
    }
  }
  return undefined
}

export function rareWreckRefsOf(
  engine: GameEngine,
  galaxyId: string,
): { count: number; text: string; refs: Array<[string, number]> } {
  const by = engine.state.galaxyWrecks[galaxyId]?.rareBy ?? {}
  const refs = Object.entries(by).filter(([, n]) => n > 0)
  const count = refs.reduce((s, [, n]) => s + n, 0)
  const text = refs.map(([aid, n]) => `${engine.ctx.anomalies.get(aid)?.name ?? aid} ×${n}`).join(tr("ui.MatterTechTab.017"))
  return { count, text, refs }
}

export function wreckSourceGalaxyIdsOf(ctx: SimContext, wreckItemId: string): string[] {
  const group = wreckGroupOfItemId(wreckItemId)
  if (!group) return []
  const ids: string[] = []
  for (const cardId of group.members) {
    const gid = ctx.anomalies.get(cardId)?.galaxyId
    if (gid !== undefined && !ids.includes(gid)) ids.push(gid)
  }
  return ids
}
