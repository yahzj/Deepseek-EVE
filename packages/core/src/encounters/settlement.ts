import type { GameState } from '../state'
import { addLog } from '../state'
import type { SimContext } from '../types'
import { captureBattleReport, refundBattleAmmo, refundRepairKitsAll } from '../combat'
import { clearEncounter, markAmbushRetreat } from './return'
import { lootOf, dropWrecks } from './loot'
import { repairWithKitsFor } from '../shipyard'
import { applyArmorFirstDamage, firepowerHitHp } from '../hullDamage'
import { nearestStationGalaxyId } from '../location'
import { shortestTravelMinutes, travelLegMs } from '../travel'
import { noteOfflineEncounterOutcome, noteOfflineTransportStop, noteOfflineRepairKits } from '../offlineCombatStats'
import { finishFleetHaulingAbortAfterEncounter } from '../hauling/fleet'

/** 新普通海盗只结算真实战斗一次，旧文字/入侵结算路径不受影响。 */
export function settleIndustrialEncounter(state: GameState, ctx: SimContext, helpers: {
  settleBattleDroneLosses: (state: GameState, ctx: SimContext, shipId: string, battle: GameState['encounter']['battle']) => void
  persistBattleDamage: (state: GameState, ctx: SimContext, shipId: string, battle: GameState['encounter']['battle']) => void
  loseSunkShipsOfBattle: (state: GameState, ctx: SimContext, shipId: string) => number
}, escaped = false): void {
  const enc = state.encounter, snapshot = enc.pirate, battle = enc.battle
  if ((!snapshot && !enc.automatic) || !battle) return
  const originalIds = snapshot?.fleet.shipIds ?? battle.myFleet?.map(row => row.shipId) ?? [enc.shipId ?? state.shipId]
  const shipId = enc.shipId ?? state.shipId
  const won = !escaped && battle.ended === 'me'
  helpers.settleBattleDroneLosses(state, ctx, shipId, battle)
  refundBattleAmmo(state, battle)
  refundRepairKitsAll(state, battle)
  helpers.persistBattleDamage(state, ctx, shipId, battle)
  if (escaped && state.fleet[shipId] && (battle.units.player?.hp.h ?? 0) > 0) {
    applyArmorFirstDamage(state, ctx, shipId, firepowerHitHp(ctx, enc.threat, ctx.balance.combat.retreatHitFirepowerSec))
    markAmbushRetreat(state)
  }
  let loot = 0
  if (won) {
    loot = lootOf(state, ctx, 1 + 0.1 * Math.min(5, state.skills.trained['seizure-appraisal'] ?? 0))
    state.wallet.isk += loot
    dropWrecks(state, ctx)
    if (snapshot) addLog(state, 'combat', '', 'core.industrial.009', { p1: loot })
  }
  captureBattleReport(state, battle, { source: 'encounter', outcome: escaped ? 'break' : won ? 'win' : 'lose', summary: enc.name })
  const lost = helpers.loseSunkShipsOfBattle(state, ctx, shipId)
  noteOfflineEncounterOutcome(state, battle, escaped ? 'break' : won ? 'win' : 'lose', lost)
  const survivors = originalIds.filter(id => state.fleet[id] && state.fleet[id]!.durability > 0)
  clearEncounter(state)
  const protection = state.industrialProtection ??= { version: 1, entryRemainingMs: 0, dockedMs: 0, postBattleUntilMs: 0 }
  if (snapshot) protection.postBattleUntilMs = state.gameMs + ctx.balance.encounter.industrial.postBattleProtectionMs
  const projected = { ...state, combatEscort: undefined }
  let ready = won && lost === 0 && survivors.length === originalIds.length
  if (ready) for (const id of survivors) {
    const ship = state.fleet[id]!
    const target = ctx.balance.encounter.repairTargetFrac
    if (ship.durability < target || (ship.armorPct ?? 1) < target) {
      const repaired = repairWithKitsFor(projected, ctx, id, target, 'cargo+warehouse')
      noteOfflineRepairKits(state, repaired.used)
      if (ship.durability < target || (ship.armorPct ?? 1) < target) ready = false
    }
  }
  if (finishFleetHaulingAbortAfterEncounter(state, ctx)) return
  if (ready) return
  if (state.hauling.active) noteOfflineTransportStop(state, lost > 0 ? 'loss' : escaped || !won ? 'defeat' : state.hauling.fleetLeg?.abortAfterBattle ? 'interrupted' : 'damage')
  state.mining.active = false
  state.salvaging.active = false
  state.hauling.active = false
  delete state.hauling.fleetLeg
  state.standby.active = false
  state.sideTasks.deliver = null
  delete state.pendingStationActivity
  if (!survivors.length || !survivors.includes(state.shipId)) {
    state.awayGalaxy = null
    state.dockedSite = null
    delete state.combatEscort
    return
  }
  state.combatEscort = { version: 1, leaderShipId: state.shipId, shipIds: survivors }
  const from = enc.galaxyId!
  const to = nearestStationGalaxyId(state, ctx, from)
  const minutes = shortestTravelMinutes(ctx, from, to)
  const legMs = Math.max(...survivors.map(id => minutes > 0 && Number.isFinite(minutes) ? travelLegMs(state, ctx, minutes, id) : ctx.balance.mining.localLegMs))
  state.transit = { active: true, fromGalaxy: from, toGalaxy: to, finishAtGameMs: state.gameMs + legMs, legMs, delivery: null }
  state.awayGalaxy = from
  addLog(state, 'fleet', '', 'core.industrial.008')
}
