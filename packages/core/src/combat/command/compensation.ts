import type { GameState } from '../../state'
import { DSI_FACTION_ID, standingOf } from '../../standing'

const SKILL_ID = 'fleet-command-coordination'
const STANDING_TIERS = [40, 60, 80, 100] as const

export function applyLegacyCommandCompensation(state: GameState): void {
  if (state.skills.commandCompensationVersion === 1) return
  state.skills.commandCompensationVersion = 1
  const standing = standingOf(state, DSI_FACTION_ID)
  const level = STANDING_TIERS.filter(threshold => standing >= threshold).length
  const current = state.skills.trained[SKILL_ID] ?? 0
  if (level <= current) return
  state.skills.trained[SKILL_ID] = level
  delete state.skills.savedProgress[SKILL_ID]
  state.skills.queue = state.skills.queue.filter(item => {
    if (item.skillId !== SKILL_ID) return true
    if (item.targetLevel <= level) return false
    item.progressMs = 0
    return true
  })
}
