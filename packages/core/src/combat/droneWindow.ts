/** 战斗域：droneWindow，从原引擎按职责迁移，保持结算顺序。 */
import type { BattleBalance } from '../types'

/** 该威胁的敌舰是否装近防炮（威胁 < pdThreatFloor 不装；2026-09-10 船长：60） */
export function pdEnabledFor(threat: number, bal: BattleBalance): boolean {
  return threat >= bal.pdThreatFloor
}

/** **单次出击（分批放飞）的"在空窗口"**（2026-09-12 船长「限制敌机单次出击数量」）——
 *  按**在场架次列表**轮换：每 `cycleMs` 换一批，每批最多 `maxAloft` 架在空（其余在机库待命）。
 *  `cycleMs` 缺省 = 机型装填时长（一批打完换下一批）。
 *  ⚠ 纯**由战斗时钟推导**（`startedAtGameMs` 起算）⇒ **不新增存档字段**；
 *  触发增程/备用补位都会自然改变"在场列表"，窗口随之重排。 */
export function aloftDroneSet(
  pools: readonly import('../state').DronePoolEntry[],
  launch: { maxAloft: number; cycleMs?: number },
  reloadMs: number,
  b: import('../state').BattleState,
): ReadonlySet<number> {
  const active: number[] = []
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i]!
    if (p.alive && p.inHangar !== true) active.push(i)
  }
  const out = new Set<number>()
  if (active.length === 0) return out
  const k = Math.max(1, Math.min(Math.round(launch.maxAloft), active.length))
  const cycle = Math.max(200, launch.cycleMs ?? reloadMs)
  const elapsed = Math.max(0, b.lastTickGameMs - b.startedAtGameMs)
  const batch = Math.floor(elapsed / cycle)
  const start = (batch * k) % active.length
  for (let j = 0; j < k; j++) out.add(active[(start + j) % active.length]!)
  return out
}
