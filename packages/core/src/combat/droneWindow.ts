import type { BattleBalance } from '../types'

export function pdEnabledFor(threat: number, bal: BattleBalance): boolean {
  return threat >= bal.pdThreatFloor
}

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
