import type { BattleState } from '../combat/state/battle'

export interface ExpeditionState {
  sortie?: import('../combat/command/types').CombatSortie
  active: boolean
  anomalyId: string | null
  finishAtGameMs: number
  durationMs: number
  outMs: number
  combatMs: number
  power: number
  eventId: string | null
  eventFired: boolean
  phase: 'out' | 'battle' | 'back'
  returnReason?: 'victory' | 'defeat' | 'retreat'
  returnAtGameMs?: number
  battle: BattleState | null
  desirePrefByGalaxy?: Record<string, number>
  desirePrefM?: number
  lairTier?: 1 | 2 | 3
  factionActive?: boolean
  foeGalaxyId?: string
  rewardIskOverride?: number
  fuelMul?: number
}
