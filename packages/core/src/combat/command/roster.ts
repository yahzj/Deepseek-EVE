import type { GameState, BattleState } from '../../state'
import type { CombatSortie } from './types'
import { COMBAT_MAX_SHIPS } from './rules'

export function combatRosterOf(state: GameState, leader = state.shipId): string[] {
  if (leader !== state.shipId) return [leader]
  const saved = state.preparationSquads?.combat
  return saved === undefined ? [leader] : [leader, ...saved.filter(id => id !== leader && state.fleet[id] !== undefined)]
}
export function battleShipIdsOf(battle: BattleState | null | undefined, leader: string): string[] {
  return battle?.myFleet?.length ? battle.myFleet.map(entry => entry.shipId) : [leader]
}
export function makeCombatSortie(shipIds: readonly string[], leader: string): CombatSortie {
  return { version: 1, leaderShipId: leader, shipIds: [...shipIds] }
}
/** 只清洗形状；旧在途队伍不按当前声望/预算缩编。 */
export function cleanCombatSortie(raw: unknown): CombatSortie | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  if (value.version !== 1 || typeof value.leaderShipId !== 'string' || !Array.isArray(value.shipIds)) return undefined
  const ids = value.shipIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128)
  if (!ids.length || ids.length > COMBAT_MAX_SHIPS || new Set(ids).size !== ids.length || !ids.includes(value.leaderShipId)) return undefined
  return { version: 1, leaderShipId: value.leaderShipId, shipIds: ids }
}
