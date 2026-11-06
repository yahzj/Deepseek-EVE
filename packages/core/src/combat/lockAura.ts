import type { BattleState } from '../state'
import type { UnitSpec } from './model'
import { isAlive } from './combatMath'

/** 每次从本舰原值重建，全队使用存活来源的最高增伤，不衰减、不相加。 */
export function applyFleetLockAura(specs: UnitSpec[], battle?: BattleState): UnitSpec[] {
  const sources = specs.map(spec => ({ spec,
    own: spec.lockOwnDmgBonus ?? spec.lockedDmgBonus ?? 0,
    chance: spec.lockOwnTargetChance ?? spec.lockTargetChance ?? ((spec.lockedDmgBonus ?? 0) > 0 ? 1 : 0),
  })).filter(row => row.own > 0 && (!battle || isAlive(battle, row.spec.tag)))
  const bonus = Math.max(0, ...sources.map(row => row.own))
  for (const spec of specs) {
    const own = spec.lockOwnDmgBonus ?? spec.lockedDmgBonus ?? 0
    const chance = spec.lockOwnTargetChance ?? spec.lockTargetChance ?? (own > 0 ? 1 : 0)
    // 原值只保存于临时规格，不进入战斗存档。
    spec.lockOwnDmgBonus = own
    spec.lockOwnTargetChance = chance
    spec.lockedDmgBonus = bonus
    spec.lockTargetChance = Math.max(own > 0 ? chance : 0, ...sources.map(row => row.chance))
  }
  return specs
}
