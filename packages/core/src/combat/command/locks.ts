import type { GameState } from '../../state'
import type { CoreBlockReason } from '../../engine'
import { busyLabel, type BusyLabel } from '../../busyLabels'

/** 只认实际任务锁；舰员绑定但待命不占船，不反向依赖空间站运行器。 */
export function stationShipTaskBlock(state: GameState, shipId: string): BusyLabel | null {
  return state.playerStation?.shipLocks[shipId]
    ? { error: 'core.playerStationGame.001', errorId: 'core.playerStationGame.001' } : null
}

export function deployedCombatEscorts(state: GameState): readonly string[] {
  const sortie = state.combatEscort
  if (!sortie) return []
  const traveling = !!state.shipReturns[sortie.leaderShipId]
  const withPilot = sortie.leaderShipId === state.shipId && (state.awayGalaxy !== null || state.mining.active || state.salvaging.active || state.hauling.active || state.transit.active || state.standby.active || state.sideTasks.deliver !== null)
  return traveling || withPilot ? sortie.shipIds : []
}

export function encounterCombatRosterOf(state: GameState): string[] {
  const leader = state.encounter.shipId ?? state.shipId
  const escorts = deployedCombatEscorts(state)
  return leader === state.shipId && escorts.includes(leader) ? [...escorts] : [leader]
}

export function commandShipDeployed(state: GameState, shipId: string): boolean {
  if (state.shipReturns[shipId]?.reason === 'expedition') return true
  if ((state.expedition.active || !!state.shipReturns[state.expedition.sortie?.leaderShipId ?? '']) && state.expedition.sortie?.shipIds.includes(shipId)) return true
  if (state.encounter.active && state.encounter.battle?.myFleet?.some(row => row.shipId === shipId)) return true
  return shipId !== state.shipId && deployedCombatEscorts(state).includes(shipId)
}

export function combatEscortBlock(state: GameState, shipIds: readonly string[]): CoreBlockReason | null {
  for (const id of shipIds) {
    const station = stationShipTaskBlock(state, id)
    if (station) return station
    if (id === state.shipId) continue
    if (!state.fleet[id]) return { error: '编队包含重复或不存在的舰船。', errorId: 'core.command.002' }
    if (state.aiAssignments[id]) return busyLabel('aiExpedition')
    if (state.shipReturns[id]) return busyLabel('unload')
    if (deployedCombatEscorts(state).includes(id) && state.combatEscort?.leaderShipId !== state.shipId) return busyLabel('unload')
    if ((state.wormhole.run?.fleet ?? []).includes(id) || (state.wormholeAuto ?? []).some(run => run.shipIds.includes(id))) return busyLabel('wormhole')
    if ((state.planetary?.deliveries ?? []).some(row => row.shipUid === id)) return busyLabel('planetDelivery')
    if ((state.expedition.active || !!state.shipReturns[state.expedition.sortie?.leaderShipId ?? '']) && state.expedition.sortie?.shipIds.includes(id)) return busyLabel('expedition')
    if (state.encounter.active && state.encounter.battle?.myFleet?.some(row => row.shipId === id)) return busyLabel('expCombat')
  }
  return null
}
