import { addLog, type GameState } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { lairNameOf } from '../lairs'
import { unloadCargoOfShipToWarehouse } from '../inventory'
import { cancelDeparture } from '../departure'

/** 交火不可召回；允许召回的航程按实际出勤名单一起到港卸货。 */
export function recallExpedition(state: GameState, ctx: SimContext): CommandResult {
  const exp = state.expedition
  if (!exp.active) return { ok: false, error: '当前没有进行中的远征。', errorId: 'core.expedition.018' }
  if (exp.phase === 'battle') return { ok: false, error: '交火中无法撤离——请先让战斗分出胜负。', errorId: 'core.expedition.019' }
  if (exp.phase === 'back' && exp.returnReason === 'victory') return {
    ok: false, error: '胜利返航中不可召回——战果已结算，返航（去程并入返航）是本次悬赏的必付航程。', errorId: 'core.expedition.020',
  }
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  const stayedAtPort = cancelDeparture(state, 'expedition')
  const name = anomaly ? exp.lairTier ? lairNameOf(anomaly, exp.lairTier) : anomaly.name : exp.anomalyId ?? '目标'
  const ships = exp.sortie?.shipIds ?? [state.shipId]
  exp.active = false
  exp.anomalyId = null
  exp.battle = null
  exp.lairTier = undefined
  exp.factionActive = undefined
  exp.phase = 'out'
  exp.finishAtGameMs = 0
  exp.eventId = null
  exp.eventFired = false
  delete exp.sortie
  delete state.combatEscort
  state.awayGalaxy = null
  const moved = stayedAtPort ? 0 : ships.reduce((sum, id) => sum + (state.fleet[id] ? unloadCargoOfShipToWarehouse(state, ctx, id) : 0), 0)
  addLog(state, 'fleet', `远征已召回：舰队中止前往「${name}」并返回母港（无战果）${moved > 0 ? `；货仓已自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。` : '。'}`)
  return { ok: true }
}
