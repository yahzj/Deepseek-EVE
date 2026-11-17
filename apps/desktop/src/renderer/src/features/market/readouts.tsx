import { naturalHoldings, salesTaxRate, shipStoredCount } from '@whale/core'
import type { GameState, MarketGoodDef } from '@whale/core'
import type { PageProps } from '../../pages/common'
import { isk } from '../../pages/common'
import { tr } from '../../i18n/locale'

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function nextSupplyIn(engine: PageProps['engine']): number {
  const bal = engine.ctx.balance.market
  const since = engine.state.gameMs - engine.state.market.lastTickGameMs
  const rem = bal.tickMs - (since % bal.tickMs)
  return rem >= 0 ? rem : bal.tickMs
}

export function earliestSellRemaining(engine: PageProps['engine'], goodKey: string): number | undefined {
  const orders = engine.state.market.npcSell[goodKey]
  if (!orders || orders.length === 0) return undefined
  let earliest: number | undefined
  for (const o of orders) {
    if (earliest === undefined || o.expiresAtGameMs < earliest) earliest = o.expiresAtGameMs
  }
  if (earliest === undefined) return undefined
  return Math.max(0, earliest - engine.state.gameMs)
}

export function myStockOf(state: GameState, good: MarketGoodDef): number {
  if (good.kind === 'ship') {
    let n = shipStoredCount(state, good.refId)
    for (const [uid, e] of Object.entries(state.fleet)) {
      if ((e.defId ?? uid) === good.refId) n += 1
    }
    return n
  }
  return naturalHoldings(state, good)
}

export function fleetCountOf(state: GameState, defId: string): number {
  return Object.entries(state.fleet).filter(([uid, e]) => (e.defId ?? uid) === defId).length
}


export function placeOrderToast(
  side: '买' | '卖',
  name: string,
  want: number,
  price: number,
  filled: number,
  resting: number,
  unit = '件',
): string {
  const n = (v: number): string => v.toLocaleString('zh-CN')
  const sideText = side === '买' ? tr('ui.MarketPage.159') : tr('ui.MarketPage.160')
  if (filled <= 0) return tr("ui.MarketPage.139", { side: sideText, name: name, p3: n(want), p4: isk(price) })
  if (resting <= 0) return tr("ui.MarketPage.140", { side: sideText, name: name, p3: n(filled), p4: isk(price) })
  return tr("ui.MarketPage.141", { side: sideText, p2: n(filled), unit: unit, p4: n(resting), unit2: unit, p6: isk(price) })
}

export function taxTipText(state: GameState, ctx: PageProps['engine']['ctx']): string {
  const rate = salesTaxRate(state, ctx)
  const lvA = state.skills.trained[ctx.balance.market.taxSkillAId] ?? 0
  const lvB = state.skills.trained[ctx.balance.market.taxSkillBId] ?? 0
  const skillNote =
    lvA + lvB > 0
      ? tr("ui.MarketPage.142", { lvA: lvA, p2: lvA * 8, lvB: lvB, p4: lvB * 8 })
      : tr("ui.MarketPage.033")
  return tr("ui.MarketPage.143", { p1: Math.round(rate * 1000) / 10, skillNote: skillNote })
}
