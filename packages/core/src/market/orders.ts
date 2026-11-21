import { ceilFinalQuantity } from '../quantity'
import type { CoreBlockReason } from '../engine'
import { addLog } from '../state'
import type { GameState, PlayerOrder } from '../state'
import type { SimContext } from '../types'
import { shipStoredCount } from '../fleetBook'
import { emptyFitted } from '../labels'
import { hasLimitedSupply } from '../marketLimitedSupply'
import { crossOnPlacement } from './matching'
import { bumpFirstMarketTrade, placeOrderLogText, goodName } from './labels'
import { goodLockedReason, bmGateLocked, marketLockNote, bmGateNote, playerTradingGood } from './access'
import { ensureMarket } from './initialize'
import { refundToStorage } from './stock'
import { relayPriceQty } from './relayTypes'

export function placeSellOrder(state: GameState, ctx: SimContext, goodKey: string, price: number, qty: number): PlayerOrder | null {
  if (!relayPriceQty(ceilFinalQuantity(price), qty)) return null
  if (typeof goodKey !== 'string' || !ctx.marketGoods.has(goodKey)) return null
  if (!playerTradingGood(ctx, ctx.marketGoods.get(goodKey)!)) return null
  const order = pushSellOrder(state, goodKey, price, qty)
  state.escrowItems[goodKey] = (state.escrowItems[goodKey] ?? 0) + qty
  const r = crossOnPlacement(state, ctx, order)
  bumpFirstMarketTrade(state)
  addLog(state, 'trade', placeOrderLogText(ctx, 'sell', goodKey, order.price, qty, r))
  return order
}

export function pushSellOrder(state: GameState, goodKey: string, price: number, qty: number): PlayerOrder {
  state.market.orderSeq += 1
  const order: PlayerOrder = {
    id: state.market.orderSeq,
    side: 'sell',
    good: goodKey,
    price: ceilFinalQuantity(price),
    qty,
    filled: 0,
    placedAtGameMs: state.gameMs,
  }
  state.orders.push(order)
  return order
}

export function placeBuyOrder(state: GameState, ctx: SimContext, goodKey: string, price: number, qty: number): PlayerOrder | null {
  const def = ctx.marketGoods.get(goodKey)
  if (!def || !relayPriceQty(ceilFinalQuantity(price), Math.floor(qty))) return null
  if (goodLockedReason(state, def) !== null) return null
  if (bmGateLocked(state, def)) return null
  if (!playerTradingGood(ctx, def)) return null
  if (hasLimitedSupply(def)) ensureMarket(state, ctx)
  const unit = ceilFinalQuantity(price)
  const affordable = Math.floor(state.wallet.isk / unit)
  const want = Math.min(Math.floor(qty), affordable)
  if (want <= 0) return null
  const escrow = unit * want
  state.wallet.isk -= escrow
  state.market.orderSeq += 1
  const order: PlayerOrder = {
    id: state.market.orderSeq,
    side: 'buy',
    good: goodKey,
    price: unit,
    qty: want,
    filled: 0,
    placedAtGameMs: state.gameMs,
    escrowIsk: escrow,
  }
  state.orders.push(order)
  const r = crossOnPlacement(state, ctx, order)
  bumpFirstMarketTrade(state)
  addLog(state, 'trade', placeOrderLogText(ctx, 'buy', goodKey, order.price, want, r) + `（预扣 ${escrow.toLocaleString('zh-CN')} 信用点，撤单退回）`)
  return order
}

export function buyOrderBlockedReason(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  price: number,
  qty: number,
): CoreBlockReason | null {
  const def = ctx.marketGoods.get(goodKey)
  if (!def || !relayPriceQty(ceilFinalQuantity(price), Math.floor(qty))) return { error: '价格或数量无效。', errorId: 'core.market.041' }
  const lockNote = marketLockNote(state, def)
  if (lockNote !== null) return { error: lockNote.text, errorId: lockNote.textId, errorParams: lockNote.params }
  if (bmGateLocked(state, def)) {
      const note = bmGateNote(state, def)
      return note ? { error: note.text, errorId: note.textId, errorParams: note.params } : { error: '声望未达', errorId: 'core.market.042' }
    }
  if (!playerTradingGood(ctx, def))
      return { error: '该商品只收不卖，市场不出售现货。', errorId: 'core.market.043' }
  const unit = ceilFinalQuantity(price)
  if (state.wallet.isk < unit) {
    return {
      error: `信用点不足：挂 1 件需预扣 ${unit.toLocaleString('zh-CN')} 信用点，钱包 ${Math.floor(state.wallet.isk).toLocaleString('zh-CN')} 信用点（预扣部分撤单即退回）。`,
      errorId: 'core.market.044',
      errorParams: { p1: unit.toLocaleString('zh-CN'), p2: Math.floor(state.wallet.isk).toLocaleString('zh-CN') },
    }
  }
  return null
}

export function cancelOrder(state: GameState, ctx: SimContext, orderId: number): boolean {
  const idx = state.orders.findIndex((o) => o.id === orderId)
  if (idx < 0) return false
  const order = state.orders[idx]!
  state.orders.splice(idx, 1)
  if (order.side === 'sell' && order.qty > 0) {
    const shipHold = state.escrowShips[order.id]
    if (shipHold) {
      delete state.escrowShips[order.id]
      if (shipHold.from === 'store') {
        state.shipStore = state.shipStore ?? {}
        state.shipStore[shipHold.defId] = shipStoredCount(state, shipHold.defId) + 1
        addLog(state, 'trade', '卖单已撤销：舰船已退回舰船仓库。', 'core.market.014')
      } else {
        delete state.fleet[shipHold.shipId]
        state.fleet[shipHold.shipId] = {
          defId: shipHold.defId,
          customName: shipHold.customName,
          durability: shipHold.durability,
          cargo: {},
          fitted: emptyFitted(),
        }
        addLog(state, 'trade', '卖单已撤销：舰船已退回机库。', 'core.market.015')
      }
    } else {
      state.escrowItems[order.good] = Math.max(0, (state.escrowItems[order.good] ?? 0) - order.qty)
      refundToStorage(state, ctx, order.good, order.qty)
      addLog(
        state,
        'trade',
        `卖单已撤销：${goodName(ctx, order.good)}×${order.qty.toLocaleString('zh-CN')} 已退回。`,
        'core.market.016',
        { p1: goodName(ctx, order.good), p2: order.qty.toLocaleString('zh-CN') },
      )
    }
  } else if (order.side === 'buy') {
    const back = order.escrowIsk ?? 0
    if (back > 0) {
      state.wallet.isk += back
      order.escrowIsk = 0
      addLog(
        state,
        'trade',
        `买单已撤销：预扣 ${back.toLocaleString('zh-CN')} 信用点已退回钱包。`,
        'core.market.017',
        { p1: back.toLocaleString('zh-CN') },
      )
    } else {
      addLog(state, 'trade', '买单已撤销。', 'core.market.018')
    }
  }
  return true
}
