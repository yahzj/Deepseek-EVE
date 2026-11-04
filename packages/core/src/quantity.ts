/** 船长2026-10-18确认：最终整数数量向上取整，比例和连续累计不在此处处理。 */
export function ceilFinalQuantity(value: number): number {
  if (!Number.isFinite(value)) return value
  const nearest = Math.round(value)
  const tolerance = Math.min(1e-8, Number.EPSILON * Math.max(1, Math.abs(value)) * 4)
  const quantity = nearest !== 0 && Math.abs(value - nearest) <= tolerance ? nearest : Math.ceil(value)
  return quantity === 0 ? 0 : quantity
}
