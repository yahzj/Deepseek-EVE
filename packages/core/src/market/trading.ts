import { ceilFinalQuantity } from '../quantity'
import { bumpFirst } from '../firstTasks'
import { addLog } from '../state'
import type { GameState } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { consumeLimitedSupply, limitedSupplyAvailable } from '../marketLimitedSupply'
import { ensureMarket } from './initialize'
import { bumpFirstMarketTrade, goodName } from './labels'
import { sellStandingMult, marketSellSkillMult, netAfterTax, levelOf } from './pricing'
import { pushSellOrder, placeBuyOrder } from './orders'
import { goodLockedReason, bmGateLocked, marketGoodOf } from './access'
import { depositGood } from './stock'
import { marketQuote } from './view'

export function sellAtMarket(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  qty: number,
): { sold: number; total: number; avg: number; remaining: number } {
  ensureMarket(state, ctx)
  const mk = state.market
  const def = ctx.marketGoods.get(goodKey)
  if (!def || qty <= 0) return { sold: 0, total: 0, avg: 0, remaining: qty }
  let remaining = qty
  let total = 0
  const fillPrices: number[] = []
  const buyList = mk.npcBuy[goodKey] ?? []
  const sorted = [...buyList].sort((a, b) => b.price - a.price)
  for (const npc of sorted) {
    if (remaining <= 0) break
    const take = Math.min(remaining, npc.qty)
    const idx = buyList.indexOf(npc)
    if (idx < 0) continue
    total += take * npc.price
    fillPrices.push(npc.price)
    remaining -= take
    npc.qty -= take
    if (npc.qty <= 0) buyList.splice(idx, 1)
  }
  const sold = qty - remaining
  /**
   * 「第一次挂单销售」的判据（**2026-09-22 船长令**：**直接市价卖出也算完成**）——
   * 只在真的卖掉了才记（`sold > 0`）；下面那条"余量转挂单"走的是私有 `pushSellOrder`，不重复计。
   */
  if (sold > 0) bumpFirstMarketTrade(state)
  const mult = sellStandingMult(state, def) * marketSellSkillMult(state, def.kind) // 声望加成 × 卖出技能加成
  const gross = ceilFinalQuantity(total * mult) // 毛额
  const net = netAfterTax(state, ctx, gross) // 税后净入账
  const tax = gross - net
  state.wallet.isk += net
  // 市场链（2026-09-18 船长：「挂单按照市场交易收入计数」·「按税后算」）：卖出入账即累计
  bumpFirst(state, 'marketIncome', net)
  state.escrowItems[goodKey] = Math.max(0, (state.escrowItems[goodKey] ?? 0) - sold)
  const pool = mk.pools[goodKey]
  if (pool) {
    pool.netVol -= sold
    if (def.poolTarget && def.poolTarget > 0) pool.q += sold
  }
  if (sold > 0) {
    const text =
      `市价售出 ${goodName(ctx, goodKey)}×${sold.toLocaleString('zh-CN')}（税后入账 ${net.toLocaleString('zh-CN')} 信用点，${fillPrices.length} 笔）` +
      `${mult > 1 ? '（含协会声望加成）' : ''}${tax > 0 ? `，贸易税 ${tax.toLocaleString('zh-CN')} 信用点` : ''}。`
    const params = {
      p1: goodName(ctx, goodKey),
      p2: sold.toLocaleString('zh-CN'),
      p3: net.toLocaleString('zh-CN'),
      p4: fillPrices.length.toLocaleString('zh-CN'),
    }
    const id = mult > 1 ? 'core.market.038' : 'core.market.040'
    /**
     * 尾巴槽（`core.market.040/038` 的 `{p5}`）：`p5Id` 给这一槽的 id、`p5p1` 给槽内参数。
     *
     * ⚠ 2026-09-20 实障修正：此前写成 `p1Id: 'core.market.037', p1p1: 税额`——**槽号写错了**
     * （`p1` 早已是商品名），于是渲染层把税注顶进 `{p1}`、商品名丢失、`{p5}` 漏出未替换。
     * `core.market.037` 是**尾段**模板（「，贸易税 {p1} 信用点」），要挂在 `{p5}` 这一槽上。
     * 同理 `core.market.038` 的声望加成已写进模板正文，这里只补贸易税。
     */
    if (tax > 0) addLog(state, 'trade', text, id, { ...params, p5Id: 'core.market.037', p5p1: tax.toLocaleString('zh-CN') })
    else addLog(state, 'trade', text, id, params)
  }
  if (remaining > 0 && sold > 0) {
    const edge = fillPrices[fillPrices.length - 1]!
    // 剩余自动按边际价挂限价卖单（货已在 escrow 中，不再重复锁定；挂单不收费）
    pushSellOrder(state, goodKey, edge, remaining)
    addLog(
      state,
      'trade',
      `市价单成交 ${sold.toLocaleString('zh-CN')} 后簿已吃穿，剩余 ${remaining.toLocaleString('zh-CN')} 自动挂限价卖单（免费）。`,
      'core.market.022',
      { p1: sold.toLocaleString('zh-CN'), p2: remaining.toLocaleString('zh-CN') },
    )
  } else if (remaining > 0) {
    addLog(state, 'trade', '市场收购簿为空，暂时无人收购——可挂限价卖单等收购单浮现。', 'core.market.019')
  }
  return { sold, total: net, avg: sold > 0 ? Math.round(net / sold) : 0, remaining }
}

/** 市价买入：立即吃 npcSell 簿；簿吃穿后提示改挂限价单。受声望门槛商品直接拒绝（空手返回）。
 * shipUid：本次成交（kind=ship 商品）最后入队的一艘舰船实例 uid（购买流程"买完即登舰"用；非船商品为 null）
 *
 * **2026-09-11 船长实测反馈修复**：「市场订单有货时点市价买入，报『供应簿只剩 0 件』、无法购买」——
 * 根因是本函数里三条**静默** `break/continue`（钱包不够 / 暗市闸跳单 / 只收不卖）最终都表现为 `bought = 0`，
 * 而界面把 `bought < qty` 一律解释成"没现货"。现补 `blocked` 原因字段：
 *   `'no-stock'`（供应簿确实没有可吃单；含**部分成交**后的吃穿）· `'insufficient-isk'`（钱包连最低一张都不够）
 *   · `'standing'`（声望锁：含 `standingReq` 硬锁与 `bmStanding` 暗市闸——**对玩家一律按声望锁口径措辞**）
 *   · `'not-buyable'`（只收不卖）。
 * `bought > 0` 时调用方应报"成交了多少"，不要再报"无法购买"。 */
export function buyAtMarket(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  qty: number,
): {
  bought: number
  total: number
  avg: number
  remaining: number
  shipUid: string | null
  /** bought < qty 时的原因（bought = qty 时不返回） */
  blocked?: 'no-stock' | 'insufficient-isk' | 'standing' | 'not-buyable'
} {
  ensureMarket(state, ctx)
  const mk = state.market
  const def = ctx.marketGoods.get(goodKey)
  if (!def || qty <= 0) return { bought: 0, total: 0, avg: 0, remaining: qty, shipUid: null, blocked: 'no-stock' }
  if (goodLockedReason(state, def) !== null) {
    return { bought: 0, total: 0, avg: 0, remaining: qty, shipUid: null, blocked: 'standing' }
  }
  if (def.playerBuyable === false) {
    return { bought: 0, total: 0, avg: 0, remaining: qty, shipUid: null, blocked: 'not-buyable' } // 只收不卖（残骸等）
  }
  // P2 暗市闸：声望未达时只能吃暗市单（bm 标记），常驻单跳过
  const bmLock = bmGateLocked(state, def)
  let remaining = qty
  let total = 0
  let shipUid: string | null = null
  let blocked: 'no-stock' | 'insufficient-isk' | 'standing' | undefined =
    (mk.npcSell[goodKey] ?? []).length === 0 ? 'no-stock' : undefined
  const sellList = mk.npcSell[goodKey] ?? []
  const sorted = [...sellList].sort((a, b) => a.price - b.price)
  for (const npc of sorted) {
    if (remaining <= 0) break
    if (bmLock && !npc.bm) {
      blocked = 'standing' // 单子在、但被声望闸跳过——不能报"没货"
      continue
    }
    const take = Math.min(remaining, npc.qty, limitedSupplyAvailable(mk.pools[goodKey], def))
    if (take <= 0) break
    const value = take * npc.price
    if (state.wallet.isk < value) {
      blocked = 'insufficient-isk' // 钱不够——同样不能报"没货"
      break
    }
    const idx = sellList.indexOf(npc)
    if (idx < 0) continue
    state.wallet.isk -= value
    consumeLimitedSupply(mk.pools[goodKey], def, take, state.gameMs)
    total += value
    remaining -= take
    const depUid = depositGood(state, ctx, goodKey, take)
    if (depUid) shipUid = depUid
    npc.qty -= take
    if (npc.qty <= 0) sellList.splice(idx, 1)
  }
  const bought = qty - remaining
  // 「第一次挂单销售」的判据（**2026-09-22 船长令**：**直接市价买入也算完成**）——真买到才记
  if (bought > 0) bumpFirstMarketTrade(state)
  const pool = mk.pools[goodKey]
  if (pool) {
    pool.netVol += bought
    if (def.poolTarget && def.poolTarget > 0) pool.q = Math.max(0, pool.q - bought)
  }
  if (bought > 0) {
    addLog(
      state,
      'trade',
      `市价购入 ${goodName(ctx, goodKey)}×${bought.toLocaleString('zh-CN')}（${total.toLocaleString('zh-CN')} 信用点）。`,
      'core.market.023',
      { p1: goodName(ctx, goodKey), p2: bought.toLocaleString('zh-CN'), p3: total.toLocaleString('zh-CN') },
    )
  }
  if (remaining > 0) {
    if (bmLock && bought === 0) {
      addLog(state, 'trade', `常驻供应待「深空工业协会」声望 ${def.bmStanding} 解锁。`, 'core.market.020', {
        p1: def.bmStanding ?? 0,
      })
    } else {
      addLog(
        state,
        'trade',
        `市价买入成交 ${bought.toLocaleString('zh-CN')} 后供应簿吃穿，剩余 ${remaining.toLocaleString('zh-CN')}——可稍等补给或挂限价买单。`,
        'core.market.024',
        { p1: bought.toLocaleString('zh-CN'), p2: remaining.toLocaleString('zh-CN') },
      )
    }
  }
  // 部分成交（bought > 0 但没买满）⇒ 原因归"吃穿"；一件没买到 ⇒ 报精准原因
  const reason = bought >= qty ? undefined : bought > 0 ? 'no-stock' : (blocked ?? 'no-stock')
  return { bought, total, avg: bought > 0 ? Math.round(total / bought) : 0, remaining, shipUid, ...(reason ? { blocked: reason } : {}) }
}

/**
 * **玩家指令：购买基础 AI 核心**（V9：市场供应簿按市价买入；无现货自动挂收购单）。
 *
 * **2026-10-02 破环搬家**：本函数原住 `ai.ts`，是 ai→market 那条运行期环的唯一一条边
 * （ai.ts 为"买核心"借 market 的五个交易函数）；它本质是一笔**市场交易**，搬到 market 侧后
 * ai.ts 不再依赖 market ⇒ 环断开（行为逐字不变，错误 id `core.ai.001/002/009/010` 原样保留）。
 */
export function buyBasicAiCore(state: GameState, ctx: SimContext): CommandResult {
  const good = marketGoodOf(ctx, 'aicore', 'basic')
  if (!good) return { ok: false, error: '基础 AI 核心暂未在市场流通。', errorId: 'core.ai.001' }
  const quote = marketQuote(state, ctx, good.key)
  const ask = quote.sell ?? ceilFinalQuantity(levelOf(state, ctx, good.key) * 1.06)
  if (state.wallet.isk < ask) {
    return {
      ok: false,
      error: `信用点不足：基础 AI 核心约 ${ask.toLocaleString('zh-CN')} 信用点（现有 ${state.wallet.isk.toLocaleString('zh-CN')}）。`,
      errorId: 'core.market.047',
      errorParams: { p1: ask.toLocaleString('zh-CN'), p2: state.wallet.isk.toLocaleString('zh-CN') },
    }
  }
  if (quote.sell !== undefined) {
    const res = buyAtMarket(state, ctx, good.key, 1)
    if (res.bought > 0) {
      addLog(
        state,
        'trade',
        `已购入 基础 AI 核心（市场价 ${res.total.toLocaleString('zh-CN')} 信用点）。AI 核心 = 你的分身，可指派给闲置舰船。`,
        'core.ai.009',
        { p1: res.total.toLocaleString('zh-CN') },
      )
      return { ok: true }
    }
  }
  // 供应簿瞬时吃穿：挂收购单（到货自动入核心库）
  const order = placeBuyOrder(state, ctx, good.key, ask, 1)
  if (!order) return { ok: false, error: '挂收购单失败（钱包余额不足或订单无法成立）。', errorId: 'core.ai.002' }
  addLog(
    state,
    'trade',
    `基础 AI 核心供应簿暂时被买空——已自动挂收购单 @ ${order.price.toLocaleString('zh-CN')} 信用点，到货自动入核心库（可随时撤销）。`,
    'core.ai.010',
    { p1: order.price.toLocaleString('zh-CN') },
  )
  return { ok: true }
}
