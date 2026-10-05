/** 玩家合并组用count，敌主武器用gunCount；伤害字段均仍为该组总伤。 */
export function volleyGunCountOf(weapon: { count?: number; gunCount?: number }): number {
  const count = weapon.gunCount ?? weapon.count ?? 1
  return Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1
}

/** 先分整数、余数前置；小数尾差放最后一门，确保分摊总量守恒。 */
export function volleyDamageShareOf(total: number, count: number, index: number): number {
  if (count <= 1) return total
  const whole = Math.floor(total)
  return Math.floor(whole / count) + (index < whole % count ? 1 : 0) + (index === count - 1 ? total - whole : 0)
}
