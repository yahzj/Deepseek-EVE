import type { AnomalyDef, FoeShipSlot } from '../../types'
import { WEEKEND_FLAGSHIP_SHIP_ID, WEEKEND_FLAGSHIP_POOL_HP, WEEKEND_OFFLINE_SHIELD_MS, WEEKEND_BOSS_FAMILIES, clamp01 } from './constants'
import type { WeekendEventState, WeekendFlagshipView, WeekendBossPoolView } from './model'
import { ceilFinalQuantity } from '../../quantity'
import type { GameState } from '../../state'
import { weekendCoreProgressAt } from './progress'
import { weekendFlagshipWindowMs, weekendDebugOn } from './time'

export function weekendFlagshipSlotOf(card: AnomalyDef | undefined): FoeShipSlot | undefined {
  const slots = card?.ships ?? []
  return slots.find((s) => s.ship.hullClassTier === 5) ?? slots.find((s) => s.ship.id === WEEKEND_FLAGSHIP_SHIP_ID)
}

export function weekendIsFlagshipShipId(shipId: string): boolean {
  return shipId === WEEKEND_FLAGSHIP_SHIP_ID
}

export function weekendFlagshipHpRemaining(ev: WeekendEventState | undefined): number {
  if (!ev || !weekendIsBossFamily(ev)) return WEEKEND_FLAGSHIP_POOL_HP
  return Math.max(1, ceilFinalQuantity(flagshipRawLeftOf(ev)))
}

export function flagshipRawLeftOf(ev: WeekendEventState | undefined): number {
  if (!ev || !weekendIsBossFamily(ev)) return WEEKEND_FLAGSHIP_POOL_HP
  const hpMax = ev.flagshipHpMax ?? WEEKEND_FLAGSHIP_POOL_HP
  return Math.min(hpMax, hpMax - Math.max(0, ev.flagshipHpDone ?? 0) - weekendOctopusDone(ev) + Math.max(0, ev.flagshipHpRecovered ?? 0))
}

export function weekendOctopusDone(ev: WeekendEventState | undefined): number {
  if (!ev || !weekendIsBossFamily(ev)) return 0
  const hpMax = ev.flagshipHpMax ?? 0
  if (hpMax <= 0) return 0
  return Math.min(hpMax + Math.max(0, ev.flagshipHpRecovered ?? 0), Math.max(0, ev.octopusHpDone ?? 0))
}

export function weekendFlagshipLayerCaps(
  hpMax: number,
  split: { s: number; a: number; h: number },
): { s: number; a: number; h: number } {
  const total = Math.max(0, hpMax)
  return { s: total * split.s, a: total * split.a, h: total * split.h }
}

export function weekendFlagshipLayersOf(
  remaining: number,
  cap: { s: number; a: number; h: number },
): { s: number; a: number; h: number } {
  const rest = Math.max(0, Math.min(cap.s + cap.a + cap.h, remaining))
  const h = Math.min(cap.h, rest)
  const a = Math.min(cap.a, Math.max(0, rest - h))
  const s = Math.min(cap.s, Math.max(0, rest - h - a))
  return { s, a, h }
}

export function weekendFlagshipView(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
  lastSeenWallMs: number,
): WeekendFlagshipView {
  if (ev.endedAtWallMs !== undefined) return { shown: false }
  if (ev.flagshipDown) return { shown: true, atWallMs: ev.flagshipAtWallMs, down: ev.flagshipDown }
  const full = weekendCoreProgressAt(state, ev, nowWallMs) >= 1
  if (!full) return { shown: false }
  const windowMs = weekendFlagshipWindowMs(state)
  const hpMax = ev.flagshipHpMax ?? 0
  const hpLeft =
    hpMax > 0 ? Math.max(0, flagshipRawLeftOf(ev)) : 0
  const drainDone = weekendFlagshipDefeated(ev)
  const offline = Math.max(0, nowWallMs - lastSeenWallMs)
  let anchor = ev.flagshipAtWallMs
  if (anchor === undefined) {
    if (weekendDebugOn(state) || offline <= 60_000 || offline <= WEEKEND_OFFLINE_SHIELD_MS) anchor = nowWallMs
    else anchor = lastSeenWallMs + WEEKEND_OFFLINE_SHIELD_MS
  }
  const offlineLapsed = offline > WEEKEND_OFFLINE_SHIELD_MS
  const octopusHeld = nowWallMs < (ev.octopusHoldUntilWallMs ?? 0)
  const down =
    drainDone || (!octopusHeld && offlineLapsed && nowWallMs >= anchor + windowMs) ? ('octopus' as const) : undefined
  const deadlineWallMs = offlineLapsed
    ? anchor + windowMs
    : hpMax > 0
      ? nowWallMs + Math.round((hpLeft * windowMs) / hpMax)
      : nowWallMs + windowMs
  return { shown: true, atWallMs: anchor, deadlineWallMs, ...(down !== undefined ? { down } : {}) }
}

export function weekendIsBossFamily(ev: WeekendEventState | undefined): boolean {
  return ev !== undefined && WEEKEND_BOSS_FAMILIES.includes(ev.family)
}

export function weekendOctopusDrainPerMs(state: Pick<GameState, 'debugQuick'>, hpTotal: number): number {
  return hpTotal / weekendFlagshipWindowMs(state)
}

export function weekendFlagshipOutcomeOf(ev: WeekendEventState | undefined): 'player' | 'octopus' | 'window' {
  if (ev?.flagshipPlayerKill !== undefined) return 'player'
  if (ev?.flagshipDown === 'player') return 'player'
  if (ev?.flagshipDown === 'octopus') return 'octopus'
  return 'window'
}

export function weekendFlagshipSharesOf(ev: WeekendEventState | undefined): { player: number; octopus: number } {
  if (!ev || !weekendIsBossFamily(ev)) return { player: 0, octopus: 0 }
  const hpMax = ev.flagshipHpMax ?? 0
  if (hpMax <= 0) return { player: 0, octopus: 0 }
  const done = Math.max(0, ev.flagshipHpDone ?? 0)
  const player = clamp01(done / hpMax)
  return { player, octopus: clamp01(Math.min(weekendOctopusDone(ev), Math.max(0, hpMax - done)) / hpMax) }
}

export function weekendFlagshipPoolTotal(ev: WeekendEventState | undefined): number | undefined {
  if (!ev || !weekendIsBossFamily(ev)) return undefined
  return ev.flagshipHpMax
}

export function weekendBossPoolView(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState | undefined,
): WeekendBossPoolView | null {
  if (!ev || ev.endedAtWallMs !== undefined || !weekendIsBossFamily(ev)) return null
  const hpMax = ev.flagshipHpMax
  if (hpMax === undefined || hpMax <= 0) return null
  const hpDone = Math.max(0, ev.flagshipHpDone ?? 0)
  const octopusDone = weekendOctopusDone(ev)
  const shares = weekendFlagshipSharesOf(ev)
  const left = Math.max(0, flagshipRawLeftOf(ev))
  void state
  return {
    hpMax,
    hpDone,
    hpLeft: left,
    octopusDone,
    playerFrac: shares.player,
    octopusFrac: shares.octopus,
  }
}

export function weekendNoteFlagshipDamage(
  ev: WeekendEventState,
  rawDmg: number,
  runId?: number,
): boolean {
  if (!weekendIsBossFamily(ev) || ev.flagshipDown !== undefined) return false
  if (!Number.isFinite(rawDmg)) return false
  const dmg = rawDmg < 0 ? rawDmg : ceilFinalQuantity(rawDmg)
  const sameRun = runId !== undefined && (ev.flagshipRunId === runId || ev.flagshipSettledRuns?.includes(runId))
  if (sameRun) return weekendFlagshipDefeated(ev)
  if (runId !== undefined) {
    const settled = ev.flagshipSettledRuns ?? []
    if (ev.flagshipRunId !== undefined && !settled.includes(ev.flagshipRunId)) settled.push(ev.flagshipRunId)
    settled.push(runId)
    ev.flagshipSettledRuns = settled
    ev.flagshipRunId = runId
  }
  if (ev.flagshipHpMax === undefined) ev.flagshipHpMax = WEEKEND_FLAGSHIP_POOL_HP
  if (dmg > 0) {
    ev.flagshipHpDone = Math.max(0, (ev.flagshipHpDone ?? 0) + dmg)
  } else if (dmg < 0) {
    const lost = Math.max(0, ev.flagshipHpMax - flagshipRawLeftOf(ev))
    ev.flagshipHpRecovered = Math.max(0, ev.flagshipHpRecovered ?? 0) + Math.min(lost, -dmg)
  }
  return weekendFlagshipDefeated(ev)
}

export function weekendFlagshipDefeated(ev: WeekendEventState | undefined): boolean {
  if (!ev || !weekendIsBossFamily(ev) || ev.flagshipDown !== undefined) return false
  const hpMax = ev.flagshipHpMax ?? 0
  if (hpMax <= 0) return false
  return flagshipRawLeftOf(ev) <= 0
}

export function weekendOctopusTick(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  dtMs: number,
  inBattle: boolean,
): boolean {
  if (!weekendIsBossFamily(ev) || ev.flagshipDown !== undefined) return false
  if (inBattle || dtMs <= 0) return false
  const hpMax = ev.flagshipHpMax
  if (hpMax === undefined || hpMax <= 0) return false
  const d = Math.max(0, dtMs)
  if (d <= 0) return false
  const playerDone = Math.max(0, ev.flagshipHpDone ?? 0)
  const need = hpMax - playerDone + Math.max(0, ev.flagshipHpRecovered ?? 0)
  if (need <= 0) return false
  ev.octopusHpDone = Math.min(need, weekendOctopusDone(ev) + d * weekendOctopusDrainPerMs(state, hpMax))
  return (ev.octopusHpDone ?? 0) >= need
}
