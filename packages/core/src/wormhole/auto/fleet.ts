import type { GameState } from '../../state'
import { shipLockedInWormhole, wormholeAutoRunsOf } from '../../state'
import type { SimContext } from '../../types'
import type { CoreBlockReason } from '../../engine'
import { busyLabel } from '../../busyLabels'
import { wormholeAdmission, WORMHOLE_ADMISSION_TEXT } from '../fleet/admission'
import { commandShipDeployed, stationShipTaskBlock } from '../../combat/command/locks'
import { combatShipLimit, commandBudgetOf } from '../../combat/command/rules'
const WORMHOLE_AUTO_MAX_SHIPS = combatShipLimit(true)

export function wormholeAutoShipBlockReason(
  state: GameState,
  shipId: string,
  opts?: { mainMayJoin?: boolean },
): CoreBlockReason | null {
  const station = stationShipTaskBlock(state, shipId)
  if (station) return station
  const ship = state.fleet[shipId]
  if (commandShipDeployed(state, shipId)) return busyLabel('expedition')
  if (state.shipReturns[shipId]) return busyLabel('unload')
  if ((state.planetary?.deliveries ?? []).some(row => row.shipUid === shipId)) return busyLabel('planetDelivery')
  if (!ship) return { error: '舰队里没有这艘船。', errorId: 'core.wormholeAuto.004' }
  if (shipId === state.shipId && !opts?.mainMayJoin)
    return { error: '主控船不参与自动探索（主控要留在站内）。', errorId: 'core.wormholeAuto.005' }
  if (shipLockedInWormhole(state, shipId)) return { error: '该舰在虫洞里：等它出洞再派。', errorId: 'core.wormholeAuto.006' }
  if (state.aiAssignments[shipId]) return { error: '该舰已在别的 AI 副船任务里：先撤回它。', errorId: 'core.wormholeAuto.007' }
  if (wormholeAutoRunsOf(state).some(run => run.shipIds.includes(shipId))) return { error: '该舰已在另一处虫洞的自动探索里。', errorId: 'core.wormholeAuto.008' }
  return null
}

export interface WormholeAutoCandidate {
  shipId: string
  name: string
  picked: boolean
  blocked: CoreBlockReason | null
}

export function wormholeAutoScore(state: GameState, ctx: SimContext, shipId: string): number {
  const ship = state.fleet[shipId]!
  const def = ctx.ships.get(ship.defId ?? shipId)
  let guns = 0
  for (const id of ship.fitted?.high ?? []) {
    if (!id) continue
    const slot = ctx.modules.get(id)?.slot
    if (slot === 'turret' || slot === 'missile' || slot === 'laser' || slot === 'drone-rack' || slot === 'drone-tac') guns += 1
  }
  return guns * 100 + Math.round((ship.durability ?? 1) * 10) * 5 + (def?.tier ?? 1) * 3
}

export function wormholeAutoCandidates(state: GameState, ctx: SimContext, exclude?: readonly string[]): WormholeAutoCandidate[] {
  const skip = new Set(exclude ?? [])
  const rows: Array<{ shipId: string; name: string; score: number; blocked: CoreBlockReason | null }> = []
  for (const shipId of Object.keys(state.fleet)) {
    if (skip.has(shipId)) continue
    const ownBlock = wormholeAutoShipBlockReason(state, shipId)
    const singleAdmission = wormholeAdmission(ctx, [shipId])
    const blocked = ownBlock ?? (singleAdmission.ok ? null : { error: WORMHOLE_ADMISSION_TEXT[singleAdmission.code] })
    rows.push({ shipId, name: shipNameOf(state, ctx, shipId), score: wormholeAutoScore(state, ctx, shipId), blocked })
  }
  rows.sort((a, b) => b.score - a.score || a.shipId.localeCompare(b.shipId))
  let picked = 0
  const budget = WORMHOLE_AUTO_MAX_SHIPS
  const pickedIds: string[] = []
  return rows.map((r) => {
    if (r.blocked !== null || picked >= budget) return { shipId: r.shipId, name: r.name, picked: false, blocked: r.blocked }
    const admission = wormholeAdmission(ctx, [...pickedIds, r.shipId])
    if (!admission.ok || !commandBudgetOf(state, ctx, [...pickedIds, r.shipId], true).ok) {
      return {
        shipId: r.shipId,
        name: r.name,
        picked: false,
        blocked: r.blocked,
      }
    }
    picked += 1
    pickedIds.push(r.shipId)
    return { shipId: r.shipId, name: r.name, picked: true, blocked: null }
  })
}

export function wormholeAutoDefaultShips(state: GameState, ctx: SimContext): string[] {
  return wormholeAutoCandidates(state, ctx)
    .filter((c) => c.picked)
    .map((c) => c.shipId)
}

export function shipNameOf(state: GameState, ctx: SimContext, shipId: string): string {
  const ship = state.fleet[shipId]
  if (!ship) return shipId
  return ship.customName ?? ctx.ships.get(ship.defId ?? shipId)?.name ?? shipId
}
