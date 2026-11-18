
export const MAINTENANCE_FACTOR = 0.6
export const LIQUIDATION_SLICE_RATIO = 0.3

export type PositionSide = 'long' | 'short'

export function initialMarginRate(leverage: number): number {
  return 1 / Math.max(1, leverage)
}

export function maintenanceMarginRate(leverage: number): number {
  return (MAINTENANCE_FACTOR * initialMarginRate(leverage))
}

export function liquidationPrice(side: PositionSide, entry: number, leverage: number): number {
  const L = Math.max(1, leverage)
  const mm = maintenanceMarginRate(L)
  if (side === 'long') return Math.max(0.01, (entry * (1 - 1 / L)) / (1 - mm))
  return Math.max(0.01, (entry * (1 + 1 / L)) / (1 + mm))
}

export function notional(qty: number, price: number): number {
  return qty * price
}

export function unrealizedPnl(side: PositionSide, entry: number, mark: number, qty: number): number {
  return (mark - entry) * qty * (side === 'long' ? 1 : -1)
}

export function positionEquity(margin: number, upnl: number): number {
  return margin + upnl
}

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

export function liquidationDistancePct(side: PositionSide, mark: number, liqPrice: number): number {
  if (mark <= 0) return 0
  const diff = side === 'long' ? (mark - liqPrice) / mark : (liqPrice - mark) / mark
  return Math.max(0, diff * 100)
}

export function maxOpenQty(availableMargin: number, leverage: number, price: number, feeRate = 0): number {
  if (price <= 0 || leverage <= 0) return 0
  return Math.max(0, Math.floor(availableMargin / (price * (1 / leverage + feeRate))))
}

export function marginFor(qty: number, price: number, leverage: number): number {
  return notional(qty, price) / Math.max(1, leverage)
}

export function liquidationSliceQty(qty: number): number {
  return Math.min(qty, Math.max(1, Math.floor(qty * LIQUIDATION_SLICE_RATIO)))
}
