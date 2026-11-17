import type { GameState } from './state'
import type { AnomalyDef, SimContext } from './types'
import { startFleetBattleFor, resolvedBattleAnomaly } from './combat'
import { withBattleRangeCheck } from './battleRangeMemory'
import { shipHasWeapon } from './equipment'
import { weekendFlagshipEncounterOf, weekendFlagshipSpecOf } from './weekendBattle'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  WEEKEND_FLAGSHIP_SHIP_ID,
  weekendBossPoolView,
  weekendFlagshipSlotOf,
  weekendFlagshipLayerCaps,
  weekendFlagshipLayersOf,
  weekendFlagshipView,
} from './weekendEvent'
import type { WeekendBossPoolView } from './weekendEvent'
import { flagshipRawLeftOf } from './invasion/event/boss'
import type { FoeOverride } from './combat'
import { shipDisplayName } from './instances'
import { calcPower } from './expedition'
import { preparationSquadOf, notePreparationSquad } from './preparationSquads'
import { combatShipLimit, commandBudgetOf } from './combat/command/rules'
import { shipOperationBlockReason } from './shipActionPolicy'
import { beginDeparture, departureOrigin, UNDOCK_MS } from './departure'
import { combatRosterOf } from './combat/command/roster'

export const WEEKEND_FLAGSHIP_MAX_SHIPS = combatShipLimit(true)
export const WEEKEND_PREP_LOW_HULL_FRAC = 0.6

export type WeekendPrepIssue = 'no-weapon' | 'no-ammo' | 'low-armor' | 'low-hull'

export interface WeekendPrepCandidate {
  shipId: string
  defId: string
  name: string
  power: number
  armorPct: number
  hullPct: number
  issues: WeekendPrepIssue[]
}

export interface WeekendFlagshipPrepView {
  cardId: string
  threat: number
  waves: number
  pool: WeekendBossPoolView
  deadlineWallMs?: number
  maxShips: number
  candidates: WeekendPrepCandidate[]
  defaultSquad: string[]
}


export function weekendPrepIssuesOf(state: GameState, ctx: SimContext, shipId: string): WeekendPrepIssue[] {
  const ship = state.fleet[shipId]
  if (!ship) return []
  const out: WeekendPrepIssue[] = []
  const armed = shipHasWeapon(state, ctx, shipId)
  if (!armed) out.push('no-weapon')
  else {
    const hasAmmo =
      Object.keys(ship.cargo).some((id) => id.startsWith('ammo-')) ||
      Object.keys(state.warehouse.items).some((id) => id.startsWith('ammo-'))
    if (!hasAmmo) out.push('no-ammo')
  }
  if ((ship.armorPct ?? 1) < WEEKEND_PREP_LOW_HULL_FRAC) out.push('low-armor')
  if (ship.durability < WEEKEND_PREP_LOW_HULL_FRAC) out.push('low-hull')
  return out
}

export function weekendFlagshipPrepView(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
): WeekendFlagshipPrepView | null {
  const ev = state.weekendEvent
  if (!ev) return null
  const view = weekendFlagshipView(state, ev, nowWallMs, nowWallMs)
  if (!view.shown || view.down !== undefined) return null
  const spec = weekendFlagshipSpecOf(state, ctx, nowWallMs)
  if (!spec) return null
  const pool: WeekendBossPoolView = weekendBossPoolView(state, ev) ?? {
    hpMax: WEEKEND_FLAGSHIP_POOL_HP,
    hpDone: 0,
    hpLeft: WEEKEND_FLAGSHIP_POOL_HP,
    octopusDone: 0,
    playerFrac: 0,
    octopusFrac: 0,
  }
  const candidates: WeekendPrepCandidate[] = []
  for (const shipId of Object.keys(state.fleet)) {
    const defId = state.fleet[shipId]?.defId ?? shipId
    const ship = state.fleet[shipId]!
    candidates.push({
      shipId,
      defId,
      name: shipDisplayName(state, ctx, shipId),
      power: calcPower(state, ctx, shipId),
      armorPct: ship.armorPct ?? 1,
      hullPct: ship.durability,
      issues: weekendPrepIssuesOf(state, ctx, shipId),
    })
  }
  return {
    cardId: spec.cardId,
    threat: spec.threat,
    waves: spec.waves,
    pool,
    ...(view.deadlineWallMs !== undefined ? { deadlineWallMs: view.deadlineWallMs } : {}),
    maxShips: WEEKEND_FLAGSHIP_MAX_SHIPS,
    candidates,
    defaultSquad: weekendPrepSquadOf(state),
  }
}

export function weekendPrepSquadOf(state: GameState): string[] {
  if (state.preparationSquads?.weekend !== undefined) return preparationSquadOf(state, 'weekend')
  const saved = (state.weekendPrepSquad ?? []).filter((id) => state.fleet[id] !== undefined)
  return saved.length > 0 ? saved.slice(0, WEEKEND_FLAGSHIP_MAX_SHIPS) : weekendFlagshipSquadOf(state)
}

export function weekendNoteFlagshipSquad(state: GameState, squad: readonly string[]): void {
  const clean = weekendSanitizeFlagshipSquad(state, squad)
  if (clean.length === 0) return
  state.weekendPrepSquad = clean
  notePreparationSquad(state, 'weekend', clean)
}

export function weekendSanitizeFlagshipSquad(state: GameState, squad: readonly string[]): string[] {
  const out: string[] = []
  for (const id of squad) {
    if (typeof id !== 'string' || id.length === 0) continue
    if (state.fleet[id] === undefined) continue
    if (out.includes(id)) continue
    out.push(id)
    if (out.length >= WEEKEND_FLAGSHIP_MAX_SHIPS) break
  }
  return out
}

export function weekendBestFlagshipSquad(state: GameState, ctx: SimContext): string[] {
  const pool = Object.keys(state.fleet)
    .map((shipId) => ({ shipId, power: calcPower(state, ctx, shipId) }))
    .sort((a, b) => b.power - a.power)
    .slice(0, WEEKEND_FLAGSHIP_MAX_SHIPS)
    .map((c) => c.shipId)
  const chosen: string[] = []
  for (const id of pool) if (commandBudgetOf(state, ctx, [...chosen, id], true).ok) chosen.push(id)
  return chosen
}

export function weekendFlagshipWavesOf(): ReadonlyArray<{ units: number; hpShare: number }> {
  return Array.from({ length: 4 }, () => ({ units: 4, hpShare: 0.25 }))
}

export function weekendFlagshipSquadOf(state: GameState): string[] {
  const ids: string[] = []
  for (const id of [state.shipId, ...Object.keys(state.fleet)]) {
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id)
  }
  return ids.slice(0, WEEKEND_FLAGSHIP_MAX_SHIPS)
}

export function weekendStartFlagshipBattle(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
  squad?: readonly string[],
): ReturnType<typeof startFleetBattleFor> {
  const result = withBattleRangeCheck(state, { kind: 'flagship', squad, eventSeq: state.weekendEvent?.seq }, staged => {
    const battle = weekendStartFlagshipBattleMutable(staged, ctx, nowWallMs, squad)
    return { ok: battle !== null, battle }
  })
  return result.battle ?? null
}

function weekendStartFlagshipBattleMutable(state: GameState, ctx: SimContext, nowWallMs: number, squad?: readonly string[]): ReturnType<typeof startFleetBattleFor> {
  const spec = weekendFlagshipSpecOf(state, ctx, nowWallMs)
  if (!spec) return null
  const clean = squad !== undefined ? weekendSanitizeFlagshipSquad(state, squad) : []
  const use = squad === undefined ? combatRosterOf(state) : clean
  if (use.length === 0) return null
  if (!commandBudgetOf(state, ctx, squad ?? use, true).ok) return null
  if (use.some(id => shipOperationBlockReason(state, ctx, id, 'configure') !== null)) return null
  if (clean.length > 0) weekendNoteFlagshipSquad(state, clean)
  const poolTotal = state.weekendEvent?.flagshipHpMax ?? WEEKEND_FLAGSHIP_POOL_HP
  const bossHp = Math.max(0, flagshipRawLeftOf(state.weekendEvent))
  const bossSlot = weekendFlagshipSlotOf(ctx.anomalies.get(spec.cardId))
  const cap = weekendFlagshipLayerCaps(poolTotal, bossSlot?.split ?? bossSlot?.ship.split ?? { s: 0.2, a: 0.55, h: 0.25 })
  const override: FoeOverride = {
    threat: spec.threat,
    waves: weekendFlagshipWavesOf(),
    bossHp,
    bossHpMax: poolTotal,
    bossHpLayers: weekendFlagshipLayersOf(bossHp, cap),
    bossMaxLayers: cap,
    bossShipId: bossSlot?.ship.id ?? WEEKEND_FLAGSHIP_SHIP_ID,
  }
  const origin = departureOrigin(state, ctx)
  const battle = startFleetBattleFor(state, ctx, use, spec.cardId, state.gameMs + (origin.docked ? UNDOCK_MS : 0), undefined, undefined, override, true)
  if (battle) beginDeparture(state, ctx, 'flagship', state.weekendEvent!.coreId, origin)
  return battle
}


export interface WeekendFlagshipBattleView {
  battle: import('./state').BattleState
  anomaly: AnomalyDef
  leaderShipId: string
  name: string
  combat: {
    distanceM: number
    myDesireM: number
    meHp: { s: number; a: number; h: number }
    foeHp: Record<string, { s: number; a: number; h: number; name: string }>
    shots: number
    hits: number
    lockTag: string | null
  } | null
}

export function weekendFlagshipBattleActive(state: GameState): boolean {
  if (state.departure?.kind === 'flagship') return false
  const enc = state.encounter
  if (!enc.active || !enc.battle) return false
  return weekendFlagshipEncounterOf(state, enc)
}

export function weekendFlagshipBattleViewOf(state: GameState, ctx: SimContext): WeekendFlagshipBattleView | null {
  if (state.departure?.kind === 'flagship') return null
  const enc = state.encounter
  const battle = enc.battle
  if (!battle || !enc.active) return null
  if (!weekendFlagshipEncounterOf(state, enc) && !enc.pirate && !enc.automatic) return null
  const anomaly = resolvedBattleAnomaly(ctx, battle, enc.anomalyId)
  if (!anomaly) return null
  const leaderShipId = battle.myFleet?.[0]?.shipId ?? enc.shipId ?? state.shipId
  const leaderRt = battle.units[battle.myFleet?.[0]?.tag ?? 'player']
  const foeHp: Record<string, { s: number; a: number; h: number; name: string }> = {}
  for (const [tag, u] of Object.entries(battle.units)) {
    if (u.side !== 'foe') continue
    foeHp[tag] = { s: u.hp.s, a: u.hp.a, h: u.hp.h, name: u.name }
  }
  return {
    battle,
    anomaly,
    leaderShipId,
    name: anomaly.name,
    combat: {
      distanceM: battle.distanceM,
      myDesireM: battle.myDesireM,
      meHp: leaderRt ? { ...leaderRt.hp } : { s: 0, a: 0, h: 0 },
      foeHp,
      shots: battle.stats.meShots,
      hits: battle.stats.meHits,
      lockTag: null,
    },
  }
}
