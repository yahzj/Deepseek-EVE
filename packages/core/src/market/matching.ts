import { ceilFinalQuantity } from '../quantity'
import type { GameState, PlayerOrder } from '../state'
import type { MarketBalance, MarketGoodDef, SimContext } from '../types'
import { nextRandom } from '../rng'
import { settleSell, settleBuy, settleSnatchSell, settleSnatchBuy, settleStationTake } from './settlement'
import { buyPrice, priceLevel, sellPrice, builtSellBoost } from './pricing'
import { bmGateLocked, goodLockedReason, playerTradingGood } from './access'
import { relayTradable } from './relayLedger'

/** 巡游采购单次件数（2026-09-08 方案 B，船长定：越贴近收购价线惩罚越小——概率衰减之外，
 *  单次件数也随偏离收窄放大，且**与该商品池订单的每窗生成量挂钩**）：
 *  r = 相对价线溢价比例（0.01 = +1%）。
 *  池商品（矿/气/冰/残骸等大宗）：单次 = round(每窗簿量基准 qtyBase × 档位比例)，
 *  档位比例 = 贴线 ≤1% → 0.5、≤3% → 0.25、≤8% → 0.1、更远 → 1 件（下限 1）；
 *  qtyBase = supplyFlow（缺省 = poolTarget/120，与让利吸收 F 同源口径）。
 *  例：氖云气 supplyFlow 45 → 贴线一次 ~23 件（≈平价簿最高档的量），矿石类大池自动同步放大。
 *  单件商品（装备/蓝图等无池）：维持小量 5/3/2/1。任何档位仍远慢于平价簿 + 让利吸收
 *  （期望 ≈ 命中率 ~28% × 单次量，相对平价簿 ≈2.55×supplyFlow/窗）→ 价线纪律与"让利换清仓"保留。 */
export function snatchSellFill(def: MarketGoodDef | undefined, r: number): number {
  const pool = !!def?.poolTarget && (def.poolTarget ?? 0) > 0
  if (!pool) {
    if (r <= 0.01) return 5
    if (r <= 0.03) return 3
    if (r <= 0.08) return 2
    return 1
  }
  const qtyBase = def?.supplyFlow && def.supplyFlow > 0 ? def.supplyFlow : Math.max(1, (def?.poolTarget ?? 0) / 120)
  if (r <= 0.01) return Math.max(1, ceilFinalQuantity(qtyBase * 0.5))
  if (r <= 0.03) return Math.max(1, ceilFinalQuantity(qtyBase * 0.25))
  if (r <= 0.08) return Math.max(1, ceilFinalQuantity(qtyBase * 0.1))
  return 1
}

/* ═══════════ 我的限价单撮合（窗口内） ═══════════ */

/**
 * 吃现有簿面（确定性撮合，与窗口撮合共用同一批结算函数——钱货/税/声望/池/日志同源）：
 * - 卖单：吃「收购价 ≥ 挂价」的收购单（**同价算成交**），成交价 = 挂单价（既有口径不变）；
 * - 买单：吃「供应价 ≤ 挂价」的供应单（**同价算成交**），成交价 = 簿面供应价（玩家不亏）；
 * - 商品已下架（目录外）不撮合（防走 depositGood 空目录分支）。
 * 只吃簿面、**不掷越线抢单骰**——越线（买单低于供应价线 / 卖单高于收购价线）仍归每 60 秒
 * 窗口的概率机制（2026-09-08 船长定），挂单瞬间不额外掷骰。
 */
function eatBook(state: GameState, ctx: SimContext, order: PlayerOrder, atGameMs = state.gameMs): void {
  if (order.qty <= 0) return
  const def = ctx.marketGoods.get(order.good)
  if (!def || !playerTradingGood(ctx, def)) return
  if (order.side === 'sell') {
    const buyList = state.market.npcBuy[order.good] ?? []
    const sorted = [...buyList].sort((a, b) => b.price - a.price)
    for (const npc of sorted) {
      if (order.qty <= 0) break
      if (!relayTradable(state, npc, atGameMs) || (!npc.relay && def.playerSellable === false)) continue
      if (npc.price < order.price) continue
      const idx = buyList.indexOf(npc)
      if (idx < 0) continue
      settleSell(state, ctx, order, npc, Math.min(order.qty, npc.qty), idx)
    }
  } else {
    const sellList = state.market.npcSell[order.good] ?? []
    const sorted = [...sellList].sort((a, b) => a.price - b.price)
    for (const npc of sorted) {
      if (order.qty <= 0) break
      if (!relayTradable(state, npc, atGameMs)) continue
      if (npc.price > order.price) continue
      const idx = sellList.indexOf(npc)
      if (idx < 0) continue
      settleBuy(state, ctx, order, npc, idx, atGameMs)
    }
  }
}

/**
 * 挂单瞬间的簿面核对（2026-09-10 船长定）：与现有簿面对冲（可成交）的挂单**必须立即成交**，
 * 吃剩的数量才作为挂单等待后续窗口（标准限价单语义）；全部即时成交的单直接移出挂单表
 * （不再出现在「我的挂单」，也就不必等下一个窗口清理）。
 * 修复背景：撮合此前只在每 60 秒窗口跑一次，而「挂单买」表单默认预填的正是当前最佳供应价——
 * 玩家挂出与在售卖单同价的买单却不会成交，改单/等窗后簿面还带 ±2% 抖动重铺，常常长期不成交。
 */
export function crossOnPlacement(state: GameState, ctx: SimContext, order: PlayerOrder): { filled: number; resting: number } {
  const before = order.qty
  eatBook(state, ctx, order)
  const filled = before - order.qty
  if (order.qty <= 0) state.orders = state.orders.filter((o) => o !== order)
  return { filled, resting: order.qty }
}

export function matchPlayerOrders(state: GameState, ctx: SimContext, atGameMs = state.gameMs): void {
  const bal = ctx.balance.market
  // 窗口簿面成交计数归零（站内让利吸收按"本窗总吸收 ≥ 配额"补差，见 absorbViaStation）
  for (const o of state.orders) if (o.side === 'sell') o.windowFilled = 0
  for (const order of [...state.orders]) {
    if (order.qty <= 0) continue
    // 簿面撮合（含商品下架防御，见 eatBook）
    eatBook(state, ctx, order, atGameMs)
    if (order.side === 'sell') {
      // 越线抢单（卖出侧，2026-09-08 船长定）：簿吃不掉且挂价高于收购价线 → 巡游采购每窗掷骰；
      // 单次件数随溢价收窄放大（snatchSellFill：池商品贴线一次可收几十件，越远越小）
      if (order.qty > 0) {
        const sdef = ctx.marketGoods.get(order.good)
        if (sdef && sdef.playerSellable !== false) {
          const bid = ceilFinalQuantity(buyPrice(sdef, priceLevel(state, ctx, sdef, state.market.pools[order.good]?.q ?? 0)))
          if (order.price > bid) {
            const r = bid > 0 ? (order.price - bid) / bid : 1
            const pRoll = Math.min(1, bal.snatchSellChance * Math.exp(-bal.snatchSellDecay * r))
            if (nextRandom(state.rng) < pRoll) {
              settleSnatchSell(state, ctx, order, Math.min(order.qty, snatchSellFill(sdef, r)))
            }
          }
        }
      }
    } else {
      // 越线抢单（买入侧）：簿吃不掉且挂价低于供应价线 → 巡游供货每窗掷骰
      if (order.qty > 0) {
        const bdef = ctx.marketGoods.get(order.good)
        if (bdef && bdef.playerBuyable !== false && goodLockedReason(state, bdef) === null && !bmGateLocked(state, bdef)) {
          const Lp = priceLevel(state, ctx, bdef, state.market.pools[order.good]?.q ?? 0)
          // 2026-09-08 船长定（奇货专项·试跑口径，待实测复核）：奇货买侧越线基准 = 20L，
          // 取代供应价线 ≈1L——正常挂单（0.1L~1L）相对 20L 的偏离 s≈95%+，每窗命中率被
          // e^(−14s) 压到 ~3e−7 量级（约数年一见），奇货供给实际回归抽取节拍、不再被低挂
          // 套走，同时保留天文级小概率而非硬禁；稀有/普通仍按供应价线判定。
          const ask = ceilFinalQuantity(bdef.rarity === 'exotic' ? Lp * 20 : sellPrice(bdef, Lp))
          if (order.price < ask) {
            const s = ask > 0 ? (ask - order.price) / ask : 1
            const pRoll = Math.min(1, bal.snatchBuyChance * Math.exp(-bal.snatchBuyDecay * s))
            if (nextRandom(state.rng) < pRoll) settleSnatchBuy(state, ctx, order, atGameMs)
          }
        }
      }
    }
  }
  // 已成交完毕（qty=0）的挂单移出列表（escrow 已交付/船已交割）
  if (state.orders.some((o) => o.qty <= 0)) {
    state.orders = state.orders.filter((o) => o.qty > 0)
  }
}

/* ═══════════ 站内让利吸收（2026-09-08 船长定：吸收量与价格挂钩） ═══════════ */

/** 商品每窗基础吸收额 F（件；覆写优先，缺省按类别推导——船长 2026-09-08 确认口径：
 * 池商品 = supplyFlow（缺省 poolTarget/120）、common 单件 = 1、rare = 0.3、奇货 = 0.1 件/窗） */
function absorbBaseQtyOf(def: MarketGoodDef): number {
  if (def.absorbQtyPerWindow !== undefined) return def.absorbQtyPerWindow
  if (def.poolTarget && def.poolTarget > 0) return def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget / 120))
  if (def.rarity === 'rare') return 0.3
  if (def.rarity === 'exotic') return 0.1
  return 1
}

/** 卖单本窗折价倍率 E：挂价每低于买盘价 1 个百分点放大 absorbPerPoint，absorbMaxMul 封顶。
 * 挂价 ≥ 买盘价 → E = 1（平价仅保底，不额外提速） */
function absorbMulOf(bal: MarketBalance, price: number, buyBid: number): number {
  if (price >= buyBid) return 1
  const pct = ((buyBid - price) / buyBid) * 100
  return Math.min(bal.absorbMaxMul, 1 + bal.absorbPerPoint * pct)
}

/** 站内让利吸收（2026-09-08 船长定：吸收量与价格挂钩；每 60s 窗撮合簿之后执行；export 供测试白盒）。
 * 语义 = 每窗总吸收保底：吃簿不够才站内补差，绝不叠加——
 * 对每张卖单算"当窗配额 F×E"（F = 基础吸收额、E = 折价倍率）；吃簿量 < 配额的部分
 * 计入该单补差结余（小数结转），结余整数部分以挂单价直接卖给站内，余数跨窗结转。
 * 只对挂价 ≤ 现行买盘价的卖单生效（高于买盘价 = 等更高簿价或巡游抢单，站内不接）；买盘价 =
 * buyPrice 价线（池商品 L×档位 / 单件 rarity 档位），随收购档位自动套用。
 * 簿厚（吃簿 ≥ 配额）时当窗只走簿面，站内不额外收——平价常态与现状长期持平，
 * 折价（让利）才把配额拉到 ×E，实现"压价换吞吐、最高 ×5"。
 */
export function absorbViaStation(state: GameState, ctx: SimContext): void {
  const bal = ctx.balance.market
  for (const order of state.orders) {
    if (order.side !== 'sell' || order.qty <= 0) continue
    const def = ctx.marketGoods.get(order.good)
    if (!def || !playerTradingGood(ctx, def)) continue
    const poolQ = state.market.pools[order.good]?.q ?? 0
    const L = priceLevel(state, ctx, def, poolQ)
    const buyBid = ceilFinalQuantity(buyPrice(def, L))
    if (order.price > buyBid) continue // 高于买盘价：等簿价，不累计额度
    const F0 = absorbBaseQtyOf(def)
    // 建站收购扩容（2026-09-09 船长定）：只放大单件商品吸收配额，池商品不乘
    const F = def.poolTarget && def.poolTarget > 0 ? F0 : F0 * builtSellBoost(state, ctx)
    const E = absorbMulOf(bal, order.price, buyBid)
    const bookFill = order.windowFilled ?? 0
    if (bookFill < F * E) {
      // 吃簿不足配额 → 差额进补差结余（小数结转；簿厚的窗口不产生结余也不冲销）
      order.absorbCredit = (order.absorbCredit ?? 0) + (F * E - bookFill)
    }
    const take = Math.min(order.qty, Math.floor((order.absorbCredit ?? 0) + 1e-9))
    if (take <= 0) continue
    settleStationTake(state, ctx, order, take)
    order.absorbCredit = (order.absorbCredit ?? 0) - take
  }
  if (state.orders.some((o) => o.side === 'sell' && o.qty <= 0)) {
    state.orders = state.orders.filter((o) => o.qty > 0)
  }
}
