import type { BattleState } from '../../state'
import type { UnitSpec } from '../model'
import { COMBAT_MAX_SHIPS } from '../command/rules'

export function enemyFleetRoom(battle: BattleState): number {
  const count = Object.values(battle.units).filter(unit => unit.side === 'foe' && unit.hp.s + unit.hp.a + unit.hp.h > 0).length
  return Math.max(0, COMBAT_MAX_SHIPS - count)
}

/** 未入场常规编成仍是本波敌人，不能当作清波；条件援军保持原触发机制。 */
export function pendingEnemyFormation(battle: BattleState, foes: readonly UnitSpec[]): boolean {
  return foes.some(foe => !foe.foeReinforceAt && !battle.units[foe.tag])
}
