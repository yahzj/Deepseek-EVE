/** 无人机首次出击错峰隔离预演的纯门控辅助，不被正式core引用。 */

export type DroneLaunchPreviewMode = 'current' | 'queue' | 'queue-cut'

export const DRONE_LAUNCH_PREVIEW_MODES: readonly DroneLaunchPreviewMode[] = ['current', 'queue', 'queue-cut']
export const DRONE_LAUNCH_GAP_MS = 500
export const DRONE_LAUNCH_CUT_PCT = 0.08

export function droneLaunchGapMs(mode: DroneLaunchPreviewMode): number {
  if (mode === 'queue-cut') return DRONE_LAUNCH_GAP_MS * (1 - DRONE_LAUNCH_CUT_PCT)
  return DRONE_LAUNCH_GAP_MS
}

export function isPreviewSentryDrone(artId: string | undefined): boolean {
  return artId === 'drone-sentry' || artId === 'drone-wh-e-sentry'
}

type Pool = { alive?: boolean; artId?: string; owner?: string }
type OwnerState = {
  initialized: boolean
  tailMs: number
  readyAt: Map<string, number>
  released: Set<string>
  alive: Map<string, boolean>
}

const states = new WeakMap<object, Map<string, OwnerState>>()

function ownerState(battle: object, tag: string): OwnerState {
  let byOwner = states.get(battle)
  if (!byOwner) {
    byOwner = new Map()
    states.set(battle, byOwner)
  }
  let state = byOwner.get(tag)
  if (!state) {
    state = { initialized: false, tailMs: 0, readyAt: new Map(), released: new Set(), alive: new Map() }
    byOwner.set(tag, state)
  }
  return state
}

function keyOf(tag: string, wi: number): string {
  return `${tag}:${wi}`
}

function numericWeaponIndex(key: string): number {
  const at = key.lastIndexOf(':')
  return Number(key.slice(at + 1))
}

/** 观察存活边沿，确保储备甲板复活后的无人机也会重新排队。 */
export function previewDroneLaunchObserve(
  mode: DroneLaunchPreviewMode,
  battle: { lastTickGameMs: number; dronePools?: Record<string, Pool> },
  tag: string,
  wi: number,
  pool: Pool | undefined,
): void {
  if (mode === 'current') return
  const state = ownerState(battle, tag)
  const key = keyOf(tag, wi)
  const alive = pool?.alive === true
  const before = state.alive.get(key)
  state.alive.set(key, alive)
  if (!alive) {
    state.readyAt.delete(key)
    state.released.delete(key)
  } else if (before === false) {
    // 新复活的架次追加到本舰队尾；预演只改变再次出击等待，不改变其攻击间隔。
    state.released.delete(key)
    if (state.initialized) {
      state.readyAt.set(key, Math.max(battle.lastTickGameMs, state.tailMs))
      state.tailMs = Math.max(battle.lastTickGameMs, state.tailMs) + droneLaunchGapMs(mode)
    } else {
      state.readyAt.delete(key)
    }
  }
}

/** 首次出击门控：哨戒机放行；普通机按机位顺序错峰，已出击后永久放行。 */
export function previewDroneLaunchGate(
  mode: DroneLaunchPreviewMode,
  battle: { lastTickGameMs: number; dronePools?: Record<string, Pool> },
  tag: string,
  wi: number,
  pool: Pool | undefined,
): boolean {
  if (mode === 'current') return true
  if (!pool?.alive) return false
  if (isPreviewSentryDrone(pool.artId)) return true
  const state = ownerState(battle, tag)
  const key = keyOf(tag, wi)
  if (state.released.has(key)) return true
  const now = battle.lastTickGameMs
  const gap = droneLaunchGapMs(mode)
  if (!state.initialized) {
    state.initialized = true
    state.tailMs = now
    const keys = Object.keys(battle.dronePools ?? {})
      .filter((candidate) => candidate.startsWith(`${tag}:`))
      .filter((candidate) => {
        const candidatePool = battle.dronePools?.[candidate]
        return candidatePool?.alive === true && !isPreviewSentryDrone(candidatePool.artId)
      })
      .sort((a, b) => numericWeaponIndex(a) - numericWeaponIndex(b))
    for (const candidate of keys) {
      if (state.readyAt.has(candidate)) continue
      state.readyAt.set(candidate, state.tailMs)
      state.tailMs += gap
    }
  }
  if (!state.readyAt.has(key)) {
    state.readyAt.set(key, Math.max(now, state.tailMs))
    state.tailMs = Math.max(now, state.tailMs) + gap
  }
  const ready = state.readyAt.get(key)!
  if (now < ready) return false
  state.released.add(key)
  return true
}
