import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import { repairWithKitsFor } from '../shipyard'
import { shipDisplayName } from '../instances'
import { pctOf as pct } from '../hullDamage'
import { cancelAiTask } from '../aiCores'
import { stopMining } from '../mining'
import { stopSalvageOp } from '../salvaging'
import { startTransitHome } from '../location'
import { weekendFlagshipEncounterOf } from '../weekendBattle'

export function settleEncounterTail(state: GameState, ctx: SimContext, shipId: string): void {
  const ship = state.fleet[shipId]
  if (!ship) return
  const frac = ctx.balance.encounter.retreatHullFrac
  let outOfKits = false
  if (ship.durability < frac || (ship.armorPct ?? 1) < frac) {
    outOfKits = repairWithKitsFor(state, ctx, shipId, ctx.balance.encounter.repairTargetFrac, 'cargo+warehouse').outOfKits
  }
  const after = state.fleet[shipId]
  const hullLow = !after || after.durability < ctx.balance.encounter.retreatHullFrac
  if (outOfKits) retreatEncounterShip(state, ctx, shipId, hullLow ? 'hull+kits' : 'kits')
  else if (hullLow) retreatEncounterShip(state, ctx, shipId, 'hull')
}

export function settleEncounterFleetTail(state: GameState, ctx: SimContext, shipId: string, battle: GameState['encounter']['battle']): void {
  const members = battle?.myFleet
  if (!members || members.length < 2) { settleEncounterTail(state, ctx, shipId); return }
  let mustReturn = false
  for (const row of members) {
    const ship = state.fleet[row.shipId]
    if (!ship) continue
    const low = ship.durability < ctx.balance.encounter.retreatHullFrac || (ship.armorPct ?? 1) < ctx.balance.encounter.retreatHullFrac
    if (!low) continue
    const projected = { ...state, combatEscort: undefined }
    const repair = repairWithKitsFor(projected, ctx, row.shipId, ctx.balance.encounter.repairTargetFrac, 'cargo+warehouse')
    if (repair.outOfKits || ship.durability < ctx.balance.encounter.retreatHullFrac) mustReturn = true
  }
  if (state.combatEscort?.leaderShipId === shipId && state.shipId !== shipId) {
    state.combatEscort = { ...state.combatEscort, leaderShipId: state.shipId,
      shipIds: state.combatEscort.shipIds.filter(id => state.fleet[id] !== undefined) }
  }
  if (mustReturn && members.some(row => row.shipId === state.shipId)) retreatEncounterShip(state, ctx, state.shipId, 'hull')
}

export function markAmbushRetreat(state: GameState): void {
  if (state.ambushRetreatSeen !== true) state.ambushRetreatSeen = true
}

export function retreatEncounterShip(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  cause: 'hull' | 'kits' | 'hull+kits',
): boolean {
  const ship = state.fleet[shipId]
  if (!ship) return false
  const frac = ctx.balance.encounter.retreatHullFrac
  const name = shipDisplayName(state, ctx, shipId)
  const line =
    cause === 'hull'
      ? `结构低于 ${pct(frac)}%`
      : cause === 'kits'
        ? '修理组件耗尽（未修到目标）'
        : `修理组件耗尽且结构仍低于 ${pct(frac)}%`
  if (shipId !== state.shipId) {
    if (!cancelAiTask(state, shipId, ctx)) return false
    addLog(
      state,
      'warn',
      `⚠ [AI·${name}] ${line}——已中止任务召回回港待命（请维修后再派；此状态下无法再派任务）。`,
      'core.encounters.001',
      { p1: name, p2: line },
    )
    markAmbushRetreat(state)
    return true
  }
  if (state.mining.active) stopMining(state, ctx)
  if (state.salvaging.active) stopSalvageOp(state, ctx)
  let home = state.awayGalaxy === null
  if (!home && !state.expedition.active) {
    const r = startTransitHome(state, ctx)
    home = r.ok || state.awayGalaxy === null
  }
  addLog(
    state,
    'warn',
    home
      ? `⚠ ${name} ${line}——已自动停手返港（回港后请及时维修）。`
      : `⚠ ${name} ${line}——已自动停手，正在返航途中（到港后请及时维修）。`,
  )
  markAmbushRetreat(state)
  return true
}

export function clearEncounter(state: GameState): void {
  state.encounter = {
    active: false,
    shipId: null,
    galaxyId: null,
    name: '',
    threat: 0,
    anomalyId: null,
    origin: '',
    invitedAtGameMs: 0,
    deadlineGameMs: 0,
    battle: null,
  }
}

export function weekendKindOfEncounter(state: GameState, enc: GameState['encounter']): 'ambush' | 'flagship' {
  return weekendFlagshipEncounterOf(state, enc) ? 'flagship' : 'ambush'
}
