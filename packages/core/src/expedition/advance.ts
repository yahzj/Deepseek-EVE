import { type GameState, addLog, HOME_GALAXY_ID } from '../state'
import type { SimContext } from '../types'
import { maybeFireTravelEvent, returnBaseGalaxy, landAtReturnBase } from './travel'
import { beginBattleAt } from './launch'
import { advanceBattleFor, battleClockNowMs, battleShowWindowMs } from '../combat'
import { settleBattleRetreat } from './retreat'
import { weekendApplyBattleOutcome } from '../weekendBattle'
import { resolveBattleOutcome } from './outcome'
import { unloadCargoOfShipToWarehouse } from '../inventory'
import { detachExpeditionReturn, settleCommandEscortsAtPort } from '../combat/command/return'

export function advanceExpedition(state: GameState, ctx: SimContext, freezeBattle = false): void {
  const exp = state.expedition
  detachExpeditionReturn(state)
  settleCommandEscortsAtPort(state, ctx)
  if (!exp.active && exp.sortie) {
    if (state.shipReturns[exp.sortie.leaderShipId]) return
    const ids = exp.sortie.shipIds
    delete exp.sortie
    for (const id of ids) if (state.fleet[id]) unloadCargoOfShipToWarehouse(state, ctx, id)
  }
  for (let guard = 0; guard < 6; guard++) {
    if (!exp.active) return
    if (exp.phase === 'out') {
      if (state.departure?.kind === 'expedition') return
      maybeFireTravelEvent(state, ctx)
      if (state.gameMs < exp.finishAtGameMs) return
      const ok = beginBattleAt(state, ctx, exp.anomalyId ?? '', state.shipId, exp.finishAtGameMs)
      if (!ok) {
        if (state.pendingBattleRange) return
        exp.active = false
        delete exp.sortie
        exp.anomalyId = null
        exp.battle = null
        exp.lairTier = undefined
        exp.factionActive = undefined
        addLog(state, 'warn', '远征目标已不存在，舰队无功而返（异常）。', 'core.expedition.030')
        return
      }
      continue
    }
    if (exp.phase === 'battle') {
      if (!exp.battle) {
        const ok = beginBattleAt(state, ctx, exp.anomalyId ?? '', state.shipId, state.gameMs)
        if (!ok) {
          if (state.pendingBattleRange) return
          exp.active = false
          delete exp.sortie
          exp.anomalyId = null
          exp.lairTier = undefined
          exp.factionActive = undefined
          addLog(state, 'warn', '远征目标已不存在，舰队无功而返（异常）。', 'core.expedition.030')
          return
        }
        continue
      }
      if (freezeBattle) {
        const now = state.gameMs
        const owed = Math.max(0, now - (exp.battle.lastTickGameMs ?? now))
        if (owed > 0) {
          exp.battle.lastTickGameMs = now
          exp.battle.startedAtGameMs += owed
        }
        return
      }
      advanceBattleFor(state, ctx, exp.battle, state.shipId, exp.anomalyId, null, exp.lairTier)
      if (exp.battle.autoEscaped) {
        settleBattleRetreat(
          state,
          ctx,
          exp.battle.escapeReason === 'timeout'
            ? 'timeout'
            : exp.battle.escapeReason === 'cannot-engage'
              ? 'cannot-engage'
              : 'auto',
        )
        if (!exp.active) return
        continue
      }
      if (exp.battle.ended) {
        const bal = ctx.balance.battle
        if (battleClockNowMs(state, exp.battle) - exp.battle.lastTickGameMs < battleShowWindowMs(exp.battle, bal.killcamMs)) return
        weekendApplyBattleOutcome(
          state,
          ctx,
          state.expedition.anomalyId ?? null,
          state.expedition.battle?.ended === 'me',
          state.wallMs ?? Date.now(),
          state.expedition.battle,
        )
        resolveBattleOutcome(state, ctx)
        continue
      }
      return
    }
    if (state.gameMs < exp.finishAtGameMs) return
    const wasVictoryReturn = exp.returnReason === 'victory'
    const targetGal = exp.foeGalaxyId ?? (exp.anomalyId ? ctx.anomalies.get(exp.anomalyId)?.galaxyId ?? null : null)
    const base = targetGal !== null ? returnBaseGalaxy(state, ctx, targetGal) : HOME_GALAXY_ID
    landAtReturnBase(state, ctx, base)
    const returnShips = exp.sortie?.shipIds ?? [state.shipId]
    delete exp.sortie
    delete state.combatEscort
    exp.active = false
    const moved = returnShips.reduce((sum, id) => sum + (state.fleet[id] ? unloadCargoOfShipToWarehouse(state, ctx, id) : 0), 0)
    exp.anomalyId = null
    exp.battle = null
    exp.phase = 'out'
    exp.finishAtGameMs = 0
    exp.returnReason = undefined
    exp.lairTier = undefined
    exp.factionActive = undefined
    const siteName = state.dockedSite !== null ? ctx.stations.get(state.dockedSite)?.name ?? state.dockedSite : null
    const unloadedNote = moved > 0 ? `货仓已自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。` : ''
    addLog(
      state,
      'combat',
      wasVictoryReturn
        ? siteName
          ? `悬赏战果已携回「${siteName}」并自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）——可维修或补给后再次出击。`
          : `悬赏战果已携回母港并自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）——可维修或补给后再次出击。`
        : siteName
          ? `远征结束，舰队已停靠「${siteName}」（副空间站）。${unloadedNote}`
          : `远征结束，舰队已停靠母港。${unloadedNote}`,
      wasVictoryReturn
        ? siteName
          ? 'core.expedition.057'
          : 'core.expedition.058'
        : siteName
          ? 'core.expedition.059'
          : 'core.expedition.060',
      wasVictoryReturn
        ? siteName
          ? { p1: siteName, p2: moved.toLocaleString('zh-CN') }
          : { p1: moved.toLocaleString('zh-CN') }
        : siteName
          ? {
              p1: siteName,
              p2: unloadedNote,
              ...(unloadedNote !== ''
                ? { p2Id: 'core.expedition.061', p2p1: moved.toLocaleString('zh-CN') }
                : {}),
            }
          : {
              p1: unloadedNote,
              ...(unloadedNote !== ''
                ? { p1Id: 'core.expedition.061', p1p1: moved.toLocaleString('zh-CN') }
                : {}),
            },
    )
    return
  }
}
