import type { BattleState } from './state'
import type { ModuleDef } from './types'
import type { UnitSpec } from './combat'
import { weightedGap } from './equipment'

export const DRONE_LAUNCH_GAP_MS = 500
export const DRONE_LAUNCH_MIN_GAP_MS = 10

/** 船体独立、新加速器折权乘算、旧机库逐件乘算；复活只用旧机库，不改攻击装填。 */
export function droneLaunchGapMsOf(modules: readonly ModuleDef[], hullCut = 0, revived = false): number {
  const mul = modules.reduce((n, m) => n * (1 - Math.min(.9, Math.max(0, m.droneCycleCutPct ?? 0))), 1)
  const initial = revived ? 1 : (1 - Math.min(.9, Math.max(0, hullCut))) * (1 - weightedGap(modules.map(m => m.droneLaunchCutPct ?? 0)))
  return Math.max(DRONE_LAUNCH_MIN_GAP_MS, Math.round(DRONE_LAUNCH_GAP_MS * mul * initial))
}

export function initDroneLaunch(b: BattleState, specs: readonly UnitSpec[]): void {
  if (!b.dronePools) return
  b.droneLaunchBy = {}
  for (const spec of specs) {
    const q = spec.weapons.flatMap((w, i) => w.src === 'drone' ? [`${spec.tag}:${i}`] : [])
    for (const key of q) if (b.dronePools[key]) b.dronePools[key]!.launched = false
    if (q.length > 0) b.droneLaunchBy[spec.tag] = { q, nextAtMs: 0, gapMs: spec.droneLaunchGapMs ?? DRONE_LAUNCH_GAP_MS,
      ...(spec.droneReviveGapMs !== undefined && spec.droneReviveGapMs !== spec.droneLaunchGapMs ? { reviveGapMs: spec.droneReviveGapMs } : {}) }
  }
}

/** 只在实际能开火时调用；队头阻塞时不追赶补发，旧档已在场机体直接放行。 */
export function releaseDroneLaunch(b: BattleState, spec: UnitSpec, wi: number): boolean {
  const key = `${spec.tag}:${wi}`
  const pool = b.dronePools?.[key]
  if (!pool?.alive) return false
  if (pool.launched !== false) return true
  const elapsed = Math.max(0, b.lastTickGameMs - b.startedAtGameMs)
  const books = b.droneLaunchBy ?? (b.droneLaunchBy = {})
  const book = books[spec.tag] ?? (books[spec.tag] = {
    q: Object.keys(b.dronePools ?? {}).filter(k => k.startsWith(`${spec.tag}:`) && b.dronePools![k]!.launched === false),
    nextAtMs: elapsed, gapMs: pool.launchRequeued
      ? spec.droneReviveGapMs ?? DRONE_LAUNCH_GAP_MS : spec.droneLaunchGapMs ?? DRONE_LAUNCH_GAP_MS,
    ...(spec.droneReviveGapMs !== undefined ? { reviveGapMs: spec.droneReviveGapMs } : {}),
  })
  const waitingForRevive = b.dronePools?.[book.q[0] ?? '']?.launchRequeued === true
  while (book.q.length > 0) {
    const head = b.dronePools?.[book.q[0]!]
    if (head?.alive && head.launched === false) break
    book.q.shift()
  }
  const headRevived = b.dronePools?.[book.q[0] ?? '']?.launchRequeued === true
  if (headRevived !== waitingForRevive) {
    const previousGap = waitingForRevive ? book.reviveGapMs ?? book.gapMs : book.gapMs
    const currentGap = headRevived ? book.reviveGapMs ?? book.gapMs : book.gapMs
    book.nextAtMs += currentGap - previousGap
  }
  if (book.q[0] !== key || elapsed < book.nextAtMs) return false
  book.q.shift()
  pool.launched = true
  delete pool.launchRequeued
  const next = b.dronePools?.[book.q[0] ?? '']
  book.nextAtMs = elapsed + (next?.launchRequeued ? book.reviveGapMs ?? book.gapMs : book.gapMs)
  return true
}

/** 复活架次排到所属舰队尾，不继承前一架次的放飞许可。 */
export function requeueDroneLaunch(b: BattleState, key: string): void {
  const pool = b.dronePools?.[key]
  if (!pool) return
  pool.launched = false
  pool.launchRequeued = true
  const owner = pool.owner ?? key.slice(0, key.indexOf(':'))
  const book = b.droneLaunchBy?.[owner]
  if (book) {
    const wasEmpty = book.q.length === 0
    book.q = book.q.filter(k => k !== key)
    // 空队列随后补入复活机时，将上一发后留下的首发间隔换回旧间隔，余额不清零。
    if (wasEmpty) book.nextAtMs = Math.max(book.nextAtMs, book.nextAtMs - book.gapMs + (book.reviveGapMs ?? book.gapMs))
    book.q.push(key)
  }
}
