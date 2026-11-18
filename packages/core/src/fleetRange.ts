import type { GameState, BattleState } from './state'
import type { CommandResult } from './engine'
import type { SimContext } from './types'
import { combatRosterOf } from './combat/command/roster'

import { sameFleetRangeRoster, type FleetRangeSettings } from './fleetRangeSettings'
export { sameFleetRangeRoster, cleanFleetRangePreference, cleanFleetRangeSettings, type FleetRangePreference, type FleetRangeSettings } from './fleetRangeSettings'

/** 当前编队默认距离；临时改名单保留同主控的默认米数，但解除预设绑定。 */
export function fleetRangeOf(state: GameState, shipIds: readonly string[] = combatRosterOf(state)): FleetRangeSettings | undefined {
  const current = state.fleetRange
  if (!current || current.shipIds[0] !== shipIds[0]) return undefined
  const exact = sameFleetRangeRoster(current.shipIds, shipIds)
  const preset = exact ? state.fleetPresets?.find(row => row.id === current.presetId && sameFleetRangeRoster(row.shipIds, shipIds)) : undefined
  return { ...(current.desireM !== undefined ? { desireM: current.desireM } : {}),
    ...(current.maxRangeM !== undefined ? { maxRangeM: current.maxRangeM } : {}), shipIds: [...current.shipIds],
    ...(preset ? { presetId: preset.id } : {}) }
}

/** 只改默认偏好，不改实际驾驶、在途战斗或成员；null表示自动距离。 */
export function setFleetRange(state: GameState, ctx: SimContext, desireM: number | null, presetId?: string): CommandResult {
  if (desireM !== null && (!Number.isSafeInteger(desireM) || desireM < ctx.balance.battle.minDistanceM))
    return { ok: false, errorId: 'core.fleetRange.001', errorParams: { p1: ctx.balance.battle.minDistanceM } }
  const preference = desireM === null ? {} : { desireM }
  if (presetId !== undefined) {
    const preset = state.fleetPresets?.find(row => row.id === presetId)
    if (!preset) return { ok: false, errorId: 'core.fleetPreset.003' }
    preset.range = { ...(preset.range?.maxRangeM !== undefined ? { maxRangeM: preset.range.maxRangeM } : {}), ...preference }
    if (fleetRangeOf(state)?.presetId === presetId) state.fleetRange = { ...state.fleetRange!, desireM: desireM ?? undefined }
  } else {
    const current = fleetRangeOf(state)
    state.fleetRange = { ...(current?.maxRangeM !== undefined ? { maxRangeM: current.maxRangeM } : {}),
      ...preference, shipIds: current?.shipIds ?? combatRosterOf(state) }
  }
  return { ok: true }
}

/** 明确保存本场距离到出发时绑定的预设；名单变化不能误覆盖。 */
export function saveBattleFleetRange(state: GameState, ctx: SimContext, battle: BattleState | null | undefined): CommandResult {
  const memory = battle?.rangeMemory
  const preset = state.fleetPresets?.find(row => row.id === memory?.fleetPresetId)
  if (!battle || !memory || memory.sourceVersion !== 1 || !preset || !memory.shipIds || !sameFleetRangeRoster(preset.shipIds, memory.shipIds))
    return { ok: false, errorId: 'core.fleetRange.002' }
  const result = setFleetRange(state, ctx, Math.round(battle.myDesireM), preset.id)
  if (result.ok) {
    preset.range = { ...preset.range, maxRangeM: memory.maxRangeM }
    if (fleetRangeOf(state)?.presetId === preset.id) state.fleetRange!.maxRangeM = memory.maxRangeM
  }
  return result
}
