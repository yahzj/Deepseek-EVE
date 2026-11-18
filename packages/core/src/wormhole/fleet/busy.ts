import type { GameState } from '../../state'
import { busyLabel, type BusyLabel } from '../../busyLabels'
import { commandShipDeployed } from '../../combat/command/locks'

export function shipBusyForWormhole(state: GameState, shipId: string): BusyLabel | null {
  if ((state.wormhole.run?.fleet ?? []).includes(shipId)) return busyLabel('wormhole')
  return shipActivityBusy(state, shipId)
}

export function shipActivityBusy(state: GameState, shipId: string): BusyLabel | null {
  if (commandShipDeployed(state, shipId)) return busyLabel('expedition')
  if (state.shipReturns[shipId]) return busyLabel('unload')
  if ((state.planetary?.deliveries ?? []).some(d => d.shipUid === shipId)) return busyLabel('planetDelivery')
  if (shipId !== state.shipId) {
    const task = state.aiAssignments[shipId]?.task
    if (!task) return null
    if (task.kind === 'mining') return busyLabel('aiMining')
    if (task.kind === 'standby') return busyLabel('aiPatrol')
    return busyLabel('aiExpedition')
  }
  if (state.mining.active) return busyLabel('mining')
  if (state.salvaging.active) return busyLabel('salvage')
  if (state.hauling.active) return busyLabel('hauling')
  if (state.sideTasks.deliver !== null) return busyLabel('courier')
  if (state.standby.active) return busyLabel('patrol')
  if (state.wormholeScan?.active === true) return busyLabel('whscan')
  if (state.expedition.active) return busyLabel('expedition')
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return busyLabel('refine')
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return busyLabel('manufacture')
  if ((state.labRuns ?? []).some((r) => r.active && r.worker === 'pilot')) return busyLabel('lab')
  if (state.transit.active && state.transit.delivery !== null) return busyLabel('deliver')
  return null
}
