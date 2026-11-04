import { createInitialState } from '../../src/state'

/** 非门槛专项的多舰夹具：只补指挥资格，不改变原有战斗技能。 */
export function createCommandReadyState(options: Parameters<typeof createInitialState>[0]) {
  const state = createInitialState(options)
  state.standingsEarned = { ...state.standingsEarned, dsi: 20 }
  state.skills.trained['fleet-command-basic'] = 5
  state.skills.trained['fleet-command-coordination'] = 5
  state.skills.trained['fleet-command-integration'] = 5
  return state
}
