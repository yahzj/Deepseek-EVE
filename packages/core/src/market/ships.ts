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

/** 舰船是否可出售：在机库、非驾驶中、无 AI 任务、未锁定、不在换船善后返航中、货仓空、无装配 */
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
  /**
   * ⚠ **顺序说明**（**2026-10-02**）：「正在返航」这一条**移到"装备/货载"之后**——
   * 先报玩家**自己就能立刻解决**的那一条（卸模块 / 清货仓），再报"得等它飞回来"那一条。
   * 原顺序把返航拦在最前 ⇒ "装着模块 ＋ 正在返航"时只说返航，玩家卸完模块才发现还得等。
   */
  if (shipInReturn(state, shipId)) return { ok: false, reason: '该船正在返航卸货（换船善后），到港后才能出售。' }
  // 舰船插件（船长 2026-09-26：「装有插件的舰船……也不能挂卖」）——与入仓共用同一判据单点
  const plugBlock = plugBlockReasonOf(state, shipId)
  if (plugBlock) return { ok: false, reason: plugBlock.text }
  return { ok: true }
}

/**
 * 舰船市价出售：校验 → 移出舰队（escrow）→ 立即吃收购簿。
 * 若簿瞬时空 → 转为限价挂单（免费；撤单可退回机库）。
 * 返回 total = 税后净入账。
 */
export function sellShipAtMarket(state: GameState, ctx: SimContext, shipId: string): { ok: boolean; total?: number; reason?: string } {
  // **进洞船只所有行为锁定**（船长 2026-09-13：锁，进洞船只所有行为都锁定。包括维修。）
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
  // 估价：当前收购价；无收购单时按均衡收购价 ×0.98 作为挂单价
  const est = bestBuyPrice ?? ceilFinalQuantity(buyPrice(def, priceLevel(state, ctx, def, def.poolTarget ?? 0)) * 0.98)
  const order = placeShipSellOrder(state, ctx, shipId, est)
  if (!order) return { ok: false, reason: '无法挂单：请检查船的状态。' }
  // 立即撮合一轮（只可能吃掉刚挂上的这单 → 成交或留在簿上）
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

/** 把整船挂上限价卖单（escrow 锁船；撤单退回机库并保留耐久/自定义名） */
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
  // ⚠ **不写 `from`**：缺省即 `'fleet'`（只有从舰船仓库卖出的那批才标 `'store'`）——
  // 这样老档与新档的舰队实例托管快照形状逐字一致（`tests/t5b.test.ts` 的 toEqual 钉着它）。
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
  // 二手舰船同样先吃簿（2026-09-10 船长定：买卖两侧对称）
  const r = crossOnPlacement(state, ctx, order)
  // 「第一次挂单销售」的判据（2026-09-22 船长令：整船挂卖单也算；`sellShipAtMarket` 也走本函数 ⇒ 只记一次）
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

/* ═══════════════ 舰船仓库出售（2026-09-14 船长：「舰船仓库是用于方便市场出售舰船的」） ═══════════════
 * 与舰队实例出售（`sellShipAtMarket`）的差别只有一条：货从**舰船仓库的计数**里扣（不是某个实例），
 * 托管记录标 `from: 'store'` ⇒ **撤单退回仓库**而不是机库。定价/撮合/税/吃簿口径**逐字沿用**：
 * 估价 = 当前收购价；无收购单时按均衡收购价 ×0.98 挂限价卖单；挂单免费；成交额照收贸易税。 */

/**
 * 把舰船仓库里的 1 艘挂上限价卖单（escrow 快照 = 全新船：耐久 1、无名；撤单退回仓库）。
 * 返回 null = 库存不足 / 不在市场目录 / 价格非法。**不撮合、不打日志**（调用方自己来，便于合并回执）。
 */
export function pushStoredShipSellOrder(state: GameState, ctx: SimContext, defId: string, price: number): PlayerOrder | null {
  if (shipStoredCount(state, defId) <= 0 || price <= 0) return null
  const def = [...ctx.marketGoods.values()].find((g) => g.kind === 'ship' && g.refId === defId)
  if (!def) return null
  // 扣仓（计数到 0 就删键，与 blueprintStock 同款写法）
  state.shipStore = state.shipStore ?? {}
  const left = shipStoredCount(state, defId) - 1
  if (left > 0) state.shipStore[defId] = left
  else delete state.shipStore[defId]
  const order = pushSellOrder(state, def.key, price, 1)
  // shipId 是**合成键**（仓库船没有实例）：`<船型>#store-<单号>`，`allocateShipUid` 解析不出号 ⇒ 不占号段
  state.escrowShips[order.id] = {
    shipId: `${defId}#store-${order.id}`,
    defId,
    durability: 1,
    customName: null,
    from: 'store',
  }
  return order
}

/** 把舰船仓库里的 1 艘挂上限价卖单（公开单点：先撮合、后写回执） */
export function placeStoredShipSellOrder(
  state: GameState,
  ctx: SimContext,
  defId: string,
  price: number,
): PlayerOrder | null {
  const display = ctx.ships.get(defId)?.name ?? defId
  const order = pushStoredShipSellOrder(state, ctx, defId, price)
  if (!order) return null
  // 「第一次挂单销售」的判据（2026-09-22 船长令：舰船仓库挂卖单也算）
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

/**
 * 舰船仓库**市价出售**（市场页「市价卖出」/「全部卖出」与舰船仓库「出售 1 艘」共用）：
 * 逐艘挂限价卖单（按当前收购价；无收购单时按均衡收购价 ×0.98）→ 每挂一单立即撮合一轮
 * ⇒ 吃收购簿的部分即时成交，其余留在簿上（**撤单退回舰船仓库**）。
 * 返回 `filled`（即时成交艘数）· `total`（即时成交的**税后**净入账，一艘都没成交则不返回）· `resting`（留簿艘数）。
 */
export function sellStoredShipAtMarket(
  state: GameState,
  ctx: SimContext,
  defId: string,
  qty = 1,
): {
  ok: boolean
  total?: number
  reason?: string
  /** 本地化 id（界面优先用它取当前语言，缺省回退 `reason` 原文） */
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
      net += netAfterTax(state, ctx, order.filled * order.price) // 与入账同源（逐单取整，逐分不差）
    } else {
      resting += order.qty
    }
  }
  // 「第一次挂单销售」的判据（2026-09-22 船长令：整船市价卖出也算）——卖出或挂上了才算一笔
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
