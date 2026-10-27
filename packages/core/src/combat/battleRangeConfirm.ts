import type { GameState } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { withBattleRangeConsent } from './battleRangeMemory'
import { startExpedition, startExpeditionFromMining, startLoopBattle, beginBattleAt } from '../expedition'
import { fightEncounter } from '../encounters'
import { weekendStartFlagshipBattle } from '../weekendLaunch'
import { weekendFlagshipSpecOf } from '../weekendBattle'
import { weekendNoteAssaultDispatch } from '../weekendBounty'
import { weekendZoneLiveAt } from '../weekendEvent'
import { wormholeActivateAt, wormholeStartBattle, wormholeTravelTo } from '../wormholeBattle'
import { wormholeResolveEvent } from '../wormholeExpedition'

/** 确认只重放待办中的原指令；真实入口再次校验卡、编队、补给、冷却及射程。 */
export function confirmBattleRange(state: GameState, ctx: SimContext, desireM: number, nowWallMs = Date.now()): CommandResult {
  const pending = state.pendingBattleRange
  if (!pending || !Number.isFinite(desireM) || desireM < ctx.balance.battle.minDistanceM) return { ok: false }
  const i = pending.intent
  return withBattleRangeConsent(state, desireM, () => {
    switch (i.kind) {
      case 'expedition': {
        if (i.invasionSeq !== undefined && (state.weekendEvent?.seq !== i.invasionSeq || !weekendZoneLiveAt(state, i.options?.foeGalaxyId ?? '', nowWallMs))) return { ok: false }
        const result = i.autoRepair ? startLoopBattle(state, i.cardId, ctx, undefined, i.options)
          : (i.fromMining ? startExpeditionFromMining : startExpedition)(state, i.cardId, ctx, i.options)
        if (result.ok && i.invasionSeq !== undefined) weekendNoteAssaultDispatch(state)
        return result
      }
      case 'encounter':
        if (state.encounter.invitedAtGameMs !== i.invitedAtGameMs) return { ok: false }
        return fightEncounter(state, ctx)
      case 'expedition-arrival':
        if (!state.expedition.active || state.expedition.anomalyId !== i.cardId || state.shipId !== i.shipId) return { ok: false }
        return { ok: beginBattleAt(state, ctx, i.cardId, i.shipId, state.gameMs) }
      case 'flagship': {
        const spec = weekendFlagshipSpecOf(state, ctx, nowWallMs)
        if (!spec || spec.cardId !== pending.cardId || state.weekendEvent?.seq !== i.eventSeq) return { ok: false }
        const battle = weekendStartFlagshipBattle(state, ctx, nowWallMs, i.squad)
        if (!battle) return { ok: false, ...(state.pendingBattleRange ? { rangeConfirmation: true } : {}) }
        state.encounter = { active: true, shipId: battle.myFleet?.[0]?.shipId ?? state.shipId, galaxyId: spec.galaxyId,
          name: spec.name, threat: spec.threat, anomalyId: spec.cardId, origin: spec.name,
          invitedAtGameMs: state.gameMs, deadlineGameMs: state.gameMs + ctx.balance.encounter.inviteWaitMs, battle }
        return { ok: true }
      }
      case 'wormhole-fight': return wormholeStartBattle(state, ctx, i.battleKind, state.gameMs, { strengthMul: i.strengthMul })
      case 'wormhole-travel': return wormholeTravelTo(state, ctx, i.target, i.options, state.gameMs)
      case 'wormhole-activate': return wormholeActivateAt(state, ctx, state.gameMs, i.options)
      case 'wormhole-event': return wormholeResolveEvent(state, ctx, i.action, i.expected)
    }
  })
}
