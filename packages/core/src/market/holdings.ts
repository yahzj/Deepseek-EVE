import { ceilFinalQuantity } from '../quantity'
import { addLog } from '../state'
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { shipStoredCount } from '../fleetBook'
import { marketTradingGoods, playerTradingGood } from './access'
import { relayAvailableQty, relayTradable } from './relayLedger'
import { sellStoredShipAtMarket, pushStoredShipSellOrder } from './ships'
import { naturalHoldings, lockNaturalStock, unlockNaturalStock } from './stock'
import { sellAtMarket } from './trading'
import { sellStandingMult, marketSellSkillMult, netAfterTax } from './pricing'
import { crossOnPlacement } from './matching'
import { goodName, bumpFirstMarketTrade, placeOrderLogText } from './labels'
import { pushSellOrder } from './orders'

export function learnBlueprint(state: GameState, ctx: SimContext, blueprintId: string): { ok: boolean; error?: string; errorId?: string; errorParams?: Readonly<Record<string, string | number>> } {
  const known = ctx.blueprints.get(blueprintId) ?? ctx.shipBlueprints.get(blueprintId)
  if (!known) return { ok: false, error: `未知蓝图：${blueprintId}。`, errorId: 'core.market.001', errorParams: { p1: blueprintId } }
  if (known.singleUse === true) {
    return { ok: false, error: `「${known.name}」是一次性图纸：不能学习，请到组装机直接用掉（只能制造一次）。`,
      errorId: 'core.market.002',
      errorParams: { p1: known.name } }
  }
  const count = state.blueprintStock[blueprintId] ?? 0
  if (count <= 0) return { ok: false, error: '没有可学习的蓝图书。', errorId: 'core.market.003' }
  if (state.learnedRecipes.includes(blueprintId)) {
    if (!marketTradingGoods(ctx).some(good => good.kind === 'blueprint' && good.refId === blueprintId)) {
      return { ok: false, error: '该配方已学会。', errorId: 'core.ammoMk3.001' }
    }
    return { ok: false, error: '该配方已学会——多余的蓝图书可以挂到市场出售。', errorId: 'core.market.004' }
  }
  state.blueprintStock[blueprintId] = count - 1
  if (state.blueprintStock[blueprintId] === 0) delete state.blueprintStock[blueprintId]
  state.learnedRecipes.push(blueprintId)
  addLog(state, 'industry', `已学习「${known.name}」：可前往组装机无限次制造。`, 'core.market.026', { p1: known.name })
  return { ok: true }
}

export function marketSellHolding(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  qty?: number,
): {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  sold: number
  total: number
  remaining: number
} {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return { ok: false, error: `未知商品：${goodKey}`, errorId: 'core.market.005', errorParams: { p1: goodKey }, sold: 0, total: 0, remaining: 0 }
  if (!playerTradingGood(ctx, def)) return { ok: false, error: '该商品不支持玩家出售。', errorId: 'core.market.006', sold: 0, total: 0, remaining: 0 }
  if (def.kind === 'ship') {
    const res = sellStoredShipAtMarket(state, ctx, def.refId, qty === undefined ? shipStoredCount(state, def.refId) : qty)
    if (!res.ok) {
      return { ok: false, error: res.reason ?? '出售失败。', errorId: res.reason === undefined ? 'core.market.007' : undefined, sold: 0, total: 0, remaining: 0 }
    }
    return { ok: true, sold: res.filled ?? 0, total: res.total ?? 0, remaining: res.resting ?? 0 }
  }
  const available = naturalHoldings(state, def)
  const want = qty === undefined ? available : Math.max(0, Math.floor(qty))
  if (want <= 0 || available <= 0) {
    return { ok: false, error: '没有可卖的库存。', errorId: 'core.market.008', sold: 0, total: 0, remaining: 0 }
  }
  const n = Math.min(want, available)
  if (!lockNaturalStock(state, def, n)) return { ok: false, error: '取货失败。', errorId: 'core.market.009', sold: 0, total: 0, remaining: 0 }
  const res = sellAtMarket(state, ctx, goodKey, n)
  if (res.sold === 0 && res.remaining > 0) {
    unlockNaturalStock(state, def, n)
    return {
      ok: false,
      error: '市场收购簿为空，暂时无人收购——未出售任何货物，已退回库存。可改挂限价卖单等待收购。',
      errorId: 'core.market.010',
      sold: 0,
      total: 0,
      remaining: n,
    }
  }
  return { ok: true, sold: res.sold, total: res.total, remaining: res.remaining }
}

export function marketSellPreview(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  qty?: number,
): {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  avail: number
  want: number
  fillable: number
  orders: number
  gross: number
  tax: number
  net: number
  leftover: number
} {
  const def = ctx.marketGoods.get(goodKey)
  const zero = { avail: 0, want: 0, fillable: 0, orders: 0, gross: 0, tax: 0, net: 0, leftover: 0 }
  if (!def) return { ok: false, error: `未知商品：${goodKey}`, errorId: 'core.market.005', errorParams: { p1: goodKey }, ...zero }
  if (!playerTradingGood(ctx, def)) return { ok: false, error: '该商品不支持玩家出售。', errorId: 'core.market.006', ...zero }
  const avail = def.kind === 'ship' ? shipStoredCount(state, def.refId) : naturalHoldings(state, def)
  const want = qty === undefined ? avail : Math.max(0, Math.floor(qty))
  const n = Math.min(want, avail)
  if (n <= 0 || avail <= 0) {
    return {
      ok: false,
      error: def.kind === 'ship' ? '舰船仓库里没有可卖的舰船：先在舰船页把船移入舰船仓库。' : '没有可卖的库存。',
      errorId: def.kind === 'ship' ? 'core.market.011' : 'core.market.008',
      ...zero,
      avail,
      want,
    }
  }
  let remaining = n
  let total = 0
  let orders = 0
  const buyList = state.market.npcBuy[goodKey] ?? []
  const sorted = [...buyList].sort((a, b) => b.price - a.price)
  for (const npc of sorted) {
    if (remaining <= 0) break
    if (!relayTradable(state, npc) || (!npc.relay && def.playerSellable === false)) continue
    const take = Math.min(remaining, relayAvailableQty(state, npc))
    total += take * npc.price
    remaining -= take
    orders += 1
  }
  const sold = n - remaining
  const mult = def.kind === 'ship' ? sellStandingMult(state, def) : sellStandingMult(state, def) * marketSellSkillMult(state, def.kind)
  const gross = ceilFinalQuantity(total * mult)
  const net = netAfterTax(state, ctx, gross)
  return { ok: true, avail, want: n, fillable: sold, orders, gross, tax: gross - net, net, leftover: remaining }
}

export function listSellHolding(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  price: number,
  qty?: number,
): {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  orderId?: number
  price?: number
  filled?: number
  resting?: number
} {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return { ok: false, error: `未知商品：${goodKey}`, errorId: 'core.market.005', errorParams: { p1: goodKey } }
  if (!playerTradingGood(ctx, def)) return { ok: false, error: '该商品不支持玩家出售。', errorId: 'core.market.006' }
  const isShip = def.kind === 'ship'
  const available = isShip ? shipStoredCount(state, def.refId) : naturalHoldings(state, def)
  const want = qty === undefined ? available : Math.max(0, Math.floor(qty))
  if (want <= 0 || available <= 0) {
    return {
      ok: false,
      error: isShip ? '舰船仓库里没有可卖的舰船：先在舰船页把船移入舰船仓库。' : '没有可卖的库存。',
      errorId: isShip ? 'core.market.011' : 'core.market.008',
    }
  }
  const unit = ceilFinalQuantity(price)
  if (!Number.isSafeInteger(unit) || unit <= 0 || !Number.isSafeInteger(unit * Math.min(want, available)) ||
    (def.basePrice > 0 && unit > def.basePrice * ctx.balance.market.maxPriceRatio)) {
    return { ok: false, error: '挂单价异常（需为 0 以上的信用点，且不超过限价上限）。', errorId: 'core.market.012' }
  }
  const n = Math.min(want, available)
  if (isShip) {
    let lastId: number | undefined
    let filled = 0
    let resting = 0
    for (let i = 0; i < n; i += 1) {
      const o = pushStoredShipSellOrder(state, ctx, def.refId, price)
      if (!o) break
      lastId = o.id
      const r = crossOnPlacement(state, ctx, o)
      filled += r.filled
      resting += r.resting
    }
    if (lastId === undefined) {
      return { ok: false, error: '挂卖单失败：请检查舰船仓库库存与价格。', errorId: 'core.market.013' }
    }
    addLog(
      state,
      'trade',
      resting > 0
        ? `已挂卖单：舰船「${goodName(ctx, goodKey)}」×${resting.toLocaleString('zh-CN')} @ ${ceilFinalQuantity(price).toLocaleString('zh-CN')} 信用点（撤销卖单可把船退回舰船仓库）。`
        : `卖单已即时成交：舰船「${goodName(ctx, goodKey)}」×${filled.toLocaleString('zh-CN')} @ ${ceilFinalQuantity(price).toLocaleString('zh-CN')} 信用点。`,
    )
    bumpFirstMarketTrade(state)
    return { ok: true, orderId: lastId, price: ceilFinalQuantity(price), filled, resting }
  }
  if (!lockNaturalStock(state, def, n)) return { ok: false, error: '取货失败。', errorId: 'core.market.009' }
  const order = pushSellOrder(state, goodKey, price, n)
  const r = crossOnPlacement(state, ctx, order)
  bumpFirstMarketTrade(state)
  addLog(state, 'trade', placeOrderLogText(ctx, 'sell', goodKey, order.price, n, r))
  return { ok: true, orderId: order.id, price: order.price, filled: r.filled, resting: r.resting }
}
