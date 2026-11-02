import type { BattleState } from '../state'
import type { UnitSpec } from './model'
import { isAlive } from './combatMath'

export const LOCK_SHARED_SCALE = 0.5
export const LOCK_SHARED_CAP = 0.15

/** 每次从本舰原值重建，阵亡来源立即退出；自身和队友共享只取高、不相加。 */
export function applyFleetLockAura(specs: UnitSpec[], battle?: BattleState): UnitSpec[] {
  const sources = specs.map(spec => ({ spec,
    own: spec.lockOwnDmgBonus ?? spec.lockedDmgBonus ?? 0,
    chance: spec.lockOwnTargetChance ?? spec.lockTargetChance ?? ((spec.lockedDmgBonus ?? 0) > 0 ? 1 : 0),
  })).filter(row => row.own > 0 && (!battle || isAlive(battle, row.spec.tag)))
  for (const spec of specs) {
    const own = spec.lockOwnDmgBonus ?? spec.lockedDmgBonus ?? 0
    const chance = spec.lockOwnTargetChance ?? spec.lockTargetChance ?? (own > 0 ? 1 : 0)
    // 原值只保存于临时规格，不进入战斗存档。
    spec.lockOwnDmgBonus = own
    spec.lockOwnTargetChance = chance
    spec.lockedDmgBonus = Math.max(own, ...sources.filter(row => row.spec.tag !== spec.tag)
      .map(row => row.spec.lockSharedBonus ?? Math.min(LOCK_SHARED_CAP, row.own * LOCK_SHARED_SCALE)))
    spec.lockTargetChance = Math.max(own > 0 ? chance : 0, ...sources.map(row => row.chance))
  }
  return specs
}
