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

/** 卖单成交：钱入账（物品含声望加成，成交扣贸易税），escrow 扣减，池吸收，记录净卖量 */
export function settleSell(
  state: GameState,
  ctx: SimContext,
  order: PlayerOrder,
  npc: NpcMarketOrder,
  take: number,
  idx: number,
): void {
  const def = ctx.marketGoods.get(order.good)
  const mult = sellStandingMult(state, def)
  const gross = ceilFinalQuantity(take * order.price * mult)
  const net = netAfterTax(state, ctx, gross)
  const tax = gross - net
  state.wallet.isk += net
  // 市场链（2026-09-18 船长：「挂单按照市场交易收入计数」·「按税后算」）：卖出入账即累计
  bumpFirst(state, 'marketIncome', net)
  state.escrowItems[order.good] = Math.max(0, (state.escrowItems[order.good] ?? 0) - take)
  order.filled += take
  order.qty -= take
  order.windowFilled = (order.windowFilled ?? 0) + take
  npc.qty -= take
  const pool = state.market.pools[order.good]
  if (pool) {
    pool.netVol -= take
    if (def?.poolTarget && def.poolTarget > 0) pool.q += take
  }
  if (npc.qty <= 0) state.market.npcBuy[order.good]!.splice(idx, 1)
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

/** 买单成交：**从预扣里结算**（挂价 × 成交量），挂价高于实际成交价时把价差退回钱包，货入对应库存，池售出。
 *  2026-09-11（船长裁决「甲」预扣冻结）：钱在挂单时已扣，故此处不再看钱包；
 *  **遗留单**（改动前挂的、`escrowIsk` 缺省 0）仍按旧口径——钱包够才成交，不够继续挂着等。 */
export function settleBuy(state: GameState, ctx: SimContext, order: PlayerOrder, npc: NpcMarketOrder, idx: number, atGameMs: number): void {
  const def = ctx.marketGoods.get(order.good)
  const take = Math.min(order.qty, npc.qty, limitedSupplyAvailable(state.market.pools[order.good], def))
  if (take <= 0) return
  const actual = take * npc.price // 实付给 NPC
  const reserved = take * order.price // 本笔应从预扣里核销的额度
  const escrow = order.escrowIsk ?? 0
  if (escrow >= reserved) {
    order.escrowIsk = escrow - reserved
    state.wallet.isk += reserved - actual // 挂价高于成交价 → 价差退回（挂价 ≤ 成交价时不会进到这里）
  } else {
    // 遗留单（未预扣）或预扣不足：沿用旧口径（钱包够才成交，不够暂缓）；有残留预扣先退回再按钱包实付
    if (state.wallet.isk + escrow < actual) return
    state.wallet.isk += escrow
    state.wallet.isk -= actual
    order.escrowIsk = 0
  }
  consumeLimitedSupply(state.market.pools[order.good], def, take, atGameMs)
  depositGood(state, ctx, order.good, take)
  order.filled += take
  order.qty -= take
  npc.qty -= take
  const pool = state.market.pools[order.good]
  if (pool) {
    pool.netVol += take
    if (def?.poolTarget && def.poolTarget > 0) pool.q = Math.max(0, pool.q - take)
  }
  if (npc.qty <= 0) state.market.npcSell[order.good]!.splice(idx, 1)
  // 成交完毕：预扣余量（四舍五入/遗留单残留）一并退回钱包，避免挂单移出后钱失踪
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

/** 越线卖单抢单成交（2026-09-08 船长定：巡游采购按贴线度多件成交 @ 挂单价；税/escrow/池与簿成交同口径） */
export function settleSnatchSell(state: GameState, ctx: SimContext, order: PlayerOrder, take: number): void {
  take = Math.max(1, Math.min(order.qty, Math.floor(take)))
  const def = ctx.marketGoods.get(order.good)
  const shipSale = !!state.escrowShips[order.id]
  const mult = sellStandingMult(state, def)
  const gross = ceilFinalQuantity(order.price * take * mult)
  const net = netAfterTax(state, ctx, gross)
  const tax = gross - net
  state.wallet.isk += net
  // 市场链（2026-09-18 船长：「挂单按照市场交易收入计数」·「按税后算」）：卖出入账即累计
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
  // 2026-09-08（船长定）：越线抢单成交静默化——日志与普通簿面成交完全一致，不出现"巡游采购"字样
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

/** 越线买单抢单成交（2026-09-08 船长定：巡游供货 1 件 @ 挂单价）。
 *  2026-09-11（预扣冻结）：钱在挂单时已扣 ⇒ 从预扣里核销 1 件；遗留单（无预扣）仍看钱包。 */
export function settleSnatchBuy(state: GameState, ctx: SimContext, order: PlayerOrder, atGameMs: number): void {
  const def = ctx.marketGoods.get(order.good)
  if (limitedSupplyAvailable(state.market.pools[order.good], def) < 1) return
  const escrow = order.escrowIsk ?? 0
  if (escrow >= order.price) {
    order.escrowIsk = escrow - order.price
  } else {
    if (state.wallet.isk < order.price) return // 遗留单：钱包不足当窗跳过
    state.wallet.isk -= order.price
  }
  consumeLimitedSupply(state.market.pools[order.good], def, 1, atGameMs)
  if (hasLimitedSupply(def)) refreshLimitedSupplyBook(state, ctx, def!, atGameMs)
  depositGood(state, ctx, order.good, 1)
  order.filled += 1
  order.qty -= 1
  // 成交完毕：预扣余量退回钱包（防"单子移出挂单表后钱失踪"）
  if (order.qty <= 0 && (order.escrowIsk ?? 0) > 0) {
    state.wallet.isk += order.escrowIsk ?? 0
    order.escrowIsk = 0
  }
  const pool = state.market.pools[order.good]
  if (pool) {
    pool.netVol += 1
    if (def?.poolTarget && def.poolTarget > 0) pool.q = Math.max(0, pool.q - 1)
  }
  // 2026-09-08（船长定）：越线买单静默化——日志与普通买单成交一致，不出现"巡游供货"字样
  addLog(
    state,
    'trade',
    `挂单买入成交：${goodName(ctx, order.good)}×1（${order.price.toLocaleString('zh-CN')} 信用点）。`,
    'core.market.029',
    { p1: goodName(ctx, order.good), p2: 1, p3: order.price.toLocaleString('zh-CN') },
  )
}

/** 站内吸收成交（与 settleSell 同口径：税/声望加成/池/escrow；价格 = 挂单价） */
export function settleStationTake(state: GameState, ctx: SimContext, order: PlayerOrder, take: number): void {
  const def = ctx.marketGoods.get(order.good)
  const shipSale = !!state.escrowShips[order.id]
  const mult = sellStandingMult(state, def)
  const gross = ceilFinalQuantity(take * order.price * mult)
  const net = netAfterTax(state, ctx, gross)
  const tax = gross - net
  state.wallet.isk += net
  // 市场链（2026-09-18 船长：「挂单按照市场交易收入计数」·「按税后算」）：卖出入账即累计
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
  // 2026-09-08（船长定）：站内吸收静默化——日志与普通簿面成交完全一致，不出现"让利售出/站内收购"字样
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
