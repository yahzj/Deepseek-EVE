import type { SimContext } from '../../types'
import type { GameState } from '../../state'
import { weekendGarrisonFoeCardId, weekendFoeCardsSelfPriced, WEEKEND_CORE_THREAT, WEEKEND_PERIPHERY_THREAT, weekendFoeFleetNameOf, weekendAmbushPickOf, weekendCoreProgressAt, weekendFoeCardOf, type WeekendEventState, weekendIsBossFamily, weekendZoneLiveAt, WEEKEND_CARD_PREFIX } from '../../weekendEvent'

export type WeekendBattleKind = 'assault' | 'ambush' | 'flagship'

export interface WeekendBattleSpec {
  kind: WeekendBattleKind
  galaxyId: string
  cardId: string
  threat: number
  waves: number
  squadSize: number
  rewardMul: number
  name: string
  foeStrengthMul?: number
}

export const WEEKEND_FLAGSHIP_REWARD_MUL = 3

export const WEEKEND_ASSAULT_REWARD_MUL = 1.4

export function cardNameOf(ctx: SimContext, cardId: string): string {
  return ctx.anomalies.get(cardId)?.name ?? cardId
}

export function weekendAssaultSpecOf(state: GameState, ctx: SimContext, galaxyId: string): WeekendBattleSpec | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return null
  const isCore = galaxyId === ev.coreId
  const cardId = weekendGarrisonFoeCardId(state, ev, galaxyId)
  const card = ctx.anomalies.get(cardId)
  return {
    kind: 'assault',
    galaxyId,
    cardId,
    threat: weekendFoeCardsSelfPriced(ev.family)
      ? Math.max(1, Math.round(card?.threat ?? 1))
      : isCore
        ? WEEKEND_CORE_THREAT
        : WEEKEND_PERIPHERY_THREAT,
    waves: Math.max(1, card?.waves?.length ?? 1),
    squadSize: 1,
    rewardMul: WEEKEND_ASSAULT_REWARD_MUL,
    name: weekendFoeFleetNameOf(ev.family, cardNameOf(ctx, cardId)),
  }
}

export function weekendAmbushSpecOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  nowWallMs: number,
): WeekendBattleSpec | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return null
  const pick = weekendAmbushPickOf(state, ctx, galaxyId, nowWallMs)
  if (!pick) return null
  const card = ctx.anomalies.get(pick.cardId)
  return {
    kind: 'ambush',
    galaxyId,
    cardId: pick.cardId,
    threat: pick.threat,
    waves: Math.max(1, card?.waves?.length ?? 1),
    squadSize: 1,
    rewardMul: 1,
    name: `巡游小队 · ${cardNameOf(ctx, pick.cardId)}`,
    foeStrengthMul: pick.strengthMul,
  }
}

export function weekendFlagshipSpecOf(state: GameState, ctx: SimContext, nowWallMs: number): WeekendBattleSpec | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (weekendCoreProgressAt(state, ev, nowWallMs) < 1) return null
  const cardId = weekendFoeCardOf(ev.family, 'flagship')
  return {
    kind: 'flagship',
    galaxyId: ev.coreId,
    cardId,
    threat: weekendFoeCardsSelfPriced(ev.family)
      ? Math.max(1, Math.round(ctx.anomalies.get(cardId)?.threat ?? WEEKEND_CORE_THREAT))
      : WEEKEND_CORE_THREAT,
    waves: 4,
    squadSize: 4,
    rewardMul: WEEKEND_FLAGSHIP_REWARD_MUL,
    name: `${ev.family} 族旗舰 · ${cardNameOf(ctx, cardId)}`,
  }
}

export function weekendFlagshipEncounterOf(
  state: Pick<GameState, 'weekendEvent' | 'encounter'>,
  enc: Pick<GameState['encounter'], 'galaxyId' | 'anomalyId'>,
): boolean {
  const ev = state.weekendEvent
  if (!ev) return false
  return (
    enc.galaxyId === ev.coreId &&
    enc.anomalyId !== null &&
    enc.anomalyId === weekendFoeCardOf(ev.family, 'flagship')
  )
}

export function weekendNoteFlagshipPlayerKill(
  state: GameState,
  battle: import('../../state').BattleState,
  nowWallMs: number,
): boolean {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return false
  const down = battle.bossDownAtMs
  if (down === undefined || !Number.isFinite(down)) return false
  if (ev.flagshipPlayerKill !== undefined) return false
  ev.flagshipPlayerKill = {
    atWallMs: nowWallMs,
    runId: battle.startedAtGameMs,
    ...(battle.waveIdx !== undefined ? { waveIdx: battle.waveIdx } : {}),
    downAtGameMs: down,
  }
  return true
}

export function expeditionKindAt(
  state: GameState,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): WeekendBattleKind {
  if (weekendIsBossFamily(ev)) return 'assault'
  return galaxyId === ev.coreId && weekendCoreProgressAt(state, ev, nowWallMs) >= 1 ? 'flagship' : 'assault'
}

export function weekendBattleInvolvedOf(
  state: GameState,
  ctx: SimContext,
  anomalyId: string | null | undefined,
  nowWallMs: number,
): { galaxyId: string; kind: WeekendBattleKind } | undefined {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return undefined
  const expGalaxy = state.expedition?.foeGalaxyId
  if (expGalaxy !== undefined && weekendZoneLiveAt(state, expGalaxy, nowWallMs)) {
    return { galaxyId: expGalaxy, kind: expeditionKindAt(state, ev, expGalaxy, nowWallMs) }
  }
  const rawId = typeof anomalyId === 'string' && anomalyId.length > 0 ? anomalyId : undefined
  if (rawId !== undefined) {
    const baseId = rawId.startsWith(WEEKEND_CARD_PREFIX) ? rawId.slice(WEEKEND_CARD_PREFIX.length) : rawId
    const card = ctx.anomalies.get(baseId)
    const galaxyId = card?.galaxyId
    if (galaxyId !== undefined && weekendZoneLiveAt(state, galaxyId, nowWallMs)) {
      return { galaxyId, kind: expeditionKindAt(state, ev, galaxyId, nowWallMs) }
    }
  }
  const enc = state.encounter
  if (enc.active && enc.galaxyId) {
    if (enc.anomalyId !== null && enc.anomalyId === weekendFoeCardOf(ev.family, 'flagship') && enc.galaxyId === ev.coreId) {
      return { galaxyId: ev.coreId, kind: 'flagship' }
    }
    if (weekendZoneLiveAt(state, enc.galaxyId, nowWallMs)) {
      return { galaxyId: enc.galaxyId, kind: 'ambush' }
    }
  }
  return undefined
}

export interface WeekendOutcomeHint {
  kind: WeekendBattleKind
  galaxyId: string
  source?: 'battle' | 'text'
}
