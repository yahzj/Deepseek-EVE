import type { GameState, BattleState } from '../../state'
import type { SimContext } from '../../types'
import { persistFleetHullDamage, settleDroneLosses } from '../losses'
import { sunkShipIdsOfBattle } from '../combatReport'
import { loseShip } from '../../shipyard'
import type { DroneLossReport } from '../state/report'
import { addLog, DEFAULT_START_SHIP_ID } from '../../state'
import { addShipToFleet } from '../../fleetBook'
import { shipOperationBlockReason } from '../../shipActionPolicy'
import { shipDisplayName } from '../../instances'
import { droneRevivedOf } from '../../droneRevive'
import { takeDroneUnit } from '../../equipment'

/** 同队幸存者优先；全损只选港内空闲舰，不能接管其他任务中的船。 */
export function prepareCommandPilotAfterLoss(state: GameState, ctx: SimContext, sunk: readonly string[], battle: BattleState | null): void {
  if (!sunk.includes(state.shipId)) return
  const survivor = battle?.myFleet?.find(row => !sunk.includes(row.shipId) && state.fleet[row.shipId])?.shipId
  const idle = survivor ?? Object.keys(state.fleet).find(id => !sunk.includes(id) && shipOperationBlockReason(state, ctx, id, 'configure') === null)
  if (!survivor && state.combatEscort?.leaderShipId === state.shipId) {
    state.mining.active = false
    state.salvaging.active = false
    state.hauling.active = false
    state.standby.active = false
    state.transit.active = false
    state.sideTasks.deliver = null
    state.awayGalaxy = null
    state.dockedSite = null
    delete state.combatEscort
  }
  state.shipId = idle ?? addShipToFleet(state, DEFAULT_START_SHIP_ID)
  if (survivor && state.expedition.sortie) state.expedition.sortie.leaderShipId = survivor
  if (idle) addLog(state, 'fleet', '', 'core.shipyard.023', { p1: shipDisplayName(state, ctx, idle) })
  else addLog(state, 'fleet', '', 'core.shipyard.024')
}

export function settleCommandFleet(state: GameState, ctx: SimContext, battle: BattleState): string {
  const text: string[] = []
  const reports: DroneLossReport[] = []
  let survivors = 0
  state.droneLossReport = null
  // 先结清整队战中复位的实物，才允许任何一舰战后自动补货。
  for (const row of battle.myFleet ?? []) {
    if (battle.droneRevive?.[row.tag]?.printing) continue
    const lost = battle.droneLostBy ? battle.droneLostBy[row.tag] : row.tag === 'player' ? battle.droneLost : undefined
    if (!lost || !Object.values(lost).some(n => n > 0)) continue
    for (const [id, n] of Object.entries(droneRevivedOf(battle, row.tag))) {
      for (let i = 0; i < n; i++) if (takeDroneUnit(state, row.shipId, id) === null) break
    }
  }
  for (const row of battle.myFleet ?? []) {
    let report: DroneLossReport | undefined
    const loss = settleDroneLosses(state, ctx, row.shipId, battle, 0, row.tag, value => { report = value; reports.push(value) }, true)
    survivors += report?.survivors ?? Object.values(battle.droneLoadAtStartBy?.[row.tag] ?? {}).reduce((sum, n) => sum + n, 0)
    if (loss) text.push(loss)
    persistFleetHullDamage(state, ctx, row.shipId, battle)
  }
  if (reports.length) {
    const summary: DroneLossReport = { battleStartedAtGameMs: battle.startedAtGameMs, rate: reports[0]!.rate,
      total: 0, recovered: 0, gone: 0, survivors, revived: 0, rows: [] }
    const rows = new Map<string, DroneLossReport['rows'][number]>()
    for (const report of reports) {
      summary.total += report.total
      summary.recovered += report.recovered
      summary.gone += report.gone
      summary.revived! += report.revived ?? 0
      for (const row of report.rows) {
        const old = rows.get(row.id)
        if (old) { old.lost += row.lost; old.back += row.back; old.gone += row.gone }
        else rows.set(row.id, { ...row })
      }
    }
    summary.rows = [...rows.values()].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    state.droneLossReport = summary
  }
  return text.join('、')
}
/** 战报落盘之后处理沉船，原名单继续锁定存活舰直到返航。 */
export function loseCommandSunkShips(state: GameState, ctx: SimContext, battle: BattleState, galaxyId: string): void {
  const sunk = sunkShipIdsOfBattle(battle, state.shipId)
  if (sunk.length) {
    state.autoLoopAnomalyId = null
    if (state.weekendEvent) delete state.weekendEvent.autoLoopGalaxyId
  }
  prepareCommandPilotAfterLoss(state, ctx, sunk, battle)
  // 驾驶舰最后移除，避免自动补驾驶反复选到同场已沉舰。
  sunk.sort((a, b) => Number(a === state.shipId) - Number(b === state.shipId))
  for (const id of sunk) {
    if (state.fleet[id]) loseShip(state, id, ctx, '战斗中被击沉', galaxyId, { cause: 'expedition-lost' })
  }
}
