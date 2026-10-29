import { ceilFinalQuantity } from '../quantity'
import { addLog, shipLockedReason } from '../state'
import type { CommandResult } from '../engine'
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { countItem, countWare, removeItem, removeWare } from '../inventory'
import { shipOperationBlockReason } from '../shipActionPolicy'
import { DSI_FACTION_ID, standingOf } from '../expedition'
import { buyAtMarket, goodLockedReason, marketGoodOf, marketQuote, placeBuyOrder, sellAtMarket } from '../market'

/**
 * M4：协会声望贸易加成——声望每 1 点，空间站收购价 +1%，上限 +15%。
 */
export function sellPriceMultiplier(state: GameState): number {
  return 1 + Math.min(0.15, standingOf(state, DSI_FACTION_ID) * 0.01)
}

/** 出售结果 */
export interface SellResult {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  soldUnits: number
  gainedIsk: number
}

/** 从当前船货仓按市价卖出（矿石主要在此；吃穿簿的剩余自动转限价卖单） */
export function sellCargoItem(state: GameState, itemId: string, ctx: SimContext): SellResult {
  const blocked = shipOperationBlockReason(state, ctx, state.shipId, 'cargo')
  if (blocked) return { ok: false, ...blocked, soldUnits: 0, gainedIsk: 0 }
  return sellItemFrom(state, itemId, countItem(state, itemId), (units) => removeItem(state, itemId, units), ctx, '货仓', 'ui.CargoPage.004')
}

/** 从物品仓库按市价卖出（矿物/存仓矿石在此） */
export function sellWareItem(state: GameState, itemId: string, ctx: SimContext): SellResult {
  return sellItemFrom(state, itemId, countWare(state, itemId), (units) => removeWare(state, itemId, units), ctx, '仓库', 'ui.ItemsPage.001')
}

/**
 * **丢弃仓库物品（任意数量）**（船长 2026-09-15：「**仓库添加丢弃按钮，允许玩家丢弃任意数量已有物品**」）。
 *
 * 口径：
 * - `qty` **下取整**，并**夹在 [1, 持有量]**（超出按持有量丢 ⇒ 玩家点「全部」不必先自己数）；
 * - 返回 `{ ok, dropped }`：`dropped` = **实际丢弃数**；仓库里没有该物品 / 数量 ≤ 0 ⇒ `ok:false`；
 * - **纯销毁**：不给信用点、不进回收与精炼链、**不动货仓**（要变现请走「市价卖出」或精炼炉「残骸回收」）；
 * - 写一条事件日志（`⚑ 丢弃 …（仓库）`），玩家可在日志里对账。
 *
 * 术语边界：「**抛弃**」= 洞内货仓那套（`wormholeHoldDiscard` 等，受格数与超载规则约束）；
 * 「**丢弃**」= 站内仓库（无限容量、不随船）⇒ 两者各自独立、互不调用。
 */
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

/** 从当前船货仓按市价**卖出指定数量**（船长 2026-09-05：出售支持只卖一部分；其余语义同 sellCargoItem） */
export function sellCargoItemQty(state: GameState, itemId: string, qty: number, ctx: SimContext): SellResult {
  const blocked = shipOperationBlockReason(state, ctx, state.shipId, 'cargo')
  if (blocked) return { ok: false, ...blocked, soldUnits: 0, gainedIsk: 0 }
  // **进洞船只所有行为锁定**（船长 2026-09-13：锁，进洞船只所有行为都锁定。包括维修。）
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

/** 从物品仓库按市价**卖出指定数量**（同 sellWareItem 其余语义） */
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
  /** 来源标签的 l10n id（`ui.CargoPage.004` 货仓 / `ui.ItemsPage.001` 仓库）—— 中文原串仍照写，此处只给界面按语言取词用 */
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
  // 货先锁定进 escrow，再按市场收购簿即时成交（剩余部分由引擎自动转限价挂单）
  state.escrowItems[good.key] = (state.escrowItems[good.key] ?? 0) + available
  const res = sellAtMarket(state, ctx, good.key, available)
  return { ok: true, soldUnits: res.sold, gainedIsk: res.total }
}

/**
 * 玩家指令：购买新舰船（V9 市场版；v17 允许同型多艘）。
 * 市场有现货 → 立即购入入机库（驾驶船空闲时自动登舰；忙时先入机库不登舰）；
 * 无现货 → 自动按市场均衡价挂收购单（到货自动入机库，可撤单）。
 */
export function buyShip(state: GameState, shipId: string, ctx: SimContext): CommandResult {
  const ship = ctx.ships.get(shipId)
  if (!ship) return { ok: false, error: `未知舰船：${shipId}。`, errorId: 'core.industry.019', errorParams: { p1: shipId } }
  const good = marketGoodOf(ctx, 'ship', shipId)
  if (!good) return { ok: false, error: `${ship.name} 不通过市场流通（仅可制造）。`, errorId: 'core.industry.020', errorParams: { p1: ship.name } }
  // 只收不卖（2026-09-09 船长定「蓝图船成品现货下架」：独角鲸/鲸王；2026-09-11 甲裁决补皇带鱼）：
  // 市场页本就有通用「只收不卖」禁买；此处给出**准确原因**，避免落到"挂收购单失败（余额不足…）"的误导文案
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
      // 远程购船只入机库；buyAtMarket已记交易日志，不自动换驾驶。
      return { ok: true }
    }
  }
  // 市场暂无现货：挂收购单（均衡供应价 ×1.1 保证到货即成交优先）
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

/** 舰船收购估价：簿上有价用簿价 ×1.02；否则按均衡供应价 */
function estimateShipBid(state: GameState, ctx: SimContext, goodKey: string): number {
  const quote = marketQuote(state, ctx, goodKey)
  if (quote.sell !== undefined) return ceilFinalQuantity(quote.sell * 1.02)
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return Math.round(1e9)
  return ceilFinalQuantity(def.basePrice * 1.06 * 1.02)
}

/** 兼容旧导出名：旧版单源卖（全部从货仓卖） */
export function sellAll(state: GameState, itemId: string, ctx: SimContext): SellResult {
  return sellCargoItem(state, itemId, ctx)
}
