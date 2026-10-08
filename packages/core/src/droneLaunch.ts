import type { BattleState } from './state'
import type { ModuleDef } from './types'
import type { UnitSpec } from './combat'

export const DRONE_LAUNCH_GAP_MS = 500
export const DRONE_LAUNCH_MIN_GAP_MS = 10

/** 掠袭机库逐件缩短首次出击等待，不改变无人机装填。 */
export function droneLaunchGapMsOf(modules: readonly ModuleDef[]): number {
  const mul = modules.reduce((n, m) => n * (1 - Math.min(.9, Math.max(0, m.droneCycleCutPct ?? 0))), 1)
  return Math.max(DRONE_LAUNCH_MIN_GAP_MS, Math.round(DRONE_LAUNCH_GAP_MS * mul))
}

export function initDroneLaunch(b: BattleState, specs: readonly UnitSpec[]): void {
  if (!b.dronePools) return
  b.droneLaunchBy = {}
  for (const spec of specs) {
    const q = spec.weapons.flatMap((w, i) => w.src === 'drone' ? [`${spec.tag}:${i}`] : [])
    for (const key of q) if (b.dronePools[key]) b.dronePools[key]!.launched = false
    if (q.length > 0) b.droneLaunchBy[spec.tag] = { q, nextAtMs: 0, gapMs: spec.droneLaunchGapMs ?? DRONE_LAUNCH_GAP_MS }
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
    nextAtMs: elapsed, gapMs: spec.droneLaunchGapMs ?? DRONE_LAUNCH_GAP_MS,
  })
  while (book.q.length > 0) {
    const head = b.dronePools?.[book.q[0]!]
    if (head?.alive && head.launched === false) break
    book.q.shift()
  }
  if (book.q[0] !== key || elapsed < book.nextAtMs) return false
  book.q.shift()
  pool.launched = true
  book.nextAtMs = elapsed + book.gapMs
  return true
}

/** 复活架次排到所属舰队尾，不继承前一架次的放飞许可。 */
export function requeueDroneLaunch(b: BattleState, key: string): void {
  const pool = b.dronePools?.[key]
  if (!pool) return
  pool.launched = false
  const owner = pool.owner ?? key.slice(0, key.indexOf(':'))
  const book = b.droneLaunchBy?.[owner]
  if (book) {
    book.q = book.q.filter(k => k !== key)
    book.q.push(key)
  }
}
