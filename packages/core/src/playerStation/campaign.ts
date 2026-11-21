export const STATION_STAGE_GOALS = ['settlement', 'industry', 'research', 'expansion', 'crew', 'logistics', 'security', 'defense'] as const
export type StationStageGoal = typeof STATION_STAGE_GOALS[number]
export interface StationCampaign {
  version: 1
  achieved: StationStageGoal[]
  independent: boolean
}
export interface StationCampaignHost { fulfilled(goal: StationStageGoal): boolean }
export function createStationCampaign(): StationCampaign { return { version: 1, independent: false, achieved: [] } }
export function reconcileStationCampaign(state: StationCampaign, host: StationCampaignHost): void {
  for (const goal of STATION_STAGE_GOALS) if (!state.achieved.includes(goal) && host.fulfilled(goal)) state.achieved.push(goal)
  state.achieved.sort((a, b) => STATION_STAGE_GOALS.indexOf(a) - STATION_STAGE_GOALS.indexOf(b))
}
export function declareStationIndependence(state: StationCampaign, host: StationCampaignHost) {
  reconcileStationCampaign(state, host)
  if (state.independent) return { ok: false, reason: 'completed' }
  if (state.achieved.length !== STATION_STAGE_GOALS.length) return { ok: false, reason: 'requirements' }
  // 仅登记阶段成果，不改变声望、共享仓库、蓝图或其他系统的外交状态。
  state.independent = true
  return { ok: true }
}
export function stationCampaignView(state: StationCampaign, host: StationCampaignHost) {
  return { independent: state.independent, goals: STATION_STAGE_GOALS.map(id => ({ id, achieved: state.achieved.includes(id), current: host.fulfilled(id) })),
    canDeclare: !state.independent && STATION_STAGE_GOALS.every(id => state.achieved.includes(id) || host.fulfilled(id)) }
}
export function cleanStationCampaign(value: unknown): StationCampaign {
  const invalid = (): never => { throw new Error('Invalid station campaign snapshot') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const raw = value as StationCampaign
  if (raw.version !== 1 || typeof raw.independent !== 'boolean' || !Array.isArray(raw.achieved)
    || raw.achieved.some(id => !STATION_STAGE_GOALS.includes(id)) || new Set(raw.achieved).size !== raw.achieved.length
    || raw.independent && raw.achieved.length !== STATION_STAGE_GOALS.length) return invalid()
  return { version: 1, independent: raw.independent, achieved: [...raw.achieved] }
}
