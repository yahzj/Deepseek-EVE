import { ceilFinalQuantity } from '../quantity'
import { bumpFirst } from '../firstTasks'
import { addLog } from '../state'
import type { GameState, NpcMarketOrder, PlayerOrder } from '../state'
import type { SimContext } from '../types'
import { consumeLimitedSupply, hasLimitedSupply, limitedSupplyAvailable } from '../marketLimitedSupply'
import { sellStandingMult, netAfterTax } from './pricing'
import { tradeNoteText, goodName, tradeNoteId } from './labels'
import type { TradeNote } from './labels'
import { depositGood } from './stock'
import { refreshLimitedSupplyBook } from './supply'
import { bmGateLocked, goodLockedReason, playerTradingGood } from './access'
import { relayAvailableQty, relayTradable, recordRelayFill } from './relayLedger'

export function settleSell(
  state: GameState,
  ctx: SimContext,
  order: PlayerOrder,
  npc: NpcMarketOrder,
  take: number,
  idx: number,
  remote = false,
): void {
  const def = ctx.marketGoods.get(order.good)
  if (!def || !playerTradingGood(ctx, def)) return
  if (!remote && (!relayTradable(state, npc) || (!npc.relay && def.playerSellable === false))) return
  const shipSale = !!state.escrowShips[order.id]
  take = Math.min(take, order.qty, remote ? take : relayAvailableQty(state, npc), shipSale ? 1 : state.escrowItems[order.good] ?? 0)
  if (take <= 0) return
  const mult = sellStandingMult(state, def)
  const gross = ceilFinalQuantity(take * (npc.relay && !remote ? npc.price : order.price) * mult)
  const net = netAfterTax(state, ctx, gross)
  const tax = gross - net
  state.wallet.isk += net
  bumpFirst(state, 'marketIncome', net)
  if (!shipSale) state.escrowItems[order.good] = Math.max(0, (state.escrowItems[order.good] ?? 0) - take)
  order.filled += take
  order.qty -= take
  order.windowFilled = (order.windowFilled ?? 0) + take
  if (!remote) {
    recordRelayFill(state, npc, take)
    npc.qty -= take
  }
  const pool = state.market.pools[order.good]
  if (pool && !remote && !npc.relay) {
    pool.netVol -= take
    if (def?.poolTarget && def.poolTarget > 0) pool.q += take
  }
  if (!remote && npc.qty <= 0) state.market.npcBuy[order.good]!.splice(idx, 1)
  const note: TradeNote = tax > 0 ? (mult > 1 ? 'bonusTax' : 'tax') : mult > 1 ? 'bonus' : ''
  const taxNote = tradeNoteText(note, tax)
  if (state.escrowShips[order.id]) {
    delete state.escrowShips[order.id]
    const text = `挂单成交：二手舰船，税后入账 ${net.toLocaleString('zh-CN')} 信用点${taxNote}。`
    if (note === '') {
      addLog(state, 'trade', text, 'core.market.027', { p1: net.toLocaleString('zh-CN') })
    } else {
      addLog(state, 'trade', text, 'core.market.031', { p1: net.toLocaleString('zh-CN'), p2: tax.toLocaleString('zh-CN') })
    }
  } else {
    const text = `挂单成交：${goodName(ctx, order.good)}×${take.toLocaleString('zh-CN')}，税后入账 ${net.toLocaleString('zh-CN')} 信用点${taxNote}。`
    const id = mult > 1 ? 'core.market.036' : 'core.market.028'
    const params = { p1: goodName(ctx, order.good), p2: take.toLocaleString('zh-CN'), p3: net.toLocaleString('zh-CN') }
    const noteId = tradeNoteId(note)
    if (noteId === undefined) addLog(state, 'trade', text, id, params)
    else addLog(state, 'trade', text, id, { ...params, p4: taxNote, p4Id: noteId, p4p1: tax.toLocaleString('zh-CN') })
  }
}

export function settleBuy(state: GameState, ctx: SimContext, order: PlayerOrder, npc: NpcMarketOrder, idx: number, atGameMs: number, remote = false): void {
  const def = ctx.marketGoods.get(order.good)
  if (!def || !playerTradingGood(ctx, def) || goodLockedReason(state, def) !== null) return
  if (bmGateLocked(state, def) && (remote || npc.relay || !npc.bm)) return
  if (!remote && (!relayTradable(state, npc, atGameMs) || (!npc.relay && def.playerBuyable === false))) return
  const take = Math.min(order.qty, remote ? npc.qty : relayAvailableQty(state, npc, atGameMs), remote || npc.relay ? Infinity : limitedSupplyAvailable(state.market.pools[order.good], def), def.kind === 'ship' ? 50 : Infinity)
  if (take <= 0) return
  const actual = take * npc.price
  const reserved = take * order.price
  const escrow = order.escrowIsk ?? 0
  if (escrow >= reserved) {
    order.escrowIsk = escrow - reserved
    state.wallet.isk += reserved - actual
  } else {
    if (state.wallet.isk + escrow < actual) return
    state.wallet.isk += escrow
    state.wallet.isk -= actual
    order.escrowIsk = 0
  }
  if (!remote && !npc.relay) consumeLimitedSupply(state.market.pools[order.good], def, take, atGameMs)
  depositGood(state, ctx, order.good, take)
  order.filled += take
  order.qty -= take
  if (!remote) {
    recordRelayFill(state, npc, take)
    npc.qty -= take
  }
  const pool = state.market.pools[order.good]
  if (pool && !remote && !npc.relay) {
    pool.netVol += take
    if (def?.poolTarget && def.poolTarget > 0) pool.q = Math.max(0, pool.q - take)
  }
  if (!remote && npc.qty <= 0) state.market.npcSell[order.good]!.splice(idx, 1)
  if (order.qty <= 0 && (order.escrowIsk ?? 0) > 0) {
    state.wallet.isk += order.escrowIsk ?? 0
    order.escrowIsk = 0
  }
  addLog(
    state,
    'trade',
    `挂单买入成交：${goodName(ctx, order.good)}×${take.toLocaleString('zh-CN')}（${actual.toLocaleString('zh-CN')} 信用点）。`,
    'core.market.029',
    { p1: goodName(ctx, order.good), p2: take.toLocaleString('zh-CN'), p3: actual.toLocaleString('zh-CN') },
  )
}

export function settleSnatchSell(state: GameState, ctx: SimContext, order: PlayerOrder, take: number): void {
  take = Math.max(1, Math.min(order.qty, Math.floor(take)))
  const def = ctx.marketGoods.get(order.good)
  const shipSale = !!state.escrowShips[order.id]
  const mult = sellStandingMult(state, def)
  const gross = ceilFinalQuantity(order.price * take * mult)
  const net = netAfterTax(state, ctx, gross)
  const tax = gross - net
  state.wallet.isk += net
  bumpFirst(state, 'marketIncome', net)
  if (shipSale) {
    delete state.escrowShips[order.id]
  } else {
    state.escrowItems[order.good] = Math.max(0, (state.escrowItems[order.good] ?? 0) - take)
  }
  order.filled += take
  order.qty -= take
  const pool = state.market.pools[order.good]
  if (pool) {
    pool.netVol -= take
    if (def?.poolTarget && def.poolTarget > 0) pool.q += take
  }
  const note: TradeNote = tax > 0 ? (mult > 1 ? 'bonusTax' : 'tax') : mult > 1 ? 'bonus' : ''
  const taxNote = tradeNoteText(note, tax)
  if (shipSale) {
    const text = `挂单成交：二手舰船，税后入账 ${net.toLocaleString('zh-CN')} 信用点${taxNote}。`
    if (note === '') {
      addLog(state, 'trade', text, 'core.market.027', { p1: net.toLocaleString('zh-CN') })
    } else {
      addLog(state, 'trade', text, 'core.market.031', { p1: net.toLocaleString('zh-CN'), p2: tax.toLocaleString('zh-CN') })
    }
  } else {
    const text = `挂单成交：${goodName(ctx, order.good)}×${take.toLocaleString('zh-CN')}，税后入账 ${net.toLocaleString('zh-CN')} 信用点${taxNote}。`
    const id = mult > 1 ? 'core.market.036' : 'core.market.028'
    const params = { p1: goodName(ctx, order.good), p2: take.toLocaleString('zh-CN'), p3: net.toLocaleString('zh-CN') }
    const noteId = tradeNoteId(note)
    if (noteId === undefined) addLog(state, 'trade', text, id, params)
    else addLog(state, 'trade', text, id, { ...params, p4: taxNote, p4Id: noteId, p4p1: tax.toLocaleString('zh-CN') })
  }
}

export function settleSnatchBuy(state: GameState, ctx: SimContext, order: PlayerOrder, atGameMs: number): void {
  const def = ctx.marketGoods.get(order.good)
  if (!def || def.playerBuyable === false || goodLockedReason(state, def) !== null || bmGateLocked(state, def)) return
  if (limitedSupplyAvailable(state.market.pools[order.good], def) < 1) return
  const escrow = order.escrowIsk ?? 0
  if (escrow >= order.price) {
    order.escrowIsk = escrow - order.price
  } else {
    if (state.wallet.isk < order.price) return
    state.wallet.isk -= order.price
  }
  consumeLimitedSupply(state.market.pools[order.good], def, 1, atGameMs)
  if (hasLimitedSupply(def)) refreshLimitedSupplyBook(state, ctx, def!, atGameMs)
  depositGood(state, ctx, order.good, 1)
  order.filled += 1
  order.qty -= 1
  if (order.qty <= 0 && (order.escrowIsk ?? 0) > 0) {
    state.wallet.isk += order.escrowIsk ?? 0
    order.escrowIsk = 0
  }
  const pool = state.market.pools[order.good]
  if (pool) {
    pool.netVol += 1
    if (def?.poolTarget && def.poolTarget > 0) pool.q = Math.max(0, pool.q - 1)
  }
  addLog(
    state,
    'trade',
    `挂单买入成交：${goodName(ctx, order.good)}×1（${order.price.toLocaleString('zh-CN')} 信用点）。`,
    'core.market.029',
    { p1: goodName(ctx, order.good), p2: 1, p3: order.price.toLocaleString('zh-CN') },
  )
}

export function settleStationTake(state: GameState, ctx: SimContext, order: PlayerOrder, take: number): void {
  const def = ctx.marketGoods.get(order.good)
  const shipSale = !!state.escrowShips[order.id]
  const mult = sellStandingMult(state, def)
  const gross = ceilFinalQuantity(take * order.price * mult)
  const net = netAfterTax(state, ctx, gross)
  const tax = gross - net
  state.wallet.isk += net
  bumpFirst(state, 'marketIncome', net)
  if (shipSale) {
    delete state.escrowShips[order.id]
  } else {
    state.escrowItems[order.good] = Math.max(0, (state.escrowItems[order.good] ?? 0) - take)
  }
  order.filled += take
  order.qty -= take
  const pool = state.market.pools[order.good]
  if (pool) {
    pool.netVol -= take
    if (def?.poolTarget && def.poolTarget > 0) pool.q += take
  }
  const note: TradeNote = tax > 0 ? (mult > 1 ? 'bonusTax' : 'tax') : mult > 1 ? 'bonus' : ''
  const taxNote = tradeNoteText(note, tax)
  if (shipSale) {
    const text = `挂单成交：二手舰船，税后入账 ${net.toLocaleString('zh-CN')} 信用点${taxNote}。`
    if (note === '') {
      addLog(state, 'trade', text, 'core.market.027', { p1: net.toLocaleString('zh-CN') })
    } else {
      addLog(state, 'trade', text, 'core.market.031', { p1: net.toLocaleString('zh-CN'), p2: tax.toLocaleString('zh-CN') })
    }
  } else {
    const text = `挂单成交：${goodName(ctx, order.good)}×${take.toLocaleString('zh-CN')}，税后入账 ${net.toLocaleString('zh-CN')} 信用点${taxNote}。`
    const id = mult > 1 ? 'core.market.036' : 'core.market.028'
    const params = { p1: goodName(ctx, order.good), p2: take.toLocaleString('zh-CN'), p3: net.toLocaleString('zh-CN') }
    const noteId = tradeNoteId(note)
    if (noteId === undefined) addLog(state, 'trade', text, id, params)
    else addLog(state, 'trade', text, id, { ...params, p4: taxNote, p4Id: noteId, p4p1: tax.toLocaleString('zh-CN') })
  }
}
