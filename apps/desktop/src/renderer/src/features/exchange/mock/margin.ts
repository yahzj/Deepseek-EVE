/**
 * 逐仓保证金与强平（原型）——公式照 `docs/design/stock-exchange-backend-spec-20261103.md` §6.1。
 *
 * 全部是纯函数：Mock 只负责把价格喂进来，判定与数字都在这里算。
 * 为什么单独抽文件：强平是这套玩法最容易被"感觉不对"投诉的地方，公式集中一处才好对照文档改。
 */

/** 维持保证金系数：MM = 0.6 × IM */
export const MAINTENANCE_FACTOR = 0.6
/** 每拍最多平掉的仓位比例（分片强平，避免一瞬间把盘口打穿） */
export const LIQUIDATION_SLICE_RATIO = 0.3

export type PositionSide = 'long' | 'short'

/** 初始保证金率 IM = 1/L */
export function initialMarginRate(leverage: number): number {
  return 1 / Math.max(1, leverage)
}

/** 维持保证金率 MM = 0.6 × IM */
export function maintenanceMarginRate(leverage: number): number {
  return (MAINTENANCE_FACTOR * initialMarginRate(leverage))
}

/**
 * 强平价：
 * - 多：P_liq = P_e × (1 − 1/L) / (1 − MM)
 * - 空：P_liq = P_e × (1 + 1/L) / (1 + MM)
 * 分母 (1 − MM) 恒正（MM 最大 0.3 @2x），不会出现除零。
 */
export function liquidationPrice(side: PositionSide, entry: number, leverage: number): number {
  const L = Math.max(1, leverage)
  const mm = maintenanceMarginRate(L)
  if (side === 'long') return Math.max(0.01, (entry * (1 - 1 / L)) / (1 - mm))
  return Math.max(0.01, (entry * (1 + 1 / L)) / (1 + mm))
}

export function notional(qty: number, price: number): number {
  return qty * price
}

/** 浮动盈亏：多 = (mark − entry) × qty；空相反 */
export function unrealizedPnl(side: PositionSide, entry: number, mark: number, qty: number): number {
  return (mark - entry) * qty * (side === 'long' ? 1 : -1)
}

/** 逐仓权益 = 该仓保证金 + 浮盈（M + PnL） */
export function positionEquity(margin: number, upnl: number): number {
  return margin + upnl
}

/** 强平判据：equity ≤ MM × 名义价值 */
export function isLiquidatable(
  margin: number,
  upnl: number,
  qty: number,
  mark: number,
  leverage: number,
): boolean {
  if (qty <= 0) return false
  const mm = maintenanceMarginRate(leverage)
  return positionEquity(margin, upnl) <= mm * notional(qty, mark)
}

/** 距离强平还差百分之几（正数；多单看下方，空单看上方） */
export function liquidationDistancePct(side: PositionSide, mark: number, liqPrice: number): number {
  if (mark <= 0) return 0
  const diff = side === 'long' ? (mark - liqPrice) / mark : (liqPrice - mark) / mark
  return Math.max(0, diff * 100)
}

/**
 * 给定可用保证金最多能开多少股（向下取整；界面「按上限最多可开 N 股」用）。
 * `feeRate` 必须传：只按保证金算的话，按建议值下单会差一笔手续费被拒，等于给了个错数字。
 */
export function maxOpenQty(availableMargin: number, leverage: number, price: number, feeRate = 0): number {
  if (price <= 0 || leverage <= 0) return 0
  return Math.max(0, Math.floor(availableMargin / (price * (1 / leverage + feeRate))))
}

/** 开仓所需保证金 = 名义 / 杠杆 */
export function marginFor(qty: number, price: number, leverage: number): number {
  return notional(qty, price) / Math.max(1, leverage)
}

/** 分片强平：每拍最多平 30%，至少 1 股 */
export function liquidationSliceQty(qty: number): number {
  return Math.min(qty, Math.max(1, Math.floor(qty * LIQUIDATION_SLICE_RATIO)))
}
