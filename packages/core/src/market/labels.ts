import { bumpFirst } from '../firstTasks'
import type { GameState } from '../state'
import type { AiCoreType, SimContext } from '../types'
import { aiCoreName } from '../aiCores'

export type TradeNote = '' | 'bonus' | 'tax' | 'bonusTax'

export function tradeNoteText(note: TradeNote, tax: number): string {
  const taxTxt = `（贸易税 ${tax.toLocaleString('zh-CN')} 信用点）`
  if (note === 'bonus') return '（含协会声望加成）'
  if (note === 'tax') return taxTxt
  if (note === 'bonusTax') return `（含协会声望加成）${taxTxt}`
  return ''
}

export function tradeNoteId(note: TradeNote): string | undefined {
  switch (note) {
    case 'bonus':
      return 'core.market.033'
    case 'tax':
      return 'core.market.034'
    case 'bonusTax':
      return 'core.market.035'
    default:
      return undefined
  }
}

export function goodName(ctx: SimContext, goodKey: string): string {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return goodKey
  switch (def.kind) {
    case 'item':
      return ctx.items.get(def.refId)?.name ?? goodKey
    case 'module':
      return ctx.modules.get(def.refId)?.name ?? goodKey
    case 'ship':
      return ctx.ships.get(def.refId)?.name ?? goodKey
    case 'blueprint':
      return ctx.blueprints.get(def.refId)?.name ?? ctx.shipBlueprints.get(def.refId)?.name ?? goodKey
    case 'aicore':
      return aiCoreName(def.refId as AiCoreType)
  }
}

export function aiCoreGoodNameId(refId: string): string | undefined {
  switch (refId) {
    case 'basic':
      return 'ui.labelsText.009'
    case 'gamma':
      return 'ui.labelsText.010'
    case 'beta':
      return 'ui.labelsText.011'
    case 'alpha':
      return 'ui.labelsText.012'
    default:
      return undefined
  }
}


export function bumpFirstMarketTrade(state: GameState): void {
  bumpFirst(state, 'orders')
}

export function placeOrderLogText(
  ctx: SimContext,
  side: 'buy' | 'sell',
  goodKey: string,
  price: number,
  want: number,
  r: { filled: number; resting: number },
): string {
  const name = goodName(ctx, goodKey)
  const p = price.toLocaleString('zh-CN')
  if (r.filled <= 0) return `已挂${side === 'buy' ? '买' : '卖'}单：${name}×${want.toLocaleString('zh-CN')} @ ${p} 信用点。`
  if (r.resting <= 0) return `${side === 'buy' ? '买' : '卖'}单已即时成交：${name}×${r.filled.toLocaleString('zh-CN')} @ ${p} 信用点（无需再等撮合）。`
  return `${side === 'buy' ? '买' : '卖'}单已即时成交 ${r.filled.toLocaleString('zh-CN')} 件，余 ${r.resting.toLocaleString('zh-CN')} 件挂单 @ ${p} 信用点。`
}
