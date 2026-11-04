import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { deployedCombatEscorts } from './locks'

/** 活动不再占用实体舰船时释放随行快照；实体卸货由各活动到港路径处理。 */
export function settleCommandEscortsAtPort(state: GameState, ctx: SimContext): void {
  const escort = state.combatEscort
  if (!escort || deployedCombatEscorts(state).length || state.expedition.active || state.encounter.active || state.expedition.sortie) return
  if (state.wormhole.run?.fleet.some(id => escort.shipIds.includes(id))) return
  // 工业采掘/运输结束时释放出勤锁，但不把矿带停采时仍留在舰上的实体货物偷偷卸走。
  // 远征善后有自己的结算路径；这里仅处理活动门禁创建的编队快照。
  delete state.combatEscort
}

/** 全损后补发的驾驶船留在港内，不继承旧队航程和货仓结算。 */
export function finishDestroyedSortie(state: GameState, battle: NonNullable<GameState['expedition']['battle']>): boolean {
  if (!battle.myFleet?.length || battle.myFleet.some(row => state.fleet[row.shipId])) return false
  const exp = state.expedition
  exp.active = false
  exp.battle = null
  exp.anomalyId = null
  exp.phase = 'out'
  exp.finishAtGameMs = 0
  delete exp.sortie
  delete state.combatEscort
  exp.lairTier = undefined
  exp.factionActive = undefined
  exp.eventId = null
  exp.returnReason = undefined
  state.autoLoopAnomalyId = null
  if (state.weekendEvent) delete state.weekendEvent.autoLoopGalaxyId
  state.awayGalaxy = null
  state.dockedSite = null
  return true
}
