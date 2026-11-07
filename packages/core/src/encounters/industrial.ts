import type { GameState } from '../state'
import { addLog } from '../state'
import type { SimContext } from '../types'
import type { Exposure } from './presence'
import { deployedCombatEscorts } from '../combat/command/locks'
import { industrialBaseThreatOf, industrialFleetSnapshotOf, industrialThreatOf } from './risk'
import { pirateFormationOf } from './pirateFormation'
import { nextRandom } from '../rng'
import { startBattleFor } from '../combat/startSingle'
import { startFleetBattleFor } from '../combat/startFleet'
import { shipActuallyDocked } from '../shipActionPolicy'
import type { IndustrialActivity } from './riskTypes'
import { noteOfflineEncounter } from '../offlineCombatStats'

export function industrialSortieOf(state: GameState): string[] {
  if (state.hauling.active && state.hauling.fleetLeg) return [...state.hauling.fleetLeg.shipIds]
  const deployed = deployedCombatEscorts(state)
  return deployed.includes(state.shipId) ? [...deployed] : [state.shipId]
}

export function industrialActivityOf(state: GameState): IndustrialActivity {
  return state.hauling.active || state.sideTasks.deliver !== null ? 'hauling' : 'mining'
}

/** 只有主控实际出勤进入新海盗路径，敌人完整配置同时写入战斗覆写。 */
export function spawnIndustrialEncounter(state: GameState, ctx: SimContext, exp: Exposure): boolean {
  if (state.sideTasks.deliver !== null) return false
  const base = industrialBaseThreatOf(ctx, exp.galaxyId)
  if (base === null) return false
  const config = ctx.balance.encounter.industrial
  const ids = industrialSortieOf(state)
  const virtualCargo = state.hauling.active ? state.hauling.fleetLeg?.loadedM3 ?? 0 : 0
  const fleet = industrialFleetSnapshotOf(state, ctx, ids, virtualCargo)
  const activity = industrialActivityOf(state)
  const view = industrialThreatOf(base, fleet.industrialMassKg, fleet.cargoM3, config.threat.profiles[activity])
  if (!ctx.foeShips) return false
  const seed = Math.floor(nextRandom(state.rng) * 0x1_0000_0000)
  const generated = pirateFormationOf(view.targetThreat, seed, config.formation, ctx.foeShips, ctx.balance.battle)
  if (!generated) return false
  const card = { ...generated.card, galaxyId: exp.galaxyId,
    rewardIsk: Math.max(0, ...[...ctx.anomalies.values()].filter(row => row.galaxyId === exp.galaxyId && !row.hidden && row.region !== 'inv').map(row => row.rewardIsk)) }
  const override = { generatedCard: card }
  const battle = ids.length > 1
    ? startFleetBattleFor(state, ctx, ids, card.id, state.gameMs, undefined, undefined, override)
    : startBattleFor(state, ctx, state.shipId, card.id, state.gameMs, undefined, override)
  if (!battle) return false
  battle.hullEscapeFrac = ctx.balance.encounter.retreatHullFrac
  state.encounter = { active: true, shipId: state.shipId, galaxyId: exp.galaxyId, name: card.name, threat: generated.realizedThreat,
    anomalyId: card.id, origin: exp.kind, invitedAtGameMs: state.gameMs, deadlineGameMs: state.gameMs, battle,
    pirate: { version: 1, seed, targetThreat: view.targetThreat, realizedThreat: generated.realizedThreat, fleet, activity, card } }
  addLog(state, 'combat', '', 'core.industrial.007', { p1: view.targetThreat, p2: card.ships!.length })
  noteOfflineEncounter(state, battle)
  return true
}

/** 额度跨星系/活动保留；只有连续停靠整备恢复，在线离线同源。 */
export function advanceIndustrialProtection(state: GameState, ctx: SimContext, deltaMs: number, dangerous: boolean): void {
  const config = ctx.balance.encounter.industrial
  const elapsed = state.awayGalaxy ? state.gameMs - (state.lowSecPresence[state.awayGalaxy] ?? -Infinity) : 0
  const initialRemaining = state.gameMs === 0 || shipActuallyDocked(state, ctx) ? ctx.balance.encounter.entryBufferMs : Math.max(0, ctx.balance.encounter.entryBufferMs - elapsed)
  const protection = state.industrialProtection ??= { version: 1, entryRemainingMs: initialRemaining, dockedMs: 0, postBattleUntilMs: 0 }
  if (shipActuallyDocked(state, ctx)) {
    protection.dockedMs = Math.min(config.entryProtectionRestoreDockMs, protection.dockedMs + deltaMs)
    if (protection.dockedMs >= config.entryProtectionRestoreDockMs) protection.entryRemainingMs = ctx.balance.encounter.entryBufferMs
  } else {
    protection.dockedMs = 0
    if (dangerous && !state.encounter.active) protection.entryRemainingMs = Math.max(0, protection.entryRemainingMs - deltaMs)
  }
}
