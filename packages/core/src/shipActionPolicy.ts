import type { GameState } from './state'
import type { SimContext } from './types'
import type { CoreBlockReason } from './engine'
import { busyLabel } from './busyLabels'
import { mainActivityOf } from './activityGate'
import { shipDisplayName } from './instances'

export type ShipOperation = 'cargo' | 'repair' | 'configure'

/** 只读目标舰账本，不调用库存、位置切换或战斗模块。 */
function physicalBusy(state: GameState, shipId: string, ctx?: SimContext): CoreBlockReason | null {
  if ((state.planetary?.deliveries ?? []).some(d => d.shipUid === shipId)) return busyLabel('planetDelivery')
  if ((state.wormhole.run?.fleet ?? []).includes(shipId) || shipId === state.shipId && state.wormhole.run != null) return busyLabel('wormhole')
  if ((state.wormholeAuto ?? []).some(run => run.shipIds.includes(shipId))) return busyLabel('wormhole')
  if (state.shipReturns[shipId]) return busyLabel('unload')
  if (state.encounter.active && (state.encounter.shipId === shipId || state.encounter.battle?.myFleet?.some(entry => entry.shipId === shipId))) return busyLabel('expCombat')
  if (state.expedition.battle?.myFleet?.some(entry => entry.shipId === shipId)) return busyLabel('expCombat')
  const assignment = state.aiAssignments[shipId]
  if (assignment) {
    const task = assignment.task
    if (task.kind === 'mining') return busyLabel('aiMining')
    if (task.kind === 'standby') return busyLabel('aiPatrol')
    return busyLabel('aiExpedition')
  }
  if (shipId !== state.shipId) return null
  if (state.expedition.active || state.expedition.battle !== null) return busyLabel('expedition')
  if (state.mining.active) return busyLabel('mining')
  if (state.salvaging.active) return busyLabel('salvage')
  if (state.hauling.active) return busyLabel('hauling')
  if (state.sideTasks.deliver !== null) return busyLabel('courier')
  if (state.transit.active) return busyLabel('deliver')
  if (state.standby.active) return busyLabel('patrolTo', { p1: ctx?.galaxies.get(state.standby.galaxyId ?? '')?.name ?? state.standby.galaxyId ?? '' })
  return null
}

/** 副船空闲即停在基地；主控还须合法基地位置且没有实体出勤。 */
export function shipActuallyDocked(state: GameState, ctx: SimContext, shipId = state.shipId): boolean {
  if (!state.fleet[shipId] || physicalBusy(state, shipId, ctx)) return false
  if (shipId !== state.shipId) return true
  if (state.awayGalaxy !== null) return false
  if (state.dockedSite === null) return true
  const site = ctx.stations.get(state.dockedSite)
  return !!site && (state.stationSites[site.id]?.stage ?? 0) >= site.tiers.length
}

/** 实体操作按目标舰，不把主控在外作业扩大为全队限制。 */
export function shipOperationBlockReason(state: GameState, ctx: SimContext | undefined, shipId: string, operation: ShipOperation): CoreBlockReason | null {
  if (!state.fleet[shipId]) return { error: '舰队里找不到这艘舰船。', errorId: 'core.plug.003' }
  const busy = physicalBusy(state, shipId, ctx)
  if (busy) return busy
  if (operation === 'configure') {
    if (shipId === state.shipId) {
      const current = mainActivityOf(state)
      if (current === 'wormholeScan') return busyLabel('whscan')
      if (current === 'refine') return busyLabel('refine')
      if (current === 'manufacturing') return busyLabel('manufacture')
      if (current === 'lab') return busyLabel('lab')
    }
    return null
  }
  if (ctx && shipActuallyDocked(state, ctx, shipId)) return null
  if (operation === 'repair') {
    const construction = shipId === state.shipId && state.awayGalaxy === null && state.dockedSite !== null
    const name = construction
      ? ctx?.stations.get(state.dockedSite!)?.name ?? state.dockedSite!
      : ctx ? shipDisplayName(state, ctx, shipId) : shipId
    return {
      error: construction
        ? `「${name}」尚未建成：工地不提供停靠与服务，维修需在母港或已建成的副站进行。`
        : `${name} 不在空间站（野外/掩护巡逻途中）——返航后才能维修。`,
      errorId: construction ? 'core.shipyard.043' : 'core.shipyard.042',
      errorParams: { p1: name },
    }
  }
  return { error: '舰船在野外：卸货需停靠空间站（母港或副站，可先「返航空间站」）。', errorId: 'ui.CargoPage.025' }
}
