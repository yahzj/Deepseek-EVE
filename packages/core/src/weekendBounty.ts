import { ceilFinalQuantity } from './quantity'
import type { AnomalyDef, SimContext } from './types'
import type { GameState } from './state'
import {
  WEEKEND_CORE_THREAT,
  WEEKEND_PERIPHERY_THREAT,
  weekendEncounterChanceAt,
  weekendFoeFleetNameOf,
  weekendFoeCardsSelfPriced,
  weekendDrawFoeCardId,
  weekendGarrisonFoeCardId,
  weekendOccupiedIds,
} from './weekendEvent'
import { weekendAmbushSpecOf } from './weekendBattle'
import type { WeekendBattleSpec } from './weekendBattle'

export { WEEKEND_CARD_PREFIX, weekendZoneLiveAt } from './weekendEvent'
import { weekendZoneLiveAt } from './weekendEvent'

export const WEEKEND_BOUNTY_REWARD_MUL = 1.4


export function weekendEncounterAllowedIn(state: GameState, galaxyId: string, nowWallMs: number): boolean {
  return weekendZoneLiveAt(state, galaxyId, nowWallMs)
}

export function weekendDerivedCardOf(
  card: AnomalyDef,
  family: string,
  opts?: { threat?: number; isCore?: boolean },
): AnomalyDef {
  const threat = opts?.threat ?? (opts?.isCore ? WEEKEND_CORE_THREAT : WEEKEND_PERIPHERY_THREAT)
  return {
    ...card,
    id: card.id,
    name: weekendFoeFleetNameOf(family, card.name),
    threat,
    rewardIsk: 0,
  }
}

function weekendIndependentFoeOf(base: AnomalyDef, drawn: AnomalyDef, family: string, galaxyId: string): AnomalyDef {
  void base
  return {
    ...drawn,
    galaxyId,
    name: weekendFoeFleetNameOf(family, drawn.name),
    rewardIsk: 0,
  }
}

export function weekendBountyCardsOf(
  state: GameState,
  ctx: SimContext,
  cards: readonly AnomalyDef[],
  galaxyId: string,
  nowWallMs: number,
): readonly AnomalyDef[] {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return cards
  if (!weekendZoneLiveAt(state, galaxyId, nowWallMs)) return cards
  const isCore = galaxyId === ev.coreId
  if (weekendFoeCardsSelfPriced(ev.family)) {
    const drawn = ctx.anomalies.get(weekendGarrisonFoeCardId(state, ev, galaxyId))
    if (drawn) {
      return cards.map((c) => weekendIndependentFoeOf(c, drawn, ev.family, galaxyId))
    }
  }
  return cards.map((c) => weekendDerivedCardOf(c, ev.family, { isCore }))
}

export function weekendBoardRowsOf<T extends { id: string; galaxyId: string }>(
  rows: readonly T[],
  isOccupiedLive: (galaxyId: string) => boolean,
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    if (isOccupiedLive(row.galaxyId)) {
      const key = `${row.galaxyId}|${row.id}`
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(row)
  }
  return out
}

export function weekendLaunchGalaxyOf(
  state: GameState,
  hintGalaxyId: string | undefined,
  cardGalaxyId: string | undefined,
  nowWallMs: number,
): string | undefined {
  if (hintGalaxyId !== undefined && hintGalaxyId.length > 0 && weekendZoneLiveAt(state, hintGalaxyId, nowWallMs)) {
    return hintGalaxyId
  }
  return cardGalaxyId
}

export interface WeekendAssaultDispatch {
  cardId: string
  rewardIsk: number
}

export const WEEKEND_ASSAULT_SALT_BASE = 10_000

export function weekendAssaultCardIdOfDrawnAt(state: GameState, galaxyId: string): string | null {
  const ev = state.weekendEvent
  if (!ev) return null
  const isCore = galaxyId === ev.coreId
  const idx = Math.max(0, weekendOccupiedIds(ev).indexOf(galaxyId))
  const salt = WEEKEND_ASSAULT_SALT_BASE + Math.max(0, Math.floor(ev.assaultDraws ?? 0))
  return weekendDrawFoeCardId(ev.family, isCore, ev.seq, idx, salt)
}

export function weekendFoeCardIdToFightOf(
  state: GameState,
  displayedCardId: string,
  displayedGalaxyId: string | undefined,
  nowWallMs: number = Date.now(),
): string {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return displayedCardId
  const galaxyId = weekendLaunchGalaxyOf(state, displayedGalaxyId, displayedGalaxyId, nowWallMs)
  if (galaxyId === undefined || !weekendZoneLiveAt(state, galaxyId, nowWallMs)) return displayedCardId
  return weekendAssaultCardIdOfDrawnAt(state, galaxyId) ?? displayedCardId
}

export function weekendAssaultDrawOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  nowWallMs: number,
): WeekendAssaultDispatch | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (!weekendZoneLiveAt(state, galaxyId, nowWallMs)) return null
  const cardId = weekendAssaultCardIdOfDrawnAt(state, galaxyId)
  if (cardId === null) return null
  const drawn = ctx.anomalies.get(cardId)
  const base = [...ctx.anomalies.values()].find((a) => !a.hidden && a.galaxyId === galaxyId)
  const rewardIsk =
    base !== undefined
      ? Math.max(1, ceilFinalQuantity((base.rewardIsk ?? 0) * WEEKEND_BOUNTY_REWARD_MUL))
      : Math.max(1, ceilFinalQuantity(drawn?.rewardIsk ?? 1))
  return { cardId, rewardIsk }
}

export function weekendNoteAssaultDispatch(state: GameState): void {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return
  ev.assaultDraws = Math.max(0, Math.floor(ev.assaultDraws ?? 0)) + 1
}

export function weekendEncounterRollOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  roll: number,
  nowWallMs: number,
): WeekendBattleSpec | undefined {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return undefined
  if (!weekendEncounterAllowedIn(state, galaxyId, nowWallMs)) return undefined
  const chance = weekendEncounterChanceAt(state, ev, galaxyId, nowWallMs)
  if (chance <= 0 || roll >= chance) return undefined
  return weekendAmbushSpecOf(state, ctx, galaxyId, nowWallMs) ?? undefined
}
