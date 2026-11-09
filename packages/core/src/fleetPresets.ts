import type { GameState } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { shipDisplayName } from './instances'
import { shipActuallyDocked, shipOperationBlockReason } from './shipActionPolicy'
import { changeShip, changeShipBlockReason } from './shipyard'
import { commandBudgetOf, COMBAT_MAX_SHIPS } from './combat/command/rules'
import { combatRosterOf } from './combat/command/roster'
import { notePreparationSquad } from './preparationSquads'

export const FLEET_PRESET_MAX = 10
export const FLEET_PRESET_NAME_MAX = 32
export function defaultFleetPresetName(presets: readonly Pick<FleetPreset, 'name'>[]): string {
  let index = 1
  while (presets.some(preset => preset.name === `预设编队${index}`)) index++
  return `预设编队${index}`
}

export interface FleetPreset {
  id: string
  name: string
  leaderShipId: string
  shipIds: string[]
}

/** 缺舰引用保留供套用时报错；不把坏数组截成一支不同的编队。 */
export function cleanFleetPresets(value: unknown): FleetPreset[] {
  if (!Array.isArray(value)) return []
  const out: FleetPreset[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id.trim().slice(0, 64) : ''
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, FLEET_PRESET_NAME_MAX) : ''
    if (!id || !name || out.some(p => p.id === id || p.name === name)) continue
    if (typeof row.leaderShipId !== 'string' || !Array.isArray(row.shipIds)) continue
    const ids = row.shipIds
    if (!ids.length || ids.length > COMBAT_MAX_SHIPS || ids.some(id => typeof id !== 'string' || !id.length || id.length > 128)
      || new Set(ids).size !== ids.length || ids[0] !== row.leaderShipId) continue
    out.push({ id, name, leaderShipId: row.leaderShipId, shipIds: [...ids] as string[] })
    if (out.length === FLEET_PRESET_MAX) break
  }
  return out
}

function reject(id: string, params?: Record<string, string | number>): CommandResult {
  return { ok: false, error: id, errorId: id, errorParams: params }
}

function fleetIdle(state: GameState, ctx: SimContext): CommandResult {
  const blocked = shipOperationBlockReason(state, ctx, state.shipId, 'configure')
  if (blocked) return { ok: false, ...blocked }
  if (state.encounter.active || state.departure || state.pendingStationActivity || !shipActuallyDocked(state, ctx)) return reject('core.fleetPreset.001')
  return { ok: true }
}

export function saveFleetPreset(state: GameState, ctx: SimContext, name: string, replaceId?: string): CommandResult {
  const idle = fleetIdle(state, ctx)
  if (!idle.ok) return idle
  const list = state.fleetPresets ?? []
  const requestedName = name.trim().slice(0, FLEET_PRESET_NAME_MAX)
  const finalName = requestedName || (replaceId ? '' : defaultFleetPresetName(list))
  if (!finalName) return reject('core.fleetPreset.002')
  if (replaceId && !list.some(p => p.id === replaceId)) return reject('core.fleetPreset.003')
  if (list.some(p => p.id !== replaceId && p.name === finalName)) return reject('core.fleetPreset.004')
  if (!replaceId && list.length >= FLEET_PRESET_MAX) return reject('core.fleetPreset.005', { p1: FLEET_PRESET_MAX })
  const ids = combatRosterOf(state)
  const budget = commandBudgetOf(state, ctx, ids)
  if (!budget.ok) return { ...budget, ok: false }
  let seq = 1
  while (list.some(p => p.id === `fleet-${seq}`)) seq++
  const preset: FleetPreset = { id: replaceId ?? `fleet-${seq}`, name: finalName, leaderShipId: state.shipId, shipIds: [...ids] }
  state.fleetPresets = replaceId ? list.map(p => p.id === replaceId ? preset : p) : [...list, preset]
  return { ok: true }
}

export function renameFleetPreset(state: GameState, id: string, name: string): CommandResult {
  const list = state.fleetPresets ?? []
  if (!list.some(p => p.id === id)) return reject('core.fleetPreset.003')
  const finalName = name.trim().slice(0, FLEET_PRESET_NAME_MAX)
  if (!finalName) return reject('core.fleetPreset.002')
  if (list.some(p => p.id !== id && p.name === finalName)) return reject('core.fleetPreset.004')
  state.fleetPresets = list.map(p => p.id === id ? { ...p, name: finalName } : p)
  return { ok: true }
}

export function deleteFleetPreset(state: GameState, id: string): CommandResult {
  const list = state.fleetPresets ?? []
  if (!list.some(p => p.id === id)) return reject('core.fleetPreset.003')
  const next = list.filter(p => p.id !== id)
  if (next.length) state.fleetPresets = next
  else delete state.fleetPresets
  return { ok: true }
}

/** 所有拒因先收齐；成功后只走正式换驾驶与编队记忆入口，不动装配或货物。 */
export function applyFleetPreset(state: GameState, ctx: SimContext, id: string): CommandResult {
  const preset = state.fleetPresets?.find(p => p.id === id)
  if (!preset) return reject('core.fleetPreset.003')
  const idle = fleetIdle(state, ctx)
  if (!idle.ok) return idle
  const issues: string[] = []
  for (const uid of preset.shipIds) {
    if (!state.fleet[uid]) { issues.push(uid); continue }
    const blocked = shipOperationBlockReason(state, ctx, uid, 'configure')
    if (blocked || !shipActuallyDocked(state, ctx, uid)) issues.push(shipDisplayName(state, ctx, uid))
  }
  if (issues.length) return reject('core.fleetPreset.006', { p1: issues.join(' / ') })
  const budget = commandBudgetOf(state, ctx, preset.shipIds)
  if (!budget.ok) return { ...budget, ok: false }
  if (preset.leaderShipId !== state.shipId) {
    const blocked = changeShipBlockReason(state, preset.leaderShipId, ctx)
    if (blocked) return { ok: false, ...blocked }
    const result = changeShip(state, preset.leaderShipId, ctx)
    if (!result.ok) return result
  }
  notePreparationSquad(state, 'combat', preset.shipIds, ctx)
  return { ok: true }
}
