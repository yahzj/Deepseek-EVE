import { ceilFinalQuantity } from '../quantity'
import { addLog, shipLockedReason } from '../state'
import type { CommandResult } from '../engine'
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { countItem, countWare, removeItem, removeWare } from '../inventory'
import { shipOperationBlockReason } from '../shipActionPolicy'
import { DSI_FACTION_ID, standingOf } from '../expedition'
import { buyAtMarket, goodLockedReason, marketGoodOf, marketQuote, placeBuyOrder, sellAtMarket } from '../market'

export function sellPriceMultiplier(state: GameState): number {
  return 1 + Math.min(0.15, standingOf(state, DSI_FACTION_ID) * 0.01)
}

export interface SellResult {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  soldUnits: number
  gainedIsk: number
}

export function sellCargoItem(state: GameState, itemId: string, ctx: SimContext): SellResult {
  const blocked = shipOperationBlockReason(state, ctx, state.shipId, 'cargo')
  if (blocked) return { ok: false, ...blocked, soldUnits: 0, gainedIsk: 0 }
  return sellItemFrom(state, itemId, countItem(state, itemId), (units) => removeItem(state, itemId, units), ctx, '货仓', 'ui.CargoPage.004')
}

export function sellWareItem(state: GameState, itemId: string, ctx: SimContext): SellResult {
  return sellItemFrom(state, itemId, countWare(state, itemId), (units) => removeWare(state, itemId, units), ctx, '仓库', 'ui.ItemsPage.001')
}

export function discardWareQty(
  state: GameState,
  itemId: string,
  qty: number,
  ctx: SimContext,
): { ok: boolean; dropped: number; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>> } {
  const have = countWare(state, itemId)
  if (have <= 0) return { ok: false, dropped: 0, error: '仓库里没有这件物品。', errorId: 'core.industry.026' }
  const want = Math.min(have, Math.max(0, Math.floor(qty)))
  if (want <= 0) return { ok: false, dropped: 0, error: '丢弃数量需大于 0。', errorId: 'core.industry.027' }
  if (!removeWare(state, itemId, want)) return { ok: false, dropped: 0, error: '丢弃失败（物品不足）。', errorId: 'core.industry.028' }
  const name = ctx.items.get(itemId)?.name ?? itemId
  addLog(state, 'industry', `⚑ 丢弃 ${name} ×${want.toLocaleString('zh-CN')}（仓库）。`, 'core.industry.038', { p1: name, p2: want.toLocaleString('zh-CN') })
  return { ok: true, dropped: want }
}

export function sellCargoItemQty(state: GameState, itemId: string, qty: number, ctx: SimContext): SellResult {
  const blocked = shipOperationBlockReason(state, ctx, state.shipId, 'cargo')
  if (blocked) return { ok: false, ...blocked, soldUnits: 0, gainedIsk: 0 }
  const lock = shipLockedReason(state, state.shipId, '卖它货仓里的东西')
  if (lock) return { ok: false, error: lock, soldUnits: 0, gainedIsk: 0 }
  const have = countItem(state, itemId)
  const want = Math.max(0, Math.floor(qty))
  if (want <= 0) return { ok: false, error: '出售数量需大于 0。', errorId: 'core.state.022', soldUnits: 0, gainedIsk: 0 }
  if (want > have) {
    const def = ctx.items.get(itemId)
    return {
      ok: false,
      error: `货仓里只有 ${have} 单位${def ? ` ${def.name}` : ''}，无法卖 ${want} 单位。`,
      errorId: 'core.industry.014',
      errorParams: { p1: have, p2: def ? ` ${def.name}` : '', p3: want },
      soldUnits: 0,
      gainedIsk: 0,
    }
  }
  return sellItemFrom(state, itemId, want, (units) => removeItem(state, itemId, units), ctx, '货仓', 'ui.CargoPage.004')
}

export function sellWareItemQty(state: GameState, itemId: string, qty: number, ctx: SimContext): SellResult {
  const have = countWare(state, itemId)
  const want = Math.max(0, Math.floor(qty))
  if (want <= 0) return { ok: false, error: '出售数量需大于 0。', errorId: 'core.state.022', soldUnits: 0, gainedIsk: 0 }
  if (want > have) {
    const def = ctx.items.get(itemId)
    return {
      ok: false,
      error: `仓库里只有 ${have} 单位${def ? ` ${def.name}` : ''}，无法卖 ${want} 单位。`,
      errorId: 'core.industry.015',
      errorParams: { p1: have, p2: def ? ` ${def.name}` : '', p3: want },
      soldUnits: 0,
      gainedIsk: 0,
    }
  }
  return sellItemFrom(state, itemId, want, (units) => removeWare(state, itemId, units), ctx, '仓库', 'ui.ItemsPage.001')
}

function sellItemFrom(
  state: GameState,
  itemId: string,
  available: number,
  remove: (units: number) => boolean,
  ctx: SimContext,
  sourceName: string,
  sourceId: string,
): SellResult {
  const def = ctx.items.get(itemId)
  if (!def) return { ok: false, error: `未知物品：${itemId}`, errorId: 'core.industry.002', errorParams: { p1: itemId }, soldUnits: 0, gainedIsk: 0 }
  if (available <= 0) {
    return { ok: false, error: `${sourceName}里没有 ${def.name}。`, errorId: 'core.industry.016', errorParams: { p1: sourceName, p1Id: sourceId, p2: def.name }, soldUnits: 0, gainedIsk: 0 }
  }
  const good = marketGoodOf(ctx, 'item', itemId)
  if (!good) return { ok: false, error: `${def.name} 不在市场流通目录中，无法出售。`, errorId: 'core.industry.017', errorParams: { p1: def.name }, soldUnits: 0, gainedIsk: 0 }
  if (good.playerSellable === false) {
    return { ok: false, error: `${def.name} 暂不支持玩家出售。`, errorId: 'core.industry.018', errorParams: { p1: def.name }, soldUnits: 0, gainedIsk: 0 }
  }
  if (!remove(available)) return { ok: false, error: '取出物品失败。', errorId: 'core.industry.029', soldUnits: 0, gainedIsk: 0 }
  state.escrowItems[good.key] = (state.escrowItems[good.key] ?? 0) + available
  const res = sellAtMarket(state, ctx, good.key, available)
  return { ok: true, soldUnits: res.sold, gainedIsk: res.total }
}

export function buyShip(state: GameState, shipId: string, ctx: SimContext): CommandResult {
  const ship = ctx.ships.get(shipId)
  if (!ship) return { ok: false, error: `未知舰船：${shipId}。`, errorId: 'core.industry.019', errorParams: { p1: shipId } }
  const good = marketGoodOf(ctx, 'ship', shipId)
  if (!good) return { ok: false, error: `${ship.name} 不通过市场流通（仅可制造）。`, errorId: 'core.industry.020', errorParams: { p1: ship.name } }
  if (good.playerBuyable === false) {
    return {
      ok: false,
      error: `${ship.name} 仅可制造：市场不售成品现货（可在市场买它的蓝图书自行总装，或留意他人二手挂售）。`,
      errorId: 'core.industry.021',
      errorParams: { p1: ship.name },
    }
  }
  const lock = goodLockedReason(state, good)
  if (lock) {
    return {
      ok: false,
      error: `${ship.name} 暂不可购买：${lock}。`,
      errorId: 'core.industry.022',
      errorParams: { p1: ship.name, p2: lock },
    }
  }
  const quote = marketQuote(state, ctx, good.key)
  const ask = quote.sell
  if (ask !== undefined) {
    if (state.wallet.isk < ask) {
      return {
      ok: false,
      error: `信用点不足：${ship.name} 市场价约 ${ask.toLocaleString('zh-CN')} 信用点（现有 ${state.wallet.isk.toLocaleString('zh-CN')}）。`,
      errorId: 'core.industry.023',
      errorParams: { p1: ship.name, p2: ask.toLocaleString('zh-CN'), p3: state.wallet.isk.toLocaleString('zh-CN') },
    }
    }
    const res = buyAtMarket(state, ctx, good.key, 1)
    const uid = res.bought > 0 ? res.shipUid : null
    if (uid) {
      return { ok: true }
    }
  }
  const est = estimateShipBid(state, ctx, good.key)
  if (state.wallet.isk < est) {
    return {
      ok: false,
      error: `信用点不足：${ship.name} 收购挂单约 ${est.toLocaleString('zh-CN')} 信用点。`,
      errorId: 'core.industry.024',
      errorParams: { p1: ship.name, p2: est.toLocaleString('zh-CN') },
    }
  }
  const order = placeBuyOrder(state, ctx, good.key, est, 1)
  if (!order) return { ok: false, error: '挂收购单失败（钱包余额不足或订单无法成立）。', errorId: 'core.state.021' }
  addLog(state, 'trade', `${ship.name} 市场暂无现货——已自动挂收购单 @ ${order.price.toLocaleString('zh-CN')} 信用点，到货自动停入机库（可随时撤销）。`, 'core.industry.041', { p1: ship.name, p2: order.price.toLocaleString('zh-CN') })
  return { ok: true }
}

function estimateShipBid(state: GameState, ctx: SimContext, goodKey: string): number {
  const quote = marketQuote(state, ctx, goodKey)
  if (quote.sell !== undefined) return ceilFinalQuantity(quote.sell * 1.02)
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return Math.round(1e9)
  return ceilFinalQuantity(def.basePrice * 1.06 * 1.02)
}

export function sellAll(state: GameState, itemId: string, ctx: SimContext): SellResult {
  return sellCargoItem(state, itemId, ctx)
}
