/**
 * 精炼 / 市场出售（V9：卖出并入市场订单簿）/ 舰船购买。
 *
 * 精炼模型（中文说明）：
 * - 矿石原料自动从"当前船货仓 + 物品仓库"合计取用（先货仓后仓库）；
 * - 精炼产物（矿物）直接进入"物品仓库"（货仓不占空间）；
 * - 收率 = 基础 50% + 精炼学 8%/级 + 高级回收 4%/级，上限 95%；
 *   低技能时精炼可能不如直接卖原矿——玩家自行权衡（故意设计）。
 * - 卖出（V9 起）不再有"固定价卖给空间站"：货先锁定进市场 escrow，按 NPC 收购簿
 *   即时市价成交（吃穿簿的剩余自动转限价卖单）；池商品在均衡时收购价 = 基准价，
 *   与旧版空间站收购价一致（波动来自池淤积与冲击动量）；
 * - 舰船购买（V9）：市场有现货立即购得；无现货自动挂收购单（市场有货时自动成交）。
 */
import { addLog } from './state'
import type { CommandResult } from './engine'
import type { GameState } from './state'
import type { SimContext } from './types'
import { addItem, addWare, countItem, countWare, removeItem, removeWare } from './inventory'
import { DSI_FACTION_ID, standingOf } from './expedition'
import { buyAtMarket, goodLockedReason, marketGoodOf, marketQuote, placeBuyOrder, sellAtMarket } from './market'
import { shipDisplayName } from './instances'

/**
 * M4：协会声望贸易加成——声望每 1 点，空间站收购价 +1%，上限 +15%。
 */
export function sellPriceMultiplier(state: GameState): number {
  return 1 + Math.min(0.15, standingOf(state, DSI_FACTION_ID) * 0.01)
}

/** 按当前技能计算精炼收率（0~1） */
export function refineRate(state: GameState, ctx: SimContext): number {
  const bal = ctx.balance.refining
  const level1 = state.skills.trained[bal.rateSkillId] ?? 0
  const level2 = state.skills.trained[bal.secondRateSkillId] ?? 0
  const rate = bal.baseRate + bal.ratePerLevel * level1 + bal.secondRatePerLevel * level2
  return Math.min(bal.maxRate, Math.max(0, rate))
}

/** 精炼结果明细 */
export interface RefineResult {
  ok: boolean
  error?: string
  usedOreUnits: number
  /** 精炼产物：矿物 id -> 数量（入物品仓库） */
  produced: Record<string, number>
  rate: number
}

/** 矿石在"货仓+仓库"的合计数量 */
export function oreAvailable(state: GameState, oreId: string): number {
  return countItem(state, oreId) + countWare(state, oreId)
}

/** 玩家指令：把某种资源（矿石/气体/冰矿）全部精炼（原料从货仓与仓库自动取用，产物进仓库） */
export function refineAllOre(state: GameState, oreId: string, ctx: SimContext): RefineResult {
  const ore = ctx.items.get(oreId)
  if (!ore) {
    return { ok: false, error: `未知物品：${oreId}。`, usedOreUnits: 0, produced: {}, rate: 0 }
  }
  if (!ore.refine || ore.refine.length === 0) {
    return { ok: false, error: `「${ore.name}」没有精炼配方（只支持矿石/气体/冰矿）。`, usedOreUnits: 0, produced: {}, rate: 0 }
  }
  const available = oreAvailable(state, oreId)
  if (available <= 0) {
    return { ok: false, error: `货仓与仓库里都没有 ${ore.name}。`, usedOreUnits: 0, produced: {}, rate: 0 }
  }

  const rate = refineRate(state, ctx)
  const produced: Record<string, number> = {}
  for (const row of ore.refine) {
    const mineral = ctx.items.get(row.mineralId)
    if (!mineral || mineral.kind !== 'mineral') continue
    const units = Math.floor(available * row.perOre * rate)
    if (units > 0) {
      produced[row.mineralId] = units
      addWare(state, row.mineralId, units)
    }
  }

  // 扣原料：先货仓后仓库
  let toTake = available
  const fromCargo = Math.min(countItem(state, oreId), toTake)
  if (fromCargo > 0) {
    removeItem(state, oreId, fromCargo)
    toTake -= fromCargo
  }
  if (toTake > 0) removeWare(state, oreId, toTake)

  if (Object.keys(produced).length === 0) {
    addLog(state, 'warn', `精炼失败：${ore.name}×${available} 未能产出任何矿物（收率过低？）。`)
  } else {
    const detail = Object.entries(produced)
      .map(([id, n]) => `${ctx.items.get(id)?.name ?? id}×${n}`)
      .join('、')
    addLog(
      state,
      'trade',
      `精炼完成：消耗${ore.name}×${available}，产出 ${detail}（已入物品仓库，收率 ${Math.round(rate * 100)}%）。`,
    )
  }
  return { ok: true, usedOreUnits: available, produced, rate }
}

/** 出售结果 */
export interface SellResult {
  ok: boolean
  error?: string
  soldUnits: number
  gainedIsk: number
}

/** 从当前船货仓按市价卖出（矿石主要在此；吃穿簿的剩余自动转限价卖单） */
export function sellCargoItem(state: GameState, itemId: string, ctx: SimContext): SellResult {
  return sellItemFrom(state, itemId, countItem(state, itemId), (units) => removeItem(state, itemId, units), ctx, '货仓')
}

/** 从物品仓库按市价卖出（矿物/存仓矿石在此） */
export function sellWareItem(state: GameState, itemId: string, ctx: SimContext): SellResult {
  return sellItemFrom(state, itemId, countWare(state, itemId), (units) => removeWare(state, itemId, units), ctx, '仓库')
}

function sellItemFrom(
  state: GameState,
  itemId: string,
  available: number,
  remove: (units: number) => boolean,
  ctx: SimContext,
  sourceName: string,
): SellResult {
  const def = ctx.items.get(itemId)
  if (!def) return { ok: false, error: `未知物品：${itemId}`, soldUnits: 0, gainedIsk: 0 }
  if (available <= 0) {
    return { ok: false, error: `${sourceName}里没有 ${def.name}。`, soldUnits: 0, gainedIsk: 0 }
  }
  const good = marketGoodOf(ctx, 'item', itemId)
  if (!good) return { ok: false, error: `${def.name} 不在市场流通目录中，无法出售。`, soldUnits: 0, gainedIsk: 0 }
  if (good.playerSellable === false) {
    return { ok: false, error: `${def.name} 暂不支持玩家出售。`, soldUnits: 0, gainedIsk: 0 }
  }
  if (!remove(available)) return { ok: false, error: '取出物品失败。', soldUnits: 0, gainedIsk: 0 }
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
  if (!ship) return { ok: false, error: `未知舰船：${shipId}。` }
  const good = marketGoodOf(ctx, 'ship', shipId)
  if (!good) return { ok: false, error: `${ship.name} 不通过市场流通（仅可制造）。` }
  const lock = goodLockedReason(state, good)
  if (lock) return { ok: false, error: `${ship.name} 暂不可购买：${lock}。` }
  const quote = marketQuote(state, ctx, good.key)
  const ask = quote.sell
  if (ask !== undefined) {
    if (state.wallet.isk < ask) {
      return { ok: false, error: `ISK 不足：${ship.name} 市场价约 ${ask.toLocaleString('zh-CN')} ISK（现有 ${state.wallet.isk.toLocaleString('zh-CN')}）。` }
    }
    const res = buyAtMarket(state, ctx, good.key, 1)
    const uid = res.bought > 0 ? res.shipUid : null
    if (uid) {
      // v17：登舰前检查驾驶船是否空闲（忙时先入机库，改舰船页切换，避免打断作业）
      const pilotFree =
        state.awayGalaxy === null &&
        !state.transit.active &&
        !state.expedition.active &&
        !state.scanning.active &&
        !state.mining.active
      if (pilotFree) {
        state.shipId = uid
        addLog(state, 'trade', `已购入 ${shipDisplayName(state, ctx, uid)}（市场价 ${res.total.toLocaleString('zh-CN')} ISK）并登舰。`)
      } else {
        addLog(state, 'trade', `已购入 ${shipDisplayName(state, ctx, uid)}（市场价 ${res.total.toLocaleString('zh-CN')} ISK）——驾驶船正在作业，新船已入机库待命（可稍后在舰船页切换驾驶）。`)
      }
      return { ok: true }
    }
  }
  // 市场暂无现货：挂收购单（均衡供应价 ×1.1 保证到货即成交优先）
  const est = estimateShipBid(state, ctx, good.key)
  if (state.wallet.isk < est) {
    return { ok: false, error: `ISK 不足：${ship.name} 收购挂单约 ${est.toLocaleString('zh-CN')} ISK。` }
  }
  const order = placeBuyOrder(state, ctx, good.key, est, 1)
  if (!order) return { ok: false, error: '挂收购单失败（钱包或参数异常）。' }
  addLog(state, 'trade', `${ship.name} 市场暂无现货——已自动挂收购单 @ ${order.price.toLocaleString('zh-CN')} ISK，到货自动停入机库（可随时撤销）。`)
  return { ok: true }
}

/** 舰船收购估价：簿上有价用簿价 ×1.02；否则按均衡供应价 */
function estimateShipBid(state: GameState, ctx: SimContext, goodKey: string): number {
  const quote = marketQuote(state, ctx, goodKey)
  if (quote.sell !== undefined) return Math.round(quote.sell * 1.02)
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return Math.round(1e9)
  return Math.round(def.basePrice * 1.06 * 1.02)
}

/** 兼容旧导出名：旧版单源卖（全部从货仓卖） */
export function sellAll(state: GameState, itemId: string, ctx: SimContext): SellResult {
  return sellCargoItem(state, itemId, ctx)
}
