import type { BattleState } from '../../state'
import type { UnitSpec } from '../model'
import { COMBAT_MAX_SHIPS } from '../command/rules'

export function enemyFleetRoom(battle: BattleState): number {
  const count = Object.values(battle.units).filter(unit => unit.side === 'foe' && unit.hp.s + unit.hp.a + unit.hp.h > 0).length
  return Math.max(0, COMBAT_MAX_SHIPS - count)
}

export function pendingEnemyFormation(battle: BattleState, foes: readonly UnitSpec[]): boolean {
  return foes.some(foe => !foe.foeReinforceAt && !battle.units[foe.tag])
}
