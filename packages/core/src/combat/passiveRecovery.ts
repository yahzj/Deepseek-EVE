import { SHIELD_REGEN_FLOOR_PCT } from './combatRepair'

/** 当前盾按容量比例映射到速率基准；旗舰的卡面基准与共享池容量各自独立。 */
export function passiveShieldRateOf(current: number, max: number, perSec = 0.012, multiplier = 1, cap = max): number {
  if (current <= 0 || max <= 0 || cap <= 0 || perSec <= 0) return 0
  return Math.max(current / cap * max * perSec, max * SHIELD_REGEN_FLOOR_PCT) * Math.max(0, multiplier)
}

/** 恒定承伤下的破盾时间：先走当前盾比例段，再走满盾托底段；零盾不恢复。 */
export function passiveShieldBreakSeconds(current: number, max: number, damagePerSec: number, perSec = 0.012, multiplier = 1, cap = max): number {
  if (current <= 0) return 0
  if (damagePerSec <= passiveShieldRateOf(current, max, perSec, multiplier, cap)) return Infinity
  if (max <= 0 || cap <= 0 || perSec <= 0 || multiplier <= 0) return current / damagePerSec
  const k = max / cap * perSec * multiplier
  const floor = max * SHIELD_REGEN_FLOOR_PCT * multiplier
  const cross = floor / k
  const exponential = current > cross ? Math.log((damagePerSec - floor) / (damagePerSec - k * current)) / k : 0
  return exponential + Math.min(current, cross) / (damagePerSec - floor)
}

/** 装甲自愈不吃修复输出加成；恒定承伤无法超过自愈时不会破甲。 */
export function passiveArmorBreakSeconds(current: number, max: number, damagePerSec: number, perSec = 0): number {
  const net = damagePerSec - Math.max(0, max * perSec)
  return net > 0 ? Math.max(0, current) / net : Infinity
}
