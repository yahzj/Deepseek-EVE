import type { BattleFx } from '@whale/core'

export const REPAIR_DRONE_OUT_MS = 560
export const REPAIR_DRONE_WORK_MS = 520
export const REPAIR_DRONE_BACK_MS = 620
export const REPAIR_DRONE_LIFE_MS = REPAIR_DRONE_OUT_MS + REPAIR_DRONE_WORK_MS + REPAIR_DRONE_BACK_MS

/** 只接收新到达的有效修理，首次挂载不补播历史，追帧预算不把旧脉冲堆成动画。 */
export function newRepairDroneEvents(events: readonly BattleFx[], after: number, now: number, speed = 1): BattleFx[] {
  return events.filter(event => event.seq > after && event.repair && event.to && event.side === 'me'
    && event.repair.armor + event.repair.hull > 0 && now >= event.atMs
    && now - event.atMs <= 200 * Math.max(1, speed))
}

/** 放飞到受修舰侧的短弧线，位置和光束共用同一个姿态。 */
export function repairDronePose(from: { x: number; y: number }, to: { x: number; y: number }, elapsed: number, lane = 0) {
  const target = { x: to.x - 26, y: to.y - 20 - lane % 3 * 9 }
  const returning = elapsed >= REPAIR_DRONE_OUT_MS + REPAIR_DRONE_WORK_MS
  const t = Math.max(0, Math.min(1, elapsed < REPAIR_DRONE_OUT_MS ? elapsed / REPAIR_DRONE_OUT_MS
    : returning ? 1 - (elapsed - REPAIR_DRONE_OUT_MS - REPAIR_DRONE_WORK_MS) / REPAIR_DRONE_BACK_MS : 1))
  const eased = t * t * (3 - 2 * t)
  return { x: from.x + (target.x - from.x) * eased,
    y: from.y + (target.y - from.y) * eased - Math.sin(Math.PI * t) * 24,
    angle: Math.atan2(target.y - from.y, target.x - from.x) * 180 / Math.PI + (returning ? 180 : 0),
    working: elapsed >= REPAIR_DRONE_OUT_MS && !returning }
}
