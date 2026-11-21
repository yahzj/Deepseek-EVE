import type { GameState } from '../../state'
import type { WeekendEventState, WeekendAmbushPick } from './model'
import { weekendDebugOn, weekendNpcTimelineMs } from './time'
import { WEEKEND_DEBUG_WIN_GAIN, WEEKEND_GAIN_CORE_WIN, WEEKEND_GAIN_PERIPHERY_WIN, weekendOccupiedIds, WEEKEND_AMBUSH_STRENGTH_MUL, WEEKEND_NPC_PERIPHERY_MS, clamp01, WEEKEND_NPC_CORE_MS, WEEKEND_ENCOUNTER_CAP, WEEKEND_ENCOUNTER_P, WEEKEND_CORE_THREAT, WEEKEND_PERIPHERY_THREAT } from './constants'
import type { SimContext } from '../../types'
import { weekendDrawFoeCardId, weekendFoeCardsSelfPriced } from './family'
import { foeThreatOfAnomaly, applyFoeOverride } from '../../combat'
import { FOE_DESIGN_STRENGTH_MUL } from '../../wormholeFoes'

export function weekendWinGainOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
): number {
  if (weekendDebugOn(state)) return WEEKEND_DEBUG_WIN_GAIN
  return galaxyId === ev.coreId ? WEEKEND_GAIN_CORE_WIN : WEEKEND_GAIN_PERIPHERY_WIN
}

export function weekendAmbushPickOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  nowWallMs: number,
): WeekendAmbushPick | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return null
  if (weekendProgressAt(state, ev, galaxyId, nowWallMs) >= 1) return null
  const isCore = galaxyId === ev.coreId
  const idx = Math.max(0, weekendOccupiedIds(ev).indexOf(galaxyId))
  const bucketMs = Math.max(1, ctx.balance.encounter.zoneCooldownMs)
  const cardId = weekendDrawFoeCardId(ev.family, isCore, ev.seq, idx, Math.floor(nowWallMs / bucketMs) + 1)
  const mul = WEEKEND_AMBUSH_STRENGTH_MUL
  const card = ctx.anomalies.get(cardId)
  const threat =
    card && weekendFoeCardsSelfPriced(ev.family)
      ? foeThreatOfAnomaly(applyFoeOverride(card, { strengthMul: mul, patrolFormation: true }), FOE_DESIGN_STRENGTH_MUL.solo, ctx.balance.battle)
      : Math.max(1, Math.round(weekendAssaultThreatOf(ev, galaxyId) * mul))
  return { cardId, strengthMul: mul, threat }
}

export function weekendPeripheryProgressAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  const npc = Math.max(0, (nowWallMs - ev.startedAtWallMs) / weekendNpcTimelineMs(state, WEEKEND_NPC_PERIPHERY_MS))
  const put = ev.contributed[galaxyId] ?? 0
  return clamp01(npc + put)
}

export function weekendPeripheryClearedAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): boolean {
  return ev.peripheryIds.every((id) => weekendPeripheryProgressAt(state, ev, id, nowWallMs) >= 1)
}

export function weekendCoreProgressAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): number {
  const put = ev.contributed[ev.coreId] ?? 0
  if (!weekendPeripheryClearedAt(state, ev, nowWallMs)) return clamp01(Math.min(put, 0))
  const npcStart = ev.startedAtWallMs + weekendNpcTimelineMs(state, WEEKEND_NPC_PERIPHERY_MS)
  const npc = Math.max(0, (nowWallMs - npcStart) / weekendNpcTimelineMs(state, WEEKEND_NPC_CORE_MS))
  return clamp01(npc + put)
}

export function weekendProgressAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  if (galaxyId === ev.coreId) return weekendCoreProgressAt(state, ev, nowWallMs)
  if (!ev.peripheryIds.includes(galaxyId)) return 0
  return weekendPeripheryProgressAt(state, ev, galaxyId, nowWallMs)
}

export function weekendZoneLiveAt(state: GameState, galaxyId: string, _nowWallMs: number): boolean {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return false
  return galaxyId === ev.coreId || ev.peripheryIds.includes(galaxyId)
}

export function weekendWreckPenaltyFracOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  return weekendProgressAt(state, ev, galaxyId, nowWallMs) >= 1 ? 0.5 : 1
}

export function weekendCoreGateView(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): { progress: number; gated: boolean; missing: number; total: number } {
  const total = ev.peripheryIds.length
  const missing = ev.peripheryIds.filter((id) => weekendPeripheryProgressAt(state, ev, id, nowWallMs) < 1).length
  return {
    progress: weekendCoreProgressAt(state, ev, nowWallMs),
    gated: !weekendPeripheryClearedAt(state, ev, nowWallMs),
    missing,
    total,
  }
}

export function weekendReclaimedAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): string[] {
  return weekendOccupiedIds(ev).filter((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
}

export function weekendPeripheryLeadOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): { galaxyId: string; progress: number } | null {
  let best: { galaxyId: string; progress: number } | null = null
  for (const id of ev.peripheryIds) {
    const progress = weekendProgressAt(state, ev, id, nowWallMs)
    if (progress >= 1) continue
    if (best === null || progress > best.progress) best = { galaxyId: id, progress }
  }
  return best
}

export function weekendPeripheryAverageOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): number {
  if (ev.peripheryIds.length === 0) return 0
  const sum = ev.peripheryIds.reduce((acc, id) => acc + weekendProgressAt(state, ev, id, nowWallMs), 0)
  return sum / ev.peripheryIds.length
}

export function weekendEncounterChanceAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  const p = weekendProgressAt(state, ev, galaxyId, nowWallMs)
  if (p >= 1) return 0
  return Math.min(WEEKEND_ENCOUNTER_CAP, WEEKEND_ENCOUNTER_P * (1 - p))
}

export function weekendAssaultThreatOf(ev: WeekendEventState, galaxyId: string): number {
  return galaxyId === ev.coreId ? WEEKEND_CORE_THREAT : WEEKEND_PERIPHERY_THREAT
}
