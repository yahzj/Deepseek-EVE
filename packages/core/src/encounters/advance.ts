import type { GameState } from '../state'
import type { SimContext } from '../types'
import { maintainPresence, foeKeyOf } from './presence'
import { settleEncounterBattle, settleEscape } from './outcome'
import { advanceBattleFor } from '../combat'
import { weekendFlagshipEncounterOf, weekendNoteFlagshipPlayerKill, weekendApplyBattleOutcome } from '../weekendBattle'
import { weekendKindOfEncounter } from './return'
import { resolveTextual } from './textual'

export function advanceEncounterWatch(state: GameState, ctx: SimContext, _deltaMs: number, freezeBattle = false): void {
  if (state.departure?.kind === 'flagship') return
  maintainPresence(state, ctx)
  const enc = state.encounter
  if (enc.active) {
    if (enc.battle) {
      if (enc.battle.ended) {
        if ((enc.pirate || enc.automatic) && enc.battle.ended !== 'me' && enc.battle.lastTickGameMs - enc.battle.startedAtGameMs >= ctx.balance.battle.maxBattleMs) {
          settleEscape(state, ctx)
          return
        }
        settleEncounterBattle(state, ctx, enc)
        return
      }
      if (freezeBattle) {
        const now = state.gameMs
        const owed = Math.max(0, now - (enc.battle.lastTickGameMs ?? now))
        if (owed > 0) {
          enc.battle.lastTickGameMs = now
          enc.battle.startedAtGameMs += owed
        }
        return
      }
      advanceBattleFor(state, ctx, enc.battle, enc.shipId ?? state.shipId, foeKeyOf(enc), null)
      if (weekendFlagshipEncounterOf(state, enc)) {
        weekendNoteFlagshipPlayerKill(state, enc.battle, Date.now())
      }
      if (enc.battle.autoEscaped) {
        weekendApplyBattleOutcome(state, ctx, enc.anomalyId ?? null, false, Date.now(), enc.battle, {
          kind: weekendKindOfEncounter(state, enc),
          galaxyId: enc.galaxyId ?? '',
          source: 'battle',
        })
        settleEscape(state, ctx)
        return
      }
      if (enc.battle.ended) {
        settleEncounterBattle(state, ctx, enc)
      }
      return
    }
    if (state.pendingBattleRange?.intent.kind === 'encounter' && state.pendingBattleRange.intent.invitedAtGameMs === enc.invitedAtGameMs) return
    if (state.gameMs >= enc.deadlineGameMs) {
      resolveTextual(state, ctx, false)
    }
    return
  }
}
