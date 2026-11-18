import type { GameState, BattleState } from '../../state'
import { asRaw, cleanBattle } from '../../saveBattleClean'
import { cleanCombatSortie } from './roster'

export function cleanCommandExpedition(raw: unknown): GameState['expedition'] {
  const fuelMulOf = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v > 1 ? v : undefined
  const expRaw = asRaw(raw)
  const expAnomalyId = typeof expRaw.anomalyId === 'string' && expRaw.anomalyId.length > 0 ? expRaw.anomalyId : null
  const expPhaseRaw = expRaw.phase
  const expPhase: 'out' | 'battle' | 'back' =
    expPhaseRaw === 'battle' || expPhaseRaw === 'back' ? expPhaseRaw : 'out'
  const expBattle: BattleState | null = expPhase === 'battle' ? cleanBattle(expRaw.battle) : null
  const expReturnReason: GameState['expedition']['returnReason'] =
    expPhase === 'back' &&
    (expRaw.returnReason === 'victory' || expRaw.returnReason === 'defeat' || expRaw.returnReason === 'retreat')
      ? expRaw.returnReason
      : undefined
  const sortie = cleanCombatSortie(expRaw.sortie)
  return {
    ...(sortie ? { sortie } : {}),
    active: expRaw.active === true && expAnomalyId !== null,
    anomalyId: expAnomalyId,
    finishAtGameMs:
      typeof expRaw.finishAtGameMs === 'number' && Number.isFinite(expRaw.finishAtGameMs)
        ? Math.max(0, Math.floor(expRaw.finishAtGameMs))
        : 0,
    durationMs:
      typeof expRaw.durationMs === 'number' && Number.isFinite(expRaw.durationMs)
        ? Math.max(0, Math.floor(expRaw.durationMs))
        : 0,
    outMs:
      typeof expRaw.outMs === 'number' && Number.isFinite(expRaw.outMs)
        ? Math.max(0, Math.floor(expRaw.outMs))
        : 0,
    combatMs:
      typeof expRaw.combatMs === 'number' && Number.isFinite(expRaw.combatMs)
        ? Math.max(0, Math.floor(expRaw.combatMs))
        : 0,
    power:
      typeof expRaw.power === 'number' && Number.isFinite(expRaw.power) ? Math.max(0, Math.floor(expRaw.power)) : 0,
    eventId: typeof expRaw.eventId === 'string' && expRaw.eventId.length > 0 ? expRaw.eventId : null,
    eventFired: expRaw.eventFired === true,
    phase: expPhase === 'battle' && expBattle === null ? 'out' : expPhase,
    battle: expBattle,
    ...(() => {
      const raw = asRaw(expRaw.desirePrefByGalaxy)
      const byGalaxy: Record<string, number> = {}
      for (const [gid, v] of Object.entries(raw)) {
        if (typeof gid !== 'string' || gid.length === 0) continue
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
        byGalaxy[gid] = Math.round(v)
      }
      return Object.keys(byGalaxy).length > 0 ? { desirePrefByGalaxy: byGalaxy } : {}
    })(),
    returnReason: expReturnReason,
    ...(typeof expRaw.returnAtGameMs === 'number' && Number.isFinite(expRaw.returnAtGameMs)
      ? { returnAtGameMs: Math.max(0, Math.floor(expRaw.returnAtGameMs)) } : {}),
    ...(typeof expRaw.foeGalaxyId === 'string' && expRaw.foeGalaxyId.length > 0
      ? { foeGalaxyId: expRaw.foeGalaxyId }
      : {}),
    ...(typeof expRaw.rewardIskOverride === 'number' &&
    Number.isFinite(expRaw.rewardIskOverride) &&
    expRaw.rewardIskOverride >= 0
      ? { rewardIskOverride: Math.round(expRaw.rewardIskOverride) }
      : {}),
    ...(fuelMulOf(expRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(expRaw.fuelMul)! } : {}),
  }

}

export function cleanWeekendSquad(raw: unknown): string[] {
  const ids: string[] = []
  for (const id of Array.isArray(raw) ? raw : []) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128 || ids.includes(id)) continue
    ids.push(id)
    if (ids.length >= 12) break
  }
  return ids
}
