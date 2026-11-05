import type { GameState } from '../../state'
import { DSI_FACTION_ID, standingOf } from '../../standing'

const SKILL_ID = 'fleet-command-coordination'
const STANDING_TIERS = [40, 60, 80, 100] as const

/** 船长2026-11-05指定：当前可读旧档一次性补至对应等级，新档不参与。 */
export function applyLegacyCommandCompensation(state: GameState): void {
  if (state.skills.commandCompensationVersion === 1) return
  state.skills.commandCompensationVersion = 1
  const standing = standingOf(state, DSI_FACTION_ID)
  const level = STANDING_TIERS.filter(threshold => standing >= threshold).length
  const current = state.skills.trained[SKILL_ID] ?? 0
  if (level <= current) return
  state.skills.trained[SKILL_ID] = level
  delete state.skills.savedProgress[SKILL_ID]
  // 原进度对应旧的下一等级，已被补偿覆盖，不能移用到补偿后的下一等级。
  state.skills.queue = state.skills.queue.filter(item => {
    if (item.skillId !== SKILL_ID) return true
    if (item.targetLevel <= level) return false
    item.progressMs = 0
    return true
  })
}
