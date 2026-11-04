import { ceilFinalQuantity } from '../quantity'
import { addLog } from '../state'
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { shipStoredCount } from '../fleetBook'
import { marketGoodOf, playerTradingGood } from './access'
import { relayAvailableQty, relayTradable } from './relayLedger'
import { sellStoredShipAtMarket, pushStoredShipSellOrder } from './ships'
import { naturalHoldings, lockNaturalStock, unlockNaturalStock } from './stock'
import { sellAtMarket } from './trading'
import { sellStandingMult, marketSellSkillMult, netAfterTax } from './pricing'
import { crossOnPlacement } from './matching'
import { goodName, bumpFirstMarketTrade, placeOrderLogText } from './labels'
import { pushSellOrder } from './orders'

/** 学习蓝图（消耗 1 本 → 永久学会；重复蓝图只能放市场交易）
 *  ⚠ **一次性图纸不可学习**（2026-09-12 船长：「既玩家无法学会，只能制造一次」）——
 *  它只能拿到组装机去造一次（开工时消耗，见 `manufacturing.startManufacturing`）。 */
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
    if (marketGoodOf(ctx, 'blueprint', blueprintId)?.playerSellable === false) {
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

/** 市价卖出持有的商品（市场页用）：自动从"自然库存"取货（物品→物品仓库、装备→装备库、
 * 蓝图→蓝图书架、AI 核心→核心库闲置数）；数量省略 = 全卖。
 *  ⚠ 舰船**不走这里**（自然库存对舰船恒 0）：2026-09-14 起固定指路舰船页「舰船仓库」
 *  （`sellStoredShipAtMarket`）；舰队实例版 `sellShipAtMarket` 自同日起没有界面入口。 */
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
    // 2026-09-14 船长报障「市场依旧无法挂单或者直接出售舰船」⇒ 卖出侧对舰船放行：
    // **可卖 = 舰船仓库里的艘数**（机库里的船要先在舰船页移入仓库），走仓库出售单点
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
  // 收购簿为空 → 一笔未成交：退还锁定货物（此前会被锁进 escrow 且无订单，货物永久丢失——船长 2026-09-05 验证发现）
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

/**
 * 市价卖出预览（只读，不改任何状态；船长 2026-09-05：全部卖出前需向玩家展示实际成交与到账）：
 * 与 sellAtMarket 同源模拟——按收购簿出价从高到低逐单吃到簿穿/数量尽；
 * 返回可成交件数、成交毛额、贸易税、税后净到账与剩余（剩余将自动挂限价卖单，不计入本次到账）。
 */
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
  // 舰船（2026-09-14 船长报障后放行）：可卖 = 舰船仓库艘数；估价口径与「市价卖出」逐条同源
  // （成交走 settleSell ⇒ **只有声望加成、无营销学加成**，故这里也不乘 marketSellSkillMult）
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

/** 挂限价卖单（市场页用）：从自然库存锁定货入 escrow 后挂单；撤单自动退回原库存 */
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
  if (price <= 0 || price > def.basePrice * ctx.balance.market.maxPriceRatio) {
    return { ok: false, error: '挂单价异常（需为 0 以上的信用点，且不超过限价上限）。', errorId: 'core.market.012' }
  }
  const n = Math.min(want, available)
  if (isShip) {
    // 舰船：**一艘一单**（escrow 一条只托一艘船 ⇒ 撤单退回仓库时粒度清楚；「我的挂单」里也是一艘一行）
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
    // 「第一次挂单销售」的判据落点——整船挂单也是一次"挂出卖单"，且界面路径不经过 `placeSellOrder`
    // ⇒ 在这里记一笔（2026-09-22 船长令后：挂买单 / 市价买卖同样算，见 `bumpFirstMarketTrade`）。
    bumpFirstMarketTrade(state)
    return { ok: true, orderId: lastId, price: ceilFinalQuantity(price), filled, resting }
  }
  if (!lockNaturalStock(state, def, n)) return { ok: false, error: '取货失败。', errorId: 'core.market.009' }
  const order = pushSellOrder(state, goodKey, price, n)
  // 挂单瞬间先吃簿（2026-09-10 船长定）：与现有收购单对冲的部分立即成交，剩余才挂着
  const r = crossOnPlacement(state, ctx, order)
  /**
   * **「第一次挂单销售」的判据落点（2026-09-20 玩家报障「第一次挂单销售任务无法完成」）**：
   * 本函数是**界面上唯一**的"挂出卖单"入口（市场页「挂卖单」→ `engine.placeSellOrderAt` → 这里），
   * 而它走的是 `pushSellOrder` 这条路、**不经过 `placeSellOrder`** ⇒ 原先只有 `placeSellOrder` 里那记
   * `bumpFirst(state,'orders')`，界面挂单**永远不计数**（工具与用例都直接调 `placeSellOrder`，所以一直没被发现）。
   * 两条路各自记账、互不重复：`placeSellOrder`（core API / 工具）＋ 本函数（界面）；
   * 舰船那条分支同上。**2026-09-22 船长令**后统一走 `bumpFirstMarketTrade`（挂买单 / 市价买卖也算）。
   */
  bumpFirstMarketTrade(state)
  addLog(state, 'trade', placeOrderLogText(ctx, 'sell', goodKey, order.price, n, r))
  return { ok: true, orderId: order.id, price: order.price, filled: r.filled, resting: r.resting }
}
