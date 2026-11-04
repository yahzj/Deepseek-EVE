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
import { goodLockedReason, bmGateLocked, marketLockNote, bmGateNote } from './access'
import { ensureMarket } from './initialize'
import { refundToStorage } from './stock'

export function placeSellOrder(state: GameState, ctx: SimContext, goodKey: string, price: number, qty: number): PlayerOrder | null {
  if (qty <= 0 || price <= 0) return null
  if (typeof goodKey !== 'string' || !ctx.marketGoods.has(goodKey)) return null
  if (ctx.marketGoods.get(goodKey)!.playerSellable === false) return null
  const order = pushSellOrder(state, goodKey, price, qty)
  state.escrowItems[goodKey] = (state.escrowItems[goodKey] ?? 0) + qty
  // 挂单瞬间先吃簿（2026-09-10 船长定）：与现有收购单对冲的部分立即成交，剩余才挂着
  const r = crossOnPlacement(state, ctx, order)
  // 「第一次挂单销售」的判据（**2026-09-22 船长令**：挂卖单也算——见 `bumpFirstMarketTrade`）
  bumpFirstMarketTrade(state)
  addLog(state, 'trade', placeOrderLogText(ctx, 'sell', goodKey, order.price, qty, r))
  return order
}

/** 内部：把卖单写入订单表（不碰 escrow、不打日志） */
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

/**
 * 挂限价买单（**EVE 式预扣**：挂单即从钱包扣下 `挂价 × 挂量`，撤单/成交价差退回；货直接入库存）。
 * 受声望门槛商品在此拒绝。
 *
 * 2026-09-11 船长裁决「甲」：此前买单**不冻结资金**（只在成交时扣钱、钱不够就挂着等），
 * 于是可以**零资金挂满全市场**（挂单还不过期）＝对未来供给的免费期权。现改为预扣：
 * - `escrowIsk` 记在本单上（存档随订单保留；旧档缺省 0 = 遗留单，仍按"成交时扣钱"的旧口径）；
 * - **余额不足按余额缩量**（挂得起的部分；连 1 件都挂不起则拒绝，界面用 `buyOrderBlockedReason` 给原因）；
 * - 成交（`settleBuy`）从预扣里结算：挂价高于成交价时**价差退回钱包**；成交完毕/撤单退回余额。
 *
 * 2026-09-10 船长定（保留）：挂单瞬间先核对现有卖单簿面——与「供应价 ≤ 挂价」的卖单（含同价）立即成交，
 * 剩余数量才作为挂单等待后续窗口。
 */
export function placeBuyOrder(state: GameState, ctx: SimContext, goodKey: string, price: number, qty: number): PlayerOrder | null {
  const def = ctx.marketGoods.get(goodKey)
  if (!def || qty <= 0 || price <= 0) return null
  if (goodLockedReason(state, def) !== null) return null
  if (bmGateLocked(state, def)) return null // P2：声望闸内不开放常驻买单（暗市单现买即可）
  if (def.playerBuyable === false) return null // 只收不卖商品（如残骸）：不开放挂买单
  if (hasLimitedSupply(def)) ensureMarket(state, ctx)
  const unit = ceilFinalQuantity(price)
  // 预扣口径：按余额缩量（向下取整到件；轮不到 1 件就拒绝）
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
  // 「第一次挂单销售」的判据（**2026-09-22 船长令**：挂买单也算——见 `bumpFirstMarketTrade`）
  bumpFirstMarketTrade(state)
  addLog(state, 'trade', placeOrderLogText(ctx, 'buy', goodKey, order.price, want, r) + `（预扣 ${escrow.toLocaleString('zh-CN')} 信用点，撤单退回）`)
  return order
}

/** 挂买单能不能挂（不能则给出玩家可读原因；能则 null）——界面门控与 engine 回执共用。
 *  2026-09-11 起：**余额不足**是明确的一种原因（预扣 `挂价 × 挂量`；可按余额缩量后能挂 ≥1 件则放行）。 */
export function buyOrderBlockedReason(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  price: number,
  qty: number,
): CoreBlockReason | null {
  const def = ctx.marketGoods.get(goodKey)
  if (!def || qty <= 0 || price <= 0) return { error: '价格或数量无效。', errorId: 'core.market.041' }
  /* 锁标走**结构化孪生**（2026-09-30 加的那条先例）：同一条文案同一个 id ⇒ 界面按语言渲染 */
  const lockNote = marketLockNote(state, def)
  if (lockNote !== null) return { error: lockNote.text, errorId: lockNote.textId, errorParams: lockNote.params }
  if (bmGateLocked(state, def)) {
      const note = bmGateNote(state, def)
      return note ? { error: note.text, errorId: note.textId, errorParams: note.params } : { error: '声望未达', errorId: 'core.market.042' }
    }
  if (def.playerBuyable === false)
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

/** 撤单：退回 escrow（按商品类别）；舰船从 escrow 恢复进舰队（耐久保留） */
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
        // 2026-09-14 船长：从**舰船仓库**挂卖的（纯计数船）撤单**退回舰船仓库**，不进机库
        state.shipStore = state.shipStore ?? {}
        state.shipStore[shipHold.defId] = shipStoredCount(state, shipHold.defId) + 1
        addLog(state, 'trade', '卖单已撤销：舰船已退回舰船仓库。', 'core.market.014')
      } else {
        // v17：原实例原样恢复（uid/船型/耐久/自定义名全保留）；异常残留的同 uid 条目先清除
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
    // 2026-09-11（预扣冻结）：把该单未用完的预扣退回钱包（旧档遗留单预扣为 0，自然无退款）
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
