import { ceilFinalQuantity } from '../quantity'
import { addLog, shipLockedReason } from '../state'
import type { GameState, PlayerOrder } from '../state'
import type { SimContext } from '../types'
import { isShipLocked, shipStoredCount } from '../fleetBook'
import { shipDisplayName } from '../instances'
import { uidDefId, allFittedIds } from '../labels'
import { shipInReturn } from '../mining'
import { plugBlockReasonOf } from '../plugs'
import { marketQuote } from './view'
import { buyPrice, priceLevel, netAfterTax } from './pricing'
import { matchPlayerOrders, crossOnPlacement } from './matching'
import { bumpFirstMarketTrade } from './labels'
import { pushSellOrder } from './orders'

export function shipSellable(state: GameState, shipId: string): { ok: boolean; reason?: string } {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return { ok: false, reason: '机库里没有这艘船。' }
  if (state.shipId === shipId) return { ok: false, reason: '正在驾驶的船不能出售。' }
  if (state.aiAssignments[shipId]) return { ok: false, reason: 'AI 任务执行中的船不能出售，先取消指派。' }
  if (isShipLocked(state, shipId)) return { ok: false, reason: '该船已锁定（防误操作）：先到舰船页解锁。' }
  const cargoUnits = Object.values(fleetShip.cargo).reduce((a, b) => a + b, 0)
  if (cargoUnits > 0) return { ok: false, reason: '货仓里有物品，请先清空。' }
  if (allFittedIds(fleetShip.fitted).length > 0) {
    return { ok: false, reason: '还装着模块，请先卸下。' }
  }
  if (shipInReturn(state, shipId)) return { ok: false, reason: '该船正在返航卸货（换船善后），到港后才能出售。' }
  const plugBlock = plugBlockReasonOf(state, shipId)
  if (plugBlock) return { ok: false, reason: plugBlock.text }
  return { ok: true }
}

export function sellShipAtMarket(state: GameState, ctx: SimContext, shipId: string): { ok: boolean; total?: number; reason?: string } {
  const lock = shipLockedReason(state, shipId, '卖掉它')
  if (lock) return { ok: false, reason: lock }
  const check = shipSellable(state, shipId)
  if (!check.ok) return check
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return { ok: false, reason: '机库里没有这艘船。' }
  const def = [...ctx.marketGoods.values()].find((g) => g.kind === 'ship' && g.refId === fleetShip.defId)
  if (!def) return { ok: false, reason: '该舰船不在市场流通目录中。' }
  const display = shipDisplayName(state, ctx, shipId)
  const quote = marketQuote(state, ctx, def.key)
  const bestBuyPrice = quote.buy
  const est = bestBuyPrice ?? ceilFinalQuantity(buyPrice(def, priceLevel(state, ctx, def, def.poolTarget ?? 0)) * 0.98)
  const order = placeShipSellOrder(state, ctx, shipId, est)
  if (!order) return { ok: false, reason: '无法挂单：请检查船的状态。' }
  matchPlayerOrders(state, ctx)
  if (order.qty <= 0) {
    const gross = order.filled * order.price
    return { ok: true, total: netAfterTax(state, ctx, gross) }
  }
  addLog(
    state,
    'trade',
    `「${display}」未能立即成交，已转为限价卖单（撤销卖单可把船退回机库）。`,
    'core.market.025',
    { p1: display },
  )
  return { ok: true }
}

export function placeShipSellOrder(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  price: number,
): PlayerOrder | null {
  const check = shipSellable(state, shipId)
  if (!check.ok || price <= 0) return null
  const fleetShip = state.fleet[shipId]!
  const def = [...ctx.marketGoods.values()].find((g) => g.kind === 'ship' && g.refId === fleetShip.defId)
  if (!def) return null
  const display = shipDisplayName(state, ctx, shipId)
  const hold = {
    shipId,
    defId: fleetShip.defId ?? uidDefId(shipId),
    durability: fleetShip.durability,
    customName: fleetShip.customName ?? null,
  }
  delete state.fleet[shipId]
  state.market.orderSeq += 1
  const order: PlayerOrder = {
    id: state.market.orderSeq,
    side: 'sell',
    good: def.key,
    price: ceilFinalQuantity(price),
    qty: 1,
    filled: 0,
    placedAtGameMs: state.gameMs,
  }
  state.orders.push(order)
  state.escrowShips[order.id] = hold
  const r = crossOnPlacement(state, ctx, order)
  bumpFirstMarketTrade(state)
  addLog(
    state,
    'trade',
    r.filled > 0
      ? `卖单已即时成交：二手舰船「${display}」@ ${order.price.toLocaleString('zh-CN')} 信用点。`
      : `已挂卖单：二手舰船「${display}」@ ${order.price.toLocaleString('zh-CN')} 信用点（可撤销退回机库）。`,
  )
  return order
}


export function pushStoredShipSellOrder(state: GameState, ctx: SimContext, defId: string, price: number): PlayerOrder | null {
  if (shipStoredCount(state, defId) <= 0 || price <= 0) return null
  const def = [...ctx.marketGoods.values()].find((g) => g.kind === 'ship' && g.refId === defId)
  if (!def) return null
  state.shipStore = state.shipStore ?? {}
  const left = shipStoredCount(state, defId) - 1
  if (left > 0) state.shipStore[defId] = left
  else delete state.shipStore[defId]
  const order = pushSellOrder(state, def.key, price, 1)
  state.escrowShips[order.id] = {
    shipId: `${defId}#store-${order.id}`,
    defId,
    durability: 1,
    customName: null,
    from: 'store',
  }
  return order
}

export function placeStoredShipSellOrder(
  state: GameState,
  ctx: SimContext,
  defId: string,
  price: number,
): PlayerOrder | null {
  const display = ctx.ships.get(defId)?.name ?? defId
  const order = pushStoredShipSellOrder(state, ctx, defId, price)
  if (!order) return null
  bumpFirstMarketTrade(state)
  const r = crossOnPlacement(state, ctx, order)
  addLog(
    state,
    'trade',
    r.filled > 0
      ? `卖单已即时成交：舰船「${display}」@ ${order.price.toLocaleString('zh-CN')} 信用点。`
      : `已挂卖单：舰船「${display}」@ ${order.price.toLocaleString('zh-CN')} 信用点（可撤销退回舰船仓库）。`,
  )
  return order
}

export function sellStoredShipAtMarket(
  state: GameState,
  ctx: SimContext,
  defId: string,
  qty = 1,
): {
  ok: boolean
  total?: number
  reason?: string
  reasonId?: string
  reasonParams?: Record<string, string | number>
  filled?: number
  resting?: number
} {
  const have = shipStoredCount(state, defId)
  if (have <= 0)
    return { ok: false, reason: '舰船仓库里没有这一型：先在舰船页把船移入舰船仓库。', reasonId: 'core.market.045' }
  const def = [...ctx.marketGoods.values()].find((g) => g.kind === 'ship' && g.refId === defId)
  if (!def) return { ok: false, reason: '该舰船不在市场流通目录中。', reasonId: 'core.market.046' }
  const display = ctx.ships.get(defId)?.name ?? defId
  const n = Math.min(Math.max(1, Math.floor(qty)), have)
  const quote = marketQuote(state, ctx, def.key)
  const est = quote.buy ?? ceilFinalQuantity(buyPrice(def, priceLevel(state, ctx, def, def.poolTarget ?? 0)) * 0.98)
  let filled = 0
  let net = 0
  let resting = 0
  for (let i = 0; i < n; i += 1) {
    const order = pushStoredShipSellOrder(state, ctx, defId, est)
    if (!order) break
    matchPlayerOrders(state, ctx)
    if (order.qty <= 0) {
      filled += order.filled
      net += netAfterTax(state, ctx, order.filled * order.price)
    } else {
      resting += order.qty
    }
  }
  if (filled + resting > 0) bumpFirstMarketTrade(state)
  if (resting > 0) {
    addLog(
      state,
      'trade',
      `「${display}」×${resting.toLocaleString('zh-CN')} 未能立即成交，已转为限价卖单（撤销卖单可把船退回舰船仓库）。`,
    )
  }
  return { ok: true, ...(filled > 0 ? { total: net } : {}), filled, resting }
}
